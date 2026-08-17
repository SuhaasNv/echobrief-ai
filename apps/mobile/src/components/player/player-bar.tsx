import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useDerivedValue,
  withTiming,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";

import type { MeetingDetail } from "@/lib/api/meeting-detail";
import { usePlaybackState, type PlaybackController } from "@/lib/audio/playback";
import { formatClock } from "@/lib/format";
import { haptics } from "@/lib/haptics";
import { useColorTokens } from "@/lib/tokens";

import { ChevronDownGlyph, PauseGlyph, PlayGlyph } from "./glyphs";
import { useFollowState, type FollowScroll } from "./follow-scroll";
import { PLAYER_TAB_BAR_GAP, useTabBarTopEdge } from "./metrics";
import { WaveformScrubber } from "./waveform-scrubber";

/**
 * The transport, as one capsule.
 *
 * A circular play/pause at the left edge, a voice-memo waveform that doubles as
 * the scrubber, and the elapsed clock at the right — the shape a voice note has
 * everywhere, because it reads as "audio" before it reads as anything else. It
 * floats above the tab bar on the same 16pt margins, so the two are one block of
 * chrome with a single content inset below.
 *
 * ONE ROW, and no skip buttons: the waveform is the seek surface (tap or drag
 * anywhere), which is both what the reference does and what frees the height. A
 * shorter pill covers less of the transcript, and the scroll inset reserves it
 * exactly once so the last line always clears it.
 *
 * The capsule lights blue while playing and falls back to the flat surface when
 * paused — the one moving thing on the bar that says, at a glance across the
 * room, whether audio is running.
 *
 * This component subscribes to playback state; the meeting screen does not, so a
 * play tap never re-renders the 800-row transcript under it.
 */

/** Diameter of the play/pause control. */
const CONTROL_SIZE = 46;

/** Advance of one tabular figure at 15px, rounded up — a floor for the clock. */
const DIGIT_ADVANCE = 9;

/**
 * The blue wash under the pill while it plays.
 *
 * Dark-theme values, hard-coded: the app is dark-only, and expo-linear-gradient
 * needs concrete rgba it can interpolate rather than a token whose format we
 * cannot reliably add alpha to. Brightest behind the control and fading right,
 * matching where a glow sits in the reference. Its opacity crossfades with
 * playback so paused is the plain surface.
 */
const GLOW_COLORS = ["rgba(76,153,248,0.42)", "rgba(52,96,168,0.16)", "rgba(76,153,248,0)"] as const;

/**
 * Elapsed time, isolated so its once-a-second tick does not re-render the
 * transport or the scrubber beside it.
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
    // Primary label, not secondary: this is live data — the one number the bar
    // exists to report — and at the edge of a tinted playing pill the secondary
    // grey was the weakest thing on the card.
    <Text
      className="text-[15px] font-medium text-label"
      style={{
        fontVariant: ["tabular-nums"],
        // Floored to the widest clock this meeting can print, so the waveform
        // beside it does not shift when 9:59 becomes 10:00.
        minWidth: formatClock(total).length * DIGIT_ADVANCE,
        textAlign: "right",
      }}
      maxFontSizeMultiplier={1.3}
    >
      {formatClock(seconds)}
    </Text>
  );
}

export interface PlayerBarProps {
  meeting: MeetingDetail;
  playback: PlaybackController;
  follow: FollowScroll;
}

const TOKENS = ["--label", "--danger"] as const;

export function PlayerBar({ meeting, playback, follow }: PlayerBarProps) {
  const state = usePlaybackState(playback);
  const followState = useFollowState(follow);
  const [glyph, danger] = useColorTokens(TOKENS);
  // Sits on the tab bar. Six points of seam, from the bar's real top edge.
  const bottom = useTabBarTopEdge() + PLAYER_TAB_BAR_GAP;

  // A transcript-only meeting gets no transport at all. A play button that
  // cannot play is a bug report waiting to be filed.
  const has = meeting.has_audio;

  // Crossfade the blue wash with playback. Derived, so it lives on the UI thread
  // and does not re-render the pill on every play/pause.
  const glow = useDerivedValue(() => withTiming(state.playing ? 1 : 0, { duration: 260 }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value }));

  if (!has) return null;

  const total = state.duration > 0 ? state.duration : (meeting.duration_sec ?? 0);
  const busy = state.phase === "loading" || state.buffering;

  return (
    <View
      className="absolute inset-x-0 bottom-0"
      style={{ paddingBottom: bottom }}
      // Taps outside the pill belong to the transcript underneath it.
      pointerEvents="box-none"
    >
      {followState.canJump && !followState.following ? (
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
        className="mx-4 flex-row items-center overflow-hidden rounded-full border border-edge bg-elevated pr-4"
        style={{ height: 60, borderCurve: "continuous" }}
      >
        {/* Playing wash. Behind everything, ignoring touches. */}
        <Animated.View style={[{ position: "absolute", inset: 0 }, glowStyle]} pointerEvents="none">
          <LinearGradient
            colors={GLOW_COLORS}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={{ flex: 1 }}
          />
        </Animated.View>

        {/* Play / pause. A dark disc that reads the same in both pill states; the
            capsule changes colour, the control does not. On error it becomes the
            retry, so it never disappears. */}
        <Pressable
          onPress={() => {
            haptics.tap();
            playback.toggle();
          }}
          accessibilityRole="button"
          accessibilityLabel={state.playing ? "Pause" : state.phase === "error" ? "Try again" : "Play"}
          // A visibly raised disc, not near-black on near-black: bg-fill keeps
          // the control's form legible in the paused state, where the earlier
          // canvas-dark disc only appeared once the playing wash lit the pill.
          className="ml-[7px] items-center justify-center rounded-full border border-edge bg-fill"
          style={{ width: CONTROL_SIZE, height: CONTROL_SIZE }}
        >
          {({ pressed }) => (
            <View style={{ opacity: pressed ? 0.5 : 1 }}>
              {busy ? (
                <ActivityIndicator color={glyph} accessibilityLabel="Loading audio" />
              ) : state.playing ? (
                <PauseGlyph size={22} />
              ) : (
                <PlayGlyph size={22} />
              )}
            </View>
          )}
        </Pressable>

        {/* Waveform + scrubber, taking the flexible middle. On error the strip is
            replaced by the message; the disc above stays as the retry. */}
        <View className="ml-3 mr-3 flex-1">
          {state.error ? (
            <Text
              className="text-[12px] leading-[16px]"
              style={{ color: danger }}
              numberOfLines={2}
              maxFontSizeMultiplier={1.3}
            >
              {state.error}
            </Text>
          ) : (
            <WaveformScrubber playback={playback} seed={meeting.id} height={26} />
          )}
        </View>

        <Elapsed playback={playback} total={total} />
      </View>
    </View>
  );
}
