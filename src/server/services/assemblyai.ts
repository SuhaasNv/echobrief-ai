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

import { AssemblyAI, type Transcript, type TranscriptOptionalParams } from "assemblyai";
import { getEnv } from "../env";

// AssemblyAI deprecated the singular `speech_model` field in 2026 and now
// requires `speech_models` (an array). "universal" is the current flagship.
const MODELS = ["universal"] as const;

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
 * Universal-Streaming token broker. Mints a single-use, short-lived token
 * that the browser can use to open a WebSocket directly to AssemblyAI without
 * ever seeing our API key.
 *
 * Endpoint: GET https://streaming.assemblyai.com/v3/token
 *   - Authorization: <api_key>
 *   - expires_in_seconds: 1-600 (single-use TTL for the token itself)
 *   - max_session_duration_seconds: 60-10800 (full session length cap)
 *
 * Each token is single-use. For sessions longer than 10 minutes the client
 * needs to fetch a new token before its old one expires. We don't manage
 * that here — the recorder UI will request a fresh token mid-session.
 */
export interface StreamingTokenResult {
  token: string;
  ws_url: string;
  expires_at: string;
}

const STREAMING_WS_URL = "wss://streaming.assemblyai.com/v3/ws";

export async function createStreamingToken(
  opts: {
    expiresInSeconds?: number;
    maxSessionDurationSeconds?: number;
  } = {},
): Promise<StreamingTokenResult> {
  const env = getEnv();
  if (!env.ASSEMBLYAI_API_KEY) {
    return stubStreamingToken();
  }

  // expires_in_seconds is the window in which the token can OPEN the WS.
  // max_session_duration_seconds is how long the open session stays live.
  // 300s opening window covers normal latency; 3-hour session covers the
  // longest reasonable lecture without forcing a mid-recording reconnect.
  const expiresIn = Math.min(Math.max(opts.expiresInSeconds ?? 300, 1), 600);
  const maxSession = Math.min(Math.max(opts.maxSessionDurationSeconds ?? 3 * 60 * 60, 60), 10_800);

  const params = new URLSearchParams({
    expires_in_seconds: String(expiresIn),
    max_session_duration_seconds: String(maxSession),
  });

  const response = await fetch(`https://streaming.assemblyai.com/v3/token?${params}`, {
    method: "GET",
    headers: { Authorization: env.ASSEMBLYAI_API_KEY },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`AssemblyAI token request failed (${response.status}): ${text.slice(0, 200)}`);
  }

  const data = (await response.json()) as { token?: string };
  if (!data.token) {
    throw new Error("AssemblyAI returned no token");
  }

  return {
    token: data.token,
    ws_url: STREAMING_WS_URL,
    expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
  };
}

function stubStreamingToken(): StreamingTokenResult {
  return {
    token: "stub-streaming-token",
    ws_url: STREAMING_WS_URL,
    expires_at: new Date(Date.now() + 300_000).toISOString(),
  };
}

/**
 * Transcribe an audio file by URL. AssemblyAI polls internally and waits for
 * completion; we don't have to manage the job state.
 */
/**
 * The transcript as the analyst should read it: who said what, and when.
 *
 * The pipeline paid for diarization, stored it, and rendered it in the app —
 * and then handed the ANALYSIS step `raw_text`, which is one speakerless wall
 * of prose. So the model producing summaries, decisions and action items had
 * no idea anyone had spoken more than once. It guessed owners from names
 * mentioned in passing, which is why "Priya will send the deck" and "ask Priya
 * about the deck" were indistinguishable to it.
 *
 * Timestamps are included because the model is asked for chapter boundaries in
 * seconds. Without them it was inferring position from how far through the text
 * it had read, which is exactly as accurate as it sounds.
 *
 * Falls back to the flat text when there are no utterances — a transcript-only
 * upload has no diarization to format, and an empty labelled document would be
 * strictly worse than the prose.
 */
