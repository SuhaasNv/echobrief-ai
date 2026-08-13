import { useEffect } from "react";
import { Text, View } from "react-native";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedProps,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
  type SharedValue,
  type WithTimingConfig,
} from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";

import { TIMING } from "@/lib/motion";
import { useColorToken } from "@/lib/tokens";

/**
 * A determinate ring with a rolling odometer at its centre.
 *
 * Shared because a recording meets it twice — once while it uploads, once while
 * it is transcribed and analysed — and those used to be two unrelated screens:
 * a stock ActivityIndicator with a bare percentage, then this. Two progress
 * languages back to back made one continuous wait look like two failures.
 *
 * Extracted verbatim from components/meeting/processing-view.tsx, where all of
 * the geometry below was measured against renders rather than derived. The only
 * thing added in the move is `sweep`, because the two callers sample at wildly
 * different rates — see TIMING.ringSweep and TIMING.uploadSweep in lib/motion.
 *
 * ---
 *
 * The readout COUNTS, rather than cutting — one column per digit.
 *
 * The ring and the number are the same fact, so they move as one, off the same
 * shared value. Earlier this was a single field whose whole string was rewritten
 * as the value climbed, which made "30" become "60" by swapping both characters
 * at once. Digits that change together read as a value being REPLACED. Digits
 * that roll independently read as a value being COUNTED, which is what is
 * actually happening — and the ones column spinning while the tens crawls is
 * the entire reason an odometer feels alive.
 *
 * Each column is a 0-9 strip translated by the digit's own continuous position,
 * so a column is mid-roll between two glyphs rather than snapping at integers.
 * All of it runs on the UI thread: no per-frame setState, and this subtree does
 * not re-render while counting.
 */

/**
 * Unrun portion of the ring.
 *
 * The one colour here with no token behind it. --fill (#1C1E28) is the nearest
 * and is not the same value, and a 12pt ring track is not a surface, so
 * promoting it into the palette would put a value there that only this control
 * can use. Stated here, next to the reason for it.
 *
 * Everything else reads from global.css. SVG stroke takes a colour rather than
 * a class name, which is why any of this reaches JS at all.
 */
const RING_TRACK = "#1C1F25";

const RING_SIZE = 176;
const RING_STROKE = 12;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** Line box of one digit. Matches the 46px face's leading. */
const DIGIT_HEIGHT = 50;
/**
 * Column width.
 *
 * Space Grotesk's tabular figures advance 0.62em, so 46px is ~28.5. Rounded up
 * to 30 for a little air: at 46px two adjacent "1"s in this face have foot bars
 * that visually fuse into one continuous mark, which is the bug that took the
 * stat tiles off tabular figures. Here the columns are separate boxes, so the
 * gap is set by geometry rather than by the glyph.
 */
const DIGIT_WIDTH = 30;
/** 0-9, then 0 again so the roll past 9 wraps without travelling backwards. */
const DIGIT_STRIP = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0];

/** Rendered width of the "%", including its left margin. Used to re-centre. */
const PERCENT_WIDTH = 13;

function DigitColumn({
  progress,
  place,
  reveal,
}: {
  progress: SharedValue<number>;
  place: number;
  /** 0 = this column is a leading zero and hidden, 1 = it carries a digit. */
  reveal?: SharedValue<number>;
}) {
  const style = useAnimatedStyle(() => {
    // Continuous, not floored: the fractional part is what puts a column
    // between two glyphs mid-roll instead of snapping from one to the next.
    const value = progress.value * 100;
    const position = (value / Math.pow(10, place)) % 10;
    return { transform: [{ translateY: -position * DIGIT_HEIGHT }] };
  });

  /**
   * Leading zeros fade, they do not unmount.
   *
   * Removing the column would change the row's width mid-count and walk the
   * whole group sideways. It keeps its 30pt either way — which is exactly why
   * the row has to be re-centred around it.
   */
  const fade = useAnimatedStyle(() => ({ opacity: reveal ? reveal.value : 1 }));

  return (
    <Animated.View style={[{ width: DIGIT_WIDTH, height: DIGIT_HEIGHT, overflow: "hidden" }, fade]}>
      <Animated.View style={style}>
        {DIGIT_STRIP.map((digit, i) => (
          <Text
            key={i}
            // The face has to come from the class: Uniwind resolves className
            // AFTER inline style, so a fontFamily style prop is overridden.
            className="font-display text-[46px] text-label"
            style={{ height: DIGIT_HEIGHT, lineHeight: DIGIT_HEIGHT, textAlign: "center" }}
            maxFontSizeMultiplier={1}
          >
            {digit}
          </Text>
        ))}
      </Animated.View>
    </Animated.View>
  );
}

