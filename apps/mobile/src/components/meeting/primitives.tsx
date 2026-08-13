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

/** Uppercase micro-eyebrow — the most portable piece of the web app's identity. */
export function Eyebrow({
  children,
  tone = "secondary",
}: {
  children: string;
  tone?: "secondary" | "tertiary";
}) {
  return (
    <Text
      className={`text-[11px] font-semibold uppercase ${
        tone === "secondary" ? "text-label-secondary" : "text-label-tertiary"
      }`}
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
 * The default fill is VIOLET, because the only meter on this screen that does
 * not name its own tone is the meeting score, and the meeting score is a
 * judgement the model made. Violet means "a model produced this" everywhere in
 * the app; it was blue here, which said "this navigates" about five bars that
 * navigate nowhere. Any meter measuring something the model did NOT produce —
 * the speaker-share bars, for one — passes its own tone.
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
        <Text className="text-center text-[14px] leading-[20px] text-label-tertiary">
          {detail}
        </Text>
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
