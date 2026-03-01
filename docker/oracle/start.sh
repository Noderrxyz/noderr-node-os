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
    echo "WARNING: DEPLOYMENT_ENGINE_URL not set. Auto-updates will be disabled until deployment engine is configured."
    export DEPLOYMENT_ENGINE_URL="${AUTH_API_URL:-https://auth.noderr.xyz}"
fi

# Create necessary directories
mkdir -p /app/logs /app/data

# Set proper permissions (ignore errors if already correct)
chown -R noderr:noderr /app/logs /app/data 2>/dev/null || true

# Install pm2-logrotate for automatic log rotation (P1-1)
echo "Installing pm2-logrotate..."
pm2 install pm2-logrotate 2>/dev/null || true
pm2 set pm2-logrotate:max_size 50M 2>/dev/null || true
pm2 set pm2-logrotate:retain 5 2>/dev/null || true
pm2 set pm2-logrotate:compress true 2>/dev/null || true
pm2 set pm2-logrotate:dateFormat YYYY-MM-DD_HH-mm-ss 2>/dev/null || true
pm2 set pm2-logrotate:workerInterval 30 2>/dev/null || true
pm2 set pm2-logrotate:rotateInterval '0 0 * * *' 2>/dev/null || true

# Resolve current version: env-file (node.env) takes priority, then /app/VERSION, then fallback
if [ -z "$CURRENT_VERSION" ]; then
  CURRENT_VERSION=$(cat /app/VERSION 2>/dev/null || echo "1.0.0")
  export CURRENT_VERSION
fi
echo "Current version: $CURRENT_VERSION"

echo "========================================="
echo "Starting Oracle services with PM2..."
echo "========================================="

# Start all services using PM2
pm2-runtime start /app/ecosystem.config.js --env production

# This line is never reached unless PM2 exits
echo "PM2 exited unexpectedly"
exit 1
