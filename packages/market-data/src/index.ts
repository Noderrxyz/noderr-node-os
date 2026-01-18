/**
 * @noderr/market-data - Real-time Market Data Service
 * 
 * Aggregates and distributes real-time market data from multiple sources.
 * 
 * Features:
 * - Multi-exchange data aggregation
 * - WebSocket connections
 * - Order book management
 * - Trade stream processing
 * - Ticker updates
 * - OHLCV candles
 */

import { Logger, getShutdownHandler, onShutdown } from '@noderr/utils';
import { SimulationEventBus, eventBus, EventTopics } from '@noderr/core/src';

export { MarketDataRingBuffer, MarketDataRingBufferView, RingBufferBenchmark, MarketDataPoint } from './RingBuffer';
export { HistoricalDataLoader, OHLCVData, HistoricalDataConfig } from './HistoricalDataLoader';
export { DataReplayEngine, MarketDataTick, ReplayConfig } from './DataReplayEngine';

/**
 * Market Data Service
 */
export class MarketDataService {
  private logger: Logger;
  private connections: Map<string, any> = new Map();
  private subscriptions: Map<string, Set<string>> = new Map();
  
  constructor(config: {
    exchanges: string[];
    symbols: string[];
  }) {
    this.logger = new Logger('MarketDataService');
    this.logger.info('MarketDataService initialized', config);
  }
  
  /**
   * Connect to exchanges (or start simulation)
   */
  async connect(): Promise<void> {
    const isSimulation = process.env.SIMULATION_MODE === 'true';
    
    if (isSimulation) {
      this.logger.info('Starting in SIMULATION MODE - using historical data replay');
      // Simulation mode will be started via startSimulation()
    } else {
      this.logger.info('Connecting to live exchanges...');
      // TODO: Implement live exchange connections
      this.logger.warn('Live exchange connections not yet implemented');
    }
  }
  
  /**
   * Subscribe to market data
   */
  async subscribe(exchange: string, symbol: string, channels: string[]): Promise<void> {
    this.logger.info('Subscribing to market data', { exchange, symbol, channels });
    
    const key = `${exchange}:${symbol}`;
    if (!this.subscriptions.has(key)) {
      this.subscriptions.set(key, new Set());
    }
    channels.forEach(channel => this.subscriptions.get(key)!.add(channel));
  }
  
  /**
   * Start simulation mode with historical data replay
   */
  async startSimulation(config: {
    symbols: string[];
    interval: '1m' | '5m' | '15m' | '1h' | '4h' | '1d';
    startTime: number;
    endTime: number;
    speed: number;
  }): Promise<void> {
    this.logger.info('Starting historical data replay simulation', config);
    
    const { HistoricalDataLoader } = await import('./HistoricalDataLoader');
    const { DataReplayEngine } = await import('./DataReplayEngine');
    
    const loader = new HistoricalDataLoader();
    const replayEngine = new DataReplayEngine(loader);
    
    // Forward ticks to subscribers and publish to event bus
    replayEngine.on('tick', (tick) => {
      this.logger.debug('Market data tick', tick);
      
      // Publish to event bus for other services
      // Note: Strategies are designed to consume candles, not raw ticks.
      // We convert the tick to a candle format for simplicity in this simulation.
      // In a real system, we would aggregate ticks into proper OHLCV candles.
      eventBus.publish(EventTopics.MARKET_DATA_CANDLE, {
        symbol: tick.symbol,
        open: tick.last,
        high: tick.last,
        low: tick.last,
        close: tick.last,
        volume: tick.volume,
        timestamp: tick.timestamp,
      }, 'market-data');
    });
    
    replayEngine.on('completed', () => {
      this.logger.info('Historical data replay completed');
    });
    
    await replayEngine.start({
      symbols: config.symbols,
      interval: config.interval,
      startTime: config.startTime,
      endTime: config.endTime,
      speed: config.speed,
      spread: 0.001 // 0.1% bid-ask spread
    });
  }
  
  /**
   * Disconnect from exchanges
   */
  async disconnect(): Promise<void> {
    this.logger.info('Disconnecting from exchanges...');
    
    for (const [exchange, connection] of this.connections) {
      try {
        if (connection && typeof connection.close === 'function') {
          await connection.close();
        }
        this.logger.info(`Disconnected from ${exchange}`);
      } catch (error) {
        this.logger.error(`Error disconnecting from ${exchange}`, error);
      }
    }
    
    this.connections.clear();
    this.subscriptions.clear();
  }
  
  /**
   * QUICK WIN: Health check method for monitoring
   */
  async healthCheck(): Promise<{
    status: 'healthy' | 'unhealthy';
    timestamp: string;
    checks: Record<string, string>;
    subscriptions: number;
    connections: number;
  }> {
    const checks: Record<string, string> = {};
    let allHealthy = true;
    
    // Check if event bus is working
    try {
      const eventBus = SimulationEventBus.getInstance();
      checks.eventBus = 'ok';
    } catch (error) {
      checks.eventBus = 'error';
      allHealthy = false;
    }
    
    // Check connections
    checks.connections = `${this.connections.size} active`;
    checks.subscriptions = `${this.subscriptions.size} active`;
    
    return {
      status: allHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      checks,
      subscriptions: this.subscriptions.size,
      connections: this.connections.size
    };
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

// MEDIUM FIX #71: Global mutable state note
// This module-level variable implements the singleton pattern for the service.
// While global mutable state is generally an anti-pattern, it's acceptable here because:
// - MarketDataService is designed as a singleton (only one instance should exist)
// - The service is stateful by nature (manages connections and subscriptions)
// - For testing, use dependency injection by importing the class directly
// - Alternative: Use a service container or DI framework for more complex apps
let marketDataService: MarketDataService | null = null;

/**
 * Start the market data service
 */
export async function startMarketDataService(): Promise<void> {
  const logger = new Logger('MarketDataService');
  
  try {
    logger.info('Starting Market Data Service...');
    
    // Parse configuration from environment
    const exchanges = process.env.EXCHANGES?.split(',') || ['binance', 'coinbase', 'kraken'];
    const symbols = process.env.SYMBOLS?.split(',') || ['BTC/USDT', 'ETH/USDT'];
    
    // Initialize service
    marketDataService = new MarketDataService({
      exchanges,
      symbols,
    });
    
    // Connect to exchanges
    await marketDataService.connect();
    
    // Subscribe to market data
    for (const exchange of exchanges) {
      for (const symbol of symbols) {
        await marketDataService.subscribe(exchange, symbol, ['ticker', 'orderbook', 'trades']);
      }
    }
    
    // Register graceful shutdown handlers
    onShutdown('market-data-service', async () => {
      logger.info('Shutting down market data service...');
      
      if (marketDataService) {
        // Disconnect from all exchanges
        await marketDataService.disconnect();
      }
      
      logger.info('Market data service shut down complete');
    }, 15000);  // 15 second timeout
    
    logger.info('Market Data Service started successfully');
    
    // Keep process alive
    await new Promise(() => {});  // Never resolves
  } catch (error) {
    logger.error('Failed to start Market Data Service', error);
    throw error;
  }
}

/**
 * If run directly, start the service
 */
if (require.main === module) {
  // Initialize graceful shutdown
  getShutdownHandler(30000);  // 30 second global timeout
  
  // LOW FIX: Use logger instead of console.error
  const logger = new Logger('MarketDataService');
  startMarketDataService().catch((error) => {
    logger.error('Fatal error starting Market Data Service', error);
    process.exit(1);
  });
}
