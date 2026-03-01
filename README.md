# Noderr Node OS™

**Secure, Autonomous Node Software for the Noderr Protocol**

![CI](https://github.com/Noderrxyz/noderr-node-os/workflows/CI/badge.svg)
![Build Status](https://img.shields.io/badge/build-passing-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue)
![Node](https://img.shields.io/badge/node-%3E%3D22.0.0-green)

## Overview

Noderr Node OS is the institutional-grade software that powers the Noderr Protocol's decentralized network of node operators. It provides secure, autonomous operation with zero-downtime updates, hardware-attested authentication, and comprehensive monitoring.

## Quick Start (Node Operators)

After purchasing a node license and receiving your install token:

```bash
# Linux
curl -fsSL https://raw.githubusercontent.com/Noderrxyz/noderr-node-os/master/installation-scripts/linux/install.sh | sudo bash -s -- <YOUR_INSTALL_TOKEN>
```

```powershell
# Windows (PowerShell as Administrator)
Set-ExecutionPolicy Bypass -Scope Process -Force
irm https://raw.githubusercontent.com/Noderrxyz/noderr-node-os/master/installation-scripts/windows/install.ps1 | iex
```

**📚 [Full Node Operator Guide](./docs/NODE_OPERATOR_GUIDE.md)**

## Architecture

The Node OS implements a **three-tier decentralized architecture** designed for institutional-grade intelligence infrastructure. Each node tier has a specific, non-overlapping responsibility.

### The 3-Tier System

| Node Tier | Responsibility | Key Services |
| :--- | :--- | :--- |
| **Oracle** (Tier 4) | Intelligence, ML & Consensus | Market analysis, alpha generation, BFT consensus, ML inference |
| **Guardian** (Tier 3) | Risk, Compliance & Execution | Pre-trade risk assessment, trade execution, portfolio monitoring |
| **Validator** (Tier 2) | On-Chain Validation & Relay | On-chain verification, data relay, market data distribution |

### Information Flow

```
Oracle Consensus (WHAT) → Guardian Approval (WHETHER) → Validator Execution (HOW) → Feedback Loop (LEARN)
```

1. **Oracle Consensus**: Oracle nodes generate trading signals and use Byzantine Fault Tolerant (BFT) consensus to agree on validity, verified on-chain via `OracleVerifier.sol`.
2. **Guardian Approval**: The consensus-approved signal is sent to the Guardian network for risk assessment and majority voting (50%+).
3. **Validator Execution**: If approved, the trade is passed to Validators for optimized execution across multiple venues.
4. **Feedback Loop**: Execution results feed back into the Oracle network for continuous improvement.

**📚 [Architecture Documentation](./docs/architecture/)**

## Key Features

- **One-Click Deployment**: Fully automated installation from Typeform purchase to running node
- **Auto-Generated Credentials**: Unique cryptographic identity per node (no shared keys)
- **Zero-Downtime Updates**: Heartbeat-driven update detection with systemd timer safety net
- **Hardware-Attested Security**: TPM-based key generation with software fallback
- **SHA256 Image Verification**: Every Docker image download is checksum-verified
- **P2P Networking**: Direct peer-to-peer communication via libp2p (TCP + WebSocket)
- **Comprehensive Monitoring**: Optional Prometheus/Grafana/Loki stack
- **Log Rotation**: PM2 logrotate + Docker json-file driver with size limits

## Project Structure

```
noderr-node-os/
├── packages/                        # Monorepo packages (47 packages)
│   ├── oracle-consensus/           # Oracle BFT consensus engine
│   ├── guardian-consensus/         # Guardian risk approval voting
│   ├── validator-consensus/        # Validator consensus participation
│   ├── heartbeat-client/           # Network heartbeat & JWT refresh
│   ├── decentralized-core/         # P2P networking (libp2p)
│   ├── on-chain-service/           # On-chain validation
│   ├── ml-client/                  # ML gRPC client
│   ├── telemetry/                  # Monitoring, health checks
│   ├── types/                      # Shared TypeScript types
│   ├── utils/                      # Shared utilities
│   └── .../                        # Additional packages
├── auth-api/                        # Authentication & registration API
├── docker/                          # Dockerfiles (oracle, guardian, validator)
├── contracts/                       # Solidity smart contracts
├── installation-scripts/            # Linux & Windows installers
├── monitoring/                      # Prometheus/Grafana stack
├── .github/workflows/               # CI/CD pipelines
└── docs/                            # Documentation
```

## Development

### Prerequisites

- Node.js >= 22.0.0
- pnpm >= 9.0.0

### Setup

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test
```

### CI/CD

- **Auth API**: Automated build, test, and deploy to Railway on push to master
- **Docker Images**: Build, checksum, and upload to R2 on version tags
- **Pull Requests**: TypeScript compilation, unit tests, linting

## Documentation

| Document | Description |
|----------|-------------|
| [Node Operator Guide](./docs/NODE_OPERATOR_GUIDE.md) | Installation, configuration, troubleshooting |
| [Architecture](./docs/architecture/) | System design and diagrams |
| [Docker Architecture](./docs/DOCKER_ARCHITECTURE.md) | Container structure and build process |
| [Network Testing](./docs/NETWORK_TESTING_GUIDE.md) | Testnet deployment and validation |
| [Security Audit](./docs/SECURITY_AUDIT.md) | Security analysis and hardening |
| [Bootstrap Nodes](./docs/BOOTSTRAP_NODES_DEPLOYMENT.md) | P2P bootstrap node deployment |

## License

Copyright © 2025 Noderr Protocol. All rights reserved.
