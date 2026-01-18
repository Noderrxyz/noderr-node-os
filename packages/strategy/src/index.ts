/**
 * @noderr/strategy - Trading Strategy Service
 * 
 * Manages trading strategies and signal generation.
 * 
 * Features:
 * - Strategy execution
 * - Signal aggregation
 * - Strategy performance tracking
 * - Risk-adjusted position sizing
 */

import { Logger } from '@noderr/utils/src';
import { getShutdownHandler, onShutdown } from '@noderr/utils/src';
import { startStrategyIngestionApi } from './StrategyIngestionApi';
import { MockStrategy } from './MockStrategy';

/**
 * Strategy Service
 */
export class StrategyService {
  private logger: Logger;
  private strategies: Map<string, any> = new Map();
  private config: { strategies: string[] };
  
  constructor(config: {
    strategies: string[];
  }) {
    this.logger = new Logger('StrategyService');
    this.logger.info("StrategyService initialized", config);
    this.config = config;
  }
  
  async start(): Promise<void> {
    this.logger.info('Starting strategies...');
    
    // Initialize and start all configured strategies
    for (const name of this.config.strategies) {
        const strategy = new MockStrategy(name);
        this.strategies.set(name, strategy);
        await strategy.start();
        this.logger.info(`Initialized and started strategy: ${name}`);
    }
  }
  
  async stop(): Promise<void> {
    this.logger.info('Stopping strategies...');
    
    for (const [name, strategy] of this.strategies) {
      try {
        if (strategy && typeof strategy.stop === 'function') {
          await strategy.stop();
        }
        this.logger.info(`Stopped strategy: ${name}`);
      } catch (error) {
        this.logger.error(`Error stopping strategy ${name}`, error);
      }
    }
    
    this.strategies.clear();
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

let strategyService: StrategyService | null = null;

export async function startStrategyService(): Promise<void> {
  const logger = new Logger('StrategyService');
  
  try {
    logger.info('Starting Strategy Service...');

    // Start the Strategy Ingestion API if configured to do so
    if (process.env.RUN_INGESTION_API === 'true') {
      logger.info('Starting Strategy Ingestion API...');
      startStrategyIngestionApi();
    }
    
    const strategies = process.env.STRATEGIES?.split(',') || ['momentum', 'mean-reversion', 'arbitrage'];
    
    strategyService = new StrategyService({ strategies });
    await strategyService.start();
    
    onShutdown('strategy-service', async () => {
      logger.info('Shutting down strategy service...');
      
      if (strategyService) {
        await strategyService.stop();
      }
      
      logger.info('Strategy service shut down complete');
    }, 15000);
    
    logger.info('Strategy Service started successfully');
    await new Promise(() => {});
  } catch (error) {
    logger.error('Failed to start Strategy Service', error);
    throw error;
  }
}

if (require.main === module) {
  getShutdownHandler(30000);
  // LOW FIX: Use logger instead of console.error
  const logger = new Logger('StrategyService');
  startStrategyService().catch((error) => {
    logger.error('Fatal error starting Strategy Service', error);
    process.exit(1);
  });
}
