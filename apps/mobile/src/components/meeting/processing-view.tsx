import { useEffect } from "react";
import { Text, View } from "react-native";
import Animated, {
  FadeIn,
  ReduceMotion,
  cancelAnimation,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
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
    progress.value = withTiming(Math.max(0, Math.min(1, percent / 100)), TIMING.progress);
  }, [percent, progress]);

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

      <View className="flex-row items-baseline">
        <Text
          // Uniwind resolves className AFTER inline style, so a fontFamily style
          // prop here would be silently overridden. The face has to come from
          // the class.
          className="font-display text-[46px] leading-[50px] text-label"
          style={{ fontVariant: ["tabular-nums"] }}
          maxFontSizeMultiplier={1.3}
        >
          {percent}
        </Text>
        <Text className="text-[17px] text-label-tertiary" maxFontSizeMultiplier={1.3}>
          %
        </Text>
      </View>
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
      withTiming(0.25, { duration: 900, easing: TIMING.crossfade.easing, reduceMotion: ReduceMotion.System }),
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
      <View className="items-center gap-5 rounded-card bg-surface px-5 py-7" style={{ borderCurve: "continuous" }}>
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
                  step.state === "pending"
                    ? "text-label-tertiary"
                    : "font-medium text-label"
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
