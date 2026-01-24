# Noderr Node OS - GUARDIAN Tier Dockerfile
# RESTRUCTURED: Medium tier (Tier 3) - Risk, Compliance & Trade Execution
#
# Services:
# - risk-engine: Risk analysis & monitoring
# - compliance: Compliance checking
# - guardian-consensus: Guardian consensus participation
# - execution: Trade execution (MIGRATED FROM VALIDATOR)
# - autonomous-execution: Autonomous trading (MIGRATED FROM VALIDATOR)
# - floor-engine: Floor engine operations (MIGRATED FROM VALIDATOR)
# - integration-layer: System integration (MIGRATED FROM VALIDATOR)
# - system-orchestrator: System orchestration (MIGRATED FROM VALIDATOR)
# - market-data: Market data feeds
# - exchanges: Exchange connectivity (MIGRATED FROM VALIDATOR)
# - data-connectors: Data source connectors
# - telemetry: Performance monitoring
# - heartbeat-client: Network heartbeat
#
# Total Memory: ~22.8 GB
# Total CPU: ~16 cores
# NO GPU REQUIRED

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
RUN npm install -g pnpm@9

# Copy GUARDIAN-specific packages (EXPANDED SET with execution services)
COPY packages/types ./packages/types
COPY packages/utils ./packages/utils
COPY packages/core ./packages/core
COPY packages/telemetry ./packages/telemetry
COPY packages/market-data ./packages/market-data
COPY packages/exchanges ./packages/exchanges
COPY packages/data-connectors ./packages/data-connectors
COPY packages/risk-engine ./packages/risk-engine
COPY packages/compliance ./packages/compliance
COPY packages/decentralized-core ./packages/decentralized-core
COPY packages/guardian-consensus ./packages/guardian-consensus
COPY packages/oracle-consensus ./packages/oracle-consensus
COPY packages/execution ./packages/execution
COPY packages/autonomous-execution ./packages/autonomous-execution
COPY packages/capital-ai ./packages/capital-ai
COPY packages/floor-engine ./packages/floor-engine
COPY packages/integration-layer ./packages/integration-layer
COPY packages/system-orchestrator ./packages/system-orchestrator
COPY packages/heartbeat-client ./packages/heartbeat-client

# Install dependencies for GUARDIAN packages
RUN pnpm install --frozen-lockfile \
    --filter "@noderr/types" \
    --filter "@noderr/utils" \
    --filter "@noderr/core" \
    --filter "@noderr/telemetry" \
    --filter "@noderr/market-data" \
    --filter "@noderr/exchanges" \
    --filter "@noderr/data-connectors" \
    --filter "@noderr/risk-engine" \
    --filter "@noderr/compliance" \
    --filter "@noderr/decentralized-core" \
    --filter "@noderr/guardian-consensus" \
    --filter "@noderr/oracle-consensus" \
    --filter "@noderr/execution" \
    --filter "@noderr/autonomous-execution" \
    --filter "@noderr/capital-ai" \
    --filter "@noderr/floor-engine" \
    --filter "@noderr/integration-layer" \
    --filter "@noderr/system-orchestrator" \
    --filter "@noderr/heartbeat-client"

# Build packages in dependency order
RUN pnpm --filter "@noderr/types" build && \
    pnpm --filter "@noderr/utils" build && \
    pnpm --filter "@noderr/core" build && \
    pnpm --filter "@noderr/telemetry" build && \
    pnpm --filter "@noderr/market-data" build && \
    pnpm --filter "@noderr/exchanges" build && \
    pnpm --filter "@noderr/data-connectors" build && \
    pnpm --filter "@noderr/risk-engine" build && \
    pnpm --filter "@noderr/compliance" build && \
    pnpm --filter "@noderr/decentralized-core" build && \
    pnpm --filter "@noderr/backtesting" build && \
    pnpm --filter "@noderr/guardian-consensus" build && \
    pnpm --filter "@noderr/oracle-consensus" build && \
    pnpm --filter "@noderr/execution" build && \
    pnpm --filter "@noderr/autonomous-execution" build && \
    pnpm --filter "@noderr/capital-ai" build && \
    pnpm --filter "@noderr/floor-engine" build && \
    pnpm --filter "@noderr/integration-layer" build && \
    pnpm --filter "@noderr/system-orchestrator" build && \
    pnpm --filter "@noderr/heartbeat-client" build

