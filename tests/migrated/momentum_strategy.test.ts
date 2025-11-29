import { MomentumStrategy, DEFAULT_MOMENTUM_PARAMETERS } from '@noderr/strategy/MomentumStrategy';
import { MarketRegime, MarketFeatures } from '@noderr/regime/RegimeClassifier';
import { Signal } from '@noderr/strategy/AdaptiveStrategy';

describe('MomentumStrategy', () => {
  let strategy: MomentumStrategy;
  
  // Helper for creating market features
  const createMarketFeatures = (
    price: number = 100,
    returns1d: number = 0.01,
    returns5d: number = 0.03,
    returns20d: number = 0.05,
    rsi14: number = 60,
    volatility20d: number = 0.2
  ): MarketFeatures => ({
    price,
    returns1d,
    returns5d,
    returns20d,
    
    // Volatility features
    volatility1d: volatility20d * 0.5,
    volatility5d: volatility20d * 0.7,
    volatility20d,
    
    // Volume features
    volumeRatio1d: 1.1,
    volumeRatio5d: 1.2,
    
    // Technical indicators
    rsi14,
    atr14: price * 0.01,
    bbWidth: 0.05,
    macdHistogram: 0.002,
    
    // Market breadth
    advanceDeclineRatio: 1.5,
    marketCap: 1000000000
  });
  
  beforeEach(() => {
    // Reset strategy before each test
    strategy = new MomentumStrategy();
  });
  
  describe('signal generation', () => {
    it('should generate buy signals in bullish trend regimes', async () => {
      const features = createMarketFeatures(100, 0.01, 0.03, 0.05, 60, 0.15);
      const signal = await strategy.generateSignal('BTC-USD', features);
      
      expect(signal).not.toBeNull();
      expect(signal?.direction).toBe('buy');
      expect(signal?.symbol).toBe('BTC-USD');
      expect(signal?.strength).toBeGreaterThan(0);
      expect(signal?.meta.regime).toBe(MarketRegime.BullishTrend);
    });
    
    it('should generate sell signals in bearish trend regimes', async () => {
      const features = createMarketFeatures(100, -0.01, -0.03, -0.05, 30, 0.25);
      
      // Mock the regime classifier to always return bearish trend
      const mockClassifyRegime = jest.fn().mockReturnValue({
        primaryRegime: MarketRegime.BearishTrend,
        secondaryRegime: null,
        confidence: 0.8,
        scores: { [MarketRegime.BearishTrend]: 0.8 },
        timestamp: new Date(),
        features
      });
      
      // @ts-ignore - private property
      strategy.regimeClassifier = {
        classifyRegime: mockClassifyRegime,
        getInstance: jest.fn().mockReturnThis()
      };
      
      const signal = await strategy.generateSignal('BTC-USD', features);
      
      expect(signal).not.toBeNull();
      expect(signal?.direction).toBe('sell');
      expect(signal?.symbol).toBe('BTC-USD');
      expect(signal?.strength).toBeGreaterThan(0);
      expect(signal?.meta.regime).toBe(MarketRegime.BearishTrend);
    });
    
    it('should generate reversed signals in rangebound regimes', async () => {
      const features = createMarketFeatures(100, 0.01, 0.02, 0.01, 50, 0.1);
      
      // Mock the regime classifier to always return rangebound
      const mockClassifyRegime = jest.fn().mockReturnValue({
        primaryRegime: MarketRegime.Rangebound,
        secondaryRegime: null,
        confidence: 0.8,
        scores: { [MarketRegime.Rangebound]: 0.8 },
        timestamp: new Date(),
        features
      });
      
      // @ts-ignore - private property
      strategy.regimeClassifier = {
        classifyRegime: mockClassifyRegime,
        getInstance: jest.fn().mockReturnThis()
      };
      
      const signal = await strategy.generateSignal('BTC-USD', features);
      
      // In rangebound markets, the strategy should reverse the momentum signal
      // Since we provided positive returns, the reversed signal should be sell
      expect(signal?.direction).toBe('sell');
    });
    
    it('should return null for neutral signals', async () => {
      // Create features with small momentum that doesn't exceed thresholds
      const features = createMarketFeatures(100, 0.001, 0.005, 0.01, 50, 0.1);
      
      // Mock the regime classifier
      const mockClassifyRegime = jest.fn().mockReturnValue({
        primaryRegime: MarketRegime.LowVolatility,
        secondaryRegime: null,
        confidence: 0.8,
        scores: { [MarketRegime.LowVolatility]: 0.8 },
        timestamp: new Date(),
        features
      });
      
      // @ts-ignore - private property
      strategy.regimeClassifier = {
        classifyRegime: mockClassifyRegime,
        getInstance: jest.fn().mockReturnThis()
      };
      
      const signal = await strategy.generateSignal('BTC-USD', features);
      
      // Signal should be null since momentum is too small to trigger
      expect(signal).toBeNull();
    });
    
    it('should adjust strength based on momentum magnitude', async () => {
      // Create features with strong momentum
      const features = createMarketFeatures(100, 0.02, 0.06, 0.1, 75, 0.2);
      
      // Mock the regime classifier
      const mockClassifyRegime = jest.fn().mockReturnValue({
        primaryRegime: MarketRegime.BullishTrend,
        secondaryRegime: null,
        confidence: 0.9,
        scores: { [MarketRegime.BullishTrend]: 0.9 },
        timestamp: new Date(),
        features
      });
      
      // @ts-ignore - private property
      strategy.regimeClassifier = {
        classifyRegime: mockClassifyRegime,
        getInstance: jest.fn().mockReturnThis()
      };
      
      const signal = await strategy.generateSignal('BTC-USD', features);
      
      // Signal should have high strength due to strong momentum
      expect(signal).not.toBeNull();
      expect(signal?.direction).toBe('buy');
      expect(signal?.strength).toBeGreaterThan(0.5);
      
      // Create features with weak momentum
      const weakFeatures = createMarketFeatures(100, 0.01, 0.025, 0.03, 55, 0.15);
      
      // Update mock
      mockClassifyRegime.mockReturnValueOnce({
        primaryRegime: MarketRegime.BullishTrend,
        secondaryRegime: null,
        confidence: 0.9,
        scores: { [MarketRegime.BullishTrend]: 0.9 },
        timestamp: new Date(),
        features: weakFeatures
      });
      
      const weakSignal = await strategy.generateSignal('BTC-USD', weakFeatures);
      
      // Signal should have lower strength due to weaker momentum
      expect(weakSignal).not.toBeNull();
      expect(weakSignal?.direction).toBe('buy');
      expect(weakSignal?.strength).toBeLessThan(signal?.strength || 1);
    });
  });
  
  describe('regime adaptation', () => {
    it('should use different lookback periods in different regimes', async () => {
      const features = createMarketFeatures();
      const signals: Record<MarketRegime, Signal | null> = {} as any;
      const regimes = [
        MarketRegime.BullishTrend,
        MarketRegime.BearishTrend,
        MarketRegime.Rangebound,
        MarketRegime.HighVolatility,
        MarketRegime.LowVolatility
      ];
      
      // Test signal generation in each regime
      for (const regime of regimes) {
        // Mock the regime classifier
        const mockClassifyRegime = jest.fn().mockReturnValue({
          primaryRegime: regime,
          secondaryRegime: null,
          confidence: 0.8,
          scores: { [regime]: 0.8 },
          timestamp: new Date(),
          features
        });
        
        // @ts-ignore - private property
        strategy.regimeClassifier = {
          classifyRegime: mockClassifyRegime,
          getInstance: jest.fn().mockReturnThis()
        };
        
        signals[regime] = await strategy.generateSignal('BTC-USD', features);
      }
      
      // Verify different lookback periods were used
      if (signals[MarketRegime.BullishTrend] && signals[MarketRegime.BearishTrend]) {
        expect(signals[MarketRegime.BullishTrend].meta.lookbackPeriod)
          .not.toBe(signals[MarketRegime.BearishTrend].meta.lookbackPeriod);
      }
      
      if (signals[MarketRegime.HighVolatility] && signals[MarketRegime.LowVolatility]) {
        expect(signals[MarketRegime.HighVolatility].meta.lookbackPeriod)
          .not.toBe(signals[MarketRegime.LowVolatility].meta.lookbackPeriod);
        
        // High volatility should use longer lookback
        expect(signals[MarketRegime.HighVolatility].meta.lookbackPeriod)
          .toBeGreaterThan(signals[MarketRegime.LowVolatility].meta.lookbackPeriod);
      }
    });
  });
  
  describe('strategy parameters', () => {
    it('should use default parameters', () => {
      // @ts-ignore - accessing private property
      const params = strategy.defaultParameters;
      
      expect(params).toEqual(DEFAULT_MOMENTUM_PARAMETERS);
      expect(params.shortPeriod).toBe(10);
      expect(params.mediumPeriod).toBe(20);
      expect(params.longPeriod).toBe(50);
    });
    
    it('should return correct strategy type and tags', () => {
      // @ts-ignore - accessing private methods
      expect(strategy.getStrategyType()).toBe('momentum');
      
      // @ts-ignore - accessing private methods
      const tags = strategy.getStrategyTags();
      expect(tags).toContain('momentum');
      expect(tags).toContain('trend-following');
      expect(tags).toContain('adaptive');
    });
  });
}); 