/**
 * Security headers middleware.
 *
 * Provides defense-in-depth against common web vulnerabilities:
 * - Content Security Policy (CSP) - XSS protection
 * - X-Frame-Options - Clickjacking protection
 * - Permissions-Policy - Feature access controls
 * - HSTS - Force HTTPS in production
 */

import type { MiddlewareHandler } from "hono";
import type { AppBindings } from "../types";
import { getEnv } from "../../env";

export const securityHeaders: MiddlewareHandler<AppBindings> = async (c, next) => {
  await next();

  // Basic security headers
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("X-XSS-Protection", "1; mode=block");
  c.header("Cross-Origin-Resource-Policy", "same-site");

  // Content Security Policy (CSP) - XSS protection
  // Tailored for API server serving JSON responses and potentially embedded content
  const cspDirectives = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // For dev tooling, tighten in prod if needed
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https: blob:",
    "connect-src 'self' https://api.openai.com https://api.assemblyai.com wss:",
    "media-src 'self' blob: https://*.r2.dev https://*.cloudflare.com",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ];
  c.header("Content-Security-Policy", cspDirectives.join("; "));

  // Permissions Policy - Restrict browser features
  c.header(
    "Permissions-Policy",
    "camera=self, microphone=self, geolocation=(), payment=(), usb=()",
  );

  // HSTS only in production (avoid breaking local dev)
  if (getEnv().NODE_ENV === "production") {
    c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  }
};
