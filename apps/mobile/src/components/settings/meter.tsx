import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { TIMING } from "@/lib/motion";

/**
 * Usage meter.
 *
 * The rule this is built around: the bar must never lie in either direction.
 *
 * A previous version floored the fill at 2% so it was always visible, which
 * meant an account that had used nothing still showed a sliver of blue —
 * reporting usage that had not happened. Zero now renders as zero. The floor
 * survives only for a genuinely non-zero value too small to see, where the
 * alternative is showing "3 of 300" above an empty track.
 *
 * At the other end, a full meter fills the track edge to edge and the caption
 * says "Limit reached" in words. Colour never carries it alone.
 *
 * That end state is AMBER, not red, and exactly one element carries it. A Free
 * account sitting on the quota its plan includes has done nothing wrong: it has
 * used what it is entitled to. Painting the bar, the figure, and the caption all
 * in --danger put six red elements on a healthy account's plan screen and spent
 * the app's error colour on a normal condition — which is what makes red mean
 * nothing when something is genuinely broken. The bar is the single accent; the
 * figure and the caption stay on --label-secondary and let the words do it.
 *
 * The fill animates with scaleX, not width: a width animation is a layout
 * animation, and it runs on the JS thread. The bar's laid-out width is already
 * the true value, so even if the animation never ran the reading would be right.
 */

const TRACK_HEIGHT = 6;
const COUNT_UP_MS = 460;

/**
 * Count a number up to its value.
 *
 * Text content, not an animated style — Reanimated cannot drive Text children,
 * and routing it through an AnimatedTextInput to avoid four setState calls per
 * frame for half a second is not a trade worth making.
 */
function useCountUp(target: number, enabled: boolean): number {
  const [display, setDisplay] = useState(enabled ? 0 : target);
  const from = useRef(0);

  useEffect(() => {
    if (!enabled) {
      from.current = target;
      setDisplay(target);
      return;
    }

    const start = Date.now();
    const origin = from.current;
    let frame = 0;

    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / COUNT_UP_MS);
      // Ease out cubic — fast to most of the value, then settles.
      const eased = 1 - (1 - t) ** 3;
      const value = Math.round(origin + (target - origin) * eased);

      setDisplay(value);
      from.current = value;

      if (t < 1) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, enabled]);

  return display;
}

export function UsageMeter({
  label,
  used,
  limit,
  unit,
}: {
  label: string;
  used: number;
  /** null or negative means the plan does not cap this. */
  limit: number | null;
  /** Trailing noun: "min", "questions". */
  unit?: string;
}) {
  const reduceMotion = useReducedMotion();
  const unlimited = limit === null || limit < 0;

  const fraction = unlimited
    ? 0
    : limit === 0
      ? used > 0
        ? 1
        : 0
      : Math.min(1, Math.max(0, used / limit));

  const atLimit = !unlimited && fraction >= 1;
  const nearLimit = !unlimited && !atLimit && fraction >= 0.9;

  const displayed = useCountUp(used, !reduceMotion);

  // Zero is zero. The floor only rescues a real but tiny value from rounding
  // down to an invisible sliver.
  const target = fraction === 0 ? 0 : Math.max(fraction, 0.03);

  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = reduceMotion ? target : withTiming(target, TIMING.progress);
  }, [target, reduceMotion, progress]);

  const fillStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: progress.value }],
  }));

  const caption = unlimited
    ? "Unlimited"
    : `${displayed} of ${limit}${unit ? ` ${unit}` : ""}`;

  return (
    <View
      className="gap-2 px-4 py-3.5"
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={
        unlimited ? { text: "Unlimited" } : { min: 0, max: limit ?? 0, now: used }
      }
    >
      <View className="flex-row items-baseline justify-between gap-3">
        <Text className="text-[17px] text-label" maxFontSizeMultiplier={1.6}>
          {label}
        </Text>
        <Text
          className="text-[15px] text-label-secondary"
          style={{ fontVariant: ["tabular-nums"] }}
          numberOfLines={1}
          maxFontSizeMultiplier={1.6}
        >
          {caption}
        </Text>
      </View>

      {!unlimited ? (
        <>
          <View
            className="overflow-hidden rounded-full bg-inset"
            style={{ height: TRACK_HEIGHT }}
          >
            {/* Full width, scaled down to the true fraction. The track's own
                radius clips the fill, so a meter at its limit fills the pill
                edge to edge with no gap left at the end.

                Amber at AND near the limit; --danger is not spent here. Amber
                on --inset measures 10.09:1. The two states are told apart by
                the caption's words and by the bar's own length, not by hue. */}
            <Animated.View
              className={`h-full w-full ${atLimit || nearLimit ? "bg-warning" : "bg-tint"}`}
              style={[{ transformOrigin: "left" }, fillStyle]}
            />
          </View>

          {atLimit || nearLimit ? (
            <Text
              className="text-[13px] text-label-secondary"
              maxFontSizeMultiplier={1.8}
            >
              {atLimit ? "Limit reached for this period." : "Close to this period's limit."}
            </Text>
          ) : null}
        </>
      ) : null}
    </View>
  );
}
