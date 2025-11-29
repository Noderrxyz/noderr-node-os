# Project Phoenix - Deployment Complete ✅

**Date**: $(date)  
**Network**: Base Sepolia (Chain ID: 84532)  
**Deployer**: 0x92977F6452431D4C06B1d7Afd9D03db5e98fa2C6

---

## Smart Contracts Deployed ✅

All three contracts successfully deployed and verified on Base Sepolia:

### 1. NodeNFT - NFT-Based Node Licensing
**Address**: `0xEEE9178415A6b44916cbeF81de9Df2A4eEC735EE`  
**Explorer**: https://sepolia.basescan.org/address/0xEEE9178415A6b44916cbeF81de9Df2A4eEC735EE  
**Verification**: ✅ Verified on Sourcify

**Features**:
- NFT-based node operator licenses
- Three node types: Oracle, Guardian, Validator
- Three tiers: Bronze, Silver, Gold
- Staking requirements: 1000/500/250 ETH
- Hardware verification system
- Activation workflow

**Key Functions**:
```solidity
function approveOperator(address operator) external
function mintNode(address to, NodeType nodeType, uint256 tier) external payable
function activateNode(uint256 tokenId, string calldata hardwareHash) external
function isNodeEligible(uint256 tokenId) external view returns (bool)
```

### 2. OracleVerifier - BFT Consensus Verification
**Address**: `0xf27e9DbBBFB520b8B4B25302cC5571BAE5397D9B`  
**Explorer**: https://sepolia.basescan.org/address/0xf27e9DbBBFB520b8B4B25302cC5571BAE5397D9B  
**Verification**: ✅ Verified on Sourcify

**Features**:
- 67% Byzantine Fault Tolerant consensus threshold
- Weighted voting based on stake
- ECDSA signature verification
- Slashing mechanism for malicious oracles
- 60-second signal age limit

**Key Functions**:
```solidity
function registerOracle(address oracle, uint256 weight) external payable
function verifyConsensus(bytes32 signalHash, address[] calldata signers, bytes[] calldata signatures) external
function slashOracle(address oracle, uint256 amount, string calldata reason) external
function isSignalVerified(bytes32 signalHash) external view returns (bool)
```

### 3. GovernanceVoting - Decentralized Governance
**Address**: `0x6257ed4Fae49e504bf9a8ad9269909aCFcB9dBba`  
**Explorer**: https://sepolia.basescan.org/address/0x6257ed4Fae49e504bf9a8ad9269909aCFcB9dBba  
**Verification**: ✅ Verified on Sourcify

**Features**:
- NFT-based voting rights
- Quadratic voting (prevents whale dominance)
- 40% quorum requirement
- 7-day voting period (~50,400 blocks)
- Five proposal types

**Key Functions**:
```solidity
function propose(ProposalType proposalType, string calldata description, bytes calldata callData) external
function castVote(uint256 proposalId, bool support) external
function execute(uint256 proposalId) external
function getProposal(uint256 proposalId) external view returns (Proposal memory)
```

---

## Deployment Details

### Gas Usage
- **Total Gas Used**: 13,028,501 gas
- **Gas Price**: 0.000984654 gwei
- **Total Cost**: 0.000012828565623654 ETH (~$0.04)

### Verification
All contracts verified on Sourcify:
- NodeNFT: `exact_match` ✅
- OracleVerifier: `exact_match` ✅
- GovernanceVoting: `exact_match` ✅

### Transaction Details
Saved to: `/home/ubuntu/noderr-node-os/contracts/broadcast/Deploy.s.sol/84532/run-latest.json`

---

## Contract Configuration

### Environment Variables for Nodes
```bash
NODE_NFT_ADDRESS=0xEEE9178415A6b44916cbeF81de9Df2A4eEC735EE
ORACLE_VERIFIER_ADDRESS=0xf27e9DbBBFB520b8B4B25302cC5571BAE5397D9B
GOVERNANCE_VOTING_ADDRESS=0x6257ed4Fae49e504bf9a8ad9269909aCFcB9dBba
NETWORK=base-sepolia
CHAIN_ID=84532
RPC_URL=https://base-sepolia.g.alchemy.com/v2/Z6Vsdc0TcuwUWBvlIzOqT
```

Saved to: `/home/ubuntu/noderr-node-os/docker/.env.contracts`

---

## How the System Works

### 1. Operator Application & Approval
```bash
# Guardian approves operator
cast send $NODE_NFT_ADDRESS \
  "approveOperator(address)" \
  0xOperatorAddress \
  --private-key $PRIVATE_KEY \
  --rpc-url $RPC_URL
```

### 2. NFT Minting with Staking
```bash
# Operator mints NFT with stake
cast send $NODE_NFT_ADDRESS \
  "mintNode(address,uint8,uint256)" \
  0xOperatorAddress \
  0 \
  1 \
  --value 1000ether \
  --private-key $PRIVATE_KEY \
  --rpc-url $RPC_URL
```

### 3. Hardware Verification & Activation
```bash
# Guardian activates node after hardware verification
cast send $NODE_NFT_ADDRESS \
  "activateNode(uint256,string)" \
  1 \
  "hardware_hash_here" \
  --private-key $PRIVATE_KEY \
  --rpc-url $RPC_URL
```

