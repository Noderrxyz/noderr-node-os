# @noderr/risk-engine

Institutional-grade risk management engine for the Noderr Protocol. Provides comprehensive portfolio risk analysis, position sizing, stress testing, margin monitoring, and capital protection mechanisms.

## Features

### Core Risk Management
- **Value at Risk (VaR)**: Parametric, Historical, and Monte Carlo methodologies
- **Conditional VaR (CVaR)**: Expected Shortfall calculation for tail risk
- **Position Sizing**: Kelly Criterion, Volatility Targeting, Risk Parity, Max Drawdown
- **Stress Testing**: Historical scenarios, custom shocks, Monte Carlo simulations
- **Liquidation Management**: Automated margin monitoring and position liquidation

### Capital Protection
- **Circuit Breakers**: Automated trading halts based on loss limits
- **Drawdown Control**: Dynamic position sizing based on drawdown levels
- **Emergency Exit**: Rapid portfolio liquidation in extreme conditions
- **Recovery Strategies**: Structured re-entry after drawdowns

## Installation

```bash
npm install @noderr/risk-engine
```

## Quick Start

```typescript
import { RiskEngineService, RiskEngineConfig } from '@noderr/risk-engine';
import winston from 'winston';

// Configure logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [new winston.transports.Console()]
});

// Configure risk engine
const config: RiskEngineConfig = {
  var: {
    confidenceLevel: 0.95,
    lookbackPeriod: 252,
    methodology: 'parametric'
  },
  positionSizing: {
    methodology: 'optimal',
    targetVolatility: 0.15,
    maxPositionSize: 0.25,
    minPositionSize: 0.01,
    correlationAdjustment: true,
    kellyFraction: 0.25
  },
  stressTesting: {
    scenarios: [],
    historicalEvents: [],
    monteCarloConfig: {
      iterations: 10000,
      timeHorizon: 30,
      returnModel: 'normal',
      volatilityModel: 'garch',
      correlationModel: 'dynamic'
    }
  },
  liquidation: {
    marginCallThreshold: 0.8,
    liquidationThreshold: 0.95,
    maintenanceMarginRatio: 0.03,
    deleveragingStrategy: 'optimal',
    gracePeriod: 3600000,
    partialLiquidationAllowed: true
  },
  capitalProtection: {
    circuitBreaker: {
      dailyLossLimit: 0.05,
      weeklyLossLimit: 0.10,
      monthlyLossLimit: 0.15,
      consecutiveLossLimit: 3,
      volatilityMultiplier: 3,
      cooldownPeriod: 3600000,
      autoResumeEnabled: true
    },
    emergencyExit: {
      triggerConditions: [],
      exitStrategy: 'optimal',
      priorityOrder: ['BTC', 'ETH'],
      maxSlippage: 0.02,
      splitOrders: true,
      notificationChannels: ['email', 'sms']
    },
    recoveryStrategy: {
      type: 'gradual',
      targetRecoveryTime: 30,
      riskBudget: 0.5,
      allowableStrategies: ['trend', 'mean-reversion'],
      reentryRules: []
    }
  },
  reporting: {
    frequency: 300000, // 5 minutes
    recipients: ['risk@noderr.com'],
    format: 'json',
    includeCharts: false
  },
  telemetry: {
    enabled: true,
    endpoint: 'https://telemetry.noderr.com',
    sampleRate: 1.0
  }
};

// Initialize risk engine
const riskEngine = new RiskEngineService(config, logger);

// Start the engine
await riskEngine.start();

// Generate risk report
const portfolio = {
  id: 'portfolio-1',
  positions: [...],
  cash: 1000000,
  totalValue: 5000000,
  leverage: 2.5,
  marginUsed: 2000000,
  marginAvailable: 3000000,
  lastUpdate: Date.now()
};

const report = await riskEngine.generateRiskReport(portfolio);
console.log('Risk Report:', report);

// Calculate position size for new trade
const signal = {
  symbol: 'BTC',
  direction: 'long',
  confidence: 0.75,
  expectedReturn: 0.05,
  stopLoss: 0.02
};

const sizing = await riskEngine.calculatePositionSize(signal, portfolio);
console.log('Position Size:', sizing);
```

## API Reference

### RiskEngineService

Main service class that orchestrates all risk management components.

#### Methods

- `start()`: Start the risk engine monitoring
- `stop()`: Stop the risk engine
- `generateRiskReport(portfolio)`: Generate comprehensive risk analysis
- `calculatePositionSize(signal, portfolio)`: Calculate optimal position size
- `executeEmergencyExit(portfolio, reason)`: Trigger emergency liquidation
- `getTelemetry()`: Get performance metrics and statistics
- `updateConfig(config)`: Update risk engine configuration

