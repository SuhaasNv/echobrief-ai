/**
 * Vitest setup — loads .env once before any test runs.
 * Integration tests need DATABASE_URL, AUTH_SECRET, etc. from .env.
 */
import "dotenv/config";
import { afterAll } from "vitest";
import { closeSql } from "../src/server/db";
import { closeRedis } from "../src/server/services/redis";
import { closeQueue } from "../src/server/services/queue";

afterAll(async () => {
  await Promise.all([closeSql(), closeRedis(), closeQueue()]);
});
