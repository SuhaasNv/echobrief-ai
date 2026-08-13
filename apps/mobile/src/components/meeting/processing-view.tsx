import { useEffect } from "react";
import { Text, View } from "react-native";
import Animated, {
  Easing,
  Extrapolation,
  FadeIn,
  ReduceMotion,
  cancelAnimation,
  interpolate,
  useAnimatedProps,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
  type WithTimingConfig,
} from "react-native-reanimated";
import { useQueryClient } from "@tanstack/react-query";
import Svg, { Circle, Path } from "react-native-svg";

import type { MeetingDetail } from "@/lib/api/meeting-detail";
import {
  formatCountdown,
  isTerminalStatus,
  labelForStatus,
  percentForStatus,
  useMeetingStatus,
  useStageCountdown,
  type MeetingProgress,
  type MeetingStatus,
} from "@/lib/api/meeting-status";
import { TIMING } from "@/lib/motion";

/**
 * The wait.
 *
 * Transcription plus analysis takes minutes, which is long enough that a bare
 * spinner reads as a hang. Three things have to be true for a wait this long to
 * feel like work rather than a stall: it has to name what is happening, it has
 * to move on its own between polls, and it has to say that leaving is safe.
 *
 * Progress is driven by the canonical status → percent table, not by counting
 * completed booleans, so this screen and the web app never disagree about the
 * same meeting.
 */

/**
 * Token values from global.css, dark ramp. SVG stroke/fill take colours, not
 * class names, and the app is locked to dark (app.json userInterfaceStyle), so
 * these resolve exactly like the Tailwind tokens do. Same precedent as
 * SPEAKER_HEX in components/ribbon.
 */
const HEX = {
  tint: "#4C99F8",
  track: "#1C1F25",
  success: "#2FC183",
  tertiary: "#787C85", // mirrors --label-tertiary; raised from #6E727A (4.03:1)
} as const;

const RING_SIZE = 176;
const RING_STROKE = 12;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/**
 * The readout counts, rather than cutting — one column per digit.
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
 * How long the ring and the digits take to travel between two pipeline stages.
 *
 * TIMING.progress is 300ms, which is right for a usage meter settling on entry
 * and wrong here. The stages are 5 → 30 → 60 → 85 → 100, so every move is a
 * 15-30 point jump; at 300ms the columns blur through it too fast to read, and
 * the screen then sits still for the ~30s until the next stage. Stall, glitch,
 * stall.
 *
 * 850ms is long enough to watch 30 climb to 60 and still far shorter than the
 * gap between stages. Local rather than a change to TIMING.progress, which the
 * usage meters and list rows share and where 300ms is correct.
 */
const SWEEP: WithTimingConfig = {
  // Eases out, never in: the move must begin the instant the poll reports a new
  // stage, or it reads as network lag rather than as motion.
  duration: 850,
  easing: Easing.out(Easing.cubic),
};

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
   * the row has to be re-centred around it; see COUNTER_OFFSET below.
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

/** Uppercase micro-eyebrow — matches components/meeting/summary-view. */
function Eyebrow({ children }: { children: string }) {
  return (
    <Text
      className="text-[11px] font-semibold uppercase text-label-tertiary"
      style={{ letterSpacing: 0.8 }}
      maxFontSizeMultiplier={1.4}
    >
      {children}
    </Text>
  );
}

/**
 * Circular progress.
 *
 * Timing, never a spring. A spring overshoots its target, so the ring would
 * claim more progress than the pipeline has actually made and then walk
 * backwards to settle — a progress indicator that runs backwards destroys the
 * one thing it exists to provide.
 *
 * Under Reduce Motion, Reanimated's default (ReduceMotion.System) resolves
 * withTiming instantly. That is correct here: the ANIMATION is decoration, but
 * the VALUE is information, so it still snaps to the new percentage.
 */
function ProgressRing({ percent, label }: { percent: number; label: string }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(Math.max(0, Math.min(1, percent / 100)), SWEEP);
  }, [percent, progress]);

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
          stroke={HEX.track}
          strokeWidth={RING_STROKE}
          fill="none"
        />
        <AnimatedCircle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          stroke={HEX.tint}
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

