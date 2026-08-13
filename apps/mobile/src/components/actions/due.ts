/**
 * Due-date wording for a single action item.
 *
 * Deliberately not `formatListDate`. That formatter answers "when did this
 * happen" and collapses today to a time of day — "2:14 PM" is a meaningless
 * label for a deadline. This one answers "how much time is left", which is the
 * only question a task list is ever asked.
 *
 * The label also carries lateness in WORDS ("3 days overdue"), so overdue never
 * depends on the red alone. Colour-blind users, Increase Contrast, Smart
 * Invert, and a greyscale screenshot all still read it correctly.
 */

export interface DueState {
  /** Whole days until due; negative once past. Null when there is no date. */
  days: number | null;
  overdue: boolean;
  /** "Due today" / "2 days overdue" / "Due Friday". Null when there is no date. */
  label: string | null;
}

const NO_DUE_DATE: DueState = { days: null, overdue: false, label: null };

export function dueState(iso: string | null | undefined, now: Date = new Date()): DueState {
  if (!iso) return NO_DUE_DATE;

  const due = new Date(iso);
  if (Number.isNaN(due.getTime())) return NO_DUE_DATE;

  // Day granularity, matching groupByDue: something due later today is not late.
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const days = Math.round((dueDay.getTime() - startOfToday.getTime()) / 86_400_000);

  if (days < 0) {
    const late = Math.abs(days);
    return {
      days,
      overdue: true,
      label: late === 1 ? "1 day overdue" : `${late} days overdue`,
    };
  }

  if (days === 0) return { days, overdue: false, label: "Due today" };
  if (days === 1) return { days, overdue: false, label: "Due tomorrow" };
  if (days < 7) {
    return {
      days,
      overdue: false,
      label: `Due ${due.toLocaleDateString(undefined, { weekday: "long" })}`,
    };
  }

  const sameYear = due.getFullYear() === now.getFullYear();
  return {
    days,
    overdue: false,
    label: `Due ${due.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      ...(sameYear ? {} : { year: "numeric" }),
    })}`,
  };
}
