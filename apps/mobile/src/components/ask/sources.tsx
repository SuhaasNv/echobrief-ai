import { Pressable, ScrollView, Text, View } from "react-native";
import Animated, { FadeInDown, useReducedMotion } from "react-native-reanimated";
import { router } from "expo-router";

import type { SearchCitation } from "@/lib/api/search";
import { formatClock, pluralize } from "@/lib/format";
import { haptics } from "@/lib/haptics";
import { EyebrowRow } from "./eyebrow";
import { usePressScale } from "./press-scale";

const CARD_WIDTH = 244;
const CARD_GAP = 10;
/** Matches the screen's horizontal content padding. */
const EDGE = 16;

/**
 * A single retrieved passage.
 *
 * Leads with the meeting name and the moment inside it. The legacy pattern is a
 * numbered marker — "[3]" — which tells the reader nothing about whether to
 * trust the sentence it is attached to. A source is only useful if it says
 * WHICH conversation and WHEN, so that is what the card leads with; the excerpt
 * is the evidence, and it comes third.
 *
 * The timestamp is tabular-nums rather than a monospace face: SF's tabular
 * figures are already fixed-width, and swapping the whole face for a mono one
 * would put a second typeface on a 13pt label for no legibility gain.
 */
function SourceCard({ citation, index }: { citation: SearchCitation; index: number }) {
  const reduceMotion = useReducedMotion();
  const press = usePressScale();

  const span =
    citation.end_sec > citation.start_sec
      ? `${formatClock(citation.start_sec)} – ${formatClock(citation.end_sec)}`
      : formatClock(citation.start_sec);

  return (
    <Animated.View
      // Cards assemble left to right, capped so a ten-source rail does not
      // crawl in. Entrance only; the rail never re-animates on scroll.
      entering={
        reduceMotion ? undefined : FadeInDown.duration(300).delay(Math.min(index * 40, 200))
      }
      style={press.style}
    >
      <Pressable
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        onPress={() => {
          haptics.select();
          router.push(`/(app)/meetings/${citation.meeting_id}`);
        }}
        accessibilityRole="button"
        accessibilityLabel={`${citation.meeting_title}, ${span}. ${citation.excerpt}`}
        accessibilityHint="Opens the meeting this came from"
        className="h-full overflow-hidden rounded-card border border-edge bg-surface p-4 active:bg-elevated"
        style={{ width: CARD_WIDTH, borderCurve: "continuous" }}
      >
        <View className="absolute inset-x-0 top-0 h-px bg-highlight" pointerEvents="none" />

        <View className="gap-2">
          <Text className="text-[15px] font-semibold leading-[20px] text-label" numberOfLines={2}>
            {citation.meeting_title}
          </Text>

          {/* Blue: this is the navigational half of the card — tapping goes to
              that meeting. */}
          <Text
            className="text-[13px] text-tint"
            style={{ fontVariant: ["tabular-nums"] }}
            numberOfLines={1}
            maxFontSizeMultiplier={1.4}
          >
            {span}
          </Text>

          <Text
            className="text-[13px] leading-[19px] text-label-secondary"
            numberOfLines={4}
          >
            {citation.excerpt}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

/**
 * The sources rail.
 *
 * Rendered BEFORE the answer, because it is available before the answer: the
 * citations land in a response header while the model is still composing. The
 * screen therefore fills top-down in the order the data actually arrives, and
 * the user has something real to read during the wait.
 *
 * Full-bleed — it escapes the screen's 16pt gutter and pads itself instead, so
 * the last card is visibly clipped by the screen edge. That clipping is the
 * only honest signal that the rail scrolls.
 */
export function SourcesRail({ citations }: { citations: SearchCitation[] }) {
  if (citations.length === 0) return null;

  const meetings = new Set(citations.map((c) => c.meeting_id)).size;

  return (
    <View className="gap-2.5">
      <EyebrowRow
        label="Sources"
        trailing={`${pluralize(citations.length, "passage")} · ${pluralize(meetings, "meeting")}`}
      />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        snapToInterval={CARD_WIDTH + CARD_GAP}
        snapToAlignment="start"
        // Cards stretch to the tallest in the row, so a two-line title never
        // leaves a short card sitting in a ragged rail.
        contentContainerStyle={{
          gap: CARD_GAP,
          paddingHorizontal: EDGE,
          alignItems: "stretch",
        }}
        style={{ marginHorizontal: -EDGE }}
      >
        {citations.map((citation, i) => (
          <SourceCard key={`${citation.meeting_id}-${citation.start_sec}-${i}`} citation={citation} index={i} />
        ))}
      </ScrollView>
    </View>
  );
}