# Remove dev dependencies
RUN pnpm install --frozen-lockfile --prod \
    --filter "@noderr/types" \
    --filter "@noderr/utils" \
    --filter "@noderr/core" \
    --filter "@noderr/telemetry" \
    --filter "@noderr/market-data" \
    --filter "@noderr/exchanges" \
    --filter "@noderr/data-connectors" \
    --filter "@noderr/risk-engine" \
    --filter "@noderr/compliance" \
    --filter "@noderr/decentralized-core" \
    --filter "@noderr/guardian-consensus" \
    --filter "@noderr/oracle-consensus" \
    --filter "@noderr/execution" \
    --filter "@noderr/autonomous-execution" \
    --filter "@noderr/capital-ai" \
    --filter "@noderr/floor-engine" \
    --filter "@noderr/integration-layer" \
    --filter "@noderr/system-orchestrator" \
    --filter "@noderr/heartbeat-client"

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
RUN npm install -g pnpm@9 pm2@5

# Copy workspace configuration
COPY --chown=noderr:noderr package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy built packages from builder (EXPANDED SET)
COPY --from=builder --chown=noderr:noderr /build/node_modules ./node_modules
COPY --from=builder --chown=noderr:noderr /build/packages/types ./packages/types
COPY --from=builder --chown=noderr:noderr /build/packages/utils ./packages/utils
COPY --from=builder --chown=noderr:noderr /build/packages/core ./packages/core
COPY --from=builder --chown=noderr:noderr /build/packages/decentralized-core ./packages/decentralized-core
COPY --from=builder --chown=noderr:noderr /build/packages/telemetry ./packages/telemetry
COPY --from=builder --chown=noderr:noderr /build/packages/market-data ./packages/market-data
COPY --from=builder --chown=noderr:noderr /build/packages/exchanges ./packages/exchanges
COPY --from=builder --chown=noderr:noderr /build/packages/data-connectors ./packages/data-connectors
COPY --from=builder --chown=noderr:noderr /build/packages/risk-engine ./packages/risk-engine
COPY --from=builder --chown=noderr:noderr /build/packages/compliance ./packages/compliance
COPY --from=builder --chown=noderr:noderr /build/packages/guardian-consensus ./packages/guardian-consensus
COPY --from=builder --chown=noderr:noderr /build/packages/oracle-consensus ./packages/oracle-consensus
COPY --from=builder --chown=noderr:noderr /build/packages/execution ./packages/execution
COPY --from=builder --chown=noderr:noderr /build/packages/autonomous-execution ./packages/autonomous-execution
COPY --from=builder --chown=noderr:noderr /build/packages/capital-ai ./packages/capital-ai
COPY --from=builder --chown=noderr:noderr /build/packages/floor-engine ./packages/floor-engine
COPY --from=builder --chown=noderr:noderr /build/packages/integration-layer ./packages/integration-layer
COPY --from=builder --chown=noderr:noderr /build/packages/system-orchestrator ./packages/system-orchestrator
COPY --from=builder --chown=noderr:noderr /build/packages/heartbeat-client ./packages/heartbeat-client

# Copy PM2 ecosystem configuration
COPY --chown=noderr:noderr docker/guardian/ecosystem.config.js /app/ecosystem.config.js

# Copy startup script
COPY --chown=noderr:noderr docker/guardian/start.sh /app/start.sh
RUN chmod +x /app/start.sh

# Create directories for logs and data
RUN mkdir -p /app/logs /app/data && chown -R noderr:noderr /app/logs /app/data

# Set environment variables (INCREASED MEMORY for execution services)
ENV NODE_ENV=production \
    NODE_TIER=GUARDIAN \
    NODE_OPTIONS="--max-old-space-size=16384" \
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
