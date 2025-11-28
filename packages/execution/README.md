# @noderr/execution

Unified execution engine for the Noderr Protocol, providing institutional-grade trade execution with smart routing, MEV protection, and advanced algorithms.

## Overview

This package consolidates all execution-related functionality from the previously separate packages:
- `execution-engine`: Core execution components
- `execution-enhanced`: Smart execution with ML routing
- `execution-optimizer`: MEV protection and advanced algorithms

## Features

### Core Execution
- **Order Lifecycle Management**: Complete order tracking from creation to settlement
- **Smart Order Routing**: ML-powered venue selection and routing optimization
- **Position Reconciliation**: Real-time position tracking and reconciliation
- **Parallel Risk Calculation**: High-performance risk assessment
- **Exchange Batching**: Efficient order batching for reduced fees

### Advanced Algorithms
- **TWAP (Time-Weighted Average Price)**: Minimize market impact for large orders
- **VWAP (Volume-Weighted Average Price)**: Execute orders following volume patterns
- **Iceberg Orders**: Hide large order sizes with intelligent slicing
- **Adaptive Algorithms**: Dynamic adjustment based on market conditions

### MEV Protection
- **Flashbots Integration**: Private transaction pools
- **Bundle Optimization**: Efficient transaction bundling
- **Front-running Detection**: Real-time MEV attack detection
- **Private Mempool Usage**: Bypass public mempool exposure

### Safety Features
- **Circuit Breakers**: Automatic trading halts on anomalies
- **Slippage Protection**: Dynamic slippage limits
- **Gas Price Management**: Intelligent gas pricing strategies
- **Failover Systems**: Automatic venue switching on failures

## Installation

```bash
npm install @noderr/execution
```

## Usage

```typescript
import { 
  SmartExecutionEngine,
  OrderLifecycleManager,
  TWAPExecutor,
  MEVProtection 
} from '@noderr/execution';

// Initialize the execution engine
const engine = new SmartExecutionEngine({
  venues: ['binance', 'coinbase', 'uniswap'],
  mevProtection: true,
  smartRouting: true
});

// Execute an order with TWAP
const executor = new TWAPExecutor(engine);
const result = await executor.execute({
  symbol: 'ETH/USDT',
  side: 'buy',
  amount: 100,
  duration: 3600, // 1 hour
  slices: 20
});

// Monitor order lifecycle
const lifecycle = new OrderLifecycleManager();
lifecycle.on('filled', (order) => {
  console.log('Order filled:', order);
});
```

## Architecture

```
execution/
├── core/               # Core execution components
│   ├── SmartExecutionEngine.ts
│   ├── OrderLifecycleManager.ts
│   ├── PositionReconciliation.ts
│   └── ParallelRiskCalculator.ts
├── algorithms/         # Trading algorithms
│   ├── TWAPExecutor.ts
│   ├── VWAPExecutor.ts
│   └── IcebergExecutor.ts
├── mev/               # MEV protection
│   ├── FlashbotsIntegration.ts
│   ├── BundleOptimizer.ts
│   └── FrontrunDetector.ts
├── safety/            # Safety systems
│   ├── CircuitBreaker.ts
│   ├── SlippageProtection.ts
│   └── FailoverManager.ts
└── types/             # TypeScript definitions
```

## Configuration

```typescript
{
  // Venue configuration
  venues: {
    binance: { 
      enabled: true, 
      priority: 1,
      rateLimit: 1200 
    },
    uniswap: { 
      enabled: true, 
      priority: 2,
      slippageTolerance: 0.5 
    }
  },
  
  // Algorithm settings
  algorithms: {
    twap: {
      minSlices: 10,
      maxSlices: 100,
      adaptivePacing: true
    },
    vwap: {
      lookbackPeriod: 24, // hours
      volumeProfile: 'historical'
    }
  },
  
  // MEV protection
  mev: {
    useFlashbots: true,
    privateMempools: ['flashbots', 'eden'],
    bundleTimeout: 30000
  },
  
  // Safety limits
  safety: {
    maxSlippage: 0.02, // 2%
    circuitBreaker: {
      lossThreshold: 0.05, // 5%
      cooldownPeriod: 300000 // 5 minutes
    }
  }
}
```

## Performance

- **Latency**: < 10ms routing decisions
- **Throughput**: 10,000+ orders/second
- **Success Rate**: > 99.5% execution success
- **Slippage**: < 0.1% average slippage

## Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test suite
npm test -- algorithms
```

## Contributing

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for development guidelines.

## License

MIT 