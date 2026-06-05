#!/usr/bin/env node
/**
 * Migration runner. Applies SQL files from /migrations in order.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/migrate.mjs
 *
 * Tracks applied migrations in a `_migrations` table.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "migrations");

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

// SSL: required in production (Railway), disabled in test/CI (Docker Postgres has no SSL)
const sslConfig = process.env.NODE_ENV === "production" ? "require" : false;

const sql = postgres(DATABASE_URL, {
  ssl: sslConfig,
  max: 1,
  prepare: false,
});

async function main() {
  await sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT now()
    )
  `;

  const applied = new Set((await sql`SELECT name FROM _migrations`).map((r) => r.name));

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql") && !f.includes("rollback"))
    .sort();

  let applied_count = 0;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`  skip   ${file} (already applied)`);
      continue;
    }
    const contents = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    console.log(`  apply  ${file}`);
    try {
      await sql.unsafe(contents);
      await sql`INSERT INTO _migrations (name) VALUES (${file})`;
      applied_count++;
    } catch (err) {
      console.error(`  FAIL   ${file}: ${err.message}`);
      throw err;
    }
  }

  console.log(`\nDone. ${applied_count} migration(s) applied.`);
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
