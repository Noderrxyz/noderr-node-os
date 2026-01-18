/**
 * Data Replay Engine
 * 
 * Replays historical market data as if it were real-time, with configurable speed.
 * 
 * Features:
 * - Configurable replay speed (1x-100x)
 * - Accurate timestamp simulation
 * - Event-driven architecture
 * - Pause/resume support
 * - Multiple symbol support
 */

import { EventEmitter } from 'events';
import { Logger } from '@noderr/utils';
import { OHLCVData, HistoricalDataLoader, HistoricalDataConfig } from './HistoricalDataLoader';

export interface MarketDataTick {
  symbol: string;
  timestamp: number;
  bid: number;
  ask: number;
  last: number;
  volume: number;
}

export interface ReplayConfig {
  symbols: string[];
  interval: '1m' | '5m' | '15m' | '1h' | '4h' | '1d';
  startTime: number;
  endTime: number;
  speed: number; // 1x = real-time, 10x = 10x faster
  spread: number; // Bid-ask spread as percentage (e.g., 0.001 = 0.1%)
}

export class DataReplayEngine extends EventEmitter {
  private logger: Logger;
  private loader: HistoricalDataLoader;
  private isRunning: boolean = false;
  private isPaused: boolean = false;
  private currentTime: number = 0;
  private replayStartTime: number = 0;
  private dataBySymbol: Map<string, OHLCVData[]> = new Map();
  private indexBySymbol: Map<string, number> = new Map();

  constructor(loader: HistoricalDataLoader) {
    super();
    this.logger = new Logger('DataReplayEngine');
    this.loader = loader;
  }

  /**
   * Start replaying data
   */
  async start(config: ReplayConfig): Promise<void> {
    if (this.isRunning) {
      throw new Error('Replay engine is already running');
    }

    this.logger.info('Starting data replay', {
      symbols: config.symbols,
      interval: config.interval,
      speed: `${config.speed}x`,
      startTime: new Date(config.startTime).toISOString(),
      endTime: new Date(config.endTime).toISOString()
    });

    // Load historical data for all symbols
    await this.loadData(config);

    // Start replay loop
    this.isRunning = true;
    this.currentTime = config.startTime;
    this.replayStartTime = Date.now();

    this.emit('started', { config });

    // Run replay loop
    await this.replayLoop(config);
  }

  /**
   * Load historical data for all symbols
   */
  private async loadData(config: ReplayConfig): Promise<void> {
    this.logger.info(`Loading data for ${config.symbols.length} symbols...`);

    for (const symbol of config.symbols) {
      const dataConfig: HistoricalDataConfig = {
        symbol,
        interval: config.interval,
        startTime: config.startTime,
        endTime: config.endTime
      };

      const data = await this.loader.loadData(dataConfig);
      this.dataBySymbol.set(symbol, data);
      this.indexBySymbol.set(symbol, 0);

      this.logger.debug(`Loaded ${data.length} candles for ${symbol}`);
    }

    this.logger.info('Data loading complete');
  }

  /**
   * Main replay loop
   */
  private async replayLoop(config: ReplayConfig): Promise<void> {
    const intervalMs = this.getIntervalMs(config.interval);
    const tickDelay = (intervalMs / config.speed); // Adjusted for replay speed

    while (this.isRunning && this.currentTime < config.endTime) {
      if (this.isPaused) {
        await this.sleep(100);
        continue;
      }

      // Emit market data for all symbols at current time
      for (const symbol of config.symbols) {
        const tick = this.getNextTick(symbol, config.spread);
        if (tick) {
          this.emit('tick', tick);
        }
      }

      // Advance time
      this.currentTime += intervalMs;

      // Sleep to simulate real-time (adjusted for speed)
      await this.sleep(tickDelay);
    }

    // Replay complete
    this.isRunning = false;
    this.emit('completed', {
      startTime: config.startTime,
      endTime: this.currentTime,
      duration: Date.now() - this.replayStartTime
    });

    this.logger.info('Replay completed', {
      duration: `${((Date.now() - this.replayStartTime) / 1000).toFixed(2)}s`,
      finalTime: new Date(this.currentTime).toISOString()
    });
  }

  /**
   * Get next tick for a symbol
   */
  private getNextTick(symbol: string, spread: number): MarketDataTick | null {
    const data = this.dataBySymbol.get(symbol);
    const index = this.indexBySymbol.get(symbol);

    if (!data || index === undefined || index >= data.length) {
      return null;
    }

    const candle = data[index];

    // Check if this candle is within current time window
    if (candle.timestamp > this.currentTime) {
      return null;
    }

    // Advance index
    this.indexBySymbol.set(symbol, index + 1);

    // Convert OHLCV to tick with bid/ask spread
    const mid = candle.close;
    const halfSpread = mid * spread / 2;

    return {
      symbol,
      timestamp: candle.timestamp,
      bid: mid - halfSpread,
      ask: mid + halfSpread,
      last: candle.close,
      volume: candle.volume
    };
  }

  /**
   * Pause replay
   */
  pause(): void {
    if (!this.isRunning) {
      throw new Error('Replay engine is not running');
    }
    this.isPaused = true;
    this.emit('paused');
    this.logger.info('Replay paused');
  }

  /**
   * Resume replay
   */
  resume(): void {
    if (!this.isRunning) {
      throw new Error('Replay engine is not running');
    }
    this.isPaused = false;
    this.emit('resumed');
    this.logger.info('Replay resumed');
  }

  /**
   * Stop replay
   */
  stop(): void {
    this.isRunning = false;
    this.isPaused = false;
    this.emit('stopped');
    this.logger.info('Replay stopped');
  }

  /**
   * Get current replay time
   */
  getCurrentTime(): number {
    return this.currentTime;
  }

  /**
   * Get replay progress (0-1)
   */
  getProgress(endTime: number): number {
    return (this.currentTime - this.replayStartTime) / (endTime - this.replayStartTime);
  }

  /**
   * Check if replay is running
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Convert interval string to milliseconds
   */
  private getIntervalMs(interval: string): number {
    const map: Record<string, number> = {
      '1m': 60 * 1000,
      '5m': 5 * 60 * 1000,
      '15m': 15 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '4h': 4 * 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000
    };
    return map[interval] || 60 * 1000;
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
