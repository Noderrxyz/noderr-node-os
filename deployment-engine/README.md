# Deployment Engine

Microservice for managing Noderr Node OS staged rollouts with intelligent cohort selection and automatic rollback capabilities.

## Features

- **Deterministic Cohort Assignment** - Nodes are assigned to cohorts based on keccak256 hash of node ID
- **Staged Rollouts** - Canary → Cohort 1 → Cohort 2 → Cohort 3 → Cohort 4
- **VersionBeacon Integration** - Queries on-chain contract for version information
- **Automatic Rollback** - Monitors health metrics and triggers rollback on failures
- **Health Monitoring** - Tracks node health and deployment success rates
- **RESTful API** - Simple HTTP API for node version queries and health reporting

## Architecture

```
┌─────────────────┐
│  Node Requests  │
│   Version Info  │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────┐
│    Deployment Engine API        │
│  ┌───────────────────────────┐  │
│  │  Version Query Endpoint   │  │
│  │  Health Report Endpoint   │  │
│  │  Rollout Status Endpoint  │  │
│  └───────────────────────────┘  │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│       Core Services             │
│  ┌───────────────────────────┐  │
│  │  Cohort Service           │  │
│  │  VersionBeacon Service    │  │
│  │  Deployment Service       │  │
│  └───────────────────────────┘  │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│    VersionBeacon Contract       │
│    (Base Sepolia Testnet)       │
│  0xA5Be5522bb3C748ea262a2A7d... │
└─────────────────────────────────┘
```

## API Endpoints

### `GET /api/v1/version/:nodeId`

Get applicable version for a specific node.

**Query Parameters:**
- `tier` (required): Node tier (`ALL`, `ORACLE`, `GUARDIAN`)
- `currentVersion` (optional): Current version running on node

**Response:**
```json
{
  "versionId": 1,
  "versionString": "0.1.0",
  "dockerImageTag": "ghcr.io/noderrxyz/noderr-node-os:0.1.0-all",
  "configHash": "0x...",
  "cohort": "canary",
  "shouldUpdate": true,
  "updatePriority": "normal"
}
```

### `POST /api/v1/health`

Report node health status.

**Request Body:**
```json
{
  "nodeId": "node-123",
  "version": "0.1.0",
  "metrics": {
    "uptime": 3600,
    "cpu": 45.2,
    "memory": 62.8,
    "errors": 0
  },
  "timestamp": "2025-11-28T01:00:00Z"
}
```

**Response:**
```json
{
  "acknowledged": true,
  "healthStatus": "healthy"
}
```

### `GET /api/v1/rollout/status`

Get current rollout status.

**Response:**
```json
{
  "currentVersion": "0.1.0",
  "targetVersion": "0.1.0",
  "rolloutPhase": "cohort2",
  "nodesUpdated": 150,
  "totalNodes": 500,
  "successRate": 98.5,
  "errors": 2
}
```

### `GET /api/v1/health-check`

Simple health check endpoint.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-11-28T01:00:00Z"
}
```

## Installation

```bash
# Install dependencies
npm install

# Copy environment configuration
cp .env.example .env

# Edit .env with your configuration
nano .env
```

## Development

```bash
# Run in development mode with hot reload
npm run dev

# Build TypeScript
npm run build

# Run tests
npm test

# Run tests with coverage
npm test:coverage

# Lint code
npm run lint

# Format code
npm run format
```

## Production

```bash
# Build the project
npm run build

# Start the server
npm start
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3001` |
| `HOST` | Server host | `0.0.0.0` |
| `LOG_LEVEL` | Logging level | `info` |
| `VERSION_BEACON_ADDRESS` | VersionBeacon contract address | `0xA5Be...` |
| `RPC_URL` | Blockchain RPC endpoint | Required |
| `DATABASE_URL` | PostgreSQL connection string | Required |
| `REDIS_URL` | Redis connection string | Required |

## Cohort Selection Algorithm

Nodes are assigned to cohorts using a deterministic hash-based algorithm:

1. Calculate `keccak256(nodeId)`
2. Convert hash to number `0-99`
3. Assign to cohort based on rollout configuration:
   - `0-4`: Canary (5%)
   - `5-29`: Cohort 1 (25%)
   - `30-54`: Cohort 2 (25%)
   - `55-79`: Cohort 3 (25%)
   - `80-99`: Cohort 4 (20%)

## Rollout Timeline

Based on default configuration (24-hour cohort delay):

- **T+0h**: Canary deployment (5% of nodes)
- **T+24h**: Cohort 1 deployment (25% of nodes)
- **T+48h**: Cohort 2 deployment (25% of nodes)
- **T+72h**: Cohort 3 deployment (25% of nodes)
- **T+96h**: Cohort 4 deployment (20% of nodes)

## Automatic Rollback

The Deployment Engine monitors health metrics and triggers rollback if:

- **>10% of nodes in a cohort are unhealthy**
- **Error rate >5% in a cohort**

Rollback is executed via the VersionBeacon contract's `emergencyRollback` function.

## License

MIT
