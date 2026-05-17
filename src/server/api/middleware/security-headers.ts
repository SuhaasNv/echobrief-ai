/**
 * Baseline security headers. Skip CSP — needs careful per-route tuning and
 * we have no inline scripts on API responses anyway. HSTS only in production
 * to avoid breaking local http dev.
 */

import type { MiddlewareHandler } from "hono";
import type { AppBindings } from "../types";
import { getEnv } from "../../env";

export const securityHeaders: MiddlewareHandler<AppBindings> = async (c, next) => {
  await next();

  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header(
    "Permissions-Policy",
    "geolocation=(), microphone=(), camera=(), payment=()",
  );
  c.header("Cross-Origin-Resource-Policy", "same-site");

  if (getEnv().NODE_ENV === "production") {
    // 1 year, including subdomains. Only safe once we're sure HTTPS works
    // everywhere — true for Railway prod.
    c.header(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  }
};
