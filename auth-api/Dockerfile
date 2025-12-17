FROM node:20-slim

# Install pnpm
RUN npm install -g pnpm

# Set working directory
WORKDIR /app

# Copy root package files for pnpm workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy all packages (needed for workspace dependencies)
COPY packages/ ./packages/

# Copy auth-api
COPY auth-api/ ./auth-api/

# Install dependencies using pnpm
RUN pnpm install --frozen-lockfile || pnpm install

# Build all packages
RUN pnpm -r build || true

# Build auth-api specifically
WORKDIR /app/auth-api
RUN pnpm build

# Expose port
EXPOSE 3000

# Start the server
CMD ["node", "dist/index.js"]
