/**
 * AssemblyAI service.
 *
 * Used for:
 *   - Batch transcription of uploaded audio (queue worker)
 *   - Speaker diarization (built into the same call)
 *   - V3 voice-agent / live transcription will use the streaming Universal-Streaming API
 *
 * Why AssemblyAI: best-in-class diarization, native LeMUR access if we ever
 * need transcript-grounded Q&A inside the same vendor, and one of the lowest
 * per-minute prices for high-accuracy models.
 */

import { AssemblyAI, type Transcript } from "assemblyai";
import { getEnv } from "../env";

const MODEL = "best"; // AssemblyAI's flagship; "nano" is cheaper/faster

export interface TranscriptionWord {
  word: string;
  start: number; // seconds
  end: number; // seconds
  confidence: number;
  speaker: string | null;
}

export interface TranscriptionParagraph {
  start: number;
  end: number;
  speaker: string | null;
  text: string;
}

export interface TranscriptionResult {
  raw_text: string;
  language: string;
  words: TranscriptionWord[];
  paragraphs: TranscriptionParagraph[];
  speakers: Array<{
    id: string;
    label: string;
    talk_time_sec: number;
    word_count: number;
  }>;
  duration_sec: number;
  cost_usd: number;
}

let _client: AssemblyAI | null = null;

function getClient(): AssemblyAI {
  if (_client) return _client;
  const env = getEnv();
  if (!env.ASSEMBLYAI_API_KEY) {
    throw new Error("ASSEMBLYAI_API_KEY not configured");
  }
  _client = new AssemblyAI({ apiKey: env.ASSEMBLYAI_API_KEY });
  return _client;
}

/**
 * Transcribe an audio file by URL. AssemblyAI polls internally and waits for
 * completion; we don't have to manage the job state.
 */
export async function transcribeAudioUrl(
  audioUrl: string,
  language = "en",
): Promise<TranscriptionResult> {
  const env = getEnv();
  if (!env.ASSEMBLYAI_API_KEY) {
    return stubTranscription(language);
  }

  const client = getClient();
  const transcript = await client.transcripts.transcribe({
    audio: audioUrl,
    speech_model: MODEL,
    speaker_labels: true,
    punctuate: true,
    format_text: true,
    language_code: language,
  });

  if (transcript.status === "error") {
    throw new Error(`AssemblyAI transcription failed: ${transcript.error ?? "unknown error"}`);
  }

  return normalize(transcript, language);
}

function normalize(t: Transcript, language: string): TranscriptionResult {
  const words: TranscriptionWord[] = (t.words ?? []).map((w) => ({
    word: w.text,
    start: w.start / 1000,
    end: w.end / 1000,
    confidence: w.confidence,
    speaker: w.speaker ?? null,
  }));

  // AssemblyAI utterances are speaker-segmented; fall back to paragraphs if absent.
  const paragraphs: TranscriptionParagraph[] = (t.utterances ?? []).map((u) => ({
    start: u.start / 1000,
    end: u.end / 1000,
    speaker: u.speaker ?? null,
    text: u.text,
  }));

  const speakers = computeSpeakerStats(words);
  const duration_sec = Math.floor((t.audio_duration ?? 0));
  const cost_usd = (duration_sec / 60) * 0.0035; // ~$0.0035/min for "best" tier

  return {
    raw_text: t.text ?? "",
    language,
    words,
    paragraphs,
    speakers,
    duration_sec,
    cost_usd,
  };
}

function computeSpeakerStats(words: TranscriptionWord[]) {
  const stats = new Map<string, { word_count: number; talk_time_sec: number }>();
  for (const w of words) {
    if (!w.speaker) continue;
    const cur = stats.get(w.speaker) ?? { word_count: 0, talk_time_sec: 0 };
    cur.word_count += 1;
    cur.talk_time_sec += w.end - w.start;
    stats.set(w.speaker, cur);
  }
  return Array.from(stats.entries()).map(([id, s]) => ({
    id: `speaker_${id}`,
    label: `Speaker ${id}`,
    talk_time_sec: Math.round(s.talk_time_sec),
    word_count: s.word_count,
  }));
}

function stubTranscription(language: string): TranscriptionResult {
  return {
    raw_text: "[Transcription pending — ASSEMBLYAI_API_KEY not configured]",
    language,
    words: [],
    paragraphs: [],
    speakers: [],
    duration_sec: 0,
    cost_usd: 0,
  };
}
