import type { Speaker, TranscriptSegment } from "@/lib/api/meeting-detail";
import { formatClock } from "@/lib/format";

/**
 * Working out which voice is whose, from what was actually said.
 *
 * Diarization gives us "A", "B", "C" and nothing else. The analysis model is
 * asked for a `participants` array — names it heard in the room — but that field
 * is generated and then discarded by the worker, and no endpoint returns it (see
 * the note at the bottom of this file). What the phone CAN see is the transcript
 * itself, and the transcript contains the two moments where a name and a voice
 * are genuinely tied together:
 *
 *   Someone says their own name. "I'm Priya" is the strongest evidence there is,
 *   because the speaker is the subject of the sentence.
 *
 *   Someone is addressed and then answers. "Priya, can you take that?" followed
 *   by a DIFFERENT voice is decent evidence that voice is Priya — and it is
 *   evidence that the person who asked is NOT Priya, which is the half that
 *   stops a name landing on the wrong voice.
 *
 * Everything else — a name mentioned in passing, a name on an action item — is a
 * name that was in the room, not a name attached to a voice. Those still get
 * offered, but as a plain list, never as "this voice is Priya".
 *
 * The whole module is precision-first on purpose. A wrong name attached to a
 * decision is worse than an anonymous speaker, so a name with weak or
 * contradictory evidence is demoted to the unplaced list rather than guessed at.
 * Nothing here is ever applied automatically — it only decides what to OFFER.
 */

/** What tied a name to a voice. Drives the wording shown under the name. */
export type SpeakerEvidence = "introduced" | "addressed";

export interface SpeakerSuggestion {
  name: string;
  /**
   * Shown under the name in the sheet. States what was heard and when, so the
   * user can check it against the transcript instead of trusting us.
   */
  reason: string;
  /** Higher is stronger. Only meaningful for ordering within one voice. */
  score: number;
  kind: SpeakerEvidence;
}

export interface SpeakerSuggestions {
  /** Raw speaker id ("A") → ranked names. Confident attributions only. */
  forSpeaker: Map<string, SpeakerSuggestion[]>;
  /**
   * Names this meeting produced that no single voice can be pinned to — either
   * the evidence was thin, or two voices had an equal claim. Offered without a
   * suggestion, because a coin-flip presented as an answer is the failure mode.
   */
  unplaced: string[];
}

/** A self-introduction is worth more than any number of hand-offs. */
const SCORE_INTRODUCED = 3;
const SCORE_ADDRESSED = 2;
/** Below this, a name is offered without a voice attached. */
const MIN_SCORE = 3;
/** How far the best claim must beat the runner-up before we name a voice. */
const MIN_MARGIN = 2;

/**
 * A capitalised word, optionally hyphenated or apostrophed.
 *
 * AssemblyAI returns cased, punctuated text, so the capital is real signal:
 * "I'm going" cannot match, "I'm Priya" can.
 */
const NAME_TOKEN = String.raw`([A-Z][a-z]{1,14}(?:['’-][A-Za-z][a-z]{1,14})?)`;

/**
 * Self-identification, and only self-identification.
 *
 * "This is Priya" is deliberately absent. It is self-introduction about half the
 * time and an introduction OF someone else the rest — "this is Priya, she'll
 * take us through it" — and a rule that is right half the time puts a name on
 * the wrong voice half the time.
 */
const SELF_INTRO: RegExp[] = [
  new RegExp(String.raw`\b[Ii](?:'|’)m\s+${NAME_TOKEN}\b(?!['’]s)`),
  new RegExp(String.raw`\b[Ii] am\s+${NAME_TOKEN}\b(?!['’]s)`),
  new RegExp(String.raw`\b[Mm]y name(?:(?:'|’)s| is)\s+${NAME_TOKEN}\b`),
  new RegExp(String.raw`^\s*${NAME_TOKEN}\s+here\b`),
];

/**
 * Capitalised words that are not names.
 *
 * Only the ones that can actually follow "I'm" or open a sentence — this is a
 * filter for the handful of false positives the patterns above can produce, not
 * an attempt to enumerate English.
 */
const NOT_A_NAME = new Set([
  "Ok",
  "Okay",
  "Yeah",
  "Yes",
  "No",
  "Not",
  "Sorry",
  "Sure",
  "Still",
  "Just",
  "Also",
  "Really",
  "Right",
  "Well",
  "Good",
  "Great",
  "Fine",
  "Happy",
  "Sad",
  "Glad",
  "Here",
  "There",
  "Now",
  "Today",
  "Tomorrow",
  "Yesterday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
  "The",
  "This",
  "That",
  "These",
  "Those",
  "We",
  "You",
  "They",
  "She",
  "He",
  "It",
  "So",
  "And",
  "But",
  "Then",
  "Because",
  "Actually",
  "Basically",
  "Honestly",
  "Sort",
  "Kind",
  "Going",
  "Trying",
  "Looking",
  "Thinking",
]);

