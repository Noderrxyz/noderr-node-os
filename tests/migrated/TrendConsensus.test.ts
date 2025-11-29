/**
 * Trend Consensus System Tests
 * 
 * Tests for the trend signal aggregator and consensus engine
 */

import { TrendSignal } from '../../../types/global.types.js';
import { TrendSignalAggregator } from '../TrendSignalAggregator.js';
import { TrendConsensusEngine, TrendDirection } from '../TrendConsensusEngine.js';

// For TypeScript type safety in tests
declare global {
  const describe: (name: string, fn: () => void) => void;
  const beforeEach: (fn: () => void) => void;
  const test: (name: string, fn: () => Promise<void>) => void;
  const expect: any;
}

// Mock Redis implementation for testing
class MockRedis {
  private data: Record<string, Record<string, string>> = {};
  
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
    return 'OK';
  }
  
  async del(key: string): Promise<any> {
    delete this.data[key];
    return 'OK';
  }
}

describe('Trend Consensus System', () => {
  let mockRedis: MockRedis;
  let aggregator: TrendSignalAggregator;
  let consensusEngine: TrendConsensusEngine;
  
  beforeEach(() => {
    mockRedis = new MockRedis();
    aggregator = new TrendSignalAggregator(mockRedis);
    consensusEngine = new TrendConsensusEngine(aggregator);
  });
  
  test('should aggregate and retrieve trend signals', async () => {
    // Create sample signals
    const signal1: TrendSignal = {
      agentId: 'agent1',
      asset: 'BTC',
      timeframe: '5m',
      direction: 'up',
      confidence: 0.8,
      timestamp: Date.now()
    };
    
    const signal2: TrendSignal = {
      agentId: 'agent2',
      asset: 'BTC',
      timeframe: '5m',
      direction: 'up',
      confidence: 0.7,
      timestamp: Date.now()
    };
    
    // Submit signals
    await aggregator.submit('agent1', signal1);
    await aggregator.submit('agent2', signal2);
    
    // Retrieve signals
    const signals = await aggregator.getRecent();
    
    // Verify
    expect(signals.length).toBe(2);
    expect(signals[0].asset).toBe('BTC');
    expect(signals[0].direction).toBe('up');
    expect(signals[1].asset).toBe('BTC');
    expect(signals[1].direction).toBe('up');
  });
  
  test('should calculate consensus with strong up signal', async () => {
    // Create sample signals with strong uptrend consensus
    const signals: TrendSignal[] = [
      {
        agentId: 'agent1',
        asset: 'ETH',
        timeframe: '15m',
        direction: 'up',
        confidence: 0.9,
        timestamp: Date.now()
      },
      {
        agentId: 'agent2',
        asset: 'ETH',
        timeframe: '15m',
        direction: 'up',
        confidence: 0.8,
        timestamp: Date.now()
      },
      {
        agentId: 'agent3',
        asset: 'ETH',
        timeframe: '15m',
        direction: 'neutral',
        confidence: 0.6,
        timestamp: Date.now()
      }
    ];
    
    // Submit signals
    for (const [i, signal] of signals.entries()) {
      await aggregator.submit(`agent${i+1}`, signal);
    }
    
    // Calculate consensus
    const consensus = await consensusEngine.calculateConsensus();
    const detailedConsensus = await consensusEngine.calculateDetailedConsensus();
    
    // Verify
    expect(consensus['ETH:15m']).toBe('up');
    expect(detailedConsensus['ETH:15m'].direction).toBe('up');
    expect(detailedConsensus['ETH:15m'].signalCount).toBe(3);
    expect(detailedConsensus['ETH:15m'].confidence).toBeGreaterThan(0.5);
  });
  
  test('should handle mixed trend signals with dominant down consensus', async () => {
    // Create sample signals with mixed opinions but dominant downtrend
    const signals: TrendSignal[] = [
      {
        agentId: 'agent1',
        asset: 'BTC',
        timeframe: '1h',
        direction: 'down',
        confidence: 0.85,
        timestamp: Date.now()
      },
      {
        agentId: 'agent2',
        asset: 'BTC',
        timeframe: '1h',
        direction: 'down',
        confidence: 0.80,
        timestamp: Date.now()
      },
      {
        agentId: 'agent3',
        asset: 'BTC',
        timeframe: '1h',
        direction: 'up',
        confidence: 0.70,
        timestamp: Date.now()
      },
      {
        agentId: 'agent4',
        asset: 'BTC',
        timeframe: '1h',
        direction: 'neutral',
        confidence: 0.50,
        timestamp: Date.now()
      }
    ];
    
    // Submit signals
    for (const [i, signal] of signals.entries()) {
      await aggregator.submit(`agent${i+1}`, signal);
    }
    
    // Calculate consensus
    const consensus = await consensusEngine.calculateConsensus();
    
    // Verify
    expect(consensus['BTC:1h']).toBe('down');
  });
  
  test('should handle multiple asset/timeframe combinations', async () => {
    // Create sample signals for different assets and timeframes
    const signals: TrendSignal[] = [
      {
        agentId: 'agent1',
        asset: 'BTC',
        timeframe: '1h',
        direction: 'up',
        confidence: 0.8,
        timestamp: Date.now()
      },
      {
        agentId: 'agent2',
        asset: 'ETH',
        timeframe: '5m',
        direction: 'down',
        confidence: 0.75,
        timestamp: Date.now()
      },
      {
        agentId: 'agent3',
        asset: 'BTC',
        timeframe: '5m',
        direction: 'neutral',
        confidence: 0.65,
        timestamp: Date.now()
      }
    ];
    
    // Submit signals
    for (const [i, signal] of signals.entries()) {
      await aggregator.submit(`agent${i+1}`, signal);
    }
    
    // Calculate consensus
    const consensus = await consensusEngine.calculateConsensus();
    
    // Verify we have separate consensus for each asset/timeframe
    expect(Object.keys(consensus).length).toBe(3);
    expect(consensus['BTC:1h']).toBe('up');
    expect(consensus['ETH:5m']).toBe('down');
    expect(consensus['BTC:5m']).toBe('neutral');
  });
}); 