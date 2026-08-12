import { useEffect, useMemo } from "react";
import { View } from "react-native";
import Animated, {
  Extrapolation,
  ReduceMotion,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import { TIMING } from "@/lib/motion";

/**
 * Dot-matrix waveform — the app's signature visual.
 *
 * One device covering three jobs, so recording, playback, and ambient
 * backgrounds all speak the same visual language:
 *
 *   mode="ambient"  slow drifting idle state (sign-in, empty states)
 *   mode="live"     driven by `level` (0..1) from the recorder's meter
 *   mode="static"   renders fixed `amplitudes` (playback scrubber)
 *
 * Built from Views rather than SVG or Skia: at this dot count the layout cost
 * is trivial, it adds no dependency, and every dot animates on the UI thread.
 *
 * Unlit dots are the active colour at low opacity rather than a second colour,
 * so the lit/unlit transition is a single interpolation.
 */

export type WaveformMode = "ambient" | "live" | "static";

interface DotProps {
  /** Distance from the vertical centre of the column, 0 at the middle row. */
  fromCentre: number;
  /** Phase offset for this column, which is what makes the wave travel. */
  offset: number;
  phase: SharedValue<number>;
  amplitude: number;
  mode: WaveformMode;
  size: number;
  colorClass: string;
}

function Dot({ fromCentre, offset, phase, amplitude, mode, size, colorClass }: DotProps) {
  const style = useAnimatedStyle(() => {
    // Ambient drifts on its own clock; live and static are amplitude-driven.
    const wave = mode === "ambient" ? (Math.sin(phase.value + offset) + 1) / 2 : amplitude;

    // A dot lights once the wave reaches its distance from the centre, so the
    // column fills outward from the middle like a level meter.
    const lit = wave >= fromCentre * 0.92;

    return {
      opacity: lit
        ? interpolate(wave - fromCentre, [0, 0.5], [0.55, 1], Extrapolation.CLAMP)
        : 0.12,
    };
  });

  return (
    <Animated.View
      className={colorClass}
      style={[{ width: size, height: size, borderRadius: size / 2 }, style]}
      // Decorative — the surrounding control carries the accessible label.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}

interface WaveformProps {
  mode?: WaveformMode;
  /** Current input level 0..1. Used when mode="live". */
  level?: number;
  /** Fixed per-column amplitudes 0..1. Used when mode="static". */
  amplitudes?: number[];
  columns?: number;
  /** Dots per column. Odd numbers centre cleanly. */
  rows?: number;
  dotSize?: number;
  gap?: number;
  colorClass?: string;
}

export function Waveform({
  mode = "ambient",
  level = 0,
  amplitudes,
  columns = 28,
  rows = 9,
  dotSize = 3,
  gap = 4,
  colorClass = "bg-tint",
}: WaveformProps) {
  const phase = useSharedValue(0);

  useEffect(() => {
    if (mode !== "ambient") return;
    // Slow enough to read as ambient rather than busy. Under Reduce Motion the
    // wave holds its position instead of animating.
    phase.value = withRepeat(
      withTiming(Math.PI * 2, {
        duration: 4200,
        easing: TIMING.crossfade.easing,
        reduceMotion: ReduceMotion.System,
      }),
      -1,
      false,
    );
  }, [mode, phase]);

  const columnAmplitudes = useMemo(() => {
    if (mode === "static" && amplitudes?.length) {
      // Resample the supplied amplitudes to the column count.
      return Array.from({ length: columns }, (_, i) => {
        const src = amplitudes[Math.floor((i / columns) * amplitudes.length)];
        return Math.max(0, Math.min(1, src ?? 0));
      });
    }
    if (mode === "live") {
      // Slight per-column variation so a steady input still looks alive.
      return Array.from({ length: columns }, (_, i) =>
        Math.max(0, Math.min(1, level * (0.85 + 0.15 * Math.sin(i * 1.7)))),
      );
    }
    return Array.from({ length: columns }, () => 0);
  }, [mode, amplitudes, columns, level]);

  const centre = (rows - 1) / 2;

  return (
    <View className="flex-row items-center justify-center" style={{ gap }}>
      {Array.from({ length: columns }).map((_, col) => (
        <View key={col} style={{ gap }}>
          {Array.from({ length: rows }).map((_, row) => (
            <Dot
              key={row}
              fromCentre={Math.abs(row - centre) / centre}
              offset={(col / columns) * Math.PI * 2}
              phase={phase}
              amplitude={columnAmplitudes[col] ?? 0}
              mode={mode}
              size={dotSize}
              colorClass={colorClass}
            />
          ))}
        </View>
      ))}
    </View>
  );
}
