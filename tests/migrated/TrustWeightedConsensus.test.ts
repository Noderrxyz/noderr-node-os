/**
 * Tests for the trust-weighted consensus system
 * 
 * Validates that the consensus engine correctly weights signals 
 * based on agent trust scores.
 */

import { TrendSignal } from '../../../types/global.types.js';
import { TrendSignalAggregator } from '../TrendSignalAggregator.js';
import { TrustWeightedConsensusEngine, TrustScoreProvider } from '../TrustWeightedConsensusEngine.js';
import { TrendDirection, ConsensusResult } from '../TrendConsensusEngine.js';

// Mock Redis implementation for testing
class MockRedis {
  private data: Record<string, any> = {};

  async hset(key: string, field: string, value: string): Promise<any> {
    if (!this.data[key]) {
      this.data[key] = {};
    }
    this.data[key][field] = value;
    return 'OK';
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return this.data[key] || {};
  }

  async expire(key: string, seconds: number): Promise<any> {
    return 1;
  }

  async del(key: string): Promise<any> {
    delete this.data[key];
    return 1;
  }
}

// Mock implementation of TrustScoreProvider for testing
class MockTrustScoreProvider implements TrustScoreProvider {
  private trustScores: Record<string, number> = {
    'agent1': 0.9, // Highly trusted
    'agent2': 0.5, // Average trust
    'agent3': 0.2, // Low trust
    'agent4': 0.8  // High trust
  };

  async getAgentTrustScore(agentId: string): Promise<number> {
    return this.trustScores[agentId] || 0.5;
  }
}

