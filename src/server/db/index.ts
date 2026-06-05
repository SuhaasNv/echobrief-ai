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
 * SCALABILITY: Connection pool sized for production load. For 1M users:
 * - 100 connections per API instance
 * - 3-5 API instances = 300-500 total connections
 * - Consider PgBouncer for >500 total connections
 */

import postgres, { type Sql } from "postgres";
import { getEnv } from "../env";

let _sql: Sql | null = null;

export function getSql(): Sql {
  if (_sql) return _sql;
  const env = getEnv();

  // SCALABILITY: Increased from 10 to 100 for production load
  // Railway Postgres supports up to 300 connections total
  const maxConnections = parseInt(process.env.DB_POOL_SIZE || "100");

  // SSL: required in production (Railway), disabled in test/local (Docker Postgres has no SSL)
  const sslConfig = env.NODE_ENV === "production" ? ("require" as const) : false;

  _sql = postgres(env.DATABASE_URL, {
    ssl: sslConfig,
    max: maxConnections, // 100 connections per instance (up from 10)
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
