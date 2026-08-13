import { Text, View } from "react-native";

import { isProcessing, type MeetingSummary } from "@/lib/api/meetings";
import { pluralize } from "@/lib/format";

/**
 * Bento stat header.
 *
 * Structural, not decorative: the library screen previously opened straight
 * into a list, so it had no anchor and no sense of accumulation. A row of
 * figures gives the screen a top-weight and turns "some meetings" into "what
 * you have built up".
 *
 * The seams are revealed background rather than borders — a gap-px grid over a
 * darker container. That trick is the most distinctive structural idea in the
 * web app's design language, and it ports directly.
 */

/**
 * A stat tile.
 *
 * `tone` exists because these three numerals are the boldest typographic moment
 * in the app and all three were --label, on a screen that is otherwise entirely
 * neutral. They are the cheapest place in the product to spend colour: no new
 * hue, no new meaning, just the accents already in the system given some area.
 * Captured stays white — it is the count of everything, so it is the baseline
 * the other two are read against.
 */
function Tile({
  label,
  value,
  unit,
  tone = "text-label",
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: string;
}) {
  return (
    <View className="flex-1 gap-3 bg-surface p-4">
      <Text
        className="text-[11px] font-semibold uppercase text-label-tertiary"
        style={{ letterSpacing: 0.8 }}
        maxFontSizeMultiplier={1.3}
        numberOfLines={1}
      >
        {label}
      </Text>
      <View className="flex-row items-baseline gap-1">
        <Text
          className={`font-display text-[30px] leading-[32px] ${tone}`}
          // Proportional figures, deliberately, and this is the fix for "11".
          //
          // `tabular-nums` maps `one` to `one.tf`, a slab-footed form whose foot
          // bar spans nearly the full 620 advance. Two of them side by side left
          // 3.5pt between the bars at 30px, so the feet read as one continuous
          // rule and the pair fused into a single mark. Adding letterSpacing
          // bought 1pt and did not solve it, because the problem is the glyph,
          // not the gap.
          //
          // Tabular figures exist to keep digits aligned ACROSS ROWS. These three
          // tiles are a flex-row of independent readouts, so there is no column
          // to align and nothing is lost by using the proportional `one`, which
          // carries normal sidebearings.
          //
          // The usual cost of dropping tnum is that a value changing width
          // shifts its own layout. It does not apply here: the tile is a
          // stretch-aligned column and this row is `items-baseline` with no
          // justify, so the numeral is flush left and 6 -> 16 -> 116 grows
          // rightward into the tile's own padding. Nothing else moves. If this
          // is ever centred or right-aligned, tnum has to come back, and with it
          // a non-slab `one` alternate or a pinned width.
          style={{ letterSpacing: 0.5 }}
          maxFontSizeMultiplier={1.3}
        >
          {value}
        </Text>
        {unit ? (
          <Text className="text-[13px] text-label-tertiary" maxFontSizeMultiplier={1.3}>
            {unit}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export function StatHeader({
  meetings,
  /** Library size from the API, which is larger than what is loaded so far. */
  total,
}: {
  meetings: MeetingSummary[];
  total?: number;
}) {
  const complete = meetings.filter((m) => m.status === "complete");
  const processing = meetings.filter((m) => isProcessing(m.status)).length;

  const totalSeconds = complete.reduce((sum, m) => sum + (m.duration_sec ?? 0), 0);
  const totalMinutes = Math.round(totalSeconds / 60);
  const tasks = complete.reduce((sum, m) => sum + (m.action_item_count ?? 0), 0);

  /**
   * Seconds below a minute, so a new library is not reported as empty.
   *
   * This rounded to whole minutes at every scale, so a first recording of 40
   * seconds rendered as "RECORDED 0 min" — the account's entire contents shown
   * as nothing, 130pt above a card that correctly said "under a minute" about
   * the same recording. Every user's first session hit it, and a stat tile that
   * reads zero when the thing it counts exists undermines the two tiles beside
   * it.
   *
   * Three bands rather than two: seconds under a minute, minutes under an hour,
   * hours above. The unit is a separate string because the Tile renders it in a
   * lighter weight beside the figure.
   */
  const durationValue =
    totalSeconds > 0 && totalSeconds < 60
      ? String(totalSeconds)
      : totalMinutes >= 60
        ? (totalMinutes / 60).toFixed(1)
        : String(totalMinutes);
  const durationUnit =
    totalSeconds > 0 && totalSeconds < 60 ? "sec" : totalMinutes >= 60 ? "hrs" : "min";

  // Counts what the library holds, not what happens to be paged in — the tile
  // is a claim about the account, and it visibly climbing as you scroll would
  // make every figure beside it suspect.
  const captured = total ?? meetings.length;

  return (
    <View className="mx-4 mb-5 gap-2">
      <View
        className="flex-row overflow-hidden rounded-card border border-edge bg-edge"
        style={{ borderCurve: "continuous", gap: 1 }}
      >
        {/* Top highlight spans the whole group so it reads as one object. */}
        <View className="absolute inset-x-0 top-0 z-10 h-px bg-highlight" pointerEvents="none" />
        <Tile label="Captured" value={String(captured)} />
        {/* No tone. --speaker-d is #E6AC3D, the same amber as --warning, and
            amber means "at limit" everywhere else in this app — the Plan
            screen's usage bar. On a duration with no threshold it read as a
            warning about a recording cap that does not exist. */}
        <Tile label="Recorded" value={durationValue} unit={durationUnit} />
        <Tile label="Tasks" value={String(tasks)} tone="text-tint" />
      </View>

      {/* Reconciles the tiles with the list: Recorded and Tasks can only count
          meetings that have finished, so without this line a freshly uploaded
          recording looks like it was dropped. */}
      {processing > 0 ? (
        <Text
          className="px-1 text-[13px] text-label-tertiary"
          style={{ fontVariant: ["tabular-nums"] }}
          maxFontSizeMultiplier={1.4}
        >
          {`${pluralize(processing, "meeting")} still processing`}
        </Text>
      ) : null}
    </View>
  );
}
