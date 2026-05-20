/**
 * Date formatting utilities
 * 
 * Consolidated date/time formatting functions used across the application.
 * Prevents duplicate implementations and ensures consistent display.
 */

/**
 * Format ISO date string to locale date
 * @param iso - ISO 8601 date string
 * @param includeYear - Whether to include year (default: false for current year dates)
 * @returns Formatted date like "Jan 15" or "Jan 15, 2024"
 */
export function formatDate(iso: string, includeYear = false): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  
  const options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    ...(includeYear && { year: "numeric" }),
  };
  
  return d.toLocaleDateString(undefined, options);
}

/**
 * Format seconds to M:SS duration
 * @param sec - Duration in seconds (can be null)
 * @returns Formatted duration like "5:30" or "—" if null
 */
export function formatDuration(sec: number | null): string {
  if (sec == null) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Format seconds to MM:SS timestamp (always 2-digit minutes)
 * @param sec - Timestamp in seconds
 * @returns Formatted timestamp like "05:30"
 */
export function formatTimestamp(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Format uptime seconds to human-readable string
 * @param sec - Uptime in seconds
 * @returns Formatted uptime like "2d 5h" or "5h 30m"
 */
export function formatUptime(sec: number): string {
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/**
 * Format due date or return fallback text
 * @param due - ISO date string or null
 * @returns Formatted date like "Jan 15" or "No due date"
 */
export function formatDue(due: string | null): string {
  if (!due) return "No due date";
  return formatDate(due);
}

/**
 * Check if a due date is overdue
 * @param due - ISO date string or null
 * @returns true if date is in the past
 */
export function isOverdue(due: string | null): boolean {
  if (!due) return false;
  const d = new Date(due);
  return !Number.isNaN(d.getTime()) && d.getTime() < Date.now();
}

/**
 * Format ISO date to full date-time string
 * @param iso - ISO date string
 * @returns Formatted date-time like "Jan 15, 2024 at 2:30 PM"
 */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Get current date formatted for display
 * @returns Today's date like "Monday, January 15"
 */
export function getTodayFormatted(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}
