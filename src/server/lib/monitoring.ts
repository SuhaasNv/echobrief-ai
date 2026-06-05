/**
 * Sentry monitoring and APM integration.
 *
 * Provides:
 * - Error tracking and alerting
 * - Performance monitoring (APM)
 * - Distributed tracing
 * - Custom metrics and events
 *
 * Usage:
 *   import { initMonitoring, captureException } from "./monitoring";
 *   initMonitoring(); // In src/api.ts
 *   captureException(error, { userId, requestId });
 */

import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";
import { getEnv } from "../env";

let initialized = false;

export function initMonitoring() {
  if (initialized) {
    console.warn("[Sentry] Already initialized");
    return;
  }

  const env = getEnv();

  if (!process.env.SENTRY_DSN) {
    console.warn("⚠️  SENTRY_DSN not set - monitoring disabled");
    return;
  }

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: env.NODE_ENV,
    integrations: [nodeProfilingIntegration()],
    // Performance monitoring - sample 100% in dev, 10% in prod
    tracesSampleRate: env.NODE_ENV === "production" ? 0.1 : 1.0,
    // Profiling - sample 10% of transactions
    profilesSampleRate: 0.1,
    // Release tracking (optional - set via SENTRY_RELEASE env var)
    release: process.env.SENTRY_RELEASE || undefined,
  });

  initialized = true;
  console.log(`[Sentry] Initialized (env: ${env.NODE_ENV})`);
}

/**
 * Capture an exception with optional context.
 */
export function captureException(error: Error, context?: Record<string, unknown>) {
  if (!initialized) {
    console.error("[Sentry] Not initialized - logging error locally:", error);
    return;
  }

  Sentry.captureException(error, {
    extra: context,
  });
}

/**
 * Capture a message (info, warning, error).
 */
export function captureMessage(message: string, level: "info" | "warning" | "error" = "info") {
  if (!initialized) {
    const logFn =
      level === "error" ? console.error : level === "warning" ? console.warn : console.log;
    logFn(`[Sentry] Not initialized - ${message}`);
    return;
  }

  Sentry.captureMessage(message, level);
}

/**
 * Set user context for error tracking.
 */
export function setUser(user: { id: string; email?: string; tier?: string }) {
  if (!initialized) return;

  Sentry.setUser({
    id: user.id,
    email: user.email,
    tier: user.tier,
  });
}

/**
 * Clear user context (e.g., on logout).
 */
export function clearUser() {
  if (!initialized) return;
  Sentry.setUser(null);
}

/**
 * Check if Sentry is initialized.
 */
export function isInitialized(): boolean {
  return initialized;
}

// Export Sentry for advanced usage
export { Sentry };
