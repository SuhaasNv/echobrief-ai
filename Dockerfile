# Single-stage build for the API + worker (Node.js + tsx).
# The frontend SSR is a separate deployment (Cloudflare Worker via wrangler).
#
# tsx (the runtime) handles TypeScript + ESM resolution at startup — fast enough
# for a long-lived API, and avoids the .js-extension dance that ts-tsc-emit-to-Node
# would require.

FROM node:20-slim

WORKDIR /app
ENV NODE_ENV=production
ENV NPM_CONFIG_LOGLEVEL=warn

# Install all deps (incl. tsx, which is a runtime dep for prod here).
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

# Source
COPY tsconfig.json tsconfig.api.json ./
COPY src ./src
COPY migrations ./migrations
COPY scripts ./scripts

# Type-check at build time so a broken commit doesn't ship.
RUN npx tsc -p tsconfig.api.json --noEmit

EXPOSE 3000

# Default to the API. The worker service overrides this:
#   start command: npx tsx src/server/workers/main.ts
CMD ["npx", "tsx", "src/api.ts"]
