#!/bin/sh
set -e

echo "========================================="
echo "Noderr Node OS - ORACLE Tier"
echo "========================================="
echo "Node ID: ${NODE_ID:-unknown}"
echo "Tier: ${NODE_TIER}"
echo "Version: ${NODE_VERSION:-unknown}"
echo "Process Manager: PM2"
echo "========================================="

# Validate required environment variables
if [ -z "$NODE_ID" ]; then
    echo "ERROR: NODE_ID environment variable is required"
    exit 1
fi

if [ -z "$DEPLOYMENT_ENGINE_URL" ]; then
    echo "ERROR: DEPLOYMENT_ENGINE_URL environment variable is required"
    exit 1
fi

# Create necessary directories
mkdir -p /app/logs /app/data

# Set proper permissions (ignore errors if already correct)
chown -R noderr:noderr /app/logs /app/data 2>/dev/null || true

# Check version from Deployment Engine
echo "Checking for updates..."
CURRENT_VERSION=$(cat /app/VERSION 2>/dev/null || echo "0.0.0")
echo "Current version: $CURRENT_VERSION"

echo "========================================="
echo "Starting Oracle services with PM2..."
echo "========================================="

# Start all services using PM2
# --no-daemon keeps PM2 in foreground (required for Docker)
# Note: --update-env is not supported by pm2-runtime; env is read from ecosystem.config.js at start
pm2-runtime start /app/ecosystem.config.js \
    --no-daemon

# This line is never reached unless PM2 exits
echo "PM2 exited unexpectedly"
exit 1
