/**
 * Transcript chunking for vector embedding.
 *
 * Strategy: 200-word chunks with 50-word overlap to preserve context across
 * chunk boundaries. Each chunk carries time-range metadata sourced from the
 * underlying word-level transcript.
 */

import type { TranscriptionWord } from "../services/assemblyai";

const CHUNK_WORDS = 200;
const OVERLAP_WORDS = 50;

export interface TranscriptChunk {
  index: number;
  content: string;
  start_sec: number;
  end_sec: number;
}

export function chunkTranscript(words: TranscriptionWord[]): TranscriptChunk[] {
  if (words.length === 0) return [];

  const chunks: TranscriptChunk[] = [];
  let index = 0;
  let i = 0;

  while (i < words.length) {
    const end = Math.min(i + CHUNK_WORDS, words.length);
    const slice = words.slice(i, end);
    chunks.push({
      index: index++,
      content: slice.map((w) => w.word).join(" "),
      start_sec: Math.floor(slice[0].start),
      end_sec: Math.ceil(slice[slice.length - 1].end),
    });

    if (end === words.length) break;
    i += CHUNK_WORDS - OVERLAP_WORDS;
  }

  return chunks;
}

/**
 * Chunk by raw text only — fallback when no word-level timestamps exist.
 * Returns chunks with start_sec/end_sec = 0.
 */
export function chunkRawText(text: string): TranscriptChunk[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const chunks: TranscriptChunk[] = [];
  let index = 0;
  let i = 0;

  while (i < words.length) {
    const end = Math.min(i + CHUNK_WORDS, words.length);
    chunks.push({
      index: index++,
      content: words.slice(i, end).join(" "),
      start_sec: 0,
      end_sec: 0,
    });
    if (end === words.length) break;
    i += CHUNK_WORDS - OVERLAP_WORDS;
  }

  return chunks;
}