type StepState = "done" | "active" | "pending";
type StepKey = keyof MeetingProgress;

interface Step {
  key: StepKey;
  label: string;
  state: StepState;
}

/**
 * Pulsing dot for the stage currently running. The only looping animation on
 * the screen, and the only one that has to stop under Reduce Motion — it
 * carries no information the row's shape and label do not already carry.
 */
function ActiveDot() {
  const reduceMotion = useReducedMotion();
  const pulse = useSharedValue(1);

  useEffect(() => {
    if (reduceMotion) {
      pulse.value = 1;
      return;
    }

    pulse.value = withRepeat(
      withTiming(0.25, {
        duration: 900,
        easing: TIMING.crossfade.easing,
        reduceMotion: ReduceMotion.System,
      }),
      -1,
      true,
    );

    return () => {
      cancelAnimation(pulse);
      pulse.value = 1;
    };
  }, [reduceMotion, pulse]);

  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return <Animated.View className="h-2.5 w-2.5 rounded-full bg-tint" style={style} />;
}

/** Done / running / not started, carried by shape as well as colour. */
function StepIcon({ state }: { state: StepState }) {
  if (state === "done") {
    return (
      <View className="h-6 w-6 items-center justify-center rounded-full bg-success/15">
        <Svg width={13} height={13} viewBox="0 0 12 12">
          <Path
            d="M2 6.4 4.6 9 10 3.2"
            stroke={HEX.success}
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </Svg>
      </View>
    );
  }

  if (state === "active") {
    return (
      <View className="h-6 w-6 items-center justify-center rounded-full bg-tint/15">
        <ActiveDot />
      </View>
    );
  }

  return (
    <View className="h-6 w-6 items-center justify-center rounded-full bg-fill">
      <View className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: HEX.tertiary }} />
    </View>
  );
}

/**
 * Which pipeline steps this meeting actually runs.
 *
 * Both are conditional, and getting them wrong makes a healthy meeting look
 * stuck: a pasted transcript never runs transcription, so a permanently
 * unchecked "Transcribed" row reads as a job that died three minutes ago. A
 * meeting with no audio never uploads one.
 */
function buildSteps(
  status: MeetingStatus,
  progress: MeetingProgress,
  hasAudio: boolean,
  transcriptProvided: boolean,
): Step[] {
  const ACTIVE: Partial<Record<MeetingStatus, StepKey>> = {
    transcribing: "transcribed",
    analyzing: "analyzed",
    indexing: "indexed",
  };
  const active = ACTIVE[status];

  const all: { key: StepKey; label: string; include: boolean }[] = [
    { key: "uploaded", label: "Uploaded", include: hasAudio },
    { key: "transcribed", label: "Transcribed", include: !transcriptProvided },
    { key: "analyzed", label: "Analyzed", include: true },
    { key: "indexed", label: "Indexed", include: true },
  ];

  return all
    .filter((step) => step.include)
    .map(({ key, label }) => ({
      key,
      label,
      state: progress[key] ? "done" : key === active ? "active" : "pending",
    }));
}

/**
 * Progress the server would report, for the gap before the first status poll
 * lands. Mirrors the derivation in src/server/api/routes/meetings.ts so the
 * checklist does not visibly rewrite itself a second after it appears.
 */
function fallbackProgress(status: MeetingStatus, hasAudio: boolean): MeetingProgress {
  return {
    uploaded: hasAudio,
    transcribed: ["analyzing", "indexing", "complete"].includes(status),
    analyzed: ["indexing", "complete"].includes(status),
    indexed: status === "complete",
  };
}

