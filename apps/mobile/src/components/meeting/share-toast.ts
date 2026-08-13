import { useSyncExternalStore } from "react";

/**
 * The one-line confirmation the share actions leave behind.
 *
 * It is a module-scope store rather than screen state for two reasons. The
 * first is structural: the action sheet is presented from the header button,
 * which renders inside the native navigation bar, so a confirmation it owned
 * would be clipped by the bar — the note has to be drawn by the screen, and the
 * two have no ancestor between them worth threading a prop through.
 *
 * The second is cost. The meeting screen's render includes the entire
 * transcript, and lifting this into `useState` there would re-render 800 rows
 * to fade in a pill. The playback controller and follow-scroll are external
 * stores for exactly this reason; so is the delete registry in lib/api/meetings.
 *
 * There is only ever one note. A second confirmation replaces the first rather
 * than stacking, because two pills arguing over the same 40pt of screen is
 * worse than losing the older message — and the older message has by then been
 * true for a second and a half.
 */

export interface ShareToastNote {
  /**
   * Bumped on every show. Copying the same summary twice produces an identical
   * message, and without a changing identity the second one would neither
   * replay the entrance nor restart the dismissal timer.
   */
  id: number;
  message: string;
}

let note: ShareToastNote | null = null;
let nextId = 0;
const listeners = new Set<() => void>();

function publish(next: ShareToastNote | null): void {
  note = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function showShareToast(message: string): void {
  publish({ id: (nextId += 1), message });
}

export function dismissShareToast(): void {
  if (note) publish(null);
}

/**
 * Reactive read, for the view that draws it.
 *
 * The snapshot is the note object itself, whose identity changes only on
 * publish — returning a fresh object per call would fail useSyncExternalStore's
 * Object.is check and loop.
 */
export function useShareToastNote(): ShareToastNote | null {
  return useSyncExternalStore(subscribe, () => note);
}
