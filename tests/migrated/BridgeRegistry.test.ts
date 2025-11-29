import { BridgeRegistry } from '../BridgeRegistry';
import { Bridge } from '../../types/Bridge';
import { ChainId } from '../../types/ChainId';

describe('BridgeRegistry', () => {
  let bridgeRegistry: BridgeRegistry;
  
  // Test bridge
  const ARBITRUM_BRIDGE: Bridge = {
    id: 'arbitrum-bridge',
    name: 'Arbitrum Bridge',
    sourceChain: ChainId.ETHEREUM,
    destinationChain: ChainId.ARBITRUM,
    sourceAddress: '0x8315177aB297bA92A06054cE80a67Ed4DBd7ed3a',
    destinationAddress: '0x8315177aB297bA92A06054cE80a67Ed4DBd7ed3a',
    isActive: true,
    minAmountUsd: 0,
    maxAmountUsd: 1000000,
    estimatedTimeSeconds: 300,
    feePercentage: 0.1
  };
  
  beforeEach(() => {
    bridgeRegistry = BridgeRegistry.getInstance({
      enableHealthChecks: false // Disable health checks for tests
    });
  });
  
  describe('bridge registration', () => {
    it('should register a new bridge', () => {
      bridgeRegistry.registerBridge(ARBITRUM_BRIDGE);
      
      const bridge = bridgeRegistry.getBridge(ARBITRUM_BRIDGE.id);
      expect(bridge).toBeDefined();
      expect(bridge).toEqual(ARBITRUM_BRIDGE);
    });
    
    it('should unregister a bridge', () => {
      bridgeRegistry.registerBridge(ARBITRUM_BRIDGE);
      bridgeRegistry.unregisterBridge(ARBITRUM_BRIDGE.id);
      
      const bridge = bridgeRegistry.getBridge(ARBITRUM_BRIDGE.id);
      expect(bridge).toBeUndefined();
    });
  });
  
  describe('bridge lookup', () => {
    it('should get bridges for a chain', () => {
      bridgeRegistry.registerBridge(ARBITRUM_BRIDGE);
      
      const bridges = bridgeRegistry.getBridgesForChain(ChainId.ETHEREUM);
      expect(bridges).toHaveLength(1);
      expect(bridges[0]).toEqual(ARBITRUM_BRIDGE);
    });
    
    it('should not return inactive bridges', () => {
      const inactiveBridge: Bridge = {
        ...ARBITRUM_BRIDGE,
        id: 'inactive-bridge',
        isActive: false
      };
      
      bridgeRegistry.registerBridge(inactiveBridge);
      
      const bridges = bridgeRegistry.getBridgesForChain(ChainId.ETHEREUM);
      expect(bridges).toHaveLength(0);
    });
  });
  
  describe('health checks', () => {
    it('should check bridge health', async () => {
      bridgeRegistry = BridgeRegistry.getInstance({
        enableHealthChecks: true,
        enableStatusCache: false
      });
      
      bridgeRegistry.registerBridge(ARBITRUM_BRIDGE);
      
      const isHealthy = await bridgeRegistry.isBridgeHealthy(ARBITRUM_BRIDGE.id);
      expect(isHealthy).toBe(true);
    });
    
    it('should handle health check failures', async () => {
      bridgeRegistry = BridgeRegistry.getInstance({
        enableHealthChecks: true,
        enableStatusCache: false
      });
      
      const unhealthyBridge: Bridge = {
        ...ARBITRUM_BRIDGE,
        id: 'unhealthy-bridge',
        isActive: false
      };
      
      bridgeRegistry.registerBridge(unhealthyBridge);
      
      const isHealthy = await bridgeRegistry.isBridgeHealthy(unhealthyBridge.id);
      expect(isHealthy).toBe(false);
    });
    
    it('should use status cache when enabled', async () => {
      bridgeRegistry = BridgeRegistry.getInstance({
        enableHealthChecks: true,
        enableStatusCache: true,
        statusCacheTtlMs: 1000
      });
      
      bridgeRegistry.registerBridge(ARBITRUM_BRIDGE);
      
      // First check should perform health check
      const isHealthy1 = await bridgeRegistry.isBridgeHealthy(ARBITRUM_BRIDGE.id);
      expect(isHealthy1).toBe(true);
      
      // Mock health check to fail
      jest.spyOn(bridgeRegistry as any, 'performHealthCheck').mockResolvedValueOnce(false);
      
      // Second check should use cache
      const isHealthy2 = await bridgeRegistry.isBridgeHealthy(ARBITRUM_BRIDGE.id);
      expect(isHealthy2).toBe(true);
      
      // Wait for cache to expire
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      // Third check should perform health check again
      const isHealthy3 = await bridgeRegistry.isBridgeHealthy(ARBITRUM_BRIDGE.id);
      expect(isHealthy3).toBe(false);
    });
  });
  
  describe('configuration', () => {
    it('should update configuration', () => {
      const config = {
        enableHealthChecks: true,
        healthCheckIntervalMs: 2000
      };
      
      bridgeRegistry = BridgeRegistry.getInstance(config);
      
      // Verify health checks are started
      expect(bridgeRegistry['healthCheckInterval']).toBeDefined();
      
      // Update config to disable health checks
      bridgeRegistry = BridgeRegistry.getInstance({
        enableHealthChecks: false
      });
      
      // Verify health checks are stopped
      expect(bridgeRegistry['healthCheckInterval']).toBeUndefined();
    });
  });
}); 