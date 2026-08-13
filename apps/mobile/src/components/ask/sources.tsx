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
 * Floor for every card, so a one-line source sits level with a four-line one.
 *
 * This replaces `alignItems: "stretch"` on the rail's content container, which
 * looked like it did the same job and did something very different. The rail is
 * HORIZONTAL, so its cross axis is vertical, and `stretch` there does not mean
 * "match the tallest sibling" — it means "fill the container". Inside the
 * screen's vertical ScrollView that container has no bounded height, so a
 * single source card grew to roughly 900pt: three lines of text at the top of a
 * near-full-screen box.
 *
 * That was also why the screen barely scrolled. A 900pt horizontal ScrollView
 * covers nearly the whole viewport, so almost every vertical drag began inside
 * it and had to be handed up to the outer scroll view before anything moved —
 * which is what "I have to keep holding it" is.
 *
 * A fixed floor works because the card's height is already bounded: every text
 * line count is capped (title 2, timestamp 1, excerpt 4), so the tallest a card
 * can be at the default text size is 40 + 18 + 76 line + 16 gaps + 32 padding
 * = 182. Setting the floor to that maximum makes every card identical without
 * any dependence on the container. Above the default text size cards may grow
 * past it and the rail can go ragged again — a far better failure than a card
 * that eats the screen.
 */
const CARD_MIN_HEIGHT = 182;

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
        // Not h-full. Combined with the rail's old `alignItems: "stretch"` that
        // made the card fill an unbounded parent — see CARD_MIN_HEIGHT.
        className="overflow-hidden rounded-card border border-edge bg-surface p-4 active:bg-elevated"
        style={{ width: CARD_WIDTH, minHeight: CARD_MIN_HEIGHT, borderCurve: "continuous" }}
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

          <Text className="text-[13px] leading-[19px] text-label-secondary" numberOfLines={4}>
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
        // No alignItems here. Evenness comes from CARD_MIN_HEIGHT on the card
        // itself; `stretch` on a horizontal rail means "fill the container",
        // not "match the tallest sibling", and read the note on that constant
        // before putting it back.
        contentContainerStyle={{ gap: CARD_GAP, paddingHorizontal: EDGE }}
        style={{ marginHorizontal: -EDGE }}
      >
        {citations.map((citation, i) => (
          <SourceCard
            key={`${citation.meeting_id}-${citation.start_sec}-${i}`}
            citation={citation}
            index={i}
          />
        ))}
      </ScrollView>
    </View>
  );
}
