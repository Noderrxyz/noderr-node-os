# Bootstrap Nodes Deployment Guide

## Overview

Bootstrap nodes are critical for the P2P network to function. They serve as initial connection points for new nodes joining the network. Without bootstrap nodes, nodes cannot discover each other and the network cannot form.

## Requirements

- **Minimum 3 bootstrap nodes** for redundancy
- **Recommended 5 bootstrap nodes** for production
- **Stable public IP addresses** that don't change
- **Open ports:** TCP 4001, WebSocket 4002
- **Uptime:** 99.9%+ availability required

## Deployment Steps

### 1. Provision Servers

Deploy lightweight VMs on cloud providers:

**Recommended Specs per Bootstrap Node:**
- CPU: 2 vCPUs
- RAM: 2 GB
- Storage: 20 GB SSD
- Network: Public IP with open ports
- OS: Ubuntu 22.04 LTS

**Cloud Provider Options:**
- AWS EC2: t3.small instances
- Google Cloud: e2-small instances
- Digital Ocean: $12/month droplets
- Hetzner: CX21 instances

### 2. Install Dependencies

```bash
# SSH into each bootstrap node
ssh ubuntu@<bootstrap-node-ip>

# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Install pnpm
sudo npm install -g pnpm

# Install Docker (for containerized deployment)
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker ubuntu
```

### 3. Clone and Build

```bash
# Clone the repository
git clone https://github.com/Noderrxyz/noderr-node-os.git
cd noderr-node-os

# Install dependencies
pnpm install

# Build packages
pnpm build
```

### 4. Configure Bootstrap Node

Create `.env` file:

```bash
cat > .env << 'EOF'
NODE_ENV=production
NODE_TYPE=bootstrap
NODE_ID=bootstrap-1  # Change for each node: bootstrap-1, bootstrap-2, etc.

# P2P Configuration
P2P_LISTEN_PORT=4001
P2P_WS_PORT=4002
P2P_ANNOUNCE_ADDR=/ip4/<PUBLIC_IP>/tcp/4001

# Minimal services for bootstrap
ENABLE_TELEMETRY=true
METRICS_PORT=8080

# No trading or consensus for bootstrap nodes
ENABLE_TRADING=false
ENABLE_CONSENSUS=false
EOF
```

Replace `<PUBLIC_IP>` with the actual public IP address.

### 5. Create Bootstrap Service

Create a minimal PM2 ecosystem config for bootstrap nodes:

```javascript
// ecosystem.bootstrap.config.js
module.exports = {
  apps: [
    {
      name: 'p2p-bootstrap',
      script: 'packages/decentralized-core/dist/bootstrap.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        P2P_LISTEN_PORT: 4001,
        P2P_WS_PORT: 4002
      }
    },
    {
      name: 'telemetry',
      script: 'packages/telemetry/dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        METRICS_PORT: 8080
      }
    }
  ]
};
```

### 6. Start Bootstrap Node

```bash
# Install PM2
sudo npm install -g pm2

# Start services
pm2 start ecosystem.bootstrap.config.js

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u ubuntu --hp /home/ubuntu
```

### 7. Verify Bootstrap Node

```bash
# Check PM2 status
pm2 status

# Check logs
pm2 logs p2p-bootstrap

# Check health endpoint
curl http://localhost:8080/health

# Check P2P connectivity
netstat -tuln | grep 4001
```

### 8. Configure Firewall

```bash
# Allow P2P ports
sudo ufw allow 4001/tcp
sudo ufw allow 4002/tcp

# Allow health check port (restrict to monitoring IPs)
sudo ufw allow from <MONITORING_IP> to any port 8080

# Enable firewall
sudo ufw enable
```

## Collecting Bootstrap Multiaddrs

After all bootstrap nodes are running, collect their multiaddrs:

```bash
# On each bootstrap node, get the peer ID
pm2 logs p2p-bootstrap | grep "Peer ID:"

# Format: /ip4/<PUBLIC_IP>/tcp/4001/p2p/<PEER_ID>
```

Example multiaddrs:
```
/ip4/1.2.3.4/tcp/4001/p2p/12D3KooWBhAwkzLRBkAzzjJQ4kMJTh4RhDKYQCvYN2Xb5V6W8XYZ
/ip4/5.6.7.8/tcp/4001/p2p/12D3KooWCvXzDqN9Qj7nRkBvYZQCxYNbVwXb5V6W8XYZ9AbCdEf
/ip4/9.10.11.12/tcp/4001/p2p/12D3KooWDfGhIjKlMnOpQrStUvWxYzAbCdEfGhIjKlMnOpQrSt
```

