# Noderr Node OS — Node Operator Guide

## Table of Contents

1. [Overview](#overview)
2. [System Requirements](#system-requirements)
3. [Installation](#installation)
4. [Node Tiers](#node-tiers)
5. [Configuration](#configuration)
6. [Monitoring & Health](#monitoring--health)
7. [Auto-Updates](#auto-updates)
8. [Troubleshooting](#troubleshooting)
9. [Security Best Practices](#security-best-practices)
10. [FAQ](#faq)

---

## Overview

Noderr Node OS is a decentralized intelligence infrastructure that operates as a tiered node network. Each node participates in the network by running specialized services, contributing to consensus, and earning rewards based on uptime and performance.

Your node communicates with the Noderr network via:

- **Heartbeat**: Periodic health reports sent to the auth-API (every 60 seconds)
- **P2P Networking**: Direct peer-to-peer communication with other nodes (ports 4001/4002)
- **On-Chain Consensus**: Smart contract interactions for data verification (Oracle/Validator tiers)

---

## System Requirements

### Linux (Recommended)

| Component | Validator | Guardian | Oracle |
|-----------|-----------|----------|--------|
| CPU | 4 cores | 8 cores | 16 cores |
| RAM | 8 GB | 32 GB | 64 GB |
| Storage | 100 GB SSD | 250 GB SSD | 500 GB NVMe |
| Network | 100 Mbps | 500 Mbps | 1 Gbps |
| OS | Ubuntu 22.04+ / Debian 12+ | Ubuntu 22.04+ / Debian 12+ | Ubuntu 22.04+ / Debian 12+ |

### Windows

| Component | Validator | Guardian | Oracle |
|-----------|-----------|----------|--------|
| CPU | 4 cores | 8 cores | 16 cores |
| RAM | 16 GB | 32 GB | 64 GB |
| Storage | 100 GB SSD | 250 GB SSD | 500 GB NVMe |
| Network | 100 Mbps | 500 Mbps | 1 Gbps |
| OS | Windows 10/11 Pro (64-bit) | Windows 10/11 Pro (64-bit) | Windows 10/11 Pro (64-bit) |

**Important for Windows operators**: Docker Desktop requires Windows Pro, Enterprise, or Education with Hyper-V enabled. Windows Home is not supported.

---

## Installation

### Step 1: Obtain Your Install Token

After purchasing a node license through the Noderr website, you will receive an install token via email. This token is unique to your license and can only be used once. It expires after 7 days.

Your token looks like: `ndr_install_a1b2c3d4e5f6...`

### Step 2: Run the Installer

#### Linux

```bash
curl -fsSL https://raw.githubusercontent.com/Noderrxyz/noderr-node-os/master/installation-scripts/linux/install.sh | sudo bash -s -- <YOUR_INSTALL_TOKEN> [YOUR_WALLET_ADDRESS]
```

The installer will:
1. Verify system requirements
2. Install Docker (if not present)
3. Generate a unique cryptographic identity for your node
4. Register your node with the Noderr network
5. Download and verify the Docker image (SHA256 checksum)
6. Configure and start your node
7. Set up automatic updates via systemd timer

#### Windows (PowerShell as Administrator)

```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force
irm https://raw.githubusercontent.com/Noderrxyz/noderr-node-os/master/installation-scripts/windows/install.ps1 | iex
```

When prompted, enter your install token and optional wallet address.

### Step 3: Verify Installation

After installation, verify your node is running:

```bash
# Linux
docker ps | grep noderr
journalctl -u noderr-node -f

# Windows (PowerShell)
docker ps | Select-String noderr
```

---

## Node Tiers

### Validator (Tier 2 — Lightest)

The entry-level tier focused on on-chain validation and data relay.

**Services**: on-chain-service, validator-consensus, market-data (relay), data-connectors, telemetry, heartbeat-client

**Memory usage**: ~5 GB

### Guardian (Tier 3 — Medium)

The mid-tier focused on risk management, compliance, and trade execution.

**Services**: risk-engine, compliance, guardian-consensus, execution, autonomous-execution, floor-engine, integration-layer, system-orchestrator, market-data, exchanges, data-connectors, telemetry, heartbeat-client

**Memory usage**: ~23 GB

### Oracle (Tier 4 — Heaviest)

The highest tier with ML capabilities, market intelligence, and full consensus participation.

**Services**: telemetry, market-data, exchanges, data-connectors, ml-service, quant-research, market-intel, strategy, capital-ai, oracle-consensus, heartbeat-client

**Memory usage**: ~25 GB (plus ML service container)

---

## Configuration

### Configuration Files

All configuration is stored in `/opt/noderr/`:

| File | Purpose |
|------|---------|
| `node.env` | Environment variables for the node container |
| `credentials.json` | Node identity, JWT token, API key (keep secure!) |
| `install_config.json` | Tier, OS, and network configuration |

### Key Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ID` | Unique node identifier | Auto-generated |
| `NODE_TIER` | Node tier (VALIDATOR/GUARDIAN/ORACLE) | From install token |
| `AUTH_API_URL` | Authentication API endpoint | `https://auth.noderr.xyz` |
| `SIMULATION_MODE` | Enable simulation mode (no real trades) | `true` |
| `PAPER_TRADING` | Enable paper trading mode | `true` |
| `P2P_LISTEN_PORT` | P2P TCP port | `4001` |
| `P2P_WS_PORT` | P2P WebSocket port | `4002` |
| `HEARTBEAT_INTERVAL` | Heartbeat frequency (ms) | `60000` |

### Private Key Configuration

Your node's private key is used for on-chain operations and signing. It is auto-generated during installation using cryptographically secure random number generation.

**Never share your private key.** It is stored in `/opt/noderr/node.env`.

---

## Monitoring & Health

### Basic Health Check

```bash
# Check if the container is running and healthy
docker inspect --format='{{.State.Health.Status}}' noderr-node

# View PM2 process status inside the container
docker exec noderr-node pm2 list

# View recent logs
docker logs noderr-node --tail 100
```

### Advanced Monitoring (Optional)

For operators who want full observability, deploy the optional monitoring stack:

```bash
curl -fsSL https://raw.githubusercontent.com/Noderrxyz/noderr-node-os/master/monitoring/deploy-monitoring.sh | sudo bash
```

This deploys:
- **Grafana** (port 3000) — Dashboards and visualization
- **Prometheus** (port 9090) — Metrics collection
- **Loki** (port 3100) — Log aggregation
- **Alertmanager** (port 9093) — Alert routing

---

## Auto-Updates

Your node receives updates automatically through two mechanisms:

1. **Heartbeat-driven**: The heartbeat client checks for updates every 60 seconds. When the auth-API signals an update is available, the node logs the update intent.

2. **Systemd timer** (Linux): A daily timer runs the update script as a safety net. The timer checks for new Docker images and performs a rolling update with zero downtime.

### Manual Update

If you need to update manually:

```bash
# Linux
curl -fsSL https://raw.githubusercontent.com/Noderrxyz/noderr-node-os/master/installation-scripts/update_<tier>.sh -o /tmp/update.sh
sudo bash /tmp/update.sh
```

Replace `<tier>` with `oracle`, `guardian`, or `validator`.

---

## Troubleshooting

### Node Won't Start

```bash
# Check Docker status
systemctl status docker

# Check node service status
systemctl status noderr-node
journalctl -u noderr-node -n 50

# Check container logs
docker logs noderr-node --tail 200
```

### Heartbeat Failures

If you see "Heartbeat failed" in logs:

1. **Check internet connectivity**: `curl -s https://auth.noderr.xyz/api/v1/health-check`
2. **Check credentials**: Verify `/opt/noderr/credentials.json` exists and contains valid `nodeId` and `jwtToken`
3. **Check JWT expiry**: The heartbeat client automatically refreshes expired JWTs. If it keeps failing, the API key may be invalid.

### P2P Connection Issues

If your node cannot connect to peers:

1. **Check firewall**: Ensure ports 4001/tcp and 4002/tcp are open
   ```bash
   sudo ufw status  # Ubuntu
   sudo firewall-cmd --list-ports  # CentOS/RHEL
   ```
2. **Check port forwarding**: If behind a NAT/router, forward ports 4001 and 4002 to your node
3. **Check bootstrap nodes**: Verify `BOOTSTRAP_NODES` is set in `/opt/noderr/node.env`

### High Memory Usage

```bash
# Check per-process memory inside the container
docker exec noderr-node pm2 monit

# Restart a specific service
docker exec noderr-node pm2 restart <service-name>

# Restart the entire node
sudo systemctl restart noderr-node
```

### Windows-Specific Issues

- **Docker Desktop not starting**: Ensure Hyper-V is enabled in Windows Features. Run `bcdedit /set hypervisorlaunchtype auto` in an elevated command prompt and reboot.
- **WSL2 issues**: Run `wsl --update` and `wsl --set-default-version 2`
- **Windows Updates**: Disable automatic restarts during node operation. Go to Settings > Windows Update > Advanced Options > Active Hours and set your preferred hours.

---

## Security Best Practices

1. **Keep your private key secure**: Never share the contents of `/opt/noderr/node.env` or `credentials.json`
2. **Use a dedicated machine**: Run your node on a dedicated server or VPS, not your personal computer
3. **Keep the OS updated**: Regularly apply security patches to your operating system
4. **Monitor your node**: Use the monitoring stack or check logs regularly for anomalies
5. **Firewall**: Only open the ports your node needs (4001/tcp, 4002/tcp for P2P)
6. **SSH hardening** (Linux): Use key-based authentication, disable root login, change the default SSH port

---

## FAQ

**Q: How do I check my node's uptime?**
A: Run `docker exec noderr-node pm2 list` — the "uptime" column shows how long each service has been running.

**Q: How do I earn rewards?**
A: Rewards are based on uptime, performance, and consensus participation. Keep your node running 24/7 with a stable internet connection.

**Q: Can I run multiple nodes on the same machine?**
A: No. Each install token is tied to a single node identity. Running multiple nodes requires separate machines and separate licenses.

**Q: What happens if my node goes offline?**
A: Your node will be marked as offline after missing 5 consecutive heartbeats (~5 minutes). It will automatically reconnect when it comes back online. Extended downtime may affect your rewards.

**Q: How do I migrate my node to a different machine?**
A: Copy the `/opt/noderr/` directory (including `credentials.json` and `node.env`) to the new machine, install Docker, and start the node. Contact support if you need help.

**Q: What data does my node send to the network?**
A: Your node sends heartbeat metrics (CPU, memory, uptime, version) and participates in consensus rounds. No personal data is collected.
