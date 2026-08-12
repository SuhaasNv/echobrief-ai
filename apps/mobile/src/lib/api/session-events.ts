/**
 * Minimal pub/sub replacing the web client's `window.dispatchEvent(CustomEvent)`.
 *
 * React Native has no DOM event target. This exists so the API client can
 * signal session changes without importing React or a navigation library —
 * keeping the dependency arrow pointing one way (UI depends on api, never the
 * reverse).
 */

export type SessionEvent = "unauthorized" | "workspace-reset";

type Listener = (event: SessionEvent) => void;

const listeners = new Set<Listener>();

export function emitSessionEvent(event: SessionEvent): void {
  for (const listener of listeners) {
    listener(event);
  }
}

/** Returns an unsubscribe function, suitable for a useEffect cleanup. */
export function subscribeToSessionEvents(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
