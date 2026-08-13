import { useSyncExternalStore } from "react";

/**
 * Where a meeting's in-flight upload reports itself.
 *
 * Both ways of creating a meeting — the recorder and the file importer — used to
 * hold their own screen hostage behind a full-screen "Uploading 87%", run it to
 * 100, and only then push to the meeting. The meeting screen's own progress ring
 * then started again at zero. One continuous wait, rendered in two visual
 * languages, the second of which looked like the first had failed.
 *
 * So the upload no longer owns a screen. Both paths navigate to the meeting the
 * instant it exists server-side (the presign creates the row, before any bytes
 * move), and publish their progress here. The meeting screen reads it and shows
 * ONE ring that climbs 0 → 100 across the upload and the pipeline together.
 *
 * Module-level rather than React state, deliberately: the upload outlives the
 * screen that started it. That is the whole point — the user is meant to be free
 * to leave — so the progress cannot live in a component that unmounts, and it
 * cannot live in React Query either, because it is not a server value and
 * refetching it means nothing.
 *
 * Keyed by meeting id, because two uploads can genuinely overlap: end a
 * recording, land on its meeting, go back, import a file. Neither may report
 * over the other.
 */

/**
 * An upload the client has not yet confirmed to the server.
 *
 * `failed` is a terminal state that must survive the screen: the user is already
 * on the meeting when it happens, so an Alert fired from the screen they left is
 * not an option. The meeting screen renders this and offers the retry.
 */
export interface UploadState {
  /** 0–1 of bytes transferred. */
  ratio: number;
  status: "uploading" | "failed";
  /** Shown with the retry when `status` is "failed". */
  error?: string;
}

type Listener = () => void;

const states = new Map<string, UploadState>();
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Begin reporting for a meeting. Safe to call twice; a retry resets to 0. */
export function beginUpload(meetingId: string): void {
  states.set(meetingId, { ratio: 0, status: "uploading" });
  emit();
}

/**
 * Report transferred bytes, 0–1.
 *
 * Ignored once the entry is gone, so a late callback from an upload that already
 * finished cannot resurrect a progress bar on a meeting that is being
 * transcribed. Clamped rather than trusted: a segmented upload computes this
 * from a running total and an off-by-one there would drive the ring past full.
 */
export function reportUpload(meetingId: string, ratio: number): void {
  const current = states.get(meetingId);
  if (!current || current.status === "failed") return;

  const clamped = Math.max(0, Math.min(1, ratio));
  // Progress must not run backwards. Segments complete out of order, so a naive
  // sum can dip when a retried chunk re-reports from zero.
  if (clamped <= current.ratio) return;

  states.set(meetingId, { ...current, ratio: clamped });
  emit();
}

/** The upload failed. The audio is still on the device; the meeting offers a retry. */
export function failUpload(meetingId: string, error: string): void {
  const current = states.get(meetingId);
  states.set(meetingId, { ratio: current?.ratio ?? 0, status: "failed", error });
  emit();
}

/**
 * The server has the audio. Stop reporting and hand the meeting to the pipeline.
 *
 * Called on the CONFIRM, not on the last byte: between the final PUT and the
 * server acknowledging it there is a round trip during which the upload is not
 * finished, and clearing early would show the pipeline as started before it was.
 */
export function finishUpload(meetingId: string): void {
  if (!states.delete(meetingId)) return;
  emit();
}

/** Read one meeting's upload state. `undefined` means nothing is in flight. */
export function useUploadState(meetingId: string): UploadState | undefined {
  return useSyncExternalStore(
    subscribe,
    () => states.get(meetingId),
    () => undefined,
  );
}

/** Non-reactive read, for callers outside render. */
export function peekUploadState(meetingId: string): UploadState | undefined {
  return states.get(meetingId);
}
