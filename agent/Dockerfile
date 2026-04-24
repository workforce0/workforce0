# workforce0-agent Docker image
# Usage:
#   docker run -d --name workforce0-agent \
#     -e WF0_TOKEN=wf0_xxx \
#     -e WF0_SERVER=wss://your-server/agent/ws \
#     -v ~/.claude:/home/agent/.claude \
#     -v ~/code/myapp:/workspace/myapp \
#     workforce0/agent --repos acme/app:/workspace/myapp

# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM node:20-alpine

# Install git and common tools
RUN apk add --no-cache git openssh-client curl

# Install GitHub CLI (for PR creation) — non-critical
RUN apk add --no-cache github-cli 2>/dev/null || true

# Install Claude CLI globally
RUN npm install -g @anthropic-ai/claude-code

# Create non-root user
RUN addgroup -g 1001 -S agent && \
    adduser -S agent -u 1001 -G agent

WORKDIR /app

# Install production dependencies
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# Switch to non-root user
USER agent

ENTRYPOINT ["node", "dist/index.js"]
