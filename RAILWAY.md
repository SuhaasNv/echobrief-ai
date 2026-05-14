# Deploying to Railway

EchoBrief deploys as **three Railway services** in one project:

| Service | What it runs | Start command |
|---------|-------------|---------------|
| `api` | Hono REST API | `npx tsx src/api.ts` |
| `worker` | BullMQ processing pipeline | `npx tsx src/server/workers/main.ts` |
| `postgres` | Railway Postgres (managed) | — |
| `redis` | Railway Redis (managed) | — |

The frontend (TanStack Start SSR) is a separate deployment — currently a Cloudflare Worker (`wrangler deploy`).

---

## Initial setup

1. **Create a Railway project**, add Postgres + Redis from the catalog.
2. **Run migrations** locally against the proxy URL:
   ```bash
   DATABASE_URL='postgresql://...@yamanote.proxy.rlwy.net:.../railway' npm run migrate
   ```
3. **Create two services** from this repo (point both at the same Dockerfile):
   - **api** — leave `startCommand` as default (`npx tsx src/api.ts`)
   - **worker** — override `startCommand` to `npx tsx src/server/workers/main.ts`
4. **Reference variables** in both services (use Railway's reference syntax):
   ```
   DATABASE_URL=${{ Postgres.DATABASE_URL }}
   REDIS_URL=${{ Redis.REDIS_URL }}
   ```
5. **Set secrets** in both services (each service gets its own copy — Railway doesn't share across services automatically):
   - `BETTER_AUTH_SECRET` — `openssl rand -base64 32`
   - `OPENAI_API_KEY`
   - `ASSEMBLYAI_API_KEY`
   - `RESEND_API_KEY`
   - `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`
   - `INTEGRATION_TOKEN_ENCRYPTION_KEY` — `openssl rand -base64 32`
6. **Generate domains** for the `api` service (`api.echobrief.app` or similar). The worker has no public domain.
7. **Set `APP_URL`** in both services to the frontend URL (`https://echobrief.app`).

---

## Internal vs proxy URLs

Railway exposes two URLs per service:

- `*.railway.internal` — only reachable from inside Railway. Use for service-to-service traffic.
- `*.proxy.rlwy.net` — public, slower. Use only for local dev or external access.

In production, both `api` and `worker` should use the **internal** Postgres and Redis URLs. Railway's reference variables (`${{ Postgres.DATABASE_URL }}`) automatically resolve to the internal URL when services share a project.

---

## Local development

```bash
# 1. Copy env
cp .dev.vars.example .env
# Fill in DATABASE_URL + REDIS_URL with the *.proxy.rlwy.net URLs

# 2. Run migrations
npm run migrate

# 3. Start the API + worker in separate terminals
npm run dev:api
npm run dev:worker

# 4. Start the frontend (separate terminal, separate port)
npm run dev
```

---

## Operations

- **Logs**: `railway logs --service api` (or `--service worker`)
- **DB shell**: `railway connect Postgres`
- **Re-run migrations** after schema changes:
  ```bash
  railway run npm run migrate
  ```
- **Worker scaling**: bump `concurrency` in `src/server/workers/main.ts` (default 1).
  Each concurrent job holds Postgres + Redis connections, so size accordingly.
