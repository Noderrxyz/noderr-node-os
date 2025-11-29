/**
 * Tests for Volatility Calculator
 */

import { VolatilityCalculator } from './volatility-calculator';

describe('VolatilityCalculator', () => {
  // Test basic initialization
  test('should initialize with default config', async () => {
    const calculator = new VolatilityCalculator();
    expect(calculator).toBeDefined();
  });
  
  // Test default volatility when no data is available
  test('should return default volatility when no data', async () => {
    const calculator = new VolatilityCalculator({
      defaultVolatility: 0.05
    });
    
    const volatility = calculator.calculateVolatility('BTC/USDC');
    expect(volatility).toBe(0.05);
  });
  
  // Test volatility calculation with price data
  test('should calculate volatility from price data', async () => {
    const calculator = new VolatilityCalculator({
      minDataPoints: 3,
      defaultVolatility: 0.02
    });
    
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    
    // Add some price data (stable prices)
    calculator.addPriceData('BTC/USDC', 50000, now - 2 * dayMs);
    calculator.addPriceData('BTC/USDC', 50100, now - 1 * dayMs);
    calculator.addPriceData('BTC/USDC', 50200, now);
    
    // Stable price should have low volatility
    const stableVolatility = calculator.calculateVolatility('BTC/USDC');
    expect(stableVolatility).toBeLessThan(0.05);
    
    // Reset data
    calculator.resetData('BTC/USDC');
    
    // Add volatile price data
    calculator.addPriceData('BTC/USDC', 50000, now - 2 * dayMs);
    calculator.addPriceData('BTC/USDC', 55000, now - 1 * dayMs); // 10% jump
    calculator.addPriceData('BTC/USDC', 48000, now); // 12.7% drop
    
    // Volatile price should have higher volatility
    const volatileVolatility = calculator.calculateVolatility('BTC/USDC');
    expect(volatileVolatility).toBeGreaterThan(stableVolatility);
  });
  
  // Test window filtering
  test('should filter data points outside the window', async () => {
    const calculator = new VolatilityCalculator({
      windowSizeMs: 2 * 24 * 60 * 60 * 1000, // 2 days
      minDataPoints: 2
    });
    
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    
    // Add data points, some outside the window
    calculator.addPriceData('ETH/USDC', 3000, now - 5 * dayMs); // Outside window
    calculator.addPriceData('ETH/USDC', 3100, now - 4 * dayMs); // Outside window
    calculator.addPriceData('ETH/USDC', 3200, now - 1 * dayMs); // Inside window
    calculator.addPriceData('ETH/USDC', 3300, now); // Inside window
    
    // Should only use the two most recent points
    const volatility = calculator.calculateVolatility('ETH/USDC');
    
    // Clear data and add just the two points that should be in the window
    calculator.resetData('ETH/USDC');
    calculator.addPriceData('ETH/USDC', 3200, now - 1 * dayMs);
    calculator.addPriceData('ETH/USDC', 3300, now);
    
    const expectedVolatility = calculator.calculateVolatility('ETH/USDC');
    
    // Should be the same volatility
    expect(volatility).toBeCloseTo(expectedVolatility, 6);
  });
  
  // Test volatility caching
  test('should cache volatility calculations', async () => {
    const calculator = new VolatilityCalculator({
      minDataPoints: 3
    });
    
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    
    // Add some price data
    calculator.addPriceData('SOL/USDC', 100, now - 2 * dayMs);
    calculator.addPriceData('SOL/USDC', 110, now - 1 * dayMs);
    calculator.addPriceData('SOL/USDC', 105, now);
    
    // Calculate volatility
    const firstVolatility = calculator.calculateVolatility('SOL/USDC');
    
    // Should use cached value on second call
    const cachedVolatility = calculator.calculateVolatility('SOL/USDC');
    expect(cachedVolatility).toBe(firstVolatility);
    
    // Check if it's in the volatility cache
    const cache = calculator.getVolatilityCache();
    expect(cache.has('SOL/USDC')).toBe(true);
    expect(cache.get('SOL/USDC')).toBe(firstVolatility);
  });
  
  // Test getting volatility for multiple symbols
  test('should get volatility map for multiple symbols', async () => {
    const calculator = new VolatilityCalculator();
    
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    
    // Add price data for BTC (stable)
    calculator.addPriceData('BTC/USDC', 50000, now - 2 * dayMs);
    calculator.addPriceData('BTC/USDC', 50500, now - 1 * dayMs);
    calculator.addPriceData('BTC/USDC', 51000, now);
    
    // Add price data for ETH (volatile)
    calculator.addPriceData('ETH/USDC', 3000, now - 2 * dayMs);
    calculator.addPriceData('ETH/USDC', 3500, now - 1 * dayMs); // More volatile
    calculator.addPriceData('ETH/USDC', 3200, now);
    
    // Get volatility map
    const volatilityMap = calculator.getVolatilityMap(['BTC/USDC', 'ETH/USDC', 'SOL/USDC']);
    
    // Should have all requested symbols
    expect(volatilityMap.size).toBe(3);
    expect(volatilityMap.has('BTC/USDC')).toBe(true);
    expect(volatilityMap.has('ETH/USDC')).toBe(true);
    expect(volatilityMap.has('SOL/USDC')).toBe(true);
    
    // SOL should have default volatility
    expect(volatilityMap.get('SOL/USDC')).toBe(calculator['config'].defaultVolatility);
    
    // ETH should be more volatile than BTC
    expect(volatilityMap.get('ETH/USDC')).toBeGreaterThan(volatilityMap.get('BTC/USDC'));
  });
  
  // Test resetting all data
  test('should clear all data when reset', async () => {
    const calculator = new VolatilityCalculator();
    
    // Add some data
    calculator.addPriceData('BTC/USDC', 50000);
    calculator.addPriceData('ETH/USDC', 3000);
    
    // Calculate volatilities to populate cache
    calculator.calculateVolatility('BTC/USDC');
    calculator.calculateVolatility('ETH/USDC');
    
    // Reset all data
    calculator.resetAllData();
    
    // Should have default volatility after reset
    const btcVolatility = calculator.calculateVolatility('BTC/USDC');
    const ethVolatility = calculator.calculateVolatility('ETH/USDC');
    
    expect(btcVolatility).toBe(calculator['config'].defaultVolatility);
    expect(ethVolatility).toBe(calculator['config'].defaultVolatility);
  });
}); 