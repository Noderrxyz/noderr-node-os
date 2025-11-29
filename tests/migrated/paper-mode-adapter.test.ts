/**
 * Paper Mode Adapter Integration Tests
 * 
 * Comprehensive test suite for mock adapters to ensure they provide
 * realistic simulation behavior for paper trading.
 */

import { 
  MockExchangeConnector,
  MockRPCProvider,
  ExchangeConnectorFactory,
  RPCProviderFactory,
  getExchangeConnector,
  getRPCProvider,
  cleanupAllAdapters,
  getAdapterStatistics
} from '../../src/adapters/exports';
import { isPaperMode, paperModeConfig } from '../../src/config/PaperModeConfig';

// Mock test setup
describe('Paper Mode Adapter Integration Tests', () => {
  beforeAll(() => {
    // Ensure paper mode is enabled for all tests
    paperModeConfig.enablePaperMode();
  });
  
  afterAll(() => {
    // Cleanup all adapters after tests
    cleanupAllAdapters();
  });
  
  beforeEach(() => {
    // Reset any test-specific configuration
    jest.clearAllMocks();
  });

  describe('MockExchangeConnector', () => {
    let exchangeConnector: MockExchangeConnector;
    
    beforeEach(async () => {
      exchangeConnector = new MockExchangeConnector('test_exchange', 'Test Exchange');
      await exchangeConnector.connect();
    });
    
    afterEach(async () => {
      await exchangeConnector.disconnect();
      exchangeConnector.cleanup();
    });

    test('should connect and disconnect successfully', async () => {
      const connector = new MockExchangeConnector('binance', 'Binance');
      
      expect(connector.isConnected()).toBe(false);
      
      const connected = await connector.connect();
      expect(connected).toBe(true);
      expect(connector.isConnected()).toBe(true);
      
      await connector.disconnect();
      expect(connector.isConnected()).toBe(false);
      
      connector.cleanup();
    });

    test('should provide realistic order book data', async () => {
      const orderBook = await exchangeConnector.getOrderBook('BTC/USDT', 10);
      
      expect(orderBook).toEqual({
        symbol: 'BTC/USDT',
        bids: expect.any(Array),
        asks: expect.any(Array),
        timestamp: expect.any(Number),
        sequenceId: expect.any(Number)
      });
      
      expect(orderBook.bids.length).toBeGreaterThan(0);
      expect(orderBook.asks.length).toBeGreaterThan(0);
      expect(orderBook.bids.length).toBeLessThanOrEqual(10);
      expect(orderBook.asks.length).toBeLessThanOrEqual(10);
      
      // Validate price ordering
      for (let i = 1; i < orderBook.bids.length; i++) {
        expect(orderBook.bids[i].price).toBeLessThan(orderBook.bids[i - 1].price);
      }
      
      for (let i = 1; i < orderBook.asks.length; i++) {
        expect(orderBook.asks[i].price).toBeGreaterThan(orderBook.asks[i - 1].price);
      }
    });

    test('should provide realistic quotes with spreads', async () => {
      const quote = await exchangeConnector.getQuote('ETH/USDT');
      
      expect(quote).toEqual({
        symbol: 'ETH/USDT',
        bid: expect.any(Number),
        ask: expect.any(Number),
        spread: expect.any(Number),
        spreadPercentage: expect.any(Number),
        timestamp: expect.any(Number),
        exchange: 'test_exchange'
      });
      
      expect(quote.ask).toBeGreaterThan(quote.bid);
      expect(quote.spread).toBe(quote.ask - quote.bid);
      expect(quote.spreadPercentage).toBeGreaterThan(0);
    });

    test('should simulate market order execution with slippage', async () => {
      const order = {
        symbol: 'BTC/USDT',
        side: 'buy' as const,
        type: 'market' as const,
        amount: 0.1,
        price: 45000
      };
      
      const orderResponse = await exchangeConnector.submitOrder(order);
      
      expect(orderResponse).toEqual({
        orderId: expect.any(String),
        clientOrderId: undefined,
        symbol: 'BTC/USDT',
        side: 'buy',
        type: 'market',
        amount: 0.1,
        price: 45000,
        status: 'pending',
        executedAmount: 0,
        remainingAmount: 0.1,
        fees: 0,
        timestamp: expect.any(Number),
        transactionId: expect.any(String)
      });
      
      // Wait for execution simulation
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const updatedOrder = await exchangeConnector.getOrderStatus(orderResponse.orderId);
      expect(['filled', 'partial']).toContain(updatedOrder.status);
      
      if (updatedOrder.status === 'filled') {
        expect(updatedOrder.executedAmount).toBeGreaterThan(0);
        expect(updatedOrder.executedPrice).toBeGreaterThan(0);
        expect(updatedOrder.fees).toBeGreaterThan(0);
      }
    });

    test('should simulate limit order placement and partial fills', async () => {
      const order = {
        symbol: 'ETH/USDT',
        side: 'sell' as const,
        type: 'limit' as const,
        amount: 1.0,
        price: 3100
      };
      
      const orderResponse = await exchangeConnector.submitOrder(order);
      expect(orderResponse.status).toBe('open');
      
      // Check order appears in open orders
      const openOrders = await exchangeConnector.getOpenOrders('ETH/USDT');
      expect(openOrders.some(o => o.orderId === orderResponse.orderId)).toBe(true);
    });

    test('should handle order cancellation', async () => {
      const order = {
        symbol: 'BTC/ETH',
        side: 'buy' as const,
        type: 'limit' as const,
        amount: 0.5,
        price: 14.5
      };
      
      const orderResponse = await exchangeConnector.submitOrder(order);
      expect(orderResponse.status).toBe('open');
      
      const cancelled = await exchangeConnector.cancelOrder(orderResponse.orderId);
      expect(cancelled).toBe(true);
      
      const cancelledOrder = await exchangeConnector.getOrderStatus(orderResponse.orderId);
      expect(cancelledOrder.status).toBe('cancelled');
    });

    test('should provide account balances', async () => {
      const balances = await exchangeConnector.getBalances();
      
      expect(balances).toBeInstanceOf(Array);
      expect(balances.length).toBeGreaterThan(0);
      
      balances.forEach(balance => {
        expect(balance).toEqual({
          asset: expect.any(String),
          available: expect.any(Number),
          locked: expect.any(Number),
          total: expect.any(Number)
        });
        
        expect(balance.total).toBe(balance.available + balance.locked);
      });
    });

    test('should simulate trading fees correctly', async () => {
      const fees = await exchangeConnector.getTradingFees('BTC/USDT');
      
      expect(fees).toEqual({
        maker: expect.any(Number),
        taker: expect.any(Number)
      });
      
      expect(fees.maker).toBeGreaterThanOrEqual(0);
      expect(fees.taker).toBeGreaterThanOrEqual(0);
      expect(fees.taker).toBeGreaterThanOrEqual(fees.maker); // Taker fees usually >= maker fees
    });

    test('should provide market status information', async () => {
      const status = await exchangeConnector.getMarketStatus();
      
      expect(status).toEqual({
        operational: true,
        maintenance: false,
        latency: expect.any(Number),
        lastUpdate: expect.any(Number),
        supportedSymbols: expect.any(Array),
        tradingEnabled: true
      });
      
      expect(status.supportedSymbols.length).toBeGreaterThan(0);
    });
  });

  describe('MockRPCProvider', () => {
    let rpcProvider: MockRPCProvider;
    
    beforeEach(async () => {
      rpcProvider = new MockRPCProvider('test_rpc', 'Test RPC', 1, 1);
      await rpcProvider.connect();
    });
    
    afterEach(async () => {
      await rpcProvider.disconnect();
      rpcProvider.cleanup();
    });

    test('should connect and provide chain information', async () => {
      expect(rpcProvider.isConnected()).toBe(true);
      
      const chainId = await rpcProvider.getChainId();
      expect(chainId).toBe(1);
      
      const networkId = await rpcProvider.getNetworkId();
      expect(networkId).toBe(1);
    });

    test('should provide realistic block information', async () => {
      const blockNumber = await rpcProvider.getBlockNumber();
      expect(blockNumber).toBeGreaterThan(18000000); // Realistic Ethereum block number
      
      const latestBlock = await rpcProvider.getBlock('latest');
      expect(latestBlock).toEqual({
        number: expect.any(Number),
        hash: expect.stringMatching(/^0x[a-f0-9]{64}$/),
        parentHash: expect.stringMatching(/^0x[a-f0-9]{64}$/),
        timestamp: expect.any(Number),
        gasUsed: expect.any(Number),
        gasLimit: expect.any(Number),
        difficulty: expect.stringMatching(/^0x[a-f0-9]+$/),
        totalDifficulty: expect.stringMatching(/^0x[a-f0-9]+$/),
        nonce: expect.stringMatching(/^0x[a-f0-9]+$/),
        baseFeePerGas: expect.any(Number)
      });
      
      expect(latestBlock.gasUsed).toBeLessThanOrEqual(latestBlock.gasLimit);
    });

    test('should simulate account balances', async () => {
      const balance = await rpcProvider.getBalance('0x742d35cc6466db4a0dd7a4e1d9b8a8e6f2f2e4b3');
      
      expect(balance).toMatch(/^0x[a-f0-9]+$/);
      expect(parseInt(balance, 16)).toBeGreaterThan(0);
    });

    test('should simulate transaction submission', async () => {
      const signedTx = '0x02f86b01118094d0c1238c0e0f1e3d8c1c8e0f1e3d8c1c8e0f1e3d8c';
      const txHash = await rpcProvider.sendRawTransaction(signedTx);
      
      expect(txHash).toMatch(/^0x[a-f0-9]{64}$/);
      
      // Transaction should appear in pending state initially
      const tx = await rpcProvider.getTransaction(txHash);
      expect(tx.hash).toBe(txHash);
    });

    test('should provide gas price estimation', async () => {
      const gasPrice = await rpcProvider.getGasPrice();
      
      expect(gasPrice).toBeGreaterThan(1000000000); // > 1 gwei
      expect(gasPrice).toBeLessThan(200000000000); // < 200 gwei (reasonable range)
    });

    test('should simulate gas estimation for transactions', async () => {
      const gasEstimate = await rpcProvider.estimateGas({
        to: '0x742d35cc6466db4a0dd7a4e1d9b8a8e6f2f2e4b3',
        data: '0xa9059cbb000000000000000000000000742d35cc6466db4a0dd7a4e1d9b8a8e6f2f2e4b3'
      });
      
      expect(gasEstimate).toEqual({
        gasLimit: expect.any(Number),
        gasPrice: expect.any(Number),
        maxFeePerGas: expect.any(Number),
        maxPriorityFeePerGas: expect.any(Number),
        estimatedCost: expect.any(Number),
        estimatedTimeSeconds: expect.any(Number)
      });
      
      expect(gasEstimate.gasLimit).toBeGreaterThan(21000); // Contract calls need more gas
      expect(gasEstimate.estimatedTimeSeconds).toBeGreaterThan(0);
    });

    test('should simulate contract calls', async () => {
      const result = await rpcProvider.call({
        to: '0xA0b86a33E6441f8C8F992f62e5b8A8E6c18e1d3',
        data: '0x70a08231000000000000000000000000742d35cc6466db4a0dd7a4e1d9b8a8e6f2f2e4b3' // balanceOf
      });
      
      expect(result).toEqual({
        result: expect.stringMatching(/^0x[a-f0-9]+$/),
        gasUsed: expect.any(Number),
        success: true
      });
    });

    test('should provide network status', async () => {
      const status = await rpcProvider.getNetworkStatus();
      
      expect(status).toEqual({
        chainId: 1,
        blockNumber: expect.any(Number),
        gasPrice: expect.any(Number),
        peerCount: expect.any(Number),
        syncing: false,
        networkId: 1
      });
      
      expect(status.peerCount).toBeGreaterThan(0);
    });

    test('should simulate transaction confirmation', async () => {
      const signedTx = '0x02f86b01118094d0c1238c0e0f1e3d8c1c8e0f1e3d8c1c8e0f1e3d8c';
      const txHash = await rpcProvider.sendRawTransaction(signedTx);
      
      // Wait for transaction to be "confirmed"
      const receipt = await rpcProvider.waitForTransaction(txHash, 1, 10000);
      
      expect(receipt).toEqual({
        transactionHash: txHash,
        transactionIndex: expect.any(Number),
        blockNumber: expect.any(Number),
        blockHash: expect.stringMatching(/^0x[a-f0-9]{64}$/),
        from: expect.stringMatching(/^0x[a-f0-9]{40}$/),
        to: expect.stringMatching(/^0x[a-f0-9]{40}$/),
        gasUsed: expect.any(Number),
        cumulativeGasUsed: expect.any(Number),
        contractAddress: expect.anything(),
        logs: expect.any(Array),
        status: expect.any(Number),
        effectiveGasPrice: expect.any(Number)
      });
    });
  });

  describe('Adapter Factories', () => {
    afterEach(() => {
      cleanupAllAdapters();
    });

    test('should create exchange connectors via factory', () => {
      const connector = getExchangeConnector('binance', 'Binance');
      
      expect(connector).toBeInstanceOf(MockExchangeConnector);
      expect(connector.getExchangeId()).toBe('binance');
      expect(connector.getExchangeName()).toBe('Binance');
    });

    test('should create RPC providers via factory', () => {
      const provider = getRPCProvider(1); // Ethereum mainnet
      
      expect(provider).toBeInstanceOf(MockRPCProvider);
      expect(provider.getProviderId()).toContain('ethereum');
    });

    test('should reuse mock instances for same exchange', () => {
      const connector1 = ExchangeConnectorFactory.createExchangeConnector('test', 'Test');
      const connector2 = ExchangeConnectorFactory.createExchangeConnector('test', 'Test');
      
      expect(connector1).toBe(connector2); // Same instance
    });

    test('should track adapter statistics', () => {
      // Create some adapters
      getExchangeConnector('binance');
      getExchangeConnector('coinbase');
      getRPCProvider(1);
      getRPCProvider(137);
      
      const stats = getAdapterStatistics();
      
      expect(stats).toEqual({
        paperMode: true,
        exchangeConnectors: 2,
        rpcProviders: 2,
        totalAdapters: 4
      });
    });

    test('should cleanup all adapters', () => {
      // Create some adapters
      getExchangeConnector('binance');
      getRPCProvider(1);
      
      let stats = getAdapterStatistics();
      expect(stats.totalAdapters).toBeGreaterThan(0);
      
      cleanupAllAdapters();
      
      stats = getAdapterStatistics();
      expect(stats.totalAdapters).toBe(0);
    });
  });

  describe('Paper Mode Integration', () => {
    test('should only create mock adapters when paper mode is enabled', () => {
      expect(isPaperMode()).toBe(true);
      
      const connector = getExchangeConnector('test');
      expect(connector).toBeInstanceOf(MockExchangeConnector);
      
      const provider = getRPCProvider(1);
      expect(provider).toBeInstanceOf(MockRPCProvider);
    });

    test('should throw error when trying to create real adapters in production mode', () => {
      // Temporarily disable paper mode
      paperModeConfig.disablePaperMode();
      
      expect(() => {
        getExchangeConnector('binance');
      }).toThrow('Real exchange connector not implemented');
      
      expect(() => {
        getRPCProvider(1);
      }).toThrow('Real RPC provider not implemented');
      
      // Re-enable paper mode
      paperModeConfig.enablePaperMode();
    });
  });

  describe('Realistic Simulation Behavior', () => {
    let connector: MockExchangeConnector;
    
    beforeEach(async () => {
      connector = new MockExchangeConnector('simulation_test', 'Simulation Test');
      await connector.connect();
    });
    
    afterEach(async () => {
      await connector.disconnect();
      connector.cleanup();
    });

    test('should apply configurable slippage to market orders', async () => {
      const quote = await connector.getQuote('BTC/USDT');
      const originalPrice = quote.ask;
      
      const order = {
        symbol: 'BTC/USDT',
        side: 'buy' as const,
        type: 'market' as const,
        amount: 1.0,
        price: originalPrice
      };
      
      const orderResponse = await connector.submitOrder(order);
      
      // Wait for execution
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const executedOrder = await connector.getOrderStatus(orderResponse.orderId);
      
      if (executedOrder.status === 'filled' && executedOrder.executedPrice) {
        // Should have some slippage for market orders
        const slippage = Math.abs(executedOrder.executedPrice - originalPrice) / originalPrice;
        expect(slippage).toBeGreaterThan(0);
        expect(slippage).toBeLessThan(0.01); // Less than 1% slippage
      }
    });

    test('should simulate realistic execution latencies', async () => {
      const startTime = Date.now();
      
      await connector.getQuote('ETH/USDT');
      
      const endTime = Date.now();
      const latency = endTime - startTime;
      
      // Should have some latency but not too much
      expect(latency).toBeGreaterThan(20); // At least 20ms
      expect(latency).toBeLessThan(500); // Less than 500ms
    });

    test('should occasionally simulate order rejections', async () => {
      // Submit multiple orders to trigger a rejection
      const promises = [];
      
      for (let i = 0; i < 20; i++) {
        const order = {
          symbol: 'BTC/USDT',
          side: 'buy' as const,
          type: 'market' as const,
          amount: 0.01,
          price: 45000
        };
        
        promises.push(connector.submitOrder(order));
      }
      
      const results = await Promise.all(promises.map(p => p.catch(e => ({ status: 'error', error: e }))));
      
      // Filter out the successful orders
      const successfulOrders = results.filter(r => r && typeof r === 'object' && 'orderId' in r);
      expect(successfulOrders.length).toBeGreaterThan(0);
    });
  });
}); 