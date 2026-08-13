/**
 * Turning a routed intent into a plan the client can act on.
 *
 * Stage 2 of the design described in lib/ask-actions.ts: no model runs in this
 * file. Candidate rows are read with the same `user_id + workspace_id` predicate
 * every other route uses — that pair is the only thing standing between a caller
 * and another tenant's rows, since these tables have no RLS — and the choice
 * between them is made by `resolveTarget`, which is a scoring function.
 *
 * THE CONFIRMATION BOUNDARY IS DRAWN HERE, and it is drawn on one question: can
 * the user put this back themselves, immediately, without help?
 *
 *   complete_action_item  -> "run".     The row still exists; one tap re-opens
 *                                       it. PATCHing an explicit `completed` is
 *                                       idempotent, so the undo is safe to
 *                                       repeat.
 *   rename_meeting        -> "run".     Nothing is lost. The plan carries the
 *                                       previous title verbatim, so the undo
 *                                       restores the exact string rather than
 *                                       whatever a cache happens to hold.
 *   delete_meeting        -> "confirm". The audio object in R2 is destroyed and
 *                                       the transcript, summary, chunks and
 *                                       action items cascade away. There is no
 *                                       server-side restore to offer, so this
 *                                       is never performed on inference.
 *
 * The line is recoverability, not severity, and it is a line about consequences
 * rather than about confidence. A resolution the matcher was sure of still does
 * not get to delete a recording, because "sure" and "right" are different
 * things and only one of them is observable from here.
 *
 * Above that line sits a rule that applies to all three: an ambiguous target
 * never executes, whatever the verb. A wrongly-ticked task is cheap to fix, but
 * an app that silently picks between three plausible readings of your sentence
 * is one you stop trusting with the readings you cannot check.
 */

import { getSql } from "../db";
import {
  MAX_CANDIDATES,
  resolveTarget,
  type AskIntentStructured,
  type TargetResolution,
} from "../lib/ask-actions";
import type { AskActionCandidate, AskActionPlan } from "@echobrief/shared";

interface ActionItemRow {
  id: string;
  description: string;
  completed: boolean;
  meeting_title: string;
  meeting_date: string | null;
}

interface MeetingRow {
  id: string;
  title: string;
  occurred_at: string | null;
  duration_sec: number | null;
}

/**
 * Ceiling on the candidate pool.
 *
 * Scoring is linear and cheap, so this is about the SQL and about honesty: an
 * account with thousands of rows would be matched against only some of them
 * either way, and the recent ones are overwhelmingly what a spoken instruction
 * refers to. A miss degrades to "I couldn't find that", which is a safe answer.
 */
const CANDIDATE_POOL = 200;

