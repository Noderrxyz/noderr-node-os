# Quick Start - When You're Ready

## Copy-Paste These Commands

### 1. Set Your Credentials (REQUIRED)

```bash
# Replace with your actual values
export PRIVATE_KEY="0xYOUR_PRIVATE_KEY_HERE"
export ALCHEMY_API_KEY="YOUR_ALCHEMY_KEY_HERE"
export WALLET_ADDRESS="0xYOUR_WALLET_ADDRESS_HERE"
```

### 2. Deploy Smart Contracts (~10 minutes)

```bash
cd /home/ubuntu/noderr-node-os/contracts
./deploy-to-testnet.sh
```

**What this does**:
- ✅ Checks your balance
- ✅ Compiles contracts
- ✅ Deploys NodeNFT, OracleVerifier, GovernanceVoting
- ✅ Verifies on Etherscan
- ✅ Saves addresses to `docker/.env.contracts`

### 3. Build Docker Images (~30 minutes)

```bash
cd /home/ubuntu/noderr-node-os
sudo ./docker/build-all.sh
```

**What this does**:
- ✅ Builds base image
- ✅ Builds oracle image (ML nodes)
- ✅ Builds guardian image (consensus nodes)
- ✅ Builds all-in-one image (testing)
- ✅ Exports to tar.gz files

### 4. Test Locally (~5 minutes)

```bash
# Load contract addresses
source /home/ubuntu/noderr-node-os/docker/.env.contracts

# Run test oracle node
sudo docker run -d \
  --name test-oracle \
  -e NODE_ID=test-oracle-001 \
  -e DEPLOYMENT_ENGINE_URL=http://localhost:8080 \
  -e NODE_NFT_ADDRESS=$NODE_NFT_ADDRESS \
  -e ORACLE_VERIFIER_ADDRESS=$ORACLE_VERIFIER_ADDRESS \
  -e GOVERNANCE_VOTING_ADDRESS=$GOVERNANCE_VOTING_ADDRESS \
  -e RPC_URL=https://eth-sepolia.g.alchemy.com/v2/$ALCHEMY_API_KEY \
  -e WALLET_PRIVATE_KEY=$PRIVATE_KEY \
  -p 3000:3000 \
  -p 9090:9090 \
  noderr-oracle:latest

# Check if it's running
sudo docker logs -f test-oracle
```

### 5. Deploy to Google Cloud (~45 minutes)

```bash
cd /home/ubuntu/noderr-node-os/deployment

# Configure (optional, defaults are fine)
export GCP_PROJECT_ID="noderr-testnet"
export GCP_REGION="us-central1"
export GCP_ZONE="us-central1-a"
export ORACLE_COUNT=3
export GUARDIAN_COUNT=2
export VALIDATOR_COUNT=1

# Deploy
./gcp-deploy.sh
```

**What this does**:
- ✅ Creates 3 Oracle VMs (4 vCPU, 16GB RAM each)
- ✅ Creates 2 Guardian VMs (2 vCPU, 8GB RAM each)
- ✅ Creates 1 Validator VM (2 vCPU, 8GB RAM)
- ✅ Installs Docker on all VMs
- ✅ Pulls and runs node images
- ✅ Configures networking and firewall

### 6. Verify Everything Works (~10 minutes)

```bash
# List all nodes
gcloud compute instances list --filter="tags.items=noderr-node"

# SSH to oracle node
gcloud compute ssh noderr-oracle-1 --zone=us-central1-a

# Inside the VM:
sudo docker ps
sudo docker logs noderr-node
curl http://localhost:9090/metrics

# Exit VM
exit
```

---

## Before You Start

### Get Testnet ETH
- Minimum: **0.5 ETH** on Sepolia
- Faucets:
  - https://sepoliafaucet.com
  - https://www.alchemy.com/faucets/ethereum-sepolia

### Get Alchemy API Key
- Sign up: https://dashboard.alchemy.com/
- Create app: Ethereum → Sepolia
- Copy API key

### Prepare Your Wallet
- Export private key from MetaMask or your wallet
- Format: `0x...` (64 hex characters)

---

## Expected Results

