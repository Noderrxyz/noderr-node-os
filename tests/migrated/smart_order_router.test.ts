import { SmartOrderRouter } from '@noderr/execution/src/SmartOrderRouter';
import { TrustManager } from '@noderr/governance/src/TrustManager';
import { OrderRetryEngine } from '@noderr/execution/src/OrderRetryEngine';

describe('SmartOrderRouter', () => {
  let router: SmartOrderRouter;
  let trustManager: TrustManager;
  let retryEngine: OrderRetryEngine;

  beforeEach(() => {
    router = SmartOrderRouter.getInstance();
    trustManager = TrustManager.getInstance();
    retryEngine = OrderRetryEngine.getInstance();
  });

  afterEach(() => {
    router.cleanup();
  });

  describe('order execution', () => {
    it('should execute order on highest trust venue first', async () => {
      const order = {
        symbol: 'ETH/USD',
        side: 'buy' as const,
        amount: 1,
        price: 2000,
        venues: ['binance', 'coinbase', 'kraken']
      };

      // Set initial trust scores
      trustManager.improve('coinbase'); // Highest trust
      trustManager.improve('binance');  // Medium trust
      trustManager.decay('kraken');     // Lowest trust

      const result = await router.executeOrder(order);
      expect(result.venue).toBe('coinbase');
    });

    it('should retry on different venue after failure', async () => {
      const order = {
        symbol: 'ETH/USD',
        side: 'buy' as const,
        amount: 1,
        price: 2000,
        venues: ['binance', 'coinbase']
      };

      // Mock retry engine to always retry
      jest.spyOn(retryEngine, 'retry').mockResolvedValue(true);

      const result = await router.executeOrder(order);
      expect(result.venue).toBe('coinbase');
    });

    it('should handle no available venues', async () => {
      const order = {
        symbol: 'ETH/USD',
        side: 'buy' as const,
        amount: 1,
        price: 2000,
        venues: ['nonexistent']
      };

      const result = await router.executeOrder(order);
      expect(result.success).toBe(false);
      expect(result.venue).toBe('');
    });
  });

  describe('trust management', () => {
    it('should improve trust score on successful execution', async () => {
      const venue = 'binance';
      const initialTrust = trustManager.getTrustScore(venue);

      const order = {
        symbol: 'ETH/USD',
        side: 'buy' as const,
        amount: 1,
        price: 2000,
        venues: [venue]
      };

      // Mock execution to always succeed
      jest.spyOn(router as any, 'executeOnVenue').mockResolvedValue({
        success: true,
        venue
      });

      await router.executeOrder(order);
      const finalTrust = trustManager.getTrustScore(venue);

      expect(finalTrust).toBeGreaterThan(initialTrust);
    });

    it('should decay trust score after max retries', async () => {
      const venue = 'binance';
      const initialTrust = trustManager.getTrustScore(venue);

      const order = {
        symbol: 'ETH/USD',
        side: 'buy' as const,
        amount: 1,
        price: 2000,
        venues: [venue]
      };

      // Mock execution to always fail
      jest.spyOn(router as any, 'executeOnVenue').mockResolvedValue({
        success: false,
        venue,
        reason: 'slippageTooHigh'
      });

      // Mock retry engine to indicate max retries exhausted
      jest.spyOn(retryEngine, 'retry').mockResolvedValue(false);

      await router.executeOrder(order);
      const finalTrust = trustManager.getTrustScore(venue);

      expect(finalTrust).toBeLessThan(initialTrust);
    });
  });
}); 