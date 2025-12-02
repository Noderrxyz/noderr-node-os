# Noderr Node OS - VALIDATOR Tier Dockerfile
# Execution-focused node with order routing and MEV protection

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

# Copy VALIDATOR-specific packages
COPY packages/types ./packages/types
COPY packages/utils ./packages/utils
COPY packages/telemetry ./packages/telemetry
COPY packages/market-data ./packages/market-data
COPY packages/exchanges ./packages/exchanges
COPY packages/data-connectors ./packages/data-connectors
COPY packages/execution ./packages/execution
COPY packages/autonomous-execution ./packages/autonomous-execution
COPY packages/floor-engine ./packages/floor-engine
COPY packages/integration-layer ./packages/integration-layer
COPY packages/system-orchestrator ./packages/system-orchestrator
COPY packages/on-chain-service ./packages/on-chain-service
COPY packages/compliance ./packages/compliance
COPY packages/testing ./packages/testing

# Install dependencies for all packages
RUN pnpm install --frozen-lockfile \
    --filter "@noderr/types" \
    --filter "@noderr/utils" \
    --filter "@noderr/telemetry" \
    --filter "@noderr/market-data" \
    --filter "@noderr/exchanges" \
    --filter "@noderr/data-connectors" \
    --filter "@noderr/execution" \
    --filter "@noderr/autonomous-execution" \
    --filter "@noderr/floor-engine" \
    --filter "@noderr/integration-layer" \
    --filter "@noderr/system-orchestrator" \
    --filter "@noderr/on-chain-service" \
    --filter "@noderr/compliance" \
    --filter "@noderr/testing"

# Build packages in dependency order
RUN pnpm --filter "@noderr/types" build && \
    pnpm --filter "@noderr/utils" build && \
    pnpm --filter "@noderr/telemetry" build && \
    pnpm --filter "@noderr/market-data" build && \
    pnpm --filter "@noderr/exchanges" build && \
    pnpm --filter "@noderr/data-connectors" build && \
    pnpm --filter "@noderr/execution" build && \
    pnpm --filter "@noderr/autonomous-execution" build && \
    pnpm --filter "@noderr/floor-engine" build && \
    pnpm --filter "@noderr/integration-layer" build && \
    pnpm --filter "@noderr/system-orchestrator" build && \
    pnpm --filter "@noderr/on-chain-service" build && \
    pnpm --filter "@noderr/compliance" build && \
    pnpm --filter "@noderr/testing" build

# Remove dev dependencies
RUN pnpm install --frozen-lockfile --prod \
    --filter "@noderr/types" \
    --filter "@noderr/utils" \
    --filter "@noderr/telemetry" \
    --filter "@noderr/market-data" \
    --filter "@noderr/exchanges" \
    --filter "@noderr/data-connectors" \
    --filter "@noderr/execution" \
    --filter "@noderr/autonomous-execution" \
    --filter "@noderr/floor-engine" \
    --filter "@noderr/integration-layer" \
    --filter "@noderr/system-orchestrator" \
    --filter "@noderr/on-chain-service" \
    --filter "@noderr/compliance" \
    --filter "@noderr/testing"

# ============================================================================
# Production Stage
# ============================================================================
FROM node:20-alpine

# Install runtime dependencies
RUN apk add --no-cache \
    tini \
    ca-certificates \
    && rm -rf /var/cache/apk/*

# Create non-root user
RUN addgroup -g 1001 noderr && \
    adduser -D -u 1001 -G noderr noderr

WORKDIR /app

# Install pnpm and PM2 for process management
RUN npm install -g pnpm@8 pm2@5

# Copy workspace configuration
COPY --chown=noderr:noderr package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy built packages from builder
COPY --from=builder --chown=noderr:noderr /build/node_modules ./node_modules
COPY --from=builder --chown=noderr:noderr /build/packages/types ./packages/types
COPY --from=builder --chown=noderr:noderr /build/packages/utils ./packages/utils
COPY --from=builder --chown=noderr:noderr /build/packages/telemetry ./packages/telemetry
COPY --from=builder --chown=noderr:noderr /build/packages/market-data ./packages/market-data
COPY --from=builder --chown=noderr:noderr /build/packages/exchanges ./packages/exchanges
COPY --from=builder --chown=noderr:noderr /build/packages/data-connectors ./packages/data-connectors
COPY --from=builder --chown=noderr:noderr /build/packages/execution ./packages/execution
COPY --from=builder --chown=noderr:noderr /build/packages/autonomous-execution ./packages/autonomous-execution
COPY --from=builder --chown=noderr:noderr /build/packages/floor-engine ./packages/floor-engine
COPY --from=builder --chown=noderr:noderr /build/packages/integration-layer ./packages/integration-layer
COPY --from=builder --chown=noderr:noderr /build/packages/system-orchestrator ./packages/system-orchestrator
COPY --from=builder --chown=noderr:noderr /build/packages/on-chain-service ./packages/on-chain-service
COPY --from=builder --chown=noderr:noderr /build/packages/compliance ./packages/compliance
COPY --from=builder --chown=noderr:noderr /build/packages/testing ./packages/testing

# Copy PM2 ecosystem configuration
COPY --chown=noderr:noderr docker/validator/ecosystem.config.js /app/ecosystem.config.js

# Create startup script
COPY --chown=noderr:noderr docker/validator/start.sh /app/start.sh
RUN chmod +x /app/start.sh

# Create directories for logs and data
RUN mkdir -p /app/logs /app/data && chown -R noderr:noderr /app/logs /app/data

# Set environment variables
ENV NODE_ENV=production \
    NODE_TIER=VALIDATOR \
    NODE_OPTIONS="--max-old-space-size=6144" \
    PNPM_HOME="/pnpm" \
    PATH="$PNPM_HOME:$PATH"

# Expose ports
EXPOSE 3000 9090

# Switch to non-root user
USER noderr

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD node -e "require('./packages/telemetry/dist/health-check.js')" || exit 1

# Use tini as init system
ENTRYPOINT ["/sbin/tini", "--"]

# Start the node
CMD ["/app/start.sh"]
