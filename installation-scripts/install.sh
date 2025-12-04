#!/bin/bash

################################################################################
# NODERR Node Installation Script
# 
# One-click installation for NODERR nodes (Validator, Guardian, Oracle)
# 
# Usage: ./install.sh
# 
# Prerequisites:
# - Docker and Docker Compose installed
# - Bash 4.0+
# - curl
# 
# This script will:
# 1. Verify prerequisites
# 2. Validate configuration files
# 3. Create necessary directories
# 4. Start the node using Docker Compose
# 5. Verify node is running
################################################################################

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="${SCRIPT_DIR}"
DATA_DIR="${SCRIPT_DIR}/data"
LOGS_DIR="${SCRIPT_DIR}/logs"
ENV_FILE="${CONFIG_DIR}/.env"
DOCKER_COMPOSE_FILE="${CONFIG_DIR}/docker-compose.yml"

# Logging functions
log_info() {
  echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
  echo -e "${GREEN}✅ $1${NC}"
}

log_warning() {
  echo -e "${YELLOW}⚠️  $1${NC}"
}

log_error() {
  echo -e "${RED}❌ $1${NC}"
}

################################################################################
# Step 1: Verify Prerequisites
################################################################################

verify_prerequisites() {
  log_info "Verifying prerequisites..."

  # Check if Docker is installed
  if ! command -v docker &> /dev/null; then
    log_error "Docker is not installed. Please install Docker first."
    log_info "Visit: https://docs.docker.com/get-docker/"
    exit 1
  fi
  log_success "Docker is installed: $(docker --version)"

  # Check if Docker Compose is installed
  if ! command -v docker-compose &> /dev/null; then
    log_error "Docker Compose is not installed. Please install Docker Compose first."
    log_info "Visit: https://docs.docker.com/compose/install/"
    exit 1
  fi
  log_success "Docker Compose is installed: $(docker-compose --version)"

  # Check if Docker daemon is running
  if ! docker info &> /dev/null; then
    log_error "Docker daemon is not running. Please start Docker."
    exit 1
  fi
  log_success "Docker daemon is running"

  # Check if curl is installed
  if ! command -v curl &> /dev/null; then
    log_warning "curl is not installed. Some health checks may not work."
  else
    log_success "curl is installed"
  fi
}

################################################################################
# Step 2: Validate Configuration Files
################################################################################

validate_configuration() {
  log_info "Validating configuration files..."

  # Check if .env file exists
  if [ ! -f "$ENV_FILE" ]; then
    log_error ".env file not found at $ENV_FILE"
    log_info "Please ensure .env file is in the same directory as this script."
    exit 1
  fi
  log_success ".env file found"

  # Check if docker-compose.yml exists
  if [ ! -f "$DOCKER_COMPOSE_FILE" ]; then
    log_error "docker-compose.yml not found at $DOCKER_COMPOSE_FILE"
    log_info "Please ensure docker-compose.yml is in the same directory as this script."
    exit 1
  fi
  log_success "docker-compose.yml found"

  # Validate .env file has required variables
  local required_vars=("NODE_ID" "API_KEY" "API_SECRET" "NODE_TIER" "NETWORK")
  for var in "${required_vars[@]}"; do
    if ! grep -q "^${var}=" "$ENV_FILE"; then
      log_error "Required variable $var not found in .env file"
      exit 1
    fi
  done
  log_success "All required environment variables are present"

  # Extract NODE_ID and NODE_TIER for later use
  NODE_ID=$(grep "^NODE_ID=" "$ENV_FILE" | cut -d'=' -f2)
  NODE_TIER=$(grep "^NODE_TIER=" "$ENV_FILE" | cut -d'=' -f2)
  NETWORK=$(grep "^NETWORK=" "$ENV_FILE" | cut -d'=' -f2)

  log_success "Node Configuration:"
  log_info "  Node ID: ${NODE_ID:0:10}..."
  log_info "  Node Tier: $NODE_TIER"
  log_info "  Network: $NETWORK"
}

################################################################################
# Step 3: Create Necessary Directories
################################################################################

