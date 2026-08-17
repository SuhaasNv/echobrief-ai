import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSharedValue, type SharedValue } from "react-native-reanimated";
import { File } from "expo-file-system";
import {
  AudioModule,
  AudioQuality,
  IOSOutputFormat,
  setAudioModeAsync,
  useAudioRecorder,
  type AudioRecorder,
  type RecordingOptions,
} from "expo-audio";

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
 * Affordable only because `level` is a shared value: at 10 Hz this loop ran
 * three setStates per tick and re-rendered the record screen for each one; at
 * 25 Hz that would have been 75 renders a second. It writes straight to the UI
 * thread and re-renders nothing.
 */
const SAMPLE_INTERVAL_MS = 40;

/**
 * ADTS AAC, and this is the single most important line in the file.
 *
 * Segments are rejoined server-side by concatenating their bytes, which is only
 * valid for a format built from self-describing frames. Every ADTS frame
 * carries its own sample rate and channel configuration, so a decoder reading a
 * `cat` of two segments simply keeps going.
 *
 * MPEG-4 (.m4a) — what this recorder produced before segmentation — is not, and
 * fails in the worst possible way. Measured end to end against AssemblyAI, a
 * byte-concatenated m4a of a 4.27s and a 4.55s clip returned `audio_duration:
 * 5`, `status: completed`, `error: null`, and a transcript containing only the
 * first clip. Half the meeting vanished with nothing anywhere reporting a
 * problem. The equivalent ADTS pair returned `audio_duration: 9` and both
 * halves.
 *
 * AVAudioRecorder picks its container from the URL's extension, so ".aac" is
 * what selects ADTS and ".m4a" is what selects MPEG-4 — the outputFormat below
 * is the codec and is `MPEG4AAC` in BOTH cases, which is exactly why this is
 * easy to get wrong. Verified on iOS 26.5 (arm64 simulator) by recording with
 * these settings and reading the file back: the first bytes are
 * `FF F9 50 A0 01 A0 ...`, an ADTS sync word, and the frame chain walks to
 * exact EOF. The same settings with a ".m4a" extension produced
 * `00 00 00 1C 66 74 79 70` — an `ftyp` box.
 *
 * The server enforces this independently (ConcatenableMime is a hard allowlist
 * of one), so a regression here fails loudly at registration rather than
 * silently in a transcript.
 */
const RECORDING_OPTIONS: RecordingOptions = {
  // Ignored on iOS in favour of ios.extension below, but set so the two can
  // never disagree if this is ever read on another platform.
  extension: ".aac",
  sampleRate: 44100,
  numberOfChannels: 1,
  bitRate: 64000,
  isMeteringEnabled: true,
  // Documents, not the cache. iOS purges the cache directory under storage
  // pressure, and a segment deleted out from under a meeting in progress is the
  // exact failure this whole feature exists to prevent.
  directory: "document",
  ios: {
    // THE line. ".aac" is what makes AVAudioRecorder choose ADTS; the codec
    // below is the same MPEG4AAC that ".m4a" would have used.
    extension: ".aac",
    outputFormat: IOSOutputFormat.MPEG4AAC,
    audioQuality: AudioQuality.HIGH,
    sampleRate: 44100,
  },
  android: {
    extension: ".aac",
    outputFormat: "aac_adts",
    audioEncoder: "aac",
    sampleRate: 44100,
  },
  web: { mimeType: "audio/aac", bitsPerSecond: 64000 },
};

/**
 * How far into a segment the next recorder is prepared and scheduled.
 *
 * Two separate jobs, both of which have to happen well away from the seam.
 *
 * Preparing allocates an AVAudioRecorder and calls prepareToRecord, measured at
 * ~8ms. Doing that AT the boundary is what makes naive rotation drop audio.
 * Doing it immediately after the current segment starts was measured to disturb
 * the recorder that had just begun, so it waits.
 *
 * 0.5 also buys ~30s of slack at the 60s target: if JS is throttled and the
 * rotation callback runs late, there is a long window before the active
 * recorder hits its own deadline with no successor scheduled.
 */
const ROTATE_AT_FRACTION = 0.5;

