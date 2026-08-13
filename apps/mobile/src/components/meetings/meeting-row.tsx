import { memo, useEffect } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";

import { percentForStatus } from "@/lib/api/meeting-status";
import { isProcessing, useMeetingDeletePending, type MeetingSummary } from "@/lib/api/meetings";
import { displayTitle, formatDuration, pluralize } from "@/lib/format";
import { haptics } from "@/lib/haptics";
import { SPRING, TIMING } from "@/lib/motion";
import { confirmDeleteMeeting } from "@/components/meeting/delete-meeting";
import { MeetingUndoVeil, SwipeToDelete } from "@/components/meeting/swipe-to-delete";
import { StatusBadge, statusLabel } from "@/components/status-badge";

/** Rows past the first screenful appear rather than animate, as cells do. */
const STAGGER_LIMIT = 8;
const STAGGER_STEP = 30;

/**
 * A figure, not a sentence.
 *
 * "12 min · 3 speakers · 4 tasks" is a string; the eye has to read it. Splitting
 * the digits out into the label weight and leaving the units tertiary turns the
 * same characters into three values you can scan down a column without reading,
 * which is the whole difference between a text block and an instrument readout.
 *
 * Doing it by regex rather than by structured fields keeps `formatDuration` the
 * single source of truth for how a length is worded — "1 hr 5 min" emphasises
 * both numerals with no special case.
 */
function Figure({ text }: { text: string }) {
  const parts = text.split(/(\d+)/).filter(Boolean);

  return (
    <Text
      className="text-[13px] text-label-tertiary"
      style={{ fontVariant: ["tabular-nums"] }}
      numberOfLines={1}
      maxFontSizeMultiplier={1.3}
    >
      {parts.map((part, i) =>
        /^\d+$/.test(part) ? (
          <Text key={i} className="font-semibold text-label">
            {part}
          </Text>
        ) : (
          part
        ),
      )}
    </Text>
  );
}

/**
 * The seam between the card's prose and its readout — and, while a meeting is
 * processing, the progress bar.
 *
 * It sits mid-card rather than at the bottom edge on purpose: a 2pt bar run
 * along a 16pt continuous corner gets visibly eaten by the radius at both ends.
 * Mid-card it spans edge to edge cleanly, and one line does two jobs.
 *
 * Transform, never width: animating width is a layout pass per frame, on a row
 * inside a scrolling list. Timing rather than a spring, because a spring
 * overshoots, and a bar that reports 92% then walks back to 85% destroys the
 * one thing it exists to provide. Reanimated resolves timing instantly under
 * Reduce Motion, which is right here: the motion is decoration, the value is
 * information.
 *
 * It also starts AT its value rather than at zero, so a row scrolled back into
 * view does not replay a sweep it already showed. Only a real stage change
 * moves it.
 */
function Seam({ status }: { status: MeetingSummary["status"] }) {
  const live = isProcessing(status);
  const target = percentForStatus(status) / 100;
  const progress = useSharedValue(live ? target : 0);

  useEffect(() => {
    if (!live) return;
    progress.value = withTiming(target, TIMING.progress);
  }, [live, target, progress]);

  // A full-width bar slid left by the remaining fraction and clipped by the
  // track. Anchoring by percentage translate rather than by scaleX with a
  // transform origin keeps the bar's own edge geometry intact and needs no
  // measured width.
  const fill = useAnimatedStyle(() => ({
    transform: [{ translateX: `${-(1 - progress.value) * 100}%` }],
  }));

  if (!live) return <View className="h-px bg-separator" />;

  return (
    <View className="h-[2px] overflow-hidden bg-fill">
      <Animated.View className="h-full w-full bg-tint" style={fill} />
    </View>
  );
}

