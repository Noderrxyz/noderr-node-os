# Noderr Node OS - ORACLE Tier Dockerfile
# Advanced node with ML capabilities and market intelligence

FROM node:22-alpine AS builder

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

# Install pnpm and tsc-alias (needed for build scripts)
RUN npm install -g pnpm@9 tsc-alias

# Copy ALL tier packages (ORACLE includes ALL)
COPY packages/types ./packages/types
COPY packages/utils ./packages/utils
COPY packages/core ./packages/core
COPY packages/telemetry ./packages/telemetry
COPY packages/market-data ./packages/market-data
COPY packages/exchanges ./packages/exchanges
COPY packages/data-connectors ./packages/data-connectors

# Copy ORACLE-specific packages
COPY packages/ml ./packages/ml
COPY packages/ml-client ./packages/ml-client
COPY packages/ml-deployment ./packages/ml-deployment
COPY packages/quant-research ./packages/quant-research
COPY packages/market-intel ./packages/market-intel
COPY packages/strategy ./packages/strategy
COPY packages/capital-ai ./packages/capital-ai
COPY packages/backtesting ./packages/backtesting
COPY packages/compliance ./packages/compliance
COPY packages/testing ./packages/testing

# Install dependencies for all packages
RUN pnpm install --frozen-lockfile \
    --filter "@noderr/types" \
    --filter "@noderr/utils" \
    --filter "@noderr/core" \
    --filter "@noderr/telemetry" \
    --filter "@noderr/market-data" \
    --filter "@noderr/exchanges" \
    --filter "@noderr/data-connectors" \
    --filter "@noderr/ml" \
    --filter "@noderr/ml-client" \
    --filter "@noderr/ml-deployment" \
    --filter "@noderr/quant-research" \
    --filter "@noderr/market-intel" \
    --filter "@noderr/strategy" \
    --filter "@noderr/capital-ai" \
    --filter "@noderr/backtesting" \
    --filter "@noderr/compliance" \
    --filter "@noderr/testing"

# Build packages in dependency order
RUN pnpm --filter "@noderr/types" build && \
    pnpm --filter "@noderr/utils" build && \
    pnpm --filter "@noderr/core" build && \
    pnpm --filter "@noderr/telemetry" build && \
    pnpm --filter "@noderr/market-data" build && \
    pnpm --filter "@noderr/exchanges" build && \
    pnpm --filter "@noderr/data-connectors" build && \
    pnpm --filter "@noderr/ml-client" build && \
    pnpm --filter "@noderr/ml-deployment" build && \
    pnpm --filter "@noderr/ml" build && \
    pnpm --filter "@noderr/market-intel" build && \
    pnpm --filter "@noderr/quant-research" build && \
    pnpm --filter "@noderr/strategy" build && \
    pnpm --filter "@noderr/capital-ai" build && \
    pnpm --filter "@noderr/backtesting" build && \
    pnpm --filter "@noderr/compliance" build && \
    pnpm --filter "@noderr/testing" build

# Remove dev dependencies
RUN pnpm install --frozen-lockfile --prod \
    --filter "@noderr/types" \
    --filter "@noderr/utils" \
    --filter "@noderr/core" \
    --filter "@noderr/telemetry" \
    --filter "@noderr/market-data" \
    --filter "@noderr/exchanges" \
    --filter "@noderr/data-connectors" \
    --filter "@noderr/ml" \
    --filter "@noderr/ml-client" \
    --filter "@noderr/ml-deployment" \
    --filter "@noderr/quant-research" \
    --filter "@noderr/market-intel" \
    --filter "@noderr/strategy" \
    --filter "@noderr/capital-ai" \
    --filter "@noderr/backtesting" \
    --filter "@noderr/compliance" \
    --filter "@noderr/testing"

# ============================================================================
# Production Stage
# ============================================================================
FROM node:22-alpine

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

# Install pnpm and PM2 for process management
RUN npm install -g pnpm@9 pm2@5

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
COPY --from=builder --chown=noderr:noderr /build/packages/ml ./packages/ml
COPY --from=builder --chown=noderr:noderr /build/packages/ml-client ./packages/ml-client
COPY --from=builder --chown=noderr:noderr /build/packages/ml-deployment ./packages/ml-deployment
COPY --from=builder --chown=noderr:noderr /build/packages/quant-research ./packages/quant-research
COPY --from=builder --chown=noderr:noderr /build/packages/market-intel ./packages/market-intel
COPY --from=builder --chown=noderr:noderr /build/packages/strategy ./packages/strategy
COPY --from=builder --chown=noderr:noderr /build/packages/capital-ai ./packages/capital-ai
COPY --from=builder --chown=noderr:noderr /build/packages/backtesting ./packages/backtesting
COPY --from=builder --chown=noderr:noderr /build/packages/compliance ./packages/compliance
COPY --from=builder --chown=noderr:noderr /build/packages/testing ./packages/testing

# Copy PM2 ecosystem configuration
COPY --chown=noderr:noderr docker/oracle/ecosystem.config.js /app/ecosystem.config.js

# Create startup script
COPY --chown=noderr:noderr docker/oracle/start.sh /app/start.sh
RUN chmod +x /app/start.sh

# Create directories for logs and data
RUN mkdir -p /app/logs /app/data && chown -R noderr:noderr /app/logs /app/data

# Set environment variables
ENV NODE_ENV=production \
    NODE_TIER=ORACLE \
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
