# NODERR Node Operator Guide
## Complete Guide for Running a NODERR Node

**Version:** 1.0.0  
**Last Updated:** November 28, 2025  
**Network:** Base Mainnet  
**Minimum Stake:** 1,000 NODERR

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [System Requirements](#2-system-requirements)
3. [Getting Started](#3-getting-started)
4. [Node Installation](#4-node-installation)
5. [Staking NODERR Tokens](#5-staking-noderr-tokens)
6. [Node Operations](#6-node-operations)
7. [Monitoring & Maintenance](#7-monitoring--maintenance)
8. [Rewards & Economics](#8-rewards--economics)
9. [Troubleshooting](#9-troubleshooting)
10. [FAQ](#10-faq)

---

## 1. Introduction

### What is a NODERR Node?

A NODERR node is a decentralized infrastructure component that provides reliable, high-performance services to the NODERR network. Node operators stake NODERR tokens and earn rewards based on their node's performance, uptime, and tier.

### Node Tiers

**ALL (All-Purpose)**
- **Stake Required:** 1,000 NODERR
- **Reward Multiplier:** 1.0x
- **Services:** General-purpose node operations
- **Recommended For:** New operators, testing

**ORACLE (Oracle Node)**
- **Stake Required:** 5,000 NODERR
- **Reward Multiplier:** 2.0x
- **Services:** Price feeds, external data, metrics reporting
- **Recommended For:** Experienced operators with reliable infrastructure

**GUARDIAN (Guardian Node)**
- **Stake Required:** 10,000 NODERR
- **Reward Multiplier:** 5.0x
- **Services:** Network security, slashing enforcement, governance
- **Recommended For:** Trusted operators with high-availability setups

### Rewards

Rewards are distributed **daily** based on:
- **Base Reward:** Epoch rewards divided by active nodes
- **Tier Multiplier:** 1.0x (ALL), 2.0x (ORACLE), 5.0x (GUARDIAN)
- **Uptime Multiplier:** 0.0x to 1.0x based on uptime percentage
- **Error Penalty:** -0.1x per 1% error rate (max -1.0x)

**Example Daily Reward (Epoch = 1 day):**
- Epoch Rewards: 10,000 NODERR
- Active Nodes: 100
- Base Reward: 100 NODERR
- Tier: ORACLE (2.0x)
- Uptime: 99% (0.99x)
- Errors: 0.5% (-0.05x)
- **Total:** 100 × 2.0 × 0.99 × 0.95 = **188.1 NODERR/day**

---

## 2. System Requirements

### Minimum Requirements

**Hardware:**
- **CPU:** 2 cores (4 recommended)
- **RAM:** 4GB (8GB recommended)
- **Storage:** 50GB SSD (100GB recommended)
- **Network:** 100 Mbps up/down (1 Gbps recommended)

**Software:**
- **OS:** Ubuntu 22.04 LTS (recommended) or macOS
- **Docker:** 24.0+ with Docker Compose
- **Node.js:** 22.x (if running without Docker)
- **Git:** 2.x

**Network:**
- **Static IP:** Recommended (dynamic IP with DDNS acceptable)
- **Open Ports:** 3000 (HTTP), 9090 (metrics)
- **Firewall:** Allow inbound on required ports

### Recommended Requirements (Production)

**Hardware:**
- **CPU:** 4 cores (8 for GUARDIAN)
- **RAM:** 8GB (16GB for GUARDIAN)
- **Storage:** 100GB NVMe SSD
- **Network:** 1 Gbps up/down, <20ms latency

**Hosting:**
- **Cloud Provider:** AWS, GCP, DigitalOcean, or Hetzner
- **Instance Type:** 
  - AWS: t3.medium (ALL), t3.large (ORACLE), t3.xlarge (GUARDIAN)
  - GCP: n2-standard-2 (ALL), n2-standard-4 (ORACLE), n2-standard-8 (GUARDIAN)
  - DigitalOcean: $24/mo (ALL), $48/mo (ORACLE), $96/mo (GUARDIAN)

**Uptime:**
- **Target:** 99.9% (8.76 hours downtime/year)
- **Monitoring:** 24/7 monitoring with alerts
- **Redundancy:** Backup power, internet connection

---

## 3. Getting Started

### Step 1: Acquire NODERR Tokens

**Option 1: Purchase on DEX**
```bash
# Uniswap V3 (Base Mainnet)
# 1. Go to https://app.uniswap.org
# 2. Connect wallet
# 3. Select Base network
# 4. Swap ETH for NODERR
# 5. Token address: 0x... (check official docs)
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

### Step 2: Set Up Wallet

**Recommended:** MetaMask or Rabby Wallet

```bash
# Add Base Mainnet to MetaMask
Network Name: Base
RPC URL: https://mainnet.base.org
Chain ID: 8453
Currency Symbol: ETH
Block Explorer: https://basescan.org
```

### Step 3: Prepare Infrastructure

**Option 1: Cloud Provider (Recommended)**

```bash
# AWS EC2
# 1. Launch instance
# 2. Choose Ubuntu 22.04 LTS
# 3. Select instance type (t3.medium minimum)
# 4. Configure security group (allow 22, 3000, 9090)
# 5. Launch and connect via SSH

# DigitalOcean Droplet
# 1. Create droplet
# 2. Choose Ubuntu 22.04
# 3. Select plan ($24/mo minimum)
# 4. Add SSH key
# 5. Create and connect
```

**Option 2: Home Server**

```bash
# Requirements:
# - Static IP or DDNS
# - Port forwarding configured
# - UPS for power backup
# - Reliable internet connection

# Configure router:
# - Forward port 3000 to server IP
# - Forward port 9090 to server IP
# - Enable UPnP (optional)
```

---

## 4. Node Installation

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
cp .env.example .env
nano .env

# Edit:
# - OPERATOR_ADDRESS=0xYourWalletAddress
# - NODE_TIER=ALL  # or ORACLE, GUARDIAN
# - RPC_URL=https://mainnet.base.org
# - STAKING_CONTRACT=0x... (from official docs)

# 4. Start node
docker-compose up -d

# 5. Check logs
docker-compose logs -f

# 6. Verify node is running
curl http://localhost:3000/health
# Expected: {"status": "healthy", "uptime": ...}
```

### Method 2: Manual Installation

```bash
# 1. Install Node.js
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. Clone repository
git clone https://github.com/Noderrxyz/noderr-node-os.git
cd noderr-node-os

# 3. Install dependencies
npm install

# 4. Build
npm run build

# 5. Configure environment
cp .env.example .env
nano .env
# (Edit as above)

# 6. Start node
npm start

# Or with PM2 (recommended):
npm install -g pm2
pm2 start dist/index.js --name noderr-node
pm2 save
pm2 startup
```

### Method 3: One-Line Installer (Coming Soon)

```bash
# Automated installer (future release)
curl -fsSL https://install.noderr.network | bash
```

---

## 5. Staking NODERR Tokens

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

```bash
# In dApp:
# 1. Enter stake amount (minimum 1,000 NODERR)
# 2. Select node tier (ALL, ORACLE, GUARDIAN)
# 3. Enter node ID (your node's unique identifier)
# 4. Click "Stake"
# 5. Confirm transaction
# 6. Wait for confirmation

# Verify stake:
# - Check "My Stakes" section
# - Should show your stake amount and tier
```

### Step 3: Register Node

```bash
# Your node will automatically register once staked
# Verify registration:

curl http://localhost:3000/api/status

# Expected:
# {
#   "nodeId": "your-node-id",
#   "operator": "0xYourAddress",
#   "tier": "ALL",
#   "staked": 1000,
#   "active": true
# }
```

---

## 6. Node Operations

### Starting the Node

```bash
# Docker
docker-compose up -d

# PM2
pm2 start noderr-node

# Manual
npm start
```

### Stopping the Node

```bash
# Docker
docker-compose down

# PM2
pm2 stop noderr-node

# Manual
# Press Ctrl+C
```

### Restarting the Node

```bash
# Docker
docker-compose restart

# PM2
pm2 restart noderr-node
```

### Viewing Logs

```bash
# Docker
docker-compose logs -f

# PM2
pm2 logs noderr-node

# Manual
# Logs are printed to console
```

### Updating the Node

```bash
# 1. Pull latest code
git pull origin main

# 2. Rebuild
# Docker:
docker-compose down
docker-compose build
docker-compose up -d

# PM2:
npm install
npm run build
pm2 restart noderr-node

# 3. Verify update
curl http://localhost:3000/version
# Expected: {"version": "1.x.x"}
```

---

## 7. Monitoring & Maintenance

### Health Checks

```bash
# Check node health
curl http://localhost:3000/health

# Expected:
# {
#   "status": "healthy",
#   "uptime": 86400,
#   "lastHeartbeat": "2025-11-28T12:00:00Z"
# }

# Check metrics
curl http://localhost:9090/metrics

# Expected: Prometheus-format metrics
```

### Performance Metrics

**Key Metrics to Monitor:**
- **Uptime:** Should be >99%
- **Error Rate:** Should be <1%
- **Response Time:** Should be <100ms
- **CPU Usage:** Should be <80%
- **Memory Usage:** Should be <80%
- **Disk Usage:** Should be <80%

### Setting Up Monitoring

**Option 1: Grafana Cloud (Free Tier)**

```bash
# 1. Sign up at https://grafana.com
# 2. Create new stack
# 3. Get API key
# 4. Configure Prometheus remote write

# In prometheus.yml:
remote_write:
  - url: https://prometheus-us-central1.grafana.net/api/prom/push
    basic_auth:
      username: YOUR_USERNAME
      password: YOUR_API_KEY
```

**Option 2: Self-Hosted Grafana**

```bash
# Use monitoring stack from repository
cd monitoring
docker-compose up -d

# Access Grafana
# http://your-server-ip:3001
# Default: admin/admin
```

### Alerts

**Configure alerts for:**
- Node offline >5 minutes
- Error rate >5%
- CPU usage >90%
- Memory usage >90%
- Disk usage >90%

```bash
# Example: Email alert via Alertmanager
# Edit monitoring/config/alertmanager.yml

receivers:
  - name: 'email'
    email_configs:
      - to: 'your-email@example.com'
        from: 'alerts@noderr.network'
        smarthost: 'smtp.gmail.com:587'
        auth_username: 'your-email@gmail.com'
        auth_password: 'your-app-password'
```

### Maintenance Schedule

**Daily:**
- Check node health
- Review error logs
- Verify heartbeat

**Weekly:**
- Check disk space
- Review performance metrics
- Update dependencies (if needed)

**Monthly:**
- Security updates
- Backup configuration
- Review rewards

---

## 8. Rewards & Economics

### Reward Calculation

```
Daily Reward = Base Reward × Tier Multiplier × Uptime Multiplier × (1 - Error Penalty)

Where:
- Base Reward = Epoch Rewards / Active Nodes
- Tier Multiplier = 1.0x (ALL), 2.0x (ORACLE), 5.0x (GUARDIAN)
- Uptime Multiplier = Uptime % / 100
- Error Penalty = Error Rate % × 0.1 (max 1.0)
```

### Example Scenarios

**Scenario 1: ALL Node, Perfect Performance**
- Epoch Rewards: 10,000 NODERR
- Active Nodes: 100
- Base Reward: 100 NODERR
- Tier: ALL (1.0x)
- Uptime: 100% (1.0x)
- Errors: 0% (0.0x penalty)
- **Daily Reward:** 100 × 1.0 × 1.0 × 1.0 = **100 NODERR**

**Scenario 2: ORACLE Node, Good Performance**
- Epoch Rewards: 10,000 NODERR
- Active Nodes: 100
- Base Reward: 100 NODERR
- Tier: ORACLE (2.0x)
- Uptime: 99.5% (0.995x)
- Errors: 0.2% (-0.02x)
- **Daily Reward:** 100 × 2.0 × 0.995 × 0.98 = **195.02 NODERR**

**Scenario 3: GUARDIAN Node, Excellent Performance**
- Epoch Rewards: 10,000 NODERR
- Active Nodes: 100
- Base Reward: 100 NODERR
- Tier: GUARDIAN (5.0x)
- Uptime: 99.9% (0.999x)
- Errors: 0.1% (-0.01x)
- **Daily Reward:** 100 × 5.0 × 0.999 × 0.99 = **494.505 NODERR**

### Claiming Rewards

```bash
# Go to NODERR dApp
# https://app.noderr.network

# 1. Connect wallet
# 2. Go to "Rewards" tab
# 3. Click "Claim Rewards"
# 4. Confirm transaction
# 5. Rewards sent to your wallet

# Or via CLI (advanced):
cast send 0xREWARD_DISTRIBUTOR_ADDRESS \
  "claimReward(bytes32,uint256)" \
  YOUR_NODE_ID \
  EPOCH_NUMBER \
  --private-key $PRIVATE_KEY \
  --rpc-url https://mainnet.base.org
```

### ROI Calculation

**ALL Node (1,000 NODERR stake):**
- Daily Reward: ~100 NODERR
- Monthly Reward: ~3,000 NODERR
- Annual Reward: ~36,500 NODERR
- **ROI:** 3,650% APY (assuming perfect performance)

**ORACLE Node (5,000 NODERR stake):**
- Daily Reward: ~200 NODERR
- Monthly Reward: ~6,000 NODERR
- Annual Reward: ~73,000 NODERR
- **ROI:** 1,460% APY

**GUARDIAN Node (10,000 NODERR stake):**
- Daily Reward: ~500 NODERR
- Monthly Reward: ~15,000 NODERR
- Annual Reward: ~182,500 NODERR
- **ROI:** 1,825% APY

**Note:** Actual rewards depend on network conditions, number of active nodes, and your node's performance.

---

## 9. Troubleshooting

### Node Won't Start

**Problem:** Node fails to start

**Solutions:**
```bash
# Check logs
docker-compose logs

# Common issues:
# 1. Port already in use
sudo lsof -i :3000
# Kill process using port
sudo kill -9 PID

# 2. Environment variables missing
cat .env
# Verify all required variables are set

# 3. Docker not running
sudo systemctl status docker
sudo systemctl start docker

# 4. Insufficient permissions
sudo chown -R $USER:$USER .
```

### Node Offline

**Problem:** Node shows as offline in dashboard

**Solutions:**
```bash
# 1. Check if node is running
curl http://localhost:3000/health

# 2. Check firewall
sudo ufw status
sudo ufw allow 3000

# 3. Check network connectivity
ping 8.8.8.8

# 4. Restart node
docker-compose restart
```

### High Error Rate

**Problem:** Error rate >5%

**Solutions:**
```bash
# 1. Check logs for errors
docker-compose logs | grep ERROR

# 2. Check system resources
htop
df -h

# 3. Check RPC connection
curl https://mainnet.base.org \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'

# 4. Update node
git pull
docker-compose down
docker-compose build
docker-compose up -d
```

### Low Rewards

**Problem:** Rewards lower than expected

**Solutions:**
```bash
# 1. Check uptime
curl http://localhost:3000/metrics | grep uptime

# 2. Check error rate
curl http://localhost:3000/metrics | grep error_rate

# 3. Verify stake amount
# Go to dApp -> My Stakes

# 4. Check network conditions
# More nodes = lower base reward
```

### Slashed

**Problem:** Node was slashed

**Solutions:**
```bash
# 1. Check slashing reason
# Go to dApp -> Slashing Events
# Find your node ID

# 2. Fix underlying issue
# - Excessive errors: Update node, check RPC
# - Downtime: Improve infrastructure, add monitoring
# - Missed heartbeats: Check network connectivity

# 3. Restake if needed
# If stake fell below minimum, add more tokens
```

---

## 10. FAQ

### General

**Q: How much can I earn running a node?**
A: Depends on your stake, tier, and performance. ALL nodes earn ~100 NODERR/day, ORACLE ~200, GUARDIAN ~500 (assuming 100 active nodes and perfect performance).

**Q: Can I run multiple nodes?**
A: Yes, you can run multiple nodes with separate stakes. Each node requires its own stake and infrastructure.

**Q: Can I unstake anytime?**
A: You can request withdrawal anytime, but there's a 7-day cooldown period before you can withdraw your tokens.

**Q: What happens if my node goes offline?**
A: Your uptime multiplier decreases, reducing rewards. If offline >24 hours, you may be slashed.

**Q: Can I upgrade my node tier?**
A: Yes, stake additional tokens to reach the next tier's minimum. Tier is automatically updated.

### Technical

**Q: What OS should I use?**
A: Ubuntu 22.04 LTS is recommended. macOS also works. Windows is not officially supported.

**Q: Can I run a node on a Raspberry Pi?**
A: Not recommended. Insufficient resources for reliable operation.

**Q: Do I need a static IP?**
A: Recommended but not required. Dynamic IP with DDNS works.

**Q: How much bandwidth does a node use?**
A: ~1-5 GB/day depending on tier and traffic.

**Q: Can I run a node behind a VPN?**
A: Yes, but ensure VPN doesn't block required ports.

### Economics

**Q: When are rewards distributed?**
A: Rewards are calculated daily (per epoch) and can be claimed anytime.

**Q: Are rewards automatically compounded?**
A: No, you must manually claim and restake to compound.

**Q: What's the minimum stake?**
A: 1,000 NODERR for ALL tier.

**Q: Can I add to my stake?**
A: Yes, stake additional tokens anytime. No cooldown for adding.

**Q: What happens to my stake if I'm slashed?**
A: Slashed amount is deducted from your stake. If stake falls below minimum, you must add more to continue operating.

### Security

**Q: Is my private key safe?**
A: Your private key never leaves your wallet. Node only uses your address for identification.

**Q: Can someone steal my stake?**
A: No, stake is locked in smart contract. Only you can withdraw after cooldown.

**Q: What if the smart contract is hacked?**
A: Contracts are audited and have emergency pause functionality. Insurance may be available (check official docs).

**Q: Should I use a hardware wallet?**
A: Recommended for large stakes (>10,000 NODERR).

---

## Appendix A: Commands Reference

### Docker Commands

```bash
# Start node
docker-compose up -d

# Stop node
docker-compose down

# Restart node
docker-compose restart

# View logs
docker-compose logs -f

# Update node
git pull && docker-compose down && docker-compose build && docker-compose up -d

# Check status
docker-compose ps
```

### PM2 Commands

```bash
# Start node
pm2 start noderr-node

# Stop node
pm2 stop noderr-node

# Restart node
pm2 restart noderr-node

# View logs
pm2 logs noderr-node

# Check status
pm2 status

# Monitor
pm2 monit
```

### Health Check Commands

```bash
# Node health
curl http://localhost:3000/health

# Metrics
curl http://localhost:9090/metrics

# Version
curl http://localhost:3000/version

# Status
curl http://localhost:3000/api/status
```

---

## Appendix B: Support Resources

**Official Documentation:**
- Website: https://noderr.network
- Docs: https://docs.noderr.network
- GitHub: https://github.com/Noderrxyz

**Community:**
- Discord: https://discord.gg/noderr
- Telegram: https://t.me/noderr
- Twitter: https://twitter.com/noderrxyz

**Support:**
- Email: support@noderr.network
- Forum: https://forum.noderr.network

**Emergency:**
- Security: security@noderr.network
- Critical Issues: emergency@noderr.network

---

**Document Version:** 1.0.0  
**Last Updated:** November 28, 2025  
**Next Review:** December 28, 2025

**Happy Node Operating! 🚀**