create_directories() {
  log_info "Creating necessary directories..."

  mkdir -p "$DATA_DIR"
  mkdir -p "$LOGS_DIR"

  log_success "Directories created:"
  log_info "  Data: $DATA_DIR"
  log_info "  Logs: $LOGS_DIR"

  # Set proper permissions
  chmod 755 "$DATA_DIR"
  chmod 755 "$LOGS_DIR"
}

################################################################################
# Step 4: Start Node with Docker Compose
################################################################################

start_node() {
  log_info "Starting NODERR node..."

  cd "$CONFIG_DIR"

  # Pull latest images
  log_info "Pulling latest Docker images..."
  docker-compose pull

  # Start the node
  log_info "Starting node with Docker Compose..."
  docker-compose up -d

  if [ $? -eq 0 ]; then
    log_success "Node started successfully"
  else
    log_error "Failed to start node"
    exit 1
  fi
}

################################################################################
# Step 5: Verify Node is Running
################################################################################

verify_node_running() {
  log_info "Verifying node is running..."

  # Wait for node to start
  sleep 5

  # Check if container is running
  if docker-compose ps | grep -q "noderr-node"; then
    log_success "Node container is running"
  else
    log_error "Node container is not running"
    log_info "Run 'docker-compose logs' for more information"
    exit 1
  fi

  # Check health endpoint if curl is available
  if command -v curl &> /dev/null; then
    log_info "Checking node health endpoint..."
    
    local max_attempts=30
    local attempt=0
    
    while [ $attempt -lt $max_attempts ]; do
      if curl -s http://localhost:8080/health &> /dev/null; then
        log_success "Node is healthy and responding to requests"
        return 0
      fi
      
      attempt=$((attempt + 1))
      if [ $attempt -lt $max_attempts ]; then
        log_info "Waiting for node to be ready... ($attempt/$max_attempts)"
        sleep 2
      fi
    done
    
    log_warning "Node health check timed out. Node may still be starting."
    log_info "Run 'docker-compose logs -f' to monitor startup progress"
  else
    log_warning "curl not available, skipping health check"
  fi
}

################################################################################
# Step 6: Display Next Steps
################################################################################

display_next_steps() {
  echo ""
  echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
  echo -e "${GREEN}✅ NODERR Node Installation Complete!${NC}"
  echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
  echo ""
  echo -e "${BLUE}Your node is now running:${NC}"
  echo -e "  ${YELLOW}Node ID:${NC} ${NODE_ID:0:10}..."
  echo -e "  ${YELLOW}Tier:${NC} $NODE_TIER"
  echo -e "  ${YELLOW}Network:${NC} $NETWORK"
  echo ""
  echo -e "${BLUE}Next Steps:${NC}"
  echo "  1. Monitor logs: docker-compose logs -f"
  echo "  2. Check node status: curl http://localhost:8080/health"
  echo "  3. View metrics: curl http://localhost:8081/metrics"
  echo "  4. Register on-chain: Visit https://dapp.noderr.network"
  echo "  5. Stake tokens: Ensure your wallet has minimum stake"
  echo ""
  echo -e "${BLUE}Useful Commands:${NC}"
  echo "  Start node:    docker-compose up -d"
  echo "  Stop node:     docker-compose down"
  echo "  View logs:     docker-compose logs -f"
  echo "  Node status:   docker-compose ps"
  echo "  Restart node:  docker-compose restart"
  echo ""
  echo -e "${BLUE}Support:${NC}"
  echo "  Documentation: https://docs.noderr.network"
  echo "  Discord: https://discord.gg/noderr"
  echo "  GitHub: https://github.com/noderrxyz/noderr-node-os"
  echo ""
}

################################################################################
# Main Execution
################################################################################

main() {
  echo ""
  echo -e "${BLUE}╔════════════════════════════════════════════════════════╗${NC}"
  echo -e "${BLUE}║        NODERR Node Installation Script                 ║${NC}"
  echo -e "${BLUE}║          One-Click Node Deployment                     ║${NC}"
  echo -e "${BLUE}╚════════════════════════════════════════════════════════╝${NC}"
  echo ""

  verify_prerequisites
  echo ""

  validate_configuration
  echo ""

  create_directories
  echo ""

  start_node
  echo ""

  verify_node_running
  echo ""

  display_next_steps
}

# Run main function
main

exit 0
