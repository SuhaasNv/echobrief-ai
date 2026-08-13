/**
 * The Ask action contract — what the API is allowed to propose, and what the
 * client is allowed to do about it.
 *
 * Lives in @echobrief/shared because both halves of the feature depend on the
 * exact same shape: the API composes a plan, puts it in the `x-ask-action`
 * response header, and the client validates it with `parseAskActionPlan` before
 * it renders anything. Validating rather than casting is deliberate — this
 * envelope decides whether a destructive control appears on screen, so a
 * malformed one must fail closed (no card at all) rather than half-render.
 *
 * NO ZOD IN THIS FILE, on purpose. Every other schema in this package is a Zod
 * schema, and importing the package barrel from the Expo app would pull Zod into
 * the app bundle — a trade `lib/audio/segment-upload.ts` already looked at and
 * declined, and Zod is not a declared dependency of apps/mobile. So this module
 * has no imports at all and is published on its own subpath
 * (`@echobrief/shared/ask-actions`), which the app can reach without dragging
 * the barrel in behind it.
 *
 * The hand-written validator below keeps type and check in step the only way
 * that survives review: it BUILDS the returned object field by field, so adding
 * a field to a type here stops this file compiling until the parser produces it.
 *
 * WHAT THIS IS NOT. It is not a description of a mutation the server performed.
 * The server never mutates as a side effect of an LLM call; it resolves what the
 * user meant and hands back a plan. Every write still goes through the ordinary
 * endpoints (PATCH /action-items/:id, PATCH /meetings/:id, DELETE /meetings/:id)
 * as a separate, individually authorized request from the client. That keeps
 * exactly one code path per mutation in the system, and it means an LLM call can
 * never be the thing that changed the database.
 */

/**
 * The complete vocabulary. Three verbs, and nothing that operates on more than
 * one row.
 *
 * There is deliberately no "delete all", no "clear my actions", and no filter
 * form of any verb. A bulk destructive action is the one shape where a single
 * misread sentence costs everything at once, and no phrasing of it is worth
 * that. Anything not in this list is not expressible, which is a stronger
 * guarantee than any amount of prompt text about being careful.
 */
export const ASK_ACTION_NAMES = [
  "complete_action_item",
  "rename_meeting",
  "delete_meeting",
] as const;

export type AskActionName = (typeof ASK_ACTION_NAMES)[number];

export const ASK_BLOCKED_REASONS = [
  "not_found",
  "already_done",
  "missing_title",
  "nothing_to_act_on",
] as const;

export type AskBlockedReason = (typeof ASK_BLOCKED_REASONS)[number];

/**
 * One thing the user might have meant, in the user's own terms.
 *
 * `label` is the row as they would recognise it — the task's text, the
 * recording's name. `detail` is whatever else tells two similar rows apart:
 * which meeting a task came from, how long a recording is. Both are composed by
 * the API from typed columns, never written by a model.
 *
 * `occurred_at` stays an ISO instant rather than a formatted date because the
 * API runs in UTC and the reader does not. On a card whose entire job is "is
 * this the recording you meant", a late-evening meeting shown under the wrong
 * day is exactly the kind of small wrongness that gets the wrong thing deleted.
 * The client formats it in the device's own zone.
 */
export interface AskActionCandidate {
  id: string;
  label: string;
  detail: string;
  occurred_at: string | null;
}

/** Marking a task done. Reversible in one tap, so it runs without asking. */
export interface RunCompletePlan {
  outcome: "run";
  action: "complete_action_item";
  target: AskActionCandidate;
}

/**
 * Renaming a recording. Also reversible — `previous_title` is carried so the
 * undo restores the exact string that was there, rather than the client
 * guessing from a cache that may already have been refetched.
 */
export interface RunRenamePlan {
  outcome: "run";
  action: "rename_meeting";
  target: AskActionCandidate;
  new_title: string;
  previous_title: string;
}

/**
 * Deleting a recording. Never runs on inference — the client must show what is
 * about to be destroyed and take a tap.
 */
export interface ConfirmDeletePlan {
  outcome: "confirm";
  action: "delete_meeting";
  target: AskActionCandidate;
}

/**
 * More than one row fits what the user said, so the app asks instead of
 * choosing. `action` and `new_title` ride along so that picking a candidate
 * needs no second trip through the model: the client already knows what to do
 * with whichever one is tapped.
 */
export interface ClarifyPlan {
  outcome: "clarify";
  action: AskActionName;
  /** The words the user used to point at something, echoed back to them. */
  hint: string;
  /** Set only for rename_meeting. */
  new_title: string | null;
  candidates: AskActionCandidate[];
}

/**
 * The action was understood and cannot proceed. Distinct from clarify: there is
 * nothing to tap, only something to say.
 */
