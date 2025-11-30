# Floor Engine

**Low-risk yield generation engine for the Noderr treasury.**

## Overview

The Floor Engine is an automated yield optimization system that deploys capital across lending protocols, liquid staking, and yield farming strategies to generate stable returns (4-8% APY) while maintaining strict risk controls.

## Features

- **Multi-Protocol Support:** Aave, Compound, Morpho, Spark (lending), Lido, Rocket Pool (staking), Curve, Convex, Balancer (yield)
- **Automated Rebalancing:** Maintains target allocations across protocols
- **Risk Management:** Strict allocation limits, slippage monitoring, emergency controls
- **Multi-Chain:** Ethereum, Arbitrum, Optimism, Base
- **Performance Tracking:** Comprehensive metrics and historical data
- **Event-Driven:** Real-time notifications for all state changes

## Architecture

```
Floor Engine Orchestrator
├── Adapter Registry (manages all adapters)
├── Risk Manager (enforces risk limits)
└── Adapters
    ├── Lending (Aave, Compound, Morpho, Spark)
    ├── Staking (Lido, Rocket Pool, Native ETH)
    └── Yield (Curve, Convex, Balancer)
```

## Installation

```bash
npm install @noderr/floor-engine
```

## Usage

```typescript
import { FloorEngine } from '@noderr/floor-engine';

// Initialize Floor Engine
const config = {
  rpcUrl: process.env.RPC_URL,
  chainId: 1,
  networkName: 'ethereum',
  privateKey: process.env.PRIVATE_KEY,
  treasuryManagerAddress: '0x...',
  allocationStrategy: {
    lending: 50,  // 50%
    staking: 30,  // 30%
    yield: 20,    // 20%
  },
  riskParameters: {
    maxAllocationPerAdapter: ethers.parseEther('1000'),
    maxAllocationPerProtocol: ethers.parseEther('2000'),
    maxAllocationPerChain: ethers.parseEther('3000'),
    maxSlippageBps: 50,  // 0.5%
    maxDrawdownBps: 500, // 5%
    allowedTokens: [],
    allowedProtocols: [],
    emergencyPauseEnabled: true,
  },
  // ... other config
};

const engine = new FloorEngine(config);
await engine.initialize();

// Allocate capital
await engine.allocateCapital(ethers.parseEther('10000'));

// Get performance metrics
const metrics = await engine.getPerformanceMetrics();
console.log(`Total Value: ${ethers.formatEther(metrics.totalValue)} ETH`);
console.log(`Current APY: ${metrics.currentAPY.toFixed(2)}%`);
console.log(`Sharpe Ratio: ${metrics.sharpeRatio.toFixed(2)}`);

// Rebalance positions
const result = await engine.rebalance();
console.log(`Rebalanced: ${result.actions.length} actions`);

// Harvest yields
const yield = await engine.harvestYields();
console.log(`Harvested: ${ethers.formatEther(yield)} ETH`);
```

## Configuration

### Required Environment Variables

```bash
# Blockchain
RPC_URL=https://eth-mainnet.g.alchemy.com/v2/your-api-key
CHAIN_ID=1
NETWORK_NAME=ethereum

# Wallet
PRIVATE_KEY=0x...

# Contracts
TREASURY_MANAGER_ADDRESS=0x...

# Logging
LOG_LEVEL=info
LOG_FILE=./logs/floor-engine.log
```

### Allocation Strategy

Configure target allocations across adapter categories:

```typescript
allocationStrategy: {
  lending: 50,  // 50% to lending protocols
  staking: 30,  // 30% to liquid staking
  yield: 20,    // 20% to yield farming
}
```

### Risk Parameters

```typescript
riskParameters: {
  maxAllocationPerAdapter: ethers.parseEther('1000'),  // Max 1000 ETH per adapter
  maxAllocationPerProtocol: ethers.parseEther('2000'), // Max 2000 ETH per protocol
  maxAllocationPerChain: ethers.parseEther('3000'),    // Max 3000 ETH per chain
  maxSlippageBps: 50,                                  // Max 0.5% slippage
  maxDrawdownBps: 500,                                 // Max 5% drawdown
  allowedTokens: ['0x...'],                            // Token whitelist
  allowedProtocols: ['aave', 'lido'],                  // Protocol whitelist
  emergencyPauseEnabled: true,                         // Auto-pause on drawdown
}
```

