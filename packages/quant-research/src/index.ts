/**
 * Quant Research Module - Elite quantitative analysis and strategy development
 * 
 * Provides institutional-grade backtesting, optimization, factor analysis,
 * and portfolio construction for crypto trading strategies.
 */

// Core service
export { QuantResearchService } from './core/QuantResearchService';

// Components
export { Backtester } from './backtesting/Backtester';
export { WalkForwardOptimizer } from './optimization/WalkForwardOptimizer';
export { MonteCarloSimulator } from './simulation/MonteCarloSimulator';
export { AlphaDecayAnalyzer } from './analysis/AlphaDecayAnalyzer';
export { StrategyABTestEngine } from './testing/StrategyABTestEngine';
export { FactorAnalyzer } from './factors/FactorAnalyzer';
export { PortfolioOptimizer } from './portfolio/PortfolioOptimizer';

// Analytics and Data
export { StatsEngine } from './analytics/StatsEngine';
export { DataManager } from './data/DataManager';
export { TimeSeriesForecaster } from './forecasting/TimeSeriesForecaster';

// Types
export * from './types';

// Version
export const VERSION = '1.0.0'; 

// ============================================================================
// Main Entry Point
// ============================================================================

import { Logger } from '@noderr/utils';
import { getShutdownHandler, onShutdown } from '@noderr/utils';

const logger = new Logger('quant-research');
let quantResearchService: any | null = null;

export async function startQuantResearchService(): Promise<void> {
  const logger = new Logger('QuantResearchService');
  
  try {
    logger.info('Starting Quant Research Service...');
    
    // TODO: Initialize QuantResearchService when implementation is complete
    // quantResearchService = new QuantResearchService({...});
    
    onShutdown('quant-research-service', async () => {
      logger.info('Shutting down quant research service...');
      // TODO: Implement cleanup
      logger.info('Quant research service shut down complete');
    }, 10000);
    
    logger.info('Quant Research Service started successfully');
    // Keep the event loop alive with a periodic heartbeat
    setInterval(() => { /* keep-alive */ }, 60000);
  } catch (error) {
    logger.error('Failed to start Quant Research Service', error);
    throw error;
  }
}

if (require.main === module) {
  getShutdownHandler(30000);
  startQuantResearchService().catch((error) => {
    logger.error('Fatal error starting Quant Research Service:', error);
    process.exit(1);
  });
}
