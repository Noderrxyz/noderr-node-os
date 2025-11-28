# Market Intelligence Module

Advanced market analysis and alpha signal generation for the Noderr Protocol trading bot.

## Overview

The Market Intelligence module provides institutional-grade market analysis capabilities including:

- **Order Book Analysis**: Deep microstructure analysis with spoofing detection
- **Whale Tracking**: On-chain monitoring of large transactions and smart money
- **Arbitrage Scanning**: Multi-strategy arbitrage opportunity detection
- **Sentiment Analysis**: Social media monitoring with FOMO detection
- **Alpha Generation**: Composite signal generation from multiple data sources

## Features

### Order Book Analysis
- Microstructure noise calculation
- Support/resistance level identification
- Liquidity pocket detection
- Spoofing and manipulation detection
- Iceberg order identification
- Price impact estimation
- Direction prediction with confidence scores

### Whale Tracking
- Real-time on-chain transaction monitoring
- Smart money address identification
- Pattern recognition (accumulator, distributor, trader, holder)
- Market impact analysis
- Coordinated activity detection
- Historical pattern analysis

### Arbitrage Scanner
- **Triangular Arbitrage**: Same-exchange path finding
- **Statistical Arbitrage**: Correlation-based pair trading
- **Cross-Exchange Arbitrage**: Price discrepancy exploitation
- **Cross-Chain Arbitrage**: Bridge-based opportunities
- Risk-adjusted profit calculation
- Execution path optimization

### Sentiment Analysis
- Multi-platform social monitoring (Twitter, Reddit, Telegram, Discord)
- Keyword extraction and classification
- Influencer tracking and weighting
- FOMO score calculation
- Trend detection
- Real-time sentiment shifts

## Installation

```bash
npm install @noderr/market-intel
```

## Usage

### Basic Setup

```typescript
import { MarketIntelService, MarketIntelConfig } from '@noderr/market-intel';

const config: MarketIntelConfig = {
  orderBook: {
    depthLevels: 50,
    updateFrequency: 1000,
    spoofingThreshold: 10000,
    minOrderSize: 100,
    icebergDetection: true
  },
  whaleTracking: {
    minTransactionSize: 100000,
    chains: ['ethereum', 'bsc', 'polygon'],
    smartMoneyThreshold: 0.7,
    impactAnalysis: true,
    trackDexActivity: true
  },
  arbitrage: {
    minProfitPercentage: 0.5,
    maxExecutionTime: 300,
    includeFees: true,
    slippageTolerance: 0.01,
    capitalLimit: 1000000
  },
  sentiment: {
    sources: ['twitter', 'reddit'],
    updateInterval: 60000,
    influencerWeight: 1.5,
    minSampleSize: 10,
    languages: ['en']
  },
  alphaGeneration: {
    minConfidence: 0.7,
    combineSignals: true,
    riskAdjusted: true
  }
};

const telemetry = {
  track: (event) => console.log('Telemetry:', event),
  flush: async () => {}
};

const marketIntel = new MarketIntelService(config, telemetry);
```

### Order Book Analysis

```typescript
// Process order book data
const orderBook = {
  symbol: 'ETH/USDT',
  timestamp: new Date(),
  bids: [
    { price: 2000, quantity: 10, orders: 5 },
    { price: 1999, quantity: 20, orders: 8 }
  ],
  asks: [
    { price: 2001, quantity: 15, orders: 6 },
    { price: 2002, quantity: 25, orders: 10 }
  ],
  lastUpdateId: 123456
};

await marketIntel.processOrderBook(orderBook);
```

### Whale Tracking

```typescript
// Track whale activity
const whaleActivity = {
  id: 'tx-123',
  chain: 'ethereum',
  address: '0x...',
  transactionHash: '0x...',
  amount: BigInt('1000000000000000000000'), // 1000 ETH
  tokenSymbol: 'ETH',
  direction: 'accumulation',
  fromAddress: '0x...',
  toAddress: '0x...',
  impactScore: 0.8,
  timestamp: new Date(),
  blockNumber: 12345678
};

await marketIntel.processWhaleActivity(whaleActivity);
```

### Arbitrage Scanning

```typescript
// Scan for arbitrage opportunities
const priceData = [
  {
    symbol: 'ETH/USDT',
    exchange: 'binance',
    bid: 2000,
    ask: 2001,
    bidSize: 100,
    askSize: 150,
    timestamp: new Date()
  },
  {
    symbol: 'ETH/USDT',
    exchange: 'coinbase',
    bid: 2005,
    ask: 2006,
    bidSize: 80,
    askSize: 120,
    timestamp: new Date()
  }
];

const opportunities = await marketIntel.scanArbitrageOpportunities(priceData);
```

### Sentiment Analysis

```typescript
// Process social media post
const socialPost = {
  id: 'post-123',
  source: 'twitter' as const,
  author: 'crypto_whale',
  content: 'ETH looking extremely bullish! 🚀 Breaking out of accumulation zone',
  timestamp: new Date(),
  engagement: {
    likes: 1000,
    retweets: 500,
    comments: 200
  },
  metadata: {
    followersCount: 50000,
    isVerified: true
  }
};

await marketIntel.processSocialPost(socialPost, 'ETH');
```

