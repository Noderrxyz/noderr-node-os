# Noderr Node OS™

**Secure, Autonomous Node Software for the Noderr Protocol**

![CI](https://github.com/Noderrxyz/noderr-node-os/workflows/CI/badge.svg)
![Build Status](https://img.shields.io/badge/build-passing-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue)
![Node](https://img.shields.io/badge/node-%3E%3D22.0.0-green)

## Overview

Noderr Node OS is the institutional-grade software that powers the Noderr Protocol's decentralized network of node operators. It provides secure, autonomous operation with zero-downtime updates, hardware-attested authentication, and comprehensive monitoring.

## Architecture

The Node OS is designed with three tier-specific variants:

- **Oracle Nodes:** Full ML/AI systems with strategy generation and treasury management
- **Guardian Nodes:** Risk monitoring, fraud detection, and circuit breaking
- **Validator Nodes:** Data validation and basic transaction processing

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
├── packages/          # Monorepo packages
│   ├── types/        # Shared TypeScript types
│   ├── utils/        # Shared utilities
│   ├── telemetry/    # Monitoring and metrics
│   ├── core/         # Core system logic
│   └── .../          # Additional packages
├── .github/          # GitHub Actions workflows
└── docs/             # Documentation
```

### CI/CD

All pull requests are automatically tested via GitHub Actions:
- TypeScript compilation
- Unit tests
- Linting
- Type checking

## License

Copyright © 2025 Noderr Protocol. All rights reserved.
