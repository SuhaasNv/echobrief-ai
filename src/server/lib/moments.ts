/**
 * Grounding for notable moments.
 *
 * The analyst is asked to flag how a conversation went — someone pushed back,
 * someone hedged, the room converged — and to quote the words that show it.
 * This module is the part that does not take its word for it.
 *
 * Every moment must carry a quote that ACTUALLY APPEARS on a single line of the
 * transcript. Anything else is discarded before it can be written to the
 * database. That is a deliberately harsh rule, and it is the whole reason this
 * feature is safe to ship: a meeting recorder that tells your colleagues you
 * "sounded frustrated" when you did not is making a false statement about a
 * real person in a record they will read. Precision over recall, in code and
 * not only in the prompt — prompts are guidance, and this is a guarantee.
 *
 * WHY A SINGLE LINE, RATHER THAN ANYWHERE IN THE TRANSCRIPT
 *
 * Matching against the whole document would also accept a "quote" stitched
 * together from two different speakers' turns, which is not a quote at all — it
 * is a paraphrase of an exchange with quotation marks around it. Requiring one
 * line costs us the occasional legitimate cross-turn moment, and buys something
 * worth more: the speaker and the timestamp stop being claims the model made
 * and become facts read off the line the words were found on. Nothing rendered
 * beside a moment is unverified.
 *
 * WHY NORMALIZE BEFORE COMPARING
 *
 * A model reproducing a sentence will straighten a curly apostrophe, drop a
 * trailing comma, or fix the transcriber's capitalisation. Rejecting those
 * would delete true moments over typography. Normalization strips punctuation
 * and case but keeps every letter and digit, in every script — so it forgives
 * how the words were written and forgives nothing about WHICH words they were.
 */

export const MOMENT_KINDS = [
  "disagreement",
  "hesitation",
  "enthusiasm",
  "alignment",
  "concern",
] as const;

export type MomentKind = (typeof MOMENT_KINDS)[number];

export interface NotableMoment {
  kind: MomentKind;
  /** What happened, as an observable act: "pushed back on the timeline". */
  description: string;
  /** The words that prove it, verbatim from one transcript line. */
  quote: string;
  /** Read off the transcript line, not from the model. Null when unattributed. */
  speaker: string | null;
  /** Read off the transcript line, not from the model. Null when unattributed. */
  timestamp_sec: number | null;
}

/**
 * At most this many moments survive, newest-in-the-list first.
 *
 * Not a target — the prompt is explicit that most meetings have none. This is a
 * ceiling on a failure mode: a model that starts finding significance in every
 * turn produces a wall of cards that buries the two moments that mattered, and
 * the reader stops trusting all of them. Six is more than any real meeting has
 * produced in testing.
 */
const MAX_MOMENTS = 6;

/**
 * A quote has to be at least this substantial to justify a card.
 *
 * Either bound satisfies it: four whitespace-separated tokens, or twelve
 * characters. The character route exists for languages that do not put spaces
 * between words — a Japanese sentence is one "token" and would otherwise fail a
 * word count no matter how long it was, silently disabling this feature for
 * every non-space-delimited language the transcriber supports.
 *
 * The floor matters because short quotes are both weak evidence and easy to
 * match by accident: "yeah" appears in most conversations, so finding it proves
 * nothing about the moment it is attached to.
 */
const MIN_QUOTE_TOKENS = 4;
const MIN_QUOTE_CHARS = 12;

/**
 * One line of the transcript as `formatDiarizedTranscript` writes it:
 * `[m:ss] Speaker A: what they said`. Minutes are not padded and run past 59 on
 * a long recording, hence `\d+` rather than a fixed width.
 *
 * This parses a format produced elsewhere in the codebase, which is a coupling
 * worth naming: if `formatDiarizedTranscript` changes, this stops matching and
 * every moment silently loses its speaker and timestamp. The unit tests feed
 * that function's real output through this parser rather than a hand-written
 * fixture, so the two cannot drift apart without a test going red.
 */
const LINE_PATTERN = /^\[(\d+):(\d{2})\]\s+([^:]+):\s*([\s\S]*)$/;

interface TranscriptLine {
  speaker: string | null;
  timestamp_sec: number | null;
  normalized: string;
}

