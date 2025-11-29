import { MultiTimescaleAlphaFusion } from './MultiTimescaleAlphaFusion.js';
import { Timescale } from './types/multi_timescale.types.js';
import { AlphaFrame } from '../alphasources/types.js';

describe('MultiTimescaleAlphaFusion', () => {
  let fusion: MultiTimescaleAlphaFusion;
  const symbol = 'ETH-USDC';
  
  beforeEach(() => {
    fusion = new MultiTimescaleAlphaFusion();
  });
  
  describe('addTimescaleFrame', () => {
    it('should add frames for different timescales', () => {
      const shortTermFrame: AlphaFrame = {
        symbol,
        source: 'short_term_alpha',
        score: 0.7,
        confidence: 0.8,
        timestamp: Date.now()
      };
      
      const midTermFrame: AlphaFrame = {
        symbol,
        source: 'mid_term_alpha',
        score: 0.6,
        confidence: 0.9,
        timestamp: Date.now()
      };
      
      const longTermFrame: AlphaFrame = {
        symbol,
        source: 'long_term_alpha',
        score: 0.8,
        confidence: 0.7,
        timestamp: Date.now()
      };
      
      fusion.addTimescaleFrame(Timescale.SHORT_TERM, shortTermFrame);
      fusion.addTimescaleFrame(Timescale.MID_TERM, midTermFrame);
      fusion.addTimescaleFrame(Timescale.LONG_TERM, longTermFrame);
      
      const result = fusion.fuse(symbol);
      expect(result).not.toBeNull();
      expect(result?.symbol).toBe(symbol);
      expect(result?.contributions[Timescale.SHORT_TERM]).toBeGreaterThan(0);
      expect(result?.contributions[Timescale.MID_TERM]).toBeGreaterThan(0);
      expect(result?.contributions[Timescale.LONG_TERM]).toBeGreaterThan(0);
    });
    
    it('should handle insufficient signals', () => {
      const frame: AlphaFrame = {
        symbol,
        source: 'test_alpha',
        score: 0.7,
        confidence: 0.8,
        timestamp: Date.now()
      };
      
      fusion.addTimescaleFrame(Timescale.SHORT_TERM, frame);
      
      const result = fusion.fuse(symbol);
      expect(result).toBeNull();
    });
  });
  
  describe('fuse', () => {
    it('should adapt weights based on volatility', () => {
      // Create high volatility scenario
      const frames: AlphaFrame[] = Array.from({ length: 10 }, (_, i) => ({
        symbol,
        source: 'volatile_alpha',
        score: 0.5 + (Math.random() - 0.5) * 0.4, // High volatility
        confidence: 0.8,
        timestamp: Date.now() + i * 1000
      }));
      
      // Add frames for each timescale
      frames.forEach(frame => {
        fusion.addTimescaleFrame(Timescale.SHORT_TERM, frame);
        fusion.addTimescaleFrame(Timescale.MID_TERM, frame);
        fusion.addTimescaleFrame(Timescale.LONG_TERM, frame);
      });
      
      const result = fusion.fuse(symbol);
      expect(result).not.toBeNull();
      expect(result?.metadata.volatilityRegime).toBe('HIGH');
      expect(result?.contributions[Timescale.SHORT_TERM])
        .toBeGreaterThan(result?.contributions[Timescale.LONG_TERM] || 0);
    });
    
    it('should adapt weights based on performance', () => {
      // Create frames with different performance characteristics
      const shortTermFrames: AlphaFrame[] = Array.from({ length: 10 }, (_, i) => ({
        symbol,
        source: 'improving_alpha',
        score: 0.5 + i * 0.05, // Consistently improving
        confidence: 0.8,
        timestamp: Date.now() + i * 1000
      }));
      
      const midTermFrames: AlphaFrame[] = Array.from({ length: 10 }, (_, i) => ({
        symbol,
        source: 'random_alpha',
        score: 0.5 + (Math.random() - 0.5) * 0.2, // Random
        confidence: 0.8,
        timestamp: Date.now() + i * 1000
      }));
      
      const longTermFrames: AlphaFrame[] = Array.from({ length: 10 }, (_, i) => ({
        symbol,
        source: 'declining_alpha',
        score: 0.5 - i * 0.05, // Consistently declining
        confidence: 0.8,
        timestamp: Date.now() + i * 1000
      }));
      
      // Add frames
      shortTermFrames.forEach(frame => fusion.addTimescaleFrame(Timescale.SHORT_TERM, frame));
      midTermFrames.forEach(frame => fusion.addTimescaleFrame(Timescale.MID_TERM, frame));
      longTermFrames.forEach(frame => fusion.addTimescaleFrame(Timescale.LONG_TERM, frame));
      
      const result = fusion.fuse(symbol);
      expect(result).not.toBeNull();
      
      // Short-term should have higher weight due to better performance
      expect(result?.contributions[Timescale.SHORT_TERM])
        .toBeGreaterThan(result?.contributions[Timescale.LONG_TERM] || 0);
    });
    
    it('should calculate trend strength', () => {
      // Create frames with strong trend
      const frames: AlphaFrame[] = Array.from({ length: 10 }, (_, i) => ({
        symbol,
        source: 'trending_alpha',
        score: 0.5 + i * 0.05, // Strong upward trend
        confidence: 0.8,
        timestamp: Date.now() + i * 1000
      }));
      
      frames.forEach(frame => {
        fusion.addTimescaleFrame(Timescale.SHORT_TERM, frame);
        fusion.addTimescaleFrame(Timescale.MID_TERM, frame);
        fusion.addTimescaleFrame(Timescale.LONG_TERM, frame);
      });
      
      const result = fusion.fuse(symbol);
      expect(result).not.toBeNull();
      expect(result?.metadata.trendStrength).toBeGreaterThan(0.5);
    });
  });
}); 