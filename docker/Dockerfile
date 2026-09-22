# ==========================================
# Steem Wallet - Production Dockerfile
# Multi-stage build for minimal image size
#
# CANONICAL build recipe. The root ./Dockerfile is a byte-identical copy
# kept for the external CodeBuild pipeline (orchestration repo runs
# `docker build .` from the repo root). tests/unit/infra-single-source.test.ts
# fails if the two drift apart — edit this file, then re-copy.
# ==========================================

FROM node:22-alpine AS builder

# Set working directory
WORKDIR /app

# Install dependencies for native modules (if needed)
RUN apk add --no-cache libc6-compat python3 make g++

# Enable pnpm. The version is pinned and MUST match the "packageManager"
# field in package.json (enforced by tests/unit/infra-single-source.test.ts).
# pnpm 10 reads lockfileVersion 9.0 and honors the `allowBuilds` /
# `minimumReleaseAgeExclude` fields in pnpm-workspace.yaml.
RUN corepack enable && corepack prepare pnpm@10.34.5 --activate

# Copy package files (pnpm-workspace.yaml carries the allowBuilds map that
# lets native dependencies run install scripts)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Install dependencies with frozen lockfile for reproducible builds
RUN pnpm install --frozen-lockfile --prod=false

# Copy source code
COPY . .

# Build arguments for environment-specific builds
ARG BUILD_DATE
ARG VCS_REF
ARG VERSION=0.1.0

# Add build metadata
LABEL org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.version="${VERSION}"

# Build the application
RUN pnpm run build

# ==========================================
# Production Runtime Stage
# ==========================================
FROM node:22-alpine AS runner

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init wget

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

# Set working directory
WORKDIR /app

# Set to production
ENV NODE_ENV=production \
    PORT=8080 \
    HOSTNAME="0.0.0.0"

# Copy built files from builder
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Change ownership to non-root user
RUN chown -R nextjs:nodejs /app

# Switch to non-root user
USER nextjs

# Expose port
EXPOSE 8080

# Health check — LIVENESS only.
# /.well-known/healthcheck.json is short-circuited in src/proxy.ts and never
# touches an upstream, so an api.steemit.com outage cannot mark healthy
# containers unhealthy. /api/health is a READINESS probe (live Steem RPC
# probe, 503 when degraded) and stays available for humans/monitoring, but
# must not gate container liveness. The ELB already targets the same
# well-known path (see orchestration repo .ebextensions).
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget -q --spider http://localhost:8080/.well-known/healthcheck.json || exit 1

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the server
CMD ["node", "server.js"]
