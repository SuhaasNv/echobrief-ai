import { useEffect, useMemo } from "react";
import { View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";

import { Ribbon } from "@/components/ribbon";
import type { Speaker, TranscriptSegment } from "@/lib/api/meeting-detail";

/**
 * The paywall hero: a stack of speaker ribbons that draw themselves in.
 *
 * Chosen over the obvious options — an icon grid, a phone mockup, a stock
 * gradient — because it is the one image no competitor can make. The ribbon is
 * this app's signature: a conversation rendered as coloured bands, who spoke
 * and when, readable at a glance. Otter would have to draw a transcript wall
 * and Granola a page of notes. Putting it at the top of the upgrade screen says
 * what the product is before a word of copy is read.
 *
 * It is also honest about what is being sold. Each row is a meeting; the stack
 * growing is a library accumulating, which is exactly what Pro exists to keep.
 *
 * Synthetic segments, deliberately. The hero must look identical for a user
 * with one recording and a user with two hundred — a paywall whose artwork
 * depends on the data of the person who has not paid yet would be blank for
 * precisely the new user it most needs to convince.
 */

/**
 * Four voices, not five.
 *
 * --speaker-e is #63728f, a deliberately muted slate: correct as the fifth
 * voice in a real diarization, where it has to stay distinguishable without
 * competing, but wrong in artwork. Rendered here it read as a dead grey band —
 * the same colour the ribbon uses for UNKNOWN — so the hero looked like it had
 * failed to identify someone. A through D are the vivid four.
 */
const SPEAKERS: Speaker[] = ["A", "B", "C", "D"].map((id) => ({
  id,
  label: `Speaker ${id}`,
  talk_time_sec: 0,
  word_count: 0,
}));

/**
 * Deterministic band layouts.
 *
 * Fixed rather than random: the artwork is the same every time the screen is
 * opened, which is what makes it feel designed rather than generated. Speaker
 * RUNS of uneven length, for the same reason the seed fixture uses them — strict
 * alternation draws a barcode, and a barcode is not a conversation.
 */
const ROWS: Array<Array<[speaker: string, weight: number]>> = [
  [
    ["A", 3],
    ["B", 2],
    ["A", 1],
    ["C", 4],
    ["B", 2],
    ["A", 3],
  ],
  [
    ["C", 2],
    ["A", 5],
    ["D", 2],
    ["A", 1],
    ["B", 3],
  ],
  [
    ["B", 4],
    ["D", 1],
    ["A", 2],
    ["C", 3],
    ["A", 2],
    ["D", 2],
  ],
  [
    ["A", 2],
    ["C", 1],
    ["B", 6],
    ["A", 2],
    ["C", 2],
  ],
];

/** Turn a weighted layout into the segment shape Ribbon already understands. */
function toSegments(row: Array<[string, number]>): TranscriptSegment[] {
  let t = 0;
  return row.map(([speaker, weight]) => {
    const start = t;
    t += weight * 10;
    return { speaker, start_sec: start, end_sec: t, text: "" };
  });
}

/**
 * One row, wiped in from the left.
 *
 * A width animation would re-lay-out the SVG on every frame; this scales a
 * clipping wrapper instead, so the whole reveal stays on the UI thread. Rows
 * start slightly transparent and settle, which stops the last row appearing to
 * pop in after the others have finished.
 */
function Row({ row, index, reduceMotion }: { row: number; index: number; reduceMotion: boolean }) {
  const segments = useMemo(() => toSegments(ROWS[row]!), [row]);
  const reveal = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    if (reduceMotion) {
      reveal.value = 1;
      return;
    }
    reveal.value = withDelay(
      // Staggered downward so the eye is led through the stack rather than
      // shown four things at once.
      120 + index * 110,
      withTiming(1, { duration: 620, easing: Easing.out(Easing.cubic) }),
    );
  }, [index, reduceMotion, reveal]);

  const style = useAnimatedStyle(() => ({
    opacity: 0.35 + reveal.value * 0.65,
    transform: [{ scaleX: reveal.value }],
  }));

  return (
    <Animated.View style={[{ transformOrigin: "left" }, style]}>
      <Ribbon segments={segments} speakers={SPEAKERS} height={14} radius={5} />
    </Animated.View>
  );
}

export function PaywallHero({ rows = ROWS.length }: { rows?: number }) {
  const reduceMotion = useReducedMotion();

  return (
    <View className="gap-2.5" pointerEvents="none" accessibilityElementsHidden>
      {Array.from({ length: Math.min(rows, ROWS.length) }, (_, i) => (
        <Row key={i} row={i} index={i} reduceMotion={reduceMotion} />
      ))}
    </View>
  );
}
