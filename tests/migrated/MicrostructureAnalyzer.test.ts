/**
 * Tests for MicrostructureAnalyzer
 * 
 * @jest-environment node
 */

import { MicrostructureAnalyzer } from '@noderr/src/infra/marketdata/MicrostructureAnalyzer';
import { RedisClient } from '@noderr/src/infra/core/RedisClient';

// Add TypeScript declarations for Jest globals
declare const describe: (name: string, fn: () => void) => void;
declare const beforeEach: (fn: () => void) => void;
declare const it: (name: string, fn: () => void | Promise<void>) => void;
declare const expect: any;

// Mock Redis client for testing
class MockRedisClient {
  private storage: Record<string, any> = {};
  private hashStorage: Record<string, Record<string, any>> = {};
  private listStorage: Record<string, any[]> = {};

  async get(key: string): Promise<string | null> {
    return this.storage[key] || null;
  }

  async set(key: string, value: string): Promise<string> {
    this.storage[key] = value;
    return 'OK';
  }

  async hgetall(key: string): Promise<Record<string, string> | null> {
    return this.hashStorage[key] || null;
  }

  async hset(key: string, field: string, value: string): Promise<number> {
    if (!this.hashStorage[key]) {
      this.hashStorage[key] = {};
    }
    this.hashStorage[key][field] = value;
    return 1;
  }

  async lpush(key: string, value: string): Promise<number> {
    if (!this.listStorage[key]) {
      this.listStorage[key] = [];
    }
    this.listStorage[key].unshift(value);
    return this.listStorage[key].length;
  }

  async ltrim(key: string, start: number, stop: number): Promise<string> {
    if (this.listStorage[key]) {
      this.listStorage[key] = this.listStorage[key].slice(start, stop + 1);
    }
    return 'OK';
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    if (!this.listStorage[key]) {
      return [];
    }
    const end = stop === -1 ? undefined : stop + 1;
    return this.listStorage[key].slice(start, end);
  }

  async quit(): Promise<string> {
    return 'OK';
  }
}

describe('MicrostructureAnalyzer', () => {
  let redis: any;
  let analyzer: MicrostructureAnalyzer;
  const venue = 'test_venue';

  beforeEach(() => {
    redis = new MockRedisClient();
    analyzer = new MicrostructureAnalyzer(redis as unknown as RedisClient);
  });

  describe('analyze', () => {
    it('should return null if no orderbook data is available', async () => {
      const result = await analyzer.analyze(venue);
      expect(result).toBeNull();
    });

    it('should calculate metrics from orderbook data', async () => {
      // Mock orderbook data
      const orderbook = {
        bids: [
          [100, 10], // [price, size]
          [99, 15],
          [98, 20]
        ],
        asks: [
          [101, 5],
          [102, 10],
          [103, 15]
        ]
      };

      // Store the orderbook data
      await redis.hset(`orderbook:${venue}`, 'snapshot', JSON.stringify(orderbook));

      // Analyze the orderbook
      const result = await analyzer.analyze(venue);

      // Verify the metrics are calculated correctly
      expect(result).not.toBeNull();
      if (result) {
        expect(result.timestamp).toBeGreaterThan(0);
        expect(result.topImbalance).toBeCloseTo(0.33, 1); // (10-5)/(10+5)
        expect(result.sweepRisk).toBeGreaterThan(0); // Low depth on ask side
      }
    });
  });

  describe('detectSpoofing', () => {
    it('should detect spoofing patterns in order history', async () => {
      // Create a history of order books with a large order that disappears
      const orderbook1 = {
        bids: [[100, 50]], // Large order at the best bid
        asks: [[101, 5]]
      };
      
      const orderbook2 = {
        bids: [[100, 5]], // Large order disappeared
        asks: [[101, 5]]
      };

      // Store the orderbook data in the spoofing history
      const spoofKey = `ob:spoofing:${venue}`;
      await redis.lpush(spoofKey, JSON.stringify(orderbook1));
      await redis.lpush(spoofKey, JSON.stringify(orderbook2));
      
      // Analyze the orderbook
      const result = await analyzer.analyze(venue);
      
      // Should detect spoofing
      expect(result).not.toBeNull();
      if (result) {
        expect(result.spoofingScore).toBeGreaterThan(0);
      }
    });
  });

  describe('storeOrderbookSnapshot', () => {
    it('should store orderbook snapshot correctly', async () => {
      const snapshot = JSON.stringify({
        bids: [[100, 10]],
        asks: [[101, 5]]
      });

      await analyzer.storeOrderbookSnapshot(venue, snapshot);

      // Verify the snapshot was stored
      const spoofKey = `ob:spoofing:${venue}`;
      const storedSnapshots = await redis.lrange(spoofKey, 0, -1);
      expect(storedSnapshots.length).toBe(1);
      expect(storedSnapshots[0]).toBe(snapshot);

      // Verify it was stored in the main orderbook hash
      const orderbook = await redis.hgetall(`orderbook:${venue}`);
      expect(orderbook).not.toBeNull();
      expect(orderbook.snapshot).toBe(snapshot);
    });
  });

  describe('storeMetrics', () => {
    it('should store metrics for historical analysis', async () => {
      const metrics = {
        timestamp: Date.now(),
        topImbalance: 0.3,
        spoofingScore: 0.1,
        spreadPressure: 0.01,
        quoteVolatility: 0.2,
        sweepRisk: 0.5
      };

      await analyzer.storeMetrics(venue, metrics);

      // Verify the metrics were stored
      const key = `metrics:microstructure:${venue}`;
      const storedMetrics = await redis.lrange(key, 0, -1);
      expect(storedMetrics.length).toBe(1);
      expect(JSON.parse(storedMetrics[0])).toEqual(metrics);
    });
  });
}); 