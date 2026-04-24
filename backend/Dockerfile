# =============================================================================
# WORKFORCE0 BACKEND - Multi-stage Dockerfile
# =============================================================================

# ---------------------------------------------------------------------------
# Stage 1: Builder
# ---------------------------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files for dependency installation
COPY package.json package-lock.json* ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy prisma schema and generate client
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts
RUN npx prisma generate --schema prisma/schema.prisma

# Copy source code
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2: Production runtime
# ---------------------------------------------------------------------------
FROM node:20-alpine AS runtime

WORKDIR /app

# Install dumb-init for proper signal handling in containers
RUN apk add --no-cache dumb-init

# Create non-root user
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup

# Copy package files and install production dependencies only
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy prisma schema and generated client from builder.
# Prisma 7 emits the client to prisma/generated/ (see prisma.config.ts);
# we don't need node_modules/.prisma anymore.
COPY prisma ./prisma
COPY --from=builder /app/prisma/generated ./prisma/generated
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts

# Copy compiled application from builder
COPY --from=builder /app/dist ./dist

# Copy the entrypoint script that runs `prisma migrate deploy` before
# starting the app. Marked executable at build time so we don't depend
# on host file permissions.
COPY scripts/docker-entrypoint.sh ./scripts/docker-entrypoint.sh
RUN chmod +x ./scripts/docker-entrypoint.sh

# Create the local-storage upload dir with the right owner so the local
# storage driver can write to it without a chown on first boot. The
# docker-compose volume mounts on top of this path in production.
RUN mkdir -p /app/data/uploads && chown -R appuser:appgroup /app/data

# Switch to non-root user
USER appuser

EXPOSE 3000

# dumb-init handles PID 1 + signal forwarding; the entrypoint script
# runs pending Prisma migrations before starting the server.
ENTRYPOINT ["dumb-init", "--"]
CMD ["./scripts/docker-entrypoint.sh"]
