/**
 * Alpha Cache Manager Tests
 * 
 * Tests for the AlphaCacheManager including:
 * - Caching alpha signals
 * - Retrieving recent signals
 * - Applying decay models
 * - Purging expired signals
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { AlphaCacheManager } from './alpha-cache-manager';
import { AlphaCacheConfig } from './alpha-cache-config';
import { FusedAlphaFrame, SignalDirection } from '../fusion-engine';

// Mock date functions
const originalNow = Date.now;
let mockTime = 1619712000000; // 2021-04-29T12:00:00.000Z

// Mock FusedAlphaFrame
const createMockSignal = (
  symbol: string,
  confidence: number,
  timestamp?: number,
  direction: SignalDirection = SignalDirection.LONG
): FusedAlphaFrame => ({
  symbol,
  confidence,
  direction,
  size: confidence, // Size matches confidence for testing
  sources: ['test'],
  details: [],
  timestamp: timestamp ?? mockTime
});

describe('AlphaCacheManager', () => {
  // Set up mocks before each test
  beforeEach(() => {
    // Mock Date.now
    jest.spyOn(Date, 'now').mockImplementation(() => mockTime);
    
    // Reset mockTime
    mockTime = 1619712000000;
  });
  
  // Clean up after all tests
  afterAll(() => {
    // Restore original Date.now
    jest.spyOn(Date, 'now').mockRestore();
  });
  
  it('should cache and retrieve signals', async () => {
    // Create cache manager with memory backend
    const config: AlphaCacheConfig = {
      enabled: true,
      cacheBackend: 'memory',
      ttlSeconds: 300,
      decayType: 'none', // No decay for this test
      minConfidenceThreshold: 0.1,
      decayFactorPerSec: 0.01
    };
    
    const cacheManager = new AlphaCacheManager(config);
    
    // Create test signal
    const signal = createMockSignal('BTC/USDC', 0.8);
    
    // Add to cache
    const added = await cacheManager.addSignal(signal);
    expect(added).toBe(true);
    
    // Retrieve from cache
    const signals = await cacheManager.getRecentSignals('BTC/USDC', 60);
    expect(signals).toHaveLength(1);
    expect(signals[0].symbol).toBe('BTC/USDC');
    expect(signals[0].confidence).toBe(0.8);
  });
  
  it('should apply linear decay correctly', async () => {
    // Create cache manager with linear decay
    const config: AlphaCacheConfig = {
      enabled: true,
      cacheBackend: 'memory',
      ttlSeconds: 300,
      decayType: 'linear',
      minConfidenceThreshold: 0.1,
      decayFactorPerSec: 0.01 // Lose 0.01 confidence per second
    };
    
    const cacheManager = new AlphaCacheManager(config);
    
    // Create test signal
    const signal = createMockSignal('BTC/USDC', 0.8);
    
    // Add to cache
    await cacheManager.addSignal(signal);
    
    // Advance time by 30 seconds
    mockTime += 30 * 1000;
    
    // Get signal with decay
    const signals = await cacheManager.getRecentSignals('BTC/USDC', 60);
    expect(signals).toHaveLength(1);
    
    // Confidence should be 0.8 - (0.01 * 30) = 0.5
    expect(signals[0].confidence).toBeCloseTo(0.5, 2);
    
    // Size should scale with confidence
    expect(signals[0].size).toBeCloseTo(0.5, 2);
    
    // Advance time by another 30 seconds
    mockTime += 30 * 1000;
    
    // Get signal with decay
    const signals2 = await cacheManager.getRecentSignals('BTC/USDC', 60);
    expect(signals2).toHaveLength(1);
    
    // Confidence should be 0.8 - (0.01 * 60) = 0.2
    expect(signals2[0].confidence).toBeCloseTo(0.2, 2);
  });
  
  it('should apply exponential decay correctly', async () => {
    // Create cache manager with exponential decay
    const config: AlphaCacheConfig = {
      enabled: true,
      cacheBackend: 'memory',
      ttlSeconds: 300,
      decayType: 'exponential',
      minConfidenceThreshold: 0.1,
      decayFactorPerSec: 0.01 // Decay by 1% per second
    };
    
    const cacheManager = new AlphaCacheManager(config);
    
    // Create test signal
    const signal = createMockSignal('BTC/USDC', 0.8);
    
    // Add to cache
    await cacheManager.addSignal(signal);
    
    // Advance time by 70 seconds
    mockTime += 70 * 1000;
    
    // Get signal with decay
    const signals = await cacheManager.getRecentSignals('BTC/USDC', 300);
    expect(signals).toHaveLength(1);
    
    // Confidence should be 0.8 * (1 - 0.01)^70 ≈ 0.8 * 0.4965 ≈ 0.397
    expect(signals[0].confidence).toBeCloseTo(0.397, 2);
  });
  
  it('should filter out signals below threshold', async () => {
    // Create cache manager with linear decay
    const config: AlphaCacheConfig = {
      enabled: true,
      cacheBackend: 'memory',
      ttlSeconds: 300,
      decayType: 'linear',
      minConfidenceThreshold: 0.3, // Higher threshold
      decayFactorPerSec: 0.01
    };
    
    const cacheManager = new AlphaCacheManager(config);
    
    // Create test signal
    const signal = createMockSignal('BTC/USDC', 0.5);
    
    // Add to cache
    await cacheManager.addSignal(signal);
    
    // Get fresh signal (no decay yet)
    let signals = await cacheManager.getRecentSignals('BTC/USDC', 300);
    expect(signals).toHaveLength(1);
    
    // Advance time by 25 seconds
    mockTime += 25 * 1000;
    
    // Confidence should be 0.5 - (0.01 * 25) = 0.25, which is below threshold
    signals = await cacheManager.getRecentSignals('BTC/USDC', 300);
    expect(signals).toHaveLength(0); // Filtered out
  });
  
  it('should purge expired signals', async () => {
    // Create cache manager with shorter TTL
    const config: AlphaCacheConfig = {
      enabled: true,
      cacheBackend: 'memory',
      ttlSeconds: 60, // 1 minute TTL
      decayType: 'none',
      minConfidenceThreshold: 0.1,
      decayFactorPerSec: 0.01
    };
    
    const cacheManager = new AlphaCacheManager(config);
    
    // Create test signals
    const signal1 = createMockSignal('BTC/USDC', 0.8);
    const signal2 = createMockSignal('ETH/USDC', 0.7);
    
    // Add to cache
    await cacheManager.addSignal(signal1);
    await cacheManager.addSignal(signal2);
    
    // Verify both signals are cached
    let btcSignals = await cacheManager.getRecentSignals('BTC/USDC', 300);
    let ethSignals = await cacheManager.getRecentSignals('ETH/USDC', 300);
    expect(btcSignals).toHaveLength(1);
    expect(ethSignals).toHaveLength(1);
    
    // Advance time by 70 seconds (past TTL)
    mockTime += 70 * 1000;
    
    // Manually purge expired signals
    const purgedCount = await cacheManager.purgeExpired();
    expect(purgedCount).toBe(2);
    
    // Verify signals are purged
    btcSignals = await cacheManager.getRecentSignals('BTC/USDC', 300);
    ethSignals = await cacheManager.getRecentSignals('ETH/USDC', 300);
    expect(btcSignals).toHaveLength(0);
    expect(ethSignals).toHaveLength(0);
  });
  
  it('should visualize decay correctly', () => {
    // Create cache manager with exponential decay
    const config: AlphaCacheConfig = {
      enabled: true,
      cacheBackend: 'memory',
      ttlSeconds: 300,
      decayType: 'exponential',
      minConfidenceThreshold: 0.2,
      decayFactorPerSec: 0.01
    };
    
    const cacheManager = new AlphaCacheManager(config);
    
    // Visualize decay
    const decayPoints = cacheManager.visualizeDecay(1.0, 200, 20);
    
    // Check points format
    expect(decayPoints.length).toBeGreaterThan(0);
    expect(decayPoints[0]).toEqual([0, 1.0]); // Initial confidence
    
    // Last point should have confidence near or below threshold
    const lastPoint = decayPoints[decayPoints.length - 1];
    expect(lastPoint[1]).toBeLessThanOrEqual(0.21); // Just above threshold
  });
}); 