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
import { MarketIntelService } from './MarketIntelService';
import { TelemetryClient } from './types';

let marketIntelService: MarketIntelService | null = null;

export async function startMarketIntelService(): Promise<void> {
  const logger = new Logger('MarketIntelService');
  
  // Create a simple telemetry client implementation
  const telemetry: TelemetryClient = {
    track: (event) => {
      logger.debug('Telemetry event', { event });
    },
    flush: async () => {
      // No-op for now
    }
  };
  
  try {
    logger.info('Starting Market Intelligence Service...');
    
    // Initialize market intelligence service
    marketIntelService = new MarketIntelService({
      orderBook: {
        depthLevels: 10,
        updateFrequency: 1000,
        spoofingThreshold: 0.3,
        minOrderSize: 1000,
        icebergDetection: true
      },
      whaleTracking: {
        minTransactionSize: 100000,
        chains: ['ethereum', 'bsc', 'polygon'],
        smartMoneyThreshold: 1000000,
        impactAnalysis: true,
        trackDexActivity: true
      },
      arbitrage: {
        minProfitPercentage: 0.5,
        maxExecutionTime: 5000,
        includeFees: true,
        slippageTolerance: 0.01,
        capitalLimit: 1000000
      },
      sentiment: {
        sources: ['twitter', 'reddit', 'telegram'],
        updateInterval: parseInt(process.env.UPDATE_INTERVAL || '5000'),
        influencerWeight: 2.0,
        minSampleSize: 100,
        languages: ['en']
      },
      alphaGeneration: {
        minConfidence: 0.7,
        combineSignals: true,
        riskAdjusted: true
      }
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
