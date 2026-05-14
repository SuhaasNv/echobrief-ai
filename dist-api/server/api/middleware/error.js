/**
 * Centralized error handler. Converts unhandled exceptions and HTTPException
 * into a normalized JSON envelope so the client always sees the same shape.
 */
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
export const errorHandler = (err, c) => {
    if (err instanceof HTTPException) {
        return c.json({
            error: "http_error",
            message: err.message,
        }, err.status);
    }
    if (err instanceof ZodError) {
        return c.json({
            error: "validation_error",
            message: "Request validation failed",
            details: err.flatten(),
        }, 400);
    }
    console.error("[unhandled-error]", err);
    return c.json({
        error: "internal_error",
        message: "An unexpected error occurred",
    }, 500);
};
//# sourceMappingURL=error.js.map