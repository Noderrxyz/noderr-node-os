# NodeOS Docker Image Architecture

## Overview

This document outlines the production Docker image architecture for the three NodeOS tiers: **Oracle**, **Guardian**, and **Validator**. Each tier has distinct responsibilities and package requirements.

## Design Principles

1. **Security First**: Multi-stage builds, non-root users, minimal attack surface
2. **Production Ready**: Optimized for performance, reliability, and monitoring
3. **Tier-Specific**: Each image contains only the packages needed for its role
4. **Reproducible**: Version-tagged, automated builds via GitHub Actions
5. **Distributable**: Compressed images uploaded to Cloudflare R2 for delivery

## Node Tier Architecture

### Oracle Node (Tier 3)
**Responsibility**: Intelligence & Consensus  
**Staking Requirement**: 125,000 NODR  
**Token Airdrop**: 125,000 NODR

**Included Packages**:
- `oracle-consensus` - BFT consensus engine
- `alpha-edge` - Alpha signal generation
- `alpha-exploitation` - Trading signal optimization
- `market-intel` - Market analysis
- `quant-research` - Quantitative research
- `ml` - Machine learning models
- `ml-client` - ML service client
- `capital-ai` - AI-driven capital allocation
- `backtesting` - Strategy backtesting
- `telemetry` - Monitoring and metrics
- `core`, `types`, `utils` - Shared infrastructure

**Ports**:
- 3002: HTTP API
- 50052: gRPC

**Resource Requirements**:
- CPU: 2-4 cores
- Memory: 4-8 GB
- Storage: 20 GB

---

### Guardian Node (Tier 2)
**Responsibility**: Risk & Compliance  
**Staking Requirement**: 25,000 NODR  
**Token Airdrop**: 25,000 NODR

**Included Packages**:
- `guardian-consensus` - Majority voting system
- `risk-engine` - Pre-trade risk assessment
- `compliance` - Regulatory compliance checks
- `safety-control` - Safety mechanisms
- `human-oversight` - Human-in-the-loop controls
- `attestation-hardening` - Security attestation
- `attestation-mvs` - Multi-party verification
- `telemetry` - Monitoring and metrics
- `core`, `types`, `utils` - Shared infrastructure

**Ports**:
- 3003: HTTP API
- 50053: gRPC

**Resource Requirements**:
- CPU: 2 cores
- Memory: 2-4 GB
- Storage: 10 GB

---

### Validator Node (Tier 1)
**Responsibility**: Execution & Optimization  
**Staking Requirement**: 25,000 NODR  
**Token Airdrop**: 25,000 NODR

**Included Packages**:
- `validator-consensus` - Execution consensus
- `execution` - Smart order routing
- `floor-engine` - Low-risk yield generation
- `exchanges` - Exchange connectors
- `data-connectors` - Data source integrations
- `market-data` - Real-time market data
- `on-chain-service` - Blockchain interactions
- `on-chain-settlement` - Settlement execution
- `network-optimizer` - Network optimization
- `telemetry` - Monitoring and metrics
- `core`, `types`, `utils` - Shared infrastructure

**Ports**:
- 3001: HTTP API
- 50051: gRPC

**Resource Requirements**:
- CPU: 1-2 cores
- Memory: 2 GB
- Storage: 10 GB

---

## Build Strategy

### Multi-Stage Build Process

Each Dockerfile follows a three-stage pattern:

```dockerfile
# Stage 1: Builder
FROM node:22-alpine AS builder
# - Install build dependencies
# - Copy source code
# - Build TypeScript packages
# - Run security audits

# Stage 2: Production
FROM node:22-alpine
# - Install runtime dependencies only
# - Create non-root user
# - Copy built artifacts
# - Configure health checks
# - Set security policies
```

### Build Outputs

Each build produces:
1. **Docker Image**: Tagged with version (e.g., `noderr-oracle:1.0.0`)
2. **Compressed Archive**: Gzipped tar file for distribution (e.g., `oracle-1.0.0.tar.gz`)
3. **Metadata**: Build info, checksums, version info

### Distribution via Cloudflare R2

Images are uploaded to R2 bucket: `noderr-node-packages`

**Directory Structure**:
```
noderr-node-packages/
├── oracle/
│   ├── oracle-1.0.0.tar.gz
│   ├── oracle-1.0.0.tar.gz.sha256
│   └── oracle-latest.tar.gz
├── guardian/
│   ├── guardian-1.0.0.tar.gz
│   ├── guardian-1.0.0.tar.gz.sha256
│   └── guardian-latest.tar.gz
└── validator/
    ├── validator-1.0.0.tar.gz
    ├── validator-1.0.0.tar.gz.sha256
    └── validator-latest.tar.gz
```

