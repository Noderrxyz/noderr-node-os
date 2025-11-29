/**
 * Tests for Time-of-Day Bias Adjuster
 */

import { TimeOfDayBiasAdjuster } from './time-bias-adjuster.js';
import { FusedAlphaFrame } from './fusion-engine.js';
import { SignalDirection } from './fusion-engine.js';

// Mock logger to prevent actual logging during tests
jest.mock('../common/logger.js', () => ({
  createLogger: () => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  })
}));

describe('TimeOfDayBiasAdjuster', () => {
  // Helper to create a mock signal at a specific time
  const createMockSignal = (hour: number, minute: number = 0): FusedAlphaFrame => {
    const date = new Date();
    date.setHours(hour, minute, 0, 0);
    
    return {
      symbol: 'BTC/USDC',
      direction: SignalDirection.LONG,
      confidence: 0.75,
      size: 0.5,
      sources: ['mock-source'],
      details: [],
      timestamp: date.getTime()
    };
  };
  
  describe('initialization', () => {
    it('should initialize with default config', () => {
      const adjuster = new TimeOfDayBiasAdjuster();
      expect(adjuster).toBeDefined();
    });
    
    it('should accept custom config', () => {
      const adjuster = new TimeOfDayBiasAdjuster({
        bucketIntervalMinutes: 30,
        minDataPoints: 10
      });
      expect(adjuster).toBeDefined();
    });
  });
  
  describe('adjustSignal', () => {
    it('should return the original signal when disabled', () => {
      const adjuster = new TimeOfDayBiasAdjuster({ enabled: false });
      const signal = createMockSignal(12);
      const result = adjuster.adjustSignal(signal);
      
      expect(result.confidence).toBe(signal.confidence);
    });
    
    it('should return the original signal when not enough data points', () => {
      const adjuster = new TimeOfDayBiasAdjuster({ minDataPoints: 10 });
      const signal = createMockSignal(12);
      const result = adjuster.adjustSignal(signal);
      
      expect(result.confidence).toBe(signal.confidence);
    });
    
    it('should add metadata to adjusted signal', () => {
      const adjuster = new TimeOfDayBiasAdjuster();
      const signal = createMockSignal(12);
      const result = adjuster.adjustSignal(signal);
      
      expect(result.metadata).toBeDefined();
      expect(result.metadata?.timeBiasFactor).toBeDefined();
      expect(result.metadata?.timeOfDayBucket).toBeDefined();
    });
  });
  
  describe('recordOutcome', () => {
    it('should update bucket statistics', () => {
      const adjuster = new TimeOfDayBiasAdjuster();
      const signal = createMockSignal(12);
      const adjusted = adjuster.adjustSignal(signal);
      
      // Record a positive outcome
      adjuster.recordOutcome(adjusted, 0.2);
      
      // Get bucket stats
      const stats = adjuster.getBucketStats();
      const bucketIndex = Math.floor((12 * 60) / 60); // 12 hour bucket
      const bucket = stats.get(bucketIndex);
      
      expect(bucket).toBeDefined();
      expect(bucket?.signalCount).toBe(1);
      expect(bucket?.cumulativeOutcome).toBe(0.2);
      expect(bucket?.meanOutcome).toBe(0.2);
    });
    
    it('should build bias over time', () => {
      const adjuster = new TimeOfDayBiasAdjuster({
        minDataPoints: 5,  // Lower for testing
        smoothing: 0.5     // Higher for faster updates
      });
      
      const hour = 14; // 2 PM
      const bucketIndex = Math.floor((hour * 60) / 60);
      
      // Simulate multiple good outcomes at 2 PM
      for (let i = 0; i < 5; i++) {
        const signal = createMockSignal(hour, i);
        const adjusted = adjuster.adjustSignal(signal);
        adjuster.recordOutcome(adjusted, 0.3);
      }
      
      // Now check the bias factor
      const biasFactor = adjuster.getBiasFactor(createMockSignal(hour).timestamp);
      
      // Should be greater than 1.0 since outcomes were positive
      expect(biasFactor).toBeGreaterThan(1.0);
      
      // Apply the bias to a new signal
      const newSignal = createMockSignal(hour);
      const biasedSignal = adjuster.adjustSignal(newSignal);
      
      // The biased signal should have higher confidence
      expect(biasedSignal.confidence).toBeGreaterThan(newSignal.confidence);
    });
    
    it('should reduce confidence for poor performing times', () => {
      const adjuster = new TimeOfDayBiasAdjuster({
        minDataPoints: 5,  // Lower for testing
        smoothing: 0.5     // Higher for faster updates
      });
      
      const hour = 22; // 10 PM
      const bucketIndex = Math.floor((hour * 60) / 60);
      
      // Simulate multiple bad outcomes at 10 PM
      for (let i = 0; i < 5; i++) {
        const signal = createMockSignal(hour, i);
        const adjusted = adjuster.adjustSignal(signal);
        adjuster.recordOutcome(adjusted, -0.3);
      }
      
      // Now check the bias factor
      const biasFactor = adjuster.getBiasFactor(createMockSignal(hour).timestamp);
      
      // Should be less than 1.0 since outcomes were negative
      expect(biasFactor).toBeLessThan(1.0);
      
      // Apply the bias to a new signal
      const newSignal = createMockSignal(hour);
      const biasedSignal = adjuster.adjustSignal(newSignal);
      
      // The biased signal should have lower confidence
      expect(biasedSignal.confidence).toBeLessThan(newSignal.confidence);
    });
  });
  
  describe('recordOutcomeById', () => {
    it('should record outcome when signal exists', () => {
      const adjuster = new TimeOfDayBiasAdjuster();
      const signal = createMockSignal(12);
      const adjusted = adjuster.adjustSignal(signal);
      
      // Create an ID the same way the adjuster does internally
      const signalId = `${signal.symbol}_${signal.timestamp}`;
      
      // Record by ID
      const result = adjuster.recordOutcomeById(signalId, 0.1);
      
      expect(result).toBe(true);
    });
    
    it('should return false when signal does not exist', () => {
      const adjuster = new TimeOfDayBiasAdjuster();
      const result = adjuster.recordOutcomeById('nonexistent_signal', 0.1);
      
      expect(result).toBe(false);
    });
  });
  
  describe('getBiasFactor', () => {
    it('should return default factor when not enough data', () => {
      const adjuster = new TimeOfDayBiasAdjuster();
      const factor = adjuster.getBiasFactor(Date.now());
      
      expect(factor).toBe(1.0);
    });
  });
  
  describe('reset', () => {
    it('should clear all statistics', () => {
      const adjuster = new TimeOfDayBiasAdjuster({ minDataPoints: 1 });
      
      // Add some data
      const signal = createMockSignal(12);
      const adjusted = adjuster.adjustSignal(signal);
      adjuster.recordOutcome(adjusted, 0.2);
      
      // Verify data exists
      const bucketIndex = Math.floor((12 * 60) / 60);
      expect(adjuster.getBucketStats().get(bucketIndex)?.signalCount).toBe(1);
      
      // Reset
      adjuster.reset();
      
      // Verify data is cleared
      expect(adjuster.getBucketStats().get(bucketIndex)?.signalCount).toBe(0);
    });
  });
}); 