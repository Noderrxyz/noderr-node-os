#!/bin/bash
set -euo pipefail

# Noderr Node Setup Script
# Configures a new node in the network

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Configuration
NODE_DIR="${NODE_DIR:-/opt/noderr}"
NODE_ID=""
STAKE_AMOUNT="${STAKE_AMOUNT:-1000}"
NETWORK="${NETWORK:-mainnet}"

generate_node_id() {
    log_info "Generating node ID..."
    
    # Generate Ed25519 keypair
    NODE_ID=$(openssl rand -hex 32)
    PRIVATE_KEY=$(openssl rand -hex 32)
    
    # Save keys securely
    mkdir -p "$NODE_DIR/keys"
    chmod 700 "$NODE_DIR/keys"
    
    echo "$NODE_ID" > "$NODE_DIR/keys/node_id"
    echo "$PRIVATE_KEY" > "$NODE_DIR/keys/private_key"
    
    chmod 600 "$NODE_DIR/keys"/*
    
    log_info "Node ID: $NODE_ID"
}

configure_node() {
    log_info "Configuring node..."
    
    cd "$NODE_DIR"
    
    # Update .env with node configuration
    cat >> .env <<EOF

# Node Configuration
NODE_ID=$NODE_ID
STAKE_AMOUNT=$STAKE_AMOUNT
NETWORK=$NETWORK
NODE_TYPE=validator
EOF
    
    log_info "Node configured"
}

register_node() {
    log_info "Registering node with network..."
    
    # This would interact with the blockchain to register the node
    # For now, just log the information
    
    log_info "Node registration information:"
    echo "  Node ID: $NODE_ID"
    echo "  Stake: $STAKE_AMOUNT"
    echo "  Network: $NETWORK"
    echo ""
    echo "To complete registration, run:"
    echo "  curl -X POST http://localhost:8080/api/nodes/register \\"
    echo "    -H 'Content-Type: application/json' \\"
    echo "    -d '{\"nodeId\": \"$NODE_ID\", \"stake\": $STAKE_AMOUNT}'"
}

main() {
    log_info "Setting up Noderr node..."
    
    if [[ ! -d "$NODE_DIR" ]]; then
        log_error "Noderr not installed. Run deploy-vm.sh first."
        exit 1
    fi
    
    generate_node_id
    configure_node
    register_node
    
    log_info "Node setup complete!"
}

main "$@"
