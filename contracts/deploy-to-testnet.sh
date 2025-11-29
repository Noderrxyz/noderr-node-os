#!/bin/bash
set -e

echo "========================================="
echo "Noderr Smart Contract Deployment"
echo "========================================="
echo ""

# Check for required environment variables
if [ -z "$PRIVATE_KEY" ]; then
    echo "❌ ERROR: PRIVATE_KEY environment variable is required"
    echo ""
    echo "Please set your private key:"
    echo "  export PRIVATE_KEY='your_private_key_here'"
    echo ""
    exit 1
fi

if [ -z "$ALCHEMY_API_KEY" ]; then
    echo "❌ ERROR: ALCHEMY_API_KEY environment variable is required"
    echo ""
    echo "Please set your Alchemy API key:"
    echo "  export ALCHEMY_API_KEY='your_alchemy_key_here'"
    echo ""
    exit 1
fi

# Set network (default to sepolia)
NETWORK="${NETWORK:-sepolia}"
echo "Deploying to network: $NETWORK"
echo ""

# Set RPC URL based on network
if [ "$NETWORK" = "sepolia" ]; then
    export SEPOLIA_RPC_URL="https://eth-sepolia.g.alchemy.com/v2/${ALCHEMY_API_KEY}"
    RPC_URL=$SEPOLIA_RPC_URL
elif [ "$NETWORK" = "arbitrum-sepolia" ]; then
    export ARBITRUM_SEPOLIA_RPC_URL="https://arb-sepolia.g.alchemy.com/v2/${ALCHEMY_API_KEY}"
    RPC_URL=$ARBITRUM_SEPOLIA_RPC_URL
else
    echo "❌ ERROR: Unknown network: $NETWORK"
    exit 1
fi

# Get deployer address
DEPLOYER_ADDRESS=$(cast wallet address --private-key "$PRIVATE_KEY" 2>/dev/null || echo "unknown")
echo "Deployer address: $DEPLOYER_ADDRESS"
echo ""

# Check balance
echo "Checking balance..."
BALANCE=$(cast balance "$DEPLOYER_ADDRESS" --rpc-url "$RPC_URL" 2>/dev/null || echo "0")
BALANCE_ETH=$(echo "scale=4; $BALANCE / 1000000000000000000" | bc 2>/dev/null || echo "0")
echo "Balance: $BALANCE_ETH ETH"
echo ""

if [ "$BALANCE" = "0" ]; then
    echo "⚠️  WARNING: Deployer has 0 ETH balance"
    echo ""
    echo "Get testnet ETH from:"
    if [ "$NETWORK" = "sepolia" ]; then
        echo "  - https://sepoliafaucet.com"
        echo "  - https://www.alchemy.com/faucets/ethereum-sepolia"
    else
        echo "  - https://www.alchemy.com/faucets/arbitrum-sepolia"
    fi
    echo ""
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Navigate to contracts directory
cd /home/ubuntu/noderr-node-os/contracts

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    pnpm install --ignore-scripts
    echo ""
fi

# Compile contracts
echo "Compiling contracts..."
npx hardhat compile
echo ""

# Deploy contracts
echo "========================================="
echo "DEPLOYING CONTRACTS"
echo "========================================="
echo ""

npx hardhat run scripts/deploy.ts --network "$NETWORK"

# Save deployment info
DEPLOYMENT_FILE="deployments/${NETWORK}-$(date +%Y%m%d-%H%M%S).json"
mkdir -p deployments

if [ -f "deployment-info.json" ]; then
    cp deployment-info.json "$DEPLOYMENT_FILE"
    echo ""
    echo "Deployment info saved to: $DEPLOYMENT_FILE"
    
    # Extract contract addresses
    NODE_NFT=$(jq -r '.contracts.NodeNFT' deployment-info.json 2>/dev/null || echo "unknown")
    ORACLE_VERIFIER=$(jq -r '.contracts.OracleVerifier' deployment-info.json 2>/dev/null || echo "unknown")
    GOVERNANCE=$(jq -r '.contracts.GovernanceVoting' deployment-info.json 2>/dev/null || echo "unknown")
    
    echo ""
    echo "========================================="
    echo "DEPLOYMENT SUMMARY"
    echo "========================================="
    echo "Network:           $NETWORK"
    echo "Deployer:          $DEPLOYER_ADDRESS"
    echo ""
    echo "Contract Addresses:"
    echo "  NodeNFT:          $NODE_NFT"
    echo "  OracleVerifier:   $ORACLE_VERIFIER"
    echo "  GovernanceVoting: $GOVERNANCE"
    echo ""
    echo "View on Explorer:"
    if [ "$NETWORK" = "sepolia" ]; then
        echo "  https://sepolia.etherscan.io/address/$NODE_NFT"
        echo "  https://sepolia.etherscan.io/address/$ORACLE_VERIFIER"
        echo "  https://sepolia.etherscan.io/address/$GOVERNANCE"
    else
        echo "  https://sepolia.arbiscan.io/address/$NODE_NFT"
        echo "  https://sepolia.arbiscan.io/address/$ORACLE_VERIFIER"
        echo "  https://sepolia.arbiscan.io/address/$GOVERNANCE"
    fi
    echo ""
    
    # Create .env file for node software
    cat > ../docker/.env.contracts << EOF
# Deployed Contract Addresses - $NETWORK
# Generated: $(date)

NODE_NFT_ADDRESS=$NODE_NFT
ORACLE_VERIFIER_ADDRESS=$ORACLE_VERIFIER
GOVERNANCE_VOTING_ADDRESS=$GOVERNANCE
NETWORK=$NETWORK
RPC_URL=$RPC_URL
EOF
    
    echo "Contract addresses saved to docker/.env.contracts"
    echo ""
fi

echo "========================================="
echo "✅ DEPLOYMENT COMPLETE"
echo "========================================="
