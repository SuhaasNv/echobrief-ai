import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSharedValue, type SharedValue } from "react-native-reanimated";
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder } from "expo-audio";

export type RecorderState = "idle" | "requesting" | "denied" | "recording" | "paused" | "stopping";

/**
 * dBFS floor. Metering reports roughly -160..0; -50 is quiet-room noise.
 *
 * This number is a judgement call, not a constant — too low and a quiet room
 * looks dead, too high and ambient hiss looks like speech. Tune on device.
 */
const DB_FLOOR = -50;

/**
 * 25 Hz, not 10 Hz.
 *
 * Syllables land at roughly 4–8 per second and a stressed one peaks and decays
 * inside ~150ms. Sampling every 100ms put barely one reading on a syllable and
 * missed short bursts entirely, so the orb answered the *average* of the room
 * rather than the voice in it — which is what made it feel lazy no matter how
 * the animation was tuned. You cannot smooth your way out of an undersampled
 * signal; it has to be sampled faster first.
 *
 * Affordable only because `level` is a shared value now. At 10 Hz this loop ran
 * three setStates per tick and re-rendered the record screen for each one; at
 * 25 Hz that would have been 75 renders a second. It now writes straight to the
 * UI thread and re-renders nothing.
 */
const SAMPLE_INTERVAL_MS = 40;

function normalizeDb(db: number | undefined): number {
  if (db === undefined || Number.isNaN(db)) return 0;
  if (db <= DB_FLOOR) return 0;
  if (db >= 0) return 1;
  return (db - DB_FLOOR) / -DB_FLOOR;
}

export interface Recorder {
  state: RecorderState;
  /** Elapsed seconds, whole. Drives the timer. */
  duration: number;
  /**
   * Most recent normalized level, 0..1, on the UI thread.
   *
   * A shared value rather than React state: this changes 25 times a second and
   * only ever feeds an animation, so routing it through a render would cost a
   * reconcile per sample to hand a number to a worklet that could have read it
   * directly.
   */
  level: SharedValue<number>;
  start: () => Promise<void>;
  pause: () => void;
  resume: () => void;
  /** Resolves with the recording's file URI, or null if nothing was captured. */
  stop: () => Promise<string | null>;
  /** Clears the timer and waveform. Tab screens stay mounted, so state persists. */
  reset: () => void;
}

export function useRecorder(): Recorder {
  const [state, setState] = useState<RecorderState>("idle");
  const [duration, setDuration] = useState(0);
  const level = useSharedValue(0);
  // Last whole second published to React. The timer renders mm:ss, so pushing a
  // new duration on every 40ms sample would re-render the screen 25 times to
  // redraw the same two digits.
  const secondRef = useRef(-1);

  const recorder = useAudioRecorder({
    ...RecordingPresets.HIGH_QUALITY,
    isMeteringEnabled: true,
  });

  // Sampling loop. Metering lives on getStatus(), not on the recordingStatus
  // event, and it updates far faster than the UI needs — polling at a fixed
  // interval both reads the right source and downsamples in one step. Runs only
  // while recording, so an idle or paused screen costs nothing.
  useEffect(() => {
    if (state !== "recording") return;

    const id = setInterval(() => {
      const status = recorder.getStatus();

      // Straight to the UI thread. No setState, so no render.
      level.value = normalizeDb(status.metering);

      // The recorder's own clock, so it stays correct across pauses without us
      // tracking wall time. Published only when the displayed second actually
      // changes.
      const seconds = Math.floor(status.durationMillis / 1000);
      if (seconds !== secondRef.current) {
        secondRef.current = seconds;
        setDuration(seconds);
      }
    }, SAMPLE_INTERVAL_MS);

    return () => clearInterval(id);
  }, [state, recorder, level]);

  const start = useCallback(async () => {
    setState("requesting");

    const permission = await AudioModule.requestRecordingPermissionsAsync();
    if (!permission.granted) {
      setState("denied");
      return;
    }

    // allowsRecording must be set before prepare, and playsInSilentMode keeps
    // capture alive when the ringer switch is off — which it very often is.
    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
    });

    // isMeteringEnabled is passed again here: it is known to be ignored when
    // supplied only to the hook.
    await recorder.prepareToRecordAsync({
      ...RecordingPresets.HIGH_QUALITY,
      isMeteringEnabled: true,
    });

    // Synchronous and returns void — do not await it.
    recorder.record();

    secondRef.current = -1;
    setDuration(0);
    setState("recording");
  }, [recorder]);

  const pause = useCallback(() => {
    recorder.pause();
    setState("paused");
    level.value = 0;
  }, [recorder, level]);

  const resume = useCallback(() => {
    recorder.record();
    setState("recording");
  }, [recorder]);

  const stop = useCallback(async () => {
    setState("stopping");
    try {
      await recorder.stop();
    } catch {
      // A stop on an already-stopped recorder should not lose the file.
    }
    // Release the audio session so playback elsewhere is not left ducked.
    await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
    setState("idle");
    level.value = 0;
    return recorder.uri ?? null;
  }, [recorder, level]);

  const reset = useCallback(() => {
    secondRef.current = -1;
    setDuration(0);
    level.value = 0;
  }, [level]);

  // Memoised because callers put this object in dependency arrays. Returning a
  // fresh literal each render made a useFocusEffect re-fire every render, which
  // called reset(), which set state, which re-rendered — an infinite loop that
  // crashed the app on launch.
  return useMemo(
    () => ({ state, duration, level, start, pause, resume, stop, reset }),
    [state, duration, level, start, pause, resume, stop, reset],
  );
}