/** Regex-safe form of a name, so an apostrophe in "O'Neill" cannot break out. */
function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Somebody is being spoken TO.
 *
 * Two shapes, both of which put the name in the vocative rather than in the
 * third person: a greeting or a thanks in front of it, or a question aimed
 * straight at it. "We should ask Priya" matches neither, which is the point —
 * that sentence says Priya exists, not that Priya is about to speak.
 */
function addressPatterns(name: string): RegExp[] {
  const n = escapeForRegex(name);
  return [
    new RegExp(
      String.raw`(?:^|[.!?]\s*)(?:hi|hey|hello|thanks|thank you|welcome back|welcome|over to you|go ahead)[,]?\s+${n}\b`,
      "i",
    ),
    new RegExp(
      String.raw`\b${n}\s*,\s*(?:can|could|do|did|would|will|what|how|any|are|is|have|your|you)\b`,
      "i",
    ),
  ];
}

interface Claim {
  score: number;
  kind: SpeakerEvidence;
  /** Second the evidence was heard at, for the reason line. */
  at: number;
}

function reasonFor(kind: SpeakerEvidence, at: number): string {
  return kind === "introduced"
    ? `Introduced themselves at ${formatClock(at)}`
    : `Addressed just before this voice spoke, at ${formatClock(at)}`;
}

/**
 * Rank names against voices.
 *
 * @param segments Transcript segments. Their `speaker` carries the DISPLAY label
 *                 ("Speaker A", or "Priya" once named), not the raw id, so it is
 *                 resolved back through `speakers` here.
 * @param speakers The diarized voices, whose `id` is the raw label the rename
 *                 endpoint addresses.
 * @param pool     Names already known from elsewhere — action-item assignees in
 *                 this meeting and in the rest of the workspace. Used to decide
 *                 which words the address rules are allowed to look for, so a
 *                 vocative can never invent a name out of a capitalised noun.
 */
