import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

import type { MeetingDetail } from "@/lib/api/meeting-detail";
import {
  SKIP_BACK_SEC,
  SKIP_FORWARD_SEC,
  usePlaybackState,
  type PlaybackController,
} from "@/lib/audio/playback";
import { formatClock } from "@/lib/format";
import { haptics } from "@/lib/haptics";
import { SPRING } from "@/lib/motion";

import {
  ChevronDownGlyph,
  GLYPH,
  GLYPH_DIM,
  PauseGlyph,
  PlayGlyph,
  SkipBackGlyph,
  SkipForwardGlyph,
} from "./glyphs";
import { useFollowState, type FollowScroll } from "./follow-scroll";
import {
  PLAYER_BAR_HEIGHT,
  PLAYER_SKIP_ROW_HEIGHT,
  PLAYER_TAB_BAR_GAP,
  useTabBarTopEdge,
} from "./metrics";
import { RibbonScrubber } from "./ribbon-scrubber";

/**
 * The transport.
 *
 * Floats above the tab bar rather than filling the width, because the native
 * UITabBar on iOS 26 is itself a floating glass element and a full-bleed bar
 * butted against it reads as two competing chromes. It shares that bar's 16pt
 * side margins and sits 6pt off its top edge, so the two read as one block of
 * chrome with one content inset below them rather than as two overlays with a
 * readable strip of live text stranded in between.
 *
 * ONE ROW AT REST. The bar used to stack a scrub target, a time row and a
 * transport row into 128pt; with the tab bar under it that is a quarter of the
 * screen permanently spent on chrome, and it cut summary lines in half. Now the
 * things you touch constantly — play, position, elapsed — share a single 56pt
 * row, and skip opens on a tap.
 *
 * It shrinks rather than hiding on scroll. Hiding would have matched the tab
 * bar's own minimizeBehavior, but a transport that is gone while you read the
 * transcript it is playing is unavailable exactly when it is wanted; and driving
 * it from scroll direction would fight follow-scroll, which issues its own
 * programmatic scrolls and would collapse the bar every time it revealed a line.
 * Shrinking is unconditional: no state machine, no gesture arbitration, and one
 * constant for the scroll inset.
 *
 * Skip is 15 back and 30 forward. That asymmetry is the podcast convention and
 * it is not arbitrary: you skip back to re-hear a sentence, and forward to get
 * past a stretch you do not need, and those are different distances.
 *
 * This component subscribes to playback state; the meeting screen does not.
 * That is what keeps a play tap from re-rendering an 800 row transcript.
 */

/** Diameter of the primary control. Apple's minimum, exactly. */
const PLAY_SIZE = 44;

/**
 * Advance of one tabular figure at 12px, rounded up. A floor for the elapsed
 * slot, not a lock — if it is short the text simply sizes itself.
 */
const DIGIT_ADVANCE = 7;

function TransportButton({
  onPress,
  label,
  hint,
  disabled,
  children,
}: {
  onPress: () => void;
  label: string;
  hint?: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={() => {
        if (disabled) return;
        haptics.tap();
        onPress();
      }}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: Boolean(disabled) }}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      className="h-11 w-11 items-center justify-center"
    >
      {/* Opacity, not scale: these sit in a row of fixed centres and a scaled
          press would make the row appear to breathe. */}
      {({ pressed }) => <View style={{ opacity: pressed ? 0.45 : 1 }}>{children}</View>}
    </Pressable>
  );
}

/**
 * Elapsed time, isolated in its own component on purpose.
 *
 * It re-renders once a second. Reading the position stream here rather than in
 * the bar keeps that tick off the transport controls and the scrubber, and
 * formatClock has one second of resolution anyway, so a faster update would
 * change nothing on screen.
 */
function Elapsed({ playback, total }: { playback: PlaybackController; total: number }) {
  const [seconds, setSeconds] = useState(() => Math.floor(playback.getPosition()));
  const lastRef = useRef(seconds);

  useEffect(() => {
    return playback.subscribePosition((position) => {
      const whole = Math.floor(position);
      if (whole === lastRef.current) return;
      lastRef.current = whole;
      setSeconds(whole);
    });
  }, [playback]);

  return (
    <Text
      className="text-[12px] text-label-secondary"
      style={{
        fontVariant: ["tabular-nums"],
        // Floored to the widest clock this meeting can print, so the ribbon
        // beside it does not jump left when 9:59 becomes 10:00. Tabular figures
        // fix the width WITHIN a digit count; they do nothing about gaining one.
        minWidth: formatClock(total).length * DIGIT_ADVANCE,
      }}
      maxFontSizeMultiplier={1.3}
    >
      {formatClock(seconds)}
    </Text>
  );
}

