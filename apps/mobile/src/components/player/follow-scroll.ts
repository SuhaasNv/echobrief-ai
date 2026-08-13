import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent, ScrollView, View } from "react-native";

import { PLAYER_BAR_HEIGHT, PLAYER_TAB_BAR_GAP, useTabBarTopEdge } from "./metrics";

/**
 * Keeping the playing line on screen, without taking the scroll away.
 *
 * One rule separates this from the version everybody ships first: manual
 * scrolling wins, permanently. The moment a finger drags the transcript the
 * follow is off and stays off, because an app that yanks the view back while
 * you are reading three minutes ahead is unusable. What replaces it is an
 * explicit affordance, so returning is a choice rather than an ambush.
 *
 * Position is resolved with measureInWindow rather than by chaining onLayout up
 * the tree. The transcript sits under a header, a ribbon, and a segmented
 * control, all of which change height; a chained offset would be correct until
 * one of them did, and then quietly wrong.
 *
 * Like the playback controller, this is an external store rather than React
 * state. It is consumed by the meeting screen, whose render includes 800
 * transcript rows, and the latch flipping must not cost that.
 */

/** How far below the top of the scroll view a revealed line lands. */
const LEAD = 56;
/** Comfortable band. A line already inside it is not worth a scroll. */
const COMFORT_TOP = 24;

/** Air between the last line of content and the top of the player card. */
const CONTENT_AIR = 16;

export interface FollowScrollProps {
  ref: React.RefObject<ScrollView | null>;
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onScrollBeginDrag: () => void;
  scrollEventThrottle: number;
}

export interface FollowState {
  /** Auto-scroll is still allowed to move the view. */
  following: boolean;
  /** A transcript is mounted and knows where its current line is. */
  canJump: boolean;
}

export interface FollowScroll {
  /** Spread onto the screen's ScrollView. */
  scrollProps: FollowScrollProps;
  /**
   * Screen-space distance from the bottom of the screen to the top of the
   * chrome. For anchored things and for judging whether a line is readable.
   */
  bottomInset: number;
  /**
   * The same clearance expressed as contentContainer paddingBottom, for a scroll
   * view running `contentInsetAdjustmentBehavior="automatic"`.
   *
   * `bottomInset` minus the tab bar's top edge, because UIKit has already inset
   * the content by exactly that under "automatic" — the safe area is applied at
   * both ends, not only under the large title. Passing `bottomInset` straight
   * into the style, which is what the transcript did, paid the bar's 83pt twice
   * and left the screen scrolling a bar-height past the last line of a
   * transcript. The two numbers are the same distance measured in different
   * spaces, which is why they are named and derived here rather than at the call
   * site: they must not be allowed to disagree.
   */
  contentPadding: number;
  /** Ref callback for the transcript's outer container. */
  setContainer: (node: View | null) => void;
  /**
   * Reveal a row, if following is still on and the row is not already readable.
   *
   * @param y      Row offset inside the registered container.
   * @param height Row height, so a tall paragraph is judged by its whole box.
   */
  reveal: (y: number, height: number, animated: boolean) => void;
  /**
   * Publish the transcript's "take me to the current line" action. Pass null on
   * unmount, so the affordance disappears with the pane that can serve it.
   */
  registerJump: (jump: (() => void) | null) => void;
  /** Turn following back on and run the registered jump. */
  jumpToCurrent: () => void;
  /** Unconditional scroll, for the jump. Ignores the comfort band and latch. */
  force: (y: number, height: number, animated: boolean) => void;
  getState: () => FollowState;
  subscribe: (listener: () => void) => () => void;
}

