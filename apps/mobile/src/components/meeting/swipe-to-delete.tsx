import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  FadeIn,
  ReduceMotion,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useQueryClient } from "@tanstack/react-query";
import Svg, { Path } from "react-native-svg";

import { DELETE_UNDO_MS, undoMeetingDelete, useMeetingDeletePending } from "@/lib/api/meetings";
import { haptics } from "@/lib/haptics";
import { SPRING } from "@/lib/motion";
import { useColorToken } from "@/lib/tokens";

/**
 * Swipe-to-delete, built on Gesture.Pan rather than on a Swipeable component.
 *
 * gesture-handler ships ReanimatedSwipeable, but it owns the settle animation
 * and gives no hook at the open threshold — which is exactly where the one
 * haptic that makes this gesture feel physical has to fire. Driving the pan
 * directly is roughly the same amount of code and buys 1:1 tracking, the
 * rubber-band, a velocity-fed settle, and the threshold tick.
 *
 * There is deliberately NO full-swipe-to-delete. A full swipe that commits on
 * release is how people lose data: the audio and transcript are unrecoverable,
 * and the gesture that destroys them should not be the gesture your thumb
 * performs by accident on a scrolling list. Past the resting width the row
 * rubber-bands and goes no further.
 */

/** Resting width of the revealed action. Wide enough for a 44pt target. */
const ACTION_WIDTH = 92;
/** Release past this and the row settles open. Just over half, as UIKit does. */
const OPEN_AT = ACTION_WIDTH * 0.55;
/** Travel past the resting width is damped to this fraction. */
const OVERSHOOT_RESISTANCE = 0.35;
/** Dragging the wrong way barely moves at all, so the row feels anchored. */
const WRONG_WAY_RESISTANCE = 0.1;
/** Points per second that counts as a flick and overrides position. */
const FLICK_VELOCITY = 550;

/**
 * Only one row is open at a time, as in Mail.
 *
 * Module scope rather than context: the list is virtualized, so the open row
 * and the row being swiped are frequently not rendered by a common ancestor
 * that survives recycling. A closer left here after its row unmounts only ever
 * receives a redundant close, so a stale entry is harmless, but the unmount
 * effect clears it anyway.
 */
let openRowCloser: (() => void) | null = null;

/**
 * Position under the finger.
 *
 * 1:1 inside the live range — no easing, no lag, the row is literally where the
 * finger put it. Resistance applies only outside it, in both directions.
 */
function resist(x: number): number {
  "worklet";
  if (x >= 0) return x * WRONG_WAY_RESISTANCE;
  if (x >= -ACTION_WIDTH) return x;
  return -ACTION_WIDTH + (x + ACTION_WIDTH) * OVERSHOOT_RESISTANCE;
}

function TrashGlyph({ color }: { color?: string }) {
  return (
    <Svg width={17} height={18} viewBox="0 0 17 18">
      <Path
        d="M2.6 4.4h11.8M6.6 4.4V2.9a1 1 0 0 1 1-1h1.8a1 1 0 0 1 1 1v1.5M3.9 4.4l.7 10.1a1.4 1.4 0 0 0 1.4 1.3h5a1.4 1.4 0 0 0 1.4-1.3l.7-10.1M7 7.6v5M10 7.6v5"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

/**
 * What sits in the row's place during the undo window.
 *
 * The meeting is gone from the user's point of view; what is left is a receipt
 * with a way back. It covers the card rather than replacing it so the row keeps
 * its exact height — collapsing it would mean animating a height, and it would
 * make every row below jump while the user is still deciding.
 *
 * The draining bar is information, not decoration: without it "Undo" is an
 * affordance with an invisible deadline. It scales rather than resizing, and it
 * opts out of Reduce Motion for the same reason the row's progress seam does —
 * resolved instantly it would read as an empty bar and tell the user the window
 * had already closed.
 */
/**
 * The undo window, meetings-only.
 *
 * Exported because SwipeToDelete no longer knows what it is deleting: the row
 * renders whatever overlay its caller hands it while `pending`. Action items
 * have no undo window, so they hand it nothing.
 */
export function MeetingUndoVeil({ id, title }: { id: string; title: string }) {
  const reduceMotion = useReducedMotion();
  const drain = useSharedValue(1);

  useEffect(() => {
    drain.value = withTiming(0, {
      duration: DELETE_UNDO_MS,
      easing: Easing.linear,
      reduceMotion: ReduceMotion.Never,
    });
  }, [drain]);

  const drainStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: drain.value }] }));

  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeIn.duration(140)}
      className="absolute inset-0 justify-center bg-elevated"
      accessibilityLabel={`${title} deleted`}
    >
      <View className="flex-row items-center gap-3 px-4">
        <Text
          className="flex-1 text-[15px] text-label-secondary"
          numberOfLines={1}
          maxFontSizeMultiplier={1.4}
        >
          Deleted
        </Text>

        <Pressable
          onPress={() => {
            haptics.tap();
            undoMeetingDelete(id);
          }}
          accessibilityRole="button"
          accessibilityLabel={`Undo deleting ${title}`}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          {({ pressed }) => (
            <Text
              className="text-[15px] font-semibold text-tint"
              style={{ opacity: pressed ? 0.5 : 1 }}
              maxFontSizeMultiplier={1.4}
            >
              Undo
            </Text>
          )}
        </Pressable>
      </View>

      <View className="absolute inset-x-0 bottom-0 h-[2px] overflow-hidden bg-fill">
        <Animated.View
          className="h-full w-full bg-label-tertiary"
          style={[{ transformOrigin: "left center" }, drainStyle]}
        />
      </View>
    </Animated.View>
  );
}

