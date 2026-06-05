/**
 * Security event logging service.
 *
 * Centralized logging for security-relevant events:
 * - Authentication failures
 * - Quota bypass attempts
 * - Rate limit violations
 * - Prompt injection detections
 * - Cost spikes
 *
 * Usage:
 *   import { logSecurityEvent, logCostSpike } from "./logger";
 *   logSecurityEvent({ type: "quota_bypass_attempt", userId, details: {...} });
 */

import { captureMessage, Sentry, isInitialized } from "./monitoring";

export type SecurityEventType =
  | "quota_bypass_attempt"
  | "rate_limit_exceeded"
  | "prompt_injection_detected"
  | "auth_failure"
  | "cost_spike"
  | "suspicious_activity"
  | "request_size_limit";

export interface SecurityEvent {
  type: SecurityEventType;
  userId?: string;
  ip?: string;
  requestId?: string;
  details: Record<string, unknown>;
}

/**
 * Log a security event.
 *
 * Logs to:
 * - Console (always, for local debugging and container logs)
 * - Sentry (if configured, for alerting and investigation)
 */
export function logSecurityEvent(event: SecurityEvent) {
  const logEntry = {
    security_event: true,
    ...event,
    timestamp: new Date().toISOString(),
  };

  // Log to console (structured JSON for easy parsing)
  console.warn("[SECURITY]", JSON.stringify(logEntry));

  // Send to Sentry for alerting
  if (isInitialized()) {
    captureMessage(`Security Event: ${event.type}`, "warning");

    // Attach full context
    Sentry.setContext("security_event", logEntry);
  }
}

/**
 * Log a cost spike event (AI budget exceeded).
 */
export function logCostSpike(
  userId: string,
  costUsd: number,
  budgetUsd: number,
  period: string = "daily",
) {
  logSecurityEvent({
    type: "cost_spike",
    userId,
    details: {
      cost_usd: costUsd,
      budget_usd: budgetUsd,
      ratio: costUsd / budgetUsd,
      period,
      message: `Cost ${costUsd.toFixed(2)} exceeded ${period} budget ${budgetUsd.toFixed(2)} (${((costUsd / budgetUsd - 1) * 100).toFixed(1)}% over)`,
    },
  });
}

/**
 * Log a rate limit violation.
 */
export function logRateLimit(
  bucket: string,
  identifier: string,
  count: number,
  limit: number,
  ip?: string,
) {
  logSecurityEvent({
    type: "rate_limit_exceeded",
    userId: identifier,
    ip,
    details: {
      bucket,
      count,
      limit,
      overage: count - limit,
    },
  });
}

/**
 * Log a quota bypass attempt.
 */
export function logQuotaBypass(
  userId: string,
  attemptedValue: unknown,
  reason: string,
  requestId?: string,
) {
  logSecurityEvent({
    type: "quota_bypass_attempt",
    userId,
    requestId,
    details: {
      attempted_value: attemptedValue,
      reason,
      timestamp: new Date().toISOString(),
    },
  });
}

/**
 * Log a prompt injection detection.
 */
export function logPromptInjection(
  userId: string,
  pattern: string,
  match: string,
  inputLength: number,
) {
  logSecurityEvent({
    type: "prompt_injection_detected",
    userId,
    details: {
      pattern,
      match,
      input_length: inputLength,
    },
  });
}

/**
 * Log an authentication failure.
 */
export function logAuthFailure(reason: string, identifier?: string, ip?: string) {
  logSecurityEvent({
    type: "auth_failure",
    userId: identifier,
    ip,
    details: {
      reason,
      timestamp: new Date().toISOString(),
    },
  });
}
