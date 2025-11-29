# Noderr Protocol Smart Contracts - Deployment Guide

## Overview

This directory contains the core smart contracts for the Noderr decentralized autonomous trading protocol. The contracts implement a fully decentralized node network with NFT-based operator licenses, BFT consensus verification, and on-chain governance.

## Smart Contracts

### 1. NodeNFT.sol
**Purpose**: NFT-based node operator licensing system

**Features**:
- Three node types: Oracle (ML inference), Guardian (consensus), Validator (execution)
- Three tier levels: Bronze (1), Silver (2), Gold (3)
- Staking requirements: Oracle (1000 ETH), Guardian (500 ETH), Validator (250 ETH)
- Hardware verification and activation system
- Operator approval workflow

**Key Functions**:
- `approveOperator(address)` - Approve an operator to receive NFT
- `mintNode(address, NodeType, tier)` - Mint NFT to approved operator with staking
- `activateNode(tokenId, hardwareHash)` - Activate node after hardware verification
- `isNodeEligible(tokenId)` - Check if node meets all requirements

### 2. OracleVerifier.sol
**Purpose**: Byzantine Fault Tolerant consensus verification for ML trading signals

**Features**:
- BFT consensus with 67% threshold (2f+1)
- Weighted voting based on oracle stake and reputation
- Signature verification using ECDSA
- Slashing mechanism for malicious oracles
- 60-second maximum signal age

**Key Functions**:
- `registerOracle(address, weight)` - Register oracle with voting weight
- `verifyConsensus(signal, signers, signatures)` - Verify BFT consensus on trading signal
- `slashOracle(address, amount, reason)` - Slash malicious oracle
- `isSignalVerified(signalHash)` - Check if signal has been verified

### 3. GovernanceVoting.sol
**Purpose**: Decentralized governance for protocol parameters and strategy approval

**Features**:
- NFT-based voting rights
- Quadratic voting (vote weight = sqrt(NFT count))
- 40% quorum requirement
- 7-day voting period (~50,400 blocks)
- Five proposal types: Parameter Change, Strategy Approval, Oracle Addition/Removal, Emergency Action

**Key Functions**:
- `propose(type, description, callData)` - Create governance proposal
- `castVote(proposalId, support)` - Vote on proposal
- `execute(proposalId)` - Execute successful proposal
- `getProposal(proposalId)` - Get proposal details

## Deployment Architecture

### Network: Ethereum Sepolia Testnet
- **Chain ID**: 11155111
- **RPC**: https://rpc.sepolia.org
- **Explorer**: https://sepolia.etherscan.io

### Alternative: Arbitrum Sepolia
- **Chain ID**: 421614
- **RPC**: https://sepolia-rollup.arbitrum.io/rpc
- **Explorer**: https://sepolia.arbiscan.io

## Deployment Steps

### Prerequisites

1. **Get Testnet ETH**:
   - Sepolia Faucet: https://sepoliafaucet.com
   - Alchemy Sepolia Faucet: https://sepoliafaucet.net
   - Minimum: 0.5 ETH for deployment + testing

2. **Set Environment Variables**:
```bash
export PRIVATE_KEY="your_private_key_here"
export SEPOLIA_RPC_URL="https://rpc.sepolia.org"
export ETHERSCAN_API_KEY="your_etherscan_api_key"
```

### Method 1: Hardhat (Recommended)

```bash
cd /home/ubuntu/noderr-node-os/contracts

# Install dependencies
pnpm install --ignore-scripts

# Compile contracts
npx hardhat compile

# Deploy to Sepolia testnet
npx hardhat run scripts/deploy.ts --network sepolia

# Verify contracts on Etherscan
npx hardhat verify --network sepolia <CONTRACT_ADDRESS> <CONSTRUCTOR_ARGS>
```

### Method 2: Remix IDE (Fastest for Testing)

1. Go to https://remix.ethereum.org
2. Upload contract files from `contracts/` directory
3. Install OpenZeppelin contracts via Remix plugin
4. Compile with Solidity 0.8.24
5. Connect MetaMask to Sepolia testnet
6. Deploy contracts one by one:
   - Deploy NodeNFT first
   - Deploy OracleVerifier
   - Deploy GovernanceVoting (pass NodeNFT address)

### Method 3: Foundry (Advanced)

```bash
# Install Foundry
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Initialize Foundry project
cd /home/ubuntu/noderr-node-os/contracts
forge init --force

# Install dependencies
forge install OpenZeppelin/openzeppelin-contracts

# Compile
forge build

# Deploy
forge create --rpc-url $SEPOLIA_RPC_URL \
  --private-key $PRIVATE_KEY \
  contracts/NodeNFT.sol:NodeNFT \
  --constructor-args "Noderr Node License" "NODERR" "https://api.noderr.xyz/metadata/" <YOUR_ADDRESS>
```

## Post-Deployment Configuration

### 1. Initialize Node NFT System

