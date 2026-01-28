FROM node:20-slim

# Install pnpm
RUN npm install -g pnpm

# Set working directory
WORKDIR /app

# Copy root package files for pnpm workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy all packages (needed for workspace dependencies)
COPY packages/ ./packages/

# Cache buster - forces Docker to rebuild from here
ARG CACHEBUST=1
RUN echo "Cache bust: $CACHEBUST"

# Copy auth-api (will be fresh every time due to ARG above)
COPY auth-api/ ./auth-api/

# Install dependencies using pnpm
RUN pnpm install --frozen-lockfile || pnpm install

# Clean any stale build artifacts
RUN rm -rf auth-api/dist auth-api/tsconfig.tsbuildinfo

# Build all packages (ignore errors from optional packages)
RUN pnpm -r build || true

# Build auth-api specifically
WORKDIR /app/auth-api
RUN rm -rf dist tsconfig.tsbuildinfo && pnpm build

# Expose port
EXPOSE 3000

# Start the server
# Run as non-root user for security
USER node

CMD ["node", "dist/index.js"]