/** First tag only, plus an overflow count. Tags are labels, not a taxonomy. */
/**
 * A search result's matched sentence, with the matched terms lifted.
 *
 * The server marks hits with [[…]] rather than HTML, deliberately: this feeds a
 * React Native list with no markup renderer, and shipping HTML to a Text node
 * would either render as literal tags or require a parser on the hot path of a
 * scrolling list.
 *
 * The lift is weight plus a step to primary label colour, not a yellow
 * background. A highlighter block in a dark instrument panel reads as a bug,
 * and colour alone would be invisible to anyone who cannot distinguish it.
 */
function MatchSnippet({ text }: { text: string }) {
  // Split on the marker, keeping the captured group, so odd indices are hits.
  const parts = text.split(/\[\[(.*?)\]\]/g);

  return (
    <Text className="text-[15px] leading-[21px] text-label-secondary" numberOfLines={2}>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <Text key={i} className="font-semibold text-label">
            {part}
          </Text>
        ) : (
          part
        ),
      )}
    </Text>
  );
}

function TagChip({ tags }: { tags: string[] }) {
  const first = tags[0];
  if (!first) return null;
  const extra = tags.length - 1;

  return (
    <View className="shrink-0 flex-row items-center gap-1">
      <View
        className="rounded-chip bg-fill px-1.5 py-0.5"
        style={{ borderCurve: "continuous", maxWidth: 120 }}
      >
        <Text
          className="text-[11px] text-label-secondary"
          numberOfLines={1}
          maxFontSizeMultiplier={1.3}
        >
          {first}
        </Text>
      </View>
      {extra > 0 ? (
        <Text
          className="text-[11px] text-label-tertiary"
          style={{ fontVariant: ["tabular-nums"] }}
          maxFontSizeMultiplier={1.3}
        >
          {`+${extra}`}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Memoised, like SegmentRow above it in the transcript.
 *
 * These rows live in a SectionList inside a screen that re-renders on every
 * poll, every search keystroke and every focus change. `meeting` keeps its
 * identity across a refetch that returns structurally identical data, so
 * without this a list of fifty rows re-rendered fifty swipe gestures, fifty
 * animated styles and fifty date formats to draw exactly what was already
 * there.
 */
export const MeetingRow = memo(function MeetingRow({
  meeting,
  time,
  index = 0,
}: {
  meeting: MeetingSummary;
  /** Time of day; the section header already carries the date. */
  time: string | null;
  /** Position down the whole list, for entrance stagger. */
  index?: number;
}) {
  const reduceMotion = useReducedMotion();
  const queryClient = useQueryClient();
  // Lifted out of SwipeToDelete when that component stopped being meetings-only.
  const deletePending = useMeetingDeletePending(meeting.id);

  // Cards scale on press; full-width list ROWS would not, but these are cards
  // sitting on a canvas, which is the case where scale reads correctly. The
  // veil rides with it so the readout strip — which has its own fill and would
  // otherwise stay dark while the body lit up — responds too.
  const pressed = useSharedValue(0);
  const pressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: reduceMotion ? 1 : 1 - pressed.value * 0.022 }],
  }));
  const veilStyle = useAnimatedStyle(() => ({ opacity: pressed.value * 0.05 }));

  const meta = [
    formatDuration(meeting.duration_sec),
    meeting.participant_count ? pluralize(meeting.participant_count, "speaker") : null,
    meeting.action_item_count ? pluralize(meeting.action_item_count, "task") : null,
  ].filter(Boolean) as string[];

  const title = displayTitle(meeting.title);
  const status = statusLabel(meeting.status);
  const tags = meeting.tags ?? [];
  const readout = meta.length > 0 || status !== null || tags.length > 0;
  const a11yLabel = [title, time, ...meta, status].filter(Boolean).join(", ");

  return (
    <SwipeToDelete
      title={title}
      pending={deletePending}
      undoOverlay={<MeetingUndoVeil id={meeting.id} title={title} />}
      onDelete={() => confirmDeleteMeeting({ id: meeting.id, title, queryClient })}
    >
      <Animated.View
        // Entrance only on first paint, never on scroll, and only for the rows
        // that are on screen when the list arrives — a page that loads at index 40
        // has been scrolled to, and cells that fade in under the finger read as
        // lag rather than polish.
        entering={
          reduceMotion || index >= STAGGER_LIMIT
            ? undefined
            : FadeInDown.duration(240).delay(index * STAGGER_STEP)
        }
        style={pressStyle}
      >
        <Pressable
          onPressIn={() => {
            pressed.value = withSpring(1, SPRING.pressIn);
          }}
          onPressOut={() => {
            pressed.value = withSpring(0, SPRING.pressOut);
          }}
          onPress={() => {
            haptics.select();
            router.push(`/(app)/meetings/${meeting.id}`);
          }}
          accessibilityRole="button"
          accessibilityLabel={a11yLabel}
          accessibilityHint="Opens the summary and transcript"
          // VoiceOver cannot perform the swipe, so the destructive action is
          // exposed through the rotor instead — the same place UIKit puts a
          // table row's swipe actions. It routes through the identical confirm.
          accessibilityActions={[{ name: "delete", label: "Delete" }]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName !== "delete") return;
            confirmDeleteMeeting({ id: meeting.id, title, queryClient });
          }}
          className="overflow-hidden rounded-card border border-edge bg-surface"
          style={{ borderCurve: "continuous" }}
        >
          {/* Light from above — turns the border into a bevel. */}
          <View className="absolute inset-x-0 top-0 z-10 h-px bg-highlight" pointerEvents="none" />

          <View className="gap-2 px-4 pb-3.5 pt-3.5">
            <View className="flex-row items-start gap-3">
              <Text
                className="flex-1 text-[17px] font-semibold text-label"
                numberOfLines={1}
                maxFontSizeMultiplier={1.6}
              >
                {title}
              </Text>
              {time ? (
                <Text
                  className="pt-0.5 text-[13px] text-label-tertiary"
                  style={{ fontVariant: ["tabular-nums"] }}
                  maxFontSizeMultiplier={1.4}
                >
                  {time}
                </Text>
              ) : null}
            </View>

            {/* A search hit shows the sentence it matched on, not the meeting's
                generic summary. Answering "why is this in my results" is the
                whole reason search over transcripts is worth having: without it
                a row that matched on something said 20 minutes in looks
                identical to one that matched on nothing. */}
            {meeting.match_snippet ? (
              <MatchSnippet text={meeting.match_snippet} />
            ) : meeting.summary_excerpt ? (
              <Text className="text-[15px] leading-[21px] text-label-secondary" numberOfLines={2}>
                {meeting.summary_excerpt}
              </Text>
            ) : null}
          </View>

          {/* Readout. Recessed below the card's own fill so the figures read as
              an instrument panel bolted to the bottom of the card rather than as
              one more line of the paragraph above. Suppressed entirely when there
              is nothing to report, rather than left as an empty dark band. */}
          {readout ? (
            <>
              <Seam status={meeting.status} />

              <View className="min-h-[38px] flex-row items-center gap-2.5 bg-inset px-4 py-2">
                {meta.length > 0 ? (
                  <View className="flex-1 flex-row items-center gap-2.5">
                    {meta.map((figure, i) => (
                      <View key={figure} className="shrink flex-row items-center gap-2.5">
                        {i > 0 ? <View className="h-2.5 w-px bg-separator" /> : null}
                        <Figure text={figure} />
                      </View>
                    ))}
                  </View>
                ) : (
                  <View className="flex-1" />
                )}

                {/* Steady state carries no chip; only the exceptions do. Tags take
                    the slot back once there is no status to report. */}
                {status ? <StatusBadge status={meeting.status} /> : <TagChip tags={tags} />}
              </View>
            </>
          ) : null}

          <Animated.View
            className="absolute inset-0 bg-label"
            style={veilStyle}
            pointerEvents="none"
          />
        </Pressable>
      </Animated.View>
    </SwipeToDelete>
  );
});
