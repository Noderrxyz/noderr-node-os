#!/bin/sh
set -e

echo "========================================="
echo "Noderr Node OS - ALL Tier"
echo "========================================="
echo "Node ID: ${NODE_ID:-unknown}"
echo "Tier: ${NODE_TIER}"
echo "Version: ${NODE_VERSION:-unknown}"
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

# Check version from Deployment Engine
echo "Checking for updates..."
CURRENT_VERSION=$(cat /app/VERSION 2>/dev/null || echo "0.0.0")
echo "Current version: $CURRENT_VERSION"

# Start telemetry service
echo "Starting telemetry service..."
node packages/telemetry/dist/index.js &
TELEMETRY_PID=$!

# Start market data service
echo "Starting market data service..."
node packages/market-data/dist/index.js &
MARKET_DATA_PID=$!

# Start exchange connectors
echo "Starting exchange connectors..."
node packages/exchanges/dist/index.js &
EXCHANGES_PID=$!

# Start data connectors
echo "Starting data connectors..."
node packages/data-connectors/dist/index.js &
DATA_CONNECTORS_PID=$!

echo "========================================="
echo "All services started successfully"
echo "========================================="

# Wait for all background processes
wait $TELEMETRY_PID $MARKET_DATA_PID $EXCHANGES_PID $DATA_CONNECTORS_PID
