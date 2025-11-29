import { ValidatorNode } from '../../feeds/validator/ValidatorNode.js';
import { MarketSnapshot } from '../../types/MarketSnapshot.types.js';
import { QuarantineManager } from '../../feeds/quarantine/QuarantineManager.js';
import { FeedBus } from '../../feeds/publishers/FeedBus.js';
import { FeedSource } from '../../types/FeedSource.js';

describe('ValidatorNode', () => {
  let validator: ValidatorNode;
  let quarantineManager: QuarantineManager;
  let feedBus: FeedBus;
  let receivedSnapshots: MarketSnapshot[];

  beforeEach(() => {
    validator = new ValidatorNode(FeedSource.BINANCE, {
      quarantineThresholdMs: 1000,
      maxHistorySize: 5
    });
    
    quarantineManager = QuarantineManager.getInstance();
    quarantineManager.registerValidator(FeedSource.BINANCE, validator);
    
    feedBus = FeedBus.getInstance();
    receivedSnapshots = [];
    
    feedBus.subscribe((snapshot) => {
      receivedSnapshots.push(snapshot);
    });
  });

  afterEach(() => {
    quarantineManager.cleanup();
  });

  describe('Latency Tracking', () => {
    it('should track latency correctly', () => {
      const snapshot: MarketSnapshot = {
        source: FeedSource.BINANCE,
        symbol: 'TEST/USD',
        timestamp: Date.now() - 500,
        lastPrice: 100.0,
        lastSize: 1.0
      };

      validator.registerSnapshot(snapshot);
      expect(validator.getMetrics().latencyMs).toBeGreaterThanOrEqual(500);
    });

    it('should detect delayed feeds', () => {
      const snapshot: MarketSnapshot = {
        source: FeedSource.BINANCE,
        symbol: 'TEST/USD',
        timestamp: Date.now() - 2000,
        lastPrice: 100.0,
        lastSize: 1.0
      };

      validator.registerSnapshot(snapshot);
      expect(validator.isDelayed(1000)).toBe(true);
    });
  });

  describe('Data Corruption Detection', () => {
    it('should detect corrupted data', () => {
      const snapshot: MarketSnapshot = {
        source: FeedSource.BINANCE,
        symbol: 'TEST/USD',
        timestamp: Date.now(),
        lastPrice: NaN,
        lastSize: 1.0
      };

      validator.registerSnapshot(snapshot);
      expect(validator.isCorrupted()).toBe(true);
    });

    it('should detect invalid timestamps', () => {
      const snapshot: MarketSnapshot = {
        source: FeedSource.BINANCE,
        symbol: 'TEST/USD',
        timestamp: -1,
        lastPrice: 100.0,
        lastSize: 1.0
      };

      validator.registerSnapshot(snapshot);
      expect(validator.isCorrupted()).toBe(true);
    });
  });

  describe('Quarantine Functionality', () => {
    it('should quarantine feeds with high latency', () => {
      const snapshot: MarketSnapshot = {
        source: FeedSource.BINANCE,
        symbol: 'TEST/USD',
        timestamp: Date.now() - 2000,
        lastPrice: 100.0,
        lastSize: 1.0
      };

      validator.registerSnapshot(snapshot);
      expect(validator.isInQuarantine()).toBe(true);
    });

    it('should quarantine feeds with corrupted data', () => {
      const snapshot: MarketSnapshot = {
        source: FeedSource.BINANCE,
        symbol: 'TEST/USD',
        timestamp: Date.now(),
        lastPrice: NaN,
        lastSize: 1.0
      };

      validator.registerSnapshot(snapshot);
      expect(validator.isInQuarantine()).toBe(true);
    });

    it('should release from quarantine when conditions improve', () => {
      // First, trigger quarantine
      const badSnapshot: MarketSnapshot = {
        source: FeedSource.BINANCE,
        symbol: 'TEST/USD',
        timestamp: Date.now() - 2000,
        lastPrice: 100.0,
        lastSize: 1.0
      };

      validator.registerSnapshot(badSnapshot);
      expect(validator.isInQuarantine()).toBe(true);

      // Then, send good data
      const goodSnapshot: MarketSnapshot = {
        source: FeedSource.BINANCE,
        symbol: 'TEST/USD',
        timestamp: Date.now() - 100,
        lastPrice: 100.0,
        lastSize: 1.0
      };

      validator.registerSnapshot(goodSnapshot);
      expect(validator.isInQuarantine()).toBe(false);
    });
  });

  describe('Score Calculation', () => {
    it('should calculate score based on latency and data quality', () => {
      const snapshot: MarketSnapshot = {
        source: FeedSource.BINANCE,
        symbol: 'TEST/USD',
        timestamp: Date.now() - 500,
        lastPrice: 100.0,
        lastSize: 1.0
      };

      validator.registerSnapshot(snapshot);
      const score = validator.score();
      
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThanOrEqual(1);
    });

    it('should lower score for high latency', () => {
      const snapshot: MarketSnapshot = {
        source: FeedSource.BINANCE,
        symbol: 'TEST/USD',
        timestamp: Date.now() - 2000,
        lastPrice: 100.0,
        lastSize: 1.0
      };

      validator.registerSnapshot(snapshot);
      expect(validator.score()).toBeLessThan(0.5);
    });

    it('should lower score for corrupted data', () => {
      const snapshot: MarketSnapshot = {
        source: FeedSource.BINANCE,
        symbol: 'TEST/USD',
        timestamp: Date.now(),
        lastPrice: NaN,
        lastSize: 1.0
      };

      validator.registerSnapshot(snapshot);
      expect(validator.score()).toBeLessThan(0.5);
    });
  });
}); 