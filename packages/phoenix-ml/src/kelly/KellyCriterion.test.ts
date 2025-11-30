/**
 * @fileoverview Unit tests for Kelly Criterion Position Sizing
 * @author Manus AI
 * @version 1.0.0
 */

import { KellyCriterion } from './KellyCriterion';
import {
  KellyCriterionConfig,
  ModelPerformance,
  MLError,
  MLErrorCode,
} from '@noderr/phoenix-types';

describe('KellyCriterion', () => {
  let kelly: KellyCriterion;
  let config: KellyCriterionConfig;
  
  beforeEach(() => {
    config = {
      confidenceLevel: 0.25, // Fractional Kelly
      minTrades: 30,
    };
    kelly = new KellyCriterion(config);
  });
  
  describe('constructor', () => {
    it('should create a new instance with valid config', () => {
      expect(kelly).toBeInstanceOf(KellyCriterion);
    });
    
    it('should throw error with invalid confidence level', () => {
      expect(() => {
        new KellyCriterion({ confidenceLevel: 0, minTrades: 30 });
      }).toThrow(MLError);
      
      expect(() => {
        new KellyCriterion({ confidenceLevel: 1.5, minTrades: 30 });
      }).toThrow(MLError);
    });
    
    it('should throw error with invalid minTrades', () => {
      expect(() => {
        new KellyCriterion({ confidenceLevel: 0.25, minTrades: 0 });
      }).toThrow(MLError);
    });
  });
  
  describe('calculatePositionSize', () => {
    it('should return conservative size with no performance history', async () => {
      const result = await kelly.calculatePositionSize('BTC/USD', 0.7, 0.25);
      
      expect(result.symbol).toBe('BTC/USD');
      expect(result.recommendedSize).toBeGreaterThanOrEqual(0);
      expect(result.recommendedSize).toBeLessThanOrEqual(0.25);
      expect(result.sizingMethod).toBe('Kelly Criterion');
    });
    
    it('should calculate position size with performance history', async () => {
      const performance: ModelPerformance = {
        accuracy: 0.65,
        precision: 0.70,
        recall: 0.60,
        f1Score: 0.65,
        sharpeRatio: 1.5,
        sortinoRatio: 2.0,
        maxDrawdown: 0.15,
        winRate: 0.65,
        avgWin: 0.03,
        avgLoss: 0.02,
        totalTrades: 100,
      };
      
      kelly.updatePerformance('BTC/USD', performance);
      
      const result = await kelly.calculatePositionSize('BTC/USD', 0.8, 0.25);
      
      expect(result.recommendedSize).toBeGreaterThan(0);
      expect(result.recommendedSize).toBeLessThanOrEqual(0.25);
    });
    
    it('should respect max position size', async () => {
      const performance: ModelPerformance = {
        accuracy: 0.80,
        precision: 0.85,
        recall: 0.75,
        f1Score: 0.80,
        sharpeRatio: 2.5,
        sortinoRatio: 3.0,
        maxDrawdown: 0.10,
        winRate: 0.80,
        avgWin: 0.05,
        avgLoss: 0.01,
        totalTrades: 200,
      };
      
      kelly.updatePerformance('BTC/USD', performance);
      
      const result = await kelly.calculatePositionSize('BTC/USD', 0.9, 0.10);
      
      expect(result.recommendedSize).toBeLessThanOrEqual(0.10);
    });
    
    it('should throw error with invalid symbol', async () => {
      await expect(
        kelly.calculatePositionSize('', 0.7, 0.25)
      ).rejects.toThrow(MLError);
    });
    
    it('should throw error with invalid confidence', async () => {
      await expect(
        kelly.calculatePositionSize('BTC/USD', -0.1, 0.25)
      ).rejects.toThrow(MLError);
      
      await expect(
        kelly.calculatePositionSize('BTC/USD', 1.5, 0.25)
      ).rejects.toThrow(MLError);
    });
    
    it('should throw error with invalid max position size', async () => {
      await expect(
        kelly.calculatePositionSize('BTC/USD', 0.7, 0)
      ).rejects.toThrow(MLError);
      
      await expect(
        kelly.calculatePositionSize('BTC/USD', 0.7, 1.5)
      ).rejects.toThrow(MLError);
    });
    
    it('should emit positionSized event', async () => {
      const spy = jest.fn();
      kelly.on('positionSized', spy);
      
      await kelly.calculatePositionSize('BTC/USD', 0.7, 0.25);
      
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          symbol: 'BTC/USD',
          kellyFraction: expect.any(Number),
          adjustedKelly: expect.any(Number),
          finalSize: expect.any(Number),
          processingTime: expect.any(Number),
        })
      );
    });
  });
  
  describe('updatePerformance', () => {
    it('should update performance statistics', () => {
      const performance: ModelPerformance = {
        accuracy: 0.65,
        precision: 0.70,
        recall: 0.60,
        f1Score: 0.65,
        sharpeRatio: 1.5,
        sortinoRatio: 2.0,
        maxDrawdown: 0.15,
        winRate: 0.65,
        avgWin: 0.03,
        avgLoss: 0.02,
        totalTrades: 100,
      };
      
      kelly.updatePerformance('BTC/USD', performance);
      
      const stats = kelly.getPerformance('BTC/USD');
      expect(stats).not.toBeNull();
      expect(stats?.winRate).toBe(0.65);
      expect(stats?.totalTrades).toBe(100);
    });
    
    it('should emit performanceUpdated event', () => {
      const spy = jest.fn();
      kelly.on('performanceUpdated', spy);
      
      const performance: ModelPerformance = {
        accuracy: 0.65,
        precision: 0.70,
        recall: 0.60,
        f1Score: 0.65,
        sharpeRatio: 1.5,
        sortinoRatio: 2.0,
        maxDrawdown: 0.15,
        winRate: 0.65,
        avgWin: 0.03,
        avgLoss: 0.02,
        totalTrades: 100,
      };
      
      kelly.updatePerformance('BTC/USD', performance);
      
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          symbol: 'BTC/USD',
          stats: expect.any(Object),
        })
      );
    });
  });
  
  describe('getPerformance', () => {
    it('should return null for unknown symbol', () => {
      const stats = kelly.getPerformance('UNKNOWN');
      expect(stats).toBeNull();
    });
    
    it('should return performance statistics for known symbol', () => {
      const performance: ModelPerformance = {
        accuracy: 0.65,
        precision: 0.70,
        recall: 0.60,
        f1Score: 0.65,
        sharpeRatio: 1.5,
        sortinoRatio: 2.0,
        maxDrawdown: 0.15,
        winRate: 0.65,
        avgWin: 0.03,
        avgLoss: 0.02,
        totalTrades: 100,
      };
      
      kelly.updatePerformance('BTC/USD', performance);
      
      const stats = kelly.getPerformance('BTC/USD');
      expect(stats).not.toBeNull();
      expect(stats?.symbol).toBe('BTC/USD');
    });
  });
  
  describe('clearPerformance', () => {
    it('should clear performance for a symbol', () => {
      const performance: ModelPerformance = {
        accuracy: 0.65,
        precision: 0.70,
        recall: 0.60,
        f1Score: 0.65,
        sharpeRatio: 1.5,
        sortinoRatio: 2.0,
        maxDrawdown: 0.15,
        winRate: 0.65,
        avgWin: 0.03,
        avgLoss: 0.02,
        totalTrades: 100,
      };
      
      kelly.updatePerformance('BTC/USD', performance);
      kelly.clearPerformance('BTC/USD');
      
      const stats = kelly.getPerformance('BTC/USD');
      expect(stats).toBeNull();
    });
    
    it('should emit performanceCleared event', () => {
      const spy = jest.fn();
      kelly.on('performanceCleared', spy);
      
      kelly.clearPerformance('BTC/USD');
      
      expect(spy).toHaveBeenCalledWith({ symbol: 'BTC/USD' });
    });
  });
  
  describe('clearAllPerformance', () => {
    it('should clear all performance statistics', () => {
      const performance: ModelPerformance = {
        accuracy: 0.65,
        precision: 0.70,
        recall: 0.60,
        f1Score: 0.65,
        sharpeRatio: 1.5,
        sortinoRatio: 2.0,
        maxDrawdown: 0.15,
        winRate: 0.65,
        avgWin: 0.03,
        avgLoss: 0.02,
        totalTrades: 100,
      };
      
      kelly.updatePerformance('BTC/USD', performance);
      kelly.updatePerformance('ETH/USD', performance);
      
      kelly.clearAllPerformance();
      
      expect(kelly.getPerformance('BTC/USD')).toBeNull();
      expect(kelly.getPerformance('ETH/USD')).toBeNull();
    });
    
    it('should emit allPerformanceCleared event', () => {
      const spy = jest.fn();
      kelly.on('allPerformanceCleared', spy);
      
      kelly.clearAllPerformance();
      
      expect(spy).toHaveBeenCalled();
    });
  });
  
  describe('Kelly Criterion Formula', () => {
    it('should calculate correct Kelly fraction for profitable strategy', async () => {
      // Win rate = 60%, Avg Win = 3%, Avg Loss = 2%
      // b = 3/2 = 1.5
      // Kelly = (0.6 * 1.5 - 0.4) / 1.5 = 0.333
      // Fractional Kelly (0.25) = 0.333 * 0.25 = 0.083
      
      const performance: ModelPerformance = {
        accuracy: 0.60,
        precision: 0.65,
        recall: 0.55,
        f1Score: 0.60,
        sharpeRatio: 1.2,
        sortinoRatio: 1.8,
        maxDrawdown: 0.20,
        winRate: 0.60,
        avgWin: 0.03,
        avgLoss: 0.02,
        totalTrades: 100,
      };
      
      kelly.updatePerformance('BTC/USD', performance);
      
      const result = await kelly.calculatePositionSize('BTC/USD', 1.0, 0.25);
      
      // Should be positive and less than max
      expect(result.recommendedSize).toBeGreaterThan(0);
      expect(result.recommendedSize).toBeLessThanOrEqual(0.25);
    });
    
    it('should return zero for unprofitable strategy', async () => {
      // Win rate = 40%, Avg Win = 2%, Avg Loss = 3%
      // b = 2/3 = 0.667
      // Kelly = (0.4 * 0.667 - 0.6) / 0.667 = -0.5 (negative)
      
      const performance: ModelPerformance = {
        accuracy: 0.40,
        precision: 0.45,
        recall: 0.35,
        f1Score: 0.40,
        sharpeRatio: -0.5,
        sortinoRatio: -0.8,
        maxDrawdown: 0.40,
        winRate: 0.40,
        avgWin: 0.02,
        avgLoss: 0.03,
        totalTrades: 100,
      };
      
      kelly.updatePerformance('BTC/USD', performance);
      
      const result = await kelly.calculatePositionSize('BTC/USD', 1.0, 0.25);
      
      // Should be zero or very small for unprofitable strategy
      expect(result.recommendedSize).toBeLessThanOrEqual(0.01);
    });
  });
});
