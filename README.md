# Noderr Node OS™

**Secure, Autonomous Node Software for the Noderr Protocol**

![CI](https://github.com/Noderrxyz/noderr-node-os/workflows/CI/badge.svg)
![Build Status](https://img.shields.io/badge/build-passing-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue)
![Node](https://img.shields.io/badge/node-%3E%3D22.0.0-green)

## Overview

Noderr Node OS is the institutional-grade software that powers the Noderr Protocol's decentralized network of node operators. It provides secure, autonomous operation with zero-downtime updates, hardware-attested authentication, and comprehensive monitoring.

## Architecture

The Node OS implements a **three-node decentralized trading architecture** designed to compete with institutional systems like BlackRock's Aladdin. Each node type has a specific, non-overlapping responsibility in the trading lifecycle.

### The 3-Node System

| Node Type | Count | Responsibility | Key Functions |
| :--- | :--- | :--- | :--- |
| **Oracle Nodes** | 25-50 | **Intelligence & Consensus** | Market analysis, alpha generation, BFT consensus on trading signals |
| **Guardian Nodes** | 50-100 | **Risk & Compliance** | Pre-trade risk assessment, portfolio monitoring, majority voting on approvals |
| **Validator Nodes** | 100-500 | **Execution & Optimization** | Smart order routing, liquidity aggregation, MEV protection, trade execution |

**📚 [Complete Architecture Documentation](./docs/architecture/)**

### Information Flow

The protocol follows a strict, sequential flow to ensure security and performance:

```
Oracle Consensus (WHAT) → Guardian Approval (WHETHER) → Validator Execution (HOW) → Feedback Loop (LEARN)
```

1.  **Oracle Consensus**: Oracle nodes generate or receive a trading signal and use Byzantine Fault Tolerant (BFT) consensus to agree on its validity.
2.  **Guardian Approval**: The consensus-approved signal is sent to the Guardian network, which votes on whether the trade is within acceptable risk parameters (majority voting, 50%+).
3.  **Validator Execution**: If the Guardians approve, the trade is passed to the Validator network for optimized execution across multiple venues using algorithms like TWAP, VWAP, and Iceberg.
4.  **Feedback Loop**: Execution results are fed back into the Oracle network to improve future signal generation.

Each node type operates independently but coordinates through Byzantine Fault Tolerant consensus mechanisms. See the [architecture documentation](./docs/architecture/) for detailed analysis and diagrams.

## Key Features

- **NFT-as-License:** Nodes are cryptographically bound to on-chain Utility NFTs
- **Zero-Downtime Updates:** Hot-swappable components with automatic rollback
- **Hardware-Attested Security:** TPM-based key generation and authentication
- **Autonomous Operation:** Self-healing, self-updating nodes with minimal operator intervention

## Security

This repository contains proprietary software. Unauthorized distribution or use is strictly prohibited.

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

# Lint code
pnpm lint
```

### Project Structure

```
noderr-node-os/
├── packages/                    # Monorepo packages
│   ├── oracle-consensus/       # Oracle BFT consensus engine
│   ├── guardian-consensus/     # Guardian risk approval voting
│   ├── execution/              # Validator smart order routing
│   ├── autonomous-execution/   # Autonomous trading orchestrator
│   ├── floor-engine/           # Low-risk yield generation
│   ├── risk-engine/            # Risk management system
│   ├── types/                  # Shared TypeScript types
│   ├── utils/                  # Shared utilities
│   ├── telemetry/              # Monitoring and metrics
│   └── .../                    # Additional packages
├── .github/                    # GitHub Actions workflows
└── docs/                       # Documentation
```

### CI/CD

All pull requests are automatically tested via GitHub Actions:
- TypeScript compilation
- Unit tests
- Linting
- Type checking

## License

Copyright © 2025 Noderr Protocol. All rights reserved.