function FailureCard({ reason, hasAudio }: { reason: string | null; hasAudio: boolean }) {
  return (
    <Animated.View
      entering={FadeIn.duration(TIMING.crossfade.duration)}
      className="mx-4 gap-2 rounded-card bg-surface p-5"
      style={{ borderCurve: "continuous" }}
    >
      <Eyebrow>Stopped</Eyebrow>
      <Text className="text-[17px] font-semibold text-danger">Processing failed</Text>
      <Text className="text-[15px] leading-[21px] text-label-secondary" selectable>
        {reason ?? "Something went wrong while processing this recording."}
      </Text>
      {/* No retry action exists on the phone yet, so this promises nothing it
          cannot keep. It answers the only question that matters after a
          failure: is my audio gone? */}
      {hasAudio ? (
        <Text className="text-[13px] leading-[18px] text-label-tertiary">
          Your audio is still stored, so nothing was lost.
        </Text>
      ) : null}
    </Animated.View>
  );
}

export function ProcessingView({ meeting }: { meeting: MeetingDetail }) {
  const queryClient = useQueryClient();
  const { data: status } = useMeetingStatus(meeting.id);

  // The status endpoint polls faster than the detail query and is the cheaper
  // read, so it wins when both have an opinion.
  const stage: MeetingStatus = status?.status ?? meeting.status;
  const percent = percentForStatus(stage);
  const failed = stage === "failed";

  const countdown = useStageCountdown(
    stage,
    status?.estimated_seconds_remaining,
    !isTerminalStatus(stage),
  );
  const countdownText = formatCountdown(countdown);

  // Status can reach a terminal state a poll ahead of the detail query. Pull
  // the real meeting immediately rather than making the user wait out the
  // detail query's own interval staring at a finished 100% ring.
  useEffect(() => {
    if (!isTerminalStatus(stage)) return;
    void queryClient.invalidateQueries({ queryKey: ["meeting", meeting.id], exact: true });
  }, [stage, meeting.id, queryClient]);

  if (failed) {
    return (
      <FailureCard
        reason={status?.failure_reason ?? meeting.failure_reason ?? null}
        hasAudio={meeting.has_audio}
      />
    );
  }

  const progress = status?.progress ?? fallbackProgress(stage, meeting.has_audio);
  const steps = buildSteps(stage, progress, meeting.has_audio, meeting.transcript_provided);
  const stageLabel = labelForStatus(stage);

  return (
    <Animated.View
      entering={FadeIn.duration(TIMING.crossfade.duration)}
      className="gap-3 px-4 pb-10"
    >
      <View
        className="items-center gap-5 rounded-card bg-surface px-5 py-7"
        style={{ borderCurve: "continuous" }}
      >
        <Eyebrow>Processing</Eyebrow>

        <ProgressRing percent={percent} label={`${stageLabel}, ${percent} percent complete`} />

        <View className="items-center gap-1.5">
          <Text
            className="text-center text-[17px] font-semibold text-label"
            maxFontSizeMultiplier={1.6}
          >
            {stageLabel}
          </Text>

          {countdownText ? (
            <Text
              className="text-center text-[15px] text-label-secondary"
              style={{ fontVariant: ["tabular-nums"] }}
              maxFontSizeMultiplier={1.6}
            >
              {countdownText}
            </Text>
          ) : null}
        </View>

        <Text className="text-center text-[13px] leading-[18px] text-label-tertiary">
          You can close the app. Processing keeps running and the result will be waiting here.
        </Text>
      </View>

      <View className="gap-4 rounded-card bg-surface p-5" style={{ borderCurve: "continuous" }}>
        <Eyebrow>Steps</Eyebrow>

        <View className="gap-3.5">
          {steps.map((step) => (
            <View
              key={step.key}
              className="flex-row items-center gap-3"
              accessible
              accessibilityLabel={`${step.label}, ${
                step.state === "done" ? "done" : step.state === "active" ? "in progress" : "waiting"
              }`}
            >
              <StepIcon state={step.state} />
              <Text
                className={`flex-1 text-[15px] ${
                  step.state === "pending" ? "text-label-tertiary" : "font-medium text-label"
                }`}
                maxFontSizeMultiplier={1.6}
              >
                {step.label}
              </Text>
              {step.state === "active" ? (
                <Text
                  className="text-[11px] font-semibold uppercase text-tint"
                  style={{ letterSpacing: 0.8 }}
                  maxFontSizeMultiplier={1.4}
                >
                  Working
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      </View>
    </Animated.View>
  );
}
