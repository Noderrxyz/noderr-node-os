# @noderr/types

Shared TypeScript type definitions for the Noderr Protocol ecosystem.

## Overview

This package provides centralized type definitions used across all Noderr packages, ensuring type consistency and reducing duplication.

## Categories

### Core Types
- **Trading**: Order, Trade, Position, Portfolio
- **Market**: MarketData, OrderBook, Ticker, OHLCV
- **Account**: Balance, Account, Wallet

### Execution Types
- **Orders**: OrderIntent, OrderStatus, ExecutionResult
- **Algorithms**: TWAPConfig, VWAPConfig, AlgorithmParams
- **Venues**: VenueConfig, ExchangeCredentials

### Risk Types
- **Metrics**: RiskMetrics, VaR, Sharpe, Drawdown
- **Limits**: PositionLimits, RiskLimits, ExposureLimits
- **Alerts**: RiskAlert, CircuitBreakerEvent

### AI/ML Types
- **Models**: ModelConfig, ModelMetrics, Prediction
- **Features**: FeatureVector, FeatureImportance
- **Training**: TrainingConfig, ValidationMetrics

### Infrastructure Types
- **Events**: SystemEvent, TradingEvent, RiskEvent
- **Config**: SystemConfig, ModuleConfig
- **Telemetry**: Metric, Trace, Log

## Usage

```typescript
import { 
  Order, 
  Trade, 
  RiskMetrics,
  ModelPrediction 
} from '@noderr/types';

// Use types in your code
const order: Order = {
  id: '123',
  symbol: 'BTC/USDT',
  side: 'buy',
  type: 'limit',
  price: 50000,
  amount: 0.1,
  status: 'pending'
};

const metrics: RiskMetrics = {
  var95: 0.02,
  sharpe: 1.5,
  maxDrawdown: 0.15,
  currentExposure: 0.75
};
```

## Type Safety

All types are strictly defined with:
- Required vs optional fields clearly marked
- Proper enum definitions for constants
- Generic types where flexibility is needed
- Branded types for type safety (e.g., OrderId, TradeId)

## Contributing

When adding new types:
1. Place in appropriate category file
2. Export from index.ts
3. Add JSDoc documentation
4. Consider backward compatibility

## License

MIT 