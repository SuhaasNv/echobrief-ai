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

import postgres, { type Sql } from "postgres";
import { getEnv } from "../env";

let _sql: Sql | null = null;

export function getSql(): Sql {
  if (_sql) return _sql;
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

export async function closeSql(): Promise<void> {
  if (_sql) {
    await _sql.end({ timeout: 5 });
    _sql = null;
  }
}

export type { Sql };
export * from "./types";
