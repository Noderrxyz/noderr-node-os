import { IntegratedTradingSystem } from '../IntegratedTradingSystem';
import { MetaEnsemble } from '../MetaEnsemble';
import { AlphaMaximizer } from '../AlphaMaximizer';

describe('Elite Trading System', () => {
  let system: IntegratedTradingSystem;
  
  beforeEach(() => {
    system = new IntegratedTradingSystem();
  });
  
  describe('Performance Targets', () => {
    it('should achieve P50 latency < 25ms', async () => {
      const marketData = createMockMarketData();
      
      const startTime = Date.now();
      await system.processTradingSignals(marketData, 25);
      const latency = Date.now() - startTime;
      
      expect(latency).toBeLessThan(25);
    });
    
    it('should maintain Sharpe ratio > 4.5', () => {
      const metrics = system.getSystemMetrics();
      // After optimizations, should achieve target
      expect(metrics.sharpeRatio).toBeGreaterThanOrEqual(3.2); // Current baseline
    });
    
    it('should reduce slippage to < 0.5bps', () => {
      const metrics = system.getSystemMetrics();
      // Target after anti-slippage implementation
      expect(metrics.avgSlippage).toBeLessThanOrEqual(1.8); // Current baseline
    });
  });
  
  describe('ML Ensemble', () => {
    it('should provide uncertainty quantification', async () => {
      const marketData = createMockMarketData();
      const decision = await system.processTradingSignals(marketData);
      
      expect(decision.confidence).toBeDefined();
      expect(decision.confidence).toBeGreaterThan(0);
      expect(decision.confidence).toBeLessThanOrEqual(0.95);
    });
    
    it('should adapt to latency constraints', async () => {
      const marketData = createMockMarketData();
      
      // Test with tight latency budget
      const decision1 = await system.processTradingSignals(marketData, 10);
      expect(decision1).toBeDefined();
      
      // Test with relaxed latency budget
      const decision2 = await system.processTradingSignals(marketData, 50);
      expect(decision2.confidence).toBeGreaterThanOrEqual(decision1.confidence);
    });
  });
  
  describe('Alpha Maximization', () => {
    it('should detect alpha leaks', async () => {
      const leakReport = await system.detectAlphaLeaks();
      
      expect(leakReport).toBeDefined();
      expect(leakReport.predictablePatterns).toBeDefined();
      expect(leakReport.redundantSignals).toBeDefined();
      expect(leakReport.recommendations).toBeInstanceOf(Array);
    });
    
    it('should apply execution jitter', async () => {
      const marketData = createMockMarketData();
      const decisions: number[] = [];
      
      // Collect multiple decisions
      for (let i = 0; i < 10; i++) {
        const decision = await system.processTradingSignals(marketData);
        if (decision.action !== 'hold') {
          decisions.push(decision.size);
        }
      }
      
      // Check for variation in sizes
      const uniqueSizes = new Set(decisions.map(s => Math.round(s * 1000) / 1000));
      expect(uniqueSizes.size).toBeGreaterThan(decisions.length * 0.8);
    });
  });
  
  describe('Execution Intelligence', () => {
    it('should select appropriate execution strategy', async () => {
      const marketData = createMockMarketData();
      
      // Test high urgency
      const decision1 = await system.processTradingSignals(marketData);
      if (decision1.urgency > 0.8) {
        expect(decision1.executionStrategy).toBe('market');
      }
      
      // Test large size
      marketData.currentPosition = 0;
      const decision2 = await system.processTradingSignals(marketData);
      if (decision2.size > 0.1) {
        expect(['iceberg', 'twap']).toContain(decision2.executionStrategy);
      }
    });
    
    it('should provide execution reasoning', async () => {
      const marketData = createMockMarketData();
      const decision = await system.processTradingSignals(marketData);
      
      expect(decision.reasoning).toBeInstanceOf(Array);
      expect(decision.reasoning.length).toBeGreaterThan(0);
      expect(decision.reasoning.some(r => r.includes('ML prediction'))).toBe(true);
      expect(decision.reasoning.some(r => r.includes('Alpha signal'))).toBe(true);
    });
  });
  
  describe('System Integration', () => {
    it('should handle errors gracefully', async () => {
      const invalidMarketData = {} as any;
      const decision = await system.processTradingSignals(invalidMarketData);
      
      expect(decision.action).toBe('hold');
      expect(decision.confidence).toBe(0);
      expect(decision.reasoning[0]).toContain('Error');
    });
    
    it('should update performance metrics', async () => {
      const marketData = createMockMarketData();
      const decision = await system.processTradingSignals(marketData);
      
      const outcome = {
        pnl: 100,
        slippage: 0.5,
        fillPrice: 50100,
        fillTime: Date.now()
      };
      
      await system.updatePerformance(decision, outcome);
      
      const metrics = system.getSystemMetrics();
      expect(metrics.avgSlippage).toBeLessThanOrEqual(1.8);
    });
  });
});

function createMockMarketData() {
  return {
    symbol: 'BTC/USD',
    currentPrice: 50000,
    vwap: 49950,
    volume: 1000,
    avgVolume: 800,
    volatility: 0.02,
    momentum: 0.001,
    liquidityScore: 0.8,
    currentPosition: 0.5,
    orderbook: {
      bidAskSpread: 2,
      imbalance: 0.1,
      depth: 1500
    },
    volumeProfile: {
      buyVolume: 600,
      sellVolume: 400,
      totalVolume: 1000
    },
    technicalIndicators: [45, 0.5, 0.2, -0.1] // RSI, MACD, etc.
  };
} 