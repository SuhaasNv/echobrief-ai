import { useEffect } from "react";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";
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
import { onlineManager, useQueryClient } from "@tanstack/react-query";
import Svg, { Circle, Path } from "react-native-svg";

import type { MeetingDetail } from "@/lib/api/meeting-detail";
import {
  formatCountdown,
  isTerminalStatus,
  labelForStatus,
  percentForStatus,
  percentForUpload,
  UPLOAD_LABEL,
  useMeetingStatus,
  useStageCountdown,
  type MeetingProgress,
  type MeetingStatus,
} from "@/lib/api/meeting-status";
import { TIMING } from "@/lib/motion";
// Shared with the upload screen, so a recording's two waits — the upload and
// this pipeline — are one continuous indicator rather than two.
import { describeActionFailure } from "@/lib/api/errors";
import { useRetryMeeting } from "@/lib/api/meetings";
import { useUploadState } from "@/lib/api/upload-progress";
import { ProgressRing } from "@/components/progress-ring";
import { useColorToken, useColorTokens } from "@/lib/tokens";

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

const STEP_TOKENS = ["--success", "--label-tertiary"] as const;

/** Done / running / not started, carried by shape as well as colour. */
function StepIcon({ state }: { state: StepState }) {
  // Read before the branches rather than inside them — these are hooks, and the
  // active state below uses neither of them.
  const [success, tertiary] = useColorTokens(STEP_TOKENS);

  if (state === "done") {
    return (
      <View className="h-6 w-6 items-center justify-center rounded-full bg-success/15">
        <Svg width={13} height={13} viewBox="0 0 12 12">
          <Path
            d="M2 6.4 4.6 9 10 3.2"
            stroke={success}
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
      <View className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: tertiary }} />
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

/**
 * The end of the road for a recording — and the way back off it.
 *
 * The reason string is verbatim from the pipeline and can be a whole signed R2
 * URL, so it stays selectable and is never truncated: when someone reports this
 * screen, that text is the entire diagnosis.
 *
 * Exported, and that matters. It lived privately in here and was rendered only
 * by ProcessingView — which never mounts for a failed meeting, because
 * `isProcessing` excludes "failed". The meeting screen had its own inline copy
 * with no retry, so the working button was reachable only during the sliver
 * where the fast status poll reported failure before the slower detail query
 * agreed. Opening a failed meeting from the list never showed it. One card, one
 * place, no second copy to fall out of step.
 *
 * The retry button is the point. This card used to say "your audio is still
 * stored, so nothing was lost" and offer nothing — telling someone their data
 * is fine while giving them no way to reach it, which is worse than saying
 * nothing. Most failures here are transient (a refused download, a 500 partway
 * through analysis) and the audio is sitting in storage the whole time.
 */
export function FailureCard({
  meetingId,
  reason,
  hasAudio,
}: {
  meetingId: string;
  reason: string | null;
  hasAudio: boolean;
}) {
  const retry = useRetryMeeting(meetingId);

  const onRetry = () => {
    retry.mutate(undefined, {
      onError: (error) => {
        // The server refuses past three attempts and 409s while a worker holds
        // the lock. Both are real answers the user needs in words, not a button
        // that silently does nothing.
        Alert.alert(
          "Could not start again",
          describeActionFailure(error, { online: onlineManager.isOnline() }),
        );
      },
    });
  };

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

      {hasAudio ? (
        <>
          <Text className="text-[13px] leading-[18px] text-label-tertiary">
            Your audio is still stored, so nothing was lost.
          </Text>
          <Pressable
            onPress={onRetry}
            disabled={retry.isPending}
            accessibilityRole="button"
            accessibilityLabel="Try processing again"
            accessibilityState={{ busy: retry.isPending }}
            className="mt-2 min-h-[44px] flex-row items-center justify-center gap-2 rounded-full bg-fill active:opacity-80"
            style={{ borderCurve: "continuous" }}
          >
            {retry.isPending ? (
              <ActivityIndicator size="small" />
            ) : (
              <Text className="text-[15px] font-semibold text-tint-label">
                Try processing again
              </Text>
            )}
          </Pressable>
        </>
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

  /**
   * An upload this device still has in flight for this meeting.
   *
   * The row exists server-side from the presign onward, so the meeting is
   * reachable — and the user is sent here immediately — while its audio is still
   * going up. The server can only say `queued` during that window, which is true
   * but useless: it looks identical to waiting for a worker, so a 40MB transfer
   * on a bad connection reads as a stall.
   *
   * Only this device knows, so only this device can say. Undefined on every
   * other device and after a relaunch, which is correct — the ring simply starts
   * at `queued` there, the same as before any of this existed.
   */
  const upload = useUploadState(meeting.id);
  const uploading = upload?.status === "uploading";

  // One scale, one climb. Upload occupies 0–5, below the first server status,
  // so the ring never resets between the transfer and the pipeline.
  const percent = uploading ? Math.round(percentForUpload(upload.ratio)) : percentForStatus(stage);
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
        meetingId={meeting.id}
        reason={status?.failure_reason ?? meeting.failure_reason ?? null}
        hasAudio={meeting.has_audio}
      />
    );
  }

  const progress = status?.progress ?? fallbackProgress(stage, meeting.has_audio);
  const steps = buildSteps(stage, progress, meeting.has_audio, meeting.transcript_provided);
  // While the audio is still going up, say so. `queued` is technically true then
  // and reads as "waiting for a worker", which sends the user looking for a
  // problem at our end when the bytes are still leaving their phone.
  const stageLabel = uploading ? UPLOAD_LABEL : labelForStatus(stage);

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
