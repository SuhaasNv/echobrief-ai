import { Text, View } from "react-native";

import type { MeetingSummary } from "@/lib/api/meetings";

type Status = MeetingSummary["status"];

/**
 * Surfaces the four in-flight stages as distinct labels rather than collapsing
 * them to "Processing" as the web does — a phone user checking on a meeting
 * wants to know which stage it reached.
 *
 * Two deliberate choices:
 *
 * - `complete` renders nothing. Showing a "Ready" chip on every finished row
 *   produces a column of identical pills in a library where most meetings are
 *   complete. iOS convention is to surface status only when it is NOT the
 *   steady state.
 * - The background is tinted per state, not a shared neutral fill. With one
 *   fill, transcribing/analyzing/indexing render pixel-identical and colour
 *   survives only in 12px text — the weakest possible channel. This also
 *   restores the web app's tinted-badge language.
 *
 * Colour is never the sole carrier of meaning; the label always says it.
 */
const LABEL: Record<Exclude<Status, "complete">, string> = {
  queued: "Queued",
  transcribing: "Transcribing",
  analyzing: "Analyzing",
  indexing: "Indexing",
  failed: "Failed",
};

const TONE: Record<Exclude<Status, "complete">, { text: string; bg: string }> = {
  queued: { text: "text-label-secondary", bg: "bg-fill" },
  transcribing: { text: "text-warning", bg: "bg-warning/15" },
  analyzing: { text: "text-warning", bg: "bg-warning/15" },
  indexing: { text: "text-warning", bg: "bg-warning/15" },
  failed: { text: "text-danger", bg: "bg-danger/15" },
};

export function StatusBadge({ status }: { status: Status }) {
  if (status === "complete") return null;

  const tone = TONE[status];
  const label = LABEL[status];

  return (
    <View className={`shrink-0 rounded-full px-2 py-1 ${tone.bg}`}>
      <Text
        className={`text-[12px] font-semibold ${tone.text}`}
        // Past this the pill stops fitting beside a title.
        maxFontSizeMultiplier={1.4}
      >
        {label}
      </Text>
    </View>
  );
}