/**
 * Casefold and strip punctuation, keeping letters, digits and marks in every
 * script.
 *
 * Apostrophes are handled FIRST and separately, because they are the one common
 * punctuation mark that sits INSIDE a word. Turning them into spaces the way
 * everything else is turned into spaces makes "don't" normalize to "don t",
 * which then fails to match a model that reproduced the sentence as "dont" —
 * a true moment thrown away over a dropped apostrophe. Deleting them instead
 * maps both spellings onto "dont" and the comparison survives. All four
 * variants a transcriber or a model might emit are covered, including the curly
 * one Apple keyboards produce.
 *
 * Everything else — `\p{P}` and `\p{S}`, covering quotes, dashes, brackets and
 * symbols — becomes a space, so those marks leave a word boundary behind rather
 * than fusing the words either side of them.
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/['‘’ʼ]/gu, "")
    .replace(/[\p{P}\p{S}]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function isSubstantial(normalizedQuote: string): boolean {
  if (normalizedQuote.length >= MIN_QUOTE_CHARS) return true;
  return normalizedQuote.split(" ").filter(Boolean).length >= MIN_QUOTE_TOKENS;
}

/**
 * Split the analyst's transcript back into attributable lines.
 *
 * A transcript that was never diarized — a pasted one, where
 * `formatDiarizedTranscript` correctly falls back to flat prose — matches
 * nothing here. Rather than dropping every moment in that case, the whole text
 * becomes one unattributed line: the quote still has to be real, and the moment
 * simply carries no speaker or timestamp. Losing attribution is honest; losing
 * the feature entirely on pasted transcripts would not be.
 */
function parseLines(transcript: string): TranscriptLine[] {
  const lines: TranscriptLine[] = [];

  for (const raw of transcript.split("\n")) {
    const line = raw.trim();
    if (line.length === 0) continue;

    const match = LINE_PATTERN.exec(line);
    if (!match) continue;

    const [, minutes, seconds, who, text] = match;
    const label = who.trim();

    lines.push({
      // "Unknown speaker" is what the formatter writes when diarization was
      // uncertain. It is not a person's name, and the analysis prompt already
      // says so — carrying it into the UI would put a moment in the record of
      // somebody called Unknown.
      speaker: label === "Unknown speaker" ? null : label,
      timestamp_sec: Number(minutes) * 60 + Number(seconds),
      normalized: normalize(text),
    });
  }

  if (lines.length > 0) return lines;

  return [{ speaker: null, timestamp_sec: null, normalized: normalize(transcript) }];
}

/**
 * The model's raw moments, before anything has been checked.
 *
 * `kind` is typed as `string` rather than `MomentKind` on purpose: this is
 * parsed JSON. The schema constrains it to the enum and OpenAI's strict mode
 * honours that, but a type assertion on data that arrived over the network is a
 * promise the compiler cannot keep, and an unrecognised kind would reach the
 * client and render as a blank chip.
 */
export interface RawMoment {
  kind: string;
  description: string;
  quote: string;
}

const KIND_SET: ReadonlySet<string> = new Set<string>(MOMENT_KINDS);

function isMomentKind(value: string): value is MomentKind {
  return KIND_SET.has(value);
}

/**
 * Keep only the moments the transcript can prove.
 *
 * Note where `speaker` and `timestamp_sec` come from: the transcript line the
 * quote was found on, never the model. The schema does not even ask for them.
 * A correct quote attributed to the wrong colleague is exactly the harm this
 * module exists to prevent, and there is no reason to accept a claim about who
 * spoke when we can instead read it off the evidence.
 */
export function groundMoments(
  moments: readonly RawMoment[] | undefined,
  transcript: string,
): NotableMoment[] {
  if (!moments || moments.length === 0) return [];

  const lines = parseLines(transcript);
  const grounded: NotableMoment[] = [];
  const seen = new Set<string>();

  for (const moment of moments) {
    if (grounded.length >= MAX_MOMENTS) break;

    const kind = typeof moment.kind === "string" ? moment.kind : "";
    if (!isMomentKind(kind)) continue;

    const quote = typeof moment.quote === "string" ? moment.quote.trim() : "";
    const description = typeof moment.description === "string" ? moment.description.trim() : "";
    if (quote.length === 0 || description.length === 0) continue;

    const needle = normalize(quote);
    if (!isSubstantial(needle)) continue;

    // Deduplicate on the quote, not the description: two moments justified by
    // the same words are one moment described twice, and the second card adds
    // nothing but the impression that it happened repeatedly.
    if (seen.has(needle)) continue;

    const source = lines.find((line) => line.normalized.includes(needle));
    if (!source) continue;

    seen.add(needle);
    grounded.push({
      kind,
      description,
      quote,
      speaker: source.speaker,
      timestamp_sec: source.timestamp_sec,
    });
  }

  return grounded;
}