export function formatDiarizedTranscript(
  paragraphs: TranscriptionParagraph[],
  rawText: string,
): string {
  if (paragraphs.length === 0) return rawText;

  return paragraphs
    .map((p) => {
      const stamp = `[${Math.floor(p.start / 60)}:${String(Math.floor(p.start % 60)).padStart(2, "0")}]`;
      const who = p.speaker ? `Speaker ${p.speaker}` : "Unknown speaker";
      return `${stamp} ${who}: ${p.text}`;
    })
    .join("\n");
}

export interface TranscriptionOptions {
  /**
   * The language to transcribe in, or `null` to let AssemblyAI detect it.
   *
   * Not defaulted. The caller owns the fallback because only the caller knows
   * whether "en" is a user's choice or the schema default nobody looked at.
   */
  language: string | null;
  /**
   * Custom vocabulary — product names, colleague names, acronyms. These are
   * hints, not rules; the model is more willing to hear them, and is not forced
   * to. An empty list sends nothing.
   */
  wordBoost?: string[];
}

/**
 * AssemblyAI rejects a `word_boost` list of more than 1000 phrases outright
 * (400: "`word_boost` list must contain no more than 1000 phrases"), and a
 * rejected request means the meeting fails to transcribe at all. The API and
 * migration 0015 already cap the stored list at 100, so hitting this would take
 * a bug rather than a user — which is exactly the case worth surviving, because
 * losing a few boost hints is recoverable and losing the transcription is not.
 */
const MAX_WORD_BOOST_PHRASES = 1000;

export async function transcribeAudioUrl(
  audioUrl: string,
  opts: TranscriptionOptions,
): Promise<TranscriptionResult> {
  const env = getEnv();
  if (!env.ASSEMBLYAI_API_KEY) {
    return stubTranscription(opts.language ?? "en");
  }

  // `language_detection` and `language_code` are mutually exclusive at the API,
  // not merely redundant: sending both returns 400 "`language_detection` is not
  // available when `language_code` is specified". So this is one choice, not
  // two independent flags.
  //
  // `language_confidence_threshold` is deliberately left at its default of 0.
  // Setting it turns a low-confidence detection into a transcription ERROR,
  // which would convert "we guessed the language badly" — recoverable, the
  // transcript is still mostly readable — into "your meeting failed".
  const languageParams: Pick<TranscriptOptionalParams, "language_code" | "language_detection"> =
    opts.language === null ? { language_detection: true } : { language_code: opts.language };

  const wordBoost = (opts.wordBoost ?? [])
    .map((term) => term.trim())
    .filter((term) => term.length > 0)
    .slice(0, MAX_WORD_BOOST_PHRASES);

  const client = getClient();
  const transcript = await client.transcripts.transcribe({
    audio: audioUrl,
    speech_models: [...MODELS],
    speaker_labels: true,
    punctuate: true,
    format_text: true,
    ...languageParams,
    // Omitted entirely when empty rather than sent as []. `boost_param` is left
    // unset too: the default weighting nudges the decoder, while "high" pushes
    // it hard enough to start hearing a boosted term in words that only rhyme
    // with it, and a term list is meant to fix names, not invent them.
    ...(wordBoost.length > 0 ? { word_boost: wordBoost } : {}),
  });

  if (transcript.status === "error") {
    throw new Error(`AssemblyAI transcription failed: ${transcript.error ?? "unknown error"}`);
  }

  return normalize(transcript, opts.language ?? "en");
}

/**
 * `requested` is only the fallback. With detection enabled there is no
 * requested language at all, and the transcript's own `language_code` is the
 * detected one — that is the value worth storing, since it is what the meeting
 * was actually transcribed as. Falling back to "en" when the vendor returns
 * nothing preserves the pre-detection behaviour rather than writing a NULL that
 * every reader would then have to handle.
 */
function normalize(t: Transcript, requested: string): TranscriptionResult {
  const language = t.language_code ?? requested;
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
  const duration_sec = Math.floor(t.audio_duration ?? 0);
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