/**
 * Below this much remaining, do not try to schedule a handoff.
 *
 * A late rotation would ask AVAudioRecorder to start a recorder in the past,
 * which it treats as "now" — and "now" while another recorder still holds the
 * input is the one case measured to truncate the active segment. Starting
 * cleanly after it has stopped costs a seam; racing it costs real audio.
 */
const MIN_LEAD_SECONDS = 0.25;

/** ~17 hours at the 60s target, and the CHECK the segments table enforces. */
const MAX_SEGMENTS = 1024;

function normalizeDb(db: number | undefined): number {
  if (db === undefined || Number.isNaN(db)) return 0;
  if (db <= DB_FLOOR) return 0;
  if (db >= 0) return 1;
  return (db - DB_FLOOR) / -DB_FLOOR;
}

/** A segment file that has been closed and flushed by the OS. */
export interface ClosedSegment {
  index: number;
  uri: string;
}

export interface RecorderOptions {
  /**
   * A segment has closed. Called once per segment, in close order.
   *
   * Must not throw and must not be slow: it runs on the rotation path, and the
   * microphone is live.
   */
  onSegment: (segment: ClosedSegment) => void;
  /**
   * Rotation cadence in seconds. Server policy, read live rather than captured,
   * because POST /meetings/segmented usually answers after capture has started.
   */
  getTargetSeconds: () => number;
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
  /**
   * Close the recording.
   *
   * Resolves once the FINAL segment's file has been closed and handed to
   * `onSegment`, with the number of segments the recorder actually rotated
   * through — which is what lets finalize tell "this meeting was six segments
   * long" apart from "six and seven were lost".
   */
  stop: () => Promise<{ totalSegments: number; durationSec: number }>;
  /** Clears the timer and waveform. Tab screens stay mounted, so state persists. */
  reset: () => void;
}

/**
 * Segmented capture.
 *
 * The recorder rotates into a fresh file about once a minute, so a crash costs
 * at most the segment still open rather than the entire meeting. The hard part
 * is that rotation must not drop audio at the seam — a gap at every boundary
 * would be a worse bug than the one being fixed.
 *
 * How the seam is closed:
 *
 * Every segment is opened with `record({ atTime, forDuration })`, which maps to
 * AVAudioRecorder's `record(atTime:forDuration:)`. Both instants are fixed on
 * the audio DEVICE clock, not on JS timing, so a segment's stop is scheduled
 * rather than commanded — and because it is known in advance, the next
 * recorder can be scheduled to start at exactly that instant. Two recorder
 * slots alternate: while one records, the other is prepared and armed, so the
 * expensive part of rotation is entirely off the critical path.
 *
 * The remaining time in the active segment is read from `currentTime`, the
 * recorder's own audio clock, immediately before arming the next one in the
 * same synchronous JS tick. Anchoring on the audio clock rather than on
 * Date.now() means the chain re-anchors every rotation and cannot accumulate
 * drift between the system clock and the audio hardware clock.
 *
 * A segment is harvested by an explicit `stop()` at the seam, NOT by waiting
 * for a status event. Measured on iOS 26.5: the delegate expo-audio surfaces as
 * `recordingStatusUpdate` fires for an explicit stop but is SILENT for the
 * scheduled `forDuration` stop, which is how every rotated segment ends — a
 * loop waiting on it would drop every segment but the last. The explicit stop
 * is a no-op on an already-stopped recorder (byte-for-byte identical file,
 * verified) and awaiting it is a real synchronisation point: reading the file
 * without it caught a recording mid-flush, two frames short.
 *
 * Verified end to end on iOS 26.5 (arm64 simulator), 1.5s segments, 4
 * rotations: every segment came out 1.509s for a 1.500s window — one AAC
 * priming frame over, never under — the chain captured 46ms MORE than nominal
 * rather than less, all five files walked their frame chains to exact EOF, and
 * the byte-concatenation of all five read back through AVURLAsset at exactly
 * the sum of its parts. The naive stop/prepare/record turnaround this replaces
 * measured 31ms of dead air per seam on the same machine.
 */
