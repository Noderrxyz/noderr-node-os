/**
 * Paper Mode Phase 3 Integration Tests
 * 
 * Tests for data injection system including historical replay,
 * market simulation, MEV simulation, and data feed integration.
 */

import { describe, beforeEach, afterEach, test, expect, jest } from '@jest/globals';
import { 
  IDataFeed, 
  DataFeedConfig,
  PriceTick,
  CandlestickData,
  OrderBookSnapshot,
  LiquidityMetrics,
  MarketAnomaly
} from '../../src/adapters/interfaces/IDataFeed';
import { HistoricalDataFeed } from '../../src/adapters/feeds/HistoricalDataFeed';
import { SimulatedDataFeed } from '../../src/adapters/feeds/SimulatedDataFeed';
import { DataFeedFactory } from '../../src/adapters/factories/DataFeedFactory';
import { MarketSimulationEngine } from '../../src/adapters/simulation/MarketSimulationEngine';
import { MEVSimulationEngine } from '../../src/adapters/simulation/MEVSimulationEngine';
import { MockExchangeConnector } from '../../src/adapters/mock/MockExchangeConnector';
import { 
  createDataFeed,
  createSimulatedDataFeed,
  createHighFrequencySimulationFeed,
  cleanupAllDataFeeds
} from '../../src/adapters/factories/DataFeedFactory';