## Update Node Configurations

Add bootstrap multiaddrs to all Oracle/Guardian/Validator node configurations:

**In `docker/validator/ecosystem.config.js` (and oracle, guardian):**

```javascript
env: {
  // ... other env vars ...
  BOOTSTRAP_NODES: '/ip4/1.2.3.4/tcp/4001/p2p/12D3KooW...,/ip4/5.6.7.8/tcp/4001/p2p/12D3KooW...,/ip4/9.10.11.12/tcp/4001/p2p/12D3KooW...'
}
```

**In `packages/decentralized-core/src/NodeCommunicationLayer.ts`:**

```typescript
// Add bootstrap configuration
const bootstrapNodes = process.env.BOOTSTRAP_NODES?.split(',') || [];

this.node = await createLibp2p({
  addresses: {
    listen: listenAddresses.length > 0 ? listenAddresses : [
      '/ip4/0.0.0.0/tcp/0',
      '/ip4/0.0.0.0/tcp/0/ws'
    ]
  },
  // ... other config ...
  services: {
    dht: kadDHT({
      clientMode: false,
      bootstrapPeers: bootstrapNodes.map(addr => multiaddr(addr))
    }) as any,
    // ... other services ...
  }
});
```

## Monitoring

Set up monitoring for bootstrap nodes:

```bash
# Install Prometheus Node Exporter
wget https://github.com/prometheus/node_exporter/releases/download/v1.7.0/node_exporter-1.7.0.linux-amd64.tar.gz
tar xvfz node_exporter-1.7.0.linux-amd64.tar.gz
sudo cp node_exporter-1.7.0.linux-amd64/node_exporter /usr/local/bin/
sudo useradd --no-create-home --shell /bin/false node_exporter
sudo chown node_exporter:node_exporter /usr/local/bin/node_exporter

# Create systemd service
sudo tee /etc/systemd/system/node_exporter.service << 'EOF'
[Unit]
Description=Node Exporter
After=network.target

[Service]
User=node_exporter
Group=node_exporter
Type=simple
ExecStart=/usr/local/bin/node_exporter

[Install]
WantedBy=multi-user.target
EOF

sudo systemd daemon-reload
sudo systemctl start node_exporter
sudo systemctl enable node_exporter
```

## Maintenance

### Update Bootstrap Nodes

```bash
cd noderr-node-os
git pull origin master
pnpm install
pnpm build
pm2 restart all
```

### Check Bootstrap Node Health

```bash
# Check peer count
curl http://localhost:8080/metrics | grep peer_count

# Check uptime
pm2 info p2p-bootstrap

# Check system resources
htop
```

### Backup Configuration

```bash
# Backup PM2 configuration
pm2 save

# Backup .env file
cp .env .env.backup
```

## Troubleshooting

### Bootstrap node not accepting connections

```bash
# Check if ports are open
sudo netstat -tuln | grep 4001
sudo netstat -tuln | grep 4002

# Check firewall
sudo ufw status

# Check logs
pm2 logs p2p-bootstrap --lines 100
```

### Nodes can't discover bootstrap

```bash
# Verify public IP is correct
curl ifconfig.me

# Test connectivity from another machine
telnet <BOOTSTRAP_IP> 4001

# Check DNS resolution
nslookup <BOOTSTRAP_DOMAIN>
```

### High memory usage

```bash
# Check memory
free -h

# Restart services
pm2 restart all

# Increase swap if needed
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

## Security Best Practices

1. **Use separate SSH keys** for each bootstrap node
2. **Enable fail2ban** to prevent brute force attacks
3. **Restrict SSH access** to known IP addresses
4. **Keep system updated** with automatic security patches
5. **Monitor logs** for suspicious activity
6. **Use firewall** to restrict unnecessary ports
7. **Backup keys** in secure offline storage

## Cost Estimate

**Monthly cost for 5 bootstrap nodes:**
- AWS: ~$60/month (5 × t3.small)
- Google Cloud: ~$50/month (5 × e2-small)
- Digital Ocean: ~$60/month (5 × $12 droplets)
- Hetzner: ~$25/month (5 × CX21)

**Recommended:** Start with 3 nodes on Hetzner for cost efficiency, scale to 5 as network grows.

## Next Steps

After bootstrap nodes are deployed:

1. Update all node configurations with bootstrap multiaddrs
2. Test P2P connectivity between nodes
3. Monitor bootstrap node metrics
4. Document bootstrap multiaddrs in main README
5. Set up automated health checks and alerts
