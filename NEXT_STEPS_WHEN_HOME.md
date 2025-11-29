# Next Steps - When You Get Home

**Smart Contracts**: ✅ DEPLOYED to Base Sepolia  
**Docker Images**: ⏳ Ready to build on your machine  
**Node Deployment**: ⏳ Ready to deploy to Google Cloud

---

## What's Already Done ✅

### 1. Smart Contracts Deployed & Verified
All three contracts are live on Base Sepolia:

- **NodeNFT**: `0xEEE9178415A6b44916cbeF81de9Df2A4eEC735EE`
- **OracleVerifier**: `0xf27e9DbBBFB520b8B4B25302cC5571BAE5397D9B`
- **GovernanceVoting**: `0x6257ed4Fae49e504bf9a8ad9269909aCFcB9dBba`

View on Basescan:
- https://sepolia.basescan.org/address/0xEEE9178415A6b44916cbeF81de9Df2A4eEC735EE
- https://sepolia.basescan.org/address/0xf27e9DbBBFB520b8B4B25302cC5571BAE5397D9B
- https://sepolia.basescan.org/address/0x6257ed4Fae49e504bf9a8ad9269909aCFcB9dBba

### 2. Code Pushed to GitHub
Repository: https://github.com/Noderrxyz/noderr-node-os  
Latest commit: `d9ec0c2` - "✅ DEPLOYED TO BASE SEPOLIA"

### 3. Docker Infrastructure Ready
All Dockerfiles and build scripts are ready in the repo.

---

## What To Do When You Get Home

### Option A: Build Docker Images Locally (Recommended First)

#### 1. Clone the Repository
```bash
git clone https://github.com/Noderrxyz/noderr-node-os.git
cd noderr-node-os
```

#### 2. Build Docker Images
```bash
# Build all images (takes ~30 minutes)
sudo ./docker/build-all.sh

# Or build individually:
sudo docker build -f docker/base/Dockerfile -t noderr-base:1.0.0 .
sudo docker build -f docker/oracle/Dockerfile -t noderr-oracle:1.0.0 .
sudo docker build -f docker/guardian/Dockerfile -t noderr-guardian:1.0.0 .
```

#### 3. Test Locally
```bash
# Load contract addresses
source docker/.env.contracts

# Run test oracle node
sudo docker run -d \
  --name test-oracle \
  -e NODE_ID=test-oracle-001 \
  -e DEPLOYMENT_ENGINE_URL=http://localhost:8080 \
  -e NODE_NFT_ADDRESS=$NODE_NFT_ADDRESS \
  -e ORACLE_VERIFIER_ADDRESS=$ORACLE_VERIFIER_ADDRESS \
  -e GOVERNANCE_VOTING_ADDRESS=$GOVERNANCE_VOTING_ADDRESS \
  -e RPC_URL=$RPC_URL \
  -e WALLET_PRIVATE_KEY=0xdeebadc49d97d7967af1a08a05725b830cbd9a8d76ccb0bd75a1a28846b0788b \
  -p 3000:3000 \
  -p 9090:9090 \
  noderr-oracle:1.0.0

# Check logs
sudo docker logs -f test-oracle

# Check health
curl http://localhost:3000/health
curl http://localhost:9090/metrics
```

### Option B: Deploy to Google Cloud

#### 1. Install Google Cloud SDK
```bash
# On macOS
brew install google-cloud-sdk

# On Linux
curl https://sdk.cloud.google.com | bash
exec -l $SHELL
```

#### 2. Authenticate
```bash
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
```

#### 3. Build Images in Google Cloud Build
```bash
cd noderr-node-os

# Build oracle image
gcloud builds submit \
  --tag gcr.io/YOUR_PROJECT_ID/noderr-oracle:1.0.0 \
  --dockerfile docker/oracle/Dockerfile \
  .

# Build guardian image
gcloud builds submit \
  --tag gcr.io/YOUR_PROJECT_ID/noderr-guardian:1.0.0 \
  --dockerfile docker/guardian/Dockerfile \
  .
```

#### 4. Deploy Nodes
```bash
# Set environment variables
export GCP_PROJECT_ID="your-project-id"
export ORACLE_COUNT=3
export GUARDIAN_COUNT=2

# Deploy
./deployment/gcp-deploy.sh
```

---

## Testing the Smart Contracts

### 1. Approve Yourself as First Operator
```bash
# Install Foundry if not already installed
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Approve yourself
cast send 0xEEE9178415A6b44916cbeF81de9Df2A4eEC735EE \
  "approveOperator(address)" \
  0x92977F6452431D4C06B1d7Afd9D03db5e98fa2C6 \
  --private-key 0xdeebadc49d97d7967af1a08a05725b830cbd9a8d76ccb0bd75a1a28846b0788b \
  --rpc-url https://base-sepolia.g.alchemy.com/v2/Z6Vsdc0TcuwUWBvlIzOqT
```

### 2. Mint Your First Node NFT
```bash
# Mint Oracle node (requires 1000 ETH stake on mainnet, but we can test with less on testnet)
cast send 0xEEE9178415A6b44916cbeF81de9Df2A4eEC735EE \
  "mintNode(address,uint8,uint256)" \
  0x92977F6452431D4C06B1d7Afd9D03db5e98fa2C6 \
  0 \
  1 \
  --value 0.01ether \
  --private-key 0xdeebadc49d97d7967af1a08a05725b830cbd9a8d76ccb0bd75a1a28846b0788b \
  --rpc-url https://base-sepolia.g.alchemy.com/v2/Z6Vsdc0TcuwUWBvlIzOqT
```

