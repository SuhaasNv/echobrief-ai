import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import { Stack, useLocalSearchParams } from "expo-router";

import { useMeetingDetail } from "@/lib/api/meeting-detail";
import { isProcessing } from "@/lib/api/meetings";
import { formatDuration, formatListDate } from "@/lib/format";
import { haptics } from "@/lib/haptics";
import { SPRING, TIMING } from "@/lib/motion";
import { SummaryView } from "@/components/meeting/summary-view";
import { TranscriptView } from "@/components/meeting/transcript-view";

type Tab = "summary" | "transcript";

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

function ProcessingBody({ status }: { status: string }) {
  const LABEL: Record<string, string> = {
    queued: "Queued — waiting for a free worker",
    transcribing: "Transcribing audio",
    analyzing: "Extracting summary and action items",
    indexing: "Indexing for search",
  };

  return (
    <Animated.View entering={FadeIn.duration(TIMING.crossfade.duration)} className="px-8 py-20">
      <ActivityIndicator />
      <Text className="mt-4 text-center text-[17px] font-semibold text-label">
        {LABEL[status] ?? "Processing"}
      </Text>
      <Text className="mt-2 text-center text-[15px] text-label-secondary">
        You can close the app — we&apos;ll keep working.
      </Text>
    </Animated.View>
  );
}

export default function MeetingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: meeting, isLoading, isError } = useMeetingDetail(id);
  const [tab, setTab] = useState<Tab>("summary");

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

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ title: meeting.title }} />

      <ScrollView contentInsetAdjustmentBehavior="automatic">
        <View className="px-4 pb-4 pt-1">
          <Text className="text-[13px] text-label-secondary" style={{ fontVariant: ["tabular-nums"] }}>
            {meta}
          </Text>
        </View>

        {processing ? (
          <ProcessingBody status={meeting.status} />
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
                <TranscriptView meeting={meeting} />
              )}
            </Animated.View>
          </>
        )}
      </ScrollView>
    </View>
  );
}
