import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useQuery } from "@tanstack/react-query";

import { reconcilePendingMeetings, suppressMeetingAnnouncement } from "@/lib/notifications/notify";

import { api } from "./client";
import type { MeetingSummary } from "./meetings";

/**
 * GET /meetings/:id/status — the pipeline's own view of a meeting.
 *
 * Separate from the detail query on purpose. The detail endpoint returns the
 * whole meeting (transcript, summary, speakers) and is expensive to poll; this
 * one returns four booleans and an estimate, so it can be hit every 5s while
 * someone watches a recording process.
 */

export type MeetingStatus = MeetingSummary["status"];

export interface MeetingProgress {
  uploaded: boolean;
  transcribed: boolean;
  analyzed: boolean;
  indexed: boolean;
}

/** Mirrors MeetingStatusResponse in packages/shared/src/schemas.ts. */
export interface MeetingStatusResponse {
  id: string;
  status: MeetingStatus;
  progress: MeetingProgress;
  estimated_seconds_remaining: number | null;
  failure_reason: string | null;
}

/**
 * Canonical status → percent.
 *
 * These numbers are NOT a design decision, they are the same table the web app
 * reads (src/lib/processing-status.ts). If they drift, the same meeting reports
 * one figure on the phone and another in the browser at the same instant, and
 * the user is right to trust neither.
 */
const STATUS_PERCENT: Record<MeetingStatus, number> = {
  queued: 5,
  transcribing: 30,
  analyzing: 60,
  indexing: 85,
  complete: 100,
  failed: 0,
};

/**
 * Plain-language stage label. Says what the machine is doing right now, in
 * words someone who has never heard of a worker queue can act on.
 */
const STATUS_LABEL: Record<MeetingStatus, string> = {
  queued: "Queued, waiting for a free worker",
  transcribing: "Transcribing audio",
  analyzing: "Extracting summary and action items",
  indexing: "Indexing for search",
  complete: "Finished",
  failed: "Processing failed",
};

export function percentForStatus(status: MeetingStatus | undefined): number {
  return status ? STATUS_PERCENT[status] : STATUS_PERCENT.queued;
}

/**
 * Percent for a meeting whose audio has not finished uploading.
 *
 * Occupies the 0–5 band BELOW `queued`, which is the first status the server can
 * report. That band is free precisely because nothing server-side exists to
 * describe until the audio lands, so borrowing it costs nothing and — the point
 * — leaves the table above untouched, so the phone and the browser still agree
 * about every status they both know about.
 *
 * The effect is that the ring climbs 0 → 100 exactly once. Before this, upload
 * ran a full-screen indicator to 100% and then the meeting screen started again
 * at zero, which made one continuous wait look like the first half had failed.
 *
 * Deliberately a small band. The upload is seconds and the pipeline is minutes,
 * so giving the transfer a third of the ring would misrepresent the wait — the
 * bar would leap to 33 and then appear to stall for two minutes.
 */
export function percentForUpload(ratio: number): number {
  return Math.max(0, Math.min(1, ratio)) * STATUS_PERCENT.queued;
}

/** Stage label while the audio is still on its way up. */
export const UPLOAD_LABEL = "Uploading audio";

export function labelForStatus(status: MeetingStatus | undefined): string {
  return status ? STATUS_LABEL[status] : "Processing";
}

/** Terminal states stop the poll. Nothing about them will change on its own. */
export function isTerminalStatus(status: MeetingStatus | undefined): boolean {
  return status === "complete" || status === "failed";
}

/**
 * Announce the moment this poll sees a meeting reach a terminal state.
 *
 * Lives inside useMeetingStatus rather than at the call site so that every
 * screen watching a meeting gets it without having to remember to opt in.
 *
 * Three rules, each of which exists because the naive version is wrong:
 *
 *   Only a real TRANSITION counts. Opening a meeting that finished last week
 *   would otherwise fire a notification for old news, so a first observation
 *   that is already terminal is ignored.
 *
 *   If the app is ACTIVE, suppress instead of notifying. The user is looking at
 *   the screen that just updated; telling them about it is noise. Suppressing
 *   still consumes the idempotency claim, which is what stops the background
 *   task announcing the same meeting later.
 *
 *   Otherwise reconcile rather than notify directly. The status endpoint knows
 *   the status but not the title or the action item count, and a notification
 *   without those is the "Processing complete" non-message. Reconcile fetches
 *   the list, which carries all three.
 *
 * Worth being clear about the scope of this path: iOS suspends JS timers when
 * the app backgrounds, so this poll is NOT running while the user is away. It
 * catches the narrow window where the app is resident and the transition lands
 * before suspension. The foreground reconcile and the background task cover the
 * rest.
 */
