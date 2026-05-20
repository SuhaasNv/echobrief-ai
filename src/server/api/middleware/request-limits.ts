/**
 * Request size limits middleware.
 * 
 * Protects against:
 * - DoS attacks via giant request bodies
 * - Header bomb attacks (large headers)
 * - Memory exhaustion from uncontrolled input
 * 
 * Limits:
 * - JSON body: 10MB max (generous for audio metadata, but prevents abuse)
 * - Individual headers: 8KB max (prevents header bombs)
 */

import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppBindings } from "../types";

// Size limits
const MAX_JSON_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_HEADER_SIZE = 8 * 1024; // 8KB

export const requestLimits: MiddlewareHandler<AppBindings> = async (c, next) => {
  // Check Content-Length header for body size
  const contentLength = c.req.header("content-length");
  if (contentLength) {
    const sizeBytes = parseInt(contentLength, 10);
    
    if (isNaN(sizeBytes) || sizeBytes < 0) {
      throw new HTTPException(400, {
        message: "Invalid Content-Length header",
      });
    }
    
    if (sizeBytes > MAX_JSON_SIZE) {
      throw new HTTPException(413, {
        message: `Request body too large. Maximum size: ${MAX_JSON_SIZE / 1024 / 1024}MB`,
      });
    }
  }
  
  // Check individual header sizes
  const headers = c.req.raw.headers;
  for (const [key, value] of headers.entries()) {
    if (value && value.length > MAX_HEADER_SIZE) {
      throw new HTTPException(431, {
        message: `Header '${key}' too large. Maximum size: ${MAX_HEADER_SIZE / 1024}KB`,
      });
    }
  }
  
  await next();
};
