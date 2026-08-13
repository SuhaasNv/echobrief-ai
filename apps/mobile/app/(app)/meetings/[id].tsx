import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import { router, Stack, useLocalSearchParams } from "expo-router";

import { useMeetingDetail, type TranscriptSegment } from "@/lib/api/meeting-detail";
import { isProcessing } from "@/lib/api/meetings";
import { useMeetingPlayback } from "@/lib/audio/playback";
import { formatDuration, formatListDate } from "@/lib/format";
import { displayTitle } from "@/components/meetings/meeting-row";
import { haptics } from "@/lib/haptics";
import { SPRING, TIMING } from "@/lib/motion";
import { ribbonSpan } from "@/components/ribbon";
import { useFollowScroll } from "@/components/player/follow-scroll";
import { PlayerBar } from "@/components/player/player-bar";
import { RibbonScrubber } from "@/components/player/ribbon-scrubber";
import { MeetingMenuButton } from "@/components/meeting/meeting-menu";
import { ProcessingView } from "@/components/meeting/processing-view";
import { SummaryView } from "@/components/meeting/summary-view";
import { TranscriptView } from "@/components/meeting/transcript-view";

type Tab = "summary" | "transcript";

/** Legend swatches — mirrors SPEAKER_HEX in components/ribbon. */
const SPEAKER_DOT = [
  "bg-speaker-a",
  "bg-speaker-b",
  "bg-speaker-c",
  "bg-speaker-d",
  "bg-speaker-e",
] as const;

/**
 * Segmented control.
 *
 * The indicator moves with a spring rather than a timing curve so it tracks the
 * way UISegmentedControl does. chrome is critically damped — this is a
 * high-frequency control and any bounce becomes irritating by the tenth tap.
 */
