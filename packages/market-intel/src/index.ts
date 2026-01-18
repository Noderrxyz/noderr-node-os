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

// ============================================================================
// Main Entry Point
// ============================================================================

import { Logger } from '@noderr/utils';
import { getShutdownHandler, onShutdown } from '@noderr/utils';
import { TelemetryClient } from '@noderr/telemetry';
import { MarketIntelService } from './MarketIntelService';

let marketIntelService: MarketIntelService | null = null;

export async function startMarketIntelService(): Promise<void> {
  const logger = new Logger('MarketIntelService');
  const telemetry = new TelemetryClient();
  
  try {
    logger.info('Starting Market Intelligence Service...');
    
    // Initialize market intelligence service
    marketIntelService = new MarketIntelService({
      symbols: process.env.SYMBOLS?.split(',') || ['BTC/USDT', 'ETH/USDT'],
      updateInterval: parseInt(process.env.UPDATE_INTERVAL || '5000'),
      enableArbitrage: process.env.ENABLE_ARBITRAGE !== 'false',
      enableWhaleTracking: process.env.ENABLE_WHALE_TRACKING !== 'false',
      enableSentiment: process.env.ENABLE_SENTIMENT !== 'false',
    }, telemetry);
    
    // Start monitoring
    await marketIntelService.start();
    
    onShutdown('market-intel-service', async () => {
      logger.info('Shutting down market intelligence service...');
      
      if (marketIntelService) {
        await marketIntelService.stop();
      }
      
      logger.info('Market intelligence service shut down complete');
    }, 15000);
    
    logger.info('Market Intelligence Service started successfully');
    await new Promise(() => {});
  } catch (error) {
    logger.error('Failed to start Market Intelligence Service', error);
    throw error;
  }
}

if (require.main === module) {
  getShutdownHandler(30000);
  startMarketIntelService().catch((error) => {
    console.error('Fatal error starting Market Intelligence Service:', error);
    process.exit(1);
  });
}
