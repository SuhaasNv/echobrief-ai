import { memo } from "react";
import { View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useDerivedValue,
  withTiming,
} from "react-native-reanimated";

import { TIMING } from "@/lib/motion";

/**
 * Live input waveform.
 *
 * Two implementation rules, both load-bearing:
 *
 * 1. Bars animate `transform: scaleY`, never `height`. Granola measured an
 *    animated-height visualiser at 60% CPU / 25% GPU on an M2; rebuilt as a
 *    transform it dropped to 6% / 6%. Height changes force layout every frame;
 *    transforms do not.
 *
 * 2. Geometry is 4pt bar / 2pt gap. That 2:1 ratio reads as dense audio; 1:1
 *    reads as a graphic equalizer, which is the wrong metaphor.
 *
 * The edge fade at both ends is what stops bars visibly popping into existence
 * at the leading edge as the window scrolls.
 */

const BAR_WIDTH = 4;
const BAR_GAP = 2;
const MIN_SCALE = 0.06;

const Bar = memo(function Bar({
  value,
  height,
  colorClass,
  fade,
}: {
  value: number;
  height: number;
  colorClass: string;
  /** 0..1 horizontal falloff applied at the strip's ends. */
  fade: number;
}) {
  // Timing rather than spring: a spring overshoots, and an audio meter that
  // reads above the actual input is lying about the signal.
  const scale = useDerivedValue(
    () => withTiming(Math.max(value, MIN_SCALE), TIMING.meter),
    [value],
  );

  const style = useAnimatedStyle(() => ({
    transform: [{ scaleY: scale.value }],
    opacity: fade,
  }));

  return (
    <Animated.View
      className={colorClass}
      style={[
        {
          width: BAR_WIDTH,
          height,
          borderRadius: BAR_WIDTH / 2,
        },
        style,
      ]}
    />
  );
});

interface LiveWaveformProps {
  /** Normalized levels 0..1, oldest first. */
  bars: number[];
  height?: number;
  colorClass?: string;
}

export function LiveWaveform({
  bars,
  height = 96,
  colorClass = "bg-label",
}: LiveWaveformProps) {
  const count = bars.length;
  // Fade the outer ~15% at each end.
  const fadeZone = Math.max(1, Math.floor(count * 0.15));

  return (
    <View
      className="flex-row items-center justify-center"
      style={{ height, gap: BAR_GAP }}
      accessibilityLabel="Input level"
      accessibilityRole="progressbar"
    >
      {bars.map((value, i) => {
        const distanceFromEdge = Math.min(i, count - 1 - i);
        const fade = Math.min(1, distanceFromEdge / fadeZone);
        return (
          <Bar
            key={i}
            value={value}
            height={height}
            colorClass={colorClass}
            fade={0.25 + fade * 0.75}
          />
        );
      })}
    </View>
  );
}
