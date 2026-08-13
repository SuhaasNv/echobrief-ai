import { useEffect } from "react";
import { Text, View } from "react-native";
import Animated, {
  Easing,
  FadeInDown,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";

import { Card } from "@/components/card";

/**
 * Shared furniture for the meeting detail panes.
 *
 * Everything here exists in more than one place on this screen; nothing is
 * extracted speculatively.
 */

/**
 * CARD TITLE. 15pt semibold, sentence case.
 *
 * This was an 11pt uppercase micro-eyebrow, and so was RowLabel below it — one
 * component doing both jobs. Measured off a render, "MEETING SCORE" (a card
 * title) and "PARTICIPATION" (a row label INSIDE that card) both came out at
 * 8.3pt cap height. Two hierarchy ranks, one type style: you could not tell
 * which was which without reading the words and inferring rank from meaning.
 *
 * That was also the app's biggest typographic gap. The scale ran 12 / ~17 / ~20
 * / 56pt with nothing between 20 and 56, and 12pt carried three different jobs.
 * Promoting card titles fills the hole and gives the densest screen a readable
 * skeleton — you can now skim the stack by its headings.
 *
 * Sentence case, not uppercase: at 15pt, uppercase with letterspacing reads as a
 * label rather than a heading, and these ARE headings. The uppercase treatment
 * stays where it belongs — on RowLabel, one rank down.
 */
export function Eyebrow({
  children,
  tone = "secondary",
}: {
  children: string;
  /** `tertiary` survives for callers that want a quieter heading. */
  tone?: "secondary" | "tertiary";
}) {
  return (
    <Text
      className={`text-[15px] font-semibold ${
        tone === "secondary" ? "text-label" : "text-label-secondary"
      }`}
      maxFontSizeMultiplier={1.4}
      numberOfLines={1}
    >
      {children}
    </Text>
  );
}

/**
 * ROW LABEL, one rank below a card title. 11pt uppercase, letterspaced.
 *
 * This is the treatment Eyebrow used to have, kept for the place it was always
 * right: labels for rows INSIDE a card, where they must sit under the card's own
 * heading rather than compete with it.
 */
export function RowLabel({ children }: { children: string }) {
  return (
    <Text
      className="text-[11px] font-semibold uppercase text-label-tertiary"
      style={{ letterSpacing: 0.8 }}
      maxFontSizeMultiplier={1.4}
      numberOfLines={1}
    >
      {children}
    </Text>
  );
}

/**
 * Section card.
 *
 * Entrance motion is first-view only and never re-runs on scroll. The web app's
 * whileInView reveal is deliberately not ported (see lib/motion) — this fires
 * once, when the analysis is first shown, and the stagger caps quickly so the
 * card stack assembles rather than crawling in. Reduce Motion removes it
 * entirely, which is Reanimated's default for layout animations and is stated
 * explicitly here so it survives a refactor.
 */
export function SectionCard({
  children,
  animate = false,
  index = 0,
  className = "",
}: {
  children: React.ReactNode;
  animate?: boolean;
  index?: number;
  className?: string;
}) {
  return (
    <Animated.View
      entering={
        animate
          ? FadeInDown.duration(300)
              .delay(Math.min(index * 40, 240))
              .reduceMotion(ReduceMotion.System)
          : undefined
      }
    >
      <Card className={`gap-3 p-5 ${className}`}>{children}</Card>
    </Animated.View>
  );
}

/** Hairline rule inside a card, for separating a readout from its prose. */
export function Rule() {
  return <View className="h-px bg-separator" />;
}

const METER_TIMING = { duration: 620, easing: Easing.out(Easing.cubic) } as const;

/**
 * Horizontal meter.
 *
 * Fills with scaleX from a left origin, never by animating width. An earlier
 * height-animated visualiser in this app measured 60% CPU against 6% once it
 * was rebuilt as a transform; the same rule applies to width. The track is a
 * fixed-width View, so the layout never moves and the row cannot reflow.
 *
 * The default fill is VIOLET — "a model produced this", which is what violet
 * means everywhere in the app. It was blue once, which said "this navigates"
 * about bars that navigate nowhere.
 *
 * That default is now a fallback rather than the common case: the score card's
 * five metric bars used to take it, which made ACTIONABILITY 2.0 render
 * identically to FOCUS 9.0 and hid the weak dimension the card exists to
 * surface. They now pass a tone banded by value (danger / warning / success).
 * The violet hero numeral is what carries "a model judged this" on that screen.
 */
export function Meter({
  value,
  tone = "bg-violet",
  animate = false,
  delay = 0,
  height = 6,
}: {
  /** 0..1. Clamped. */
  value: number;
  /** Tailwind background class for the fill. Violet is model output. */
  tone?: string;
  animate?: boolean;
  delay?: number;
  height?: number;
}) {
  const reduceMotion = useReducedMotion();
  // A meter that reads zero is indistinguishable from a broken meter, so a
  // non-zero score always leaves a visible sliver.
  const target = value > 0 ? Math.max(Math.min(value, 1), 0.02) : 0;
  const run = animate && !reduceMotion;

  const fill = useSharedValue(run ? 0 : target);

  useEffect(() => {
    if (!run) {
      fill.value = target;
      return;
    }
    fill.value = withDelay(
      delay,
      withTiming(target, { ...METER_TIMING, reduceMotion: ReduceMotion.System }),
    );
  }, [run, target, delay, fill]);

  const style = useAnimatedStyle(() => ({ transform: [{ scaleX: fill.value }] }));

  return (
    <View
      className="overflow-hidden rounded-full bg-fill"
      style={{ height }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Animated.View
        className={`h-full w-full rounded-full ${tone}`}
        style={[{ transformOrigin: "left center" }, style]}
      />
    </View>
  );
}

/**
 * Whole-pane empty state.
 *
 * Centred and quiet. It always says what is missing AND why, because "No
 * transcript available" alone reads as a failure the user caused.
 */
export function EmptyPane({ title, detail }: { title: string; detail?: string }) {
  return (
    <View className="items-center gap-2 px-8 py-16">
      <Text className="text-center text-[17px] font-semibold text-label">{title}</Text>
      {detail ? (
        <Text className="text-center text-[14px] leading-[20px] text-label-tertiary">{detail}</Text>
      ) : null}
    </View>
  );
}

/**
 * Inline notice for a partial result — one part of the analysis is missing
 * while the rest is fine. Deliberately not styled as an error: a missing
 * section is a gap, not a fault.
 */
export function Notice({ title, detail }: { title: string; detail?: string }) {
  return (
    <Card className="gap-1.5 p-5">
      <Text className="text-[15px] font-semibold text-label">{title}</Text>
      {detail ? (
        <Text className="text-[14px] leading-[20px] text-label-secondary">{detail}</Text>
      ) : null}
    </Card>
  );
}
