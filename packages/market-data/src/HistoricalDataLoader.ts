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

import { Logger } from '@noderr/utils/src';
import * as fs from 'fs/promises';
import * as path from 'path';
import { z } from 'zod';

// MEDIUM FIX #84: Add schema validation for API responses
const BinanceKlineSchema = z.tuple([
  z.number(), // Open time
  z.string(), // Open
  z.string(), // High
  z.string(), // Low
  z.string(), // Close
  z.string(), // Volume
  z.number(), // Close time
  z.string(), // Quote asset volume
  z.number(), // Number of trades
  z.string(), // Taker buy base asset volume
  z.string(), // Taker buy quote asset volume
  z.string()  // Ignore
]);

const BinanceKlinesResponseSchema = z.array(BinanceKlineSchema);

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
  private readonly apiBaseUrl: string;
  private readonly MAX_LIMIT = 1000; // Binance API limit per request
  private readonly RATE_LIMIT_DELAY = 100; // ms between requests
  // LOW FIX #85: Add seed for deterministic mock data generation
  private mockDataSeed: number = 42;

  constructor(
    cacheDir: string = '/app/data/historical',
    apiBaseUrl?: string,
    mockDataSeed?: number
  ) {
    this.logger = new Logger('HistoricalDataLoader');
    this.cacheDir = cacheDir;
    // MEDIUM FIX #82: Make API endpoint configurable
    this.apiBaseUrl = apiBaseUrl || process.env.MARKET_DATA_API_URL || 'https://api.binance.com/api/v3';
    // LOW FIX #85: Allow custom seed for deterministic testing
    if (mockDataSeed !== undefined) {
      this.mockDataSeed = mockDataSeed;
    }
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
        if (process.env.NODE_ENV === 'test') {
            return this.generateMockData(config);
        }

    const allData: OHLCVData[] = [];
    let currentStartTime = config.startTime;

    while (currentStartTime < config.endTime) {
      const url = `${this.apiBaseUrl}/klines?symbol=${config.symbol}&interval=${config.interval}&startTime=${currentStartTime}&endTime=${config.endTime}&limit=${this.MAX_LIMIT}`;

      // MEDIUM FIX #83: Add retry logic with exponential backoff
      let retries = 0;
      const maxRetries = 3;
      let success = false;
      let rawData: any[] = [];
      
      while (!success && retries <= maxRetries) {
        try {
          const response = await fetch(url);
          
          if (!response.ok) {
            throw new Error(`API error: ${response.status} ${response.statusText}`);
          }

          const jsonData = await response.json();
          // MEDIUM FIX #84: Validate API response with Zod
          const validationResult = BinanceKlinesResponseSchema.safeParse(jsonData);
          if (!validationResult.success) {
            throw new Error(`Invalid API response format: ${validationResult.error.message}`);
          }
          rawData = validationResult.data;
          success = true;
        } catch (fetchError) {
          retries++;
          if (retries > maxRetries) {
            this.logger.error('Failed to fetch data after retries', { error: fetchError, url, retries });
            throw fetchError;
          }
          // Exponential backoff: 1s, 2s, 4s
          const backoffMs = Math.pow(2, retries - 1) * 1000;
          this.logger.warn(`Fetch failed, retrying in ${backoffMs}ms`, { retries, maxRetries });
          await this.sleep(backoffMs);
        }
      }

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
  // LOW FIX #85: Seeded random generator for deterministic mock data
  private seededRandom(): number {
    this.mockDataSeed = (this.mockDataSeed * 9301 + 49297) % 233280;
    return this.mockDataSeed / 233280;
  }

  private generateMockData(config: HistoricalDataConfig): OHLCVData[] {
    const data: OHLCVData[] = [];
    let currentTime = config.startTime;
    // LOW FIX #85: Use seeded random for deterministic behavior
    let lastClose = 10000 + this.seededRandom() * 5000;

    // LOW FIX #85: Respect config.interval instead of hardcoding 1 minute
    const intervalMs = this.parseInterval(config.interval);

    while (currentTime < config.endTime) {
        const open = lastClose;
        const high = open * (1 + (this.seededRandom() - 0.4) * 0.01);
        const low = open * (1 - (this.seededRandom() - 0.4) * 0.01);
        const close = (high + low) / 2 + (this.seededRandom() - 0.5) * (high - low);
        const volume = this.seededRandom() * 100;

        data.push({ timestamp: currentTime, open, high, low, close, volume });

        lastClose = close;
        currentTime += intervalMs;
    }
    this.logger.info(`Generated ${data.length} mock candles for testing with interval ${config.interval}.`);
    return data;
  }

  // LOW FIX #85: Parse interval string to milliseconds
  private parseInterval(interval: string): number {
    const match = interval.match(/^(\d+)([mhd])$/);
    if (!match) {
      this.logger.warn(`Invalid interval format: ${interval}, defaulting to 1m`);
      return 60000;
    }
    const [, value, unit] = match;
    const num = parseInt(value, 10);
    switch (unit) {
      case 'm': return num * 60000;
      case 'h': return num * 3600000;
      case 'd': return num * 86400000;
      default: return 60000;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get available symbols from Binance
   */
  async getAvailableSymbols(): Promise<string[]> {
    try {
      const url = `${this.apiBaseUrl}/exchangeInfo`;
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