function Segmented({ value, onChange }: { value: Tab; onChange: (t: Tab) => void }) {
  const tabs: { key: Tab; label: string }[] = [
    { key: "summary", label: "Summary" },
    { key: "transcript", label: "Transcript" },
  ];

  return (
    <View
      className="mx-4 mb-4 flex-row rounded-control bg-surface p-1"
      style={{ borderCurve: "continuous" }}
      accessibilityRole="tablist"
    >
      {tabs.map((tab) => {
        const active = tab.key === value;
        return (
          <Pressable
            key={tab.key}
            onPress={() => {
              if (active) return;
              haptics.select();
              onChange(tab.key);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            className="flex-1 items-center justify-center py-2"
            // py-2 around a 15pt line gave a ~36pt target, under the 44pt
            // minimum. Stated as a floor rather than as more padding so the
            // segment cannot fall back under it at a smaller Dynamic Type size.
            // Same fix as the Actions filter, which had the identical bug.
            style={{ minHeight: 44 }}
          >
            {active ? (
              <Animated.View
                // layout animation moves the fill between segments instead of
                // cross-fading two separate pills
                layout={LinearTransition.springify()
                  .damping(SPRING.chrome.damping)
                  .stiffness(SPRING.chrome.stiffness)}
                className="absolute inset-0 rounded-control bg-fill"
                style={{ borderCurve: "continuous" }}
              />
            ) : null}
            <Text
              className={`text-[15px] font-semibold ${
                active ? "text-label" : "text-label-secondary"
              }`}
              maxFontSizeMultiplier={1.4}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Stable empty identity, so the span memo does not recompute on every poll. */
const NO_SEGMENTS: TranscriptSegment[] = [];

export default function MeetingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: meeting, isLoading, isError } = useMeetingDetail(id);
  const [tab, setTab] = useState<Tab>("summary");

  /**
   * Playback.
   *
   * Both of these are external stores rather than React state, so nothing they
   * do re-renders this screen — which matters because this render includes the
   * whole transcript. See the notes in lib/audio/playback and
   * components/player/follow-scroll.
   *
   * Declared above the early returns because hooks cannot be conditional, and
   * fed defaults until the meeting arrives.
   */
  const segments = meeting?.transcript?.segments ?? NO_SEGMENTS;
  const span = useMemo(() => ribbonSpan(segments), [segments]);
  const playback = useMeetingPlayback({
    meetingId: id,
    hasAudio: meeting?.has_audio ?? false,
    durationSec: meeting?.duration_sec ?? null,
    ribbonOrigin: span?.origin ?? 0,
    ribbonSpan: span?.span ?? 0,
  });
  const follow = useFollowScroll({ hasPlayer: meeting?.has_audio ?? false });

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator accessibilityLabel="Loading meeting" />
      </View>
    );
  }

  if (isError || !meeting) {
    return (
      <View className="flex-1 items-center justify-center bg-background px-8">
        <Text className="text-center text-[17px] font-semibold text-label">
          This meeting is no longer available.
        </Text>
      </View>
    );
  }

  const meta = [
    formatListDate(meeting.recorded_at ?? meeting.created_at),
    formatDuration(meeting.duration_sec),
  ]
    .filter(Boolean)
    .join(" · ");

  const processing = isProcessing(meeting.status);
  const title = displayTitle(meeting.title);

  /**
   * Leave the screen as soon as the undo window opens.
   *
   * The request itself is deferred, so the meeting is still readable for a few
   * more seconds — but sitting on the detail view of something you just deleted,
   * watching it work, is not a state worth offering. The undo affordance is
   * waiting on the row in the list behind this screen.
   *
   * `canGoBack` because this route is reachable from a notification tap on a
   * cold start, where there is no list underneath and `back()` would do nothing.
   */
  const leaveAfterDelete = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(app)/meetings");
  };

  // The ribbon reads a CONVERSATION. With a single speaker it degenerates into
  // a plain bar that carries no information and looks like a stalled progress
  // indicator, so it only earns its place from two speakers up.
  const speakerCount = meeting.transcript?.speakers.length ?? 0;
  const showRibbon = speakerCount >= 2 && (meeting.transcript?.segments.length ?? 0) > 0;

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen
        options={{
          title,
          headerRight: () => (
            <MeetingMenuButton
              id={meeting.id}
              title={title}
              onDeleteScheduled={leaveAfterDelete}
            />
          ),
        }}
      />

      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        // Clears the floating player card and the tab bar beneath it, so the
        // last lines of a transcript are readable rather than parked under the
        // transport.
        contentContainerStyle={{ paddingBottom: follow.bottomInset }}
        {...follow.scrollProps}
      >
        <View className="gap-3 px-4 pb-4 pt-1">
          <Text
            className="text-[13px] text-label-secondary"
            style={{ fontVariant: ["tabular-nums"] }}
          >
            {meta}
          </Text>

          {/* The signature, at hero size. Only meaningful once diarization has
              produced segments, so it holds a placeholder bar while processing
              rather than disappearing and shifting the layout. */}
          {showRibbon ? (
            <View className="gap-2">
              {/* Scrubbable when there is audio, identical to before when there
                  is not. Dragging along the bands is the point of the feature:
                  the colours say WHO you are scrubbing to, which is the one
                  thing an amplitude waveform can never tell you. */}
              <RibbonScrubber
                playback={playback}
                segments={meeting.transcript?.segments ?? []}
                speakers={meeting.transcript?.speakers ?? []}
                height={28}
                radius={8}
              />
              {meeting.transcript?.speakers.length ? (
                <View className="flex-row flex-wrap gap-x-4 gap-y-1">
                  {meeting.transcript.speakers.map((s, i) => (
                    <View key={s.id} className="flex-row items-center gap-1.5">
                      <View
                        className={`h-2 w-2 rounded-full ${SPEAKER_DOT[i % SPEAKER_DOT.length]}`}
                      />
                      <Text className="text-[11px] text-label-secondary">{s.label}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}
        </View>

        {processing ? (
          <ProcessingView meeting={meeting} />
        ) : meeting.status === "failed" ? (
          <View className="mx-4 gap-2 rounded-card bg-surface p-5" style={{ borderCurve: "continuous" }}>
            <Text className="text-[17px] font-semibold text-danger">Processing failed</Text>
            {meeting.failure_reason ? (
              <Text className="text-[14px] leading-[20px] text-label-secondary" selectable>
                {meeting.failure_reason}
              </Text>
            ) : null}
          </View>
        ) : (
          <>
            <Segmented value={tab} onChange={setTab} />
            {/* Cross-fade between panes. Exiting is faster than entering — the
                universal rule; a slow exit reads as lag. */}
            <Animated.View
              key={tab}
              entering={FadeIn.duration(TIMING.crossfade.duration)}
              exiting={FadeOut.duration(120)}
            >
              {tab === "summary" ? (
                <SummaryView meeting={meeting} />
              ) : (
                <TranscriptView meeting={meeting} playback={playback} follow={follow} />
              )}
            </Animated.View>
          </>
        )}
      </ScrollView>

      {/* Renders nothing for a transcript-only meeting. A play button that
          cannot play is worse than no player at all. */}
      {processing ? null : <PlayerBar meeting={meeting} playback={playback} follow={follow} />}
    </View>
  );
}
