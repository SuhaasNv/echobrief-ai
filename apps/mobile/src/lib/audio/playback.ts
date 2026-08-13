import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import {
  setAudioModeAsync,
  setIsAudioActiveAsync,
  useAudioPlayer,
  type AudioStatus,
} from "expo-audio";
import { useFocusEffect } from "expo-router";
import {
  Easing,
  ReduceMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import { audioUrlDeadline, fetchMeetingAudio } from "@/lib/api/meeting-audio";

/**
 * Meeting playback.
 *
 * The controller this returns is an EXTERNAL STORE, not React state, and that
 * is the whole architecture of this file rather than a stylistic preference.
 *
 * The meeting detail screen renders the transcript as up to 800 plain rows in a
 * ScrollView. Any state that lives in this hook re-renders that screen, so a
 * `setState` per playback tick would re-render 800 rows ten times a second, and
 * even a `setState` per play/pause tap would drop frames on the tap that caused
 * it. So:
 *
 *   - The 60fps playhead is a Reanimated shared value. It never touches JS.
 *   - Coarse state (playing, buffering, error) is published to subscribers via
 *     `useSyncExternalStore`, so only the player bar re-renders.
 *   - Position is published as a callback stream, so the transcript can compute
 *     its own highlighted row and re-render only when the row actually changes.
 *
 * The screen itself holds a stable object and re-renders for none of it.
 */

/** Status push rate. 100ms is smooth enough to interpolate between. */
const UPDATE_INTERVAL_MS = 100;

/** Refresh the signed URL when it has this little life left. */
const EXPIRY_MARGIN_MS = 60_000;

/**
 * Podcast convention, and asymmetric on purpose: you skip BACK to re-hear a
 * sentence you missed, and FORWARD to get past something you do not need.
 */
export const SKIP_BACK_SEC = 15;
export const SKIP_FORWARD_SEC = 30;

/** How close to the end counts as finished, for the replay-from-zero rule. */
const END_EPSILON = 0.35;

/** Consecutive decode failures before we stop re-signing and tell the user. */
const MAX_RECOVERY_ATTEMPTS = 2;

/** How long a requested seek is allowed to take before we trust the clock again. */
const SEEK_SETTLE_MS = 1200;
/** Within this of the requested position, the seek has landed. */
const SEEK_TOLERANCE_SEC = 1.5;

export type PlaybackPhase = "idle" | "loading" | "ready" | "error";

export interface PlaybackState {
  phase: PlaybackPhase;
  playing: boolean;
  /** Loaded but starved of data. Distinct from `phase === "loading"`. */
  buffering: boolean;
  /** User-facing sentence, already written for display. */
  error: string | null;
  /** Best known total, in seconds. Seeded from the meeting row. */
  duration: number;
}

export interface PlaybackController {
  /** False for transcript-only meetings. Nothing else here is meaningful then. */
  available: boolean;

  /**
   * Playhead position in RIBBON space: 0..1 across the drawn strip.
   *
   * Ribbon space is not recording space. `buildBands` normalises against the
   * span actually covered by speech, so a meeting whose first word lands at
   * 00:12 draws its first band at x=0. Mapping a touch back through
   * `secondsAt` is what keeps the playhead honest.
   */
  progress: SharedValue<number>;
  /** True while a finger owns the playhead. Suppresses status writes. */
  scrubbing: SharedValue<boolean>;

  /** Ribbon fraction (0..1) to a wall-clock second in the recording. */
  secondsAt: (fraction: number) => number;
  /** Wall-clock second to a ribbon fraction (0..1). */
  fractionAt: (seconds: number) => number;

  getState: () => PlaybackState;
  subscribeState: (listener: () => void) => () => void;

  /** Last known position in seconds. Cheap; safe to poll. */
  getPosition: () => number;
  /** Position stream at the status update rate. Does not fire while scrubbing. */
  subscribePosition: (listener: (seconds: number) => void) => () => void;

  /** Play, pause, or recover from an error. The one button's one action. */
  toggle: () => void;
  /** Absolute seek. `play` defaults to preserving the current transport state. */
  seek: (seconds: number, options?: { play?: boolean }) => void;
  /** Relative seek, clamped to the recording. */
  skip: (deltaSeconds: number) => void;
  /** Commit a scrub gesture. Called from the UI thread via runOnJS. */
  commitScrub: (fraction: number) => void;
}

interface PendingResume {
  seconds: number;
  play: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function describe(error: unknown): string {
  if (error instanceof Error && error.message) {
    // Server messages are already sentences ("No audio for this meeting").
    return error.message;
  }
  return "Could not load this recording. Check your connection and try again.";
}

export interface UseMeetingPlaybackOptions {
  meetingId: string;
  hasAudio: boolean;
  /** From the meeting row. Present long before the player reports its own. */
  durationSec: number | null;
  /** First drawn second of the ribbon. See `progress`. */
  ribbonOrigin: number;
  /** Drawn width of the ribbon, in seconds. */
  ribbonSpan: number;
}

/**
 * Coarse transport state, for the one component that needs to re-render on it.
 *
 * Call this in the player bar, never on the meeting screen: subscribing at the
 * screen level would put every play, pause, and buffer stall through a render
 * of the whole transcript, which is exactly what the external store avoids.
 */
export function usePlaybackState(controller: PlaybackController): PlaybackState {
  return useSyncExternalStore(controller.subscribeState, controller.getState);
}

export function useMeetingPlayback({
  meetingId,
  hasAudio,
  durationSec,
  ribbonOrigin,
  ribbonSpan,
}: UseMeetingPlaybackOptions): PlaybackController {
  // Created with no source. Fetching the signed URL on mount would spend most
  // of its 30 minute life before anyone pressed play; `replace()` attaches it
  // on the first press instead. The hook releases the player on unmount, which
  // is the cleanup that stops audio surviving a navigation.
  const player = useAudioPlayer(null, { updateInterval: UPDATE_INTERVAL_MS });

  const progress = useSharedValue(0);
  const scrubbing = useSharedValue(false);

  const stateRef = useRef<PlaybackState>({
    phase: "idle",
    playing: false,
    buffering: false,
    error: null,
    duration: durationSec ?? 0,
  });
  const stateListeners = useRef(new Set<() => void>()).current;
  const positionListeners = useRef(new Set<(seconds: number) => void>()).current;

  const positionRef = useRef(0);
  /** A source is attached and was last known good. */
  const attachedRef = useRef(false);
  /** Wall-clock deadline of the attached URL. */
  const deadlineRef = useRef(0);
  /** Where to land once the freshly attached source reports loaded. */
  const pendingRef = useRef<PendingResume | null>(null);
  const fetchingRef = useRef(false);
  const recoveryRef = useRef(0);
  /** Suppresses position pushes still reporting the pre-seek clock. */
  const seekGuardRef = useRef<{ target: number; at: number } | null>(null);
  /** The audio session is configured once, on the first press of play. */
  const sessionRef = useRef(false);
  /** Guards the blur teardown so a transcript-only meeting never touches it. */
  const touchedSessionRef = useRef(false);

  const publishState = useCallback(
    (patch: Partial<PlaybackState>) => {
      const current = stateRef.current;
      let changed = false;
      for (const key of Object.keys(patch) as (keyof PlaybackState)[]) {
        if (patch[key] !== undefined && patch[key] !== current[key]) changed = true;
      }
      if (!changed) return;
      stateRef.current = { ...current, ...patch };
      stateListeners.forEach((listener) => listener());
    },
    [stateListeners],
  );

  const span = ribbonSpan > 0 ? ribbonSpan : (durationSec ?? 0);
  const origin = span > 0 ? ribbonOrigin : 0;

  const fractionAt = useCallback(
    (seconds: number) => (span > 0 ? clamp((seconds - origin) / span, 0, 1) : 0),
    [origin, span],
  );
  const secondsAt = useCallback(
    (fraction: number) => origin + clamp(fraction, 0, 1) * span,
    [origin, span],
  );

  const armSeekGuard = useCallback((target: number) => {
    seekGuardRef.current = { target, at: Date.now() };
  }, []);

  const publishPosition = useCallback(
    (seconds: number, animate: boolean) => {
      positionRef.current = seconds;
      // Interpolating between 100ms status pushes is what makes the playhead
      // read as continuous rather than as a ten-frames-a-second stutter. Linear
      // because it is tracking real elapsed time; any easing would make the
      // playhead lead or lag the audio. ReduceMotion.Never because this is a
      // position readout, not decoration - resolved instantly it would be the
      // stutter this exists to remove.
      progress.value = animate
        ? withTiming(fractionAt(seconds), {
            duration: UPDATE_INTERVAL_MS,
            easing: Easing.linear,
            reduceMotion: ReduceMotion.Never,
          })
        : fractionAt(seconds);
      positionListeners.forEach((listener) => listener(seconds));
    },
    [fractionAt, positionListeners, progress],
  );

  /**
   * Silent-switch and background configuration.
   *
   * `playsInSilentMode` is not optional: a user who taps play, hears nothing,
   * and has no idea their ringer switch is involved concludes the app is
   * broken. `shouldPlayInBackground` keeps the meeting running when the screen
   * locks, which is the normal way anyone listens to a 40 minute recording.
   *
   * Deferred to the first press rather than run on mount, so opening a
   * transcript-only meeting never claims the audio route or ducks whatever the
   * user already had playing.
   */
  const configureSession = useCallback(async () => {
    if (sessionRef.current) return;
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      // Exclusive, because this is spoken content: mixing a meeting under
      // someone's music makes both unintelligible. It is also what lets iOS
      // associate the lock screen transport with this player.
      interruptionMode: "doNotMix",
      // The recorder sets this true for itself; leaving it true here would keep
      // the session in playAndRecord and route playback to the earpiece.
      allowsRecording: false,
    });
    sessionRef.current = true;
    touchedSessionRef.current = true;
  }, []);

  /**
   * Sign a fresh URL, attach it, and land back where we were.
   *
   * The resume is the point. The URL is short-lived, so expiry mid-listen is a
   * routine event rather than an edge case, and dropping the user back to 0:00
   * of a 40 minute recording because a signature aged out is the failure this
   * function exists to prevent.
   */
  const attachSource = useCallback(
    async (resume: PendingResume) => {
      if (fetchingRef.current) return;
      fetchingRef.current = true;
      publishState({ phase: "loading", error: null });

      try {
        await configureSession();
        const audio = await fetchMeetingAudio(meetingId);
        deadlineRef.current = audioUrlDeadline(audio);
        // Set before replace(): the loaded status can arrive synchronously on a
        // warm player, and a resume registered after it would never be applied.
        pendingRef.current = resume;
        player.replace({ uri: audio.url });
        attachedRef.current = true;
        publishState({ phase: "ready" });
      } catch (error) {
        attachedRef.current = false;
        pendingRef.current = null;
        publishState({ phase: "error", error: describe(error), playing: false, buffering: false });
      } finally {
        fetchingRef.current = false;
      }
    },
    [configureSession, meetingId, player, publishState],
  );

  const isStale = useCallback(() => deadlineRef.current - Date.now() < EXPIRY_MARGIN_MS, []);

  // The meeting row's duration arrives one render after mount, and the player's
  // own duration not until a source is attached. Without this the bar would
  // read 0:00 total until the first press of play.
  useEffect(() => {
    if (durationSec && durationSec > 0 && stateRef.current.duration <= 0) {
      publishState({ duration: durationSec });
    }
  }, [durationSec, publishState]);

  // Status stream. This is the only writer of position and transport state.
  useEffect(() => {
    const subscription = player.addListener("playbackStatusUpdate", (status: AudioStatus) => {
      if (status.error) {
        // Almost always the signature aging out mid-stream: AVPlayer holds
        // its connection open, so an expired URL usually only bites on the
        // next range request. Re-sign and resume rather than surfacing it.
        if (recoveryRef.current < MAX_RECOVERY_ATTEMPTS) {
          recoveryRef.current += 1;
          attachedRef.current = false;
          void attachSource({ seconds: positionRef.current, play: true });
        } else {
          publishState({
            phase: "error",
            error: "Playback stopped. Check your connection and try again.",
            playing: false,
            buffering: false,
          });
        }
        return;
      }

      if (status.duration > 0) publishState({ duration: status.duration });

      const resume = pendingRef.current;
      if (resume && status.isLoaded) {
        pendingRef.current = null;
        if (resume.seconds > 0) {
          armSeekGuard(resume.seconds);
          player.seekTo(resume.seconds).catch(() => undefined);
        }
        if (resume.play) {
          player.play();
          publishState({ playing: true });
        }
        publishPosition(resume.seconds, false);
        // The player's clock is still at zero here. Falling through would
        // publish that and snap the playhead back to the start of a recording
        // the user is being resumed into.
        return;
      }

      publishState({ playing: status.playing, buffering: status.isBuffering });

      if (status.didJustFinish) {
        publishState({ playing: false });
        publishPosition(stateRef.current.duration, false);
        return;
      }

      // A finger owns the playhead; the player's own clock is behind it and
      // would fight the drag.
      if (scrubbing.value) return;

      // A seek is asynchronous, and the ticks that arrive before it lands
      // still report the old position. Publishing them would drag the
      // playhead back to where the user just left, for a beat, on every
      // scrub - the single most common way a scrubber feels broken.
      const guard = seekGuardRef.current;
      if (guard) {
        if (Math.abs(status.currentTime - guard.target) <= SEEK_TOLERANCE_SEC) {
          seekGuardRef.current = null;
        } else if (Date.now() - guard.at < SEEK_SETTLE_MS) {
          return;
        } else {
          // The seek never landed near its target. Stop suppressing, so the
          // playhead tracks reality rather than freezing forever.
          seekGuardRef.current = null;
        }
      }

      if (status.playing && status.currentTime > positionRef.current) {
        // Real forward progress means the source is healthy again.
        recoveryRef.current = 0;
      }
      publishPosition(status.currentTime, status.playing);
    });

    return () => subscription.remove();
  }, [armSeekGuard, attachSource, player, publishPosition, publishState, scrubbing]);

  /**
   * Leaving the screen releases the audio route.
   *
   * Pause rather than only deactivating: a player left running behind a
   * navigation is the classic leak here, and a tab bar keeps this screen
   * mounted, so unmount cleanup alone would not catch a tab switch.
   *
   * Screen lock is deliberately NOT this path. Locking does not blur a
   * navigator, so `shouldPlayInBackground` keeps doing its job.
   */
  useFocusEffect(
    useCallback(
      () => () => {
        if (!touchedSessionRef.current) return;
        try {
          player.pause();
        } catch {
          // The native player may already be gone. This cleanup runs during
          // React's passive unmount pass, and when the whole screen is being
          // torn down expo-audio can release the shared object first — calling
          // into it then throws NotFoundException, which surfaces as a full
          // render error over a screen the user has already left.
          //
          // Swallowed rather than guarded on a liveness flag because there is
          // no such flag to read: expo-audio exposes no "is released" property,
          // so the call itself is the only test. A released player is also
          // already stopped, which is the entire point of this line.
          //
          // Only the native call is inside the try. The session teardown below
          // must run either way, otherwise the audio session stays active and
          // the next screen inherits a route it never asked for.
        }
        publishState({ playing: false, buffering: false });
        sessionRef.current = false;
        void setIsAudioActiveAsync(false).catch(() => undefined);
      },
      [player, publishState],
    ),
  );

  const seek = useCallback(
    (seconds: number, options?: { play?: boolean }) => {
      if (!hasAudio) return;
      const total = stateRef.current.duration;
      const target = clamp(seconds, 0, total > 0 ? total : seconds);
      const shouldPlay = options?.play ?? stateRef.current.playing;

      // Move the playhead before the audio does. A scrubber that waits for the
      // decoder feels broken even when the seek lands in 40ms.
      publishPosition(target, false);

      if (!attachedRef.current || isStale()) {
        void attachSource({ seconds: target, play: shouldPlay });
        return;
      }

      armSeekGuard(target);
      player.seekTo(target).catch(() => undefined);
      if (shouldPlay) {
        player.play();
        publishState({ playing: true });
      }
    },
    [armSeekGuard, attachSource, hasAudio, isStale, player, publishPosition, publishState],
  );

  const toggle = useCallback(() => {
    if (!hasAudio) return;
    const state = stateRef.current;

    if (state.playing) {
      player.pause();
      publishState({ playing: false });
      return;
    }

    if (!attachedRef.current || isStale() || state.phase === "error") {
      recoveryRef.current = 0;
      void attachSource({ seconds: positionRef.current, play: true });
      return;
    }

    // Pressing play on a finished recording restarts it. Anything else leaves
    // the user tapping a button that appears to do nothing.
    const total = state.duration;
    if (total > 0 && positionRef.current >= total - END_EPSILON) {
      armSeekGuard(0);
      player.seekTo(0).catch(() => undefined);
      publishPosition(0, false);
    }

    void configureSession()
      .then(() => {
        player.play();
        publishState({ playing: true });
      })
      .catch(() => publishState({ phase: "error", error: describe(null) }));
  }, [
    armSeekGuard,
    attachSource,
    configureSession,
    hasAudio,
    isStale,
    player,
    publishPosition,
    publishState,
  ]);

  const skip = useCallback(
    (deltaSeconds: number) => seek(positionRef.current + deltaSeconds),
    [seek],
  );

  const commitScrub = useCallback(
    (fraction: number) => {
      seek(secondsAt(fraction));
      // Released here as well as in the gesture's onFinalize. The gesture frees
      // the playhead one frame before this lands, and a status push arriving in
      // that window would drag it back to where the audio still is.
      scrubbing.value = false;
    },
    [scrubbing, secondsAt, seek],
  );

  const subscribeState = useCallback(
    (listener: () => void) => {
      stateListeners.add(listener);
      return () => {
        stateListeners.delete(listener);
      };
    },
    [stateListeners],
  );

  const subscribePosition = useCallback(
    (listener: (seconds: number) => void) => {
      positionListeners.add(listener);
      return () => {
        positionListeners.delete(listener);
      };
    },
    [positionListeners],
  );

  const getState = useCallback(() => stateRef.current, []);
  const getPosition = useCallback(() => positionRef.current, []);

  return useMemo(
    () => ({
      available: hasAudio,
      progress,
      scrubbing,
      secondsAt,
      fractionAt,
      getState,
      subscribeState,
      getPosition,
      subscribePosition,
      toggle,
      seek,
      skip,
      commitScrub,
    }),
    [
      commitScrub,
      fractionAt,
      getPosition,
      getState,
      hasAudio,
      progress,
      scrubbing,
      secondsAt,
      seek,
      skip,
      subscribePosition,
      subscribeState,
      toggle,
    ],
  );
}
