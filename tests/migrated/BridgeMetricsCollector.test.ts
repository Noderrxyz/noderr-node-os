import { BridgeMetricsCollector } from '../BridgeMetricsCollector';
import { Bridge } from '../../types/Bridge';
import { ChainId } from '../../types/ChainId';

describe('BridgeMetricsCollector', () => {
  let collector: BridgeMetricsCollector;
  
  // Test bridge
  const TEST_BRIDGE: Bridge = {
    id: 'test-bridge',
    name: 'Test Bridge',
    sourceChain: ChainId.ETHEREUM,
    destinationChain: ChainId.ARBITRUM,
    sourceAddress: '0x123',
    destinationAddress: '0x456',
    isActive: true,
    minAmountUsd: 100,
    maxAmountUsd: 1000000,
    estimatedTimeSeconds: 300,
    feePercentage: 0.1
  };
  
  beforeEach(() => {
    collector = BridgeMetricsCollector.getInstance();
  });
  
  describe('getMetrics', () => {
    it('should return cached metrics when available and not expired', async () => {
      // First call to populate cache
      const firstMetrics = await collector.getMetrics(TEST_BRIDGE);
      
      // Mock the fetchMetrics method to verify it's not called again
      const fetchSpy = jest.spyOn(collector as any, 'fetchMetrics');
      
      // Second call should use cache
      const secondMetrics = await collector.getMetrics(TEST_BRIDGE);
      
      expect(secondMetrics).toEqual(firstMetrics);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
    
    it('should fetch fresh metrics when cache is expired', async () => {
      // First call to populate cache
      await collector.getMetrics(TEST_BRIDGE);
      
      // Mock the fetchMetrics method
      const fetchSpy = jest.spyOn(collector as any, 'fetchMetrics');
      
      // Force cache expiration by updating timestamp
      const cache = (collector as any).metricsCache.get(TEST_BRIDGE.id);
      cache.timestamp = Date.now() - 60000; // 1 minute ago
      
      // Second call should fetch fresh metrics
      await collector.getMetrics(TEST_BRIDGE);
      
      expect(fetchSpy).toHaveBeenCalled();
    });
    
    it('should use fallback metrics when fetch fails and fallback is enabled', async () => {
      // Mock fetchMetrics to throw
      jest.spyOn(collector as any, 'fetchMetrics').mockRejectedValue(new Error('Fetch failed'));
      
      // First call should use default metrics
      const metrics = await collector.getMetrics(TEST_BRIDGE);
      
      expect(metrics).toEqual({
        liquidityUsd: TEST_BRIDGE.minAmountUsd,
        feeUsd: 0,
        estimatedTimeSeconds: TEST_BRIDGE.estimatedTimeSeconds,
        reliabilityScore: 0.5,
        securityScore: 0.5
      });
    });
    
    it('should retry failed fetches with exponential backoff', async () => {
      // Mock fetchMetrics to fail twice then succeed
      const fetchSpy = jest.spyOn(collector as any, 'fetchMetrics')
        .mockRejectedValueOnce(new Error('First failure'))
        .mockRejectedValueOnce(new Error('Second failure'))
        .mockResolvedValueOnce({
          liquidityUsd: 1000000,
          feeUsd: 10,
          estimatedTimeSeconds: 300,
          reliabilityScore: 0.95,
          securityScore: 0.9
        });
      
      // Call should eventually succeed
      const metrics = await collector.getMetrics(TEST_BRIDGE);
      
      expect(fetchSpy).toHaveBeenCalledTimes(3);
      expect(metrics).toBeDefined();
    });
  });
  
  describe('configuration', () => {
    it('should update configuration correctly', () => {
      const newConfig = {
        cacheTtlMs: 60000,
        maxRetries: 5,
        fetchTimeoutMs: 10000,
        enableFallback: false
      };
      
      collector = BridgeMetricsCollector.getInstance(newConfig);
      
      expect((collector as any).config).toEqual({
        ...(collector as any).config,
        ...newConfig
      });
    });
  });
}); 