import { useCallback, useEffect, useSyncExternalStore } from "react";
import { AppState } from "react-native";

import { findOrphanedRecordings, discardRecording, resumeRecording } from "./segment-upload";

/**
 * Picking up recordings that outlived the process that made them.
 *
 * This is the payoff for everything else in this feature. Segments are written
 * to Documents and filed under their index as they close, so a crash, a
 * force-quit or an OS memory kill leaves a directory that is a complete and
 * self-describing record of the meeting up to the moment the process died. All
 * that is missing is somebody to send it.
 *
 * Two kinds of orphan, and they deserve different treatment:
 *
 * **It has a meeting id.** The row already exists in the user's library, sitting
 * at `queued`, because it was created the moment they pressed record. They can
 * see it. Nothing is asked, because there is nothing to decide: the only sane
 * outcome is for the meeting they are already looking at to finish. Prompting
 * would be an app asking permission to stop being broken.
 *
 * **It has no meeting id.** Capture ran with no connection and the recording
 * never reached the server, so there is no stuck row and no expectation. That
 * one IS a question — uploading audio the user has never seen acknowledged, on
 * a launch they did not connect to this, should be their call.
 */

/** Enough audio to be worth the round trip. Below this it is a stray tap. */
const MIN_RECOVERABLE_SEGMENTS = 1;

/**
 * How much audio is waiting, in words.
 *
 * Always lands mid-sentence — never at the start of one — because every branch
 * returns lowercase and there is no correct way to capitalise "about 3 minutes"
 * from the call site without a helper that exists only to undo this.
 *
 * An estimate, not a measurement: it is segment count × target length, so the
 * final partial segment is over-counted by up to one segment. That is fine for
 * "is my audio still here", which is the only question this answers.
 */
function describe(segmentCount: number, targetSeconds: number): string {
  const seconds = segmentCount * targetSeconds;
  // 90 was the old threshold for "under a minute", which called 75 seconds of
  // audio less than a minute. Wrong in the one direction that matters: it
  // undersells what survived, to someone deciding whether it is worth keeping.
  if (seconds < 60) return "under a minute";
  if (seconds < 90) return "about a minute";
  return `about ${Math.round(seconds / 60)} minutes`;
}

/**
 * The one interrupted recording currently waiting on the user, or null.
 *
 * A banner in the library reads this, rather than the sweep throwing an
 * `Alert.alert` the instant the app foregrounds. An alert on launch is a modal
 * ambush — it steals the first tap and blocks the whole UI over a question that
 * is genuinely optional — where a banner sits quietly at the top of the list
 * until the user is ready to answer it. The "already has a meeting id" orphan is
 * still resumed silently; only the never-uploaded one, which is a real question,
 * reaches this store.
 */
export interface PendingRecovery {
  localId: string;
  title: string;
  /** Mid-sentence, e.g. "about 3 minutes"; from `describe`. */
  audio: string;
}

let pending: PendingRecovery | null = null;
const recoveryListeners = new Set<() => void>();

function setPending(next: PendingRecovery | null): void {
  // Reference identity is the change signal for useSyncExternalStore; re-setting
  // the same orphan on a later sweep must not notify or the banner re-animates.
  if (pending?.localId === next?.localId) return;
  pending = next;
  recoveryListeners.forEach((listener) => listener());
}

function subscribeRecovery(listener: () => void): () => void {
  recoveryListeners.add(listener);
  return () => {
    recoveryListeners.delete(listener);
  };
}

/** Reactive read of the waiting recovery, for the banner. */
export function useRecovery(): PendingRecovery | null {
  return useSyncExternalStore(subscribeRecovery, () => pending);
}

/** Upload it. Clears the banner first, then sweeps again for the next orphan. */
export async function acceptRecovery(): Promise<void> {
  const current = pending;
  if (!current) return;
  setPending(null);
  await resumeRecording(current.localId).catch(() => undefined);
  void recoverInterruptedRecordings().catch(() => undefined);
}

/** Discard it. Same shape as accept, so one orphan is resolved per tap. */
export async function dismissRecovery(): Promise<void> {
  const current = pending;
  if (!current) return;
  setPending(null);
  await discardRecording(current.localId).catch(() => undefined);
  void recoverInterruptedRecordings().catch(() => undefined);
}

/**
 * Sweep once.
 *
 * Exported separately from the hook so it can be driven by something other than
 * a screen mount if this ever needs to run somewhere the Record tab is not.
 */
/**
 * True while a recording is actually being captured.
 *
 * Module-level rather than a prop, because the sweep now runs from the tab
 * LAYOUT — so that an interrupted recording is found on launch even though
 * Meetings is the first tab and the user may never open Record — and the layout
 * has no idea whether the recorder is running.
 *
 * The hazard it closes is specific: a sweep that fires while a session is
 * writing segments would hand a second uploader the same directory and the same
 * indexes as the live one.
 */
let recordingActive = false;

/** Set by the Record screen. See `recordingActive`. */
export function setRecordingActive(active: boolean): void {
  recordingActive = active;
}

/**
 * One sweep at a time, process-wide.
 *
 * This used to be a ref inside the hook, which made it one sweep per MOUNTED
 * HOOK — fine while exactly one screen called it, and silently wrong the moment
 * a second did, which is what mounting it in the layout does.
 */
let sweeping = false;

export async function recoverInterruptedRecordings(): Promise<void> {
  if (sweeping || recordingActive) return;
  sweeping = true;
  try {
    await sweepOnce();
  } finally {
    sweeping = false;
  }
}

async function sweepOnce(): Promise<void> {
  for (const orphan of findOrphanedRecordings()) {
    if (orphan.segmentCount < MIN_RECOVERABLE_SEGMENTS) {
      await discardRecording(orphan.manifest.localId).catch(() => undefined);
      continue;
    }

    if (orphan.manifest.meetingId) {
      // Already in their library and stuck. Just finish it.
      await resumeRecording(orphan.manifest.localId).catch(() => undefined);
      continue;
    }

    // Never reached the server. Ask — through the banner, not a modal alert.
    setPending({
      localId: orphan.manifest.localId,
      title: orphan.manifest.title,
      audio: describe(orphan.segmentCount, orphan.manifest.targetSeconds),
    });
    // One question at a time. The banner resolves this orphan and re-sweeps for
    // the next, so a launch with several interrupted recordings surfaces them
    // one banner after another rather than stacking.
    return;
  }
}

/**
 * Run the sweep on mount and whenever the app comes back to the foreground.
 *
 * Foreground as well as mount because the interesting case is the app being
 * killed while suspended: it returns to the same JS runtime only sometimes, and
 * a cold start after a background kill arrives as an `active` transition rather
 * than as a fresh mount of anything the user navigated to.
 */
export function useRecordingRecovery(): void {
  // Both guards — one sweep at a time, and never during capture — live in
  // recoverInterruptedRecordings itself, so calling this from more than one
  // place is safe and a fast background/foreground cycle cannot start a second.
  const sweep = useCallback(() => {
    void recoverInterruptedRecordings().catch(() => undefined);
  }, []);

  useEffect(() => {
    sweep();

    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") sweep();
    });
    return () => subscription.remove();
  }, [sweep]);
}
