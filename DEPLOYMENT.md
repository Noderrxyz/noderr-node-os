# Noderr Node OS - Production Deployment Guide

## Overview

This guide provides comprehensive instructions for deploying Noderr Node OS to production VMs with PhD-level operational excellence.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Nginx (Load Balancer)                │
│                         Port 80/443                          │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────┴────────────────────────────────────┐
│                    Node.js Runtime                           │
│                    Port 8080, 50052                          │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Risk Engine │ Execution │ Oracle │ Compliance │ ...  │  │
│  └──────────────────────────────────────────────────────┘  │
└──────────┬─────────────────────────┬────────────────────────┘
           │                         │
┌──────────┴──────────┐   ┌─────────┴──────────┐
│  PostgreSQL         │   │  PyTorch ML Service │
│  Port 5432          │   │  gRPC Port 50051    │
│  ┌──────────────┐   │   │  ┌──────────────┐  │
│  │ Trading      │   │   │  │ Transformer  │  │
│  │ Consensus    │   │   │  │ GAF-CNN      │  │
│  │ Governance   │   │   │  │ 94 Features  │  │
│  │ Analytics    │   │   │  └──────────────┘  │
│  └──────────────┘   │   └────────────────────┘
└─────────────────────┘
           │
┌──────────┴──────────┐
│  Redis Cache        │
│  Port 6379          │
└─────────────────────┘
```

## System Requirements

### Minimum Requirements
- **CPU**: 4 cores
- **RAM**: 8 GB
- **Storage**: 100 GB SSD
- **OS**: Ubuntu 22.04 LTS or Debian 11+
- **Network**: 100 Mbps

### Recommended Requirements
- **CPU**: 8+ cores
- **RAM**: 16+ GB
- **Storage**: 500+ GB NVMe SSD
- **OS**: Ubuntu 22.04 LTS
- **Network**: 1 Gbps

## Quick Start

### 1. One-Command Deployment

```bash
curl -fsSL https://raw.githubusercontent.com/Noderrxyz/noderr-work/master/deployment/scripts/deploy-vm.sh | sudo bash
```

### 2. Manual Deployment

```bash
# Clone repository
git clone https://github.com/Noderrxyz/noderr-work.git
cd noderr-work

# Run deployment script
sudo ./deployment/scripts/deploy-vm.sh
```

### 3. Setup Node

```bash
# Configure node identity and stake
sudo ./deployment/scripts/setup-node.sh
```

## Deployment Steps

### Step 1: System Preparation

```bash
# Update system
sudo apt-get update && sudo apt-get upgrade -y

# Install dependencies
sudo apt-get install -y curl git make jq
```

### Step 2: Install Docker

```bash
# Install Docker
curl -fsSL https://get.docker.com | sudo bash

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/download/v2.24.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
```

### Step 3: Clone and Configure

```bash
# Clone repository
git clone https://github.com/Noderrxyz/noderr-work.git /opt/noderr
cd /opt/noderr

# Configure environment
cp .env.example .env
nano .env  # Edit configuration
```

### Step 4: Deploy Services

```bash
# Build images
make build

# Start services
make up

# Check health
make health
```

## Configuration

### Environment Variables

Edit `.env` file:

```bash
# Database
POSTGRES_PASSWORD=your_secure_password_here

# Security
JWT_SECRET=your_jwt_secret_here
ENCRYPTION_KEY=your_encryption_key_here

# Network
NETWORK_ID=noderr-mainnet
NODE_TYPE=validator
STAKE_AMOUNT=1000

# ML Service
ML_SERVICE_HOST=ml-service
ML_SERVICE_PORT=50051

# Features
ENABLE_ML=true
ENABLE_GOVERNANCE=true
ENABLE_AUTO_TRADING=false
```

### Firewall Configuration

```bash
# Allow required ports
sudo ufw allow 22/tcp   # SSH
sudo ufw allow 80/tcp   # HTTP
sudo ufw allow 443/tcp  # HTTPS
sudo ufw allow 50052/tcp # P2P
sudo ufw enable
```

## Operations

### Service Management

```bash
# Start services
make up

# Stop services
make down

# Restart services
make restart

# View logs
make logs

# View specific service logs
make logs-node
make logs-ml
make logs-db

