import { MockTradingEngine } from './mock-trading-engine';
import { PolygonAdapter } from '../../PolygonAdapter';
import { Asset, TradeOrder } from '../../IChainAdapter';

/**
 * Integration test for Polygon adapter with trading engine
 */
describe('Polygon Adapter Integration', () => {
  let engine: MockTradingEngine;
  let adapter: PolygonAdapter;
  
  beforeEach(async () => {
    // Create and initialize Polygon adapter
    adapter = new PolygonAdapter({
      chainId: 137,
      networkName: 'Polygon Mainnet',
      rpcUrl: 'https://polygon-rpc.com',
      isMainnet: true
    });
    
    await adapter.initialize({});
    await adapter.connect();
    
    // Create mock trading engine with the adapter
    engine = new MockTradingEngine();
    engine.registerAdapter(137, adapter);
    await engine.start();
  });
  
  afterEach(async () => {
    // Cleanup
    await engine.stop();
  });
  
  it('should fetch asset prices from Polygon', async () => {
    // Define Polygon assets
    const matic: Asset = {
      symbol: 'MATIC',
      name: 'Polygon',
      decimals: 18,
      chainId: 137,
      isNative: true
    };
    
    const usdc: Asset = {
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', // Polygon USDC
      chainId: 137,
      isNative: false
    };
    
    // Get price quote
    const quote = await engine.getQuote(matic, usdc, '100.0');
    
    // Assertions
    expect(quote).toBeDefined();
    expect(quote.expectedOutput).toBeDefined();
    expect(quote.priceImpact).toBeGreaterThanOrEqual(0);
    expect(quote.route).toBeDefined();
    expect(quote.route).toContain('MATIC');
    expect(quote.route).toContain('USDC');
  });
  
  it('should execute trade on Polygon', async () => {
    // Define trade parameters
    const order: TradeOrder = {
      id: 'test-polygon-order-1',
      fromAsset: {
        symbol: 'MATIC',
        name: 'Polygon',
        decimals: 18,
        chainId: 137,
        isNative: true
      },
      toAsset: {
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 6,
        address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
        chainId: 137,
        isNative: false
      },
      amount: '100.0',
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
  
  it('should check wallet balances on Polygon', async () => {
    // Define wallet and assets
    const walletAddress = '0x1234567890123456789012345678901234567890';
    const matic: Asset = {
      symbol: 'MATIC',
      name: 'Polygon',
      decimals: 18,
      chainId: 137,
      isNative: true
    };
    
    // Get balance
    const balance = await engine.getBalance(137, walletAddress, matic);
    
    // Assertions
    expect(balance).toBeDefined();
    expect(parseFloat(balance)).toBeGreaterThanOrEqual(0);
    
    // Get native balance without specifying asset
    const nativeBalance = await engine.getBalance(137, walletAddress);
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
      address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
      chainId: 137,
      isNative: false
    };
    
    const weth: Asset = {
      symbol: 'WETH',
      name: 'Wrapped Ethereum',
      decimals: 18,
      address: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
      chainId: 137,
      isNative: false
    };
    
    // Get token balance
    const usdcBalance = await engine.getBalance(137, walletAddress, usdc);
    expect(usdcBalance).toBeDefined();
    expect(parseFloat(usdcBalance)).toBeGreaterThanOrEqual(0);
    
    // Get token-to-token quote
    const quote = await engine.getQuote(usdc, weth, '1000.0');
    expect(quote.expectedOutput).toBeDefined();
    expect(quote.priceImpact).toBeDefined();
    expect(quote.route).toContain('USDC');
    expect(quote.route).toContain('WETH');
  });
  
  it('should handle multiple operations concurrently', async () => {
    // Define parameters for multiple operations
    const walletAddress = '0x1234567890123456789012345678901234567890';
    const matic: Asset = {
      symbol: 'MATIC',
      name: 'Polygon',
      decimals: 18,
      chainId: 137,
      isNative: true
    };
    const usdc: Asset = {
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
      chainId: 137,
      isNative: false
    };
    
    // Execute multiple operations concurrently
    const [maticBalance, quoteResult] = await Promise.all([
      engine.getBalance(137, walletAddress, matic),
      engine.getQuote(matic, usdc, '100.0')
    ]);
    
    // Assertions
    expect(maticBalance).toBeDefined();
    expect(quoteResult).toBeDefined();
    expect(quoteResult.expectedOutput).toBeDefined();
    expect(quoteResult.priceImpact).toBeGreaterThanOrEqual(0);
  });
  
  it('should get engine status with Polygon adapter', async () => {
    // Get engine status
    const status = await engine.getStatus();
    
    // Assertions
    expect(status.isRunning).toBe(true);
    expect(status.registeredChains).toContain(137);
    expect(status.adapterStatuses[137]).toBeDefined();
    expect(status.adapterStatuses[137].isConnected).toBe(true);
    expect(status.adapterStatuses[137].chainId).toBe(137);
    expect(status.adapterStatuses[137].networkName).toBe('Polygon Mainnet');
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
}); 