export function suggestSpeakerNames(
  segments: TranscriptSegment[],
  speakers: Speaker[],
  pool: readonly string[],
): SpeakerSuggestions {
  const empty: SpeakerSuggestions = { forSpeaker: new Map(), unplaced: [] };
  if (segments.length === 0 || speakers.length === 0) return empty;

  // Both keys, for the same reason components/ribbon indexes both: a segment
  // carries the display label while the rename endpoint addresses the raw id,
  // and once a voice is named those two stop looking anything alike.
  const idFor = new Map<string, string>();
  for (const speaker of speakers) {
    idFor.set(speaker.id, speaker.id);
    if (speaker.label) idFor.set(speaker.label, speaker.id);
  }

  /** speakerId → name → best claim. */
  const claims = new Map<string, Map<string, Claim>>();
  /** speakerId → names that voice cannot be, because it used them as a vocative. */
  const denied = new Map<string, Set<string>>();
  /** Canonical spelling of every name we have seen, keyed by lower case. */
  const seen = new Map<string, string>();

  const record = (speakerId: string, name: string, kind: SpeakerEvidence, at: number): void => {
    const perSpeaker = claims.get(speakerId) ?? new Map<string, Claim>();
    const score = kind === "introduced" ? SCORE_INTRODUCED : SCORE_ADDRESSED;
    const existing = perSpeaker.get(name);

    if (existing) {
      // Repeated evidence accumulates. The REASON, though, stays the strongest
      // single thing we heard — an introduction outranks any number of
      // hand-offs, and the first introduction outranks a later one.
      const upgrade = kind === "introduced" && existing.kind === "addressed";
      perSpeaker.set(name, {
        score: existing.score + score,
        kind: upgrade ? "introduced" : existing.kind,
        at: upgrade ? at : existing.at,
      });
    } else {
      perSpeaker.set(name, { score, kind, at });
    }

    claims.set(speakerId, perSpeaker);
  };

  const deny = (speakerId: string, name: string): void => {
    const set = denied.get(speakerId) ?? new Set<string>();
    set.add(name);
    denied.set(speakerId, set);
  };

  // Pass one: self-introductions. These can mint a name nothing else knew about,
  // which is why they are the only rule allowed to.
  for (const segment of segments) {
    const speakerId = segment.speaker ? idFor.get(segment.speaker) : undefined;
    const text = segment.text;
    if (!speakerId || !text) continue;

    for (const pattern of SELF_INTRO) {
      const match = pattern.exec(text);
      const candidate = match?.[1];
      if (!candidate || NOT_A_NAME.has(candidate)) continue;

      seen.set(candidate.toLowerCase(), candidate);
      record(speakerId, candidate, "introduced", segment.start_sec);
    }
  }

  // Everything the address rules are allowed to look for: names the model pulled
  // out of this workspace, plus anything a voice claimed for itself above.
  for (const name of pool) {
    const trimmed = name.trim();
    if (trimmed.length >= 2 && trimmed.length <= 80) {
      seen.set(trimmed.toLowerCase(), seen.get(trimmed.toLowerCase()) ?? trimmed);
    }
  }

  const candidates = Array.from(seen.values());
  const patterns = new Map<string, RegExp[]>();
  for (const name of candidates) patterns.set(name, addressPatterns(name));

  // Pass two: someone is addressed, and the next voice to speak is a different
  // one. `includes` first — with 800 segments and a dozen names the regex pass
  // is the expensive part, and most segments mention nobody.
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    const speakerId = segment?.speaker ? idFor.get(segment.speaker) : undefined;
    const text = segment?.text;
    if (!segment || !speakerId || !text) continue;

    const lower = text.toLowerCase();

    for (const name of candidates) {
      if (!lower.includes(name.toLowerCase())) continue;
      if (!patterns.get(name)?.some((pattern) => pattern.test(text))) continue;

      // You do not address yourself. True whoever answers next, so it is
      // recorded even when nobody does.
      deny(speakerId, name);

      const next = segments[i + 1];
      const nextId = next?.speaker ? idFor.get(next.speaker) : undefined;
      if (nextId && nextId !== speakerId) record(nextId, name, "addressed", segment.start_sec);
    }
  }

  // Resolve. A name belongs to one voice at most, and only when its best claim
  // clears the floor AND clears the runner-up by a real margin — otherwise two
  // voices each addressed as "Priya" would both be offered the name, and one of
  // them would be wrong.
  const bestFor = new Map<string, { speakerId: string; claim: Claim; runnerUp: number }>();

  for (const [speakerId, perSpeaker] of claims) {
    for (const [name, claim] of perSpeaker) {
      // "You do not address yourself" is good evidence, but it does not beat a
      // recording of the person saying their own name. A speaker who introduced
      // themselves as Priya and later said "Priya, can you..." is either talking
      // to a second Priya or being mis-transcribed; either way the introduction
      // is the thing we heard most clearly.
      if (claim.kind !== "introduced" && denied.get(speakerId)?.has(name)) continue;

      const current = bestFor.get(name);
      if (!current) {
        bestFor.set(name, { speakerId, claim, runnerUp: 0 });
      } else if (claim.score > current.claim.score) {
        bestFor.set(name, { speakerId, claim, runnerUp: current.claim.score });
      } else {
        bestFor.set(name, { ...current, runnerUp: Math.max(current.runnerUp, claim.score) });
      }
    }
  }

  const forSpeaker = new Map<string, SpeakerSuggestion[]>();
  const unplaced: string[] = [];

  for (const [name, best] of bestFor) {
    const confident =
      best.claim.score >= MIN_SCORE && best.claim.score - best.runnerUp >= MIN_MARGIN;

    if (!confident) {
      unplaced.push(name);
      continue;
    }

    const list = forSpeaker.get(best.speakerId) ?? [];
    list.push({
      name,
      reason: reasonFor(best.claim.kind, best.claim.at),
      score: best.claim.score,
      kind: best.claim.kind,
    });
    forSpeaker.set(best.speakerId, list);
  }

  for (const list of forSpeaker.values()) {
    list.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  }
  unplaced.sort((a, b) => a.localeCompare(b));

  return { forSpeaker, unplaced };
}

/*
 * On `participants`.
 *
 * ANALYSIS_SCHEMA in src/server/lib/prompts.ts asks the model for exactly the
 * list this file reconstructs, with a description that says these become the
 * one-tap suggestions. The worker never writes it: the INSERT into `summaries`
 * in src/server/workers/processing.ts lists six columns and participants is not
 * one of them, there is no column to write it to, and GET /meetings/:id
 * therefore cannot return it — even though MeetingDetail.summary.participants is
 * declared in packages/shared/src/schemas.ts. The web app has the same gap and
 * fills it from action-item assignees, which is what `pool` is here.
 *
 * Persisting that field would make this module strictly better: the model hears
 * names this cannot, and every name it returns would join `pool` and become
 * addressable by the vocative rule. It is a server change, so it is reported
 * rather than worked around.
 */
