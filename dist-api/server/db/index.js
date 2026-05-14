/**
 * Postgres connection (Railway).
 *
 * One pooled connection lives for the process lifetime. Per-request user
 * isolation is enforced at query time: every route includes
 * `WHERE user_id = ${userId}` (sourced from the authenticated JWT).
 *
 * postgres.js uses tagged-template SQL — automatically parameterized,
 * SQL-injection safe by construction.
 */
import postgres from "postgres";
import { getEnv } from "../env";
let _sql = null;
export function getSql() {
    if (_sql)
        return _sql;
    const env = getEnv();
    _sql = postgres(env.DATABASE_URL, {
        ssl: "require",
        max: 10,
        idle_timeout: 30,
        connect_timeout: 10,
        prepare: false,
    });
    return _sql;
}
export async function closeSql() {
    if (_sql) {
        await _sql.end({ timeout: 5 });
        _sql = null;
    }
}
export * from "./types";
//# sourceMappingURL=index.js.map