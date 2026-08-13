import { useCallback, useSyncExternalStore } from "react";
import * as SecureStore from "expo-secure-store";

/**
 * Device-local settings.
 *
 * Everything in here is a real, working control with no server behind it yet.
 * That is a deliberate position rather than a placeholder: a settings surface
 * that shows a switch which does nothing, or one that reports "Saved" to an
 * endpoint that does not exist, is worse than one that says plainly where the
 * value lives. Every screen built on this store tells the user it is stored on
 * this iPhone, and nothing here claims to have synced.
 *
 * When the API grows these fields, the migration is: keep this as the cache,
 * seed it from the server response, and write through on change.
 *
 * Storage is the Keychain via expo-secure-store. Not because preferences are
 * secret, but because it is the one persistent store already wired into this
 * app, and adding AsyncStorage for ~1KB of JSON is not worth a native module.
 * Reads are async, so the same pattern as token-store applies: hydrate once
 * into memory, serve synchronously, write through.
 */

const STORAGE_KEY = "echobrief-preferences-v1";

/** Keychain items have a practical size limit; a runaway list would fail to write. */
export const MAX_VOCABULARY_TERMS = 100;

export type AudioQuality = "efficient" | "balanced" | "high";
export type RetentionWindow = 7 | 30 | 90 | 365 | 0;
export type SummaryStyle = "executive" | "detailed" | "bullets" | "decisions";
export type SummaryLength = "short" | "standard" | "long";
export type SummaryTone = "neutral" | "direct" | "warm";

/** Option tables. Shared by the pickers and by the persisted-value validation. */
export interface Choice<T> {
  value: T;
  label: string;
  detail?: string;
}

export const AUDIO_QUALITIES: readonly Choice<AudioQuality>[] = [
  { value: "efficient", label: "Efficient", detail: "Smallest files, fastest upload on cellular" },
  { value: "balanced", label: "Balanced", detail: "Recommended for meetings and calls" },
  { value: "high", label: "High", detail: "Best for noisy rooms and far-field mics" },
] as const;

export const RETENTION_WINDOWS: readonly Choice<RetentionWindow>[] = [
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
  { value: 365, label: "1 year" },
  { value: 0, label: "Until I delete it" },
] as const;

export const SUMMARY_STYLES: readonly Choice<SummaryStyle>[] = [
  { value: "executive", label: "Executive brief", detail: "Outcome first, then the reasoning" },
  { value: "detailed", label: "Detailed notes", detail: "Section by section, close to the room" },
  { value: "bullets", label: "Bullet points", detail: "Scannable, no prose" },
  { value: "decisions", label: "Decisions only", detail: "What was settled and by whom" },
] as const;

export const SUMMARY_LENGTHS: readonly Choice<SummaryLength>[] = [
  { value: "short", label: "Short", detail: "A paragraph" },
  { value: "standard", label: "Standard", detail: "Half a page" },
  { value: "long", label: "Long", detail: "Full coverage" },
] as const;

export const SUMMARY_TONES: readonly Choice<SummaryTone>[] = [
  { value: "neutral", label: "Neutral", detail: "Reports what was said" },
  { value: "direct", label: "Direct", detail: "Short sentences, no hedging" },
  { value: "warm", label: "Warm", detail: "Conversational, easier to forward" },
] as const;

/**
 * Transcription languages.
 *
 * A short, honest list rather than every code the model claims to accept: this
 * is a picker someone scrolls with a thumb, and the long tail is better served
 * by automatic detection than by 90 rows.
 */
