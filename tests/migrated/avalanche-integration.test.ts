import { MockTradingEngine } from './mock-trading-engine';
import { AvalancheAdapter } from '../../AvalancheAdapter';
import { Asset, TradeOrder } from '../../IChainAdapter';

/**
 * Integration test for Avalanche adapter with trading engine
 */
describe('Avalanche Adapter Integration', () => {
  let engine: MockTradingEngine;
  let adapter: AvalancheAdapter;
  
  beforeEach(async () => {
    // Create and initialize Avalanche adapter
    adapter = new AvalancheAdapter({
      chainId: 43114,
      networkName: 'Avalanche C-Chain',
      rpcUrl: 'https://api.avax.network/ext/bc/C/rpc',
      isMainnet: true
    });
    
    await adapter.initialize({});
    await adapter.connect();
    
    // Create mock trading engine with the adapter
    engine = new MockTradingEngine();
    engine.registerAdapter(43114, adapter);
    await engine.start();
  });
  
  afterEach(async () => {
    // Cleanup
    await engine.stop();
  });
  
  it('should fetch asset prices from Avalanche', async () => {
    // Define Avalanche assets
    const avax: Asset = {
      symbol: 'AVAX',
      name: 'Avalanche',
      decimals: 18,
      chainId: 43114,
      isNative: true
    };
    
    const usdc: Asset = {
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', // Avalanche USDC
      chainId: 43114,
      isNative: false
    };
    
    // Get price quote
    const quote = await engine.getQuote(avax, usdc, '10.0');
    
    // Assertions
    expect(quote).toBeDefined();
    expect(quote.expectedOutput).toBeDefined();
    expect(quote.priceImpact).toBeGreaterThanOrEqual(0);
    expect(quote.route).toBeDefined();
    expect(quote.route).toContain('AVAX');
    expect(quote.route).toContain('USDC');
    // Should include DEX name like Trader Joe or Pangolin
    expect(quote.route.some(item => ['Trader Joe', 'Pangolin'].includes(item))).toBe(true);
  });
  
  it('should execute trade on Avalanche', async () => {
    // Define trade parameters
    const order: TradeOrder = {
      id: 'test-avax-order-1',
      fromAsset: {
        symbol: 'AVAX',
        name: 'Avalanche',
        decimals: 18,
        chainId: 43114,
        isNative: true
      },
      toAsset: {
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 6,
        address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
        chainId: 43114,
        isNative: false
      },
      amount: '10.0',
      slippageTolerance: 0.5,
      timestamp: Date.now(),
      status: 'pending'
    };
    
    // Execute trade
    const result = await engine.submitOrder(order);
    
    // Assertions
    expect(result).toBeDefined();
    expect(result.success).toBe(true);
    expect(result.txHash).toBeDefined();
    expect(result.order.status).toBe('completed');
    expect(result.amountOut).toBeDefined();
  });
  
  it('should check wallet balances on Avalanche', async () => {
    // Define wallet and assets
    const walletAddress = '0x1234567890123456789012345678901234567890';
    const avax: Asset = {
      symbol: 'AVAX',
      name: 'Avalanche',
      decimals: 18,
      chainId: 43114,
      isNative: true
    };
    
    // Get balance
    const balance = await engine.getBalance(43114, walletAddress, avax);
    
    // Assertions
    expect(balance).toBeDefined();
    expect(parseFloat(balance)).toBeGreaterThanOrEqual(0);
    
    // Get native balance without specifying asset
    const nativeBalance = await engine.getBalance(43114, walletAddress);
    expect(nativeBalance).toBeDefined();
    expect(parseFloat(nativeBalance)).toBeGreaterThanOrEqual(0);
  });
  
  it('should handle token balances and quotes', async () => {
    // Define wallet and assets
    const walletAddress = '0x1234567890123456789012345678901234567890';
    const usdc: Asset = {
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
      chainId: 43114,
      isNative: false
    };
    
    const wethE: Asset = {
      symbol: 'WETH.e',
      name: 'Wrapped Ethereum',
      decimals: 18,
      address: '0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB',
      chainId: 43114,
      isNative: false
    };
    
    // Get token balance
    const usdcBalance = await engine.getBalance(43114, walletAddress, usdc);
    expect(usdcBalance).toBeDefined();
    expect(parseFloat(usdcBalance)).toBeGreaterThanOrEqual(0);
    
    // Get token-to-token quote
    const quote = await engine.getQuote(usdc, wethE, '1000.0');
    expect(quote.expectedOutput).toBeDefined();
    expect(quote.priceImpact).toBeDefined();
    expect(quote.route).toContain('USDC');
    expect(quote.route).toContain('WETH.e');
  });
  
  it('should handle multiple operations concurrently', async () => {
    // Define parameters for multiple operations
    const walletAddress = '0x1234567890123456789012345678901234567890';
    const avax: Asset = {
      symbol: 'AVAX',
      name: 'Avalanche',
      decimals: 18,
      chainId: 43114,
      isNative: true
    };
    const usdc: Asset = {
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
      chainId: 43114,
      isNative: false
    };
    
    // Execute multiple operations concurrently
    const [avaxBalance, quoteResult] = await Promise.all([
      engine.getBalance(43114, walletAddress, avax),
      engine.getQuote(avax, usdc, '10.0')
    ]);
    
    // Assertions
    expect(avaxBalance).toBeDefined();
    expect(quoteResult).toBeDefined();
    expect(quoteResult.expectedOutput).toBeDefined();
    expect(quoteResult.priceImpact).toBeGreaterThanOrEqual(0);
  });
  
  it('should get engine status with Avalanche adapter', async () => {
    // Get engine status
    const status = await engine.getStatus();
    
    // Assertions
    expect(status.isRunning).toBe(true);
    expect(status.registeredChains).toContain(43114);
    expect(status.adapterStatuses[43114]).toBeDefined();
    expect(status.adapterStatuses[43114].isConnected).toBe(true);
    expect(status.adapterStatuses[43114].chainId).toBe(43114);
    expect(status.adapterStatuses[43114].networkName).toBe('Avalanche C-Chain');
  });
  
  it('should handle transaction status checks', async () => {
    // Mock transaction hash
    const txHash = '0x' + Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('');
    
    // Use the adapter directly for tx status
    const status = await adapter.getTransactionStatus(txHash);
    
    // Assertions
    expect(status).toBeDefined();
    expect(['pending', 'confirmed', 'failed']).toContain(status.status);
    if (status.status === 'confirmed') {
      expect(status.confirmations).toBeGreaterThan(0);
    }
  });
  
  it('should support Avalanche-specific bridge operations', async () => {
    // Define asset for bridging
    const avax: Asset = {
      symbol: 'AVAX',
      name: 'Avalanche',
      decimals: 18,
      chainId: 43114,
      isNative: true
    };
    
    // Perform bridge operation from C-Chain to X-Chain
    const bridgeResult = await adapter.bridgeToChain(
      avax,
      '5.0',
      'C',
      'X',
      '0x1234567890123456789012345678901234567890'
    );
    
    // Assertions
    expect(bridgeResult.success).toBe(true);
    expect(bridgeResult.txHash).toBeDefined();
    
    // Invalid bridge operation (same chain)
    const invalidBridge = await adapter.bridgeToChain(
      avax,
      '5.0',
      'C',
      'C',
      '0x1234567890123456789012345678901234567890'
    );
    
    expect(invalidBridge.success).toBe(false);
    expect(invalidBridge.error).toBeDefined();
  });
  
  it('should provide staking APY information', async () => {
    // Get staking information
    const stakingInfo = await adapter.getStakingAPY();
    
    // Assertions
    expect(stakingInfo).toBeDefined();
    expect(stakingInfo.currentAPY).toBeGreaterThan(0);
    expect(stakingInfo.minStakeAmount).toBeDefined();
    expect(stakingInfo.recommendedValidators).toBeDefined();
    expect(stakingInfo.recommendedValidators?.length).toBeGreaterThan(0);
    
    // Check first validator
    const firstValidator = stakingInfo.recommendedValidators?.[0];
    expect(firstValidator).toBeDefined();
    expect(firstValidator?.id).toMatch(/^NodeID-/);
  });
}); 