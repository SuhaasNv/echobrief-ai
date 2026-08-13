import { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";

import { PRESS_SCALE, SPRING } from "@/lib/motion";

/**
 * Press feedback for CARDS — objects sitting on the canvas, never full-width
 * list rows (a row that shrinks away from its own separators reads as a bug).
 *
 * Press-in is faster than press-out on purpose: the finger-down response has to
 * beat perceived latency, while the release can afford to settle.
 *
 * Reanimated's default reduceMotion is System, so both springs resolve
 * instantly under Reduce Motion without any branch here.
 */
export function usePressScale(scale: number = PRESS_SCALE) {
  const pressed = useSharedValue(0);

  const style = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressed.value * (1 - scale) }],
  }));

  return {
    style,
    onPressIn: () => {
      pressed.value = withSpring(1, SPRING.pressIn);
    },
    onPressOut: () => {
      pressed.value = withSpring(0, SPRING.pressOut);
    },
  };
}
