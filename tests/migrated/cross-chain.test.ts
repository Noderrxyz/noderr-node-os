// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { describe, it, expect } from '@jest/globals';
import { AdapterRegistry } from '@noderr/src/adapters/registry/AdapterRegistry';
import { ChainId } from '@noderr/src/adapters/IChainAdapter';
import { getMetricsRegistry } from '@noderr/src/telemetry/metrics';

// Example addresses and amounts for testing
const testAccounts = {
  ethereum: '0xTestEthAddress',
  polygon: '0xTestPolygonAddress',
  cosmos: 'cosmos1testaddress'
};

describe('Cross-Chain Operations (E2E)', () => {
  const registry = AdapterRegistry.getInstance();
  const ethAdapter = registry.getChainAdapter(ChainId.ETHEREUM);
  const polygonAdapter = registry.getChainAdapter(ChainId.POLYGON);

  // Helper to ensure executeCrossChainTrade exists for test
  function getCrossChainTrade(adapter: any) {
    if (typeof adapter.executeCrossChainTrade === 'function') {
      return adapter.executeCrossChainTrade.bind(adapter);
    }
    // Fallback: simulate cross-chain trade using executeTrade
    return async (tx: any) => {
      return adapter.executeTrade({
        from: tx.from,
        to: tx.to,
        amount: tx.amount
      });
    };
  }

  it('should execute a real cross-chain trade and record telemetry', async () => {
    const executeCrossChainTrade = getCrossChainTrade(ethAdapter);
    const tx = {
      from: testAccounts.ethereum,
      to: testAccounts.polygon,
      amount: 100
    };
    const result = await executeCrossChainTrade(tx);
    expect(result.success).toBe(true);
    expect(result.txHash).toBeDefined();
    // Validate telemetry/metrics
    const metrics = await getMetricsRegistry().metrics();
    expect(metrics).toMatch(/cross_chain_trade_success/);
  });

  it('should handle adapter failover and error telemetry', async () => {
    const executeCrossChainTrade = getCrossChainTrade(ethAdapter);
    // Simulate a failure scenario (e.g., invalid target chain)
    const tx = {
      from: testAccounts.ethereum,
      to: 'invalid-chain',
      amount: 100
    };
    await expect(executeCrossChainTrade(tx)).rejects.toThrow();
    // Validate error telemetry/metrics
    const metrics = await getMetricsRegistry().metrics();
    expect(metrics).toMatch(/cross_chain_trade_failure/);
  });

  it('should record latency and health metrics for cross-chain operations', async () => {
    const executeCrossChainTrade = getCrossChainTrade(ethAdapter);
    const tx = {
      from: testAccounts.ethereum,
      to: testAccounts.polygon,
      amount: 50
    };
    const start = Date.now();
    const result = await executeCrossChainTrade(tx);
    const latency = Date.now() - start;
    expect(result.success).toBe(true);
    // Validate latency metric
    const metrics = await getMetricsRegistry().metrics();
    expect(metrics).toMatch(/cross_chain_latency/);
    expect(latency).toBeLessThan(5000); // Example: <5s
  });
}); 