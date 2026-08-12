import { useCallback, useEffect, useRef, useState } from "react";
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";

export type RecorderState = "idle" | "requesting" | "denied" | "recording" | "paused" | "stopping";

/** Bars kept in the rolling live waveform. */
const BAR_COUNT = 56;

/**
 * dBFS floor. Metering reports roughly -160..0; -50 is quiet-room noise.
 *
 * This number is a judgement call, not a constant — too low and a quiet room
 * looks dead, too high and ambient hiss looks like speech. Tune on device.
 */
const DB_FLOOR = -50;

/** Metering fires many times a second; the UI only needs ~10fps of bars. */
const SAMPLE_INTERVAL_MS = 100;

function normalizeDb(db: number | undefined): number {
  if (db === undefined || Number.isNaN(db)) return 0;
  if (db <= DB_FLOOR) return 0;
  if (db >= 0) return 1;
  return (db - DB_FLOOR) / -DB_FLOOR;
}

export interface Recorder {
  state: RecorderState;
  /** Elapsed seconds. Drives the timer. */
  duration: number;
  /** Rolling normalized levels 0..1, oldest first. */
  bars: number[];
  /** Most recent normalized level 0..1. */
  level: number;
  start: () => Promise<void>;
  pause: () => void;
  resume: () => void;
  /** Resolves with the recording's file URI, or null if nothing was captured. */
  stop: () => Promise<string | null>;
}

export function useRecorder(): Recorder {
  const [state, setState] = useState<RecorderState>("idle");
  const [duration, setDuration] = useState(0);
  const [bars, setBars] = useState<number[]>(() => Array<number>(BAR_COUNT).fill(0));
  const [level, setLevel] = useState(0);

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
      const next = normalizeDb(status.metering);

      setLevel(next);
      setBars((prev) => [...prev.slice(1), next]);
      // The recorder's own clock, so it stays correct across pauses without us
      // tracking wall time.
      setDuration(status.durationMillis / 1000);
    }, SAMPLE_INTERVAL_MS);

    return () => clearInterval(id);
  }, [state, recorder]);

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

    setBars(Array<number>(BAR_COUNT).fill(0));
    setDuration(0);
    setState("recording");
  }, [recorder]);

  const pause = useCallback(() => {
    recorder.pause();
    setState("paused");
    setLevel(0);
  }, [recorder]);

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
    setLevel(0);
    return recorder.uri ?? null;
  }, [recorder]);

  return { state, duration, bars, level, start, pause, resume, stop };
}
