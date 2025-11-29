import { PathFinder } from '../PathFinder';
import { BridgeRegistry } from '@noderr/bridge/BridgeRegistry';
import { Asset } from '@noderr/types/Asset';
import { ChainId } from '@noderr/types/ChainId';
import { Bridge } from '@noderr/types/Bridge';
import { BridgeMetricsCollector } from '@noderr/bridge/BridgeMetricsCollector';

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

describe('PathFinder Chaos/Simulation', () => {
  let pathFinder: PathFinder;
  let bridgeRegistry: BridgeRegistry;
  let metricsCollector: BridgeMetricsCollector;

  beforeEach(() => {
    bridgeRegistry = BridgeRegistry.getInstance({ enableHealthChecks: false });
    pathFinder = PathFinder.getInstance({ maxHops: 2, enableParallelSearch: false });
    metricsCollector = BridgeMetricsCollector.getInstance();
    bridgeRegistry.registerBridge(ARBITRUM_BRIDGE);
    bridgeRegistry.registerBridge(OPTIMISM_BRIDGE);
  });

  it('should gracefully handle intermittent metric fetch failures', async () => {
    let callCount = 0;
    jest.spyOn(metricsCollector, 'getMetrics').mockImplementation(async (bridge) => {
      callCount++;
      if (callCount % 2 === 0) throw new Error('Random metric failure');
      return { liquidityUsd: 1000000, feeUsd: 10, estimatedTimeSeconds: 300, reliabilityScore: 0.95, securityScore: 0.9 };
    });
    const result = await pathFinder.findOptimalPath(ETH, USDC, '10000');
    // Should not throw, should fallback or return null
    expect(result === null || result?.path).toBeTruthy();
  });

  it('should handle rapid bridge activation/deactivation (flapping)', async () => {
    let active = true;
    jest.spyOn(bridgeRegistry, 'getBridgesForChain').mockImplementation(() => {
      active = !active;
      return active ? [ARBITRUM_BRIDGE] : [];
    });
    const result = await pathFinder.findOptimalPath(ETH, USDC, '10000');
    expect(result === null || result?.path).toBeTruthy();
  });

  it('should handle fluctuating bridge metrics', async () => {
    jest.spyOn(metricsCollector, 'getMetrics').mockImplementation(async (bridge) => {
      // Randomize metrics
      return {
        liquidityUsd: Math.random() * 1_000_000,
        feeUsd: Math.random() * 100,
        estimatedTimeSeconds: 100 + Math.random() * 1000,
        reliabilityScore: Math.random(),
        securityScore: Math.random()
      };
    });
    const result = await pathFinder.findOptimalPath(ETH, USDC, '10000');
    expect(result === null || result?.path).toBeTruthy();
  });

  it('should handle high concurrency (multiple simultaneous requests)', async () => {
    jest.spyOn(metricsCollector, 'getMetrics').mockResolvedValue({
      liquidityUsd: 1000000, feeUsd: 10, estimatedTimeSeconds: 300, reliabilityScore: 0.95, securityScore: 0.9
    });
    const requests = Array.from({ length: 10 }, () => pathFinder.findOptimalPath(ETH, USDC, '10000'));
    const results = await Promise.all(requests);
    results.forEach(result => {
      expect(result === null || result?.path).toBeTruthy();
    });
  });

  it('should emit telemetry/logging for chaos events', async () => {
    const telemetrySpy = jest.spyOn((pathFinder as any).telemetryBus, 'emit');
    jest.spyOn(metricsCollector, 'getMetrics').mockRejectedValue(new Error('Chaos metric failure'));
    await pathFinder.findOptimalPath(ETH, USDC, '10000');
    expect(telemetrySpy).toHaveBeenCalledWith(
      expect.stringContaining('bridge_selected'),
      expect.any(Object)
    );
  });
}); 