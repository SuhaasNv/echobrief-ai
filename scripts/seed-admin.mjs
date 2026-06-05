#!/usr/bin/env node
/**
 * Seed (or update) the admin user from env vars.
 *
 *   ADMIN_EMAIL    — required, e.g. you@yourdomain.com
 *   ADMIN_PASSWORD — required, plaintext (only used here, never stored)
 *
 * argon2id is OWASP-recommended (2026). Idempotent: re-running rotates the
 * hash and re-asserts is_admin=true. Plaintext is never logged.
 *
 * Usage:  npm run seed:admin
 */

import postgres from "postgres";
import argon2 from "argon2";

const { DATABASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;

if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
if (!ADMIN_EMAIL) {
  console.error("ADMIN_EMAIL is not set. Add it to .env, e.g. ADMIN_EMAIL=you@yourdomain.com");
  process.exit(1);
}
if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 8) {
  console.error(
    "ADMIN_PASSWORD is not set or is shorter than 8 characters. Add it to .env, then re-run.",
  );
  process.exit(1);
}

const email = ADMIN_EMAIL.trim().toLowerCase();

const sql = postgres(DATABASE_URL, { ssl: "require", max: 1, prepare: false });

async function main() {
  console.log(`Hashing password for ${email}…`);
  const passwordHash = await argon2.hash(ADMIN_PASSWORD, { type: argon2.argon2id });

  console.log("Upserting admin row…");
  const rows = await sql`
    INSERT INTO users (email, name, password_hash, is_admin)
    VALUES (${email}, 'Admin', ${passwordHash}, TRUE)
    ON CONFLICT (email) DO UPDATE
      SET password_hash = EXCLUDED.password_hash,
          is_admin      = TRUE,
          updated_at    = now()
    RETURNING id, email, is_admin, created_at, updated_at
  `;

  console.log("Done:", rows[0]);
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
