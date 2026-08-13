import { useEffect } from "react";
import { Text, View } from "react-native";
import Animated, {
  ReduceMotion,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import type { MeetingSummary } from "@/lib/api/meetings";

type Status = MeetingSummary["status"];

/**
 * Surfaces the four in-flight stages as distinct labels rather than collapsing
 * them to "Processing" as the web does — a phone user checking on a meeting
 * wants to know which stage it reached.
 *
 * Three deliberate choices:
 *
 * - `complete` renders nothing. Showing a "Ready" chip on every finished row
 *   produces a column of identical pills in a library where most meetings are
 *   complete. iOS convention is to surface status only when it is NOT the
 *   steady state.
 * - The background is tinted per state, not a shared neutral fill. With one
 *   fill, transcribing/analyzing/indexing render pixel-identical and colour
 *   survives only in 12px text — the weakest possible channel. This also
 *   restores the web app's tinted-badge language.
 * - Work in progress is BLUE, not amber. Amber is the app's warning ramp, and a
 *   healthy meeting moving through the pipeline is not a warning; it read as
 *   "something is wrong with this recording" on every row that was merely busy.
 *   Blue matches the working state on the detail screen, so the same meeting
 *   does not change colour when you open it.
 *
 * Colour is never the sole carrier of meaning; the label always says it, and
 * the three moving stages carry a pulse the two static states do not.
 */
const LABEL: Record<Exclude<Status, "complete">, string> = {
  queued: "Queued",
  transcribing: "Transcribing",
  analyzing: "Analyzing",
  indexing: "Indexing",
  failed: "Failed",
};

interface Tone {
  text: string;
  bg: string;
  dot: string;
  /** Whether the machine is actually doing something right now. */
  live: boolean;
}

const TONE: Record<Exclude<Status, "complete">, Tone> = {
  // Queued is waiting, not working, so its dot holds still. A pulse here would
  // claim progress that is not being made.
  queued: { text: "text-label-secondary", bg: "bg-fill", dot: "bg-label-tertiary", live: false },
  transcribing: { text: "text-tint", bg: "bg-tint/15", dot: "bg-tint", live: true },
  analyzing: { text: "text-tint", bg: "bg-tint/15", dot: "bg-tint", live: true },
  indexing: { text: "text-tint", bg: "bg-tint/15", dot: "bg-tint", live: true },
  failed: { text: "text-danger", bg: "bg-danger/15", dot: "bg-danger", live: false },
};

/** Human status text for screen readers and row labels. Null in steady state. */
export function statusLabel(status: Status): string | null {
  return status === "complete" ? null : LABEL[status];
}

/**
 * The one moving part.
 *
 * A row whose meeting is being transcribed should look different from a row
 * that is merely sitting there, and opacity is the only channel that says
 * "still running" without moving layout or drawing the eye off the title.
 *
 * Stops dead under Reduce Motion: the label already carries the state, so the
 * pulse is decoration and decoration is exactly what that setting turns off.
 */
function PulseDot({ tone }: { tone: string }) {
  const reduceMotion = useReducedMotion();
  const pulse = useSharedValue(1);

  useEffect(() => {
    if (reduceMotion) {
      pulse.value = 1;
      return;
    }

    pulse.value = withRepeat(
      withTiming(0.2, { duration: 900, reduceMotion: ReduceMotion.System }),
      -1,
      true,
    );

    return () => {
      cancelAnimation(pulse);
      pulse.value = 1;
    };
  }, [pulse, reduceMotion]);

  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return <Animated.View className={`h-1.5 w-1.5 rounded-full ${tone}`} style={style} />;
}

export function StatusBadge({ status }: { status: Status }) {
  if (status === "complete") return null;

  const tone = TONE[status];

  return (
    <View
      className={`shrink-0 flex-row items-center gap-1.5 rounded-full px-2 py-1 ${tone.bg}`}
      style={{ borderCurve: "continuous" }}
    >
      {tone.live ? (
        <PulseDot tone={tone.dot} />
      ) : (
        <View className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
      )}
      <Text
        className={`text-[12px] font-semibold ${tone.text}`}
        // Past this the pill stops fitting beside a title.
        maxFontSizeMultiplier={1.4}
      >
        {LABEL[status]}
      </Text>
    </View>
  );
}