## API Reference

### FloorEngine

#### Methods

- `initialize()` - Initialize the Floor Engine
- `allocateCapital(amount, strategy?)` - Allocate capital to adapters
- `rebalance()` - Rebalance positions to match target allocations
- `harvestYields()` - Harvest yields from all positions
- `getPositions()` - Get all current positions
- `getTotalValue()` - Get total value locked (TVL)
- `getAPY()` - Get current weighted average APY
- `getPerformanceMetrics()` - Get comprehensive performance metrics
- `getAdapterRegistry()` - Get adapter registry instance
- `getRiskManager()` - Get risk manager instance

#### Events

- `initialized` - Floor Engine initialized
- `capital_allocated` - Capital allocated to adapter
- `rebalance_completed` - Rebalancing completed
- `harvest_completed` - Yield harvesting completed
- `emergency_pause` - System paused due to risk event
- `adapter_registered` - New adapter registered
- `adapter_enabled` - Adapter enabled
- `adapter_disabled` - Adapter disabled

### AdapterRegistry

#### Methods

- `registerAdapter(adapterId, adapter, metadata)` - Register a new adapter
- `unregisterAdapter(adapterId)` - Unregister an adapter
- `enableAdapter(adapterId)` - Enable an adapter
- `disableAdapter(adapterId)` - Disable an adapter
- `getAdapter(adapterId)` - Get adapter instance
- `getMetadata(adapterId)` - Get adapter metadata
- `getAllAdapters(category?, enabledOnly?)` - Get all adapters
- `getAdaptersByProtocol(protocol, enabledOnly?)` - Get adapters by protocol
- `healthCheck(adapterId)` - Perform health check on adapter
- `healthCheckAll()` - Perform health check on all adapters
- `getStatistics()` - Get registry statistics

### RiskManager

#### Methods

- `validateAllocation(adapterId, amount, positions)` - Validate capital allocation
- `checkSlippage(expectedOut, actualOut)` - Check slippage against limits
- `emergencyPause(reason)` - Emergency pause the system
- `resume(authorizedBy)` - Resume system after pause
- `getProtocolExposure(protocol, positions)` - Get exposure to protocol
- `getChainExposure(chain, positions)` - Get exposure to chain
- `calculateRiskMetrics(positions, totalDeposited)` - Calculate risk metrics
- `updateRiskParameters(newParameters)` - Update risk parameters
- `getRiskParameters()` - Get current risk parameters
- `isPausedStatus()` - Check if system is paused
- `isTokenAllowed(token)` - Check if token is whitelisted
- `isProtocolAllowed(protocol)` - Check if protocol is whitelisted

## Development Status

### ✅ Week 1: Core Infrastructure (COMPLETE)
- Floor Engine Orchestrator
- Adapter Registry
- Risk Manager
- Type system and interfaces

### ⏳ Week 2: Lending Adapters (IN PROGRESS)
- Aave V3 Adapter
- Compound V3 Adapter
- Morpho Blue Adapter
- Spark Adapter

### ⏳ Week 3: Staking Adapters
- Lido Adapter (stETH)
- Rocket Pool Adapter (rETH)
- Native ETH Staking Adapter

### ⏳ Week 4: Yield Adapters
- Curve Adapter (stable pools)
- Convex Wrapper Adapter
- Balancer Boosted Adapter

### ⏳ Week 5: Integration & Testing
- End-to-end integration tests
- Rebalancing logic testing
- Emergency procedure testing
- Multi-chain deployment testing

### ⏳ Week 6: Deployment
- Testnet deployment
- Audit preparation
- Documentation finalization
- Mainnet deployment plan

## License

MIT

## Contributing

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for contribution guidelines.

## Support

For issues and questions, please open an issue on GitHub or contact the Noderr team.
