import { TemporalSignalEvolutionEngine } from './TemporalSignalEvolutionEngine.js';
import { AlphaFrame } from '../alphasources/types.js';
import { SignalPhase, TemporalEvolutionConfig } from './types/temporal.types.js';
import { RedisClient } from '../infra/core/RedisClient.js';

// Mock Redis client
class MockRedisClient implements Partial<RedisClient> {
  private storage = new Map<string, string>();
  private lists = new Map<string, string[]>();

  async set(key: string, value: string): Promise<string> {
    this.storage.set(key, value);
    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    return this.storage.get(key) || null;
  }

  async lpush(key: string, value: string): Promise<number> {
    const list = this.lists.get(key) || [];
    list.unshift(value);
    this.lists.set(key, list);
    return list.length;
  }

  async ltrim(key: string, start: number, stop: number): Promise<string> {
    const list = this.lists.get(key) || [];
    this.lists.set(key, list.slice(start, stop + 1));
    return 'OK';
  }
}

describe('TemporalSignalEvolutionEngine', () => {
  let engine: TemporalSignalEvolutionEngine;
  let redis: MockRedisClient;
  let config: TemporalEvolutionConfig;

  beforeEach(() => {
    config = {
      enabled: true,
      driftDetection: {
        windowSize: 10,
        driftThreshold: 0.4
      },
      phaseShiftDetection: {
        minShiftMagnitude: 0.3,
        cooloffPeriodSeconds: 3600
      },
      history: {
        retentionDays: 30,
        maxEntriesPerSignal: 10000
      }
    };
    redis = new MockRedisClient();
    engine = new TemporalSignalEvolutionEngine(config, redis as unknown as RedisClient);
  });

  describe('update', () => {
    it('should process a batch of signals', async () => {
      const signals: AlphaFrame[] = [
        {
          source: 'test',
          symbol: 'BTC/USDC',
          score: 0.7,
          confidence: 0.8,
          timestamp: Date.now()
        }
      ];

      await engine.update(signals);
      const label = engine.getCurrentLabel('test_BTC/USDC');
      
      expect(label).not.toBeNull();
      if (label) {
        expect(label.signalId).toBe('test_BTC/USDC');
        expect(label.stabilityScore).toBeGreaterThanOrEqual(0);
        expect(label.stabilityScore).toBeLessThanOrEqual(1);
        expect(label.driftScore).toBeGreaterThanOrEqual(0);
        expect(label.driftScore).toBeLessThanOrEqual(1);
      }
    });

    it('should detect phase shifts', async () => {
      // Create trending signal
      const trendingSignals: AlphaFrame[] = Array.from({ length: 10 }, (_, i) => ({
        source: 'test',
        symbol: 'BTC/USDC',
        score: 0.5 + i * 0.05, // Increasing trend
        confidence: 0.8,
        timestamp: Date.now() + i * 1000
      }));

      await engine.update(trendingSignals);
      const trendingLabel = engine.getCurrentLabel('test_BTC/USDC');
      expect(trendingLabel?.currentPhase).toBe(SignalPhase.TRENDING);

      // Switch to mean reverting
      const meanRevertingSignals: AlphaFrame[] = Array.from({ length: 10 }, (_, i) => ({
        source: 'test',
        symbol: 'BTC/USDC',
        score: 0.5 + Math.sin(i * Math.PI / 2) * 0.3, // Oscillating
        confidence: 0.8,
        timestamp: Date.now() + (i + 10) * 1000
      }));

      await engine.update(meanRevertingSignals);
      const mrLabel = engine.getCurrentLabel('test_BTC/USDC');
      expect(mrLabel?.currentPhase).toBe(SignalPhase.MEAN_REVERTING);

      // Check phase shift was detected
      const shifts = engine.getDetectedPhaseShifts();
      expect(shifts.length).toBe(1);
      expect(shifts[0].previousPhase).toBe(SignalPhase.TRENDING);
      expect(shifts[0].newPhase).toBe(SignalPhase.MEAN_REVERTING);
    });

    it('should detect signal decay', async () => {
      // Create stable signal
      const stableSignals: AlphaFrame[] = Array.from({ length: 10 }, () => ({
        source: 'test',
        symbol: 'BTC/USDC',
        score: 0.7,
        confidence: 0.8,
        timestamp: Date.now()
      }));

      await engine.update(stableSignals);
      const stableLabel = engine.getCurrentLabel('test_BTC/USDC');
      expect(stableLabel?.currentPhase).not.toBe(SignalPhase.DECAY);

      // Create decaying signal
      const decayingSignals: AlphaFrame[] = Array.from({ length: 10 }, (_, i) => ({
        source: 'test',
        symbol: 'BTC/USDC',
        score: 0.7 + (Math.random() - 0.5) * 0.8, // High volatility
        confidence: 0.8 - i * 0.05, // Decreasing confidence
        timestamp: Date.now() + i * 1000
      }));

      await engine.update(decayingSignals);
      const decayLabel = engine.getCurrentLabel('test_BTC/USDC');
      expect(decayLabel?.currentPhase).toBe(SignalPhase.DECAY);
    });
  });

  describe('analyzeTemporalPatterns', () => {
    it('should generate a valid report', async () => {
      // Create signals from multiple sources
      const signals: AlphaFrame[] = [
        {
          source: 'test1',
          symbol: 'BTC/USDC',
          score: 0.7,
          confidence: 0.8,
          timestamp: Date.now()
        },
        {
          source: 'test2',
          symbol: 'ETH/USDC',
          score: 0.6,
          confidence: 0.9,
          timestamp: Date.now()
        }
      ];

      await engine.update(signals);
      const report = await engine.analyzeTemporalPatterns();

      expect(report.timestamp).toBeGreaterThan(0);
      expect(report.labels.length).toBe(2);
      expect(report.systemMetrics.signalCount).toBe(2);
      expect(report.systemMetrics.avgStability).toBeGreaterThanOrEqual(0);
      expect(report.systemMetrics.avgStability).toBeLessThanOrEqual(1);
      expect(report.systemMetrics.avgDrift).toBeGreaterThanOrEqual(0);
      expect(report.systemMetrics.avgDrift).toBeLessThanOrEqual(1);

      // Check phase distribution
      const distribution = report.systemMetrics.phaseDistribution;
      const totalPercentage = Object.values(distribution).reduce((a, b) => a + b, 0);
      expect(Math.abs(totalPercentage - 1)).toBeLessThan(0.0001);
    });
  });
}); 