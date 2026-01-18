/**
 * Historical Data Loader
 * 
 * Loads historical OHLCV data from Binance public API (no authentication required)
 * for testnet simulation mode.
 * 
 * Features:
 * - Free Binance public API (no API keys needed)
 * - Configurable time ranges
 * - Multiple timeframes (1m, 5m, 15m, 1h, 4h, 1d)
 * - Automatic rate limiting
 * - Data caching to disk
 */

import { Logger } from '@noderr/utils';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface OHLCVData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface HistoricalDataConfig {
  symbol: string;
  interval: '1m' | '5m' | '15m' | '1h' | '4h' | '1d';
  startTime: number; // Unix timestamp in ms
  endTime: number; // Unix timestamp in ms
  cacheDir?: string;
}

export class HistoricalDataLoader {
  private logger: Logger;
  private cacheDir: string;
  private readonly BINANCE_API_BASE = 'https://api.binance.com/api/v3';
  private readonly MAX_LIMIT = 1000; // Binance API limit per request
  private readonly RATE_LIMIT_DELAY = 100; // ms between requests

  constructor(cacheDir: string = '/app/data/historical') {
    this.logger = new Logger('HistoricalDataLoader');
    this.cacheDir = cacheDir;
  }

  /**
   * Load historical OHLCV data for a symbol
   */
  async loadData(config: HistoricalDataConfig): Promise<OHLCVData[]> {
    this.logger.info(`Loading historical data for ${config.symbol} (${config.interval})`, {
      startTime: new Date(config.startTime).toISOString(),
      endTime: new Date(config.endTime).toISOString()
    });

    // Check cache first
    const cachedData = await this.loadFromCache(config);
    if (cachedData) {
      this.logger.info(`Loaded ${cachedData.length} candles from cache`);
      return cachedData;
    }

    // Fetch from Binance API
    const data = await this.fetchFromBinance(config);
    
    // Save to cache
    await this.saveToCache(config, data);
    
    this.logger.info(`Loaded ${data.length} candles from Binance API`);
    return data;
  }

  /**
   * Fetch data from Binance public API
   */
  private async fetchFromBinance(config: HistoricalDataConfig): Promise<OHLCVData[]> {
    const allData: OHLCVData[] = [];
    let currentStartTime = config.startTime;

    while (currentStartTime < config.endTime) {
      const url = `${this.BINANCE_API_BASE}/klines?symbol=${config.symbol}&interval=${config.interval}&startTime=${currentStartTime}&endTime=${config.endTime}&limit=${this.MAX_LIMIT}`;

      try {
        const response = await fetch(url);
        
        if (!response.ok) {
          throw new Error(`Binance API error: ${response.status} ${response.statusText}`);
        }

        const rawData = await response.json() as any[];

        if (rawData.length === 0) {
          break; // No more data
        }

        // Convert Binance format to OHLCVData
        const candles: OHLCVData[] = rawData.map(candle => ({
          timestamp: candle[0],
          open: parseFloat(candle[1]),
          high: parseFloat(candle[2]),
          low: parseFloat(candle[3]),
          close: parseFloat(candle[4]),
          volume: parseFloat(candle[5])
        }));

        allData.push(...candles);

        // Update start time for next batch
        currentStartTime = candles[candles.length - 1].timestamp + 1;

        // Rate limiting
        await this.sleep(this.RATE_LIMIT_DELAY);

      } catch (error) {
        this.logger.error('Failed to fetch data from Binance', { error, url });
        throw error;
      }
    }

    return allData;
  }

  /**
   * Load data from cache
   */
  private async loadFromCache(config: HistoricalDataConfig): Promise<OHLCVData[] | null> {
    try {
      const cacheFile = this.getCacheFilePath(config);
      const data = await fs.readFile(cacheFile, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      // Cache miss or error
      return null;
    }
  }

  /**
   * Save data to cache
   */
  private async saveToCache(config: HistoricalDataConfig, data: OHLCVData[]): Promise<void> {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
      const cacheFile = this.getCacheFilePath(config);
      await fs.writeFile(cacheFile, JSON.stringify(data, null, 2));
      this.logger.debug(`Saved ${data.length} candles to cache: ${cacheFile}`);
    } catch (error) {
      this.logger.error('Failed to save cache', { error });
    }
  }

  /**
   * Get cache file path for a config
   */
  private getCacheFilePath(config: HistoricalDataConfig): string {
    const filename = `${config.symbol}_${config.interval}_${config.startTime}_${config.endTime}.json`;
    return path.join(this.cacheDir, filename);
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get available symbols from Binance
   */
  async getAvailableSymbols(): Promise<string[]> {
    try {
      const url = `${this.BINANCE_API_BASE}/exchangeInfo`;
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Binance API error: ${response.status}`);
      }

      const data = await response.json() as any;
      return data.symbols
        .filter((s: any) => s.status === 'TRADING')
        .map((s: any) => s.symbol);
    } catch (error) {
      this.logger.error('Failed to fetch available symbols', { error });
      return [];
    }
  }

  /**
   * Clear cache
   */
  async clearCache(): Promise<void> {
    try {
      await fs.rm(this.cacheDir, { recursive: true, force: true });
      this.logger.info('Cache cleared');
    } catch (error) {
      this.logger.error('Failed to clear cache', { error });
    }
  }
}