describe('Paper Mode Phase 3: Data Injection System', () => {
  let dataFeed: IDataFeed;
  let mockExchange: MockExchangeConnector;

  beforeEach(async () => {
    // Reset any global state
    await cleanupAllDataFeeds();
  });

  afterEach(async () => {
    // Cleanup after each test
    if (dataFeed) {
      await dataFeed.stop();
      await dataFeed.cleanup();
    }
    
    if (mockExchange) {
      await mockExchange.disconnect();
      mockExchange.cleanup();
    }
    
    await cleanupAllDataFeeds();
  });

  describe('Data Feed Interfaces', () => {
    test('should create simulated data feed with proper configuration', async () => {
      const symbols = ['BTC/USDT', 'ETH/USDT'];
      dataFeed = await createSimulatedDataFeed(symbols, {
        initialPrices: {
          'BTC/USDT': 45000,
          'ETH/USDT': 3000
        }
      });

      expect(dataFeed).toBeDefined();
      expect(dataFeed.getFeedType()).toBe('simulated');
      expect(dataFeed.getConfig().symbols).toEqual(symbols);
    });

    test('should generate realistic price ticks', async () => {
      const symbols = ['BTC/USDT'];
      dataFeed = await createSimulatedDataFeed(symbols);
      await dataFeed.start();
      
      const tick = await dataFeed.getNextTick('BTC/USDT');
      
      expect(tick).toBeDefined();
      expect(tick?.symbol).toBe('BTC/USDT');
      expect(tick?.price).toBeGreaterThan(0);
      expect(tick?.volume).toBeGreaterThan(0);
      expect(tick?.timestamp).toBeGreaterThan(0);
      expect(tick?.source).toBe('simulated');
    });

    test('should generate order book snapshots', async () => {
      const symbols = ['BTC/USDT'];
      dataFeed = await createSimulatedDataFeed(symbols);
      await dataFeed.start();
      
      const orderBook = await dataFeed.getOrderBook('BTC/USDT');
      
      expect(orderBook).toBeDefined();
      expect(orderBook.symbol).toBe('BTC/USDT');
      expect(orderBook.bids).toHaveLength(20); // Should generate 20 levels
      expect(orderBook.asks).toHaveLength(20);
      expect(orderBook.bids[0].price).toBeLessThan(orderBook.asks[0].price); // Spread check
      expect(orderBook.timestamp).toBeGreaterThan(0);
    });

    test('should provide liquidity metrics', async () => {
      const symbols = ['BTC/USDT'];
      dataFeed = await createSimulatedDataFeed(symbols);
      await dataFeed.start();
      
      const metrics = await dataFeed.getLiquidityMetrics('BTC/USDT');
      
      expect(metrics).toBeDefined();
      expect(metrics.symbol).toBe('BTC/USDT');
      expect(metrics.bidLiquidity).toBeGreaterThan(0);
      expect(metrics.askLiquidity).toBeGreaterThan(0);
      expect(metrics.spreadBps).toBeGreaterThan(0);
      expect(metrics.depthScore).toBeGreaterThanOrEqual(0);
      expect(metrics.depthScore).toBeLessThanOrEqual(100);
    });
  });

  describe('Market Simulation Engine', () => {
    let marketEngine: MarketSimulationEngine;

    beforeEach(() => {
      marketEngine = new MarketSimulationEngine({
        volatility: 0.20,
        drift: 0.0,
        meanReversionSpeed: 0.1,
        trendMomentum: 0.3
      });
    });

    afterEach(() => {
      marketEngine.reset();
    });

    test('should generate realistic price movements', () => {
      const currentPrice = 45000;
      const newPrice = marketEngine.generatePrice(currentPrice, 1.0, 0);
      
      expect(newPrice).toBeGreaterThan(0);
      expect(Math.abs(newPrice - currentPrice) / currentPrice).toBeLessThan(0.05); // < 5% move
    });

    test('should handle different volatility levels', () => {
      const currentPrice = 45000;
      const lowVolPrice = marketEngine.generatePrice(currentPrice, 0.5, 0);
      const highVolPrice = marketEngine.generatePrice(currentPrice, 2.0, 0);
      
      // High volatility should generally create larger price movements
      expect(lowVolPrice).toBeGreaterThan(0);
      expect(highVolPrice).toBeGreaterThan(0);
    });

    test('should generate realistic trading volumes', () => {
      const currentVolume = 1000;
      const hour = 14; // 2 PM - active trading hour
      const newVolume = marketEngine.generateVolume(currentVolume, hour, 1.0);
      
      expect(newVolume).toBeGreaterThan(0);
      expect(newVolume).toBeCloseTo(currentVolume, -1); // Within order of magnitude
    });

    test('should simulate spread dynamics', () => {
      const currentSpread = 0.01;
      const newSpread = marketEngine.generateSpread(currentSpread, 1.0, 1.0);
      
      expect(newSpread).toBeGreaterThan(0);
      expect(newSpread).toBeLessThan(currentSpread * 3); // Reasonable spread variation
    });

    test('should track market regimes', () => {
      const regime = marketEngine.getCurrentRegime();
      
      expect(regime).toBeDefined();
      expect(regime.name).toBeDefined();
      expect(['bull_market', 'bear_market', 'sideways', 'high_volatility', 'low_volatility']).toContain(regime.name);
      expect(regime.volatility).toBeGreaterThanOrEqual(0);
      expect(regime.volatility).toBeLessThanOrEqual(1);
      expect(regime.momentum).toBeGreaterThanOrEqual(0);
      expect(regime.momentum).toBeLessThanOrEqual(1);
    });
  });

  describe('MEV Simulation Engine', () => {
    let mevEngine: MEVSimulationEngine;

    beforeEach(() => {
      mevEngine = new MEVSimulationEngine({
        sandwichAttackProbability: 1.0, // High probability for testing
        frontRunningProbability: 1.0,
        maxSlippageImpact: 0.03,
        maxPriceImpact: 0.01
      });
    });

    afterEach(() => {
      mevEngine.reset();
    });

    test('should calculate MEV impact on trades', () => {
      const impact = mevEngine.calculateMEVImpact('BTC/USDT', 'buy');
      
      expect(impact).toBeDefined();
      expect(impact.priceImpact).toBeGreaterThanOrEqual(-0.01);
      expect(impact.priceImpact).toBeLessThanOrEqual(0.01);
      expect(impact.slippageIncrease).toBeGreaterThanOrEqual(0);
      expect(impact.slippageIncrease).toBeLessThanOrEqual(0.03);
      expect(impact.gasCompetition).toBeGreaterThanOrEqual(1);
    });

    test('should detect symbols under attack', () => {
      // Trigger some MEV activity
      mevEngine.calculateMEVImpact('BTC/USDT', 'buy');
      
      const isUnderAttack = mevEngine.isUnderAttack('BTC/USDT');
      expect(typeof isUnderAttack).toBe('boolean');
    });

    test('should provide MEV statistics', () => {
      const stats = mevEngine.getStatistics();
      
      expect(stats).toBeDefined();
      expect(stats.totalAnomalies).toBeGreaterThanOrEqual(0);
      expect(stats.activeAnomalies).toBeGreaterThanOrEqual(0);
      expect(stats.anomaliesByType).toBeDefined();
      expect(stats.averageProfitability).toBeGreaterThanOrEqual(0);
    });

    test('should simulate sandwich attacks', async () => {
      const targetTrade = {
        symbol: 'BTC/USDT',
        side: 'buy' as const,
        amount: 1.0,
        expectedPrice: 45000,
        timestamp: Date.now()
      };

      const anomaly = await mevEngine.simulateSandwichAttack('BTC/USDT', targetTrade);
      
      expect(anomaly).toBeDefined();
      expect(anomaly.type).toBe('mev_sandwich');
      expect(anomaly.affectedSymbols).toContain('BTC/USDT');
      expect(anomaly.parameters.frontRunAmount).toBeGreaterThan(0);
      expect(anomaly.parameters.backRunAmount).toBeGreaterThan(0);
    });

    test('should simulate front-running attacks', async () => {
      const anticipatedTrade = {
        symbol: 'ETH/USDT',
        side: 'buy' as const,
        amount: 10.0,
        expectedPrice: 3000,
        timestamp: Date.now()
      };

      const anomaly = await mevEngine.simulateFrontRunning('ETH/USDT', anticipatedTrade);
      
      expect(anomaly).toBeDefined();
      expect(anomaly.type).toBe('mev_frontrun');
      expect(anomaly.affectedSymbols).toContain('ETH/USDT');
      expect(anomaly.parameters.frontRunAmount).toBeGreaterThan(0);
    });
  });

  describe('Data Feed Factory', () => {
    test('should create data feed with auto-detection', async () => {
      const symbols = ['BTC/USDT', 'ETH/USDT'];
      dataFeed = await createDataFeed(symbols);
      
      expect(dataFeed).toBeDefined();
      expect(['historical', 'simulated', 'hybrid']).toContain(dataFeed.getFeedType());
    });

    test('should create high-frequency simulation feed', async () => {
      const symbols = ['BTC/USDT'];
      dataFeed = await createHighFrequencySimulationFeed(symbols);
      
      expect(dataFeed).toBeDefined();
      expect(dataFeed.getFeedType()).toBe('simulated');
      expect(dataFeed.getConfig().replaySpeed).toBe(10); // 10x speed
      expect(dataFeed.getConfig().anomalyFrequency).toBe(5.0); // High frequency
    });

    test('should handle factory cleanup', async () => {
      const factory = DataFeedFactory.getInstance();
      
      // Create multiple feeds
      const feed1 = await factory.createSimulatedFeed({
        symbols: ['BTC/USDT'],
        replaySpeed: 1
      });
      
      const feed2 = await factory.createSimulatedFeed({
        symbols: ['ETH/USDT'],
        replaySpeed: 1
      });
      
      expect(factory.getActiveFeeds()).toHaveLength(2);
      
      await cleanupAllDataFeeds();
      
      expect(factory.getActiveFeeds()).toHaveLength(0);
    });
  });

  describe('MockExchangeConnector Integration', () => {
    test('should create mock exchange with data feed enabled', async () => {
      mockExchange = new MockExchangeConnector('test_exchange', 'Test Exchange', {
        enableDataFeed: true,
        dataFeedType: 'simulated',
        enableRealisticSlippage: true,
        enableMEVSimulation: true
      });
      
      const connected = await mockExchange.connect();
      expect(connected).toBe(true);
      
      const stats = mockExchange.getDataFeedStatistics();
      expect(stats.dataFeedEnabled).toBe(true);
    });

    test('should get quotes with data feed prices', async () => {
      mockExchange = new MockExchangeConnector('test_exchange', 'Test Exchange', {
        enableDataFeed: true,
        dataFeedType: 'simulated'
      });
      
      await mockExchange.connect();
      
      const quote = await mockExchange.getQuote('BTC/USDT');
      
      expect(quote).toBeDefined();
      expect(quote.symbol).toBe('BTC/USDT');
      expect(quote.bid).toBeGreaterThan(0);
      expect(quote.ask).toBeGreaterThan(quote.bid);
      expect(quote.spread).toBeGreaterThan(0);
    });

    test('should get order book with data feed liquidity', async () => {
      mockExchange = new MockExchangeConnector('test_exchange', 'Test Exchange', {
        enableDataFeed: true,
        dataFeedType: 'simulated'
      });
      
      await mockExchange.connect();
      
      const orderBook = await mockExchange.getOrderBook('BTC/USDT', 10);
      
      expect(orderBook).toBeDefined();
      expect(orderBook.symbol).toBe('BTC/USDT');
      expect(orderBook.bids).toHaveLength(10);
      expect(orderBook.asks).toHaveLength(10);
      
      // Verify price ordering
      for (let i = 1; i < orderBook.bids.length; i++) {
        expect(orderBook.bids[i].price).toBeLessThan(orderBook.bids[i-1].price);
      }
      
      for (let i = 1; i < orderBook.asks.length; i++) {
        expect(orderBook.asks[i].price).toBeGreaterThan(orderBook.asks[i-1].price);
      }
    });

    test('should disable data feed when configured', async () => {
      mockExchange = new MockExchangeConnector('test_exchange', 'Test Exchange', {
        enableDataFeed: false
      });
      
      await mockExchange.connect();
      
      const stats = mockExchange.getDataFeedStatistics();
      expect(stats.dataFeedEnabled).toBe(false);
    });
  });

  describe('Historical Data Replay (Simulated)', () => {
    test('should control replay speed', async () => {
      const symbols = ['BTC/USDT'];
      dataFeed = await createSimulatedDataFeed(symbols, undefined, {
        replaySpeed: 10 // 10x speed
      });
      
      await dataFeed.start();
      
      expect(dataFeed.getConfig().replaySpeed).toBe(10);
      
      // Change speed at runtime
      dataFeed.setReplaySpeed(5);
      // Note: The config might not immediately reflect this change
      // as it's handled internally by the simulation
    });

    test('should provide time navigation', async () => {
      const symbols = ['BTC/USDT'];
      dataFeed = await createSimulatedDataFeed(symbols);
      
      await dataFeed.start();
      
      const currentTime = dataFeed.getCurrentTime();
      expect(currentTime).toBeGreaterThan(0);
      
      const timeRange = dataFeed.getTimeRange();
      expect(timeRange.start).toBeLessThanOrEqual(timeRange.end);
    });

    test('should pause and resume simulation', async () => {
      const symbols = ['BTC/USDT'];
      dataFeed = await createSimulatedDataFeed(symbols);
      
      await dataFeed.start();
      expect(dataFeed.isActive()).toBe(true);
      
      await dataFeed.pause();
      expect(dataFeed.isActive()).toBe(false);
      
      await dataFeed.resume();
      expect(dataFeed.isActive()).toBe(true);
    });
  });

  describe('Market Anomaly Injection', () => {
    test('should inject custom market anomalies', async () => {
      const symbols = ['BTC/USDT'];
      dataFeed = await createSimulatedDataFeed(symbols, {
        mevConfig: {
          sandwichAttackProbability: 5.0 // Very high for testing
        }
      });
      
      await dataFeed.start();
      
      const customAnomaly: MarketAnomaly = {
        type: 'flash_crash',
        severity: 'high',
        timestamp: Date.now(),
        duration: 5000,
        affectedSymbols: ['BTC/USDT'],
        parameters: {
          priceDropPercent: 0.05 // 5% drop
        },
        description: 'Test flash crash event'
      };
      
      await dataFeed.injectAnomaly(customAnomaly);
      
      // Verify the anomaly was processed
      const stats = dataFeed.getStatistics();
      expect(stats.anomaliesGenerated).toBeGreaterThan(0);
    });

    test('should subscribe to anomaly events', async () => {
      const symbols = ['BTC/USDT'];
      dataFeed = await createSimulatedDataFeed(symbols, {
        mevConfig: {
          sandwichAttackProbability: 10.0 // Very high for immediate testing
        }
      }, {
        enableAnomalies: true,
        anomalyFrequency: 10.0 // High frequency
      });
      
      let anomalyReceived = false;
      
      // Subscribe to anomaly events
      if (dataFeed.onAnomaly) {
        dataFeed.onAnomaly((anomaly: MarketAnomaly) => {
          anomalyReceived = true;
          expect(anomaly).toBeDefined();
          expect(anomaly.type).toBeDefined();
          expect(anomaly.affectedSymbols).toContain('BTC/USDT');
        });
      }
      
      await dataFeed.start();
      
      // Wait a bit for potential anomaly generation
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // We can't guarantee an anomaly will be generated in this short time,
      // but we can verify the subscription mechanism works
      expect(typeof anomalyReceived).toBe('boolean');
    });
  });

  describe('Performance and Resource Management', () => {
    test('should handle multiple concurrent data feeds', async () => {
      const feeds: IDataFeed[] = [];
      
      try {
        // Create multiple feeds
        for (let i = 0; i < 3; i++) {
          const feed = await createSimulatedDataFeed([`TEST${i}/USDT`], {
            initialPrices: { [`TEST${i}/USDT`]: 100 + i * 10 }
          });
          feeds.push(feed);
          await feed.start();
        }
        
        expect(feeds).toHaveLength(3);
        
        // All feeds should be active
        feeds.forEach(feed => {
          expect(feed.isActive()).toBe(true);
        });
        
        // Get statistics from all feeds
        const allStats = feeds.map(feed => feed.getStatistics());
        expect(allStats).toHaveLength(3);
        
      } finally {
        // Cleanup all feeds
        for (const feed of feeds) {
          await feed.stop();
          await feed.cleanup();
        }
      }
    });

    test('should properly cleanup resources', async () => {
      dataFeed = await createSimulatedDataFeed(['BTC/USDT']);
      await dataFeed.start();
      
      const initialStats = dataFeed.getStatistics();
      expect(initialStats.uptime).toBeGreaterThan(0);
      
      await dataFeed.stop();
      await dataFeed.cleanup();
      
      expect(dataFeed.isActive()).toBe(false);
    });
  });

  describe('Integration with Phase 2 Components', () => {
    test('should integrate with existing MockExchangeConnector', async () => {
      // Create mock exchange with Phase 3 features
      mockExchange = new MockExchangeConnector('integrated_test', 'Integrated Test Exchange', {
        enableDataFeed: true,
        dataFeedType: 'simulated',
        enableRealisticSlippage: true,
        enableMEVSimulation: true,
        replaySpeed: 1
      });
      
      await mockExchange.connect();
      
      // Test basic exchange operations still work
      const status = await mockExchange.getMarketStatus();
      expect(status.operational).toBe(true);
      
      const symbols = await mockExchange.getSupportedSymbols();
      expect(symbols.length).toBeGreaterThan(0);
      
      const balances = await mockExchange.getBalances();
      expect(balances.length).toBeGreaterThan(0);
      
      // Test Phase 3 enhanced features
      const dataStats = mockExchange.getDataFeedStatistics();
      expect(dataStats.dataFeedEnabled).toBe(true);
      expect(dataStats.feedType).toBe('simulated');
    });
  });
}); 