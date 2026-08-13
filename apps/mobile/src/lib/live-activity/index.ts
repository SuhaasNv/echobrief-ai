import { NativeModule, requireOptionalNativeModule } from "expo";

/**
 * Recording Live Activity — Dynamic Island and Lock Screen.
 *
 * EVERY EXPORT HERE IS A NO-OP WHEN THE ACTIVITY CANNOT RUN, and that is the
 * point of the file. The failure modes are ordinary, not exceptional:
 *
 *   - Android, and any platform where the native module is not linked at all,
 *     so `requireOptionalNativeModule` returns null.
 *   - iOS below 16.1, which has no ActivityKit.
 *   - A user who has turned Live Activities off for EchoBrief in Settings,
 *     which `areActivitiesEnabled` reports as false at any time.
 *   - `Activity.request` throwing because the app is not in the foreground.
 *
 * None of those are errors the recording flow should ever hear about. Someone
 * is capturing a meeting; losing the island decoration is a shrug, losing the
 * recording is not. So nothing here throws and nothing here rejects.
 *
 * The Dynamic Island only ever monitors a recording that is ALREADY running.
 * There is no start affordance and there cannot be one — a widget extension
 * cannot activate the microphone, and iOS will not let an intent begin capture
 * for an app that is not already recording. See
 * targets/live-activity/RecordingIntents.swift.
 */

/** What the island's buttons ask the app to do. */
export type RecordingControl = "pause" | "resume" | "end";

type Events = {
  onRecordingControl: () => void;
};

declare class EchoBriefLiveActivityModule extends NativeModule<Events> {
  areActivitiesEnabled(): boolean;
  startActivity(title: string): boolean;
  setPaused(paused: boolean): void;
  endActivity(): void;
  drainPendingControls(): string[];
}

// Optional, not required: on Android — and in any JS-only context such as a
// test runner — there is no such native module, and asking for it must not
// crash the import.
const native = requireOptionalNativeModule<EchoBriefLiveActivityModule>("EchoBriefLiveActivity");

/**
 * True when a Live Activity would actually appear.
 *
 * Not just a device check. The Dynamic Island is iPhone 14 Pro and later, but
 * Live Activities show on the Lock Screen from the SE up, and the user can
 * revoke them at any time — so this is asked fresh rather than cached.
 */
export function areRecordingActivitiesEnabled(): boolean {
  try {
    return native?.areActivitiesEnabled() ?? false;
  } catch {
    return false;
  }
}

/**
 * Show the recording as live. Safe to call twice; the second call is ignored
 * rather than starting a second pill.
 */
export function startRecordingActivity({ title }: { title: string }): void {
  try {
    native?.startActivity(title);
  } catch {
    // Deliberately swallowed. See the file header: the recording matters, the
    // decoration does not.
  }
}

/** Freeze or resume the island's clock. Ignored when nothing is showing. */
export function updateRecordingActivity({ paused }: { paused: boolean }): void {
  try {
    native?.setPaused(paused);
  } catch {
    // Deliberately swallowed.
  }
}

/**
 * Take the pill down.
 *
 * Cheap and idempotent, so callers should err towards calling it: a stale
 * "recording" pill stuck in someone's Dynamic Island is a genuinely bad bug,
 * and an extra call costs nothing.
 */
export function endRecordingActivity(): void {
  try {
    native?.endActivity();
  } catch {
    // Deliberately swallowed.
  }
}

/**
 * Listen for the island's Pause / Resume / End buttons.
 *
 * The native event carries no payload; it only says something is waiting. The
 * queue is drained here instead, and drained once on subscribe as well — iOS
 * can relaunch the app to perform one of these intents, in which case the
 * action lands before any React code has run. Reading a payload off the event
 * would drop it.
 *
 * Returns an unsubscribe function, so it drops straight into a useEffect.
 */
export function subscribeToRecordingControls(
  handler: (control: RecordingControl) => void,
): () => void {
  if (!native) return () => undefined;

  const drain = () => {
    let queued: string[];
    try {
      queued = native.drainPendingControls();
    } catch {
      return;
    }
    for (const action of queued) {
      if (action === "pause" || action === "resume" || action === "end") {
        handler(action);
      }
    }
  };

  const subscription = native.addListener("onRecordingControl", drain);
  drain();

  return () => subscription.remove();
}