export function SwipeToDelete({
  title,
  children,
  onDelete,
  pending = false,
  undoOverlay = null,
}: {
  /** Display title, already run through displayTitle. Used for the a11y label. */
  title: string;
  children: React.ReactNode;
  /**
   * Runs when the destructive action is tapped. The row closes itself first.
   *
   * Passed in rather than hardcoded so this gesture is not owned by meetings.
   * Everything above this line — the latch, the rubber band, the single-open-row
   * registry, the haptics — is list-agnostic, and duplicating 300 lines of it to
   * put a swipe on action items would be the wrong kind of reuse.
   */
  onDelete: () => void;
  /** True while this row is inside an undo window; suppresses the gesture. */
  pending?: boolean;
  /** Rendered over the row while `pending`. Lists without undo pass nothing. */
  undoOverlay?: React.ReactNode;
}) {
  // The glyph on the destructive action, drawn on bg-danger — see the note at
  // the call site for why it is the canvas colour and not near-white.
  const onDanger = useColorToken("--background");
  const translateX = useSharedValue(0);
  const startX = useSharedValue(0);
  /**
   * Threshold latch.
   *
   * A shared value rather than a React ref because the comparison runs on the
   * UI thread inside the gesture worklet, where a ref is a cross-thread read.
   * The latch is the whole point: without it, holding the finger near the
   * boundary fires a tick every frame and the row buzzes.
   */
  const pastThreshold = useSharedValue(false);

  const [open, setOpen] = useState(false);

  // A named function expression so it can compare the registry against its own
  // identity. useCallback hands back this exact object, so `close` inside the
  // body and the value stored in `openRowCloser` are the same reference.
  const closeSelf = useCallback(
    function close() {
      translateX.value = withSpring(0, { ...SPRING.snappy, reduceMotion: ReduceMotion.Never });
      setOpen(false);
      if (openRowCloser === close) openRowCloser = null;
    },
    [translateX],
  );

  /**
   * Touching any row dismisses whichever other row is open, but does NOT make
   * this row the open one. Those are separate events: a plain tap that opens a
   * meeting has to close the other row, and if it also claimed ownership the
   * registry would end up pointing at a row that is not open and the row that
   * really is open would never be closed by anything.
   */
  const dismissOthers = useCallback(() => {
    if (openRowCloser && openRowCloser !== closeSelf) openRowCloser();
  }, [closeSelf]);

  /**
   * Ownership changes only once the gesture has settled.
   *
   * Called through runOnJS with a boolean, which is trivially shareable —
   * passing `closeSelf` across the thread boundary instead would not be, since
   * runOnJS serializes its arguments and a plain JS closure is not a shareable
   * value.
   */
  const settle = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      if (nextOpen) openRowCloser = closeSelf;
      else if (openRowCloser === closeSelf) openRowCloser = null;
    },
    [closeSelf],
  );

  useEffect(
    () => () => {
      if (openRowCloser === closeSelf) openRowCloser = null;
    },
    [closeSelf],
  );

  // Confirming from the header menu while the row happens to be open would
  // otherwise leave it open underneath the veil for the whole window and
  // sitting open when an undo puts it back.
  useEffect(() => {
    if (pending) closeSelf();
  }, [pending, closeSelf]);

  // Note: haptics are not suppressed for an active recording here. iOS mutes
  // the Taptic Engine while the mic is live, but the recorder's state is local
  // to the record screen (see src/lib/audio/use-recorder.ts) and is not
  // observable from the library. If that state is ever lifted, gate `tick` on it.
  const tick = useCallback(() => haptics.select(), []);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        // Horizontal intent, explicitly. Without an activation offset the pan
        // claims the touch on the first pixel and the SectionList cannot be
        // scrolled anywhere near a row; failOffsetY hands a diagonal drag to the
        // list rather than splitting the movement between them.
        .activeOffsetX([-14, 14])
        .failOffsetY([-12, 12])
        .enabled(!pending)
        .onBegin(() => {
          // Resume from wherever the row currently is, so a second drag on an
          // already-open row continues instead of jumping back to zero.
          startX.value = translateX.value;
          pastThreshold.value = translateX.value <= -OPEN_AT;
          // onBegin, not onStart: the other row should close the moment a finger
          // lands, the same as UIKit, rather than waiting for the pan to clear
          // its activation threshold.
          runOnJS(dismissOthers)();
        })
        .onUpdate((event) => {
          translateX.value = resist(startX.value + event.translationX);

          const past = translateX.value <= -OPEN_AT;
          if (past !== pastThreshold.value) {
            pastThreshold.value = past;
            // Crossings only, in either direction. This is the tick that tells
            // the thumb "release now and the action stays".
            runOnJS(tick)();
          }
        })
        .onEnd((event) => {
          // Velocity beats position: a fast flick should open even if the finger
          // lifted short of the threshold, and a fast flick back should close
          // even from beyond it.
          const shouldOpen =
            event.velocityX < -FLICK_VELOCITY
              ? true
              : event.velocityX > FLICK_VELOCITY
                ? false
                : translateX.value <= -OPEN_AT;

          runOnJS(settle)(shouldOpen);

          translateX.value = withSpring(shouldOpen ? -ACTION_WIDTH : 0, {
            ...SPRING.snappy,
            // Carrying the release velocity into the spring is what separates a
            // flick from a slow drag. Without it both settle identically and the
            // row feels dead in the hand.
            velocity: event.velocityX,
            // Direct manipulation, so it opts out of Reduce Motion: resolved
            // instantly the row teleports open, which reads as a broken control
            // rather than as a respected preference. Reduce Motion is about
            // large unsolicited motion, not about the thing under your finger.
            reduceMotion: ReduceMotion.Never,
          });
        }),
    [pending, dismissOthers, settle, tick, translateX, startX, pastThreshold],
  );

  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.value }] }));

  /**
   * The track is parked one full width past the trailing edge and rides in with
   * the row, so it fills exactly the strip the row has vacated and is never
   * underneath the row itself.
   *
   * It used to be a static full-bleed fill, which is invisible only while the
   * row above it stays opaque and exactly its size. Action items break that
   * assumption: ActionRow exits with a FadeOut (components/actions/action-row.tsx),
   * and Reanimated defers removal of a whole subtree until a descendant's
   * exiting animation finishes — so this container, and the red under it,
   * outlived the row it was hidden behind and every completion and delete
   * washed the row red on its way out.
   */
  const trackStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: "100%" }, { translateX: translateX.value }],
  }));

  /**
   * The action itself holds still in the container's coordinates, so it is
   * uncovered by the row moving off it rather than sliding in behind it, and it
   * stays put at the trailing edge through the rubber-band instead of drifting
   * with the finger. Cancelling both the parking offset and the drag is what
   * keeps the reveal identical to the static track it replaces.
   */
  const actionStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -(ACTION_WIDTH + translateX.value) }],
  }));

  return (
    <GestureDetector gesture={pan}>
      {/* Clipped and rounded to the card's own geometry, so the action track
          behind it cannot show as red corners around the card's squircle. */}
      <View className="overflow-hidden rounded-card" style={{ borderCurve: "continuous" }}>
        {/* Full-bleed rather than ACTION_WIDTH wide: during the rubber-band the
            row travels past the resting width, and a track sized to the resting
            width would expose the canvas behind it. Clipped, because the action
            counter-translates out of the track's own box and would otherwise
            paint across the row. */}
        <Animated.View
          className="absolute inset-0 flex-row overflow-hidden bg-danger"
          style={trackStyle}
        >
          <Animated.View style={actionStyle}>
            <Pressable
              onPress={() => {
                closeSelf();
                onDelete();
              }}
              style={{ width: ACTION_WIDTH }}
              className="h-full items-center justify-center gap-1"
              accessibilityRole="button"
              accessibilityLabel={`Delete ${title}`}
              // Hidden from VoiceOver while closed: it is under the card and
              // unreachable by touch, and an invisible Delete button in the rotor
              // is worse than none. The row exposes a proper custom action for
              // that path instead (see components/meetings/meeting-row.tsx).
              accessibilityElementsHidden={!open}
              importantForAccessibility={open ? "yes" : "no-hide-descendants"}
            >
              {/* text-background on bg-danger, not white. This palette's dark red
                  is #FF5F62, where near-white measures 2.97:1 and fails AA, while
                  the canvas colour over it clears 6.7:1. The token pairing also
                  holds in a light theme, where both flip together and it becomes
                  white on #C81C2A at 5.8:1.

                  The glyph reads the token rather than the class, because
                  react-native-svg strokes are not styled by className. It is the
                  same value text-background resolves to, so the two cannot drift
                  apart the way a copied hex could. */}
              <TrashGlyph color={onDanger} />
              <Text
                className="text-[12px] font-semibold text-background"
                maxFontSizeMultiplier={1.3}
                numberOfLines={1}
              >
                Delete
              </Text>
            </Pressable>
          </Animated.View>
        </Animated.View>

        <Animated.View style={rowStyle}>
          {children}

          {/* Tapping the open row closes it instead of opening the meeting,
              which is what UIKit does. It rides inside the translated view so it
              covers exactly the card and never the action beside it. */}
          {open && !pending ? (
            <Pressable
              className="absolute inset-0"
              onPress={() => {
                // Lighter than the destructive path: nothing happened.
                haptics.tap();
                closeSelf();
              }}
              accessibilityRole="button"
              accessibilityLabel="Close delete action"
            />
          ) : null}
        </Animated.View>

        {pending ? undoOverlay : null}
      </View>
    </GestureDetector>
  );
}
