#!/usr/bin/env node
/**
 * Row-level DB dump for pre-migration safety. Writes every public.* table
 * to backups/<timestamp>.json. Does NOT include schema (use real pg_dump
 * for that). Re-importable by hand if needed.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/dump.mjs
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKUPS_DIR = join(__dirname, "..", "backups");

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, {
  ssl: "require",
  max: 1,
  prepare: false,
});

async function main() {
  mkdirSync(BACKUPS_DIR, { recursive: true });

  const tables = (await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `).map((r) => r.table_name);

  const dump = {
    dumped_at: new Date().toISOString(),
    database_url_host: new URL(DATABASE_URL).host,
    tables: {},
  };

  for (const t of tables) {
    // Use unsafe for the table name — it comes from the catalog, not user input.
    const rows = await sql.unsafe(`SELECT * FROM public."${t}"`);
    dump.tables[t] = rows;
    console.log(`  ${t.padEnd(28)} ${rows.length} rows`);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = join(BACKUPS_DIR, `${stamp}.json`);
  writeFileSync(outPath, JSON.stringify(dump, null, 2));
  console.log(`\nWritten: ${outPath}`);

  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
