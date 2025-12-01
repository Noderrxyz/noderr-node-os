# Multi-stage build for Noderr Node Runtime
FROM node:22-alpine as builder

# Install pnpm
RUN npm install -g pnpm@10.23.0

WORKDIR /build

# Copy package files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages ./packages

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build all packages
RUN pnpm -r build

# Production stage
FROM node:22-alpine

# Install pnpm
RUN npm install -g pnpm@10.23.0

# Create app user
RUN addgroup -g 1000 noderr && \
    adduser -D -u 1000 -G noderr noderr && \
    mkdir -p /app && \
    chown -R noderr:noderr /app

WORKDIR /app

# Copy built packages from builder
COPY --from=builder --chown=noderr:noderr /build/package.json ./
COPY --from=builder --chown=noderr:noderr /build/pnpm-workspace.yaml ./
COPY --from=builder --chown=noderr:noderr /build/pnpm-lock.yaml ./
COPY --from=builder --chown=noderr:noderr /build/packages ./packages

# Install production dependencies only
RUN pnpm install --prod --frozen-lockfile

# Switch to non-root user
USER noderr

# Expose ports
EXPOSE 8080 50052

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:8080/health', (r) => r.statusCode === 200 ? process.exit(0) : process.exit(1))"

# Run the node runtime
CMD ["node", "packages/node-runtime/dist/index.js"]
