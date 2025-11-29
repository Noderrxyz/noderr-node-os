/**
 * Tests for Alpha Weighting Engine
 */

import { AlphaWeightingEngine } from './weighting-engine.js';
import { AlphaFrame } from './types.js';

// Mock AlphaFrame for testing
const createMockAlphaFrame = (source: string, symbol: string, score: number): AlphaFrame => ({
  source,
  symbol,
  score,
  confidence: 0.8,
  timestamp: Date.now()
});

describe('AlphaWeightingEngine', () => {
  // Test basic initialization
  test('should initialize with default weights', async () => {
    const engine = new AlphaWeightingEngine();
    expect(engine.getWeight('test-source')).toBe(1.0);
  });
  
  // Test weight updates after good performance
  test('should increase weight after good performance', async () => {
    const engine = new AlphaWeightingEngine();
    const source = 'good-source';
    
    // Simulate 10 positive returns
    for (let i = 0; i < 10; i++) {
      engine.updatePerformance(source, 0.05, 'BTC/USDC');
    }
    
    // Weight should increase from initial 1.0
    expect(engine.getWeight(source)).toBeGreaterThan(1.0);
  });
  
  // Test weight updates after bad performance
  test('should decrease weight after bad performance', async () => {
    const engine = new AlphaWeightingEngine();
    const source = 'bad-source';
    
    // Simulate 10 negative returns
    for (let i = 0; i < 10; i++) {
      engine.updatePerformance(source, -0.05, 'BTC/USDC');
    }
    
    // Weight should decrease from initial 1.0 but not below minWeightThreshold
    expect(engine.getWeight(source)).toBeLessThan(1.0);
    expect(engine.getWeight(source)).toBeGreaterThanOrEqual(0.2); // Default min threshold
  });
  
  // Test weight decay for inactive sources
  test('should decay weight for inactive sources', async () => {
    const engine = new AlphaWeightingEngine();
    const source = 'inactive-source';
    
    // Initialize source with some history
    for (let i = 0; i < 5; i++) {
      engine.updatePerformance(source, 0.05, 'BTC/USDC');
    }
    
    const initialWeight = engine.getWeight(source);
    
    // Mock time passing (hack to simulate without waiting)
    const sourceData = (engine as any).performanceData.get(source);
    sourceData.lastUpdated = Date.now() - (3 * 24 * 60 * 60 * 1000); // 3 days ago
    
    // Get weight again, should be decayed
    const newWeight = engine.getWeight(source);
    expect(newWeight).toBeLessThan(initialWeight);
  });
  
  // Test score alpha functionality
  test('should add weight to scored alpha frames', async () => {
    const engine = new AlphaWeightingEngine();
    const source = 'test-source';
    
    // Initialize source weight through some updates
    for (let i = 0; i < 5; i++) {
      engine.updatePerformance(source, i % 2 === 0 ? 0.03 : -0.01, 'BTC/USDC');
    }
    
    // Create alpha frame and score it
    const alphaFrame = createMockAlphaFrame(source, 'ETH/USDC', 0.75);
    const scoredFrame = engine.scoreAlpha(alphaFrame);
    
    // Check that weight was added
    expect(scoredFrame.weight).toBeDefined();
    expect(scoredFrame.weight).toBeGreaterThanOrEqual(0.2);
    expect(scoredFrame.weight).toBeLessThanOrEqual(1.0);
    
    // Check that original properties are preserved
    expect(scoredFrame.source).toBe(source);
    expect(scoredFrame.symbol).toBe('ETH/USDC');
    expect(scoredFrame.score).toBe(0.75);
  });
  
  // Test volatility regime changes
  test('should adjust regime when volatility changes', async () => {
    const engine = new AlphaWeightingEngine();
    const source = 'regime-source';
    
    // Start in medium volatility
    engine.updateVolatilityRegime(0.5);
    
    // Add some performance in medium regime
    for (let i = 0; i < 5; i++) {
      engine.updatePerformance(source, 0.04, 'BTC/USDC');
    }
    
    // Switch to high volatility
    engine.updateVolatilityRegime(0.8);
    
    // Add some poor performance in high regime
    for (let i = 0; i < 5; i++) {
      engine.updatePerformance(source, -0.02, 'BTC/USDC');
    }
    
    // Switch back to medium volatility where it performed well
    engine.updateVolatilityRegime(0.5);
    
    // Get metrics and verify regime performance is tracked
    const metrics = engine.getPerformanceMetrics();
    expect(metrics[source]).toBeDefined();
    expect(metrics[source].regimePerformance).toBeDefined();
    expect(Object.keys(metrics[source].regimePerformance).length).toBeGreaterThanOrEqual(2);
  });
  
  // Test diversity impact
  test('should penalize sources with low diversity', async () => {
    const engine = new AlphaWeightingEngine();
    const diverseSource = 'diverse-source';
    const narrowSource = 'narrow-source';
    
    // Initialize both with same good performance
    for (let i = 0; i < 20; i++) {
      // Diverse source gets different symbols
      engine.updatePerformance(diverseSource, 0.03, `BTC${i}/USDC`);
      
      // Narrow source gets same symbol each time
      engine.updatePerformance(narrowSource, 0.03, 'BTC/USDC');
    }
    
    // Diverse source should have higher weight due to diversity factor
    expect(engine.getWeight(diverseSource)).toBeGreaterThan(engine.getWeight(narrowSource));
    
    // Get metrics and check diversity scores
    const metrics = engine.getPerformanceMetrics();
    expect(metrics[diverseSource].diversityScore).toBeGreaterThan(metrics[narrowSource].diversityScore);
  });
}); 