describe('TrustWeightedConsensusEngine', () => {
  let redis: MockRedis;
  let aggregator: TrendSignalAggregator;
  let trustProvider: MockTrustScoreProvider;
  let engine: TrustWeightedConsensusEngine;

  beforeEach(() => {
    redis = new MockRedis();
    aggregator = new TrendSignalAggregator(redis as any);
    trustProvider = new MockTrustScoreProvider();
    engine = new TrustWeightedConsensusEngine(trustProvider, aggregator);
  });

  test('should weight signals based on agent trust scores', async () => {
    // Setup test signals
    const now = Date.now();
    const signals: TrendSignal[] = [
      {
        agentId: 'agent1', // High trust (0.9)
        asset: 'BTC',
        timeframe: '1h',
        direction: 'up',
        confidence: 0.7,
        timestamp: now
      },
      {
        agentId: 'agent2', // Medium trust (0.5)
        asset: 'BTC',
        timeframe: '1h',
        direction: 'down',
        confidence: 0.8,
        timestamp: now
      }
    ];

    // Submit signals to the aggregator
    for (const signal of signals) {
      await aggregator.submit(signal.agentId, signal);
    }

    // Calculate consensus
    const consensus = await engine.calculateDetailedConsensus();
    
    // Weighted confidence calculation:
    // agent1 (up): 0.7 * 0.9 = 0.63
    // agent2 (down): 0.8 * 0.5 = 0.4
    // Therefore, "up" should win despite lower raw confidence

    expect(consensus['BTC:1h']).toBeDefined();
    expect(consensus['BTC:1h'].direction).toBe('up');
  });

  test('should handle tie-breaking based on trust', async () => {
    // Setup test signals with equal confidence but different trust
    const now = Date.now();
    const signals: TrendSignal[] = [
      {
        agentId: 'agent1', // High trust (0.9)
        asset: 'ETH',
        timeframe: '4h',
        direction: 'neutral',
        confidence: 0.6,
        timestamp: now
      },
      {
        agentId: 'agent3', // Low trust (0.2)
        asset: 'ETH',
        timeframe: '4h',
        direction: 'up',
        confidence: 0.6,
        timestamp: now
      }
    ];

    // Submit signals to the aggregator
    for (const signal of signals) {
      await aggregator.submit(signal.agentId, signal);
    }

    // Calculate consensus
    const consensus = await engine.calculateDetailedConsensus();
    
    // Weighted confidence calculation:
    // agent1 (neutral): 0.6 * 0.9 = 0.54
    // agent3 (up): 0.6 * 0.2 = 0.12
    // Therefore, "neutral" should win due to higher trust

    expect(consensus['ETH:4h']).toBeDefined();
    expect(consensus['ETH:4h'].direction).toBe('neutral');
  });

  test('should correctly aggregate multiple signals with diverse trust levels', async () => {
    // Setup test signals across different assets and timeframes
    const now = Date.now();
    const signals: TrendSignal[] = [
      // BTC 1h signals
      {
        agentId: 'agent1', // High trust (0.9)
        asset: 'BTC',
        timeframe: '1h',
        direction: 'up',
        confidence: 0.7,
        timestamp: now
      },
      {
        agentId: 'agent2', // Medium trust (0.5)
        asset: 'BTC',
        timeframe: '1h',
        direction: 'up',
        confidence: 0.6,
        timestamp: now
      },
      {
        agentId: 'agent3', // Low trust (0.2)
        asset: 'BTC',
        timeframe: '1h',
        direction: 'down',
        confidence: 0.9,
        timestamp: now
      },
      
      // ETH 4h signals
      {
        agentId: 'agent1', // High trust (0.9)
        asset: 'ETH',
        timeframe: '4h',
        direction: 'down',
        confidence: 0.8,
        timestamp: now
      },
      {
        agentId: 'agent4', // High trust (0.8)
        asset: 'ETH',
        timeframe: '4h',
        direction: 'neutral',
        confidence: 0.7,
        timestamp: now
      }
    ];

    // Submit signals to the aggregator
    for (const signal of signals) {
      await aggregator.submit(signal.agentId, signal);
    }

    // Calculate consensus
    const consensus = await engine.calculateDetailedConsensus();
    
    // BTC 1h weighted calculation:
    // agent1 (up): 0.7 * 0.9 = 0.63
    // agent2 (up): 0.6 * 0.5 = 0.3
    // agent3 (down): 0.9 * 0.2 = 0.18
    // total up: 0.93, total down: 0.18 -> "up" should win
    
    // ETH 4h weighted calculation:
    // agent1 (down): 0.8 * 0.9 = 0.72
    // agent4 (neutral): 0.7 * 0.8 = 0.56
    // "down" should win

    expect(consensus['BTC:1h']).toBeDefined();
    expect(consensus['BTC:1h'].direction).toBe('up');
    
    expect(consensus['ETH:4h']).toBeDefined();
    expect(consensus['ETH:4h'].direction).toBe('down');
  });

  test('should provide raw weighted scores', async () => {
    // Setup test signals
    const now = Date.now();
    const signals: TrendSignal[] = [
      {
        agentId: 'agent1', // High trust (0.9)
        asset: 'BTC',
        timeframe: '1h',
        direction: 'up',
        confidence: 0.7,
        timestamp: now
      },
      {
        agentId: 'agent3', // Low trust (0.2)
        asset: 'BTC',
        timeframe: '1h',
        direction: 'down',
        confidence: 0.9,
        timestamp: now
      }
    ];

    // Submit signals to the aggregator
    for (const signal of signals) {
      await aggregator.submit(signal.agentId, signal);
    }

    // Get raw weighted scores
    const rawScores = await engine.getRawWeightedScores();
    
    // Expected calculations:
    // agent1 (up): 0.7 * 0.9 = 0.63
    // agent3 (down): 0.9 * 0.2 = 0.18

    expect(rawScores['BTC:1h']).toBeDefined();
    expect(rawScores['BTC:1h'].up).toBeCloseTo(0.63, 2);
    expect(rawScores['BTC:1h'].down).toBeCloseTo(0.18, 2);
    expect(rawScores['BTC:1h'].neutral).toBe(0);
  });
}); 