**Public URLs**:
- Oracle: `https://pub-66ad852cb9e54582bd0af64bce8d0a04.r2.dev/oracle/oracle-1.0.0.tar.gz`
- Guardian: `https://pub-66ad852cb9e54582bd0af64bce8d0a04.r2.dev/guardian/guardian-1.0.0.tar.gz`
- Validator: `https://pub-66ad852cb9e54582bd0af64bce8d0a04.r2.dev/validator/validator-1.0.0.tar.gz`

---

## Deployment Flow

### User Purchase → Package Delivery

1. **User purchases node** via dApp (pays in ETH)
2. **Auto-mint service** mints NFT + airdrops NODR tokens
3. **Package delivery service** generates custom package:
   - Creates unique credentials (wallet, API keys)
   - Generates `.env` file with credentials
   - Creates `docker-compose.yml` with tier-specific image
   - Packages everything into a zip file
   - Uploads to R2 with unique ID
4. **Email service** sends setup instructions with download link
5. **User downloads** package and runs `docker-compose up -d`
6. **Node authenticates** with NFT and starts operating

### Custom Package Structure

Each user receives a unique package:

```
noderr-node-{tier}-{userId}.zip
├── .env                    # Unique credentials
├── docker-compose.yml      # Tier-specific configuration
├── README.md               # Setup instructions
└── scripts/
    ├── start.sh            # Start node
    ├── stop.sh             # Stop node
    └── update.sh           # Update node
```

The `docker-compose.yml` references the public R2 image URL, so users don't need to build anything locally.

---

## CI/CD Pipeline

### GitHub Actions Workflow

**Trigger**: Push to `master` branch or manual dispatch

**Steps**:
1. Checkout code
2. Set up Docker Buildx
3. Build Oracle image
4. Build Guardian image
5. Build Validator image
6. Export images as compressed archives
7. Generate checksums
8. Upload to Cloudflare R2
9. Update `latest` tags
10. Create GitHub release with artifacts

**Environment Variables Required**:
- `R2_ACCESS_KEY_ID`: Cloudflare R2 access key
- `R2_SECRET_ACCESS_KEY`: Cloudflare R2 secret key
- `R2_ACCOUNT_ID`: Cloudflare account ID
- `R2_BUCKET_NAME`: Target bucket name

---

## Security Considerations

1. **Non-root execution**: All containers run as unprivileged user `nodejs` (UID 1001)
2. **Minimal base image**: Alpine Linux for smallest attack surface
3. **No secrets in images**: Credentials injected at runtime via `.env`
4. **Health checks**: Automatic restart on failure
5. **Resource limits**: CPU and memory constraints prevent resource exhaustion
6. **Network isolation**: Containers communicate via internal network only
7. **Read-only filesystem**: Application code is read-only, only data volumes are writable

---

## Versioning Strategy

**Semantic Versioning**: `MAJOR.MINOR.PATCH`

- **MAJOR**: Breaking changes (e.g., protocol upgrades)
- **MINOR**: New features (e.g., new packages)
- **PATCH**: Bug fixes and security updates

**Example**: `1.0.0` → `1.1.0` (new feature) → `1.1.1` (bug fix) → `2.0.0` (breaking change)

**Tags**:
- Version tag: `noderr-oracle:1.0.0`
- Latest tag: `noderr-oracle:latest`

---

## Monitoring & Observability

Each node includes:
- **Health endpoint**: `/health` returns 200 if healthy
- **Metrics endpoint**: `/metrics` exposes Prometheus metrics
- **Telemetry package**: Sends operational data to coordinator
- **Structured logging**: JSON logs for easy parsing

---

## Future Enhancements

1. **Auto-updates**: Zero-downtime rolling updates
2. **GPU support**: ML acceleration for Oracle nodes
3. **Multi-arch builds**: ARM64 support for Raspberry Pi
4. **Kubernetes manifests**: Helm charts for cloud deployment
5. **Image signing**: Cosign signatures for supply chain security

---

## References

- [NodeOS Repository](https://github.com/Noderrxyz/noderr-node-os)
- [Cloudflare R2 Documentation](https://developers.cloudflare.com/r2/)
- [Docker Multi-Stage Builds](https://docs.docker.com/build/building/multi-stage/)
- [Node.js Best Practices](https://github.com/goldbergyoni/nodebestpractices)
