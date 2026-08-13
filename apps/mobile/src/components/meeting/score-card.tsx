import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

import type { MeetingScore } from "@/lib/api/meeting-detail";

import { Eyebrow, Meter, Rule, SectionCard } from "./primitives";

/**
 * Meeting score — the anchor of the screen.
 *
 * This is the only place the app makes a judgement rather than a transcription,
 * so it gets the largest numeral and the top of the stack. The five sub-scores
 * sit underneath as a compact readout: label, meter, figure. Read as a column
 * they say which part of the meeting cost you the points, which the single
 * total never can.
 *
 * Deliberately NOT a radar/pentagon chart. Five spokes at phone width are
 * unreadable, the enclosed area is not a meaningful quantity, and it is a
 * generic analytics tic. Bars share one baseline and one scale, so they are
 * comparable at a glance and legible at 5pt tall.
 */

type MetricKey = "participation" | "actionability" | "focus" | "clarity" | "efficiency";

const METRICS: readonly { key: MetricKey; label: string }[] = [
  { key: "participation", label: "Participation" },
  { key: "actionability", label: "Actionability" },
  { key: "focus", label: "Focus" },
  { key: "clarity", label: "Clarity" },
  { key: "efficiency", label: "Efficiency" },
];

/**
 * Sub-scores have historically been emitted on both a 0-10 and a 0-100 scale by
 * different model revisions. Rather than trust either, infer from the data and
 * render everything on the total's scale, so a 0-100 payload can never draw
 * five full meters next to a total of 6.8.
 */
function scaleFor(score: MeetingScore): number {
  const values = METRICS.map((m) => score[m.key]).filter((v) => Number.isFinite(v));
  const max = Math.max(0, ...values, Number.isFinite(score.total) ? score.total : 0);
  return max > 10 ? 100 : 10;
}

/**
 * Count-up.
 *
 * Driven on the JS thread on purpose: this animates TEXT, which no transform
 * can express, and it is deliberately isolated in this leaf so a frame only
 * re-renders one Text node rather than the card. Tabular figures and a fixed
 * one-decimal format keep the numeral's width constant, so nothing reflows
 * while it counts.
 *
 * Identical rounded values bail out of setState, which cuts a 900ms run from
 * roughly 54 renders to at most one per tenth actually crossed.
 */
function useCountUp(target: number, enabled: boolean, duration = 900): number {
  const [value, setValue] = useState(() => (enabled ? 0 : target));

  useEffect(() => {
    if (!enabled) {
      setValue(target);
      return;
    }

    let frame = 0;
    const started = Date.now();

    const step = () => {
      const t = Math.min(1, (Date.now() - started) / duration);
      // Out-cubic: fast off the mark, settles rather than stops.
      const next = Math.round(target * (1 - Math.pow(1 - t, 3)) * 10) / 10;
      setValue((prev) => (prev === next ? prev : next));
      if (t < 1) frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, enabled, duration]);

  return value;
}

function ScoreNumeral({ total, animate }: { total: number; animate: boolean }) {
  const reduceMotion = useReducedMotion();
  const value = useCountUp(total, animate && !reduceMotion);

  return (
    <Text
      // Uniwind resolves className AFTER inline style, so the display face has
      // to come from the class or it silently falls back to system.
      // Violet, not --label. The score is the single clearest instance of "a
      // model produced this" in the product, and at 54px it is the biggest
      // numeral in the app — so it is the one place the accent buys the most
      // presence for the least noise.
      className="font-display text-[54px] leading-[58px] text-violet"
      style={{ fontVariant: ["tabular-nums"] }}
      maxFontSizeMultiplier={1.3}
    >
      {value.toFixed(1)}
    </Text>
  );
}

function MetricRow({
  label,
  value,
  animate,
  index,
}: {
  label: string;
  /** Already normalised to 0-10. */
  value: number;
  animate: boolean;
  index: number;
}) {
  return (
    <View
      className="flex-row items-center gap-3"
      accessible
      accessibilityLabel={`${label}, ${value.toFixed(1)} out of 10`}
    >
      {/* Wide enough for PARTICIPATION and ACTIONABILITY at 11pt with the
          0.8 tracking these micro-labels carry; both are 13 characters. */}
      <View className="w-[112px]">
        <Eyebrow tone="tertiary">{label}</Eyebrow>
      </View>

      <View className="flex-1">
        {/* Staggered by row so the readout sweeps up the column once, the way an
            instrument settles, instead of five bars snapping together.

            The fill is Meter's default violet, on purpose: these five bars are
            the model's judgement of the meeting, and violet is the app's mark
            for model output. They were blue, which is the navigation colour —
            five of the loudest blue elements in the product, none of them
            leading anywhere. */}
        <Meter value={value / 10} animate={animate} delay={index * 55} height={5} />
      </View>

      <Text
        className="w-[30px] text-right text-[13px] font-medium text-label-secondary"
        style={{ fontVariant: ["tabular-nums"] }}
        maxFontSizeMultiplier={1.3}
      >
        {value.toFixed(1)}
      </Text>
    </View>
  );
}

export function ScoreCard({
  score,
  animate,
  index = 0,
}: {
  score: MeetingScore;
  /** First view of this meeting: run the count-up and fill the meters. */
  animate: boolean;
  index?: number;
}) {
  const total = Number.isFinite(score.total) ? Math.max(0, Math.min(score.total, 10)) : 0;
  const scale = scaleFor(score);

  const rows = METRICS.flatMap(({ key, label }) => {
    const raw = score[key];
    if (!Number.isFinite(raw)) return [];
    return [{ key, label, value: Math.max(0, Math.min((raw / scale) * 10, 10)) }];
  });

  const explanation = score.explanation?.trim();

  return (
    <SectionCard animate={animate} index={index}>
      <Eyebrow>Meeting score</Eyebrow>

      <View
        className="flex-row items-end gap-1.5"
        accessible
        // The count-up must never be read mid-flight; VoiceOver gets the result.
        accessibilityLabel={`Meeting score ${total.toFixed(1)} out of 10`}
      >
        <ScoreNumeral total={total} animate={animate} />
        <Text className="pb-2 text-[17px] text-label-tertiary" maxFontSizeMultiplier={1.3}>
          / 10
        </Text>
      </View>

      {rows.length > 0 ? (
        <>
          <Rule />
          <View className="gap-2.5">
            {rows.map((row, i) => (
              <MetricRow
                key={row.key}
                label={row.label}
                value={row.value}
                animate={animate}
                index={i}
              />
            ))}
          </View>
        </>
      ) : null}

      {explanation ? (
        <>
          <Rule />
          <Text className="text-[15px] leading-[21px] text-label-secondary" selectable>
            {explanation}
          </Text>
        </>
      ) : null}
    </SectionCard>
  );
}
