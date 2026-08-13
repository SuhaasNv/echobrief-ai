import { useEffect, type ReactNode } from "react";
import { View, type DimensionValue } from "react-native";
import Animated, {
  ReduceMotion,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

/**
 * Loading placeholders for settings.
 *
 * Same reasoning as components/meetings/skeleton: a placeholder shaped like the
 * thing that is coming means nothing jumps when it lands, and it is the only
 * way a LOADING state reads as different from an ERROR state at a glance. The
 * identity card is the first thing on the Account screen, so an empty card with
 * "Your account" in it was indistinguishable from a real signed-in card that
 * had simply failed to fetch.
 */

const PULSE_MS = 850;

/** One opacity loop for a whole group. Per-bar shimmer is six racing animations. */
export function Pulse({ children, label }: { children: ReactNode; label: string }) {
  const reduceMotion = useReducedMotion();
  const pulse = useSharedValue(1);

  useEffect(() => {
    if (reduceMotion) {
      // Held below full opacity so a still placeholder still reads as absent
      // content rather than as real, empty rows.
      pulse.value = 0.75;
      return;
    }

    pulse.value = withRepeat(
      withTiming(0.5, { duration: PULSE_MS, reduceMotion: ReduceMotion.System }),
      -1,
      true,
    );

    return () => {
      cancelAnimation(pulse);
      pulse.value = 1;
    };
  }, [pulse, reduceMotion]);

  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View
      style={style}
      accessible
      accessibilityLabel={label}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
    >
      {children}
    </Animated.View>
  );
}

export function Bar({
  width,
  height = 12,
  className = "",
}: {
  width: DimensionValue;
  height?: number;
  className?: string;
}) {
  return <View className={`rounded-full bg-fill ${className}`} style={{ width, height }} />;
}

/** Matches the identity card's own anatomy: 60pt avatar, name, address, chip. */
export function IdentityCardSkeleton() {
  return (
    <Pulse label="Loading your account">
      <View
        className="mx-4 overflow-hidden rounded-card border border-edge bg-surface"
        style={{ borderCurve: "continuous" }}
      >
        <View className="absolute inset-x-0 top-0 z-10 h-px bg-highlight" pointerEvents="none" />

        <View className="flex-row items-center gap-4 p-4">
          <View className="h-[60px] w-[60px] rounded-full bg-fill" />

          <View className="flex-1 gap-2">
            <Bar width="62%" height={17} />
            <Bar width="80%" height={12} />
            <Bar width={54} height={16} className="mt-0.5 rounded-chip" />
          </View>
        </View>
      </View>
    </Pulse>
  );
}