/**
 * Skip disclosure.
 *
 * A rotating chevron rather than a labelled button: it is the same affordance
 * the settings groups use to open, so it does not have to be learned twice. The
 * rotation is a transform on a shared value, so opening the band never asks the
 * JS thread for a frame.
 */
function SkipDisclosure({ expanded, onPress }: { expanded: boolean; onPress: () => void }) {
  const reduceMotion = useReducedMotion();
  const spin = useSharedValue(expanded ? 1 : 0);

  useEffect(() => {
    spin.value = reduceMotion ? (expanded ? 1 : 0) : withSpring(expanded ? 1 : 0, SPRING.chrome);
  }, [expanded, reduceMotion, spin]);

  // Points up while closed (the band opens upward), down while open.
  const style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${180 - spin.value * 180}deg` }],
  }));

  return (
    <Pressable
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={expanded ? "Hide skip controls" : "Show skip controls"}
      accessibilityState={{ expanded }}
      // Grows into the card's own right padding only. Slop on the LEFT would
      // reach back over the ribbon and, being later in the tree, would win the
      // touch, quietly stealing the last few percent of the timeline.
      hitSlop={{ top: 6, bottom: 6, left: 0, right: 12 }}
      className="h-11 w-8 items-center justify-center"
    >
      {({ pressed }) => (
        <Animated.View style={[style, { opacity: pressed ? 0.45 : 1 }]}>
          <ChevronDownGlyph size={14} />
        </Animated.View>
      )}
    </Pressable>
  );
}

export interface PlayerBarProps {
  meeting: MeetingDetail;
  playback: PlaybackController;
  follow: FollowScroll;
}

export function PlayerBar({ meeting, playback, follow }: PlayerBarProps) {
  const state = usePlaybackState(playback);
  const followState = useFollowState(follow);
  const reduceMotion = useReducedMotion();
  const [expanded, setExpanded] = useState(false);
  // Sits ON the tab bar. Six points of seam, measured from the bar's real top
  // edge rather than from an inset that counted it twice — see
  // PLAYER_TAB_BAR_GAP and useTabBarTopEdge.
  const bottom = useTabBarTopEdge() + PLAYER_TAB_BAR_GAP;

  // A transcript-only meeting gets no transport at all. A play button that
  // cannot play is a bug report waiting to be filed.
  if (!meeting.has_audio) return null;

  const total = state.duration > 0 ? state.duration : (meeting.duration_sec ?? 0);
  const segments = meeting.transcript?.segments ?? [];
  const speakers = meeting.transcript?.speakers ?? [];
  const busy = state.phase === "loading" || state.buffering;
  const showJump = followState.canJump && !followState.following;

  return (
    <View
      className="absolute inset-x-0 bottom-0"
      style={{ paddingBottom: bottom }}
      // Taps outside the card belong to the transcript underneath it.
      pointerEvents="box-none"
    >
      {showJump ? (
        <Animated.View
          entering={FadeIn.duration(160)}
          exiting={FadeOut.duration(120)}
          className="items-center pb-2"
          pointerEvents="box-none"
        >
          <Pressable
            onPress={() => {
              haptics.tap();
              follow.jumpToCurrent();
            }}
            accessibilityRole="button"
            accessibilityLabel="Jump to the line playing now"
            className="flex-row items-center gap-1.5 rounded-full border border-edge bg-elevated px-3 py-1.5"
          >
            {({ pressed }) => (
              <>
                <View style={{ opacity: pressed ? 0.5 : 1 }}>
                  <ChevronDownGlyph />
                </View>
                <Text
                  className="text-[13px] font-semibold text-label"
                  style={{ opacity: pressed ? 0.5 : 1 }}
                  maxFontSizeMultiplier={1.3}
                >
                  Jump to current
                </Text>
              </>
            )}
          </Pressable>
        </Animated.View>
      ) : null}

      <View
        className="mx-4 overflow-hidden rounded-card border border-edge bg-elevated"
        style={{ borderCurve: "continuous" }}
      >
        {/* Skip band. Grows UPWARD, because the card is anchored to the bottom
            of an absolutely positioned container — so opening it never moves the
            row the finger is already on. */}
        {expanded ? (
          <Animated.View
            entering={reduceMotion ? undefined : FadeIn.duration(160)}
            // No exiting animation, deliberately. Reanimated holds an exiting
            // view at its last frame RELATIVE TO ITS PARENT, and this parent is
            // bottom-anchored, so the card's top edge drops 44pt the instant the
            // band unmounts and a fading copy of the skip buttons would be
            // dragged down on top of the transport row. The rule that exits are
            // faster than entrances, taken to its limit.
            // Centred pair, not spread to the edges. The total duration used to
            // sit between these two and justify the spread; with it moved down
            // to the transport row, `justify-between` would have pushed the two
            // glyphs into opposite corners with a void between them.
            className="flex-row items-center justify-center gap-14 px-6"
            style={{ height: PLAYER_SKIP_ROW_HEIGHT }}
          >
            <TransportButton
              onPress={() => playback.skip(-SKIP_BACK_SEC)}
              label={`Skip back ${SKIP_BACK_SEC} seconds`}
              disabled={total <= 0}
            >
              <SkipBackGlyph seconds={SKIP_BACK_SEC} color={total > 0 ? GLYPH : GLYPH_DIM} />
            </TransportButton>

            <TransportButton
              onPress={() => playback.skip(SKIP_FORWARD_SEC)}
              label={`Skip forward ${SKIP_FORWARD_SEC} seconds`}
              disabled={total <= 0}
            >
              <SkipForwardGlyph seconds={SKIP_FORWARD_SEC} color={total > 0 ? GLYPH : GLYPH_DIM} />
            </TransportButton>
          </Animated.View>
        ) : null}

        <View className="flex-row items-center gap-3 px-3" style={{ height: PLAYER_BAR_HEIGHT }}>
          <Pressable
            onPress={() => {
              haptics.tap();
              playback.toggle();
            }}
            accessibilityRole="button"
            accessibilityLabel={
              state.playing ? "Pause" : state.phase === "error" ? "Try again" : "Play"
            }
            className="items-center justify-center rounded-full bg-fill"
            style={{ width: PLAY_SIZE, height: PLAY_SIZE }}
          >
            {({ pressed }) => (
              <View style={{ opacity: pressed ? 0.5 : 1 }}>
                {busy ? (
                  // Replaces the glyph rather than sitting beside it: the
                  // control has one job at a time, and a spinner next to a play
                  // triangle reads as two states at once.
                  <ActivityIndicator color={GLYPH} accessibilityLabel="Loading audio" />
                ) : state.playing ? (
                  <PauseGlyph size={24} />
                ) : (
                  <PlayGlyph size={24} />
                )}
              </View>
            )}
          </Pressable>

          {state.error ? (
            // Takes the position and the whole of the ribbon's slot. A failure
            // is the only thing worth reading on this bar while it lasts, and
            // giving it its own line would put the height back.
            <Text
              className="flex-1 text-[12px] leading-[16px] text-danger"
              numberOfLines={2}
              maxFontSizeMultiplier={1.3}
            >
              {state.error}
            </Text>
          ) : (
            <>
              <Elapsed playback={playback} total={total} />

              {/* The same graphic as the hero ribbon, at 4pt. It is drawn small
                  because at this size it reads as a fingerprint of the meeting
                  rather than as a chart, and the 44pt target lives in the
                  padding around it rather than in the strip — which is exactly
                  why it can share a 56pt row with the play button instead of
                  needing a band of its own. */}
              <View className="flex-1">
                <RibbonScrubber
                  playback={playback}
                  segments={segments}
                  speakers={speakers}
                  height={6}
                />
              </View>

              {/* Total length, on the same line as the position.
                  It used to live only inside the skip band, so how long a
                  recording ran was invisible until you opened a disclosure —
                  and once open, an unlabelled 0:16 sat centred in one row above
                  an unlabelled 0:06 in another, which reads as two clocks
                  rather than as position and length. Flanking the ribbon, the
                  pair reads as one fact with the progress between them, which
                  is the arrangement every audio player has settled on. */}
              <Text
                className="text-[12px] text-label-secondary"
                style={{ fontVariant: ["tabular-nums"] }}
                maxFontSizeMultiplier={1.3}
              >
                {formatClock(total)}
              </Text>
            </>
          )}

          <SkipDisclosure expanded={expanded} onPress={() => setExpanded((open) => !open)} />
        </View>
      </View>
    </View>
  );
}