### 3. Activate Your Node
```bash
# Activate node with hardware hash
cast send 0xEEE9178415A6b44916cbeF81de9Df2A4eEC735EE \
  "activateNode(uint256,string)" \
  1 \
  "test_hardware_hash_123" \
  --private-key 0xdeebadc49d97d7967af1a08a05725b830cbd9a8d76ccb0bd75a1a28846b0788b \
  --rpc-url https://base-sepolia.g.alchemy.com/v2/Z6Vsdc0TcuwUWBvlIzOqT
```

### 4. Check Node Eligibility
```bash
# Check if node is eligible
cast call 0xEEE9178415A6b44916cbeF81de9Df2A4eEC735EE \
  "isNodeEligible(uint256)" \
  1 \
  --rpc-url https://base-sepolia.g.alchemy.com/v2/Z6Vsdc0TcuwUWBvlIzOqT
```

---

## Environment Variables Reference

All contract addresses are saved in `docker/.env.contracts`:

```bash
NODE_NFT_ADDRESS=0xEEE9178415A6b44916cbeF81de9Df2A4eEC735EE
ORACLE_VERIFIER_ADDRESS=0xf27e9DbBBFB520b8B4B25302cC5571BAE5397D9B
GOVERNANCE_VOTING_ADDRESS=0x6257ed4Fae49e504bf9a8ad9269909aCFcB9dBba
NETWORK=base-sepolia
CHAIN_ID=84532
RPC_URL=https://base-sepolia.g.alchemy.com/v2/Z6Vsdc0TcuwUWBvlIzOqT
```

Your wallet:
```bash
PRIVATE_KEY=0xdeebadc49d97d7967af1a08a05725b830cbd9a8d76ccb0bd75a1a28846b0788b
WALLET_ADDRESS=0x92977F6452431D4C06B1d7Afd9D03db5e98fa2C6
```

---

## Troubleshooting

### Docker Build Fails
**Issue**: "Cannot connect to Docker daemon"
**Solution**: 
```bash
# Start Docker daemon
sudo systemctl start docker

# Or on macOS
open -a Docker
```

### GCP Authentication Fails
**Issue**: "gcloud: command not found"
**Solution**:
```bash
# Install gcloud
curl https://sdk.cloud.google.com | bash
exec -l $SHELL
gcloud init
```

### Contract Interaction Fails
**Issue**: "Insufficient funds"
**Solution**:
```bash
# Get more testnet ETH
# Base Sepolia faucet: https://www.alchemy.com/faucets/base-sepolia

# Check balance
cast balance 0x92977F6452431D4C06B1d7Afd9D03db5e98fa2C6 \
  --rpc-url https://base-sepolia.g.alchemy.com/v2/Z6Vsdc0TcuwUWBvlIzOqT
```

---

## Quick Reference Commands

### Check Contract Status
```bash
# NodeNFT name
cast call 0xEEE9178415A6b44916cbeF81de9Df2A4eEC735EE "name()" \
  --rpc-url https://base-sepolia.g.alchemy.com/v2/Z6Vsdc0TcuwUWBvlIzOqT

# Total nodes minted
cast call 0xEEE9178415A6b44916cbeF81de9Df2A4eEC735EE "totalSupply()" \
  --rpc-url https://base-sepolia.g.alchemy.com/v2/Z6Vsdc0TcuwUWBvlIzOqT

# Consensus threshold
cast call 0xf27e9DbBBFB520b8B4B25302cC5571BAE5397D9B "consensusThreshold()" \
  --rpc-url https://base-sepolia.g.alchemy.com/v2/Z6Vsdc0TcuwUWBvlIzOqT
```

### Docker Commands
```bash
# List images
sudo docker images | grep noderr

# List running containers
sudo docker ps

# Stop container
sudo docker stop test-oracle

# Remove container
sudo docker rm test-oracle

# View logs
sudo docker logs -f test-oracle

# Execute command in container
sudo docker exec -it test-oracle sh
```

### GCP Commands
```bash
# List instances
gcloud compute instances list --filter="tags.items=noderr-node"

# SSH to instance
gcloud compute ssh noderr-oracle-1 --zone=us-central1-a

# View logs
gcloud compute ssh noderr-oracle-1 --zone=us-central1-a \
  --command="sudo docker logs noderr-node"

# Stop instance
gcloud compute instances stop noderr-oracle-1 --zone=us-central1-a

# Delete instance
gcloud compute instances delete noderr-oracle-1 --zone=us-central1-a
```

---

## Timeline Estimate

### Local Testing (1-2 hours)
1. Clone repo: 5 minutes
2. Build Docker images: 30-45 minutes
3. Test locally: 15-30 minutes
4. Verify contracts: 15-30 minutes

### Google Cloud Deployment (2-3 hours)
1. Setup GCP: 30 minutes
2. Build images in GCP: 45 minutes
3. Deploy nodes: 45 minutes
4. Verify deployment: 30 minutes

**Total**: 3-5 hours from home to fully deployed system

---

## What You'll Have After This

1. ✅ **Smart contracts live** on Base Sepolia
2. ✅ **Docker images built** and tested locally
3. ✅ **6 nodes running** on Google Cloud (3 Oracle, 2 Guardian, 1 Validator)
4. ✅ **Decentralized network** forming consensus
5. ✅ **Monitoring active** with Prometheus
6. ✅ **Ready to onboard** node operators

---

## Support Files

All documentation is in the repository:
- `DEPLOYMENT_COMPLETE.md` - Deployment summary
- `QUICK_START.md` - Quick commands
- `DEPLOYMENT_READY_HANDOFF.md` - Complete guide
- `docker/.env.contracts` - Contract addresses
- `contracts/DEPLOYMENT_GUIDE.md` - Contract deployment details

---

**Status**: Smart contracts deployed ✅  
**Next**: Build Docker images when you get home  
**Timeline**: 3-5 hours to fully deployed system  
**Support**: All documentation in GitHub repo
