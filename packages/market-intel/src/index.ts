// Market Intelligence Module Exports

export * from './types';
export { OrderBookAnalyzer } from './OrderBookAnalyzer';
export { WhaleTracker } from './WhaleTracker';
export { ArbitrageScanner } from './ArbitrageScanner';
export { SentimentAnalyzer } from './SentimentAnalyzer';
export { MarketIntelService } from './MarketIntelService';

// Re-export commonly used types for convenience
export type {
  OrderBook,
  OrderBookMetrics,
  WhaleActivity,
  WhalePattern,
  ArbitrageOpportunity,
  SentimentData,
  AlphaSignal,
  MarketSnapshot,
  MarketAnomaly,
  IntelligenceReport,
  MarketIntelConfig
} from './types'; 