export interface ProgressRingProps {
  /** 0–100. Clamped internally, so a caller may hand over a raw ratio × 100. */
  percent: number;
  /** Accessibility label. The wrapper carries the live value separately. */
  label: string;
  /**
   * Defaults to TIMING.ringSweep. Pass TIMING.uploadSweep for progress that is
   * sampled continuously rather than in stages — see the note on each.
   */
  sweep?: WithTimingConfig;
}

/**
 * Circular progress.
 *
 * Timing, never a spring. A spring overshoots its target, so the ring would
 * claim more progress than has actually happened and then walk backwards to
 * settle — a progress indicator that runs backwards destroys the one thing it
 * exists to provide.
 *
 * Under Reduce Motion, Reanimated's default (ReduceMotion.System) resolves
 * withTiming instantly. That is correct here: the ANIMATION is decoration, but
 * the VALUE is information, so it still snaps to the new percentage.
 */
export function ProgressRing({ percent, label, sweep = TIMING.ringSweep }: ProgressRingProps) {
  const tint = useColorToken("--tint");
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(Math.max(0, Math.min(1, percent / 100)), sweep);
  }, [percent, progress, sweep]);

  /**
   * Whether each leading column is carrying a digit yet, 0..1.
   *
   * Ramped over one whole unit rather than switched at the threshold, so the
   * column fades in as the value crosses it instead of appearing.
   */
  const tensIn = useDerivedValue(() =>
    interpolate(progress.value * 100, [9, 10], [0, 1], Extrapolation.CLAMP),
  );
  const hundredsIn = useDerivedValue(() =>
    interpolate(progress.value * 100, [99, 100], [0, 1], Extrapolation.CLAMP),
  );

  /**
   * Re-centre the visible digits on the ring.
   *
   * A hidden leading zero still occupies its 30pt of layout — it has to, or the
   * row's width would change mid-count and the whole group would walk sideways.
   * The consequence is that centring the ROW does not centre what you can SEE:
   * at 60 the invisible hundreds column sits on the left and the "%" hangs on
   * the right, so the digits land 8pt right of the ring's centre. Measured
   * against the render, which is where this was caught.
   *
   * offset = (percent width − hidden width) / 2, which lands within half a
   * point at every value: −23.5 below 10, −8.5 through the nineties, +6.5 at
   * 100. Driven by the same ramps as the fades, so a column brightening and the
   * row sliding are one movement rather than two.
   */
  const centring = useAnimatedStyle(() => {
    const hidden = (1 - tensIn.value) * DIGIT_WIDTH + (1 - hundredsIn.value) * DIGIT_WIDTH;
    return { transform: [{ translateX: (PERCENT_WIDTH - hidden) / 2 }] };
  });

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: RING_CIRCUMFERENCE * (1 - progress.value),
  }));

  return (
    <View
      className="items-center justify-center"
      style={{ width: RING_SIZE, height: RING_SIZE }}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: percent }}
    >
      <Svg
        width={RING_SIZE}
        height={RING_SIZE}
        style={{ position: "absolute" }}
        // Decorative duplicate of the label above; the wrapper carries the value.
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          stroke={RING_TRACK}
          strokeWidth={RING_STROKE}
          fill="none"
        />
        <AnimatedCircle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          stroke={tint}
          strokeWidth={RING_STROKE}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={RING_CIRCUMFERENCE}
          // Rotated so the arc starts at 12 o'clock rather than 3.
          originX={RING_SIZE / 2}
          originY={RING_SIZE / 2}
          rotation={-90}
          animatedProps={animatedProps}
        />
      </Svg>

      {/* Hundreds, tens, ones. Fixed geometry, so the group stays centred on
          the ring at every value from 5 to 100. */}
      <Animated.View className="flex-row items-center" style={centring}>
        <DigitColumn progress={progress} place={2} reveal={hundredsIn} />
        <DigitColumn progress={progress} place={1} reveal={tensIn} />
        <DigitColumn progress={progress} place={0} />
        {/* Nudged onto the numeral's baseline — level with the middle of a 46px
            digit a percent sign reads as a superscript. */}
        <Text
          className="text-[17px] text-label-tertiary"
          style={{ marginTop: 12, marginLeft: 2 }}
          maxFontSizeMultiplier={1.3}
        >
          %
        </Text>
      </Animated.View>
    </View>
  );
}
