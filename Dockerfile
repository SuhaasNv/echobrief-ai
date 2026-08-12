# Multi-stage optimized Dockerfile for API + Worker
# 
# Benefits:
# - Smaller production image (excludes dev dependencies)
# - Faster builds (cached layers)
# - Non-root user (security)
# - Health check (container orchestration)
# 
# Build: docker build -t echobrief-api .
# Run API: docker run -p 3000:3000 echobrief-api
# Run Worker: docker run echobrief-api npx tsx src/server/workers/main.ts

# ===== Stage 1: Builder =====
FROM node:20-slim AS builder

WORKDIR /app

# Copy package files
# packages/ must land before `npm ci` — the root package.json declares npm
# workspaces, and src/lib/schemas.ts re-exports @echobrief/shared, which 8
# server files import. The `apps/*` workspace glob matches nothing here; that
# is intentional, so the mobile app never enters the API image.
COPY package.json package-lock.json* ./
COPY packages ./packages

# Install ALL dependencies (including devDependencies for type checking)
RUN npm ci --no-audit --no-fund

# Copy source files
COPY tsconfig.json tsconfig.api.json ./
COPY src ./src
COPY migrations ./migrations
COPY scripts ./scripts

# Type-check at build time (fails build if TS errors)
RUN npx tsc -p tsconfig.api.json --noEmit

# ===== Stage 2: Production =====
FROM node:20-slim AS production

WORKDIR /app

# Create non-root user for security
RUN groupadd -r echobrief && useradd -r -g echobrief echobrief

# Copy package files (see builder stage for why packages/ is needed)
COPY package.json package-lock.json* ./
COPY packages ./packages

# Install ONLY production dependencies (no devDependencies)
# tsx is a production dependency in package.json
RUN npm ci --only=production --no-audit --no-fund

# Copy source files from builder
COPY --from=builder /app/src ./src
COPY --from=builder /app/migrations ./migrations
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/tsconfig.json ./
COPY --from=builder /app/tsconfig.api.json ./

# Change ownership to non-root user
RUN chown -R echobrief:echobrief /app

# Switch to non-root user
USER echobrief

# Environment
ENV NODE_ENV=production
ENV NPM_CONFIG_LOGLEVEL=warn

# Expose API port
EXPOSE 3000

# Health check (for container orchestration)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/v1/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1));"

# Default: Run API server
# Override for worker: docker run <image> npx tsx src/server/workers/main.ts
CMD ["npx", "tsx", "src/api.ts"]
