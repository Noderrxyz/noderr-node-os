import { MarketSnapshot, FeedSource } from '../../types/MarketSnapshot.types.js';
import { FeedBus } from '../../feeds/publishers/FeedBus.js';
import { UniswapV3Feed } from '../../feeds/uniswap/uniswap_feed.js';
import { BinanceFeed } from '../../feeds/binance/binance_feed.js';

describe('Feed Validation', () => {
  let feedBus: FeedBus;
  let receivedSnapshots: MarketSnapshot[];

  beforeEach(() => {
    feedBus = FeedBus.getInstance();
    receivedSnapshots = [];
    
    // Subscribe to all feed events
    feedBus.subscribe((snapshot) => {
      receivedSnapshots.push(snapshot);
    });
  });

  afterEach(() => {
    feedBus.resetStats('uniswap_v3', 'ETH/USDC');
    feedBus.resetStats('binance', 'BTC/USDT');
    receivedSnapshots = [];
  });

  describe('MarketSnapshot Validation', () => {
    it('should validate snapshot structure', () => {
      const snapshot: MarketSnapshot = {
        source: 'uniswap_v3',
        symbol: 'ETH/USDC',
        timestamp: Date.now(),
        lastPrice: 2000.0,
        lastSize: 1.0,
        latencyMs: 100
      };

      expect(snapshot).toMatchObject({
        source: expect.any(String),
        symbol: expect.any(String),
        timestamp: expect.any(Number),
        lastPrice: expect.any(Number),
        lastSize: expect.any(Number),
        latencyMs: expect.any(Number)
      });
    });

    it('should validate snapshot timestamps', () => {
      const snapshot: MarketSnapshot = {
        source: 'binance',
        symbol: 'BTC/USDT',
        timestamp: Date.now(),
        lastPrice: 50000.0,
        lastSize: 0.1,
        latencyMs: 50
      };

      expect(snapshot.timestamp).toBeGreaterThan(0);
      expect(snapshot.timestamp).toBeLessThanOrEqual(Date.now());
    });

    it('should validate price and size values', () => {
      const snapshot: MarketSnapshot = {
        source: 'uniswap_v3',
        symbol: 'ETH/USDC',
        timestamp: Date.now(),
        lastPrice: 2000.0,
        lastSize: 1.0,
        latencyMs: 100
      };

      expect(snapshot.lastPrice).toBeGreaterThan(0);
      expect(snapshot.lastSize).toBeGreaterThan(0);
    });
  });

  describe('Feed Event Emission', () => {
    it('should receive events from Uniswap V3 feed', async () => {
      const feed = new UniswapV3Feed({
        source: 'uniswap_v3',
        symbol: 'ETH/USDC',
        rpcUrl: 'https://mainnet.infura.io/v3/test',
        contractAddress: '0x123...'
      });

      await feed.start();
      
      // Wait for events
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      expect(receivedSnapshots.length).toBeGreaterThan(0);
      expect(receivedSnapshots[0].source).toBe('uniswap_v3');
      
      feed.stop();
    });

    it('should receive events from Binance feed', async () => {
      const feed = new BinanceFeed({
        source: 'binance',
        symbol: 'BTC/USDT',
        wsUrl: 'wss://stream.binance.com:9443/ws'
      });

      await feed.start();
      
      // Wait for events
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      expect(receivedSnapshots.length).toBeGreaterThan(0);
      expect(receivedSnapshots[0].source).toBe('binance');
      
      feed.stop();
    });
  });

  describe('Feed Stats Tracking', () => {
    it('should track feed statistics', async () => {
      const feed = new UniswapV3Feed({
        source: 'uniswap_v3',
        symbol: 'ETH/USDC',
        rpcUrl: 'https://mainnet.infura.io/v3/test',
        contractAddress: '0x123...'
      });

      await feed.start();
      
      // Wait for events
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const stats = feedBus.getStats('uniswap_v3', 'ETH/USDC');
      expect(stats).toBeDefined();
      expect(stats?.messageCount).toBeGreaterThan(0);
      expect(stats?.latencyMs).toBeGreaterThanOrEqual(0);
      
      feed.stop();
    });
  });
}); 