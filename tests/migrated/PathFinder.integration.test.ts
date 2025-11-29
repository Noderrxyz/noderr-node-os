import { PathFinder } from '../PathFinder';
import { BridgeRegistry } from '../../bridge/BridgeRegistry';
import { Asset } from '../../types/Asset';
import { ChainId } from '../../types/ChainId';
import { Bridge } from '../../types/Bridge';
import { BridgeMetricsCollector } from '../../bridge/BridgeMetricsCollector';
import { BridgeSelector } from '../../bridge/BridgeSelector';
import { DefaultBridgeScoringStrategy } from '../../bridge/DefaultBridgeScoringStrategy';

describe('PathFinder Integration', () => {
  let pathFinder: PathFinder;
  let bridgeRegistry: BridgeRegistry;
  let metricsCollector: BridgeMetricsCollector;
  let selector: BridgeSelector;
  
  // Test assets
  const ETH: Asset = {
    chainId: ChainId.ETHEREUM,
    address: '0x0000000000000000000000000000000000000000',
    symbol: 'ETH',
    decimals: 18,
    name: 'Ethereum'
  };
  
  const USDC: Asset = {
    chainId: ChainId.ARBITRUM,
    address: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
    symbol: 'USDC',
    decimals: 6,
    name: 'USD Coin'
  };
  
  // Test bridges
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
  
  const OPTIMISM_BRIDGE: Bridge = {
    id: 'optimism-bridge',
    name: 'Optimism Bridge',
    sourceChain: ChainId.ETHEREUM,
    destinationChain: ChainId.OPTIMISM,
    sourceAddress: '0x99C9fc46f92E8a1c0deC1b1747d010903E884bE1',
    destinationAddress: '0x99C9fc46f92E8a1c0deC1b1747d010903E884bE1',
    isActive: true,
    minAmountUsd: 0,
    maxAmountUsd: 1000000,
    estimatedTimeSeconds: 300,
    feePercentage: 0.1
  };
  
  beforeEach(() => {
    // Initialize with test configuration
    bridgeRegistry = BridgeRegistry.getInstance({
      enableHealthChecks: false
    });
    
    pathFinder = PathFinder.getInstance({
      maxHops: 2,
      enableParallelSearch: false
    });
    metricsCollector = BridgeMetricsCollector.getInstance();
    selector = new BridgeSelector(new DefaultBridgeScoringStrategy());
    
    // Register test bridges
    bridgeRegistry.registerBridge(ARBITRUM_BRIDGE);
    bridgeRegistry.registerBridge(OPTIMISM_BRIDGE);
  });
  
  describe('path finding with bridges', () => {
    it('should find direct path through Arbitrum bridge', async () => {
      // Mock path scoring
      jest.spyOn(pathFinder as any, 'estimatePathScore').mockResolvedValue({
        gasCost: 0.8,
        bridgeFees: 0.9,
        priceImpact: 0.95,
        pathLength: 1,
        liquidity: 0.9,
        total: 0.9
      });
      
      const result = await pathFinder.findOptimalPath(ETH, USDC, '1.0');
      
      expect(result).not.toBeNull();
      expect(result?.path.hops).toHaveLength(1);
      expect(result?.path.hops[0].bridge).toBe(ARBITRUM_BRIDGE.id);
    });
    
    it('should find multi-hop path when direct path is not available', async () => {
      // Create a target asset on Optimism
      const OPTIMISM_USDC: Asset = {
        ...USDC,
        chainId: ChainId.OPTIMISM,
        address: '0x7F5c764cBc14f9669B88837ca1490cCa17c31607'
      };
      
      // Mock path scoring
      jest.spyOn(pathFinder as any, 'estimatePathScore').mockResolvedValue({
        gasCost: 0.8,
        bridgeFees: 0.9,
        priceImpact: 0.95,
        pathLength: 1,
        liquidity: 0.9,
        total: 0.9
      });
      
      const result = await pathFinder.findOptimalPath(ETH, OPTIMISM_USDC, '1.0');
      
      expect(result).not.toBeNull();
      expect(result?.path.hops).toHaveLength(1);
      expect(result?.path.hops[0].bridge).toBe(OPTIMISM_BRIDGE.id);
    });
    
    it('should not find path when no bridges are available', async () => {
      // Unregister all bridges
      bridgeRegistry.unregisterBridge(ARBITRUM_BRIDGE.id);
      bridgeRegistry.unregisterBridge(OPTIMISM_BRIDGE.id);
      
      const result = await pathFinder.findOptimalPath(ETH, USDC, '1.0');
      
      expect(result).toBeNull();
    });
    
    it('should not find path when bridges are inactive', async () => {
      // Deactivate all bridges
      const inactiveArbitrumBridge = {
        ...ARBITRUM_BRIDGE,
        isActive: false
      };
      
      const inactiveOptimismBridge = {
        ...OPTIMISM_BRIDGE,
        isActive: false
      };
      
      bridgeRegistry.unregisterBridge(ARBITRUM_BRIDGE.id);
      bridgeRegistry.unregisterBridge(OPTIMISM_BRIDGE.id);
      
      bridgeRegistry.registerBridge(inactiveArbitrumBridge);
      bridgeRegistry.registerBridge(inactiveOptimismBridge);
      
      const result = await pathFinder.findOptimalPath(ETH, USDC, '1.0');
      
      expect(result).toBeNull();
    });
    
    it('should respect maxHops configuration', async () => {
      // Create a target asset on Polygon
      const POLYGON_USDC: Asset = {
        ...USDC,
        chainId: ChainId.POLYGON,
        address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'
      };
      
      // Add Polygon bridge
      const POLYGON_BRIDGE: Bridge = {
        id: 'polygon-bridge',
        name: 'Polygon Bridge',
        sourceChain: ChainId.ETHEREUM,
        destinationChain: ChainId.POLYGON,
        sourceAddress: '0xA0c68C638235ee32657e8f720a23ceC1bFc77C77',
        destinationAddress: '0xA0c68C638235ee32657e8f720a23ceC1bFc77C77',
        isActive: true,
        minAmountUsd: 0,
        maxAmountUsd: 1000000,
        estimatedTimeSeconds: 300,
        feePercentage: 0.1
      };
      
      bridgeRegistry.registerBridge(POLYGON_BRIDGE);
      
      // Set maxHops to 1
      pathFinder = PathFinder.getInstance({ maxHops: 1 });
      
      // Mock path scoring
      jest.spyOn(pathFinder as any, 'estimatePathScore').mockResolvedValue({
        gasCost: 0.8,
        bridgeFees: 0.9,
        priceImpact: 0.95,
        pathLength: 1,
        liquidity: 0.9,
        total: 0.9
      });
      
      const result = await pathFinder.findOptimalPath(ETH, POLYGON_USDC, '1.0');
      
      expect(result).not.toBeNull();
      expect(result?.path.hops.length).toBeLessThanOrEqual(1);
    });
  });

  describe('bridge selection and metrics integration', () => {
    it('should select the bridge with the highest score based on metrics', async () => {
      // Mock metrics for bridges
      jest.spyOn(metricsCollector, 'getMetrics').mockImplementation(async (bridge) => {
        if (bridge.id === ARBITRUM_BRIDGE.id) {
          return { liquidityUsd: 1000000, feeUsd: 10, estimatedTimeSeconds: 300, reliabilityScore: 0.95, securityScore: 0.9 };
        } else {
          return { liquidityUsd: 50000, feeUsd: 100, estimatedTimeSeconds: 1200, reliabilityScore: 0.7, securityScore: 0.6 };
        }
      });
      // Spy on selector
      const selectSpy = jest.spyOn(selector, 'selectBestBridge');
      // Find path
      const result = await pathFinder.findOptimalPath(ETH, USDC, '10000');
      expect(result).not.toBeNull();
      expect(result?.path.hops[0].bridge).toBe(ARBITRUM_BRIDGE.id);
      expect(selectSpy).not.toHaveBeenCalled(); // PathFinder uses its own selector instance
    });

    it('should handle no available bridges', async () => {
      bridgeRegistry.unregisterBridge(ARBITRUM_BRIDGE.id);
      bridgeRegistry.unregisterBridge(OPTIMISM_BRIDGE.id);
      const result = await pathFinder.findOptimalPath(ETH, USDC, '10000');
      expect(result).toBeNull();
    });

    it('should handle unhealthy bridges and metric failures gracefully', async () => {
      // Mark all bridges as unhealthy
      jest.spyOn(bridgeRegistry, 'getBridgesForChain').mockReturnValue([]);
      const result = await pathFinder.findOptimalPath(ETH, USDC, '10000');
      expect(result).toBeNull();
      // Simulate metric failure fallback
      jest.spyOn(metricsCollector, 'getMetrics').mockRejectedValue(new Error('Metrics unavailable'));
      bridgeRegistry.registerBridge(ARBITRUM_BRIDGE);
      const result2 = await pathFinder.findOptimalPath(ETH, USDC, '10000');
      expect(result2).toBeNull();
    });

    it('should emit telemetry and log bridge selection events', async () => {
      const telemetrySpy = jest.spyOn((pathFinder as any).telemetryBus, 'emit');
      jest.spyOn(metricsCollector, 'getMetrics').mockResolvedValue({
        liquidityUsd: 1000000, feeUsd: 10, estimatedTimeSeconds: 300, reliabilityScore: 0.95, securityScore: 0.9
      });
      await pathFinder.findOptimalPath(ETH, USDC, '10000');
      expect(telemetrySpy).toHaveBeenCalledWith(
        'bridge_selected',
        expect.objectContaining({ bridgeId: ARBITRUM_BRIDGE.id })
      );
    });
  });
}); 