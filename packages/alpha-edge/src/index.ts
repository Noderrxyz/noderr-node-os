/**
 * Alpha Edge - World-class alpha generation infrastructure
 * 
 * Comprehensive suite of advanced trading modules for
 * market microstructure analysis, arbitrage detection,
 * tail risk management, and sophisticated trading strategies.
 */

// Export types
export * from './types';

// Export microstructure module
export { MicrostructureAnalyzer } from './microstructure/MicrostructureAnalyzer';

// Export arbitrage module
export { ArbitrageEngine } from './arbitrage/ArbitrageEngine';

// Export risk analytics module
export { TailRiskManager } from './risk-analytics/TailRiskManager';

// Re-export commonly used types for convenience
export type {
  OrderBookSnapshot,
  MicrostructureSignal,
  ArbitrageOpportunity,
  TailRiskMetrics,
  RegimeDetection,
  PortfolioOptimization
} from './types'; 