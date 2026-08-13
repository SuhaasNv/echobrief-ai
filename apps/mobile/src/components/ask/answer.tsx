import { useEffect } from "react";
import { Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { Eyebrow } from "./eyebrow";

/**
 * Streaming caret.
 *
 * An inline view inside the Text, so it sits at the true tail of the last line
 * wherever that falls — appending a separate row below would put the caret on
 * its own line every time the last line is short, which reads as a stray mark
 * rather than a cursor.
 *
 * Opacity only. The blink must never touch layout: this element is inside a
 * text node that regrows several times a second, and anything that changes its
 * measured size would re-flow the whole paragraph on the blink clock as well as
 * the token clock.
 */
function Caret() {
  const reduceMotion = useReducedMotion();
  const blink = useSharedValue(1);

  useEffect(() => {
    if (reduceMotion) return;

    blink.value = withRepeat(
      // 520ms each way is close to a text cursor's cadence. Faster reads as an
      // error state; slower reads as something that has stalled.
      withTiming(0.12, { duration: 520, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [blink, reduceMotion]);

  const style = useAnimatedStyle(() => ({ opacity: blink.value }));

  return (
    <Animated.View
      className="rounded-full bg-violet"
      // Inline views in text need explicit dimensions. translateY drops it onto
      // the baseline instead of hanging off the ascender.
      style={[{ width: 2, height: 17, marginLeft: 3, transform: [{ translateY: 3 }] }, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}

/** The provenance dot. Pulses only while tokens are still arriving. */
function ModelDot({ live }: { live: boolean }) {
  const reduceMotion = useReducedMotion();
  const pulse = useSharedValue(1);

  useEffect(() => {
    if (reduceMotion || !live) {
      pulse.value = withTiming(1, { duration: 160 });
      return;
    }

    pulse.value = withRepeat(withTiming(0.3, { duration: 760 }), -1, true);
  }, [pulse, live, reduceMotion]);

  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return <Animated.View className="h-1.5 w-1.5 rounded-full bg-violet" style={style} />;
}

interface AnswerCardProps {
  answer: string;
  streaming: boolean;
}

/**
 * The answer.
 *
 * A raised card rather than loose body text, so the model's output is a
 * distinct object on the page and not something the reader has to work out the
 * provenance of. Violet — the dot, the eyebrow, the caret — appears here and
 * nowhere else on the screen: in this palette it means "the model produced
 * this", and spending it on chrome would make that unreadable.
 *
 * Deliberately NOT layout-animated. The container grows as tokens land, and any
 * LinearTransition on it would re-run a spring on every flush, turning a
 * settled paragraph into a wobbling one.
 */
export function AnswerCard({ answer, streaming }: AnswerCardProps) {
  return (
    <View
      className="overflow-hidden rounded-card border border-edge bg-surface p-5"
      style={{ borderCurve: "continuous" }}
    >
      <View className="absolute inset-x-0 top-0 h-px bg-highlight" pointerEvents="none" />

      <View className="gap-3">
        <View className="flex-row items-center gap-2">
          <ModelDot live={streaming} />
          <Eyebrow tone="violet">Answer</Eyebrow>
        </View>

        {/* selectable, because the first thing anyone does with a good answer is
            copy it into somewhere else. */}
        <Text className="text-[17px] leading-[26px] text-label" selectable>
          {answer}
          {streaming ? <Caret /> : null}
        </Text>
      </View>
    </View>
  );
}
