#!/bin/bash

# Bootstrap Node Setup Script
# This script sets up a bootstrap node on a fresh Ubuntu 22.04 server

set -e

echo "🚀 Noderr Bootstrap Node Setup"
echo "================================"
echo ""

# Check if running as root
if [ "$EUID" -eq 0 ]; then 
  echo "❌ Please do not run as root. Run as ubuntu user."
  exit 1
fi

# Get public IP
PUBLIC_IP=$(curl -s ifconfig.me)
echo "📍 Detected public IP: $PUBLIC_IP"
echo ""

# Prompt for node ID
read -p "Enter node ID (e.g., bootstrap-1): " NODE_ID
NODE_ID=${NODE_ID:-bootstrap-1}

# Prompt for region
read -p "Enter region (e.g., us-east, eu-west, ap-south): " REGION
REGION=${REGION:-us-east}

echo ""
echo "Configuration:"
echo "  Node ID: $NODE_ID"
echo "  Region: $REGION"
echo "  Public IP: $PUBLIC_IP"
echo ""

read -p "Continue with setup? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Setup cancelled."
  exit 1
fi

# Update system
echo "📦 Updating system packages..."
sudo apt update && sudo apt upgrade -y

# Install Node.js 22
echo "📦 Installing Node.js 22..."
if ! command -v node &> /dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt install -y nodejs
fi

# Install pnpm
echo "📦 Installing pnpm..."
if ! command -v pnpm &> /dev/null; then
  sudo npm install -g pnpm
fi

# Install PM2
echo "📦 Installing PM2..."
if ! command -v pm2 &> /dev/null; then
  sudo npm install -g pm2
fi

# Install Docker (optional, for future use)
echo "📦 Installing Docker..."
if ! command -v docker &> /dev/null; then
  curl -fsSL https://get.docker.com -o get-docker.sh
  sudo sh get-docker.sh
  sudo usermod -aG docker ubuntu
  rm get-docker.sh
fi

# Clone repository (if not already cloned)
if [ ! -d "noderr-node-os" ]; then
  echo "📥 Cloning noderr-node-os repository..."
  git clone https://github.com/Noderrxyz/noderr-node-os.git
fi

cd noderr-node-os

# Install dependencies
echo "📦 Installing dependencies..."
pnpm install

# Build packages
echo "🔨 Building packages..."
pnpm build

# Create logs directory
mkdir -p logs

# Create .env file
echo "📝 Creating .env file..."
cat > .env << EOF
NODE_ENV=production
NODE_TYPE=bootstrap
NODE_ID=$NODE_ID

# P2P Configuration
P2P_LISTEN_PORT=4001
P2P_WS_PORT=4002
P2P_ANNOUNCE_ADDR=/ip4/$PUBLIC_IP/tcp/4001

# Region
REGION=$REGION

# Telemetry
ENABLE_TELEMETRY=true
METRICS_PORT=8080

# Disable trading and consensus
ENABLE_TRADING=false
ENABLE_CONSENSUS=false
EOF

# Configure firewall
echo "🔒 Configuring firewall..."
sudo ufw allow 4001/tcp comment 'P2P TCP'
sudo ufw allow 4002/tcp comment 'P2P WebSocket'
sudo ufw allow 22/tcp comment 'SSH'
sudo ufw --force enable

# Start PM2 services
echo "🚀 Starting bootstrap node..."
pm2 start ecosystem.bootstrap.config.js

# Save PM2 configuration
pm2 save

# Setup PM2 startup script
echo "⚙️ Configuring PM2 to start on boot..."
pm2 startup systemd -u ubuntu --hp /home/ubuntu

echo ""
echo "✅ Bootstrap node setup complete!"
echo ""
echo "📊 Status:"
pm2 status

echo ""
echo "📝 Next steps:"
echo "1. Check logs: pm2 logs"
echo "2. Get Peer ID from logs: pm2 logs p2p-bootstrap | grep 'Peer ID'"
echo "3. Test health endpoint: curl http://localhost:8080/health"
echo "4. Share your multiaddr with the team:"
echo "   /ip4/$PUBLIC_IP/tcp/4001/p2p/<PEER_ID>"
echo ""
echo "🔧 Useful commands:"
echo "  pm2 status          - Check service status"
echo "  pm2 logs            - View logs"
echo "  pm2 restart all     - Restart services"
echo "  pm2 stop all        - Stop services"
echo ""
