import { useEffect } from "react";
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
 * Loading placeholder for the library.
 *
 * Shape-matched rather than a spinner, and the shape is not a generic grey
 * rectangle: it is this screen's own anatomy — bento header, section heading,
 * then cards with a title line, two lines of excerpt, and the recessed readout
 * strip. The point is that nothing moves when the real data lands. A centred
 * spinner tells you to wait; this tells you what you are waiting for, and it
 * means the first paint does not jump the scroll position.
 *
 * One opacity loop drives the whole group. Per-bar shimmer would be six
 * animations racing each other, and a diagonal sweep gradient is the web
 * idiom — iOS placeholders breathe.
 */

const PULSE_MS = 850;

function Bar({
  width,
  height = 12,
  className = "",
}: {
  width: DimensionValue;
  height?: number;
  className?: string;
}) {
  return (
    <View className={`rounded-full bg-fill ${className}`} style={{ width, height }} />
  );
}

function CardSkeleton() {
  return (
    <View
      className="overflow-hidden rounded-card border border-edge bg-surface"
      style={{ borderCurve: "continuous" }}
    >
      <View className="absolute inset-x-0 top-0 z-10 h-px bg-highlight" pointerEvents="none" />

      <View className="gap-2.5 px-4 pb-3.5 pt-4">
        <View className="flex-row items-center gap-3">
          <Bar width="58%" height={14} />
          <View className="flex-1" />
          <Bar width={38} height={11} />
        </View>
        <Bar width="100%" height={11} />
        <Bar width="76%" height={11} />
      </View>

      <View className="h-px bg-separator" />

      <View className="min-h-[38px] flex-row items-center gap-2.5 bg-inset px-4 py-2">
        <Bar width={46} height={10} />
        <View className="h-2.5 w-px bg-separator" />
        <Bar width={62} height={10} />
        <View className="h-2.5 w-px bg-separator" />
        <Bar width={42} height={10} />
      </View>
    </View>
  );
}

function StatHeaderSkeleton() {
  return (
    <View
      className="mx-4 mb-5 flex-row overflow-hidden rounded-card border border-edge bg-edge"
      style={{ borderCurve: "continuous", gap: 1 }}
    >
      <View className="absolute inset-x-0 top-0 z-10 h-px bg-highlight" pointerEvents="none" />
      {[0, 1, 2].map((i) => (
        <View key={i} className="flex-1 gap-3 bg-surface p-4">
          <Bar width={44} height={8} />
          <Bar width={36} height={22} className="rounded-chip" />
        </View>
      ))}
    </View>
  );
}

export function MeetingsSkeleton({
  rows = 4,
  header = true,
  heading = true,
}: {
  rows?: number;
  /** Suppressed while searching, where no stat header is shown either. */
  header?: boolean;
  /** Suppressed when appended below real sections, which have their own. */
  heading?: boolean;
}) {
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
      // One announcement for the whole screen; the bars themselves are noise.
      accessible
      accessibilityLabel="Loading meetings"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
    >
      {header ? <StatHeaderSkeleton /> : null}

      {heading ? (
        <View className="px-4 pb-2.5 pt-1">
          <Bar width={78} height={14} />
        </View>
      ) : null}

      <View className="gap-2.5 px-4">
        {Array.from({ length: rows }, (_, i) => (
          <CardSkeleton key={i} />
        ))}
      </View>
    </Animated.View>
  );
}
