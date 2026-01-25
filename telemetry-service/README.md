# Noderr Telemetry Service

Lightweight query layer for node metrics and network statistics.

## Overview

This service provides a read-only API for querying node telemetry data stored in Supabase. It serves the frontend dashboard with real-time metrics and network statistics.

## Architecture

- **FastAPI** - Modern Python web framework
- **Supabase** - Database (read-only queries)
- **Port 8080** - Default service port

## Endpoints

### `GET /health`
Health check endpoint

### `GET /api/telemetry/my-node?wallet={address}`
Get node status for a specific wallet address

**Response:**
```json
{
  "nodeId": "node_abc123",
  "tier": "GUARDIAN",
  "status": "online",
  "uptime": 86400,
  "lastSeen": "2024-01-24T12:00:00Z",
  "metrics": {
    "cpu": 45.2,
    "memory": 62.8,
    "disk": 35.1,
    "network": {
      "rx": 1024000,
      "tx": 512000
    }
  },
  "version": "1.0.0"
}
```

### `GET /api/telemetry/network/summary`
Get network-wide statistics

**Response:**
```json
{
  "totalNodes": 150,
  "onlineNodes": 142,
  "offlineNodes": 8,
  "tierDistribution": {
    "MICRO": 50,
    "VALIDATOR": 40,
    "GUARDIAN": 35,
    "ORACLE": 25
  },
  "averageMetrics": {
    "cpu": 42.5,
    "memory": 58.3
  },
  "timestamp": "2024-01-24T12:00:00Z"
}
```

### `GET /api/telemetry/nodes?tier={tier}&status={status}`
Get list of all nodes with optional filters

**Query Parameters:**
- `tier` (optional): Filter by tier (MICRO, VALIDATOR, GUARDIAN, ORACLE)
- `status` (optional): Filter by status (online, offline)

**Response:**
```json
{
  "nodes": [
    {
      "nodeId": "node_abc123",
      "tier": "GUARDIAN",
      "status": "online",
      "lastSeen": "2024-01-24T12:00:00Z",
      "uptime": 86400,
      "cpu": 45.2,
      "memory": 62.8,
      "version": "1.0.0"
    }
  ],
  "total": 1,
  "timestamp": "2024-01-24T12:00:00Z"
}
```

### `GET /api/telemetry/alerts`
Get active alerts for nodes

**Response:**
```json
{
  "alerts": [
    {
      "nodeId": "node_xyz789",
      "tier": "ORACLE",
      "severity": "critical",
      "message": "Node offline for 65 minutes",
      "timestamp": "2024-01-24T12:00:00Z",
      "lastSeen": "2024-01-24T10:55:00Z"
    }
  ],
  "total": 1,
  "timestamp": "2024-01-24T12:00:00Z"
}
```

## Environment Variables

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-key
PORT=8080
```

## Local Development

```bash
# Install dependencies
pip install -r requirements.txt

# Set environment variables
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_SERVICE_KEY="your-service-key"

# Run the service
python src/main.py
```

## Docker Deployment

```bash
# Build image
docker build -t noderr-telemetry-service .

# Run container
docker run -p 8080:8080 \
  -e SUPABASE_URL="https://your-project.supabase.co" \
  -e SUPABASE_SERVICE_KEY="your-service-key" \
  noderr-telemetry-service
```

## Railway Deployment

1. Create new service in Railway
2. Connect to `Noderrxyz/noderr-node-os` repository
3. Set root directory to `telemetry-service`
4. Add environment variables:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_KEY`
   - `PORT` (optional, defaults to 8080)
5. Deploy

## Notes

- This service is **read-only** - it only queries data, never writes
- Node status is determined by `last_seen` timestamp (online if < 5 minutes ago)
- Alerts are generated for nodes offline > 10 minutes
- All timestamps are in UTC ISO 8601 format
- CORS is enabled for all origins (restrict in production)

## Future Enhancements

- WebSocket support for real-time updates
- Redis caching for performance
- Prometheus metrics export
- Rate limiting
- Authentication/authorization