### VaRCalculator

Value at Risk calculations using multiple methodologies.

```typescript
const varCalculator = new VaRCalculator(logger);
const varResult = await varCalculator.calculateVaR(portfolio, {
  confidenceLevel: 0.95,
  lookbackPeriod: 252,
  methodology: 'parametric'
});
```

### PositionSizer

Optimal position sizing based on various methodologies.

```typescript
const sizer = new PositionSizer(logger);
const size = await sizer.calculatePositionSize(signal, portfolio, config, limits);
```

### StressTester

Portfolio stress testing with historical and synthetic scenarios.

```typescript
const stressTester = new StressTester(logger);
const results = await stressTester.runHistoricalScenario(portfolio, {
  name: '2008 Financial Crisis',
  date: new Date('2008-09-15'),
  marketMoves: { BTC: -0.50, ETH: -0.60 },
  volatilityRegime: 4
});
```

### LiquidationTrigger

Automated margin monitoring and liquidation execution.

```typescript
const liquidationTrigger = new LiquidationTrigger(logger);
const marginStatus = await liquidationTrigger.monitorMarginLevels(portfolio, config);
```

### CircuitBreakerService

Capital protection through automated trading halts.

```typescript
const circuitBreaker = new CircuitBreakerService(logger);
const status = await circuitBreaker.checkCircuitBreaker(portfolio, config);
```

## Risk Metrics

The engine calculates and monitors various risk metrics:

- **VaR (Value at Risk)**: Maximum expected loss at confidence level
- **CVaR (Conditional VaR)**: Expected loss beyond VaR threshold
- **Sharpe Ratio**: Risk-adjusted returns
- **Sortino Ratio**: Downside risk-adjusted returns
- **Calmar Ratio**: Return over maximum drawdown
- **Maximum Drawdown**: Largest peak-to-trough decline
- **Beta**: Systematic risk relative to market
- **Information Ratio**: Active return over tracking error

## Events

The risk engine emits various events for monitoring:

```typescript
riskEngine.on('alert', (alert) => {
  console.log('Risk Alert:', alert);
});

riskEngine.on('reportGenerated', (report) => {
  console.log('New Risk Report:', report);
});

riskEngine.on('emergencyExit', (data) => {
  console.log('Emergency Exit Triggered:', data);
});
```

## Configuration

### VaR Configuration
```typescript
var: {
  confidenceLevel: 0.95,    // 95% confidence
  lookbackPeriod: 252,      // 1 year of data
  methodology: 'parametric' // parametric, historical, monteCarlo
}
```

### Position Sizing Configuration
```typescript
positionSizing: {
  methodology: 'optimal',        // kelly, volatilityTarget, riskParity, maxDrawdown, optimal
  targetVolatility: 0.15,       // 15% annual volatility target
  maxPositionSize: 0.25,        // 25% max position
  minPositionSize: 0.01,        // 1% min position
  correlationAdjustment: true,  // Adjust for correlations
  kellyFraction: 0.25          // 1/4 Kelly for safety
}
```

### Circuit Breaker Configuration
```typescript
circuitBreaker: {
  dailyLossLimit: 0.05,      // 5% daily loss limit
  weeklyLossLimit: 0.10,     // 10% weekly loss limit
  monthlyLossLimit: 0.15,    // 15% monthly loss limit
  consecutiveLossLimit: 3,   // 3 consecutive loss days
  volatilityMultiplier: 3,   // 3x normal volatility
  cooldownPeriod: 3600000,   // 1 hour cooldown
  autoResumeEnabled: true    // Auto-resume when safe
}
```

## Best Practices

1. **Regular Monitoring**: Set appropriate reporting frequency based on portfolio size
2. **Conservative Limits**: Start with conservative risk limits and adjust based on performance
3. **Diversification**: Maintain minimum diversification requirements
4. **Stress Testing**: Regularly run stress tests with updated scenarios
5. **Circuit Breakers**: Always enable circuit breakers for capital protection
6. **Position Sizing**: Use multiple methodologies for robust sizing
7. **Margin Buffer**: Maintain adequate margin buffer above requirements

## Performance Optimization

- Results are cached with configurable TTL
- Parallel calculation of independent metrics
- Event-driven architecture for real-time monitoring
- Efficient data structures for large portfolios

## Testing

```bash
# Run tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test suite
npm test -- VaRCalculator
```

## Contributing

Please read our contributing guidelines before submitting PRs.

## License

MIT License - see LICENSE file for details 