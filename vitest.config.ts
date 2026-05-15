import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    // Tests live next to the code in __tests__ folders OR top-level tests/ dir.
    include: ["src/**/__tests__/**/*.test.ts", "tests/**/*.test.ts"],
    environment: "node",
    // Integration tests hit Railway Postgres + Redis. Sequential runs avoid
    // cross-test pollution; runtime is still fast (<10s total).
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Tests need the same .env as the API (DATABASE_URL, AUTH_SECRET, etc.)
    env: process.env,
    setupFiles: ["tests/setup.ts"],
  },
});