function useTerminalStatusNotice(id: string, status: MeetingStatus | undefined): void {
  const previous = useRef<MeetingStatus | undefined>(undefined);

  useEffect(() => {
    const prior = previous.current;
    previous.current = status;

    if (!status || !isTerminalStatus(status)) return;
    // No prior observation, or it was already terminal: not a transition.
    if (prior === undefined || isTerminalStatus(prior)) return;

    if (AppState.currentState === "active") {
      void suppressMeetingAnnouncement(id).catch(() => undefined);
      return;
    }

    void reconcilePendingMeetings().catch(() => undefined);
  }, [id, status]);
}

export function useMeetingStatus(id: string, enabled = true) {
  const query = useQuery({
    queryKey: ["meeting", id, "status"],
    queryFn: () => api.apiRequest<MeetingStatusResponse>(`/meetings/${id}/status`),
    enabled: enabled && Boolean(id),
    // Cheap enough to poll tightly, and this screen exists precisely because
    // someone is waiting. Stops dead once the meeting reaches a terminal state.
    refetchInterval: (query) => (isTerminalStatus(query.state.data?.status) ? false : 5_000),
    // The whole point is freshness; the client-wide 30s staleTime would let a
    // remount serve a cached stage that has since moved on.
    staleTime: 0,
  });

  useTerminalStatusNotice(id, query.data?.status);

  return query;
}

/**
 * Local countdown.
 *
 * `estimated_seconds_remaining` is a CONSTANT per meeting: the server derives
 * it from duration and returns the identical number on every poll. Rendered
 * raw, it sits at "about 4 min left" for four minutes and the screen looks
 * frozen, which on a slow job is the difference between "working" and "broken".
 *
 * So the estimate seeds a local clock once per stage and the clock runs down
 * on its own. Two rules follow from that:
 *
 *   Never re-seed inside a stage. Every poll carries the same number, and
 *   re-seeding on each one would snap the countdown back to its start every
 *   5 seconds, which is worse than a frozen number.
 *
 *   Count from a deadline, not by subtracting 1. iOS suspends JS timers the
 *   moment the app is backgrounded, so a decrementing counter comes back three
 *   minutes later still showing what it showed on the way out.
 *
 * Floors at 0 rather than going negative — an estimate is an estimate, and
 * "Almost done" is the honest thing to say once it runs out.
 */
export function useStageCountdown(
  stage: MeetingStatus | undefined,
  estimatedSeconds: number | null | undefined,
  running: boolean,
): number | null {
  const [remaining, setRemaining] = useState<number | null>(null);
  const seed = useRef<{ stage: MeetingStatus; deadline: number } | null>(null);

  useEffect(() => {
    if (!stage) return;

    // Already seeded for this stage: ignore the repeat of the same estimate.
    if (seed.current?.stage === stage) return;

    const seconds = estimatedSeconds ?? null;
    if (seconds === null) {
      // No estimate available (duration unknown). Leave the slot unseeded so a
      // later poll that does carry one can still start the clock.
      seed.current = null;
      setRemaining(null);
      return;
    }

    seed.current = { stage, deadline: Date.now() + seconds * 1000 };
    setRemaining(seconds);
  }, [stage, estimatedSeconds]);

  useEffect(() => {
    if (!running) return;

    const id = setInterval(() => {
      const current = seed.current;
      if (!current) return;
      setRemaining(Math.max(0, Math.round((current.deadline - Date.now()) / 1000)));
    }, 1000);

    return () => clearInterval(id);
  }, [running]);

  return remaining;
}

/**
 * Countdown copy. Under a minute it counts seconds so the number visibly
 * moves; above that it reads as a clock, which also moves every second and
 * avoids "about 1 min left" hanging around for 119 seconds.
 */
export function formatCountdown(seconds: number | null): string | null {
  if (seconds === null) return null;
  if (seconds <= 0) return "Almost done";
  if (seconds < 60) return `About ${seconds} sec left`;

  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `About ${minutes}:${String(rest).padStart(2, "0")} left`;
}
