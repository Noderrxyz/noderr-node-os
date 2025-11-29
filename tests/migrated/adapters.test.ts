import { 
  createAdapter, 
  ArbitrumAdapter, 
  AvalancheAdapter,
  BinanceAdapter,
  EthereumAdapter,
  PolygonAdapter,
  Asset,
  IChainAdapter,
  TradeOrder,
  AdapterStatus,
  ChainAdapterStatus,
  TradeResult
} from '../index';

// Mock console.log and error to keep test output clean
beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe('Adapter Factory', () => {
  it('should create an EthereumAdapter for Ethereum chain IDs', () => {
    const mainnetAdapter = createAdapter(1);
    const testnetAdapter = createAdapter(5);
    
    expect(mainnetAdapter).toBeInstanceOf(EthereumAdapter);
    expect(testnetAdapter).toBeInstanceOf(EthereumAdapter);
  });
  
  it('should create an AvalancheAdapter for Avalanche chain IDs', () => {
    const mainnetAdapter = createAdapter(43114);
    const testnetAdapter = createAdapter(43113);
    const subnetAdapter = createAdapter(11111); // Wagmi subnet
    
    expect(mainnetAdapter).toBeInstanceOf(AvalancheAdapter);
    expect(testnetAdapter).toBeInstanceOf(AvalancheAdapter);
    expect(subnetAdapter).toBeInstanceOf(AvalancheAdapter);
  });
  
  it('should create a PolygonAdapter for Polygon chain IDs', () => {
    const mainnetAdapter = createAdapter(137);
    const testnetAdapter = createAdapter(80001);
    
    expect(mainnetAdapter).toBeInstanceOf(PolygonAdapter);
    expect(testnetAdapter).toBeInstanceOf(PolygonAdapter);
  });
  
  it('should create an ArbitrumAdapter for Arbitrum chain IDs', () => {
    const mainnetAdapter = createAdapter(42161);
    const testnetAdapter = createAdapter(421613);
    
    expect(mainnetAdapter).toBeInstanceOf(ArbitrumAdapter);
    expect(testnetAdapter).toBeInstanceOf(ArbitrumAdapter);
  });
  
  it('should create a BinanceAdapter for BSC chain IDs', () => {
    const mainnetAdapter = createAdapter(56);
    const testnetAdapter = createAdapter(97);
    
    expect(mainnetAdapter).toBeInstanceOf(BinanceAdapter);
    expect(testnetAdapter).toBeInstanceOf(BinanceAdapter);
  });
  
  it('should throw for unsupported chain IDs', () => {
    expect(() => createAdapter(1234567)).toThrow('Unsupported chain ID: 1234567');
  });
  
  it('should pass configuration to created adapters', () => {
    const customConfig = {
      rpcUrl: 'https://custom-rpc.example.com',
      apiKey: 'test-api-key',
      isMainnet: false,
      gasMultiplier: 1.5
    };
    
    const arbitrumAdapter = createAdapter(42161, customConfig) as ArbitrumAdapter;
    const polygonAdapter = createAdapter(137, customConfig) as PolygonAdapter;
    const avalancheAdapter = createAdapter(43114, customConfig) as AvalancheAdapter;
    
    expect(arbitrumAdapter['config'].rpcUrl).toBe(customConfig.rpcUrl);
    expect(arbitrumAdapter['config'].apiKey).toBe(customConfig.apiKey);
    expect(arbitrumAdapter['config'].isMainnet).toBe(customConfig.isMainnet);
    expect(arbitrumAdapter['config'].gasMultiplier).toBe(customConfig.gasMultiplier);
    
    expect(polygonAdapter['config'].rpcUrl).toBe(customConfig.rpcUrl);
    expect(polygonAdapter['config'].apiKey).toBe(customConfig.apiKey);
    expect(polygonAdapter['config'].isMainnet).toBe(customConfig.isMainnet);
    expect(polygonAdapter['config'].gasMultiplier).toBe(customConfig.gasMultiplier);
    
    expect(avalancheAdapter['config'].rpcUrl).toBe(customConfig.rpcUrl);
    expect(avalancheAdapter['config'].apiKey).toBe(customConfig.apiKey);
    expect(avalancheAdapter['config'].isMainnet).toBe(customConfig.isMainnet);
    expect(avalancheAdapter['config'].gasMultiplier).toBe(customConfig.gasMultiplier);
  });
  
  it('should pass subnet configuration to Avalanche adapter', () => {
    const subnetConfig = {
      subnetworkId: 'wagmi',
      rpcUrl: 'https://subnets.avax.network/wagmi/wagmi-chain-testnet/rpc'
    };
    
    const adapter = createAdapter(11111, subnetConfig) as AvalancheAdapter;
    
    expect(adapter).toBeInstanceOf(AvalancheAdapter);
    expect((adapter['config'] as any).subnetworkId).toBe('wagmi');
    expect(adapter['config'].rpcUrl).toBe(subnetConfig.rpcUrl);
  });
});

