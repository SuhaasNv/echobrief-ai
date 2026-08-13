import { useEffect } from "react";
import { Pressable, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";

import { SPRING, TIMING } from "@/lib/motion";

/**
 * The checkbox.
 *
 * Checking something off is the only moment of reward this screen has, so it is
 * built as an event rather than a state flip: the disc springs up from the
 * centre, and a beat later the checkmark DRAWS along its own path. Both are
 * cheap — a scale transform and a stroke dash offset, no layout, no shadow.
 *
 * Unchecking is deliberately not the same animation played backwards. It is a
 * correction, so it just clears: a fast fade-out with no spring and no haptic.
 *
 * Colours are the dark ramp from global.css. SVG stroke and fill take colour
 * values, not class names, and app.json pins the app to dark — same precedent
 * as HEX in components/meeting/processing-view.
 */
const HEX = {
  background: "#06070A",
  success: "#2FC183",
} as const;

const SIZE = 26;

/** Checkmark inside a 26x26 box, drawn short-arm first so it reads left to right. */
const CHECK_PATH = "M7 13.4 L11 17.2 L19 8.8";
/** Path length is ~17.1; the dash pattern rounds up so nothing peeks at rest. */
const CHECK_LENGTH = 18;

const DRAW = { duration: 200, easing: Easing.out(Easing.cubic) } as const;

const AnimatedPath = Animated.createAnimatedComponent(Path);

export function CheckRing({
  checked,
  overdue,
  onToggle,
  label,
}: {
  checked: boolean;
  /** Late items get a red ring. The row always says "overdue" in words too. */
  overdue: boolean;
  onToggle: () => void;
  /** Spoken by VoiceOver in place of the row's text. */
  label: string;
}) {
  const reduceMotion = useReducedMotion();

  const fill = useSharedValue(checked ? 1 : 0);
  const draw = useSharedValue(checked ? 1 : 0);
  const pressed = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      fill.value = checked ? 1 : 0;
      draw.value = checked ? 1 : 0;
      return;
    }

    if (checked) {
      fill.value = withSpring(1, SPRING.bouncy);
      draw.value = withDelay(70, withTiming(1, DRAW));
    } else {
      fill.value = withTiming(0, TIMING.instant);
      draw.value = withTiming(0, TIMING.instant);
    }
  }, [checked, reduceMotion, fill, draw]);

  const fillStyle = useAnimatedStyle(() => ({
    opacity: fill.value,
    transform: [{ scale: fill.value }],
  }));

  const pressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressed.value * 0.12 }],
  }));

  const checkProps = useAnimatedProps(() => ({
    strokeDashoffset: CHECK_LENGTH * (1 - draw.value),
  }));

  return (
    <Pressable
      onPressIn={() => {
        pressed.value = withSpring(1, SPRING.pressIn);
      }}
      onPressOut={() => {
        pressed.value = withSpring(0, SPRING.pressOut);
      }}
      onPress={onToggle}
      // A 26pt target is below the 44pt minimum on its own.
      hitSlop={14}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      accessibilityHint={checked ? "Marks this as not done" : "Marks this as done"}
    >
      <Animated.View
        style={[{ width: SIZE, height: SIZE }, pressStyle]}
        // Clipped so the spring's overshoot stays inside the ring instead of
        // bulging a pixel past the border at the top of its arc.
        className={`items-center justify-center overflow-hidden rounded-full border-2 ${
          checked ? "border-success" : overdue ? "border-danger" : "border-label-tertiary"
        }`}
      >
        <Animated.View
          className="absolute inset-0 rounded-full bg-success"
          style={fillStyle}
          pointerEvents="none"
        />
        <View className="absolute inset-0" pointerEvents="none">
          <Svg width={SIZE} height={SIZE}>
            <AnimatedPath
              d={CHECK_PATH}
              stroke={HEX.background}
              strokeWidth={2.6}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
              strokeDasharray={CHECK_LENGTH}
              animatedProps={checkProps}
            />
          </Svg>
        </View>
      </Animated.View>
    </Pressable>
  );
}

/**
 * The same mark, static and oversized, for the all-clear empty state.
 *
 * A drawn seal rather than an illustration: it is the shape the user has just
 * been tapping, so an empty list reads as the sum of that work.
 */
export function CheckSeal({ size = 56 }: { size?: number }) {
  const scale = size / SIZE;

  return (
    <View
      className="items-center justify-center rounded-full border-2 border-success/40"
      style={{ width: size, height: size }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width={SIZE * scale} height={SIZE * scale} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        <Path
          d={CHECK_PATH}
          stroke={HEX.success}
          strokeWidth={2.4}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </Svg>
    </View>
  );
}
