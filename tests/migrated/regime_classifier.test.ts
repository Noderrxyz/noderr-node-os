import { RegimeClassifier, MarketRegime, MarketFeatures } from '@noderr/regime/RegimeClassifier';

describe('RegimeClassifier', () => {
  let classifier: RegimeClassifier;
  
  beforeEach(() => {
    // Reset the singleton instance before each test
    (RegimeClassifier as any).instance = null;
    classifier = RegimeClassifier.getInstance();
  });
  
  describe('singleton pattern', () => {
    it('should return the same instance when getInstance is called multiple times', () => {
      const instance1 = RegimeClassifier.getInstance();
      const instance2 = RegimeClassifier.getInstance();
      
      expect(instance1).toBe(instance2);
    });
  });
  
  describe('regime classification', () => {
    const createBullishFeatures = (): MarketFeatures => ({
      price: 100,
      returns1d: 0.02,
      returns5d: 0.05,
      returns20d: 0.15,
      volatility1d: 0.01,
      volatility5d: 0.02,
      volatility20d: 0.15,
      volumeRatio1d: 1.2,
      volumeRatio5d: 1.1,
      rsi14: 65,
      atr14: 2,
      bbWidth: 0.03,
      macdHistogram: 0.5,
      advanceDeclineRatio: 1.5,
      marketCap: 1000000000,
    });
    
    const createBearishFeatures = (): MarketFeatures => ({
      price: 100,
      returns1d: -0.02,
      returns5d: -0.05,
      returns20d: -0.15,
      volatility1d: 0.02,
      volatility5d: 0.03,
      volatility20d: 0.25,
      volumeRatio1d: 1.5,
      volumeRatio5d: 1.3,
      rsi14: 35,
      atr14: 3,
      bbWidth: 0.04,
      macdHistogram: -0.5,
      advanceDeclineRatio: 0.7,
      marketCap: 1000000000,
    });
    
    const createRangeboundFeatures = (): MarketFeatures => ({
      price: 100,
      returns1d: 0.001,
      returns5d: -0.002,
      returns20d: 0.005,
      volatility1d: 0.005,
      volatility5d: 0.01,
      volatility20d: 0.08,
      volumeRatio1d: 0.8,
      volumeRatio5d: 0.9,
      rsi14: 52,
      atr14: 1,
      bbWidth: 0.02,
      macdHistogram: 0.1,
      advanceDeclineRatio: 1.0,
      marketCap: 1000000000,
    });
    
    const createHighVolatilityFeatures = (): MarketFeatures => ({
      price: 100,
      returns1d: 0.03,
      returns5d: -0.07,
      returns20d: 0.05,
      volatility1d: 0.03,
      volatility5d: 0.05,
      volatility20d: 0.35,
      volumeRatio1d: 2.0,
      volumeRatio5d: 1.8,
      rsi14: 60,
      atr14: 5,
      bbWidth: 0.06,
      macdHistogram: 0.8,
      advanceDeclineRatio: 1.2,
      marketCap: 1000000000,
      vix: 35,
    });
    
    const createMarketStressFeatures = (): MarketFeatures => ({
      price: 100,
      returns1d: -0.05,
      returns5d: -0.15,
      returns20d: -0.25,
      volatility1d: 0.04,
      volatility5d: 0.06,
      volatility20d: 0.40,
      volumeRatio1d: 2.5,
      volumeRatio5d: 2.0,
      rsi14: 25,
      atr14: 6,
      bbWidth: 0.08,
      macdHistogram: -1.0,
      advanceDeclineRatio: 0.4,
      marketCap: 1000000000,
      vix: 45,
      yieldCurve: -0.5,
    });
    
    it('should correctly identify bullish trend regime', () => {
      const features = createBullishFeatures();
      const classification = classifier.classifyRegime('BTC/USD', features);
      
      expect(classification.primaryRegime).toBe(MarketRegime.BullishTrend);
      expect(classification.confidence).toBeGreaterThan(0.5);
    });
    
    it('should correctly identify bearish trend regime', () => {
      const features = createBearishFeatures();
      const classification = classifier.classifyRegime('BTC/USD', features);
      
      expect(classification.primaryRegime).toBe(MarketRegime.BearishTrend);
      expect(classification.confidence).toBeGreaterThan(0.5);
    });
    
    it('should correctly identify rangebound regime', () => {
      const features = createRangeboundFeatures();
      const classification = classifier.classifyRegime('BTC/USD', features);
      
      expect(classification.primaryRegime).toBe(MarketRegime.Rangebound);
      expect(classification.confidence).toBeGreaterThan(0.5);
    });
    
    it('should correctly identify high volatility regime', () => {
      const features = createHighVolatilityFeatures();
      const classification = classifier.classifyRegime('BTC/USD', features);
      
      expect(classification.primaryRegime).toBe(MarketRegime.HighVolatility);
      expect(classification.confidence).toBeGreaterThan(0.5);
    });
    
    it('should correctly identify market stress regime', () => {
      const features = createMarketStressFeatures();
      const classification = classifier.classifyRegime('BTC/USD', features);
      
      expect(classification.primaryRegime).toBe(MarketRegime.MarketStress);
      expect(classification.confidence).toBeGreaterThan(0.5);
    });
    
    it('should include a secondary regime when confidence is not overwhelming', () => {
      // Create a mixed regime (bearish but also high volatility)
      const features = createBearishFeatures();
      features.volatility20d = 0.38; // Very high volatility
      features.bbWidth = 0.07;
      features.atr14 = 5;
      
      const classification = classifier.classifyRegime('BTC/USD', features);
      
      expect(classification.secondaryRegime).not.toBeNull();
      expect([MarketRegime.BearishTrend, MarketRegime.HighVolatility, MarketRegime.BearVolatile]).toContain(classification.primaryRegime);
      if (classification.secondaryRegime) {
        expect([MarketRegime.BearishTrend, MarketRegime.HighVolatility, MarketRegime.BearVolatile]).toContain(classification.secondaryRegime);
      }
    });
  });
  
  describe('regime history and changes', () => {
    it('should track regime history for each symbol', () => {
      // Classify regimes for multiple symbols
      classifier.classifyRegime('BTC/USD', createBullishFeatures());
      classifier.classifyRegime('ETH/USD', createBearishFeatures());
      
      const btcHistory = classifier.getRegimeHistory('BTC/USD');
      const ethHistory = classifier.getRegimeHistory('ETH/USD');
      
      expect(btcHistory).not.toBeNull();
      expect(ethHistory).not.toBeNull();
      expect(btcHistory?.classifications.length).toBe(1);
      expect(ethHistory?.classifications.length).toBe(1);
      
      // Add more classifications
      classifier.classifyRegime('BTC/USD', createBullishFeatures());
      classifier.classifyRegime('BTC/USD', createBullishFeatures());
      
      expect(classifier.getRegimeHistory('BTC/USD')?.classifications.length).toBe(3);
    });
    
    it('should detect regime changes', () => {
      // Start with bullish regime
      classifier.classifyRegime('BTC/USD', createBullishFeatures());
      
      // No change yet
      expect(classifier.hasRegimeChanged('BTC/USD')).toBe(false);
      
      // Add another classification with the same regime
      classifier.classifyRegime('BTC/USD', createBullishFeatures());
      expect(classifier.hasRegimeChanged('BTC/USD')).toBe(false);
      
      // Change to bearish regime
      classifier.classifyRegime('BTC/USD', createBearishFeatures());
      expect(classifier.hasRegimeChanged('BTC/USD')).toBe(true);
      
      // Get the current regime
      expect(classifier.getCurrentPrimaryRegime('BTC/USD')).toBe(MarketRegime.BearishTrend);
    });
    
    it('should track regime duration', () => {
      // Start with bullish regime
      classifier.classifyRegime('BTC/USD', createBullishFeatures());
      
      const initialHistory = classifier.getRegimeHistory('BTC/USD');
      expect(initialHistory?.currentRegimeDurationMs).toBe(0);
      
      // Wait a bit and add another classification with the same regime
      jest.advanceTimersByTime(1000); // Advance 1 second
      classifier.classifyRegime('BTC/USD', createBullishFeatures());
      
      const updatedHistory = classifier.getRegimeHistory('BTC/USD');
      expect(updatedHistory?.currentRegimeDurationMs).toBeGreaterThan(0);
      
      // Change regime and check that duration resets
      classifier.classifyRegime('BTC/USD', createBearishFeatures());
      const changedHistory = classifier.getRegimeHistory('BTC/USD');
      expect(changedHistory?.currentRegimeDurationMs).toBe(0);
    });
    
    it('should limit history size', () => {
      // Override max history items
      (RegimeClassifier as any).instance = null;
      classifier = RegimeClassifier.getInstance({ maxHistoryItems: 3 });
      
      // Add 5 classifications
      for (let i = 0; i < 5; i++) {
        classifier.classifyRegime('BTC/USD', createBullishFeatures());
      }
      
      // History should be limited to 3 items
      const history = classifier.getRegimeHistory('BTC/USD');
      expect(history?.classifications.length).toBe(3);
    });
    
    it('should reset history for a specific symbol', () => {
      classifier.classifyRegime('BTC/USD', createBullishFeatures());
      classifier.classifyRegime('ETH/USD', createBearishFeatures());
      
      expect(classifier.getTrackedSymbols()).toContain('BTC/USD');
      expect(classifier.getTrackedSymbols()).toContain('ETH/USD');
      
      classifier.resetHistory('BTC/USD');
      
      expect(classifier.getTrackedSymbols()).not.toContain('BTC/USD');
      expect(classifier.getTrackedSymbols()).toContain('ETH/USD');
    });
    
    it('should reset all history', () => {
      classifier.classifyRegime('BTC/USD', createBullishFeatures());
      classifier.classifyRegime('ETH/USD', createBearishFeatures());
      
      expect(classifier.getTrackedSymbols().length).toBe(2);
      
      classifier.resetAllHistory();
      
      expect(classifier.getTrackedSymbols().length).toBe(0);
    });
  });
  
  // Helper functions
  function createBullishFeatures(): MarketFeatures {
    return {
      price: 100,
      returns1d: 0.02,
      returns5d: 0.05,
      returns20d: 0.15,
      volatility1d: 0.01,
      volatility5d: 0.02,
      volatility20d: 0.15,
      volumeRatio1d: 1.2,
      volumeRatio5d: 1.1,
      rsi14: 65,
      atr14: 2,
      bbWidth: 0.03,
      macdHistogram: 0.5,
      advanceDeclineRatio: 1.5,
      marketCap: 1000000000,
    };
  }
  
  function createBearishFeatures(): MarketFeatures {
    return {
      price: 100,
      returns1d: -0.02,
      returns5d: -0.05,
      returns20d: -0.15,
      volatility1d: 0.02,
      volatility5d: 0.03,
      volatility20d: 0.25,
      volumeRatio1d: 1.5,
      volumeRatio5d: 1.3,
      rsi14: 35,
      atr14: 3,
      bbWidth: 0.04,
      macdHistogram: -0.5,
      advanceDeclineRatio: 0.7,
      marketCap: 1000000000,
    };
  }
}); 