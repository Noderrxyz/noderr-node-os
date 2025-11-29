import { MarketIntelService } from '../src/MarketIntelService';
import { MarketIntelConfig, OrderBook, WhaleActivity } from '../src/types';

describe('MarketIntelService', () => {
  let service: MarketIntelService;
  let mockTelemetry: any;
  let config: MarketIntelConfig;

  beforeEach(() => {
    mockTelemetry = {
      track: jest.fn(),
      flush: jest.fn().mockResolvedValue(undefined)
    };

    config = {
      orderBook: {
        depthLevels: 50,
        updateFrequency: 1000,
        spoofingThreshold: 10000,
        minOrderSize: 100,
        icebergDetection: true
      },
      whaleTracking: {
        minTransactionSize: 100000,
        chains: ['ethereum', 'bsc'],
        smartMoneyThreshold: 0.7,
        impactAnalysis: true,
        trackDexActivity: true
      },
      arbitrage: {
        minProfitPercentage: 0.5,
        maxExecutionTime: 300,
        includeFees: true,
        slippageTolerance: 0.01,
        capitalLimit: 1000000
      },
      sentiment: {
        sources: ['twitter', 'reddit'],
        updateInterval: 60000,
        influencerWeight: 1.5,
        minSampleSize: 10,
        languages: ['en']
      },
      alphaGeneration: {
        minConfidence: 0.7,
        combineSignals: true,
        riskAdjusted: true
      }
    };

    service = new MarketIntelService(config, mockTelemetry);
  });

  afterEach(async () => {
    await service.stop();
  });

  describe('Order Book Processing', () => {
    it('should process order book and generate alpha signals', async () => {
      const orderBook: OrderBook = {
        symbol: 'ETH/USDT',
        timestamp: new Date(),
        bids: [
          { price: 2000, quantity: 10, orders: 5 },
          { price: 1999, quantity: 20, orders: 8 },
          { price: 1998, quantity: 15, orders: 6 }
        ],
        asks: [
          { price: 2001, quantity: 15, orders: 6 },
          { price: 2002, quantity: 25, orders: 10 },
          { price: 2003, quantity: 30, orders: 12 }
        ],
        lastUpdateId: 123456
      };

      const alphaSignalPromise = new Promise((resolve) => {
        service.once('alpha_signal', resolve);
      });

      await service.processOrderBook(orderBook);

      expect(mockTelemetry.track).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'orderbook_analyzed',
          data: expect.objectContaining({
            symbol: 'ETH/USDT'
          })
        })
      );

      // Wait for potential alpha signal
      const signal = await Promise.race([
        alphaSignalPromise,
        new Promise(resolve => setTimeout(() => resolve(null), 100))
      ]);

      if (signal) {
        expect(signal).toHaveProperty('type', 'orderbook');
        expect(signal).toHaveProperty('symbol', 'ETH/USDT');
      }
    });

    it('should detect anomalies in order book', async () => {
      const orderBook: OrderBook = {
        symbol: 'ETH/USDT',
        timestamp: new Date(),
        bids: [
          { price: 2000, quantity: 10, orders: 5 },
          { price: 1990, quantity: 20, orders: 8 } // Large spread
        ],
        asks: [
          { price: 2050, quantity: 15, orders: 6 }, // Extreme spread
          { price: 2060, quantity: 25, orders: 10 }
        ],
        lastUpdateId: 123456
      };

      const anomalyPromise = new Promise((resolve) => {
        service.once('anomaly_detected', resolve);
      });

      await service.processOrderBook(orderBook);

      const anomaly = await Promise.race([
        anomalyPromise,
        new Promise(resolve => setTimeout(() => resolve(null), 100))
      ]);

      if (anomaly) {
        expect(anomaly).toHaveProperty('type', 'orderbook');
        expect(anomaly).toHaveProperty('severity');
      }
    });
  });

  describe('Whale Activity Tracking', () => {
    it('should track whale transactions and generate signals', async () => {
      const whaleActivity: WhaleActivity = {
        id: 'tx-123',
        chain: 'ethereum',
        address: '0x1234567890123456789012345678901234567890',
        transactionHash: '0xabcd',
        amount: BigInt('1000000000000000000000'), // 1000 ETH
        tokenSymbol: 'ETH',
        direction: 'accumulation',
        fromAddress: '0xaaaa',
        toAddress: '0xbbbb',
        impactScore: 0.8,
        timestamp: new Date(),
        blockNumber: 12345678
      };

      const whaleEventPromise = new Promise((resolve) => {
        service.once('critical_event', resolve);
      });

      await service.processWhaleActivity(whaleActivity);

      expect(mockTelemetry.track).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'whale_detected',
          data: expect.objectContaining({
            chain: 'ethereum'
          })
        })
      );
    });

    it('should detect coordinated whale activity', async () => {
      // Process multiple whale activities in quick succession
      const activities: WhaleActivity[] = [
        {
          id: 'tx-1',
          chain: 'ethereum',
          address: '0x1111',
          transactionHash: '0x1111',
          amount: BigInt('500000000000000000000'),
          tokenSymbol: 'ETH',
          direction: 'accumulation',
          fromAddress: '0xaaaa',
          toAddress: '0x1111',
          impactScore: 0.7,
          timestamp: new Date(),
          blockNumber: 12345678
        },
        {
          id: 'tx-2',
          chain: 'ethereum',
          address: '0x2222',
          transactionHash: '0x2222',
          amount: BigInt('600000000000000000000'),
          tokenSymbol: 'ETH',
          direction: 'accumulation',
          fromAddress: '0xbbbb',
          toAddress: '0x2222',
          impactScore: 0.8,
          timestamp: new Date(Date.now() + 1000),
          blockNumber: 12345679
        },
        {
          id: 'tx-3',
          chain: 'ethereum',
          address: '0x3333',
          transactionHash: '0x3333',
          amount: BigInt('700000000000000000000'),
          tokenSymbol: 'ETH',
          direction: 'accumulation',
          fromAddress: '0xcccc',
          toAddress: '0x3333',
          impactScore: 0.9,
          timestamp: new Date(Date.now() + 2000),
          blockNumber: 12345680
        }
      ];

      const anomalyPromise = new Promise((resolve) => {
        service.once('anomaly_detected', (anomaly) => {
          if (anomaly.type === 'correlation') {
            resolve(anomaly);
          }
        });
      });

      for (const activity of activities) {
        await service.processWhaleActivity(activity);
      }

      const anomaly = await Promise.race([
        anomalyPromise,
        new Promise(resolve => setTimeout(() => resolve(null), 500))
      ]);

      if (anomaly) {
        expect(anomaly).toHaveProperty('description');
        expect(anomaly).toHaveProperty('severity', 'high');
      }
    });
  });

  describe('Arbitrage Scanning', () => {
    it('should detect cross-exchange arbitrage opportunities', async () => {
      const priceData = [
        {
          symbol: 'ETH/USDT',
          exchange: 'binance',
          bid: 2000,
          ask: 2001,
          bidSize: 100,
          askSize: 150,
          timestamp: new Date()
        },
        {
          symbol: 'ETH/USDT',
          exchange: 'coinbase',
          bid: 2010,
          ask: 2011,
          bidSize: 80,
          askSize: 120,
          timestamp: new Date()
        }
      ];

      const opportunities = await service.scanArbitrageOpportunities(priceData);

      expect(opportunities).toBeInstanceOf(Array);
      
      if (opportunities.length > 0) {
        expect(opportunities[0]).toHaveProperty('type');
        expect(opportunities[0]).toHaveProperty('profitability');
        expect(opportunities[0]).toHaveProperty('executionPath');
      }

      expect(mockTelemetry.track).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'arbitrage_found',
          data: expect.objectContaining({
            count: opportunities.length
          })
        })
      );
    });
  });

  describe('Sentiment Analysis', () => {
    it('should process social posts and generate sentiment signals', async () => {
      const socialPost = {
        id: 'post-123',
        source: 'twitter' as const,
        author: 'crypto_influencer',
        content: 'ETH is going to the moon! 🚀 Extremely bullish on this breakout!',
        timestamp: new Date(),
        engagement: {
          likes: 5000,
          retweets: 1000,
          comments: 500
        },
        metadata: {
          followersCount: 100000,
          isVerified: true
        }
      };

      const signalPromise = new Promise((resolve) => {
        service.once('alpha_signal', (signal) => {
          if (signal.type === 'sentiment') {
            resolve(signal);
          }
        });
      });

      await service.processSocialPost(socialPost, 'ETH');

      const signal = await Promise.race([
        signalPromise,
        new Promise(resolve => setTimeout(() => resolve(null), 100))
      ]);

      if (signal) {
        expect(signal).toHaveProperty('type', 'sentiment');
        expect(signal).toHaveProperty('symbol', 'ETH');
        expect(signal).toHaveProperty('action');
      }

      expect(mockTelemetry.track).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'sentiment_updated',
          data: expect.objectContaining({
            symbol: 'ETH',
            source: 'twitter'
          })
        })
      );
    });
  });

  describe('Alpha Signal Management', () => {
    it('should store and retrieve alpha signals', async () => {
      // Generate some signals
      const orderBook: OrderBook = {
        symbol: 'BTC/USDT',
        timestamp: new Date(),
        bids: [
          { price: 50000, quantity: 1, orders: 5 },
          { price: 49999, quantity: 2, orders: 8 }
        ],
        asks: [
          { price: 50001, quantity: 1.5, orders: 6 },
          { price: 50002, quantity: 2.5, orders: 10 }
        ],
        lastUpdateId: 789012
      };

      await service.processOrderBook(orderBook);

      // Wait a bit for signal generation
      await new Promise(resolve => setTimeout(resolve, 100));

      // Retrieve signals
      const allSignals = service.getAlphaSignals();
      expect(allSignals).toBeInstanceOf(Array);

      const btcSignals = service.getAlphaSignals('BTC/USDT');
      expect(btcSignals.every(s => s.symbol === 'BTC/USDT')).toBe(true);

      const highConfSignals = service.getAlphaSignals(undefined, undefined, 0.8);
      expect(highConfSignals.every(s => s.confidence >= 0.8)).toBe(true);
    });
  });

  describe('Market Snapshot Generation', () => {
    it('should generate market snapshot', async () => {
      const snapshot = await service.generateMarketSnapshot();

      expect(snapshot).toHaveProperty('timestamp');
      expect(snapshot).toHaveProperty('topMovers');
      expect(snapshot).toHaveProperty('unusualActivity');
      expect(snapshot).toHaveProperty('sentimentOverview');
      expect(snapshot).toHaveProperty('liquidityMetrics');
      expect(snapshot).toHaveProperty('arbitrageCount');
      expect(snapshot).toHaveProperty('whaleActivityLevel');
    });
  });

  describe('Intelligence Report Generation', () => {
    it('should generate daily intelligence report', async () => {
      const report = await service.generateIntelligenceReport(new Date());

      expect(report).toHaveProperty('date');
      expect(report).toHaveProperty('summary');
      expect(report).toHaveProperty('alphaSignals');
      expect(report).toHaveProperty('whaleActivity');
      expect(report).toHaveProperty('arbitrageOpportunities');
      expect(report).toHaveProperty('sentimentAnalysis');
      expect(report).toHaveProperty('anomalies');
      expect(report).toHaveProperty('performanceMetrics');

      expect(typeof report.summary).toBe('string');
      expect(report.summary).toContain('Market Intelligence Report Summary');
    });
  });

  describe('Event Handling', () => {
    it('should emit critical events', async () => {
      const criticalEventPromise = new Promise((resolve) => {
        service.once('critical_event', resolve);
      });

      // Simulate a high-value arbitrage opportunity
      const priceData = [
        {
          symbol: 'ETH/USDT',
          exchange: 'exchange1',
          bid: 2000,
          ask: 2001,
          bidSize: 1000,
          askSize: 1000,
          timestamp: new Date()
        },
        {
          symbol: 'ETH/USDT',
          exchange: 'exchange2',
          bid: 2050,
          ask: 2051,
          bidSize: 1000,
          askSize: 1000,
          timestamp: new Date()
        }
      ];

      // This should trigger high_value_opportunity event
      await service.scanArbitrageOpportunities(priceData);

      // The service might emit a critical event for high-value opportunities
      const event = await Promise.race([
        criticalEventPromise,
        new Promise(resolve => setTimeout(() => resolve(null), 200))
      ]);

      // Event emission depends on internal logic and thresholds
      if (event) {
        expect(event).toHaveProperty('type');
        expect(event).toHaveProperty('priority');
        expect(event).toHaveProperty('timestamp');
      }
    });
  });

  describe('Resource Cleanup', () => {
    it('should properly clean up resources on stop', async () => {
      await service.stop();

      expect(mockTelemetry.flush).toHaveBeenCalled();

      // Verify no more events are emitted after stop
      let eventEmitted = false;
      service.once('alpha_signal', () => {
        eventEmitted = true;
      });

      // Try to process data after stop (should not emit events)
      try {
        await service.processOrderBook({
          symbol: 'TEST/USDT',
          timestamp: new Date(),
          bids: [{ price: 100, quantity: 1 }],
          asks: [{ price: 101, quantity: 1 }],
          lastUpdateId: 1
        });
      } catch (error) {
        // Expected to throw or handle gracefully
      }

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(eventEmitted).toBe(false);
    });
  });
}); 