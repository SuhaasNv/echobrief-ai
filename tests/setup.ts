/**
 * Vitest setup — loads .env once before any test runs.
 * Integration tests need DATABASE_URL, AUTH_SECRET, etc. from .env.
 */
import "dotenv/config";
