import { 
  ArbitrumAdapter, 
  BinanceAdapter, 
  Asset, 
  TradeOrder 
} from '@noderr/index';
import { MockTradingEngine } from './mock-trading-engine';

// Mock console.log and error to keep test output clean
beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe('Trading Engine Adapter Integration', () => {
  let engine: MockTradingEngine;
  let arbitrumAdapter: ArbitrumAdapter;
  let binanceAdapter: BinanceAdapter;
  
  beforeEach(() => {
    // Create adapters with test configuration
    arbitrumAdapter = new ArbitrumAdapter({
      rpcUrl: 'https://mock-arb-rpc.test',
      isMainnet: false
    });
    
    binanceAdapter = new BinanceAdapter({
      rpcUrl: 'https://mock-bsc-rpc.test',
      isMainnet: false
    });
    
    // Create engine with auto initialization disabled (we'll initialize manually)
    engine = new MockTradingEngine(false);
    
    // Register adapters directly
    engine.registerAdapter(42161, arbitrumAdapter);
    engine.registerAdapter(56, binanceAdapter);
  });
  
  afterEach(async () => {
    // Ensure engine is stopped
    await engine.stop();
  });
  
  describe('Engine Lifecycle', () => {
    it('should start and stop the engine with registered adapters', async () => {
      // Initialize adapters manually before starting engine
      await arbitrumAdapter.initialize({});
      await arbitrumAdapter.connect();
      
      await binanceAdapter.initialize({});
      await binanceAdapter.connect();
      
      // Start engine (won't auto-initialize since we disabled it)
      await engine.start();
      
      // Check engine status
      const status = await engine.getStatus();
      expect(status.isRunning).toBe(true);
      expect(status.registeredChains).toContain(42161);
      expect(status.registeredChains).toContain(56);
      expect(status.adapterStatuses[42161].isConnected).toBe(true);
      expect(status.adapterStatuses[56].isConnected).toBe(true);
      
      // Stop engine
      await engine.stop();
      
      // Check that engine is stopped
      const stoppedStatus = await engine.getStatus();
      expect(stoppedStatus.isRunning).toBe(false);
    });
    
    it('should automatically initialize adapters when autoInitialize is true', async () => {
      // Create new engine with auto initialization enabled
      const autoEngine = new MockTradingEngine(true);
      
      // Register adapters
      autoEngine.registerAdapter(42161, new ArbitrumAdapter({
        rpcUrl: 'https://mock-arb-rpc.test',
        isMainnet: false
      }));
      
      // Start engine (should auto-initialize)
      await autoEngine.start();
      
      // Check engine status
      const status = await autoEngine.getStatus();
      expect(status.isRunning).toBe(true);
      expect(status.registeredChains).toContain(42161);
      expect(status.adapterStatuses[42161].isConnected).toBe(true);
      
      // Stop engine
      await autoEngine.stop();
    });
    
    it('should create adapters from chain IDs', async () => {
      // Create new engine
      const chainsEngine = new MockTradingEngine(true);
      
      // Register adapters from chain IDs
      await chainsEngine.registerAdaptersFromChainIds([42161, 56], {
        rpcUrl: 'https://mock-rpc.test',
        isMainnet: false
      });
      
      // Start engine
      await chainsEngine.start();
      
      // Check engine status
      const status = await chainsEngine.getStatus();
      expect(status.isRunning).toBe(true);
      expect(status.registeredChains).toHaveLength(2);
      expect(status.registeredChains).toContain(42161);
      expect(status.registeredChains).toContain(56);
      
      // Stop engine
      await chainsEngine.stop();
    });
  });
  
  describe('Trading Operations', () => {
    // Define common assets for testing
    const ethAsset: Asset = {
      symbol: 'ETH',
      name: 'Ethereum',
      decimals: 18,
      chainId: 42161,
      isNative: true
    };
    
    const usdcAsset: Asset = {
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      address: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
      chainId: 42161
    };
    
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
    
    beforeEach(async () => {
      // Initialize and start engine for each test
      await arbitrumAdapter.initialize({});
      await arbitrumAdapter.connect();
      
      await binanceAdapter.initialize({});
      await binanceAdapter.connect();
      
      await engine.start();
    });
    
    it('should get quotes through the engine', async () => {
      // Get quote for Arbitrum assets
      const arbQuote = await engine.getQuote(ethAsset, usdcAsset, '1.0');
      expect(arbQuote.expectedOutput).toBeDefined();
      expect(arbQuote.priceImpact).toBeDefined();
      expect(arbQuote.route).toBeDefined();
      
      // Get quote for BSC assets
      const bscQuote = await engine.getQuote(bnbAsset, busdAsset, '5.0');
      expect(bscQuote.expectedOutput).toBeDefined();
      expect(bscQuote.priceImpact).toBeDefined();
      expect(bscQuote.route).toBeDefined();
    });
    
    it('should execute trades through the engine', async () => {
      // Create orders
      const arbOrder: TradeOrder = {
        id: 'test-arb-order-1',
        fromAsset: ethAsset,
        toAsset: usdcAsset,
        amount: '1.0',
        slippageTolerance: 0.5,
        timestamp: Date.now(),
        status: 'pending'
      };
      
      const bscOrder: TradeOrder = {
        id: 'test-bsc-order-1',
        fromAsset: bnbAsset,
        toAsset: busdAsset,
        amount: '5.0',
        slippageTolerance: 0.5,
        timestamp: Date.now(),
        status: 'pending'
      };
      
      // Execute trades
      const arbResult = await engine.submitOrder(arbOrder);
      expect(arbResult.success).toBe(true);
      expect(arbResult.order.status).toBe('completed');
      expect(arbResult.txHash).toBeDefined();
      
      const bscResult = await engine.submitOrder(bscOrder);
      expect(bscResult.success).toBe(true);
      expect(bscResult.order.status).toBe('completed');
      expect(bscResult.txHash).toBeDefined();
      
      // Check trade history
      const completedTrades = engine.getCompletedTrades();
      expect(completedTrades).toHaveLength(2);
      expect(completedTrades[0].order.id).toBe(arbOrder.id);
      expect(completedTrades[1].order.id).toBe(bscOrder.id);
    });
    
    it('should check balances through the engine', async () => {
      // Test address
      const testAddress = '0x123456789abcdef123456789abcdef123456789a';
      
      // Get balances
      const ethBalance = await engine.getBalance(42161, testAddress, ethAsset);
      expect(ethBalance).toBe('1.5'); // Mock value from adapter
      
      const bnbBalance = await engine.getBalance(56, testAddress, bnbAsset);
      expect(bnbBalance).toBe('5.25'); // Mock value from adapter
      
      // Token balances
      const usdcBalance = await engine.getBalance(42161, testAddress, usdcAsset);
      expect(usdcBalance).toBe('100.0'); // Mock value from adapter
      
      const busdBalance = await engine.getBalance(56, testAddress, busdAsset);
      expect(busdBalance).toBe('1250.0'); // Mock value from adapter
    });
    
    it('should handle errors properly', async () => {
      // Try to execute trade with unsupported chain
      const invalidChainAsset: Asset = {
        symbol: 'INVALID',
        name: 'Invalid Chain',
        decimals: 18,
        chainId: 999999, // Unsupported chain ID
        isNative: true
      };
      
      const invalidOrder: TradeOrder = {
        id: 'test-invalid-order',
        fromAsset: invalidChainAsset,
        toAsset: {
          ...invalidChainAsset,
          symbol: 'INVALID2',
          name: 'Invalid Token'
        },
        amount: '1.0',
        slippageTolerance: 0.5,
        timestamp: Date.now(),
        status: 'pending'
      };
      
      // This should fail but not throw
      const result = await engine.submitOrder(invalidOrder);
      expect(result.success).toBe(false);
      expect(result.order.status).toBe('failed');
      expect(result.failureReason).toContain('No adapter registered for chain ID 999999');
      
      // Check failed trades
      const failedTrades = engine.getFailedTrades();
      expect(failedTrades).toHaveLength(1);
      expect(failedTrades[0].order.id).toBe(invalidOrder.id);
    });
    
    it('should not allow cross-chain trades in the mock engine', async () => {
      // Try to execute cross-chain trade
      const crossChainOrder: TradeOrder = {
        id: 'test-cross-chain-order',
        fromAsset: ethAsset, // Arbitrum
        toAsset: busdAsset, // BSC
        amount: '1.0',
        slippageTolerance: 0.5,
        timestamp: Date.now(),
        status: 'pending'
      };
      
      // This should throw
      await expect(engine.submitOrder(crossChainOrder)).rejects.toThrow('Cross-chain trades not supported');
    });
  });
}); 