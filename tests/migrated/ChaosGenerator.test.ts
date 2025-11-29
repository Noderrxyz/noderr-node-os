/**
 * Tests for the ChaosGenerator
 * 
 * Validates that the chaos generator produces expected stimuli
 * for agent testing.
 */

import { ChaosGenerator } from '../ChaosGenerator';
import { ChaosParams, AgentStimuli, MarketShock } from '@noderr/types/chaos.types';

// Skip global test declarations since they should be defined elsewhere

describe('ChaosGenerator', () => {
  // Default test parameters
  const defaultParams: ChaosParams = {
    marketVolatility: 50,
    corruptionRate: 0.2,
    maxLatencyMs: 1000,
    forceTrustLoss: true,
    conflictRate: 0.3,
    apiFailureRate: 0.1,
    blackSwanProbability: 0.05,
    roundDurationMs: 5000
  };

  test('generateStimuli should produce valid stimuli', async () => {
    const stimuli = ChaosGenerator.generateStimuli(defaultParams);
    
    // Verify stimuli structure
    expect(stimuli).toBeDefined();
    expect(stimuli.marketShock).toBeDefined();
    expect(stimuli.conflictingSignals).toBeDefined();
    expect(typeof stimuli.corruptedInputs).toBe('boolean');
    expect(typeof stimuli.signalLatency).toBe('number');
    expect(typeof stimuli.trustDrop).toBe('number');
    
    // Specific checks
    expect(stimuli.signalLatency).toBeLessThanOrEqual(defaultParams.maxLatencyMs);
    
    // Check market shock
    expect(['up', 'down']).toContain(stimuli.marketShock.direction);
    expect(parseFloat(stimuli.marketShock.magnitude)).toBeGreaterThanOrEqual(0);
    expect(stimuli.marketShock.durationMs).toBeGreaterThan(0);
    
    // Trust drop should be negative since forceTrustLoss is true
    expect(stimuli.trustDrop).toBeLessThan(0);
  });
  
  test('randomShock should scale with volatility', async () => {
    // Test with low volatility
    const lowVolShock = ChaosGenerator.randomShock(10);
    const lowMagnitude = parseFloat(lowVolShock.magnitude);
    
    // Test with high volatility
    const highVolShock = ChaosGenerator.randomShock(90);
    const highMagnitude = parseFloat(highVolShock.magnitude);
    
    // Higher volatility should produce larger shocks on average
    // Running multiple times to account for randomness
    let lowSum = 0;
    let highSum = 0;
    
    for (let i = 0; i < 50; i++) {
      lowSum += parseFloat(ChaosGenerator.randomShock(10).magnitude);
      highSum += parseFloat(ChaosGenerator.randomShock(90).magnitude);
    }
    
    expect(highSum).toBeGreaterThan(lowSum);
  });
  
  test('generateConflicts should honor conflict rate', async () => {
    // Test with high conflict rate to ensure we generate conflicts
    const highConflictParams = { ...defaultParams, conflictRate: 1.0 };
    const conflicts = ChaosGenerator.generateConflicts(highConflictParams.conflictRate);
    
    // Should generate at least some conflicts
    expect(conflicts.length).toBeGreaterThan(0);
    
    // Check structure of conflicts
    if (conflicts.length > 0) {
      expect(conflicts[0]).toHaveProperty('source');
      expect(conflicts[0]).toHaveProperty('score');
      expect(conflicts[0].score).toBeGreaterThanOrEqual(0);
      expect(conflicts[0].score).toBeLessThanOrEqual(100);
    }
    
    // Test with zero conflict rate
    const noConflicts = ChaosGenerator.generateConflicts(0);
    expect(noConflicts.length).toBe(0);
  });
  
  test('generateMarketData should produce valid market data', async () => {
    const basePrice = 1000;
    
    // Normal data
    const normalData = ChaosGenerator.generateMarketData(basePrice, 50, false);
    expect(normalData).toHaveProperty('price');
    expect(normalData).toHaveProperty('volume');
    expect(normalData).toHaveProperty('bid');
    expect(normalData).toHaveProperty('ask');
    expect(normalData).toHaveProperty('timestamp');
    
    // Price should be around base price, accounting for volatility
    expect(normalData.price).toBeGreaterThan(basePrice * 0.9);
    expect(normalData.price).toBeLessThan(basePrice * 1.1);
    
    // Bid should be less than ask
    expect(normalData.bid).toBeLessThan(normalData.ask);
  });
  
  test('generateMarketData can produce corrupted data', async () => {
    // Run multiple times to ensure we hit different corruption types
    let foundCorruption = false;
    let iterations = 0;
    const maxIterations = 100;
    
    while (!foundCorruption && iterations < maxIterations) {
      const data = ChaosGenerator.generateMarketData(1000, 50, true);
      
      // Check for potential corruptions
      if (
        // Missing volume
        !data.hasOwnProperty('volume') ||
        // Price spike
        data.price > 3000 ||
        // Inverted bid/ask
        data.bid > data.ask ||
        // Future timestamp
        data.timestamp > Date.now() + 1000
      ) {
        foundCorruption = true;
      }
      
      iterations++;
    }
    
    expect(foundCorruption).toBe(true);
  });
  
  test('generateBlackSwan should produce a high-impact event', async () => {
    const blackSwan = ChaosGenerator.generateBlackSwan();
    
    expect(blackSwan).toHaveProperty('type');
    expect(blackSwan).toHaveProperty('impact');
    expect(blackSwan).toHaveProperty('description');
    expect(blackSwan).toHaveProperty('durationMs');
    
    // Impact should be significant
    expect(Math.abs(blackSwan.impact)).toBeGreaterThan(0.1);
  });
  
  test('generateApiFailure should honor failure rate', async () => {
    // Always fail
    const alwaysFail = ChaosGenerator.generateApiFailure(1.0);
    expect(alwaysFail).not.toBeNull();
    expect(alwaysFail).toHaveProperty('code');
    expect(alwaysFail).toHaveProperty('message');
    
    // Never fail
    const neverFail = ChaosGenerator.generateApiFailure(0);
    expect(neverFail).toBeNull();
  });
}); 