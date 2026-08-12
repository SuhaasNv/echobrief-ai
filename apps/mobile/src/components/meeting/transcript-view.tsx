import { memo } from "react";
import { Text, View } from "react-native";

import type { MeetingDetail, TranscriptSegment } from "@/lib/api/meeting-detail";
import { speakerClass } from "@/lib/api/meeting-detail";
import { formatClock } from "@/lib/format";

interface SegmentRowProps {
  segment: TranscriptSegment;
  speakers: NonNullable<MeetingDetail["transcript"]>["speakers"];
  /** Repeating the name on every consecutive line from one speaker is noise. */
  showSpeaker: boolean;
}

const SegmentRow = memo(function SegmentRow({
  segment,
  speakers,
  showSpeaker,
}: SegmentRowProps) {
  const label =
    speakers.find((s) => s.id === segment.speaker)?.label ?? segment.speaker ?? "Speaker";

  return (
    <View className="flex-row gap-3">
      {/* Fixed-width mono gutter. Monospace is the app's "machine truth" signal,
          and tabular figures stop the column shimmering as rows recycle. */}
      <Text
        className="w-[52px] shrink-0 pt-px text-[13px] text-label-tertiary"
        style={{ fontVariant: ["tabular-nums"] }}
        maxFontSizeMultiplier={1.4}
      >
        {showSpeaker ? formatClock(segment.start_sec) : ""}
      </Text>

      <View className="flex-1 gap-1">
        {showSpeaker ? (
          <Text className={`text-[13px] font-semibold ${speakerClass(segment.speaker, speakers)}`}>
            {label}
          </Text>
        ) : null}
        {/* selectable: a transcript you cannot copy is not much use, and RN
            defaults Text to non-selectable — the opposite of the web. */}
        <Text className="text-[16px] leading-[24px] text-label" selectable>
          {segment.text}
        </Text>
      </View>
    </View>
  );
});

export function TranscriptView({ meeting }: { meeting: MeetingDetail }) {
  const transcript = meeting.transcript;

  if (!transcript || transcript.segments.length === 0) {
    return (
      <View className="px-8 py-16">
        <Text className="text-center text-[15px] text-label-tertiary">
          No transcript available for this meeting.
        </Text>
      </View>
    );
  }

  return (
    <View className="gap-5 px-4 pb-8">
      {transcript.segments.map((segment, i) => {
        const prev = transcript.segments[i - 1];
        return (
          <SegmentRow
            key={`${segment.start_sec}-${i}`}
            segment={segment}
            speakers={transcript.speakers}
            showSpeaker={!prev || prev.speaker !== segment.speaker}
          />
        );
      })}
    </View>
  );
}
