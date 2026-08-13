/**
 * Display formatters.
 *
 * Kept together so the meetings list, detail screen, and recorder can't drift
 * into formatting the same value three different ways.
 */

/**
 * A recording with no name is titled with its own timestamp, which then sits
 * beside the date column repeating the same information. "Untitled recording"
 * is more honest and stops the row leading with a string of digits.
 */
const TIMESTAMP_TITLE = /^\w{3},?\s+\w{3}\s+\d{1,2}(\s+at)?\s+\d{1,2}:\d{2}/i;

/**
 * True when a title is really just the timestamp the recorder pre-filled.
 *
 * Surfaces that already sit next to a clock — the meetings list beside its date
 * column, the Live Activity beneath the Lock Screen's own clock — gain nothing
 * from repeating it, and it costs them their most-read line.
 */
export function isPlaceholderTitle(title: string): boolean {
  const trimmed = title.trim();
  return trimmed.length === 0 || TIMESTAMP_TITLE.test(trimmed);
}

export function displayTitle(title: string): string {
  return isPlaceholderTitle(title) ? "Untitled recording" : title;
}

/**
 * Human duration.
 *
 * Deliberately not mm:ss. A 90-minute meeting formatted that way renders as
 * "90:00", and even when it is correct, "12:03" next to "3 speakers" reads as a
 * timestamp rather than a length. iOS says "12 min".
 *
 * Use `formatClock` for playback position, where mm:ss IS what you want.
 */
export function formatDuration(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined || seconds <= 0) return null;

  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 1) return "under a minute";
  if (totalMinutes < 60) return `${totalMinutes} min`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours} hr` : `${hours} hr ${minutes} min`;
}

/** Playback position: 0:07, 12:03, 1:04:22. Pair with tabular-nums. */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Relative date for list rows, matching what Mail and Files show:
 * a time today, a weekday this week, otherwise a date.
 */
export function formatListDate(iso: string | null | undefined): string | null {
  if (!iso) return null;

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayDiff = Math.round((startOfToday.getTime() - startOfDate.getTime()) / 86_400_000);

  if (dayDiff === 0) {
    return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  if (dayDiff === 1) return "Yesterday";
  if (dayDiff > 1 && dayDiff < 7) {
    return date.toLocaleDateString(undefined, { weekday: "long" });
  }
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** "1 speaker" / "3 speakers" — never "1 speakers". */
export function pluralize(count: number, singular: string, plural?: string): string {
  return `${count} ${count === 1 ? singular : (plural ?? `${singular}s`)}`;
}
