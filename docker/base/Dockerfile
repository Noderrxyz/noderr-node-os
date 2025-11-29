# Noderr Node OS - Base Dockerfile
# Multi-stage build for optimal image size and security

# ============================================================================
# Stage 1: Builder
# ============================================================================
FROM node:20-alpine AS builder

# Install build dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    git

# Set working directory
WORKDIR /build

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY .npmrc* ./

# Install pnpm
RUN npm install -g pnpm@8

# Copy all package.json files for workspace
COPY packages/*/package.json ./packages/

# Install dependencies
RUN pnpm install --frozen-lockfile --prod=false

# Copy source code
COPY packages ./packages
COPY tsconfig.base.json ./

# Build all packages
RUN pnpm build

# Remove dev dependencies
RUN pnpm install --frozen-lockfile --prod

# ============================================================================
# Stage 2: Production Base
# ============================================================================
FROM node:20-alpine AS production-base

# Install runtime dependencies
RUN apk add --no-cache \
    tini \
    ca-certificates \
    && rm -rf /var/cache/apk/*

# Create non-root user
RUN addgroup -g 1001 noderr && \
    adduser -D -u 1001 -G noderr noderr

# Set working directory
WORKDIR /app

# Install pnpm
RUN npm install -g pnpm@8

# Copy package files
COPY --chown=noderr:noderr package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=noderr:noderr .npmrc* ./

# Copy production dependencies from builder
COPY --from=builder --chown=noderr:noderr /build/node_modules ./node_modules

# Copy built packages from builder
COPY --from=builder --chown=noderr:noderr /build/packages ./packages

# Set environment variables
ENV NODE_ENV=production \
    NODE_OPTIONS="--max-old-space-size=2048" \
    PNPM_HOME="/pnpm" \
    PATH="$PNPM_HOME:$PATH"

# Switch to non-root user
USER noderr

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "console.log('healthy')" || exit 1

# Use tini as init system
ENTRYPOINT ["/sbin/tini", "--"]

# Default command (override in tier-specific images)
CMD ["node", "--version"]
