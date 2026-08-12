/**
 * Single source of truth for processing progress.
 *
 * The meetings list and the meeting detail page both show "this meeting is
 * being processed". They used to compute progress two different ways — the
 * list from its own hardcoded status→percent table, the detail page from the
 * count of completed steps — so the same meeting read 30% in one place and 25%
 * in the other at the same moment. Both now call these.
 *
 * Kept separate from the component file so the constants can be imported
 * without tripping react-refresh's components-only rule.
 */

/** Project-standard easing, tuple-typed so strict TS accepts it as a cubic bezier. */
export const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * Canonical status → percent, keyed by the `status` string the API returns.
 * Both `GET /meetings` and `GET /meetings/:id/status` carry it — unlike the
 * `progress` object, which only the status endpoint returns.
 */
const STATUS_PERCENT: Record<string, number> = {
  queued: 5,
  transcribing: 30,
  analyzing: 60,
  indexing: 85,
  complete: 100,
  failed: 0,
};

const STATUS_LABEL: Record<string, string> = {
  queued: "Queued · waiting for a free worker",
  transcribing: "Transcribing audio with AssemblyAI",
  analyzing: "Extracting summary + action items",
  indexing: "Indexing for semantic search",
};

export function percentForStatus(status: string | undefined): number {
  if (!status) return 5;
  return STATUS_PERCENT[status] ?? 5;
}

export function labelForStatus(status: string | undefined): string {
  if (!status) return "Processing";
  return STATUS_LABEL[status] ?? status;
}

/** True while a meeting is still moving through the pipeline. */
export function isProcessingStatus(status: string | undefined): boolean {
  return !!status && status !== "complete" && status !== "failed";
}