export function useRecorder({ onSegment, getTargetSeconds }: RecorderOptions): Recorder {
  const [state, setState] = useState<RecorderState>("idle");
  const [duration, setDuration] = useState(0);
  const level = useSharedValue(0);

  /**
   * Two slots, alternating.
   *
   * Both are created with the same frozen options object so `useAudioRecorder`
   * — which rebuilds its recorder whenever the serialised options change —
   * never swaps one out mid-meeting.
   */
  const slotA = useAudioRecorder(RECORDING_OPTIONS);
  const slotB = useAudioRecorder(RECORDING_OPTIONS);

  /** Which slot is producing audio right now. */
  const activeRef = useRef<AudioRecorder | null>(null);
  /** The slot armed to take over at the next seam, if one is armed. */
  const armedRef = useRef<AudioRecorder | null>(null);

  /** Index the next segment to be OPENED will carry. 0-based and dense. */
  const nextIndexRef = useRef(0);
  /** Segments closed and handed on so far. */
  const closedCountRef = useRef(0);

  /**
   * The file each slot currently owns, captured at prepare time.
   *
   * Segments are harvested from this rather than from the recorder's status
   * event, because the event does not arrive for the stop that matters.
   * Measured on iOS 26.5: `audioRecorderDidFinishRecording` — the delegate
   * expo-audio turns into `recordingStatusUpdate` — fires for an explicit
   * `stop()` but NOT for the scheduled `record(forDuration:)` stop, which is how
   * every rotated segment ends. A rotation loop waiting on that event would
   * quietly drop every segment but the last.
   *
   * It does not need the event. Each segment's stop instant is scheduled, so the
   * moment it is complete is known in advance, and ADTS has no trailing index to
   * write — the file is valid as soon as its last frame is.
   */
  const openRef = useRef(new Map<AudioRecorder, ClosedSegment>());

  const rotateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seamTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Wall clock, not the recorder's clock.
   *
   * The timer has to keep counting across a rotation, and every per-recorder
   * clock resets at the seam. Accumulating them would make the readout hitch
   * exactly when the orb must not. A monotonic elapsed time also stays correct
   * across a pause without tracking which segment a pause landed in.
   */
  const runStartedAtRef = useRef(0);
  const accumulatedMsRef = useRef(0);
  const publishedSecondRef = useRef(-1);

  const clearTimers = useCallback(() => {
    if (rotateTimerRef.current !== null) {
      clearTimeout(rotateTimerRef.current);
      rotateTimerRef.current = null;
    }
    if (seamTimerRef.current !== null) {
      clearTimeout(seamTimerRef.current);
      seamTimerRef.current = null;
    }
  }, []);

  /**
   * Held in a ref so the rotation path, which is driven by timers rather than by
   * renders, never calls a callback from a render that has been thrown away.
   */
  const onSegmentRef = useRef(onSegment);
  useEffect(() => {
    onSegmentRef.current = onSegment;
  }, [onSegment]);

  /**
   * Give a slot a fresh file and claim the next index for it.
   *
   * `prepareToRecordAsync` only mints a new file when it is passed options —
   * without them it re-prepares the SAME url, and every segment would overwrite
   * the last.
   */
  const prepareSlot = useCallback(async (slot: AudioRecorder): Promise<ClosedSegment | null> => {
    await slot.prepareToRecordAsync(RECORDING_OPTIONS);
    const uri = slot.uri;
    if (!uri) return null;

    const index = nextIndexRef.current;
    nextIndexRef.current = index + 1;
    const open: ClosedSegment = { index, uri };
    openRef.current.set(slot, open);
    return open;
  }, []);

  /**
   * Close a slot's file and hand the segment on.
   *
   * `stop()` is called even when the slot has already auto-stopped at its
   * scheduled deadline: it is a no-op on a stopped AVAudioRecorder, it puts
   * expo-audio's own state machine back in step for the next prepare, and
   * awaiting it is a synchronisation point that the silent auto-stop does not
   * otherwise give us.
   */
  const harvest = useCallback(async (slot: AudioRecorder): Promise<void> => {
    const open = openRef.current.get(slot);
    if (!open) return;
    openRef.current.delete(slot);

    await slot.stop().catch(() => undefined);

    closedCountRef.current += 1;
    onSegmentRef.current(open);
  }, []);

  /**
   * Throw away a slot that was armed but never produced a frame.
   *
   * Stopping a scheduled-but-not-started recorder still writes its file — 33
   * bytes, an ADTS header with no audio behind it. Registered as a segment it
   * would be a permanent hole in the middle of the meeting that the server
   * would refuse to finalize around, so the index it claimed is given back and
   * the stub is deleted.
   */
  const abandonSlot = useCallback(async (slot: AudioRecorder): Promise<void> => {
    const open = openRef.current.get(slot);
    if (!open) return;
    openRef.current.delete(slot);
    nextIndexRef.current -= 1;

    await slot.stop().catch(() => undefined);
    try {
      const stub = new File(open.uri);
      if (stub.exists) stub.delete();
    } catch {
      // A stray header in the cache is not worth failing a recording over.
    }
  }, []);

  /**
   * The rotation timer.
   *
   * Declared before `rotate` and dispatching through a ref, so the two can call
   * each other — every rotation ends by arming the next one — without either
   * capturing a stale copy of the other.
   */
  const rotateRef = useRef<() => Promise<void>>(async () => undefined);
  const scheduleRotation = useCallback((seconds: number) => {
    if (rotateTimerRef.current !== null) clearTimeout(rotateTimerRef.current);
    rotateTimerRef.current = setTimeout(
      () => {
        rotateTimerRef.current = null;
        void rotateRef.current();
      },
      Math.max(0, seconds) * 1000,
    );
  }, []);

  /**
   * Arm the successor and hand the input over at the scheduled instant.
   *
   * Runs mid-segment. Everything expensive happens here; the seam itself is
   * carried out by the audio hardware against a time that was fixed before it
   * arrived.
   */
  const rotate = useCallback(async () => {
    const active = activeRef.current;
    if (!active) return;

    const target = getTargetSeconds();

    if (nextIndexRef.current >= MAX_SEGMENTS) {
      // 1024 segments is ~17 hours. Nothing good happens past here, and the
      // server would refuse the index anyway.
      return;
    }

    const next = active === slotA ? slotB : slotA;

    try {
      const opened = await prepareSlot(next);
      if (opened === null) return;
    } catch {
      // The successor could not be prepared. The active segment still stops at
      // its own deadline, so this is a seam, not a loss — and the next tick
      // tries again from a stopped state.
      scheduleRotation(Math.max(1, target * 0.25));
      return;
    }

    /**
     * Re-check AFTER the await. stop() and pause() can land inside
     * prepareSlot's ~8ms — and at that instant neither `armedRef` nor the seam
     * timer exists yet, so their teardown has nothing to clear. Proceeding
     * would arm the successor against a session the user has already ended:
     * the microphone stays live after "End meeting", capture silently resumes
     * under a paused UI, and phantom segments upload into a finalized meeting.
     * Both paths harvest `active` out of `openRef`, so its absence is the
     * terminal signal — an `activeRef` check would miss pause, which nulls
     * nothing. The freshly prepared slot is handed back through abandonSlot so
     * its claimed index and 33-byte stub do not leak.
     */
    if (!openRef.current.has(active)) {
      await abandonSlot(next);
      return;
    }

    // Read the audio clock and arm the successor in ONE synchronous tick. Both
    // are JSI calls, so the two land microseconds apart and the handoff is
    // fixed against the same clock the hardware uses. `currentTime` is negative
    // while a recorder is scheduled but not yet started, so this is correct
    // whether the active segment began immediately or was itself scheduled.
    const remaining = target - active.currentTime;

    /**
     * The seam.
     *
     * Fires at the instant the outgoing recorder's own scheduled stop lands.
     * Three things happen in order: the metering source moves to the recorder
     * that is now producing audio, the outgoing file is closed and handed to
     * the uploader, and the next rotation is armed.
     *
     * The harvest is why this timer exists at all rather than just a metering
     * swap — the scheduled stop is silent, so this is the only moment anything
     * knows the segment is finished.
     */
    const atSeam = (): void => {
      seamTimerRef.current = null;
      activeRef.current = next;
      armedRef.current = null;
      void harvest(active);
      scheduleRotation(target * ROTATE_AT_FRACTION);
    };

    if (remaining <= MIN_LEAD_SECONDS) {
      // Late. Do not race the active recorder for the input — see
      // MIN_LEAD_SECONDS. Let it finish and pick up straight after, which costs
      // a seam rather than the audio a collision would have cost.
      seamTimerRef.current = setTimeout(
        () => {
          // Guarded: this runs inside a timer, OUTSIDE any error boundary, and
          // record() throws synchronously when the audio session was taken
          // mid-flight (an incoming call, Siri). An escaped throw here is an
          // unhandled fault mid-meeting; a failed arm is just a dropped seam,
          // and the retry tick recovers it.
          try {
            next.record({ forDuration: target });
            atSeam();
          } catch {
            seamTimerRef.current = null;
            void abandonSlot(next);
            scheduleRotation(Math.max(1, target * 0.25));
          }
        },
        Math.max(0, remaining) * 1000 + 40,
      );
      return;
    }

    // Same guard, same reason: rotate() itself is dispatched from a timer.
    try {
      next.record({ atTime: remaining, forDuration: target });
    } catch {
      void abandonSlot(next);
      scheduleRotation(Math.max(1, target * 0.25));
      return;
    }
    armedRef.current = next;

    seamTimerRef.current = setTimeout(atSeam, remaining * 1000);
  }, [abandonSlot, getTargetSeconds, harvest, prepareSlot, scheduleRotation, slotA, slotB]);

  useEffect(() => {
    rotateRef.current = rotate;
  }, [rotate]);

  /**
   * Sampling loop. Metering lives on getStatus(), not on the status event, and
   * it updates far faster than the UI needs — polling at a fixed interval both
   * reads the right source and downsamples in one step. Runs only while
   * recording, so an idle or paused screen costs nothing.
   */
  useEffect(() => {
    if (state !== "recording") return;

    const id = setInterval(() => {
      const active = activeRef.current;
      if (active) {
        // Hold the last level through the handful of milliseconds around a
        // seam when the incoming recorder is armed but has not started. Writing
        // a zero there would put a visible notch in the orb once a minute.
        if (active.currentTime >= 0) {
          // Straight to the UI thread. No setState, so no render.
          level.value = normalizeDb(active.getStatus().metering);
        }
      }

      const elapsedMs = accumulatedMsRef.current + (Date.now() - runStartedAtRef.current);
      const seconds = Math.floor(elapsedMs / 1000);
      if (seconds !== publishedSecondRef.current) {
        publishedSecondRef.current = seconds;
        setDuration(seconds);
      }
    }, SAMPLE_INTERVAL_MS);

    return () => clearInterval(id);
  }, [state, level]);

  const start = useCallback(async () => {
    setState("requesting");

    const permission = await AudioModule.requestRecordingPermissionsAsync();
    if (!permission.granted) {
      setState("denied");
      return;
    }

    // allowsRecording must be set before prepare, and playsInSilentMode keeps
    // capture alive when the ringer switch is off — which it very often is.
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });

    nextIndexRef.current = 0;
    closedCountRef.current = 0;
    openRef.current.clear();
    accumulatedMsRef.current = 0;
    publishedSecondRef.current = -1;

    const target = getTargetSeconds();
    const opened = await prepareSlot(slotA);
    if (opened === null) {
      setState("idle");
      throw new Error("The recorder could not create a file for this meeting.");
    }

    // The first segment starts NOW rather than on a scheduled lead: the user
    // has just pressed record and any deliberate delay is audio they think is
    // being captured. `forDuration` still fixes its stop, which is what lets
    // the successor be scheduled against it.
    //
    // Guarded, because record() throws synchronously when the audio session is
    // unavailable (a call in progress, another app holding the input). This is
    // the one site with a user watching, so the failure becomes the same
    // honest error the prepare failure above raises.
    try {
      slotA.record({ forDuration: target });
    } catch {
      await abandonSlot(slotA);
      setState("idle");
      throw new Error("The microphone is not available right now.");
    }
    activeRef.current = slotA;
    armedRef.current = null;

    runStartedAtRef.current = Date.now();
    setDuration(0);
    setState("recording");
    scheduleRotation(target * ROTATE_AT_FRACTION);
  }, [abandonSlot, getTargetSeconds, prepareSlot, scheduleRotation, slotA]);

  /**
   * Close the current segment and hold.
   *
   * A pause is a legitimate rotation point — there is no audio between pause
   * and resume, so a seam there loses nothing by definition — which is why the
   * scheduled chain is torn down rather than suspended. Trying to keep a
   * `forDuration` deadline alive across a pause would mean reasoning about
   * whether it counts recorded time or wall time, for no benefit.
   */
  const pause = useCallback(() => {
    clearTimers();
    if (runStartedAtRef.current !== 0) {
      accumulatedMsRef.current += Date.now() - runStartedAtRef.current;
      runStartedAtRef.current = 0;
    }

    const active = activeRef.current;
    const armed = armedRef.current;
    armedRef.current = null;
    setState("paused");
    level.value = 0;

    void (async () => {
      // A successor armed for a seam that will now never come. It has no audio
      // in it, so it is discarded rather than harvested.
      if (armed && armed !== active) await abandonSlot(armed);
      if (active) await harvest(active);
    })();
  }, [abandonSlot, clearTimers, harvest, level]);

  const resume = useCallback(() => {
    void (async () => {
      const target = getTargetSeconds();
      const slot = activeRef.current === slotA ? slotB : slotA;

      try {
        const opened = await prepareSlot(slot);
        if (opened === null) return;
      } catch {
        return;
      }

      // Guarded like every other record(): thrown from this async closure it
      // would be an unhandled rejection, and the UI would sit on "paused"
      // believing resume worked. Failing silently leaves it paused — which is
      // also the truth — and the user's next tap retries.
      try {
        slot.record({ forDuration: target });
      } catch {
        void abandonSlot(slot);
        return;
      }
      activeRef.current = slot;
      runStartedAtRef.current = Date.now();
      setState("recording");
      scheduleRotation(target * ROTATE_AT_FRACTION);
    })();
  }, [abandonSlot, getTargetSeconds, prepareSlot, scheduleRotation, slotA, slotB]);

  const stop = useCallback(async () => {
    setState("stopping");
    clearTimers();
    // Only if the clock is actually running. Stopping from PAUSED would
    // otherwise bank the paused interval a second time and report a meeting
    // longer than the audio in it.
    if (runStartedAtRef.current !== 0) {
      accumulatedMsRef.current += Date.now() - runStartedAtRef.current;
      runStartedAtRef.current = 0;
    }
    const durationSec = Math.round(accumulatedMsRef.current / 1000);

    const active = activeRef.current;
    const armed = armedRef.current;
    activeRef.current = null;
    armedRef.current = null;

    // An armed successor has not produced a frame and never will. See
    // abandonSlot: stopping it still writes a 33-byte header, and registering
    // that as a segment would put a permanent hole in the meeting.
    if (armed && armed !== active) await abandonSlot(armed);

    // Awaited, unlike the harvest at a seam. This is the last segment of the
    // meeting and the uploader is about to read the file, so the stop has to
    // have completed rather than merely been asked for.
    if (active) await harvest(active);

    // Release the audio session so playback elsewhere is not left ducked.
    await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);

    setState("idle");
    level.value = 0;

    return { totalSegments: closedCountRef.current, durationSec };
  }, [abandonSlot, clearTimers, harvest, level]);

  const reset = useCallback(() => {
    publishedSecondRef.current = -1;
    accumulatedMsRef.current = 0;
    setDuration(0);
    level.value = 0;
  }, [level]);

  // Timers must not outlive the screen. Without this a rotation callback fires
  // against released recorders after the tab is torn down.
  useEffect(() => clearTimers, [clearTimers]);

  // Memoised because callers put this object in dependency arrays. Returning a
  // fresh literal each render made a useFocusEffect re-fire every render, which
  // called reset(), which set state, which re-rendered — an infinite loop that
  // crashed the app on launch.
  return useMemo(
    () => ({ state, duration, level, start, pause, resume, stop, reset }),
    [state, duration, level, start, pause, resume, stop, reset],
  );
}
