import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";

import type { MeetingDetail } from "@/lib/api/meeting-detail";
import {
  SKIP_BACK_SEC,
  SKIP_FORWARD_SEC,
  usePlaybackState,
  type PlaybackController,
} from "@/lib/audio/playback";
import { formatClock } from "@/lib/format";
import { haptics } from "@/lib/haptics";
import { useColorTokens } from "@/lib/tokens";

import { ChevronDownGlyph, PauseGlyph, PlayGlyph, SkipBackGlyph, SkipForwardGlyph } from "./glyphs";
import { useFollowState, type FollowScroll } from "./follow-scroll";
import {
  PLAYER_SCRUBBER_ROW,
  PLAYER_TAB_BAR_GAP,
  PLAYER_TRANSPORT_ROW,
  useTabBarTopEdge,
} from "./metrics";
import { RibbonScrubber } from "./ribbon-scrubber";

/**
 * The transport.
 *
 * Floats above the tab bar and shares its 16pt side margins, so the two read as
 * one block of chrome with a single content inset below them.
 *
 * TWO FIXED ROWS. A thin scrubber line — elapsed, the diarization ribbon, total —
 * over a transport row where skip-15 and skip-30 flank a 52pt play button.
 *
 * Skip is PERMANENT here, not hidden behind a disclosure chevron. The
 * tap-to-reveal band was the thing that read as clunky, and it was also what
 * grew the card by 44pt and parked the last line of the transcript underneath
 * it. A card that never changes height is the whole fix for both: the controls
 * are always where the thumb expects them, and the scroll inset below can
 * reserve the card exactly once.
 *
 * Skip is 15 back and 30 forward — the podcast convention, and not arbitrary:
 * you skip back to re-hear a sentence and forward to get past a stretch, and
 * those are different distances.
 *
 * This component subscribes to playback state; the meeting screen does not. That
 * is what keeps a play tap from re-rendering an 800-row transcript.
 */

/** Diameter of the primary control — the one filled element, so it reads as the hero. */
const PLAY_SIZE = 52;

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
 * formatClock has one second of resolution anyway.
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
        // beside it does not jump left when 9:59 becomes 10:00.
        minWidth: formatClock(total).length * DIGIT_ADVANCE,
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

const TOKENS = ["--label", "--label-quaternary"] as const;

export function PlayerBar({ meeting, playback, follow }: PlayerBarProps) {
  const state = usePlaybackState(playback);
  const followState = useFollowState(follow);
  // Transport colour for the two states this bar sets by hand: the skip pair
  // greys out with no audio to skip through, and the spinner replaces the play
  // glyph, so both need the value the glyphs would otherwise read themselves.
  const [glyph, glyphDim] = useColorTokens(TOKENS);
  // Sits on the tab bar. Six points of seam, measured from the bar's real top
  // edge rather than from an inset that counted it twice.
  const bottom = useTabBarTopEdge() + PLAYER_TAB_BAR_GAP;

  // A transcript-only meeting gets no transport at all. A play button that
  // cannot play is a bug report waiting to be filed.
  if (!meeting.has_audio) return null;

  const total = state.duration > 0 ? state.duration : (meeting.duration_sec ?? 0);
  const segments = meeting.transcript?.segments ?? [];
  const speakers = meeting.transcript?.speakers ?? [];
  const busy = state.phase === "loading" || state.buffering;
  const showJump = followState.canJump && !followState.following;
  const canSkip = total > 0;

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
        {/* Scrubber line. Position and length flank the ribbon, which reads as
            one fact — this much audio, this long — with the progress between
            them. On error this row carries the message instead; the play button
            below stays, as the retry. */}
        <View className="flex-row items-center gap-2.5 px-4" style={{ height: PLAYER_SCRUBBER_ROW }}>
          {state.error ? (
            <Text
              className="flex-1 text-[12px] leading-[16px] text-danger"
              numberOfLines={1}
              maxFontSizeMultiplier={1.3}
            >
              {state.error}
            </Text>
          ) : (
            <>
              <Elapsed playback={playback} total={total} />

              <View className="flex-1">
                <RibbonScrubber
                  playback={playback}
                  segments={segments}
                  speakers={speakers}
                  height={8}
                />
              </View>

              <Text
                className="text-[12px] text-label-secondary"
                style={{ fontVariant: ["tabular-nums"] }}
                maxFontSizeMultiplier={1.3}
              >
                {formatClock(total)}
              </Text>
            </>
          )}
        </View>

        {/* Transport. skip-15 · play/pause · skip-30, centred as one cluster.
            Skip greys out when there is nothing to skip through. */}
        <View
          className="flex-row items-center justify-center gap-8 px-4"
          style={{ height: PLAYER_TRANSPORT_ROW }}
        >
          <TransportButton
            onPress={() => playback.skip(-SKIP_BACK_SEC)}
            label={`Skip back ${SKIP_BACK_SEC} seconds`}
            disabled={!canSkip}
          >
            <SkipBackGlyph seconds={SKIP_BACK_SEC} color={canSkip ? glyph : glyphDim} />
          </TransportButton>

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
                  <ActivityIndicator color={glyph} accessibilityLabel="Loading audio" />
                ) : state.playing ? (
                  <PauseGlyph size={26} />
                ) : (
                  <PlayGlyph size={26} />
                )}
              </View>
            )}
          </Pressable>

          <TransportButton
            onPress={() => playback.skip(SKIP_FORWARD_SEC)}
            label={`Skip forward ${SKIP_FORWARD_SEC} seconds`}
            disabled={!canSkip}
          >
            <SkipForwardGlyph seconds={SKIP_FORWARD_SEC} color={canSkip ? glyph : glyphDim} />
          </TransportButton>
        </View>
      </View>
    </View>
  );
}