describe('ArbitrumAdapter', () => {
  let adapter: ArbitrumAdapter;
  
  beforeEach(() => {
    adapter = new ArbitrumAdapter({
      rpcUrl: 'https://mock-arb-rpc.test',
      isMainnet: false
    });
  });
  
  afterEach(async () => {
    if (adapter) {
      try {
        await adapter.shutdown();
      } catch (error) {
        // Ignore shutdown errors in tests
      }
    }
  });
  
  it('should initialize with the correct default values', () => {
    expect(adapter['_name']).toBe('ArbitrumAdapter');
    expect(adapter['_version']).toBe('1.0.0');
    expect(adapter['config'].chainId).toBe(42161); // Default to mainnet
    expect(adapter['config'].rpcUrl).toBe('https://mock-arb-rpc.test'); // Overridden
  });
  
  it('should handle the complete lifecycle', async () => {
    // Spy on console.log to check for expected messages
    const consoleLogSpy = jest.spyOn(console, 'log');
    consoleLogSpy.mockClear();
    
    await adapter.initialize({});
    expect(adapter['_isInitialized']).toBe(true);
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Initializing ArbitrumAdapter'));
    
    await adapter.connect();
    expect(adapter['_isConnected']).toBe(true);
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Connecting to Arbitrum network'));
    
    const status = await adapter.getStatus();
    expect(status.name).toBe('ArbitrumAdapter');
    expect(status.isConnected).toBe(true);
    expect(status.chainId).toBe(42161);
    
    await adapter.disconnect();
    expect(adapter['_isConnected']).toBe(false);
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Disconnecting from Arbitrum network'));
    
    await adapter.shutdown();
    expect(adapter['_isInitialized']).toBe(false);
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Shutting down Arbitrum adapter'));
  });
  
  it('should reject initialization with invalid configuration', async () => {
    const invalidAdapter = new ArbitrumAdapter();
    
    // Override the required config values with invalid values
    invalidAdapter['config'].chainId = 0;
    invalidAdapter['config'].rpcUrl = '';
    
    await expect(invalidAdapter.initialize({})).rejects.toThrow(/chainId is required/);
  });
  
  it('should reject connection if not initialized', async () => {
    // Don't call initialize()
    await expect(adapter.connect()).rejects.toThrow(/must be initialized before connecting/);
  });
  
  it('should not fail on disconnect if not connected', async () => {
    await adapter.initialize({});
    // Don't call connect()
    await expect(adapter.disconnect()).resolves.not.toThrow();
  });
  
  it('should get balance for address', async () => {
    await adapter.initialize({});
    await adapter.connect();
    
    const ethAsset: Asset = {
      symbol: 'ETH',
      name: 'Ethereum',
      decimals: 18,
      chainId: 42161,
      isNative: true
    };
    
    const balance = await adapter.getBalance('0x123...', ethAsset);
    expect(balance).toBe('1.5'); // Mock response from adapter
    
    // Test with ERC20 token
    const tokenAsset: Asset = {
      symbol: 'ARB',
      name: 'Arbitrum',
      decimals: 18,
      address: '0x912CE59144191C1204E64559FE8253a0e49E6548',
      chainId: 42161
    };
    
    const tokenBalance = await adapter.getBalance('0x123...', tokenAsset);
    expect(tokenBalance).toBe('100.0'); // Mock response for non-native token
  });
  
  it('should execute a trade', async () => {
    await adapter.initialize({});
    await adapter.connect();
    
    const order = {
      id: 'test-order-1',
      fromAsset: {
        symbol: 'ETH',
        name: 'Ethereum',
        decimals: 18,
        chainId: 42161,
        isNative: true
      },
      toAsset: {
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 6,
        address: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
        chainId: 42161
      },
      amount: '1.0',
      slippageTolerance: 0.5,
      timestamp: Date.now(),
      status: 'pending' as const
    };
    
    const result = await adapter.executeTrade(order);
    expect(result.success).toBe(true);
    expect(result.order.status).toBe('completed');
    expect(result.txHash).toBeDefined();
    expect(result.fees).toBeDefined();
    expect(result.fees?.networkFee).toBeDefined();
  });
  
  it('should get transaction status', async () => {
    await adapter.initialize({});
    await adapter.connect();
    
    const txHash = '0x123456789abcdef123456789abcdef123456789abcdef123456789abcdef1234';
    
    const status = await adapter.getTransactionStatus(txHash);
    expect(status.status).toBe('confirmed');
    expect(status.confirmations).toBeGreaterThan(0);
    expect(status.receipt).toBeDefined();
  });
  
  it('should get quotes for trading pairs', async () => {
    await adapter.initialize({});
    await adapter.connect();
    
    const fromAsset: Asset = {
      symbol: 'ETH',
      name: 'Ethereum',
      decimals: 18,
      chainId: 42161,
      isNative: true
    };
    
    const toAsset: Asset = {
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      address: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
      chainId: 42161
    };
    
    // Test with different amounts
    const smallQuote = await adapter.getQuote(fromAsset, toAsset, '0.1');
    const largeQuote = await adapter.getQuote(fromAsset, toAsset, '10.0');
    
    expect(smallQuote.expectedOutput).toBeDefined();
    expect(largeQuote.expectedOutput).toBeDefined();
    expect(smallQuote.priceImpact).toBeLessThan(largeQuote.priceImpact);
    expect(smallQuote.route).toEqual(expect.any(Array));
  });
  
  it('should include metadata in status', async () => {
    await adapter.initialize({});
    await adapter.connect();
    
    const status = await adapter.getStatus();
    
    expect(status.metadata).toBeDefined();
    expect(status.metadata?.uptime).toBeGreaterThan(0);
    expect(status.metadata?.rpcUrl).toBe('https://mock-arb-rpc.test');
  });
});

