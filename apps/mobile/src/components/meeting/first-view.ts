import { useEffect, useState } from "react";

/**
 * First-view registry.
 *
 * The count-up on the score and the meters filling from empty are worth exactly
 * one showing: they mark the moment the analysis is revealed. The detail screen
 * remounts this tree every time the segmented control flips, so without a
 * registry the number would re-count on every tab tap, which turns a moment into
 * a tic.
 *
 * Keyed by meeting id and process-scoped on purpose. Coming back to the same
 * meeting later in the same session should feel like returning to a document,
 * not like opening it for the first time again.
 */

const seen = new Set<string>();

/** Bounded so a long session browsing hundreds of meetings cannot grow forever. */
const LIMIT = 128;

/**
 * True only for the first mount of this meeting in this process.
 *
 * The value is captured in state rather than read during render so it stays
 * stable for the life of the mount, including the frame where the effect below
 * records the id.
 */
export function useFirstView(id: string): boolean {
  const [first] = useState(() => !seen.has(id));

  useEffect(() => {
    if (seen.size >= LIMIT) seen.clear();
    seen.add(id);
  }, [id]);

  return first;
}
