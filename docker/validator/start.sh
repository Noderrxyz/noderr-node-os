#!/bin/sh
#
# Noderr Validator Node - Startup Script
# 
# This script starts all Validator node services using PM2 for process supervision.
# 
# Features:
# - Validates environment configuration
# - Starts all services in correct order
# - Automatic log rotation via pm2-logrotate
# - Graceful shutdown handling
#

set -e

echo "========================================="
echo "Noderr Validator Node"
echo "========================================="
echo "Starting at: $(date)"
echo "Node Tier: VALIDATOR"
echo "Node ID: ${NODE_ID:-unknown}"
echo "========================================="

# Validate required environment variables
if [ -z "$NODE_ID" ]; then
  echo "WARNING: NODE_ID not set. Using default."
  export NODE_ID="validator-$(hostname)"
fi

if [ -z "$NETWORK_ID" ]; then
  echo "WARNING: NETWORK_ID not set. Using default."
  export NETWORK_ID="testnet"
fi

if [ -z "$DEPLOYMENT_ENGINE_URL" ]; then
    echo "WARNING: DEPLOYMENT_ENGINE_URL not set."
    export DEPLOYMENT_ENGINE_URL="${AUTH_API_URL:-https://auth.noderr.xyz}"
fi

# Create necessary directories
mkdir -p /app/logs
mkdir -p /app/data/state
mkdir -p /app/data/cache

# Install pm2-logrotate for automatic log rotation (P1-1)
echo "Installing pm2-logrotate..."
pm2 install pm2-logrotate 2>/dev/null || true
pm2 set pm2-logrotate:max_size 50M 2>/dev/null || true
pm2 set pm2-logrotate:retain 5 2>/dev/null || true
pm2 set pm2-logrotate:compress true 2>/dev/null || true
pm2 set pm2-logrotate:dateFormat YYYY-MM-DD_HH-mm-ss 2>/dev/null || true
pm2 set pm2-logrotate:workerInterval 30 2>/dev/null || true
pm2 set pm2-logrotate:rotateInterval '0 0 * * *' 2>/dev/null || true

echo ""
echo "Environment Configuration:"
echo "- NODE_ENV: ${NODE_ENV:-production}"
echo "- NODE_TIER: ${NODE_TIER:-VALIDATOR}"
echo "- NODE_ID: ${NODE_ID}"
echo "- NETWORK_ID: ${NETWORK_ID}"
echo "- STATE_DIR: ${STATE_DIR:-/app/data/state}"
echo ""

# Start PM2 with ecosystem configuration
echo "Starting Validator services with PM2..."
pm2-runtime start /app/ecosystem.config.js --env production

# This line should never be reached (pm2-runtime blocks)
echo "ERROR: PM2 exited unexpectedly"
exit 1
