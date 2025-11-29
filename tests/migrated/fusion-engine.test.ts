/**
 * Tests for Alpha Fusion Engine
 */

import { AlphaFusionEngine, SignalDirection } from './fusion-engine.js';
import { AlphaFrame } from './types.js';

// Mock alpha frame with weight
interface WeightedAlphaFrame extends AlphaFrame {
  weight?: number;
}

// Helper to create mock alpha frames
const createMockAlphaFrame = (
  source: string,
  symbol: string,
  score: number,
  weight?: number
): WeightedAlphaFrame => ({
  source,
  symbol,
  score,
  confidence: 0.8,
  timestamp: Date.now(),
  weight
});

describe('AlphaFusionEngine', () => {
  // Test basic initialization and empty input handling
  test('should handle empty signal list', async () => {
    const engine = new AlphaFusionEngine();
    const result = engine.fuse([]);
    expect(result).toEqual([]);
  });
  
  // Test long signal generation
  test('should generate long signal when all sources agree', async () => {
    const engine = new AlphaFusionEngine();
    
    const signals: WeightedAlphaFrame[] = [
      createMockAlphaFrame('twitter', 'BTC/USDC', 0.8, 1.0),
      createMockAlphaFrame('onchain', 'BTC/USDC', 0.7, 0.9),
      createMockAlphaFrame('sentiment', 'BTC/USDC', 0.9, 0.8)
    ];
    
    const fusedSignals = engine.fuse(signals);
    
    expect(fusedSignals.length).toBe(1);
    expect(fusedSignals[0].symbol).toBe('BTC/USDC');
    expect(fusedSignals[0].direction).toBe(SignalDirection.LONG);
    expect(fusedSignals[0].confidence).toBeGreaterThan(0.5);
    expect(fusedSignals[0].sources).toContain('twitter');
    expect(fusedSignals[0].sources).toContain('onchain');
    expect(fusedSignals[0].sources).toContain('sentiment');
    expect(fusedSignals[0].details.length).toBe(3);
  });
  
  // Test short signal generation
  test('should generate short signal when all sources agree on bearish sentiment', async () => {
    const engine = new AlphaFusionEngine();
    
    const signals: WeightedAlphaFrame[] = [
      createMockAlphaFrame('twitter', 'ETH/USDC', 0.2, 1.0),
      createMockAlphaFrame('onchain', 'ETH/USDC', 0.3, 0.9),
      createMockAlphaFrame('sentiment', 'ETH/USDC', 0.1, 0.8)
    ];
    
    const fusedSignals = engine.fuse(signals);
    
    expect(fusedSignals.length).toBe(1);
    expect(fusedSignals[0].symbol).toBe('ETH/USDC');
    expect(fusedSignals[0].direction).toBe(SignalDirection.SHORT);
    expect(fusedSignals[0].confidence).toBeGreaterThan(0.5);
  });
  
  // Test conflicting signals resolution
  test('should resolve conflicting signals by weighted majority', async () => {
    const engine = new AlphaFusionEngine();
    
    const signals: WeightedAlphaFrame[] = [
      // Bullish signals with more weight
      createMockAlphaFrame('twitter', 'SOL/USDC', 0.9, 1.0),
      createMockAlphaFrame('sentiment', 'SOL/USDC', 0.8, 0.9),
      // Bearish signal
      createMockAlphaFrame('onchain', 'SOL/USDC', 0.2, 0.8)
    ];
    
    const fusedSignals = engine.fuse(signals);
    
    expect(fusedSignals.length).toBe(1);
    expect(fusedSignals[0].symbol).toBe('SOL/USDC');
    expect(fusedSignals[0].direction).toBe(SignalDirection.LONG);
    // Confidence should be lower due to disagreement
    expect(fusedSignals[0].confidence).toBeLessThan(0.9);
  });
  
  // Test neutral signal when exactly balanced
  test('should generate neutral signal when perfectly balanced', async () => {
    const engine = new AlphaFusionEngine({
      minConfidenceThreshold: 0.1 // Lower threshold to allow neutral signals
    });
    
    const signals: WeightedAlphaFrame[] = [
      createMockAlphaFrame('twitter', 'DOGE/USDC', 0.8, 1.0), // Long
      createMockAlphaFrame('onchain', 'DOGE/USDC', 0.2, 1.0)  // Short with equal weight
    ];
    
    const fusedSignals = engine.fuse(signals);
    
    expect(fusedSignals.length).toBe(1);
    expect(fusedSignals[0].direction).toBe(SignalDirection.NEUTRAL);
    expect(fusedSignals[0].confidence).toBeLessThan(0.5);
  });
  
  // Test handling of multiple symbols
  test('should handle multiple symbols independently', async () => {
    const engine = new AlphaFusionEngine();
    
    const signals: WeightedAlphaFrame[] = [
      // BTC signals (bullish)
      createMockAlphaFrame('twitter', 'BTC/USDC', 0.8, 1.0),
      createMockAlphaFrame('onchain', 'BTC/USDC', 0.7, 0.9),
      // ETH signals (bearish)
      createMockAlphaFrame('twitter', 'ETH/USDC', 0.3, 1.0),
      createMockAlphaFrame('onchain', 'ETH/USDC', 0.2, 0.9)
    ];
    
    const fusedSignals = engine.fuse(signals);
    
    expect(fusedSignals.length).toBe(2);
    
    // Find each symbol's signal
    const btcSignal = fusedSignals.find(s => s.symbol === 'BTC/USDC');
    const ethSignal = fusedSignals.find(s => s.symbol === 'ETH/USDC');
    
    expect(btcSignal).toBeDefined();
    expect(ethSignal).toBeDefined();
    
    expect(btcSignal?.direction).toBe(SignalDirection.LONG);
    expect(ethSignal?.direction).toBe(SignalDirection.SHORT);
  });
  
  // Test aggregation of signals from the same source
  test('should properly aggregate signals from the same source', async () => {
    const engine = new AlphaFusionEngine();
    
    const signals: WeightedAlphaFrame[] = [
      // Multiple signals from the same source
      createMockAlphaFrame('twitter', 'BTC/USDC', 0.8, 1.0),
      createMockAlphaFrame('twitter', 'BTC/USDC', 0.7, 1.0),
      createMockAlphaFrame('twitter', 'BTC/USDC', 0.9, 1.0),
      // One signal from another source
      createMockAlphaFrame('onchain', 'BTC/USDC', 0.6, 1.0)
    ];
    
    const fusedSignals = engine.fuse(signals);
    
    expect(fusedSignals.length).toBe(1);
    expect(fusedSignals[0].sources.length).toBe(2); // Should only count unique sources
    expect(fusedSignals[0].details.length).toBe(4); // But should include all signals
  });
  
  // Test confidence impact from diversity
  test('should have higher confidence with diverse sources', async () => {
    const engine = new AlphaFusionEngine();
    
    // Scenario 1: Multiple sources
    const diverseSignals: WeightedAlphaFrame[] = [
      createMockAlphaFrame('twitter', 'BTC/USDC', 0.8, 1.0),
      createMockAlphaFrame('onchain', 'BTC/USDC', 0.7, 1.0),
      createMockAlphaFrame('sentiment', 'BTC/USDC', 0.8, 1.0),
      createMockAlphaFrame('news', 'BTC/USDC', 0.7, 1.0)
    ];
    
    // Scenario 2: Single source with same signal count
    const singleSourceSignals: WeightedAlphaFrame[] = [
      createMockAlphaFrame('twitter', 'ETH/USDC', 0.8, 1.0),
      createMockAlphaFrame('twitter', 'ETH/USDC', 0.7, 1.0),
      createMockAlphaFrame('twitter', 'ETH/USDC', 0.8, 1.0),
      createMockAlphaFrame('twitter', 'ETH/USDC', 0.7, 1.0)
    ];
    
    const diverseResult = engine.fuse(diverseSignals);
    const singleSourceResult = engine.fuse(singleSourceSignals);
    
    expect(diverseResult[0].confidence).toBeGreaterThan(singleSourceResult[0].confidence);
  });
  
  // Test position size scaling with confidence
  test('should scale position size with confidence', async () => {
    const engine = new AlphaFusionEngine({
      minPositionSize: 0.1,
      maxPositionSize: 1.0,
      minConfidenceThreshold: 0.4
    });
    
    // High confidence signals
    const highConfidenceSignals: WeightedAlphaFrame[] = [
      createMockAlphaFrame('twitter', 'BTC/USDC', 0.9, 1.0),
      createMockAlphaFrame('onchain', 'BTC/USDC', 0.8, 1.0),
      createMockAlphaFrame('sentiment', 'BTC/USDC', 0.9, 1.0)
    ];
    
    // Medium confidence signals
    const mediumConfidenceSignals: WeightedAlphaFrame[] = [
      createMockAlphaFrame('twitter', 'ETH/USDC', 0.7, 1.0),
      createMockAlphaFrame('onchain', 'ETH/USDC', 0.6, 1.0)
    ];
    
    // Low confidence signals (but above threshold)
    const lowConfidenceSignals: WeightedAlphaFrame[] = [
      createMockAlphaFrame('twitter', 'SOL/USDC', 0.6, 1.0),
      createMockAlphaFrame('onchain', 'SOL/USDC', 0.4, 1.0)
    ];
    
    const highResult = engine.fuse(highConfidenceSignals);
    const mediumResult = engine.fuse(mediumConfidenceSignals);
    const lowResult = engine.fuse(lowConfidenceSignals);
    
    expect(highResult[0].size).toBeGreaterThan(mediumResult[0].size);
    expect(mediumResult[0].size).toBeGreaterThan(lowResult[0].size);
    expect(highResult[0].size).toBeLessThanOrEqual(1.0);
    expect(lowResult[0].size).toBeGreaterThanOrEqual(0.1);
  });
  
  // Test minimal confidence threshold filtering
  test('should filter out signals below confidence threshold', async () => {
    const engine = new AlphaFusionEngine({
      minConfidenceThreshold: 0.6
    });
    
    const signals: WeightedAlphaFrame[] = [
      // High confidence
      createMockAlphaFrame('twitter', 'BTC/USDC', 0.9, 1.0),
      createMockAlphaFrame('onchain', 'BTC/USDC', 0.8, 1.0),
      
      // Low confidence (confused signals)
      createMockAlphaFrame('twitter', 'ETH/USDC', 0.6, 1.0),
      createMockAlphaFrame('onchain', 'ETH/USDC', 0.3, 1.0)
    ];
    
    const fusedSignals = engine.fuse(signals);
    
    // Only BTC should pass the threshold
    expect(fusedSignals.length).toBe(1);
    expect(fusedSignals[0].symbol).toBe('BTC/USDC');
  });
}); 