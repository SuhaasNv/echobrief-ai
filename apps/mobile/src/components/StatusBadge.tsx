import { Text, View } from "react-native";

import type { MeetingSummary } from "@/lib/api/meetings";

type Status = MeetingSummary["status"];

/**
 * Surfaces the four in-flight states as distinct labels rather than collapsing
 * them all to "Processing" as the web app does — the strings already exist
 * server-side and a phone user checking on a meeting wants to know which stage
 * it is at. Colour is never the only channel; the label always carries the
 * meaning.
 */
const LABEL: Record<Status, string> = {
  queued: "Queued",
  transcribing: "Transcribing",
  analyzing: "Analyzing",
  indexing: "Indexing",
  complete: "Ready",
  failed: "Failed",
};

const TONE: Record<Status, { text: string; bg: string }> = {
  queued: { text: "text-label-secondary", bg: "bg-fill" },
  transcribing: { text: "text-warning", bg: "bg-fill" },
  analyzing: { text: "text-warning", bg: "bg-fill" },
  indexing: { text: "text-warning", bg: "bg-fill" },
  complete: { text: "text-success", bg: "bg-fill" },
  failed: { text: "text-danger", bg: "bg-fill" },
};

export function StatusBadge({ status }: { status: Status }) {
  const tone = TONE[status];

  return (
    <View className={`shrink-0 rounded-full px-2 py-1 ${tone.bg}`}>
      <Text
        className={`text-[12px] font-semibold ${tone.text}`}
        // Past this the pill stops fitting next to a title.
        maxFontSizeMultiplier={1.4}
      >
        {LABEL[status]}
      </Text>
    </View>
  );
}
