import { MockTradingEngine } from './mock-trading-engine';
import { EthereumAdapter } from '@noderr/EthereumAdapter';
import { Asset, TradeOrder } from '@noderr/IChainAdapter';

/**
 * Integration test for Ethereum adapter with trading engine
 */
describe('Ethereum Adapter Integration', () => {
  let engine: MockTradingEngine;
  let adapter: EthereumAdapter;
  
  beforeEach(async () => {
    // Create and initialize Ethereum adapter
    adapter = new EthereumAdapter({
      chainId: 1,
      networkName: 'Ethereum Mainnet',
      rpcUrl: 'https://eth-mainnet.g.alchemy.com/v2/demo',
      isMainnet: true
    });
    
    await adapter.initialize({});
    await adapter.connect();
    
    // Create mock trading engine with the adapter
    engine = new MockTradingEngine();
    engine.registerAdapter(1, adapter);
    await engine.start();
  });
  
  afterEach(async () => {
    // Cleanup
    await engine.stop();
  });
  
  it('should fetch asset prices from Ethereum', async () => {
    // Define Ethereum assets
    const eth: Asset = {
      symbol: 'ETH',
      name: 'Ethereum',
      decimals: 18,
      chainId: 1,
      isNative: true
    };
    
    const dai: Asset = {
      symbol: 'DAI',
      name: 'Dai Stablecoin',
      decimals: 18,
      address: '0x6b175474e89094c44da98b954eedeac495271d0f',
      chainId: 1,
      isNative: false
    };
    
    // Get price quote
    const quote = await engine.getQuote(eth, dai, '1.0');
    
    // Assertions
    expect(quote).toBeDefined();
    expect(quote.expectedOutput).toBeDefined();
    expect(quote.priceImpact).toBeGreaterThanOrEqual(0);
    expect(quote.route).toBeDefined();
    expect(quote.route).toContain('WETH');
    expect(quote.route?.length).toBeGreaterThan(0);
  });
  
  it('should execute trade on Ethereum', async () => {
    // Define trade parameters
    const order: TradeOrder = {
      id: 'test-order-1',
      fromAsset: {
        symbol: 'ETH',
        name: 'Ethereum',
        decimals: 18,
        chainId: 1,
        isNative: true
      },
      toAsset: {
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 6,
        address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        chainId: 1,
        isNative: false
      },
      amount: '0.5',
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
  
  it('should check wallet balances on Ethereum', async () => {
    // Define wallet and assets
    const walletAddress = '0x1234567890123456789012345678901234567890';
    const asset: Asset = {
      symbol: 'ETH',
      name: 'Ethereum',
      decimals: 18,
      chainId: 1,
      isNative: true
    };
    
    // Get balance
    const balance = await engine.getBalance(1, walletAddress, asset);
    
    // Assertions
    expect(balance).toBeDefined();
    expect(parseFloat(balance)).toBeGreaterThanOrEqual(0);
    
    // Get native balance without specifying asset
    const nativeBalance = await engine.getBalance(1, walletAddress);
    expect(nativeBalance).toBeDefined();
    expect(parseFloat(nativeBalance)).toBeGreaterThanOrEqual(0);
  });
  
  it('should monitor transaction status', async () => {
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
  
  it('should handle multiple operations concurrently', async () => {
    // Define parameters for multiple operations
    const walletAddress = '0x1234567890123456789012345678901234567890';
    const eth: Asset = {
      symbol: 'ETH',
      name: 'Ethereum',
      decimals: 18,
      chainId: 1,
      isNative: true
    };
    const usdc: Asset = {
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      chainId: 1,
      isNative: false
    };
    
    // Execute multiple operations concurrently
    const [ethBalance, quoteResult] = await Promise.all([
      engine.getBalance(1, walletAddress, eth),
      engine.getQuote(eth, usdc, '1.0')
    ]);
    
    // Assertions
    expect(ethBalance).toBeDefined();
    expect(quoteResult).toBeDefined();
    expect(quoteResult.expectedOutput).toBeDefined();
    expect(quoteResult.priceImpact).toBeGreaterThanOrEqual(0);
  });
}); 