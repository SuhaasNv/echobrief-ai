/**
 * Postgres connection (Railway).
 *
 * One pooled connection lives for the process lifetime. Per-request user
 * isolation is enforced at query time: every route includes
 * `WHERE user_id = ${userId}` (sourced from the authenticated JWT).
 *
 * postgres.js uses tagged-template SQL — automatically parameterized,
 * SQL-injection safe by construction.
 *
 * POOL SIZING: the pool is per PROCESS, but max_connections is per SERVER, and
 * every process shares one Railway Postgres (default max_connections ≈ 100).
 * The budget is therefore pool_size × (api replicas + worker replicas), and it
 * is spent at BOOT — postgres.js opens connections eagerly, so an oversized
 * pool does not degrade under load, it refuses to start with "too many clients
 * already" the moment a second replica or an overlapping deploy comes up.
 * Scale out by adding replicas, not by widening each process's pool; raise
 * DB_POOL_SIZE only alongside a matching max_connections (or PgBouncer).
 */

import postgres, { type Sql } from "postgres";
import { getEnv } from "../env";

let _sql: Sql | null = null;

export function getSql(): Sql {
  if (_sql) return _sql;
  const env = getEnv();

  // 12 leaves room for api + worker + a deploy overlap inside a ~100 connection
  // server (see header). Was 100, which put api + worker at 200 and failed on boot.
  const maxConnections = parseInt(process.env.DB_POOL_SIZE || "12");

  // SSL: required in production (Railway), disabled in test/local (Docker Postgres has no SSL)
  const sslConfig = env.NODE_ENV === "production" ? ("require" as const) : false;

  _sql = postgres(env.DATABASE_URL, {
    ssl: sslConfig,
    max: maxConnections, // per process — total across processes must fit max_connections
    idle_timeout: 20, // Recycle idle connections faster (down from 30)
    connect_timeout: 10,
    prepare: false,
    max_lifetime: 60 * 60, // Recycle connections after 1 hour

    // Connection health monitoring
    onnotice: () => {}, // Suppress NOTICE logs to reduce noise
  });

  if (env.NODE_ENV === "development") {
    console.log(`[DB] Connected with pool size: ${maxConnections}`);
  }

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
