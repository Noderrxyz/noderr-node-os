# @noderr/utils

Shared utility functions and helpers for the Noderr Protocol ecosystem.

## Overview

This package provides common utilities used across all Noderr packages, ensuring consistency and reducing code duplication.

## Categories

### Logging
- **Logger**: Winston-based logger with structured output
- **LogFormatter**: Custom log formatting
- **LogLevels**: Standardized log levels

### Validation
- **OrderValidator**: Validate order parameters
- **ConfigValidator**: Validate configuration objects
- **SchemaValidator**: Joi-based schema validation

### Calculations
- **PriceCalculator**: Price impact, slippage calculations
- **FeeCalculator**: Trading fee calculations
- **PnLCalculator**: Profit/loss calculations
- **RiskCalculator**: Risk metrics calculations

### Time & Date
- **TimeUtils**: Time conversions and formatting
- **MarketHours**: Market open/close utilities
- **Intervals**: Interval management

### Data Structures
- **CircularBuffer**: Fixed-size circular buffer
- **PriorityQueue**: Priority queue implementation
- **LRUCache**: Least recently used cache
- **OrderBook**: Order book data structure

### Crypto & Security
- **HashUtils**: Hashing utilities
- **SignatureUtils**: Message signing/verification
- **NonceManager**: Nonce generation and management

### Network
- **RetryManager**: Exponential backoff retry logic
- **RateLimiter**: Rate limiting implementation
- **ConnectionPool**: Connection pooling

### Math & Statistics
- **MathUtils**: Common math operations
- **StatUtils**: Statistical calculations
- **MovingAverage**: Various MA implementations
- **RandomUtils**: Secure random generation

## Usage

```typescript
import { 
  Logger,
  OrderValidator,
  PriceCalculator,
  RetryManager,
  CircularBuffer 
} from '@noderr/utils';

// Logging
const logger = new Logger('MyService');
logger.info('Service started', { port: 3000 });

// Validation
const validator = new OrderValidator();
const isValid = validator.validate({
  symbol: 'BTC/USDT',
  side: 'buy',
  amount: 0.1,
  price: 50000
});

// Calculations
const calculator = new PriceCalculator();
const impact = calculator.calculatePriceImpact({
  orderSize: 1000,
  liquidity: 50000,
  spread: 0.1
});

// Retry logic
const retry = new RetryManager({
  maxAttempts: 3,
  backoff: 'exponential',
  initialDelay: 1000
});

await retry.execute(async () => {
  return await riskyOperation();
});

// Data structures
const buffer = new CircularBuffer<number>(100);
buffer.push(42);
const recent = buffer.toArray();
```

## API Reference

### Logger

```typescript
class Logger {
  constructor(name: string, options?: LoggerOptions);
  
  debug(message: string, meta?: any): void;
  info(message: string, meta?: any): void;
  warn(message: string, meta?: any): void;
  error(message: string, error?: Error, meta?: any): void;
  
  child(name: string): Logger;
}
```

### OrderValidator

```typescript
class OrderValidator {
  validate(order: OrderInput): ValidationResult;
  validateBatch(orders: OrderInput[]): ValidationResult[];
  
  // Specific validations
  validateAmount(amount: number, symbol: string): boolean;
  validatePrice(price: number, side: OrderSide): boolean;
  validateSymbol(symbol: string): boolean;
}
```

### PriceCalculator

```typescript
class PriceCalculator {
  calculatePriceImpact(params: ImpactParams): number;
  calculateSlippage(expected: number, actual: number): number;
  calculateVWAP(trades: Trade[]): number;
  calculateSpread(bid: number, ask: number): number;
  
  // Fee calculations
  calculateTradingFee(amount: number, feeRate: number): number;
  calculateNetAmount(gross: number, fees: number): number;
}
```

### RetryManager

```typescript
class RetryManager {
  constructor(options: RetryOptions);
  
  execute<T>(
    operation: () => Promise<T>,
    shouldRetry?: (error: Error) => boolean
  ): Promise<T>;
  
  // With timeout
  executeWithTimeout<T>(
    operation: () => Promise<T>,
    timeout: number
  ): Promise<T>;
}
```

### CircularBuffer

```typescript
class CircularBuffer<T> {
  constructor(capacity: number);
  
  push(item: T): void;
  pop(): T | undefined;
  peek(): T | undefined;
  
  toArray(): T[];
  clear(): void;
  
  get size(): number;
  get isFull(): boolean;
  get isEmpty(): boolean;
}
```

## Configuration

Many utilities accept configuration options:

```typescript
// Logger configuration
{
  level: 'info',
  format: 'json',
  timestamp: true,
  colorize: false,
  maxFiles: 5,
  maxSize: '10m'
}

// Retry configuration
{
  maxAttempts: 3,
  backoff: 'exponential',
  initialDelay: 1000,
  maxDelay: 30000,
  factor: 2,
  jitter: true
}

// Validator configuration
{
  strict: true,
  allowPartialFills: false,
  minOrderSize: 0.001,
  maxOrderSize: 10000
}
```

## Best Practices

1. **Use appropriate log levels**: Debug for development, Info for production
2. **Always validate external inputs**: Use validators before processing
3. **Handle calculation edge cases**: Check for division by zero, overflow
4. **Configure retry logic appropriately**: Don't retry non-idempotent operations
5. **Size data structures correctly**: Avoid memory leaks with circular buffers

## Testing

```bash
# Run all tests
npm test

# Test specific utility
npm test -- logger

# Run with coverage
npm run test:coverage
```

## Contributing

When adding new utilities:
1. Place in appropriate category
2. Add comprehensive tests
3. Document with JSDoc
4. Export from index.ts
5. Update this README

## License

MIT 