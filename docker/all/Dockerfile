# Noderr Node OS - ALL Tier Dockerfile
# Lightweight node for basic network participation

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
COPY tsconfig.json ./

# Install pnpm
RUN npm install -g pnpm@8

# Copy ALL tier packages
COPY packages/types ./packages/types
COPY packages/utils ./packages/utils
COPY packages/telemetry ./packages/telemetry
COPY packages/market-data ./packages/market-data
COPY packages/exchanges ./packages/exchanges
COPY packages/data-connectors ./packages/data-connectors

# Install dependencies
RUN pnpm install --frozen-lockfile --filter "@noderr/types" \
    --filter "@noderr/utils" \
    --filter "@noderr/telemetry" \
    --filter "@noderr/market-data" \
    --filter "@noderr/exchanges" \
    --filter "@noderr/data-connectors"

# Build packages
RUN pnpm --filter "@noderr/types" build && \
    pnpm --filter "@noderr/utils" build && \
    pnpm --filter "@noderr/telemetry" build && \
    pnpm --filter "@noderr/market-data" build && \
    pnpm --filter "@noderr/exchanges" build && \
    pnpm --filter "@noderr/data-connectors" build

# Remove dev dependencies
RUN pnpm install --frozen-lockfile --prod \
    --filter "@noderr/types" \
    --filter "@noderr/utils" \
    --filter "@noderr/telemetry" \
    --filter "@noderr/market-data" \
    --filter "@noderr/exchanges" \
    --filter "@noderr/data-connectors"

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

# Install pnpm
RUN npm install -g pnpm@8

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

# Create startup script
COPY --chown=noderr:noderr docker/all/start.sh /app/start.sh
RUN chmod +x /app/start.sh

# Set environment variables
ENV NODE_ENV=production \
    NODE_TIER=ALL \
    NODE_OPTIONS="--max-old-space-size=2048" \
    PNPM_HOME="/pnpm" \
    PATH="$PNPM_HOME:$PATH"

# Expose ports
EXPOSE 3000 9090

# Switch to non-root user
USER noderr

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('./packages/telemetry/dist/health-check.js')" || exit 1

# Use tini as init system
ENTRYPOINT ["/sbin/tini", "--"]

# Start the node
CMD ["/app/start.sh"]
