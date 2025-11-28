# @noderr/on-chain-service

**On-Chain Interaction Service** for the Noderr Autonomous Trading Engine (ATE).

This service bridges the off-chain trading engine with the on-chain Noderr Protocol smart contracts, enabling secure capital management, reward distribution, and performance reporting.

## Features

### 1. Capital Management
- **Request Capital**: Withdraw capital from TreasuryManager for trading strategies
- **Deposit Profits**: Return trading profits to the treasury
- **Report Performance**: Submit real-time performance metrics on-chain

### 2. Reward Distribution
- **Merkle Root Generation**: Create gas-efficient Merkle trees for reward distribution
- **Batch Rewards**: Submit rewards for thousands of recipients in a single transaction
- **Claim Tracking**: Monitor and verify reward claims

### 3. Node Trust Updates
- **TrustFingerprint™ Updates**: Submit node reputation scores to the blockchain
- **Batch Processing**: Efficiently update multiple node scores

### 4. Security Features
- **Hot Wallet**: Dedicated wallet with strictly limited permissions
- **Rate Limiting**: Prevents excessive on-chain transactions
- **Circuit Breakers**: Automatic halt on suspicious activity
- **Transaction Monitoring**: Real-time monitoring and alerting

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  Autonomous Trading Engine                   │
│                      (Off-Chain)                             │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              On-Chain Interaction Service                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Capital    │  │   Rewards    │  │  Trust       │      │
│  │  Management  │  │ Distribution │  │  Updates     │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              Noderr Protocol Smart Contracts                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  Treasury    │  │   Merkle     │  │ TrustFinger  │      │
│  │  Manager     │  │   Reward     │  │   print      │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

## Installation

```bash
# Install dependencies
pnpm install

# Build the package
pnpm build

# Run tests
pnpm test
```

## Configuration

Create a `.env` file in the package root:

```env
# Blockchain Configuration
RPC_URL=https://mainnet.infura.io/v3/YOUR_PROJECT_ID
CHAIN_ID=1
NETWORK_NAME=mainnet

# Wallet Configuration
PRIVATE_KEY=your_hot_wallet_private_key

# Contract Addresses
TREASURY_MANAGER_ADDRESS=0x...
MERKLE_REWARD_DISTRIBUTOR_ADDRESS=0x...
TRUST_FINGERPRINT_ADDRESS=0x...

# Security Configuration
MAX_CAPITAL_REQUEST=1000000000000000000000  # 1000 ETH in wei
DAILY_CAPITAL_LIMIT=5000000000000000000000  # 5000 ETH in wei
RATE_LIMIT_REQUESTS_PER_HOUR=10

# Logging
LOG_LEVEL=info
LOG_FILE=./logs/on-chain-service.log
```

## Usage

### Capital Management

```typescript
import { CapitalManager } from '@noderr/on-chain-service';

const capitalManager = new CapitalManager(config);

// Request capital for trading
const tx = await capitalManager.requestCapital(
  ethers.parseEther('100'),  // amount
  'strategy-001'              // strategy ID
);

// Deposit profits
await capitalManager.depositProfit(
  ethers.parseEther('110'),  // amount (principal + profit)
  'strategy-001'
);

// Report performance
await capitalManager.reportPerformance(
  'strategy-001',
  ethers.parseEther('10'),   // P&L
  250                         // Sharpe ratio (2.50 * 100)
);
```

### Reward Distribution

```typescript
import { RewardDistributor } from '@noderr/on-chain-service';

const rewardDistributor = new RewardDistributor(config);

// Create Merkle tree from rewards
const rewards = [
  { address: '0x...', amount: ethers.parseEther('100') },
  { address: '0x...', amount: ethers.parseEther('50') },
  // ... thousands more
];

const { merkleRoot, tree } = await rewardDistributor.generateMerkleTree(rewards);

// Submit Merkle root on-chain
await rewardDistributor.createMerkleEpoch(
  merkleRoot,
  totalAmount,
  'Q4 2024 Strategy Rewards'
);
```

### Trust Updates

```typescript
import { TrustUpdater } from '@noderr/on-chain-service';

const trustUpdater = new TrustUpdater(config);

// Update single node
await trustUpdater.updateTrustScore(
  '0x...',  // node address
  8500      // score (85.00%)
);

// Batch update
await trustUpdater.batchUpdateTrustScores([
  { address: '0x...', score: 8500 },
  { address: '0x...', score: 7200 },
  // ... more updates
]);
```

## Security Considerations

1. **Hot Wallet Permissions**: The service uses a dedicated hot wallet with minimal permissions (ATE_ROLE only)
2. **Capital Limits**: Enforces per-request (5%) and daily (15%) capital limits
3. **Rate Limiting**: Prevents excessive on-chain transactions
4. **Circuit Breakers**: Automatically halts on suspicious activity
5. **Transaction Monitoring**: All transactions are logged and monitored
6. **Key Management**: Private keys should be stored in secure key management systems (e.g., AWS KMS, HashiCorp Vault)

## Development

```bash
# Run in development mode
pnpm dev

# Run tests with coverage
pnpm test --coverage

# Lint code
pnpm lint
```

## License

MIT
