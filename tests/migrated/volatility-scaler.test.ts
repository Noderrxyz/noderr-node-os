/**
 * Tests for Volatility Scaler
 */

import { VolatilityScaler } from './volatility-scaler';
import { FusedAlphaFrame, SignalDirection } from './fusion-engine';

// Helper to create mock fused alpha frames
const createMockFusedAlpha = (
  symbol: string,
  direction: SignalDirection,
  confidence: number,
  size: number
): FusedAlphaFrame => ({
  symbol,
  direction,
  confidence,
  size,
  sources: ['test-source'],
  details: [],
  timestamp: Date.now()
});

describe('VolatilityScaler', () => {
  // Test basic initialization
  test('should initialize with default config', async () => {
    const scaler = new VolatilityScaler();
    expect(scaler).toBeDefined();
  });
  
  // Test scaling with low volatility
  test('should keep size high with low volatility', async () => {
    const scaler = new VolatilityScaler({
      minSize: 0.1,
      maxSize: 1.0,
      maxVolatility: 0.10
    });
    
    const alpha = createMockFusedAlpha('BTC/USDC', SignalDirection.LONG, 0.8, 0.8);
    const lowVolatility = 0.01; // 1%
    
    const scaledAlpha = scaler.scaleSignal(alpha, lowVolatility);
    
    // With low volatility, size should remain high
    expect(scaledAlpha.size).toBeGreaterThan(0.7);
    expect(scaledAlpha.confidence).toBe(alpha.confidence); // Confidence unchanged by default
  });
  
  // Test scaling with high volatility
  test('should reduce size significantly with high volatility', async () => {
    const scaler = new VolatilityScaler({
      minSize: 0.1,
      maxSize: 1.0,
      maxVolatility: 0.10
    });
    
    const alpha = createMockFusedAlpha('ETH/USDC', SignalDirection.LONG, 0.9, 0.9);
    const highVolatility = 0.10; // 10%, equal to max
    
    const scaledAlpha = scaler.scaleSignal(alpha, highVolatility);
    
    // With high volatility, size should be reduced to min or close
    expect(scaledAlpha.size).toBeLessThanOrEqual(0.3);
  });
  
  // Test scaling with extreme volatility
  test('should clamp size to minimum with extreme volatility', async () => {
    const scaler = new VolatilityScaler({
      minSize: 0.05,
      maxSize: 1.0,
      maxVolatility: 0.10
    });
    
    const alpha = createMockFusedAlpha('SOL/USDC', SignalDirection.LONG, 0.9, 0.9);
    const extremeVolatility = 0.20; // 20%, well above max
    
    const scaledAlpha = scaler.scaleSignal(alpha, extremeVolatility);
    
    // With extreme volatility, size should be at minimum
    expect(scaledAlpha.size).toBe(0.05);
  });
  
  // Test scaling with confidence adjustment
  test('should scale confidence when enabled', async () => {
    const scaler = new VolatilityScaler({
      minSize: 0.1,
      maxSize: 1.0,
      maxVolatility: 0.10,
      scaleConfidence: true
    });
    
    const alpha = createMockFusedAlpha('BTC/USDC', SignalDirection.LONG, 0.9, 0.9);
    const volatility = 0.05; // 5%
    
    const scaledAlpha = scaler.scaleSignal(alpha, volatility);
    
    // Confidence should be scaled proportionally to size
    const sizeScaleFactor = scaledAlpha.size / alpha.size;
    expect(scaledAlpha.confidence).toBe(alpha.confidence * sizeScaleFactor);
  });
  
  // Test bulk scaling of multiple signals
  test('should scale multiple signals with their respective volatilities', async () => {
    const scaler = new VolatilityScaler();
    
    const alphas = [
      createMockFusedAlpha('BTC/USDC', SignalDirection.LONG, 0.8, 0.8),
      createMockFusedAlpha('ETH/USDC', SignalDirection.SHORT, 0.7, 0.7)
    ];
    
    const volatilityMap = new Map<string, number>([
      ['BTC/USDC', 0.02], // Low volatility
      ['ETH/USDC', 0.08]  // High volatility
    ]);
    
    const scaledAlphas = scaler.scaleSignals(alphas, volatilityMap);
    
    // BTC should have higher size due to lower volatility
    expect(scaledAlphas[0].size).toBeGreaterThan(scaledAlphas[1].size);
  });
  
  // Test with disabled scaling
  test('should not modify signals when disabled', async () => {
    const scaler = new VolatilityScaler({
      enabled: false
    });
    
    const alpha = createMockFusedAlpha('BTC/USDC', SignalDirection.LONG, 0.8, 0.8);
    const volatility = 0.10; // High volatility
    
    const scaledAlpha = scaler.scaleSignal(alpha, volatility);
    
    // With scaling disabled, properties should be unchanged
    expect(scaledAlpha.size).toBe(alpha.size);
    expect(scaledAlpha.confidence).toBe(alpha.confidence);
  });
  
  // Test the direct calculation method
  test('should calculate scaled size correctly', async () => {
    const scaler = new VolatilityScaler({
      minSize: 0.1,
      maxSize: 1.0,
      maxVolatility: 0.10
    });
    
    // Test with various volatility levels
    const lowVolSize = scaler.calculateScaledSize(0.8, 0.01);
    const midVolSize = scaler.calculateScaledSize(0.8, 0.05);
    const highVolSize = scaler.calculateScaledSize(0.8, 0.10);
    
    // Sizes should decrease as volatility increases
    expect(lowVolSize).toBeGreaterThan(midVolSize);
    expect(midVolSize).toBeGreaterThan(highVolSize);
  });
}); 