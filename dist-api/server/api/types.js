/**
 * Hono context types. AppBindings is parameterized by the request shape:
 *   - Variables.user — populated by requireAuth middleware
 *   - Variables.requestId — populated by requestId middleware
 *
 * No per-request bindings: we share singleton clients (db, redis) at module
 * scope and read them via getSql() / getRedis().
 */
export {};
//# sourceMappingURL=types.js.map