### 4. Node Eligibility Check
```bash
# Check if node is eligible to operate
cast call $NODE_NFT_ADDRESS \
  "isNodeEligible(uint256)" \
  1 \
  --rpc-url $RPC_URL
```

### 5. Oracle Registration
```bash
# Oracle registers with additional stake
cast send $ORACLE_VERIFIER_ADDRESS \
  "registerOracle(address,uint256)" \
  0xOracleAddress \
  100 \
  --value 100ether \
  --private-key $PRIVATE_KEY \
  --rpc-url $RPC_URL
```

### 6. Consensus Verification
```bash
# Verify BFT consensus on trading signal
cast send $ORACLE_VERIFIER_ADDRESS \
  "verifyConsensus(bytes32,address[],bytes[])" \
  $SIGNAL_HASH \
  [$SIGNER1,$SIGNER2,$SIGNER3] \
  [$SIG1,$SIG2,$SIG3] \
  --private-key $PRIVATE_KEY \
  --rpc-url $RPC_URL
```

### 7. Governance Proposal
```bash
# Create governance proposal
cast send $GOVERNANCE_VOTING_ADDRESS \
  "propose(uint8,string,bytes)" \
  1 \
  "Approve new trading strategy" \
  0x \
  --private-key $PRIVATE_KEY \
  --rpc-url $RPC_URL
```

---

## Next Steps

### ✅ Completed
1. Smart contracts deployed to Base Sepolia
2. All contracts verified on Sourcify
3. Contract addresses saved for node configuration

### ⏳ In Progress
1. Building Docker images (base, oracle, guardian, validator)
2. Testing Docker images locally
3. Preparing Google Cloud deployment

### 📋 Remaining
1. Deploy nodes to Google Cloud
2. Test end-to-end workflow
3. Monitor system performance

---

## Testing the Deployment

### Check Contract Deployment
```bash
# Check NodeNFT
cast call 0xEEE9178415A6b44916cbeF81de9Df2A4eEC735EE \
  "name()" \
  --rpc-url https://base-sepolia.g.alchemy.com/v2/Z6Vsdc0TcuwUWBvlIzOqT

# Check OracleVerifier
cast call 0xf27e9DbBBFB520b8B4B25302cC5571BAE5397D9B \
  "consensusThreshold()" \
  --rpc-url https://base-sepolia.g.alchemy.com/v2/Z6Vsdc0TcuwUWBvlIzOqT

# Check GovernanceVoting
cast call 0x6257ed4Fae49e504bf9a8ad9269909aCFcB9dBba \
  "quorumPercentage()" \
  --rpc-url https://base-sepolia.g.alchemy.com/v2/Z6Vsdc0TcuwUWBvlIzOqT
```

### Approve First Operator (You)
```bash
# Approve yourself as first operator
cast send 0xEEE9178415A6b44916cbeF81de9Df2A4eEC735EE \
  "approveOperator(address)" \
  0x92977F6452431D4C06B1d7Afd9D03db5e98fa2C6 \
  --private-key 0xdeebadc49d97d7967af1a08a05725b830cbd9a8d76ccb0bd75a1a28846b0788b \
  --rpc-url https://base-sepolia.g.alchemy.com/v2/Z6Vsdc0TcuwUWBvlIzOqT
```

---

## Docker Images

### Building
```bash
cd /home/ubuntu/noderr-node-os
sudo ./docker/build-all.sh
```

### Running Locally
```bash
# Load contract addresses
source /home/ubuntu/noderr-node-os/docker/.env.contracts

# Run oracle node
sudo docker run -d \
  --name test-oracle \
  -e NODE_ID=test-oracle-001 \
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
```

---

## Repository

**GitHub**: https://github.com/Noderrxyz/noderr-node-os  
**Deployment Commit**: $(cd /home/ubuntu/noderr-node-os && git rev-parse --short HEAD)

---

## Support

### Basescan Contract Pages
- NodeNFT: https://sepolia.basescan.org/address/0xEEE9178415A6b44916cbeF81de9Df2A4eEC735EE#code
- OracleVerifier: https://sepolia.basescan.org/address/0xf27e9DbBBFB520b8B4B25302cC5571BAE5397D9B#code
- GovernanceVoting: https://sepolia.basescan.org/address/0x6257ed4Fae49e504bf9a8ad9269909aCFcB9dBba#code

### Sourcify Verification
- NodeNFT: https://sourcify.dev/#/lookup/0xEEE9178415A6b44916cbeF81de9Df2A4eEC735EE
- OracleVerifier: https://sourcify.dev/#/lookup/0xf27e9DbBBFB520b8B4B25302cC5571BAE5397D9B
- GovernanceVoting: https://sourcify.dev/#/lookup/0x6257ed4Fae49e504bf9a8ad9269909aCFcB9dBba

---

**Deployment Status**: ✅ COMPLETE  
**Network**: Base Sepolia  
**All Contracts**: Deployed & Verified  
**Next**: Docker Images → Google Cloud Deployment
