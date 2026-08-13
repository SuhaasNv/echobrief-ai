import * as SecureStore from "expo-secure-store";

/**
 * Persisted notification bookkeeping.
 *
 * Three things live here, all of which must survive the process dying:
 *
 *   `pending`  — meetings uploaded but not yet resolved. The background task has
 *                no React state to read, so the list of things worth checking
 *                has to be on disk.
 *   `notified` — the idempotency ledger. A meeting may be seen as finished by
 *                the foreground poll AND by the background task, and the task
 *                itself can be run twice by iOS. Two "your transcript is ready"
 *                banners for one meeting reads as a broken app, so every
 *                announcement is claimed against this list first.
 *   preference — the user-facing toggle plus whether we have already used up
 *                our one shot at the system permission prompt.
 *
 * Stored in SecureStore rather than a plain file for one specific reason: it is
 * the only key/value store already in this app that is readable while the phone
 * is LOCKED. AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY matches token-store.ts, and a
 * background task firing on a locked phone is the normal case, not the edge
 * case. If this were WHEN_UNLOCKED the task would silently read nothing.
 */

const STATE_KEY = "echobrief-notification-state";

const KEYCHAIN_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export interface PendingMeeting {
  id: string;
  /** Captured at upload so a notification can name the meeting with no network. */
  title: string;
  /** ms epoch. Used to expire meetings the pipeline never resolved. */
  queuedAt: number;
}

export interface NotificationState {
  /** User-facing toggle. Independent of the OS permission. */
  enabled: boolean;
  /** iOS grants exactly one system prompt. This records that we spent it. */
  askedForPermission: boolean;
  pending: PendingMeeting[];
  notified: string[];
}

const DEFAULT_STATE: NotificationState = {
  enabled: true,
  askedForPermission: false,
  pending: [],
  notified: [],
};

/**
 * Bounds. The ledger must not grow forever, but it also must not forget an id
 * that could still be announced. 200 is far beyond the number of meetings that
 * could plausibly be in flight, and entries are also dropped explicitly when a
 * meeting is deleted (see forgetMeeting).
 */
const MAX_NOTIFIED = 200;
const MAX_PENDING = 50;
/** A meeting stuck for a day is never going to resolve; stop waking up for it. */
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

let cache: NotificationState | null = null;

/**
 * Every mutation runs through this queue.
 *
 * claimNotification does read-modify-write across an `await`, and the whole
 * point of it is to be atomic. Without serialisation the background task and a
 * foreground poll landing together could both read a ledger without the id,
 * both decide they are first, and both post. JS being single-threaded does not
 * save us: the await is exactly where the interleave happens.
 */
let queue: Promise<void> = Promise.resolve();

