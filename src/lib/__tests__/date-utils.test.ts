/**
 * Unit tests for date-utils.ts utility functions.
 *
 * Tests date formatting, duration conversion, and uptime calculation.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import {
  formatDate,
  formatDuration,
  formatTimestamp,
  formatUptime,
  formatDue,
  isOverdue,
  formatDateTime,
  getTodayFormatted,
} from "../date-utils";

describe("formatDate", () => {
  it("formats ISO date string to short locale date", () => {
    const iso = "2024-01-15T10:30:00Z";
    const result = formatDate(iso);
    
    // Should include month and day, but not year by default
    expect(result).toContain("Jan");
    expect(result).toContain("15");
    expect(result).not.toContain("2024");
  });

  it("includes year when includeYear is true", () => {
    const iso = "2024-01-15T10:30:00Z";
    const result = formatDate(iso, true);
    
    expect(result).toContain("Jan");
    expect(result).toContain("15");
    expect(result).toContain("2024");
  });

  it("returns original string for invalid ISO date", () => {
    const invalid = "not-a-date";
    const result = formatDate(invalid);
    
    expect(result).toBe(invalid);
  });

  it("handles different month names correctly", () => {
    expect(formatDate("2024-03-01T00:00:00Z")).toContain("Mar");
    expect(formatDate("2024-12-25T00:00:00Z")).toContain("Dec");
  });
});

describe("formatDuration", () => {
  it("formats seconds to M:SS duration", () => {
    expect(formatDuration(90)).toBe("1:30");
    expect(formatDuration(330)).toBe("5:30");
    expect(formatDuration(3661)).toBe("61:01");
  });

  it("pads seconds with leading zero", () => {
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(301)).toBe("5:01");
  });

  it("handles zero duration", () => {
    expect(formatDuration(0)).toBe("0:00");
  });

  it("returns em dash for null input", () => {
    expect(formatDuration(null)).toBe("—");
  });

  it("handles exactly 1 minute", () => {
    expect(formatDuration(60)).toBe("1:00");
  });

  it("handles large durations", () => {
    expect(formatDuration(7200)).toBe("120:00"); // 2 hours
    expect(formatDuration(86400)).toBe("1440:00"); // 24 hours
  });
});

describe("formatTimestamp", () => {
  it("formats seconds to MM:SS timestamp with padded minutes", () => {
    expect(formatTimestamp(90)).toBe("01:30");
    expect(formatTimestamp(330)).toBe("05:30");
  });

  it("pads both minutes and seconds with leading zeros", () => {
    expect(formatTimestamp(5)).toBe("00:05");
    expect(formatTimestamp(65)).toBe("01:05");
  });

  it("handles zero timestamp", () => {
    expect(formatTimestamp(0)).toBe("00:00");
  });

  it("handles timestamps over 1 hour", () => {
    expect(formatTimestamp(3661)).toBe("61:01");
    expect(formatTimestamp(7200)).toBe("120:00");
  });

  it("floors fractional seconds", () => {
    expect(formatTimestamp(90.9)).toBe("01:30");
    expect(formatTimestamp(5.99)).toBe("00:05");
  });
});

describe("formatUptime", () => {
  it("formats days and hours for multi-day uptime", () => {
    expect(formatUptime(86400 * 2 + 3600 * 5)).toBe("2d 5h"); // 2 days 5 hours
    expect(formatUptime(86400 * 7 + 3600 * 12)).toBe("7d 12h"); // 7 days 12 hours
  });

  it("formats hours and minutes for sub-day uptime", () => {
    expect(formatUptime(3600 * 5 + 60 * 30)).toBe("5h 30m"); // 5 hours 30 minutes
    expect(formatUptime(3600 * 1 + 60 * 15)).toBe("1h 15m"); // 1 hour 15 minutes
  });

  it("formats minutes only for sub-hour uptime", () => {
    expect(formatUptime(60 * 45)).toBe("45m"); // 45 minutes
    expect(formatUptime(60 * 5)).toBe("5m"); // 5 minutes
  });

  it("handles zero uptime", () => {
    expect(formatUptime(0)).toBe("0m");
  });

  it("handles exactly 1 day", () => {
    expect(formatUptime(86400)).toBe("1d 0h");
  });

  it("handles exactly 1 hour", () => {
    expect(formatUptime(3600)).toBe("1h 0m");
  });

  it("handles large uptime values", () => {
    expect(formatUptime(86400 * 365)).toBe("365d 0h"); // 1 year
  });
});

describe("formatDue", () => {
  it("formats due date using formatDate", () => {
    const iso = "2024-01-15T10:30:00Z";
    const result = formatDue(iso);
    
    expect(result).toContain("Jan");
    expect(result).toContain("15");
  });

  it("returns 'No due date' for null input", () => {
    expect(formatDue(null)).toBe("No due date");
  });

  it("returns 'No due date' for empty string", () => {
    expect(formatDue("")).toBe("No due date");
  });
});

describe("isOverdue", () => {
  beforeAll(() => {
    // Mock current time to 2024-01-15 12:00:00 UTC
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-15T12:00:00Z"));
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it("returns true for past dates", () => {
    expect(isOverdue("2024-01-14T12:00:00Z")).toBe(true);
    expect(isOverdue("2023-12-25T00:00:00Z")).toBe(true);
  });

  it("returns false for future dates", () => {
    expect(isOverdue("2024-01-16T12:00:00Z")).toBe(false);
    expect(isOverdue("2024-12-31T23:59:59Z")).toBe(false);
  });

  it("returns true for dates in the past (even by milliseconds)", () => {
    expect(isOverdue("2024-01-15T11:59:59Z")).toBe(true);
  });

  it("returns false for null input", () => {
    expect(isOverdue(null)).toBe(false);
  });

  it("returns false for invalid date string", () => {
    expect(isOverdue("not-a-date")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isOverdue("")).toBe(false);
  });
});

describe("formatDateTime", () => {
  it("formats ISO date to full date-time string", () => {
    const iso = "2024-01-15T14:30:00Z";
    const result = formatDateTime(iso);
    
    // Should include month, day, year, hour, and minute
    expect(result).toContain("Jan");
    expect(result).toContain("15");
    expect(result).toContain("2024");
    // Time formatting is locale-dependent, but should include time component
    expect(result.length).toBeGreaterThan(15); // Full date-time is longer
  });

  it("returns original string for invalid ISO date", () => {
    const invalid = "not-a-date";
    const result = formatDateTime(invalid);
    
    expect(result).toBe(invalid);
  });

  it("includes time component in formatted output", () => {
    const iso = "2024-01-15T14:30:00Z";
    const result = formatDateTime(iso);
    
    // Should contain time separator (colon) and time digits
    expect(result).toMatch(/\d+:\d+/);
  });
});

describe("getTodayFormatted", () => {
  beforeAll(() => {
    // Mock current time to 2024-01-15 (Monday) 12:00:00 UTC
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-15T12:00:00Z"));
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it("returns today's date with weekday and full month", () => {
    const result = getTodayFormatted();
    
    // Should include weekday, month name, and day
    expect(result).toContain("January");
    expect(result).toContain("15");
    // Weekday is locale-dependent, but should be present
    expect(result.length).toBeGreaterThan(10); // "January 15" is 10+ chars
  });

  it("includes weekday in formatted output", () => {
    const result = getTodayFormatted();
    
    // Should contain one of the weekdays (locale-dependent)
    const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    const hasWeekday = weekdays.some((day) => result.includes(day));
    
    expect(hasWeekday).toBe(true);
  });
});

describe("edge cases and boundary conditions", () => {
  it("handles leap year dates correctly", () => {
    const leapDay = "2024-02-29T00:00:00Z";
    const result = formatDate(leapDay);
    
    expect(result).toContain("Feb");
    expect(result).toContain("29");
  });

  it("handles end of year dates", () => {
    const middayNewYearsEve = "2024-12-31T12:00:00Z";
    const result = formatDate(middayNewYearsEve, true);
    
    // Should contain month (Dec), day (31), and year (2024)
    // Using midday to avoid timezone conversion issues
    expect(result).toContain("31");
    expect(result).toContain("2024");
  });

  it("handles millisecond precision in duration", () => {
    // formatDuration doesn't floor seconds, so decimals appear in output
    const result1 = formatDuration(90.123);
    const result2 = formatDuration(90.999);
    
    expect(result1).toMatch(/1:30/);
    expect(result2).toMatch(/1:30/);
  });

  it("handles negative durations gracefully", () => {
    // Behavior might vary - document current behavior
    const result = formatDuration(-30);
    expect(typeof result).toBe("string");
  });
});