### Getting Alpha Signals

```typescript
// Get all alpha signals
const signals = marketIntel.getAlphaSignals();

// Filter by symbol
const ethSignals = marketIntel.getAlphaSignals('ETH');

// Filter by type and confidence
const highConfidenceWhaleSignals = marketIntel.getAlphaSignals(
  undefined,
  'whale',
  0.8
);
```

### Event Handling

```typescript
// Listen for critical events
marketIntel.on('critical_event', (event) => {
  console.log('Critical market event:', event);
});

// Listen for alpha signals
marketIntel.on('alpha_signal', (signal) => {
  console.log('New alpha signal:', signal);
  // Execute trading logic
});

// Listen for anomalies
marketIntel.on('anomaly_detected', (anomaly) => {
  console.log('Market anomaly:', anomaly);
  // Adjust risk parameters
});
```

### Market Snapshots and Reports

```typescript
// Generate market snapshot
const snapshot = await marketIntel.generateMarketSnapshot();
console.log('Market snapshot:', snapshot);

// Generate daily intelligence report
const report = await marketIntel.generateIntelligenceReport(new Date());
console.log('Intelligence report:', report.summary);
```

## API Reference

### MarketIntelService

Main service class that orchestrates all market intelligence components.

#### Methods

- `processOrderBook(orderBook: OrderBook): Promise<void>`
- `processWhaleActivity(activity: WhaleActivity): Promise<void>`
- `scanArbitrageOpportunities(priceData: PriceData[]): Promise<ArbitrageOpportunity[]>`
- `processSocialPost(post: SocialPost, symbol: string): Promise<void>`
- `getAlphaSignals(symbol?: string, type?: string, minConfidence?: number): AlphaSignal[]`
- `generateMarketSnapshot(): Promise<MarketSnapshot>`
- `generateIntelligenceReport(date: Date): Promise<IntelligenceReport>`

#### Events

- `critical_event`: Emitted for critical market events
- `alpha_signal`: Emitted when new alpha signal is generated
- `anomaly_detected`: Emitted when market anomaly is detected
- `critical_anomaly`: Emitted for critical anomalies requiring immediate attention

### Component Classes

#### OrderBookAnalyzer
- Deep order book analysis
- Microstructure metrics
- Spoofing detection
- Direction prediction

#### WhaleTracker
- On-chain transaction monitoring
- Smart money identification
- Pattern recognition
- Impact analysis

#### ArbitrageScanner
- Multi-strategy arbitrage detection
- Risk-adjusted profit calculation
- Execution path optimization

#### SentimentAnalyzer
- Social media monitoring
- Sentiment classification
- FOMO detection
- Influencer tracking

## Configuration

### OrderBookConfig
```typescript
{
  depthLevels: number;        // Number of order book levels to analyze
  updateFrequency: number;    // Update frequency in milliseconds
  spoofingThreshold: number;  // Minimum size for spoofing detection
  minOrderSize: number;       // Minimum order size to consider
  icebergDetection: boolean;  // Enable iceberg order detection
}
```

### WhaleTrackingConfig
```typescript
{
  minTransactionSize: number;  // Minimum transaction size in USD
  chains: string[];           // Blockchain networks to monitor
  smartMoneyThreshold: number; // Threshold for smart money classification
  impactAnalysis: boolean;    // Enable market impact analysis
  trackDexActivity: boolean;  // Track DEX transactions
}
```

### ArbitrageScannerConfig
```typescript
{
  minProfitPercentage: number; // Minimum profit percentage
  maxExecutionTime: number;    // Maximum execution time in seconds
  includeFees: boolean;        // Include fees in calculations
  slippageTolerance: number;   // Maximum acceptable slippage
  capitalLimit: number;        // Maximum capital per opportunity
}
```

### SentimentConfig
```typescript
{
  sources: string[];          // Social media sources
  updateInterval: number;     // Update interval in milliseconds
  influencerWeight: number;   // Weight multiplier for influencers
  minSampleSize: number;      // Minimum posts for analysis
  languages: string[];        // Supported languages
}
```

## Best Practices

1. **Resource Management**: The module maintains internal caches and histories. Call `stop()` when shutting down to clean up resources.

2. **Event Handling**: Always handle critical events and anomalies to ensure proper risk management.

3. **Signal Validation**: Validate alpha signals against your risk parameters before execution.

4. **Rate Limiting**: Implement appropriate rate limiting when processing high-frequency data.

5. **Error Handling**: Wrap all async operations in try-catch blocks for proper error handling.

## Performance Considerations

- Order book analysis is optimized for real-time processing
- Whale tracking uses efficient caching for historical data
- Arbitrage scanning runs multiple strategies in parallel
- Sentiment analysis uses keyword extraction for efficiency

## License

MIT 