/** "8 min" / "1 hr 4 min". No timezone in it, so the server may compose it. */
function formatDuration(seconds: number | null): string | null {
  if (seconds === null || seconds <= 0) return null;
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

function actionItemCandidate(row: ActionItemRow): AskActionCandidate {
  return {
    id: row.id,
    label: row.description,
    detail: row.meeting_title,
    occurred_at: row.meeting_date,
  };
}

function meetingCandidate(row: MeetingRow): AskActionCandidate {
  return {
    id: row.id,
    label: row.title,
    detail: formatDuration(row.duration_sec) ?? "",
    occurred_at: row.occurred_at,
  };
}

/**
 * Compose the plan for a routed instruction.
 *
 * Returns null ONLY for `intent: "answer"`, which the caller handles by falling
 * through to the ordinary grounded-answer path. Every other outcome — including
 * every kind of failure to find anything — is a plan, because "I looked and
 * found nothing" is information the user needs and silently answering their
 * instruction as though it were a question would hide it.
 */
export async function planAskAction(params: {
  intent: AskIntentStructured;
  userId: string;
  workspaceId: string;
}): Promise<AskActionPlan | null> {
  const { intent, userId, workspaceId } = params;
  if (intent.intent === "answer") return null;

  const hint = intent.target_hint?.trim() ?? "";

  if (intent.intent === "complete_action_item") {
    return planCompleteActionItem(hint, userId, workspaceId);
  }

  /**
   * Checked before the target is resolved, not after.
   *
   * "Rename this meeting" with no new name cannot succeed against any row, so
   * resolving one first would only produce a more specific way of saying no —
   * and, worse, would show the user a card naming a recording as though
   * something were about to happen to it.
   */
  if (intent.intent === "rename_meeting" && !intent.new_title?.trim()) {
    return { outcome: "blocked", action: "rename_meeting", reason: "missing_title", hint };
  }

  return planMeetingAction(intent, hint, userId, workspaceId);
}

async function planCompleteActionItem(
  hint: string,
  userId: string,
  workspaceId: string,
): Promise<AskActionPlan> {
  const sql = getSql();

  /**
   * Completed rows are fetched too, and then held back from the match.
   *
   * Matching against open items alone is right — "mark X done" means an open X
   * — but it makes "already finished" and "never existed" the same answer, and
   * they are not. The second pass over the completed rows costs nothing here
   * and turns a confusing "I couldn't find that" into "that one is already
   * checked off", which is the difference between the user doubting the app and
   * the user knowing where they stand.
   */
  const rows = await sql<ActionItemRow[]>`
    SELECT
      ai.id,
      ai.description,
      ai.completed,
      m.title AS meeting_title,
      COALESCE(m.recorded_at, m.created_at) AS meeting_date
    FROM action_items ai
    JOIN meetings m ON m.id = ai.meeting_id
    WHERE ai.user_id = ${userId} AND ai.workspace_id = ${workspaceId}
    ORDER BY ai.created_at DESC
    LIMIT ${CANDIDATE_POOL}
  `;

  const open = rows.filter((r) => !r.completed);
  const resolution: TargetResolution<ActionItemRow> = resolveTarget(
    hint,
    open,
    (r) => r.description,
  );

  if (resolution.kind === "resolved") {
    return {
      outcome: "run",
      action: "complete_action_item",
      target: actionItemCandidate(resolution.item),
    };
  }

  if (resolution.kind === "ambiguous") {
    return {
      outcome: "clarify",
      action: "complete_action_item",
      hint,
      new_title: null,
      candidates: resolution.items.slice(0, MAX_CANDIDATES).map(actionItemCandidate),
    };
  }

  const done = rows.filter((r) => r.completed);
  const alreadyDone = resolveTarget(hint, done, (r) => r.description);
  if (alreadyDone.kind !== "none") {
    return { outcome: "blocked", action: "complete_action_item", reason: "already_done", hint };
  }

  return {
    outcome: "blocked",
    action: "complete_action_item",
    reason: open.length === 0 ? "nothing_to_act_on" : "not_found",
    hint,
  };
}

async function planMeetingAction(
  intent: AskIntentStructured,
  hint: string,
  userId: string,
  workspaceId: string,
): Promise<AskActionPlan> {
  const action = intent.intent === "rename_meeting" ? "rename_meeting" : "delete_meeting";
  const sql = getSql();

  const rows = await sql<MeetingRow[]>`
    SELECT
      id,
      title,
      -- When the conversation happened, which is what someone means by "the
      -- Tuesday one" — not when the row was written. Nullable and best-effort,
      -- so it falls back to upload time exactly as the list endpoints do.
      COALESCE(recorded_at, created_at) AS occurred_at,
      duration_sec
    FROM meetings
    WHERE user_id = ${userId} AND workspace_id = ${workspaceId}
    ORDER BY COALESCE(recorded_at, created_at) DESC
    LIMIT ${CANDIDATE_POOL}
  `;

  const resolution = resolveTarget(hint, rows, (r) => r.title);

  if (resolution.kind === "ambiguous") {
    return {
      outcome: "clarify",
      action,
      hint,
      new_title: intent.new_title?.trim() ?? null,
      candidates: resolution.items.slice(0, MAX_CANDIDATES).map(meetingCandidate),
    };
  }

  if (resolution.kind === "none") {
    return {
      outcome: "blocked",
      action,
      reason: rows.length === 0 ? "nothing_to_act_on" : "not_found",
      hint,
    };
  }

  const target = meetingCandidate(resolution.item);

  if (action === "delete_meeting") {
    return { outcome: "confirm", action: "delete_meeting", target };
  }

  return {
    outcome: "run",
    action: "rename_meeting",
    target,
    // Non-null: planAskAction blocks a rename with no title before reaching here.
    new_title: intent.new_title?.trim() ?? "",
    previous_title: resolution.item.title,
  };
}