# Check service status
make ps

# Check health
make health
```

### Database Operations

```bash
# Access database
make shell-db

# Backup database
make backup-db

# Restore database
make restore-db FILE=backup.sql
```

### Monitoring

```bash
# View resource usage
make stats

# Monitor services
noderr-monitor

# View logs
tail -f /var/log/noderr/node/app.log
```

## Maintenance

### Updates

```bash
cd /opt/noderr
git pull origin master
make build
make restart
```

### Backups

```bash
# Automated daily backups
(crontab -l 2>/dev/null; echo "0 2 * * * cd /opt/noderr && make backup-db") | crontab -

# Manual backup
make backup-db
```

### Cleanup

```bash
# Remove old images
docker image prune -a

# Remove old logs
find /var/log/noderr -name "*.log" -mtime +30 -delete
```

## Troubleshooting

### Services Won't Start

```bash
# Check logs
make logs

# Check Docker status
sudo systemctl status docker

# Restart Docker
sudo systemctl restart docker
make restart
```

### Database Connection Issues

```bash
# Check PostgreSQL status
make shell-db

# Check connection
docker-compose exec postgres pg_isready -U noderr

# Reset database (WARNING: deletes data)
make clean-volumes
make up
```

### ML Service Not Responding

```bash
# Check ML service logs
make logs-ml

# Restart ML service
docker-compose restart ml-service

# Check gRPC connection
docker-compose exec node-runtime nc -zv ml-service 50051
```

### High Resource Usage

```bash
# Check resource usage
make stats

# Limit resources in docker-compose.yml
# Edit deploy.resources.limits sections

# Restart with new limits
make restart
```

## Security

### Best Practices

1. **Change default passwords** in `.env`
2. **Enable firewall** with UFW
3. **Use SSH keys** instead of passwords
4. **Keep system updated** regularly
5. **Monitor logs** for suspicious activity
6. **Backup regularly** to secure location
7. **Use HTTPS** with valid SSL certificates

### SSL/TLS Setup

```bash
# Install certbot
sudo apt-get install certbot

# Get certificate
sudo certbot certonly --standalone -d your-domain.com

# Update nginx config to use certificates
# Edit docker/nginx/nginx.conf
```

## Performance Tuning

### Database Optimization

```sql
-- Connect to database
make shell-db

-- Analyze tables
ANALYZE;

-- Vacuum database
VACUUM ANALYZE;

-- Check index usage
SELECT schemaname, tablename, indexname, idx_scan
FROM pg_stat_user_indexes
ORDER BY idx_scan;
```

### Docker Optimization

```bash
# Increase Docker resources
# Edit /etc/docker/daemon.json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  "default-ulimits": {
    "nofile": {
      "Name": "nofile",
      "Hard": 64000,
      "Soft": 64000
    }
  }
}

# Restart Docker
sudo systemctl restart docker
```

## Monitoring & Observability

### Metrics

Access Prometheus metrics at:
- Node Runtime: `http://localhost:9090/metrics`
- ML Service: `http://localhost:9091/metrics`

### Health Checks

```bash
# Overall health
curl http://localhost/health

# Node runtime health
curl http://localhost:8080/health

# Database health
docker-compose exec postgres pg_isready

# Redis health
docker-compose exec redis redis-cli ping
```

### Logs

Logs are stored in `/var/log/noderr/`:
- `node/` - Node runtime logs
- `ml/` - ML service logs
- `nginx/` - Nginx access and error logs
- `postgres/` - Database logs

## Scaling

### Horizontal Scaling

Deploy multiple nodes:

```bash
# Node 1
./deploy-vm.sh
./setup-node.sh

# Node 2 (on different VM)
./deploy-vm.sh
./setup-node.sh

# Nodes will automatically discover each other via P2P
```

### Vertical Scaling

```bash
# Increase resources in docker-compose.yml
# Edit deploy.resources sections

# Restart services
make restart
```

## Support

For issues or questions:
- GitHub Issues: https://github.com/Noderrxyz/noderr-work/issues
- Documentation: https://docs.noderr.xyz
- Discord: https://discord.gg/noderr

## License

Copyright © 2024 Noderr Protocol. All rights reserved.
