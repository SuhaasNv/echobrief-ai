/**
 * Vitest setup — loads .env once before any test runs.
 * Integration tests need DATABASE_URL, AUTH_SECRET, etc. from .env.
 */
import "dotenv/config";
import { afterAll } from "vitest";
import { execSync } from "node:child_process";
import { closeSql } from "../src/server/db";
import { closeRedis } from "../src/server/services/redis";
import { closeQueue } from "../src/server/services/queue";

if (process.env.DATABASE_URL && !(globalThis as unknown as Record<string, boolean>).__MIGRATED__) {
  (globalThis as unknown as Record<string, boolean>).__MIGRATED__ = true;
  try {
    execSync("node scripts/migrate.mjs", { stdio: "inherit" });
  } catch (err) {
    console.error("[Test Setup] Failed to run database migrations:", err);
  }
}

afterAll(async () => {
  await Promise.all([closeSql(), closeRedis(), closeQueue()]);
});