describe('BinanceAdapter', () => {
  let adapter: BinanceAdapter;
  
  beforeEach(() => {
    adapter = new BinanceAdapter({
      rpcUrl: 'https://mock-bsc-rpc.test',
      isMainnet: false
    });
  });
  
  afterEach(async () => {
    if (adapter) {
      try {
        await adapter.shutdown();
      } catch (error) {
        // Ignore shutdown errors in tests
      }
    }
  });
  
  it('should initialize with the correct default values', () => {
    expect(adapter['_name']).toBe('BinanceAdapter');
    expect(adapter['config'].chainId).toBe(56); // Default to mainnet
    expect(adapter['config'].rpcUrl).toBe('https://mock-bsc-rpc.test'); // Overridden
  });
  
  it('should handle the complete lifecycle', async () => {
    // Spy on console.log to check for expected messages
    const consoleLogSpy = jest.spyOn(console, 'log');
    consoleLogSpy.mockClear();
    
    await adapter.initialize({});
    expect(adapter['_isInitialized']).toBe(true);
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Initializing BinanceAdapter'));
    
    await adapter.connect();
    expect(adapter['_isConnected']).toBe(true);
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Connecting to Binance Smart Chain'));
    
    const status = await adapter.getStatus();
    expect(status.name).toBe('BinanceAdapter');
    expect(status.isConnected).toBe(true);
    expect(status.chainId).toBe(56);
    
    await adapter.disconnect();
    expect(adapter['_isConnected']).toBe(false);
    
    await adapter.shutdown();
    expect(adapter['_isInitialized']).toBe(false);
  });
  
  it('should get balance for address', async () => {
    await adapter.initialize({});
    await adapter.connect();
    
    const bnbAsset: Asset = {
      symbol: 'BNB',
      name: 'Binance Coin',
      decimals: 18,
      chainId: 56,
      isNative: true
    };
    
    const balance = await adapter.getBalance('0x123...', bnbAsset);
    expect(balance).toBe('5.25'); // Mock response for native BNB
    
    // Test with token
    const tokenAsset: Asset = {
      symbol: 'CAKE',
      name: 'PancakeSwap Token',
      decimals: 18,
      address: '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82',
      chainId: 56
    };
    
    const tokenBalance = await adapter.getBalance('0x123...', tokenAsset);
    expect(tokenBalance).toBe('1250.0'); // Mock response for token
  });
  
  it('should get quote for trading pair', async () => {
    await adapter.initialize({});
    await adapter.connect();
    
    const bnbAsset: Asset = {
      symbol: 'BNB',
      name: 'Binance Coin',
      decimals: 18,
      chainId: 56,
      isNative: true
    };
    
    const busdAsset: Asset = {
      symbol: 'BUSD',
      name: 'Binance USD',
      decimals: 18,
      address: '0xe9e7cea3dedca5984780bafc599bd69add087d56',
      chainId: 56
    };
    
    const quote = await adapter.getQuote(bnbAsset, busdAsset, '10.0');
    expect(quote.expectedOutput).toBe('125.5'); // Mock response
    expect(quote.priceImpact).toBe(0.12);
    expect(quote.route).toEqual(['PancakeSwap', 'ApeSwap']);
  });
  
  it('should execute a trade', async () => {
    await adapter.initialize({});
    await adapter.connect();
    
    const order: TradeOrder = {
      id: 'test-bsc-order-1',
      fromAsset: {
        symbol: 'BNB',
        name: 'Binance Coin',
        decimals: 18,
        chainId: 56,
        isNative: true
      },
      toAsset: {
        symbol: 'BUSD',
        name: 'Binance USD',
        decimals: 18,
        address: '0xe9e7cea3dedca5984780bafc599bd69add087d56',
        chainId: 56
      },
      amount: '1.0',
      slippageTolerance: 0.5,
      timestamp: Date.now(),
      status: 'pending'
    };
    
    const result = await adapter.executeTrade(order);
    expect(result.success).toBe(true);
    expect(result.order.status).toBe('completed');
    expect(result.txHash).toBeDefined();
    expect(result.fees).toBeDefined();
  });
  
  it('should get transaction status', async () => {
    await adapter.initialize({});
    await adapter.connect();
    
    const txHash = '0xabcdef123456789abcdef123456789abcdef123456789abcdef123456789abcd';
    
    const status = await adapter.getTransactionStatus(txHash);
    expect(status.status).toBe('confirmed');
    expect(status.confirmations).toBeGreaterThan(0);
    expect(status.receipt).toBeDefined();
  });
});