export function useFollowScroll({ hasPlayer }: { hasPlayer: boolean }): FollowScroll {
  const scrollRef = useRef<ScrollView>(null);
  const containerRef = useRef<View | null>(null);
  const offsetRef = useRef(0);
  const jumpRef = useRef<(() => void) | null>(null);
  const stateRef = useRef<FollowState>({ following: true, canJump: false });
  const listeners = useRef(new Set<() => void>()).current;

  /**
   * The whole bottom chrome block, summed from its parts.
   *
   * tab bar top edge + the player's seam + the player + air. Every term is a
   * real measured height rather than a rounded-up allowance, which is what lets
   * the same number serve as BOTH the content inset and the comfort band below:
   * they are the same distance, so they can no longer disagree. The old pair
   * (an inset that double-counted the 49pt bar, and a hardcoded 140 sized
   * against the 128pt player) disagreed by 5pt in the direction that hides a
   * line under the transport.
   */
  const aboveBar = hasPlayer ? PLAYER_TAB_BAR_GAP + PLAYER_BAR_HEIGHT + CONTENT_AIR : CONTENT_AIR;
  const bottomChrome = useTabBarTopEdge() + aboveBar;

  const publish = useCallback(
    (patch: Partial<FollowState>) => {
      const current = stateRef.current;
      if (
        (patch.following === undefined || patch.following === current.following) &&
        (patch.canJump === undefined || patch.canJump === current.canJump)
      ) {
        return;
      }
      stateRef.current = { ...current, ...patch };
      listeners.forEach((listener) => listener());
    },
    [listeners],
  );

  const scrollTo = useCallback(
    (y: number, height: number, animated: boolean, force: boolean) => {
      const scroller = scrollRef.current;
      const container = containerRef.current;
      if (!scroller || !container) return;
      if (!force && !stateRef.current.following) return;

      const native = scroller.getNativeScrollRef();
      if (!native) return;

      native.measureInWindow((_x, scrollerY, _width, scrollerHeight) => {
        // Re-checked inside the async callback: a drag can land between the two
        // measurements, and honouring a stale request is exactly the behaviour
        // the latch exists to prevent.
        if (!force && !stateRef.current.following) return;

        container.measureInWindow((_cx, containerY) => {
          if (!force && !stateRef.current.following) return;

          const top = containerY - scrollerY + y;
          const bottom = top + height;
          if (!force && top >= COMFORT_TOP && bottom <= scrollerHeight - bottomChrome) {
            // Already readable. Scrolling anyway would step the page on every
            // line, which is the irritating version of this feature.
            return;
          }

          // measureInWindow is screen space and scrollTo is content space, but
          // the delta between two screen measurements is identical in both, so
          // adding it to the live content offset is exact.
          scroller.scrollTo({ y: offsetRef.current + top - LEAD, animated });
        });
      });
    },
    [bottomChrome],
  );

  const scrollProps = useMemo<FollowScrollProps>(
    () => ({
      ref: scrollRef,
      // Only the live content offset is wanted, and only at the instant of a
      // reveal, so this is throttled well below frame rate. It writes a ref and
      // renders nothing.
      scrollEventThrottle: 64,
      onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
        offsetRef.current = event.nativeEvent.contentOffset.y;
      },
      // onScrollBeginDrag, not onScroll: our own animated scrollTo fires
      // onScroll too, and latching on that would switch following off the first
      // time it worked.
      onScrollBeginDrag: () => publish({ following: false }),
    }),
    [publish],
  );

  return useMemo(
    () => ({
      scrollProps,
      bottomInset: bottomChrome,
      contentPadding: aboveBar,
      setContainer: (node: View | null) => {
        containerRef.current = node;
      },
      reveal: (y: number, height: number, animated: boolean) =>
        scrollTo(y, height, animated, false),
      force: (y: number, height: number, animated: boolean) => scrollTo(y, height, animated, true),
      registerJump: (jump: (() => void) | null) => {
        jumpRef.current = jump;
        publish({ canJump: jump !== null });
      },
      jumpToCurrent: () => {
        // Following resumes here and only here. "Stops permanently" means it
        // never resumes on its own; an explicit tap on an affordance that says
        // it will take you back is the user asking for it.
        publish({ following: true });
        jumpRef.current?.();
      },
      getState: () => stateRef.current,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    }),
    [aboveBar, bottomChrome, listeners, publish, scrollProps, scrollTo],
  );
}

/** Reactive read of the follow latch, for the return-to-current affordance. */
export function useFollowState(follow: FollowScroll): FollowState {
  return useSyncExternalStore(follow.subscribe, follow.getState);
}
