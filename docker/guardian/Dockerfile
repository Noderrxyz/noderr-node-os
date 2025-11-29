# Noderr Node OS - GUARDIAN Tier Dockerfile
# Full-featured node with risk management and execution capabilities

FROM node:20-alpine AS builder

# Install build dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    git

WORKDIR /build

# Copy workspace configuration
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY .npmrc* ./
COPY tsconfig.base.json ./

# Install pnpm
RUN npm install -g pnpm@8

# Copy ALL packages (GUARDIAN includes everything)
COPY packages ./packages

# Install all dependencies
RUN pnpm install --frozen-lockfile

# Build all packages in dependency order
RUN pnpm --filter "@noderr/types" build && \
    pnpm --filter "@noderr/utils" build && \
    pnpm --filter "@noderr/telemetry" build && \
    pnpm --filter "@noderr/market-data" build && \
    pnpm --filter "@noderr/exchanges" build && \
    pnpm --filter "@noderr/data-connectors" build && \
    pnpm --filter "@noderr/ml" build && \
    pnpm --filter "@noderr/quant-research" build && \
    pnpm --filter "@noderr/market-intel" build && \
    pnpm --filter "@noderr/strategy" build && \
    pnpm --filter "@noderr/capital-ai" build && \
    pnpm --filter "@noderr/backtesting" build && \
    pnpm --filter "@noderr/compliance" build && \
    pnpm --filter "@noderr/testing" build && \
    pnpm --filter "@noderr/risk-engine" build && \
    pnpm --filter "@noderr/floor-engine" build && \
    pnpm --filter "@noderr/execution" build && \
    pnpm --filter "@noderr/integration-layer" build && \
    pnpm --filter "@noderr/system-orchestrator" build || true

# Remove dev dependencies
RUN pnpm install --frozen-lockfile --prod

# ============================================================================
# Production Stage
# ============================================================================
FROM node:20-alpine

# Install runtime dependencies
RUN apk add --no-cache \
    tini \
    ca-certificates \
    python3 \
    && rm -rf /var/cache/apk/*

# Create non-root user
RUN addgroup -g 1001 noderr && \
    adduser -D -u 1001 -G noderr noderr

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm@8

# Copy workspace configuration
COPY --chown=noderr:noderr package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy built packages from builder
COPY --from=builder --chown=noderr:noderr /build/node_modules ./node_modules
COPY --from=builder --chown=noderr:noderr /build/packages ./packages

# Create startup script
COPY --chown=noderr:noderr docker/guardian/start.sh /app/start.sh
RUN chmod +x /app/start.sh

# Set environment variables
ENV NODE_ENV=production \
    NODE_TIER=GUARDIAN \
    NODE_OPTIONS="--max-old-space-size=8192" \
    PNPM_HOME="/pnpm" \
    PATH="$PNPM_HOME:$PATH"

# Expose ports
EXPOSE 3000 9090

# Switch to non-root user
USER noderr

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
    CMD node -e "require('./packages/telemetry/dist/health-check.js')" || exit 1

# Use tini as init system
ENTRYPOINT ["/sbin/tini", "--"]

# Start the node
CMD ["/app/start.sh"]