```solidity
// Approve first batch of node operators
nodeNFT.approveOperator(operatorAddress1);
nodeNFT.approveOperator(operatorAddress2);
nodeNFT.approveOperator(operatorAddress3);

// Operators mint their NFTs with staking
nodeNFT.mintNode{value: 1000 ether}(operatorAddress1, NodeType.Oracle, 1);
nodeNFT.mintNode{value: 500 ether}(operatorAddress2, NodeType.Guardian, 1);
nodeNFT.mintNode{value: 250 ether}(operatorAddress3, NodeType.Validator, 1);

// Verify hardware and activate nodes
nodeNFT.activateNode(tokenId1, "hardware_hash_1");
nodeNFT.activateNode(tokenId2, "hardware_hash_2");
nodeNFT.activateNode(tokenId3, "hardware_hash_3");
```

### 2. Register Oracles in Verifier

```solidity
// Register oracle nodes with voting weights
oracleVerifier.registerOracle{value: 1000 ether}(oracleAddress1, 100);
oracleVerifier.registerOracle{value: 1000 ether}(oracleAddress2, 100);
oracleVerifier.registerOracle{value: 1000 ether}(oracleAddress3, 100);
```

### 3. Configure Governance

```solidity
// Update NFT holdings for governance participants
governanceVoting.updateNFTHoldings(holder1, 5);
governanceVoting.updateNFTHoldings(holder2, 3);
governanceVoting.updateNFTHoldings(holder3, 2);
```

## Integration with Node Software

### Node Operator Workflow

1. **Application Phase**:
   - Operator applies through web interface
   - Guardian reviews application
   - Guardian calls `nodeNFT.approveOperator(operatorAddress)`

2. **NFT Minting Phase**:
   - Approved operator receives notification
   - Operator stakes required amount and mints NFT
   - `nodeNFT.mintNode{value: stake}(address, nodeType, tier)`

3. **Hardware Verification Phase**:
   - Operator installs node software
   - Software reports hardware specs to verification service
   - Guardian verifies and calls `nodeNFT.activateNode(tokenId, hardwareHash)`

4. **Node Operation Phase**:
   - Node software checks eligibility: `nodeNFT.isNodeEligible(tokenId)`
   - If eligible, node joins network and begins operation
   - Oracle nodes register in OracleVerifier with additional stake

5. **Consensus Participation**:
   - Oracle nodes generate ML predictions
   - Sign predictions with private key
   - Submit to BFT consensus
   - Guardian nodes verify via `oracleVerifier.verifyConsensus()`

## Testing

### Unit Tests

```bash
cd /home/ubuntu/noderr-node-os/contracts
npx hardhat test
```

### Integration Tests

Test the full workflow:
1. Deploy all contracts
2. Approve and mint node NFTs
3. Activate nodes
4. Register oracles
5. Submit and verify consensus
6. Create and vote on governance proposal

## Security Considerations

### Auditing Checklist
- [ ] Reentrancy protection (using OpenZeppelin's ReentrancyGuard if needed)
- [ ] Access control properly implemented (using AccessControl)
- [ ] Integer overflow protection (Solidity 0.8+ has built-in)
- [ ] Signature verification secure (using ECDSA from OpenZeppelin)
- [ ] Slashing mechanism cannot be abused
- [ ] Emergency pause functionality
- [ ] Upgrade path for critical bugs

### Mainnet Deployment Requirements
1. Professional smart contract audit (Quantstamp, Trail of Bits, OpenZeppelin)
2. Bug bounty program
3. Gradual rollout with limited stakes
4. Multi-sig for admin functions
5. Timelock for governance execution
6. Insurance fund for slashing incidents

## Monitoring and Maintenance

### Events to Monitor
- `NodeMinted` - Track new node operators
- `NodeActivated` - Track active nodes
- `OracleRegistered` - Track oracle additions
- `SignalVerified` - Track consensus verifications
- `SlashingExecuted` - Track malicious behavior
- `ProposalCreated` - Track governance activity

### Metrics to Track
- Total active nodes by type
- Total staked value
- Consensus success rate
- Average consensus time
- Slashing frequency
- Governance participation rate

## Troubleshooting

### Common Issues

**Issue**: Compilation fails with OpenZeppelin import errors
**Solution**: Install OpenZeppelin contracts: `npm install @openzeppelin/contracts`

**Issue**: Deployment fails with "insufficient funds"
**Solution**: Ensure deployer account has at least 0.5 ETH on testnet

**Issue**: Verification fails on Etherscan
**Solution**: Ensure constructor arguments match exactly, use `--constructor-args-params` flag

**Issue**: Node activation fails
**Solution**: Check that NFT exists, is not already active, and caller has VERIFIER_ROLE

## Contract Addresses (To be filled after deployment)

### Sepolia Testnet
- NodeNFT: `<TO_BE_DEPLOYED>`
- OracleVerifier: `<TO_BE_DEPLOYED>`
- GovernanceVoting: `<TO_BE_DEPLOYED>`

### Arbitrum Sepolia
- NodeNFT: `<TO_BE_DEPLOYED>`
- OracleVerifier: `<TO_BE_DEPLOYED>`
- GovernanceVoting: `<TO_BE_DEPLOYED>`

## Next Steps

1. ✅ Contracts written and compiled
2. ⏳ Deploy to Sepolia testnet
3. ⏳ Verify on Etherscan
4. ⏳ Test full node operator workflow
5. ⏳ Integrate with node software
6. ⏳ Run security audit
7. ⏳ Deploy to mainnet

---

**Status**: Ready for testnet deployment
**Last Updated**: $(date)
