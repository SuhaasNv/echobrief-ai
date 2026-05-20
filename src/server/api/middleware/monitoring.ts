/**
 * Sentry monitoring middleware for Hono.
 * 
 * Tracks:
 * - Request errors (captured automatically)
 * - Response times (as metrics)
 * - Slow requests (logged as warnings)
 * - User context (from requireAuth middleware)
 * 
 * Mount AFTER requestId middleware, BEFORE routes.
 */

import type { MiddlewareHandler } from "hono";
import { Sentry, isInitialized, captureException } from "../../lib/monitoring";
import type { AppBindings } from "../types";

export const sentryMiddleware: MiddlewareHandler<AppBindings> = async (c, next) => {
  const start = Date.now();
  const path = c.req.path;
  const method = c.req.method;
  
  // Set Sentry context
  if (isInitialized()) {
    Sentry.setContext("request", {
      id: c.get("requestId"),
      path,
      method,
      ip: c.req.header("x-forwarded-for") || c.req.header("x-real-ip"),
    });
    
    // Set user context if available (populated by requireAuth)
    const user = c.get("user");
    if (user) {
      Sentry.setUser({
        id: user.id,
        email: user.email,
      });
    }
  }
  
  try {
    await next();
  } catch (error) {
    // Capture exception with context
    captureException(error as Error, {
      path,
      method,
      requestId: c.get("requestId"),
      userId: c.get("user")?.id,
      workspaceId: c.get("workspace")?.id,
    });
    
    // Re-throw to let errorHandler middleware handle response
    throw error;
  } finally {
    const duration = Date.now() - start;
    const status = c.res.status;
    
    // Log slow requests
    if (duration > 1000) {
      console.warn(`[SLOW REQUEST] ${method} ${path} - ${duration}ms - ${status}`);
    }
    
    // Track metrics (if Sentry enabled)
    if (isInitialized()) {
      Sentry.metrics.distribution('api.response_time', duration, {
        tags: {
          endpoint: path,
          method,
          status: String(status),
        },
      });
    }
  }
};

/**
 * Performance metrics middleware (lightweight version without exception handling).
 * Use this if you want metrics tracking only, without error capture.
 */
export const metricsMiddleware: MiddlewareHandler<AppBindings> = async (c, next) => {
  const start = Date.now();
  const path = c.req.path;
  const method = c.req.method;
  
  await next();
  
  const duration = Date.now() - start;
  const status = c.res.status;
  
  // Log slow requests
  if (duration > 1000) {
    console.warn(`[SLOW REQUEST] ${method} ${path} - ${duration}ms - ${status}`);
  }
  
  // Track metrics (if Sentry enabled)
  if (isInitialized()) {
    Sentry.metrics.distribution('api.response_time', duration, {
      tags: {
        endpoint: path,
        method,
        status: String(status),
      },
    });
  }
};
