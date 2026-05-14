# Multi-stage build for the API + worker (Node).
# The frontend SSR is a separate deployment (Cloudflare Worker via wrangler).

FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.api.json ./
COPY src ./src
RUN npx tsc -p tsconfig.api.json

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist-api ./dist-api
COPY package.json ./
COPY migrations ./migrations
COPY scripts ./scripts

# Default to the API. The worker service overrides this with start:worker.
CMD ["node", "dist-api/api.js"]