export interface BlockedPlan {
  outcome: "blocked";
  action: AskActionName;
  reason: AskBlockedReason;
  hint: string;
}

export type AskActionPlan =
  | RunCompletePlan
  | RunRenamePlan
  | ConfirmDeletePlan
  | ClarifyPlan
  | BlockedPlan;

/** Never present more choices than someone will actually read. */
export const MAX_ASK_CANDIDATES = 5;

// ----------------------------------------------------------------------------
// Validation
// ----------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asCandidate(value: unknown): AskActionCandidate | null {
  if (!isRecord(value)) return null;

  const id = asString(value.id);
  const label = asString(value.label);
  const detail = asString(value.detail);
  if (id === null || label === null || detail === null) return null;

  const occurredAt = value.occurred_at;
  if (occurredAt !== null && typeof occurredAt !== "string") return null;

  return { id, label, detail, occurred_at: occurredAt };
}

function isActionName(value: unknown): value is AskActionName {
  return ASK_ACTION_NAMES.some((name) => name === value);
}

/**
 * Turn an untrusted parsed header into a plan, or into nothing.
 *
 * Total: every failure path returns null, so a caller has exactly one branch to
 * write and no way to accidentally render a partially-valid destructive
 * proposal. Unknown outcomes and unknown action names are failures rather than
 * pass-throughs — a client that does not understand a plan must not act on it,
 * and a newer server rolling out ahead of an older app is the ordinary way that
 * happens.
 */
export function parseAskActionPlan(value: unknown): AskActionPlan | null {
  if (!isRecord(value)) return null;

  if (value.outcome === "run") {
    const target = asCandidate(value.target);
    if (!target) return null;

    if (value.action === "complete_action_item") {
      return { outcome: "run", action: "complete_action_item", target };
    }

    if (value.action === "rename_meeting") {
      const newTitle = asString(value.new_title);
      const previousTitle = asString(value.previous_title);
      // A rename with no new name is not a rename. Refusing it here means the
      // client can never PATCH a title to undefined off a malformed envelope.
      if (newTitle === null || previousTitle === null || newTitle.length === 0) return null;
      return {
        outcome: "run",
        action: "rename_meeting",
        target,
        new_title: newTitle,
        previous_title: previousTitle,
      };
    }

    return null;
  }

  if (value.outcome === "confirm") {
    const target = asCandidate(value.target);
    // Only one action is ever proposed for confirmation. Anything else claiming
    // to need confirmation is a contract the client does not know how to honour.
    if (!target || value.action !== "delete_meeting") return null;
    return { outcome: "confirm", action: "delete_meeting", target };
  }

  if (value.outcome === "clarify") {
    const hint = asString(value.hint);
    if (hint === null || !isActionName(value.action)) return null;

    const newTitle = value.new_title;
    if (newTitle !== null && typeof newTitle !== "string") return null;

    if (!Array.isArray(value.candidates) || value.candidates.length === 0) return null;
    const candidates: AskActionCandidate[] = [];
    for (const raw of value.candidates) {
      const candidate = asCandidate(raw);
      // All or nothing: a list with a hole in it invites a tap on a row whose
      // neighbour was silently dropped.
      if (!candidate) return null;
      candidates.push(candidate);
    }

    return {
      outcome: "clarify",
      action: value.action,
      hint,
      new_title: newTitle,
      candidates: candidates.slice(0, MAX_ASK_CANDIDATES),
    };
  }

  if (value.outcome === "blocked") {
    const hint = asString(value.hint);
    if (hint === null || !isActionName(value.action)) return null;
    const reason = ASK_BLOCKED_REASONS.find((r) => r === value.reason);
    if (!reason) return null;
    return { outcome: "blocked", action: value.action, reason, hint };
  }

  return null;
}

/**
 * One neutral sentence describing what a turn resolved to.
 *
 * Used for the thread history — both what the screen redraws above the next
 * question, and what the answering model receives as the assistant half of the
 * turn. Composed here from typed fields rather than written by a model, so no
 * generated prose can enter the transcript of the conversation.
 *
 * Deliberately past-tense only where something actually happened. A proposal
 * that was never confirmed reads as a proposal forever.
 */
export function describeAskPlan(plan: AskActionPlan): string {
  switch (plan.outcome) {
    case "run":
      return plan.action === "complete_action_item"
        ? `Marked "${plan.target.label}" as done.`
        : `Renamed "${plan.previous_title}" to "${plan.new_title}".`;
    case "confirm":
      return `Asked to confirm deleting "${plan.target.label}".`;
    case "clarify":
      return `Asked which of ${plan.candidates.length} matches was meant.`;
    case "blocked":
      return "Nothing matched that, so nothing was changed.";
  }
}
