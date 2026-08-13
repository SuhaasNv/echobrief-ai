/**
 * Tests for notable-moment grounding.
 *
 * The point of `groundMoments` is that it does not trust the model, so most of
 * what is worth testing here is REJECTION: a moment whose quote was invented,
 * paraphrased, stitched together from two speakers, or too slight to prove
 * anything must not survive. The feature's entire safety argument is that a
 * claim about a named colleague cannot reach the database unless the words are
 * in the transcript, and these are the tests that hold that line.
 */

import { describe, it, expect } from "vitest";

import { groundMoments, MOMENT_KINDS, type RawMoment } from "../moments";
import { formatDiarizedTranscript } from "../../services/assemblyai";

/**
 * Built with the real formatter rather than a hand-written string.
 *
 * `groundMoments` parses the `[m:ss] Speaker A: ...` shape that
 * `formatDiarizedTranscript` produces, and nothing but convention keeps the two
 * in step. Feeding the actual output through means a change to the format
 * breaks these tests instead of silently stripping the speaker and timestamp
 * off every moment in production.
 */
const TRANSCRIPT = formatDiarizedTranscript(
  [
    {
      start: 12,
      end: 20,
      speaker: "A",
      text: "I don't think that timeline is realistic given the audit.",
    },
    {
      start: 34,
      end: 41,
      speaker: "B",
      text: "Let me think about it before I commit to a date.",
    },
    { start: 95, end: 99, speaker: "A", text: "Okay, agreed, we ship after the audit clears." },
    { start: 3725, end: 3730, speaker: null, text: "That works for me as well." },
  ],
  "fallback prose",
);

function moment(over: Partial<RawMoment> = {}): RawMoment {
  return {
    kind: "disagreement",
    description: "pushed back on the timeline",
    quote: "I don't think that timeline is realistic given the audit.",
    ...over,
  };
}

describe("groundMoments", () => {
  it("keeps a moment whose quote is really in the transcript", () => {
    const [got] = groundMoments([moment()], TRANSCRIPT);

    expect(got.kind).toBe("disagreement");
    expect(got.description).toBe("pushed back on the timeline");
  });

  it("reads the speaker and timestamp off the line, not off the model", () => {
    // The model is not even asked for these, so the only way they can be right
    // is by being looked up. 12s is the start of speaker A's line.
    const [got] = groundMoments([moment()], TRANSCRIPT);

    expect(got.speaker).toBe("Speaker A");
    expect(got.timestamp_sec).toBe(12);
  });

  it("parses minutes past 59 rather than wrapping the hour", () => {
    const [got] = groundMoments(
      [moment({ kind: "alignment", quote: "That works for me as well." })],
      TRANSCRIPT,
    );

    // The formatter writes [62:05] for 3725s; reading only two digits of
    // minutes would put this moment at 2:05 and send the reader to the wrong
    // part of a long recording.
    expect(got.timestamp_sec).toBe(3725);
  });

  it("drops a quote that is nowhere in the transcript", () => {
    const invented = moment({ quote: "Honestly this whole project is a disaster." });

    expect(groundMoments([invented], TRANSCRIPT)).toEqual([]);
  });

  it("drops a paraphrase even when it means the same thing", () => {
    // The dangerous failure: true to the meeting, unfaithful to the record, and
    // indistinguishable from an invention once it is on screen.
    const paraphrase = moment({ quote: "I do not believe that timeline is achievable." });

    expect(groundMoments([paraphrase], TRANSCRIPT)).toEqual([]);
  });

  it("drops a quote stitched together from two different speakers", () => {
    const stitched = moment({
      quote: "I don't think that timeline is realistic given the audit. Okay, agreed",
    });

    expect(groundMoments([stitched], TRANSCRIPT)).toEqual([]);
  });

  it("forgives punctuation, casing and curly quotes", () => {
    // A model reproducing a sentence straightens the apostrophe and fixes the
    // capitalisation. Rejecting that would delete true moments over typography.
    const retyped = moment({ quote: "i dont think that timeline is realistic given the audit" });

    expect(groundMoments([retyped], TRANSCRIPT)).toHaveLength(1);
  });

  it("rejects a quote too slight to prove anything", () => {
    // "agreed" appears in the transcript, so a substring check alone would pass
    // it — and a card justified by one word is not evidence of anything.
    const thin = moment({ kind: "alignment", quote: "agreed" });

    expect(groundMoments([thin], TRANSCRIPT)).toEqual([]);
  });

  it("rejects a kind outside the vocabulary", () => {
    // Would otherwise reach the client and render as a chip with no label.
    const bogus = moment({ kind: "frustrated" });

    expect(groundMoments([bogus], TRANSCRIPT)).toEqual([]);
  });

  it("rejects an empty description even when the quote is real", () => {
    expect(groundMoments([moment({ description: "   " })], TRANSCRIPT)).toEqual([]);
  });

  it("collapses two moments built on the same quote", () => {
    const twice = [moment(), moment({ description: "objected to the schedule" })];

    expect(groundMoments(twice, TRANSCRIPT)).toHaveLength(1);
  });

  it("caps how many moments can survive", () => {
    // Guards against a model that starts finding significance in every turn and
    // buries the two that mattered.
    const many = Array.from({ length: 20 }, (_, i) =>
      moment({ description: `pushed back, take ${i}` }),
    );

    expect(groundMoments(many, TRANSCRIPT).length).toBeLessThanOrEqual(6);
  });

  it("never reports a speaker called Unknown", () => {
    // formatDiarizedTranscript writes "Unknown speaker" when diarization was
    // uncertain. It is not a person, and a moment must not be filed under one.
    const [got] = groundMoments(
      [moment({ kind: "alignment", quote: "That works for me as well." })],
      TRANSCRIPT,
    );

    expect(got.speaker).toBeNull();
  });

  it("returns nothing for the ordinary meeting, without throwing", () => {
    expect(groundMoments([], TRANSCRIPT)).toEqual([]);
    expect(groundMoments(undefined, TRANSCRIPT)).toEqual([]);
  });

  it("still grounds against an undiarized transcript, but claims no attribution", () => {
    // A pasted transcript has no speaker lines to parse. The words must still be
    // real; who said them is simply not knowable, and saying so beats guessing.
    const prose = "We talked it over and I don't think that timeline is realistic.";
    const [got] = groundMoments(
      [moment({ quote: "I don't think that timeline is realistic" })],
      prose,
    );

    expect(got.speaker).toBeNull();
    expect(got.timestamp_sec).toBeNull();
  });

  it("accepts a quote in a script that does not use spaces between words", () => {
    // A word-count floor alone would reject every Japanese quote no matter how
    // long, silently disabling this feature for those languages.
    const japanese = formatDiarizedTranscript(
      [{ start: 5, end: 9, speaker: "A", text: "そのスケジュールは現実的ではないと思います。" }],
      "",
    );
    const [got] = groundMoments(
      [moment({ quote: "そのスケジュールは現実的ではないと思います" })],
      japanese,
    );

    expect(got?.speaker).toBe("Speaker A");
  });

  it("exposes exactly the kinds the schema and the client agree on", () => {
    // Three copies of this vocabulary exist: here, the enum in ANALYSIS_SCHEMA,
    // and MomentKind in the mobile app. This is the one that fails loudly.
    expect([...MOMENT_KINDS]).toEqual([
      "disagreement",
      "hesitation",
      "enthusiasm",
      "alignment",
      "concern",
    ]);
  });
});