describe('Error Handling', () => {
  // Mock adapter that simulates failures
  class MockFailingAdapter extends ArbitrumAdapter {
    private shouldFailConnect = false;
    private shouldFailInitialize = false;
    private shouldFailTrade = false;
    
    public simulateConnectFailure(shouldFail: boolean) {
      this.shouldFailConnect = shouldFail;
    }
    
    public simulateInitializeFailure(shouldFail: boolean) {
      this.shouldFailInitialize = shouldFail;
    }
    
    public simulateTradeFailure(shouldFail: boolean) {
      this.shouldFailTrade = shouldFail;
    }
    
    protected async initializeImpl(): Promise<void> {
      if (this.shouldFailInitialize) {
        throw new Error('Simulated initialization failure');
      }
      await super.initializeImpl();
    }
    
    protected async connectImpl(): Promise<void> {
      if (this.shouldFailConnect) {
        throw new Error('Simulated connection failure');
      }
      await super.connectImpl();
    }
    
    public async executeTrade(order: TradeOrder): Promise<TradeResult> {
      if (this.shouldFailTrade) {
        return {
          success: false,
          order: {
            ...order,
            status: 'failed' as const
          },
          timestamp: Date.now(),
          failureReason: 'Simulated trade failure'
        };
      }
      return super.executeTrade(order);
    }
  }
  
  let mockAdapter: MockFailingAdapter;
  
  beforeEach(() => {
    mockAdapter = new MockFailingAdapter({
      rpcUrl: 'https://mock-rpc.test',
      isMainnet: false
    });
  });
  
  afterEach(async () => {
    if (mockAdapter) {
      try {
        if (mockAdapter['_isInitialized']) {
          await mockAdapter.shutdown();
        }
      } catch (error) {
        // Ignore shutdown errors in tests
      }
    }
  });
  
  it('should handle initialization failures', async () => {
    mockAdapter.simulateInitializeFailure(true);
    await expect(mockAdapter.initialize({})).rejects.toThrow('Simulated initialization failure');
    expect(mockAdapter['_isInitialized']).toBe(false);
  });
  
  it('should handle connection failures', async () => {
    mockAdapter.simulateConnectFailure(true);
    await mockAdapter.initialize({});
    
    await expect(mockAdapter.connect()).rejects.toThrow('Simulated connection failure');
    expect(mockAdapter['_isConnected']).toBe(false);
    
    // Status should reflect the error
    const status = await mockAdapter.getStatus();
    expect(status.isConnected).toBe(false);
    expect(status.errors).toBeDefined();
    expect(status.errors?.[0]).toContain('Simulated connection failure');
  });
  
  it('should handle trade failures', async () => {
    mockAdapter.simulateTradeFailure(true);
    await mockAdapter.initialize({});
    await mockAdapter.connect();
    
    const order: TradeOrder = {
      id: 'test-failing-order',
      fromAsset: {
        symbol: 'ETH',
        name: 'Ethereum',
        decimals: 18,
        chainId: 42161,
        isNative: true
      },
      toAsset: {
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 6,
        address: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
        chainId: 42161
      },
      amount: '1.0',
      slippageTolerance: 0.5,
      timestamp: Date.now(),
      status: 'pending'
    };
    
    const result = await mockAdapter.executeTrade(order);
    expect(result.success).toBe(false);
    expect(result.order.status).toBe('failed');
    expect(result.failureReason).toBe('Simulated trade failure');
  });
}); 