### After Step 2 (Smart Contracts)
```
========================================
DEPLOYMENT SUMMARY
========================================
Network:           sepolia
Deployer:          0xYourAddress

Contract Addresses:
  NodeNFT:          0x...
  OracleVerifier:   0x...
  GovernanceVoting: 0x...
```

### After Step 3 (Docker Build)
```
========================================
BUILD SUMMARY
========================================
Succeeded: 4/4
Failed:    0/4

Built images:
noderr-base:1.0.0
noderr-oracle:1.0.0
noderr-guardian:1.0.0
noderr-all:1.0.0
```

### After Step 5 (GCP Deployment)
```
========================================
DEPLOYMENT SUMMARY
========================================

Deployed instances:
NAME               ZONE           MACHINE_TYPE   STATUS   EXTERNAL_IP
noderr-oracle-1    us-central1-a  n2-standard-4  RUNNING  34.x.x.x
noderr-oracle-2    us-central1-a  n2-standard-4  RUNNING  34.x.x.x
noderr-oracle-3    us-central1-a  n2-standard-4  RUNNING  34.x.x.x
noderr-guardian-1  us-central1-a  n2-standard-2  RUNNING  34.x.x.x
noderr-guardian-2  us-central1-a  n2-standard-2  RUNNING  34.x.x.x
noderr-validator-1 us-central1-a  n2-standard-2  RUNNING  34.x.x.x
```

---

## Troubleshooting

### "Insufficient funds for gas"
```bash
# Check balance
cast balance $WALLET_ADDRESS --rpc-url https://eth-sepolia.g.alchemy.com/v2/$ALCHEMY_API_KEY

# Get more testnet ETH from faucets
```

### "Docker build fails"
```bash
# Check disk space
df -h

# Clean up if needed
sudo docker system prune -a
```

### "GCP authentication failed"
```bash
# Login to GCP
gcloud auth login

# Set project
gcloud config set project noderr-testnet
```

### "Node won't start"
```bash
# Check logs
sudo docker logs noderr-node

# Check if ports are available
sudo netstat -tulpn | grep -E '3000|9090'
```

---

## Timeline

| Step | Duration | Can Run in Background |
|------|----------|----------------------|
| 1. Set credentials | 1 min | ❌ |
| 2. Deploy contracts | 10 min | ❌ |
| 3. Build Docker images | 30 min | ✅ Yes |
| 4. Test locally | 5 min | ❌ |
| 5. Deploy to GCP | 45 min | ✅ Yes |
| 6. Verify | 10 min | ❌ |
| **Total** | **~100 min** | |

**Actual hands-on time**: ~30 minutes  
**Waiting time**: ~70 minutes (builds/deployments)

---

## What You'll Have After This

1. ✅ **Smart contracts deployed** on Sepolia testnet
2. ✅ **6 nodes running** on Google Cloud (3 Oracle, 2 Guardian, 1 Validator)
3. ✅ **Decentralized network** forming consensus automatically
4. ✅ **Monitoring active** with Prometheus and alerts
5. ✅ **Ready to test** ML predictions and trading

---

## Next Actions After Deployment

### Test the System
```bash
# Submit test ML prediction (from any node)
curl -X POST http://34.x.x.x:3000/api/predictions \
  -H "Content-Type: application/json" \
  -d '{"signal": "BUY", "confidence": 0.95, "asset": "ETH/USD"}'

# Check consensus status
curl http://34.x.x.x:3000/api/consensus/status

# View metrics
curl http://34.x.x.x:9090/metrics
```

### Approve First Node Operator
```bash
# Using cast (Foundry)
cast send $NODE_NFT_ADDRESS \
  "approveOperator(address)" \
  0xOperatorAddress \
  --private-key $PRIVATE_KEY \
  --rpc-url https://eth-sepolia.g.alchemy.com/v2/$ALCHEMY_API_KEY
```

### Monitor the Network
```bash
# SSH to monitoring node (if deployed)
gcloud compute ssh noderr-monitoring --zone=us-central1-a

# Access Grafana
# Open browser: http://monitoring-ip:3000
```

---

## Support

If anything doesn't work:
1. Check the logs: `sudo docker logs noderr-node`
2. Check the troubleshooting section above
3. Review full documentation: `DEPLOYMENT_READY_HANDOFF.md`

---

**Ready to go?** Just paste the commands above when you have your credentials!