function serialize<T>(work: () => Promise<T>): Promise<T> {
  const result = queue.then(work, work);
  // Keep the chain alive regardless of outcome, and never leave it rejected.
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function parsePending(value: unknown): PendingMeeting[] {
  if (!Array.isArray(value)) return [];

  const parsed: PendingMeeting[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const { id, title, queuedAt } = entry;
    if (typeof id !== "string" || typeof title !== "string" || typeof queuedAt !== "number") {
      continue;
    }
    parsed.push({ id, title, queuedAt });
  }
  return parsed;
}

/**
 * Defensive by design: this blob is written by older builds of the app and read
 * by newer ones. A shape change must degrade to "notify again", never to a
 * crash on launch inside a background task nobody can attach a debugger to.
 */
function parseState(raw: string): NotificationState {
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) return { ...DEFAULT_STATE };

    return {
      enabled: typeof value.enabled === "boolean" ? value.enabled : DEFAULT_STATE.enabled,
      askedForPermission:
        typeof value.askedForPermission === "boolean" ? value.askedForPermission : false,
      pending: parsePending(value.pending),
      notified: parseStringArray(value.notified),
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

async function readState(): Promise<NotificationState> {
  if (cache) return cache;

  const raw = await SecureStore.getItemAsync(STATE_KEY, KEYCHAIN_OPTIONS).catch(() => null);
  cache = raw === null ? { ...DEFAULT_STATE } : parseState(raw);
  return cache;
}

type Listener = (state: NotificationState) => void;
const listeners = new Set<Listener>();

/** Lets a settings toggle re-render when the preference changes anywhere else. */
export function subscribeToNotificationState(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

async function writeState(next: NotificationState): Promise<void> {
  cache = next;

  await SecureStore.setItemAsync(STATE_KEY, JSON.stringify(next), KEYCHAIN_OPTIONS).catch(() => {
    // A failed write means we might re-announce a meeting after a cold start.
    // Annoying, not broken. Throwing here would fail the caller's upload.
  });

  for (const listener of listeners) listener(next);
}

/** Read the whole state. Cheap after the first call. */
export function getNotificationState(): Promise<NotificationState> {
  return serialize(readState);
}

/* -------------------------------------------------------------------------- */
/* Preference                                                                  */
/* -------------------------------------------------------------------------- */

export function getNotificationsEnabled(): Promise<boolean> {
  return serialize(async () => (await readState()).enabled);
}

export function setNotificationsEnabled(enabled: boolean): Promise<void> {
  return serialize(async () => {
    const state = await readState();
    await writeState({ ...state, enabled });
  });
}

export function hasAskedForPermission(): Promise<boolean> {
  return serialize(async () => (await readState()).askedForPermission);
}

export function markPermissionAsked(): Promise<void> {
  return serialize(async () => {
    const state = await readState();
    if (state.askedForPermission) return;
    await writeState({ ...state, askedForPermission: true });
  });
}

/* -------------------------------------------------------------------------- */
/* Pending meetings                                                            */
/* -------------------------------------------------------------------------- */

export function getPendingMeetings(): Promise<PendingMeeting[]> {
  return serialize(async () => {
    const state = await readState();
    const cutoff = Date.now() - PENDING_TTL_MS;
    const fresh = state.pending.filter((entry) => entry.queuedAt > cutoff);

    if (fresh.length !== state.pending.length) {
      await writeState({ ...state, pending: fresh });
    }
    return fresh;
  });
}

export function addPendingMeeting(meeting: { id: string; title: string }): Promise<void> {
  return serialize(async () => {
    const state = await readState();

    // Never re-queue something already announced: an upload retry that reuses a
    // meeting id must not resurrect a finished notification.
    if (state.notified.includes(meeting.id)) return;
    if (state.pending.some((entry) => entry.id === meeting.id)) return;

    const pending = [
      ...state.pending,
      { id: meeting.id, title: meeting.title, queuedAt: Date.now() },
    ].slice(-MAX_PENDING);

    await writeState({ ...state, pending });
  });
}

export function removePendingMeeting(id: string): Promise<void> {
  return serialize(async () => {
    const state = await readState();
    if (!state.pending.some((entry) => entry.id === id)) return;

    await writeState({ ...state, pending: state.pending.filter((entry) => entry.id !== id) });
  });
}

/* -------------------------------------------------------------------------- */
/* Idempotency ledger                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Atomically claim the right to announce a meeting.
 *
 * Returns true exactly once per meeting id, for the lifetime of the ledger. The
 * claim is persisted BEFORE the notification is presented, so a crash between
 * the two loses a notification rather than duplicating one. That is the correct
 * trade: a missing banner is invisible, a doubled one is a bug report.
 *
 * Also drops the meeting from `pending` in the same write, so the background
 * task stops considering it.
 */
export function claimNotification(id: string): Promise<boolean> {
  return serialize(async () => {
    const state = await readState();
    if (state.notified.includes(id)) return false;

    await writeState({
      ...state,
      pending: state.pending.filter((entry) => entry.id !== id),
      notified: [...state.notified, id].slice(-MAX_NOTIFIED),
    });
    return true;
  });
}

/** Hand back a claim when presenting failed, so a later pass can retry. */
export function releaseNotification(id: string): Promise<void> {
  return serialize(async () => {
    const state = await readState();
    if (!state.notified.includes(id)) return;

    await writeState({ ...state, notified: state.notified.filter((entry) => entry !== id) });
  });
}

/**
 * Forget a meeting entirely.
 *
 * Called when a meeting is deleted, including the rollback path in upload.ts
 * where a failed PUT deletes the row it just created. Without this the ledger
 * accumulates ids for meetings that no longer exist.
 */
export function forgetMeeting(id: string): Promise<void> {
  return serialize(async () => {
    const state = await readState();
    const pending = state.pending.filter((entry) => entry.id !== id);
    const notified = state.notified.filter((entry) => entry !== id);

    if (pending.length === state.pending.length && notified.length === state.notified.length) {
      return;
    }
    await writeState({ ...state, pending, notified });
  });
}

/** Drop everything. For sign-out, so one user's ledger cannot leak into another's. */
export function clearNotificationState(): Promise<void> {
  return serialize(async () => {
    await writeState({ ...DEFAULT_STATE });
  });
}
