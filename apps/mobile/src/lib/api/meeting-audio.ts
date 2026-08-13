import { api } from "./client";

/**
 * The signed playback URL for a meeting's audio.
 *
 * Deliberately NOT a react-query hook, unlike everything else in this folder.
 * Three reasons, all specific to this endpoint:
 *
 *   It must not be fetched on mount. The URL is signed and short-lived, so
 *   fetching it because someone opened a meeting burns most of its life before
 *   anyone presses play, and signs a credential for a meeting nobody listens to.
 *
 *   It expires. A cache whose entries silently stop working is worse than no
 *   cache — react-query would happily hand back a dead URL from staleTime, and
 *   the failure surfaces as "audio is broken" rather than "refetch this".
 *   Freshness here is a wall-clock deadline, not a staleness heuristic.
 *
 *   There is exactly one consumer, which already owns retry and recovery
 *   (src/lib/audio/playback.ts). A second retry policy layered underneath it
 *   would fight it.
 */

export interface MeetingAudio {
  /** Signed R2 URL. Streamable directly by AVPlayer. */
  url: string;
  /** Stored content type, or null when the upload did not carry one. */
  mime: string | null;
  /** ISO-8601. The server signs for 30 minutes (see routes/meetings.ts). */
  expires_at: string;
}

/**
 * Server-side TTL, mirrored here only as the fallback used when `expires_at`
 * fails to parse. The server's value is authoritative; this is a floor so a
 * malformed date cannot be read as "already expired" and put playback into a
 * refetch loop.
 */
export const AUDIO_URL_TTL_MS = 30 * 60 * 1000;

export function fetchMeetingAudio(meetingId: string): Promise<MeetingAudio> {
  // Re-checks ownership server-side, so this cannot be used to read another
  // workspace's audio even with a valid session.
  return api.apiRequest<MeetingAudio>(`/meetings/${meetingId}/audio-url`);
}

/** Milliseconds-since-epoch deadline, tolerant of a malformed server date. */
export function audioUrlDeadline(audio: MeetingAudio): number {
  const parsed = Date.parse(audio.expires_at);
  return Number.isNaN(parsed) ? Date.now() + AUDIO_URL_TTL_MS : parsed;
}