export const LANGUAGES: readonly Choice<string | null>[] = [
  { value: null, label: "Detect automatically", detail: "Recommended" },
  { value: "en", label: "English" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "it", label: "Italian" },
  { value: "pt", label: "Portuguese" },
  { value: "nl", label: "Dutch" },
  { value: "hi", label: "Hindi" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
  { value: "zh", label: "Chinese" },
] as const;

/**
 * Time zones offered in the picker.
 *
 * A curated list, not the full IANA database. Hermes does not ship
 * `Intl.supportedValuesOf`, and a 400-row picker is worse than a short list
 * plus the device's own zone, which is what almost everyone wants anyway.
 */
export const COMMON_TIMEZONES: readonly string[] = [
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Madrid",
  "Africa/Lagos",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
] as const;

export interface Preferences {
  // --- Profile extras. Name and email are server-owned; these are not. ------
  /** Local file URI from the photo library. Never uploaded — there is no endpoint. */
  avatarUri: string | null;
  role: string;
  /** IANA zone id, or null to follow the device. */
  timezone: string | null;

  // --- Recording defaults --------------------------------------------------
  audioQuality: AudioQuality;
  autoStartOnCalendar: boolean;
  keepAudioAfterProcessing: boolean;
  /** Days to keep audio. 0 keeps it until it is deleted by hand. */
  retentionDays: RetentionWindow;

  // --- Transcription -------------------------------------------------------
  /** BCP-47 code, or null for automatic detection. */
  language: string | null;
  /** Proper nouns the model should not mangle. */
  vocabulary: string[];
  rememberSpeakerNames: boolean;

  // --- AI output -----------------------------------------------------------
  summaryStyle: SummaryStyle;
  summaryLength: SummaryLength;
  detectActionItems: boolean;
  tone: SummaryTone;

  // --- Notifications -------------------------------------------------------
  // "Meeting ready" is NOT here. It lives in src/lib/notifications, which owns
  // the iOS permission as well as the preference; a second copy of that value
  // would drift the moment someone changed it in iOS Settings.
  notifyWeeklyDigest: boolean;
  notifyActionItemsDue: boolean;

  // --- Privacy -------------------------------------------------------------
  /** Opt-in, never opt-out, and the copy says exactly what it covers. */
  allowModelTraining: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  avatarUri: null,
  role: "",
  timezone: null,

  audioQuality: "balanced",
  autoStartOnCalendar: false,
  keepAudioAfterProcessing: true,
  retentionDays: 90,

  language: null,
  vocabulary: [],
  rememberSpeakerNames: true,

  summaryStyle: "executive",
  summaryLength: "standard",
  detectActionItems: true,
  tone: "neutral",

  notifyWeeklyDigest: false,
  notifyActionItemsDue: true,

  allowModelTraining: false,
};

let state: Preferences = DEFAULT_PREFERENCES;
let hydrated = false;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

// --- Persisted-value validation ---------------------------------------------
// Field by field, never a wholesale spread: a blob written by an older build
// could otherwise introduce a key of the wrong type that every consumer trusts.

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function oneOf<T extends string | number>(
  value: unknown,
  choices: readonly Choice<T>[],
  fallback: T,
): T {
  return choices.some((choice) => choice.value === value) ? (value as T) : fallback;
}

function terms(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .slice(0, MAX_VOCABULARY_TERMS);
}

function parse(raw: string): Preferences {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) return DEFAULT_PREFERENCES;

  const source = parsed as Record<string, unknown>;
  const d = DEFAULT_PREFERENCES;

  return {
    avatarUri: nullableText(source.avatarUri),
    role: text(source.role, d.role),
    timezone: nullableText(source.timezone),

    audioQuality: oneOf(source.audioQuality, AUDIO_QUALITIES, d.audioQuality),
    autoStartOnCalendar: bool(source.autoStartOnCalendar, d.autoStartOnCalendar),
    keepAudioAfterProcessing: bool(source.keepAudioAfterProcessing, d.keepAudioAfterProcessing),
    retentionDays: oneOf(source.retentionDays, RETENTION_WINDOWS, d.retentionDays),

    language: nullableText(source.language),
    vocabulary: terms(source.vocabulary),
    rememberSpeakerNames: bool(source.rememberSpeakerNames, d.rememberSpeakerNames),

    summaryStyle: oneOf(source.summaryStyle, SUMMARY_STYLES, d.summaryStyle),
    summaryLength: oneOf(source.summaryLength, SUMMARY_LENGTHS, d.summaryLength),
    detectActionItems: bool(source.detectActionItems, d.detectActionItems),
    tone: oneOf(source.tone, SUMMARY_TONES, d.tone),

    notifyWeeklyDigest: bool(source.notifyWeeklyDigest, d.notifyWeeklyDigest),
    notifyActionItemsDue: bool(source.notifyActionItemsDue, d.notifyActionItemsDue),

    allowModelTraining: bool(source.allowModelTraining, d.allowModelTraining),
  };
}

let hydration: Promise<void> | null = null;

export function hydratePreferences(): Promise<void> {
  if (hydration) return hydration;

  hydration = SecureStore.getItemAsync(STORAGE_KEY)
    .then((raw) => {
      if (!raw) return;
      try {
        state = parse(raw);
      } catch {
        // Corrupt entry. Defaults beat a crash on first navigation.
        state = DEFAULT_PREFERENCES;
      }
    })
    .catch(() => {
      // Keychain unavailable. Preferences are not worth failing a screen over.
    })
    .finally(() => {
      hydrated = true;
      emit();
    });

  return hydration;
}

// Kick off at import so the store is warm before anyone navigates to Settings.
void hydratePreferences();

function persist(): void {
  SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(state)).catch(() => {
    // A failed write means the value survives this session but not the next.
    // Failing the interaction would be worse; the control still reflects state.
  });
}

export function setPreference<K extends keyof Preferences>(key: K, value: Preferences[K]): void {
  if (Object.is(state[key], value)) return;
  state = { ...state, [key]: value };
  emit();
  persist();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): Preferences {
  return state;
}

export function usePreferences(): Preferences {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** `[value, setValue]`, so a screen reads like local state. */
export function usePreference<K extends keyof Preferences>(
  key: K,
): [Preferences[K], (value: Preferences[K]) => void] {
  const preferences = usePreferences();
  const set = useCallback((value: Preferences[K]) => setPreference(key, value), [key]);
  return [preferences[key], set];
}

/** Add a vocabulary term. Case-insensitive de-dupe, newest first. */
export function addVocabularyTerm(term: string): "added" | "duplicate" | "full" | "empty" {
  const trimmed = term.trim();
  if (!trimmed) return "empty";

  const existing = state.vocabulary;
  if (existing.some((item) => item.toLowerCase() === trimmed.toLowerCase())) return "duplicate";
  if (existing.length >= MAX_VOCABULARY_TERMS) return "full";

  setPreference("vocabulary", [trimmed, ...existing]);
  return "added";
}

export function removeVocabularyTerm(term: string): void {
  setPreference(
    "vocabulary",
    state.vocabulary.filter((item) => item !== term),
  );
}

/** The zone actually in effect: the stored override, or the device's own. */
export function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** "Los Angeles" out of "America/Los_Angeles" — the part anyone actually reads. */
export function timezoneLabel(zone: string): string {
  const city = zone.split("/").pop() ?? zone;
  return city.replace(/_/g, " ");
}

export function labelFor<T>(choices: readonly Choice<T>[], value: T): string {
  return choices.find((choice) => choice.value === value)?.label ?? "";
}
