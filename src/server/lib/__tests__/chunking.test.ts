import { describe, it, expect } from "vitest";
import { chunkTranscript, chunkRawText } from "../chunking";
import type { TranscriptionWord } from "../../services/assemblyai";

function makeWords(count: number, wordsPerSec = 2): TranscriptionWord[] {
  return Array.from({ length: count }, (_, i) => ({
    word: `w${i}`,
    start: i / wordsPerSec,
    end: (i + 1) / wordsPerSec,
    confidence: 1,
    speaker: null,
  }));
}

describe("chunkTranscript", () => {
  it("returns empty array for empty input", () => {
    expect(chunkTranscript([])).toEqual([]);
  });

  it("returns a single chunk when words ≤ CHUNK_WORDS (200)", () => {
    const words = makeWords(150);
    const chunks = chunkTranscript(words);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].index).toBe(0);
    expect(chunks[0].content.split(" ")).toHaveLength(150);
    expect(chunks[0].start_sec).toBe(0);
  });

  it("chunks 200-word window with 50-word overlap", () => {
    const words = makeWords(300); // 200 + (200-50)=150 step → second chunk starts at index 150
    const chunks = chunkTranscript(words);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].content.startsWith("w0 w1")).toBe(true);
    expect(chunks[1].content.startsWith("w150 w151")).toBe(true);
    // last chunk goes to the end of the input
    expect(chunks[1].content.endsWith("w299")).toBe(true);
  });

  it("captures correct start_sec / end_sec from word timestamps", () => {
    const words = makeWords(100, 2); // 50 seconds total
    const chunks = chunkTranscript(words);
    expect(chunks[0].start_sec).toBe(Math.floor(words[0].start));
    expect(chunks[0].end_sec).toBe(Math.ceil(words[99].end));
  });
});

describe("chunkRawText", () => {
  it("returns empty array for empty/whitespace input", () => {
    expect(chunkRawText("")).toEqual([]);
    expect(chunkRawText("   \n\t   ")).toEqual([]);
  });

  it("produces a single chunk for short text", () => {
    const text = "alpha bravo charlie delta echo";
    const chunks = chunkRawText(text);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe("alpha bravo charlie delta echo");
    expect(chunks[0].start_sec).toBe(0);
    expect(chunks[0].end_sec).toBe(0);
  });

  it("chunks long text with the same overlap as chunkTranscript", () => {
    const words = Array.from({ length: 300 }, (_, i) => `w${i}`).join(" ");
    const chunks = chunkRawText(words);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].content.split(" ")).toHaveLength(200);
    expect(chunks[1].content.startsWith("w150")).toBe(true);
    expect(chunks.every((c) => c.start_sec === 0 && c.end_sec === 0)).toBe(true);
  });
});
