/**
 * Centralized error handler. Converts unhandled exceptions and HTTPException
 * into a normalized JSON envelope so the client always sees the same shape.
 */

import type { ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import type { AppBindings } from "../types";

export const errorHandler: ErrorHandler<AppBindings> = (err, c) => {
  if (err instanceof HTTPException) {
    // Honor a custom response when the thrower attached one. The quota
    // middleware encodes error/tier/current/limit that way; flattening it to
    // {error:"http_error"} threw away everything the upgrade CTA needs.
    if (err.res) return err.res;
    return c.json(
      {
        error: "http_error",
        message: err.message,
      },
      err.status,
    );
  }

  if (err instanceof ZodError) {
    return c.json(
      {
        error: "validation_error",
        message: "Request validation failed",
        details: err.flatten(),
      },
      400,
    );
  }

  console.error("[unhandled-error]", err);
  return c.json(
    {
      error: "internal_error",
      message: "An unexpected error occurred",
    },
    500,
  );
};
