import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TranscriptOptionalParams } from "assemblyai";

/**
 * What actually reaches AssemblyAI.
 *
 * This file exists because of a specific class of defect this codebase has
 * already shipped once: a setting that renders as chosen, saves without error,
 * and is read by nothing. For a transcription option the last hop — preference
 * to HTTP request body — is the one no screenshot can check and no type can
 * prove, because `transcribe()` takes a wide options bag and omitting a field is
 * perfectly legal.
 *
 * So the SDK is mocked at the module boundary and the assertions are on the
 * exact object handed to it. `filter_profanity` present and equal to the
 * caller's choice is the whole claim the settings screen makes.
 */

const transcribe = vi.fn();

vi.mock("assemblyai", () => ({
  AssemblyAI: class {
    transcripts = { transcribe };
  },
}));

vi.mock("../../env", () => ({
  getEnv: () => ({ ASSEMBLYAI_API_KEY: "test-key" }),
}));

// Imported after the mocks so the module under test picks them up.
const { transcribeAudioUrl } = await import("../assemblyai");

/** A completed transcript with nothing in it — normalize() only needs the shape. */
function completed() {
  return {
    status: "completed",
    text: "",
    language_code: "en",
    words: [],
    utterances: [],
    audio_duration: 0,
  };
}

/** The single argument `transcribe` was called with, typed rather than cast. */
function sentParams(): TranscriptOptionalParams & { audio: string } {
  const call: unknown = transcribe.mock.calls[0]?.[0];
  if (typeof call !== "object" || call === null) {
    throw new Error("transcribe() was not called with an options object");
  }
  return call as TranscriptOptionalParams & { audio: string };
}

beforeEach(() => {
  transcribe.mockReset();
  transcribe.mockResolvedValue(completed());
});

describe("transcribeAudioUrl — profanity filtering", () => {
  it("asks AssemblyAI to filter when the preference is on", async () => {
    await transcribeAudioUrl("https://audio.test/meeting.m4a", {
      language: "en",
      filterProfanity: true,
    });

    expect(sentParams().filter_profanity).toBe(true);
  });

  it("sends filter_profanity: false rather than omitting it when off", async () => {
    await transcribeAudioUrl("https://audio.test/meeting.m4a", {
      language: "en",
      filterProfanity: false,
    });

    const params = sentParams();
    expect(params.filter_profanity).toBe(false);
    // Explicitly present, not merely falsy: "off" and "this build predates the
    // setting" have to be distinguishable in a captured request.
    expect(Object.keys(params)).toContain("filter_profanity");
  });

  it("does not disturb the other transcription options", async () => {
    await transcribeAudioUrl("https://audio.test/meeting.m4a", {
      language: "en",
      wordBoost: ["EchoBrief", "Kubernetes"],
      filterProfanity: true,
    });

    const params = sentParams();
    expect(params.language_code).toBe("en");
    expect(params.speaker_labels).toBe(true);
    expect(params.word_boost).toEqual(["EchoBrief", "Kubernetes"]);
    expect(params.filter_profanity).toBe(true);
  });

  it("filters regardless of whether the language is pinned or detected", async () => {
    await transcribeAudioUrl("https://audio.test/meeting.m4a", {
      language: null,
      filterProfanity: true,
    });

    const params = sentParams();
    expect(params.language_detection).toBe(true);
    expect(params.language_code).toBeUndefined();
    expect(params.filter_profanity).toBe(true);
  });
});
