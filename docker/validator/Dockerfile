# Noderr Node OS - VALIDATOR Tier Dockerfile
# RESTRUCTURED: Lightest tier (Tier 2) - On-chain validation and network participation
#
# Services:
# - on-chain-service: On-chain validation and transaction submission
# - validator-consensus: Validator consensus participation
# - market-data: Market data relay (reduced scope)
# - data-connectors: Basic data connectors (reduced scope)
# - telemetry: Performance monitoring
# - heartbeat-client: Network heartbeat
#
# Total Memory: ~5.3 GB
# Total CPU: ~4 cores

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

# Copy VALIDATOR-specific packages (REDUCED SET)
COPY packages/types ./packages/types
COPY packages/utils ./packages/utils
COPY packages/telemetry ./packages/telemetry
COPY packages/market-data ./packages/market-data
COPY packages/data-connectors ./packages/data-connectors
COPY packages/on-chain-service ./packages/on-chain-service
COPY packages/validator-consensus ./packages/validator-consensus
COPY packages/heartbeat-client ./packages/heartbeat-client

# Install dependencies for VALIDATOR packages only
RUN pnpm install --frozen-lockfile \
    --filter "@noderr/types" \
    --filter "@noderr/utils" \
    --filter "@noderr/telemetry" \
    --filter "@noderr/market-data" \
    --filter "@noderr/data-connectors" \
    --filter "@noderr/on-chain-service" \
    --filter "@noderr/validator-consensus" \
    --filter "@noderr/heartbeat-client"

# Build packages in dependency order
RUN pnpm --filter "@noderr/types" build && \
    pnpm --filter "@noderr/utils" build && \
    pnpm --filter "@noderr/telemetry" build && \
    pnpm --filter "@noderr/market-data" build && \
    pnpm --filter "@noderr/data-connectors" build && \
    pnpm --filter "@noderr/on-chain-service" build && \
    pnpm --filter "@noderr/validator-consensus" build && \
    pnpm --filter "@noderr/heartbeat-client" build

# Remove dev dependencies
RUN pnpm install --frozen-lockfile --prod \
    --filter "@noderr/types" \
    --filter "@noderr/utils" \
    --filter "@noderr/telemetry" \
    --filter "@noderr/market-data" \
    --filter "@noderr/data-connectors" \
    --filter "@noderr/on-chain-service" \
    --filter "@noderr/validator-consensus" \
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

# Copy built packages from builder (REDUCED SET)
COPY --from=builder --chown=noderr:noderr /build/node_modules ./node_modules
COPY --from=builder --chown=noderr:noderr /build/packages/types ./packages/types
COPY --from=builder --chown=noderr:noderr /build/packages/utils ./packages/utils
COPY --from=builder --chown=noderr:noderr /build/packages/telemetry ./packages/telemetry
COPY --from=builder --chown=noderr:noderr /build/packages/market-data ./packages/market-data
COPY --from=builder --chown=noderr:noderr /build/packages/data-connectors ./packages/data-connectors
COPY --from=builder --chown=noderr:noderr /build/packages/on-chain-service ./packages/on-chain-service
COPY --from=builder --chown=noderr:noderr /build/packages/validator-consensus ./packages/validator-consensus
COPY --from=builder --chown=noderr:noderr /build/packages/heartbeat-client ./packages/heartbeat-client

# Copy PM2 ecosystem configuration
COPY --chown=noderr:noderr ecosystem.config.js /app/ecosystem.config.js

# Copy startup script
COPY --chown=noderr:noderr start.sh /app/start.sh
RUN chmod +x /app/start.sh

# Create directories for logs and data
RUN mkdir -p /app/logs /app/data && chown -R noderr:noderr /app/logs /app/data

# Set environment variables (REDUCED MEMORY for lightweight tier)
ENV NODE_ENV=production \
    NODE_TIER=VALIDATOR \
    NODE_OPTIONS="--max-old-space-size=4096" \
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
