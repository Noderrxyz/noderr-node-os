# NODERR Node Operator Guide
## Complete Guide for Running a NODERR Node

**Version:** 2.0.0  
**Last Updated:** December 20, 2025  
**Network:** Base Mainnet  
**Minimum Stake:** Varies by tier

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Node Tier Architecture](#2-node-tier-architecture)
3. [System Requirements](#3-system-requirements)
4. [Getting Started](#4-getting-started)
5. [Node Installation](#5-node-installation)
6. [Staking NODERR Tokens](#6-staking-noderr-tokens)
7. [Node Operations](#7-node-operations)
8. [Monitoring & Maintenance](#8-monitoring--maintenance)
9. [Rewards & Economics](#9-rewards--economics)
10. [Slashing & Penalties](#10-slashing--penalties)
11. [Troubleshooting](#11-troubleshooting)
12. [FAQ](#12-faq)

---

## 1. Introduction

### What is a NODERR Node?

A NODERR node is a decentralized infrastructure component that provides reliable, high-performance services to the NODERR network. Node operators stake NODERR tokens and earn rewards based on their node's performance, uptime, and tier.

The NODERR network operates as a three-tier decentralized trading intelligence system:
- **Validators** provide network consensus and on-chain validation
- **Guardians** handle risk management and trade execution
- **Oracles** generate alpha signals through ML/AI analysis

### Network Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    NODERR NETWORK ARCHITECTURE                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐        │
│   │   ORACLE    │───▶│  GUARDIAN   │───▶│  VALIDATOR  │        │
│   │   (Tier 4)  │    │   (Tier 3)  │    │   (Tier 2)  │        │
│   └─────────────┘    └─────────────┘    └─────────────┘        │
│         │                  │                  │                 │
│    ML/AI Alpha        Risk & Trade       On-Chain              │
│    Generation         Execution          Validation            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Node Tier Architecture

### Tier Overview

| Tier | Node Type | Role | Stake Required | Reward Multiplier |
|------|-----------|------|----------------|-------------------|
| **2** | **Validator** | On-chain validation & network consensus | 25,000 NODERR | 1.0x |
| **3** | **Guardian** | Risk management & trade execution | 50,000 NODERR | 2.5x |
| **4** | **Oracle** | ML/AI alpha generation & data science | 150,000 NODERR | 5.0x |

### Validator Node (Tier 2) - Entry Level

**Role:** Lightweight network participation and on-chain validation

**Responsibilities:**
- Participate in validator consensus
- Attest to data validity from Guardian and Oracle nodes
- Submit attestations on-chain
- Relay market data to the network
- Maintain network heartbeat

**Services Running:**
- `validator-consensus` - Consensus participation
- `on-chain-service` - On-chain validation
- `market-data` - Market data relay (reduced scope)
- `data-connectors` - Basic data connectors
- `telemetry` - Performance monitoring
- `heartbeat-client` - Network heartbeat

**Best For:** New operators, those with limited hardware, entry into the network

### Guardian Node (Tier 3) - Execution Layer

**Role:** Risk management, compliance, and trade execution

**Responsibilities:**
- Risk analysis and monitoring
- Compliance checking
- Trade execution and order routing
- Autonomous execution management
- Floor engine operations
- System orchestration
- Guardian consensus participation

**Services Running:**
- `risk-engine` - Risk analysis & monitoring
- `compliance` - Compliance checking
- `guardian-consensus` - Guardian consensus
- `execution` - Trade execution
- `autonomous-execution` - Autonomous trading
- `floor-engine` - Floor engine operations
- `integration-layer` - System integration
- `system-orchestrator` - System orchestration
- `market-data` - Market data feeds
- `exchanges` - Exchange connectivity
- `data-connectors` - Data source connectors
- `telemetry` - Performance monitoring
- `heartbeat-client` - Network heartbeat

**Best For:** Experienced operators with reliable infrastructure

### Oracle Node (Tier 4) - Intelligence Layer

**Role:** ML/AI-powered alpha generation and market intelligence

**Responsibilities:**
- Machine learning model inference
- Alpha signal generation
- Market intelligence analysis
- Quantitative research
- Strategy development
- Capital AI optimization
- Oracle consensus coordination

**Services Running:**
- `ml-service` - Machine learning inference (GPU-accelerated)
- `market-intel` - Market intelligence
- `quant-research` - Quantitative research
- `strategy` - Strategy development
- `capital-ai` - Capital optimization
- `alpha-exploitation` - Alpha signal generation
- `oracle-consensus` - Oracle consensus coordination
- `market-data` - Market data feeds
- `exchanges` - Exchange connectivity
- `data-connectors` - Data source connectors
- `telemetry` - Performance monitoring
- `heartbeat-client` - Network heartbeat

**Best For:** Professional operators with high-end GPU hardware

---

## 3. System Requirements

### Validator Node (Tier 2) - Lightest

**Minimum Requirements:**
| Component | Minimum | Recommended |
|-----------|---------|-------------|
| **CPU** | 4 cores | 8 cores |
| **RAM** | 8 GB | 16 GB |
| **Storage** | 100 GB SSD | 250 GB NVMe SSD |
| **Network** | 100 Mbps | 500 Mbps |
| **GPU** | Not required | Not required |
| **Uptime** | 95%+ | 99%+ |

**Estimated Monthly Cost:** $20-50 (cloud) or existing hardware

**Cloud Instance Recommendations:**
- AWS: t3.medium
- GCP: e2-medium
- DigitalOcean: $24/mo Droplet
- Hetzner: CX21

### Guardian Node (Tier 3) - Medium

**Minimum Requirements:**
| Component | Minimum | Recommended |
|-----------|---------|-------------|
| **CPU** | 12 cores | 16 cores |
| **RAM** | 32 GB | 64 GB |
| **Storage** | 500 GB NVMe SSD | 1 TB NVMe SSD |
| **Network** | 500 Mbps | 1 Gbps |
| **GPU** | Not required | Not required |
| **Uptime** | 98%+ | 99.5%+ |

**Estimated Monthly Cost:** $100-200 (cloud) or dedicated hardware

**Cloud Instance Recommendations:**
- AWS: c6i.2xlarge
- GCP: c2-standard-8
- DigitalOcean: $96/mo Droplet
- Hetzner: CCX23

### Oracle Node (Tier 4) - Heaviest

**Minimum Requirements:**
| Component | Minimum | Recommended |
|-----------|---------|-------------|
| **CPU** | 16 cores | 32 cores |
| **RAM** | 64 GB | 128 GB |
| **Storage** | 1 TB NVMe SSD | 2 TB NVMe SSD |
| **Network** | 1 Gbps | 1 Gbps+ |
| **GPU** | 12 GB VRAM (NVIDIA) | 24 GB+ VRAM (NVIDIA) |
| **Uptime** | 99%+ | 99.9%+ |

**GPU Requirements:**
- **Minimum:** NVIDIA RTX 4060 Ti 16GB, RTX 3080, or equivalent
- **Recommended:** NVIDIA RTX 4080, RTX 4090, A4000, or A6000
- **CUDA:** 11.8+ required
- **Driver:** 525.0+ required

**Estimated Monthly Cost:** $300-500 (cloud with GPU) or dedicated hardware

**Cloud Instance Recommendations:**
- AWS: g5.2xlarge (A10G GPU)
- GCP: a2-highgpu-1g (A100 GPU)
- Lambda Labs: GPU Cloud
- Vast.ai: Community GPU rentals

### Software Requirements (All Tiers)

| Software | Version | Notes |
|----------|---------|-------|
| **OS** | Ubuntu 22.04 LTS | Recommended |
| **Docker** | 24.0+ | With Docker Compose |
| **Node.js** | 22.x | If running without Docker |
| **NVIDIA Driver** | 525.0+ | Oracle nodes only |
| **CUDA** | 11.8+ | Oracle nodes only |

---

## 4. Getting Started

### Step 1: Choose Your Tier

Consider the following when choosing your tier:

| Factor | Validator | Guardian | Oracle |
|--------|-----------|----------|--------|
| **Hardware Cost** | Low | Medium | High |
| **Technical Skill** | Basic | Intermediate | Advanced |
| **Stake Required** | 50,000 NODERR | 100,000 NODERR | 500,000 NODERR |
| **Reward Potential** | Base | 2.5x Base | 5x Base |
| **Responsibility** | Low | Medium | High |
| **Slashing Risk** | Low | Medium | High |

### Step 2: Acquire NODERR Tokens

**Option 1: Purchase on DEX**
```bash
# Uniswap V3 (Base Mainnet)
# 1. Go to https://app.uniswap.org
# 2. Connect wallet
# 3. Select Base network
# 4. Swap ETH for NODERR
# 5. Token address: (check official docs)
```

**Option 2: Bridge from Ethereum**
```bash
# Base Bridge
# 1. Go to https://bridge.base.org
# 2. Connect wallet
# 3. Select NODERR token
# 4. Enter amount
# 5. Confirm transaction
```

### Step 3: Set Up Wallet

**Recommended:** MetaMask or Rabby Wallet

```bash
# Add Base Mainnet to MetaMask
Network Name: Base
RPC URL: https://mainnet.base.org
Chain ID: 8453
Currency Symbol: ETH
Block Explorer: https://basescan.org
```

### Step 4: Prepare Infrastructure

See [System Requirements](#3-system-requirements) for your chosen tier.

---

## 5. Node Installation

### Method 1: Docker (Recommended)

```bash
# 1. Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
newgrp docker

# 2. Clone repository
git clone https://github.com/Noderrxyz/noderr-node-os.git
cd noderr-node-os

# 3. Configure environment
cp .env.template .env
nano .env

# Edit:
# - OPERATOR_ADDRESS=0xYourWalletAddress
# - NODE_TIER=VALIDATOR  # or GUARDIAN, ORACLE
# - RPC_URL=https://mainnet.base.org
# - VALIDATOR_PRIVATE_KEY=your_private_key (for signing attestations)

# 4. Start node (choose your tier)
# Validator:
docker-compose -f docker/validator/docker-compose.yml up -d

# Guardian:
docker-compose -f docker/guardian/docker-compose.yml up -d

# Oracle:
docker-compose -f docker/oracle/docker-compose.yml up -d

# 5. Check logs
docker-compose logs -f

# 6. Verify node is running
curl http://localhost:3000/health
```

### Method 2: Manual Installation

```bash
# 1. Install Node.js
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. Install pnpm
npm install -g pnpm@8

# 3. Clone repository
git clone https://github.com/Noderrxyz/noderr-node-os.git
cd noderr-node-os

# 4. Install dependencies
pnpm install

# 5. Build
pnpm build

# 6. Configure environment
cp .env.template .env
nano .env

# 7. Start with PM2
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

### Oracle Node: GPU Setup

```bash
# 1. Install NVIDIA drivers
sudo apt update
sudo apt install -y nvidia-driver-525

# 2. Install CUDA
wget https://developer.download.nvidia.com/compute/cuda/11.8.0/local_installers/cuda_11.8.0_520.61.05_linux.run
sudo sh cuda_11.8.0_520.61.05_linux.run

# 3. Install NVIDIA Container Toolkit
distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
curl -s -L https://nvidia.github.io/nvidia-docker/gpgkey | sudo apt-key add -
curl -s -L https://nvidia.github.io/nvidia-docker/$distribution/nvidia-docker.list | sudo tee /etc/apt/sources.list.d/nvidia-docker.list
sudo apt update
sudo apt install -y nvidia-container-toolkit
sudo systemctl restart docker

# 4. Verify GPU access
docker run --rm --gpus all nvidia/cuda:11.8.0-base-ubuntu22.04 nvidia-smi
```

---

## 6. Staking NODERR Tokens

### Step 1: Approve Token Spending

```bash
# Go to NODERR dApp
# https://app.noderr.network

# 1. Connect wallet
# 2. Go to "Stake" tab
# 3. Click "Approve NODERR"
# 4. Confirm transaction
# 5. Wait for confirmation
```

### Step 2: Stake Tokens

| Tier | Minimum Stake |
|------|---------------|
| Validator | 50,000 NODERR |
| Guardian | 100,000 NODERR |
| Oracle | 500,000 NODERR |

```bash
# In dApp:
# 1. Enter stake amount
# 2. Select node tier
# 3. Enter node ID (from your node's config)
# 4. Click "Stake"
# 5. Confirm transaction
```

### Step 3: Register Node

Your node will automatically register once staked. Verify:

```bash
curl http://localhost:3000/api/status

# Expected:
# {
#   "nodeId": "your-node-id",
#   "operator": "0xYourAddress",
#   "tier": "VALIDATOR",
#   "staked": 1000,
#   "active": true
# }
```

---

## 7. Node Operations

### Starting the Node

```bash
# Docker (Validator)
docker-compose -f docker/validator/docker-compose.yml up -d

# Docker (Guardian)
docker-compose -f docker/guardian/docker-compose.yml up -d

# Docker (Oracle)
docker-compose -f docker/oracle/docker-compose.yml up -d

# PM2
pm2 start ecosystem.config.js
```

### Stopping the Node

```bash
# Docker
docker-compose down

# PM2
pm2 stop all
```

### Viewing Logs

```bash
# Docker
docker-compose logs -f

# PM2
pm2 logs
```

### Updating the Node

```bash
# 1. Pull latest code
git pull origin main

# 2. Rebuild and restart
docker-compose down
docker-compose build
docker-compose up -d

# 3. Verify update
curl http://localhost:3000/version
```

---

## 8. Monitoring & Maintenance

### Health Checks

```bash
# Check node health
curl http://localhost:3000/health

# Check metrics
curl http://localhost:9090/metrics
```

### Key Metrics by Tier

**Validator:**
- Uptime: >95%
- Attestation success rate: >98%
- Response time: <200ms

**Guardian:**
- Uptime: >98%
- Execution success rate: >99%
- Risk check latency: <50ms

**Oracle:**
- Uptime: >99%
- Model inference time: <500ms
- GPU utilization: 40-80%
- Alpha signal accuracy: tracked

### Alerts

Configure alerts for:
- Node offline >5 minutes
- Error rate >5%
- CPU/Memory/Disk >90%
- GPU temperature >85°C (Oracle)

---

## 9. Rewards & Economics

### Reward Calculation

```
Daily Reward = Base Reward × Tier Multiplier × Uptime Multiplier × (1 - Error Penalty)
```

### Tier Multipliers

| Tier | Multiplier |
|------|------------|
| Validator | 1.0x |
| Guardian | 2.5x |
| Oracle | 5.0x |

### Example Calculations

**Validator (25,000 NODERR staked, 99% uptime):**
```
Base: 10 NODERR/day
Multiplier: 1.0x
Uptime: 0.99
Daily: 10 × 1.0 × 0.99 = 9.9 NODERR
```

**Guardian (50,000 NODERR staked, 99.5% uptime):**
```
Base: 10 NODERR/day
Multiplier: 2.5x
Uptime: 0.995
Daily: 10 × 2.5 × 0.995 = 24.875 NODERR
```

**Oracle (150,000 NODERR staked, 99.9% uptime):**
```
Base: 10 NODERR/day
Multiplier: 5.0x
Uptime: 0.999
Daily: 10 × 5.0 × 0.999 = 49.95 NODERR
```

---

## 10. Slashing & Penalties

### Slashing Conditions

| Condition | Validator | Guardian | Oracle |
|-----------|-----------|----------|--------|
| **Extended Downtime** | 1% (48h+) | 2% (24h+) | 3% (12h+) |
| **Malicious Behavior** | 25% | 50% | 75% |
| **Poor Performance** | 0.5% | 1% | 1.5% |
| **Consensus Violation** | 15% | 30% | 50% |

### Cooldown Periods

- Validator: 7 days between slashes
- Guardian: 3 days between slashes
- Oracle: 1 day between slashes

### Appeals

- Appeal window: 48 hours
- Submit evidence via dApp
- Resolution by governance

---

## 11. Troubleshooting

### Common Issues

**Node not starting:**
```bash
# Check Docker logs
docker-compose logs

# Check disk space
df -h

# Check memory
free -m
```

**GPU not detected (Oracle):**
```bash
# Verify NVIDIA driver
nvidia-smi

# Check Docker GPU access
docker run --rm --gpus all nvidia/cuda:11.8.0-base-ubuntu22.04 nvidia-smi
```

**Connection issues:**
```bash
# Check firewall
sudo ufw status

# Test RPC connection
curl -X POST -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
  https://mainnet.base.org
```

---

## 12. FAQ

**Q: Can I run multiple nodes?**
A: Yes, but each node requires a separate stake and unique node ID.

**Q: Can I upgrade my tier?**
A: Yes, stake additional tokens and update your node configuration.

**Q: What happens if my node goes offline?**
A: Brief outages (<24h for Validator, <12h for Guardian, <6h for Oracle) result in reduced rewards. Extended outages trigger slashing.

**Q: How are rewards distributed?**
A: Rewards are distributed daily based on uptime and performance metrics.

**Q: Can I run a node from home?**
A: Yes, but ensure reliable internet, static IP or DDNS, and appropriate hardware for your tier.

---

## Support

- **Documentation:** https://docs.noderr.network
- **Discord:** https://discord.gg/noderr
- **GitHub Issues:** https://github.com/Noderrxyz/noderr-node-os/issues

---

*This guide is maintained by the NODERR team. Last updated: December 20, 2025*
