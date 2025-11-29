import { AdapterRegistry, AdapterRegistryConfig } from '../AdapterRegistry';
import { 
  IChainAdapter, 
  Asset, 
  TradeOrder, 
  TradeResult,
  ChainAdapterStatus 
} from '@noderr/IChainAdapter';

// Mock implementation of IChainAdapter for testing
class MockAdapter implements IChainAdapter {
  private config: any;
  private initialized: boolean = false;
  private connected: boolean = false;
  private failNextOperation: boolean = false;
  private simulateTimeout: boolean = false;
  private operationLatency: number = 10; // milliseconds
  private failureCount: number = 0;
  private chainId: number;
  private isMainnet: boolean;
  private blockHeight: number = 1000000;
  private gasPrice: string = '50 gwei';

  constructor(chainId: number, isMainnet: boolean = true) {
    this.chainId = chainId;
    this.isMainnet = isMainnet;
  }

  // Control behavior of the mock adapter
  public setFailNextOperation(fail: boolean): void {
    this.failNextOperation = fail;
  }

  public setSimulateTimeout(timeout: boolean): void {
    this.simulateTimeout = timeout;
  }

  public setOperationLatency(latencyMs: number): void {
    this.operationLatency = latencyMs;
  }

  public getFailureCount(): number {
    return this.failureCount;
  }

  public setBlockHeight(height: number): void {
    this.blockHeight = height;
  }

  public setGasPrice(price: string): void {
    this.gasPrice = price;
  }

  // IChainAdapter implementation
  public async initialize(config: any): Promise<void> {
    await this.simulateOperation('initialize');
    this.config = config;
    this.initialized = true;
  }

  public async connect(): Promise<void> {
    await this.simulateOperation('connect');
    this.connected = true;
  }

  public async disconnect(): Promise<void> {
    await this.simulateOperation('disconnect');
    this.connected = false;
  }

  public async shutdown(): Promise<void> {
    await this.simulateOperation('shutdown');
    this.initialized = false;
    this.connected = false;
  }

  public async getStatus(): Promise<ChainAdapterStatus> {
    await this.simulateOperation('getStatus');
    return {
      isConnected: this.connected,
      name: `MockAdapter-${this.chainId}`,
      version: '1.0.0',
      chainId: this.chainId,
      networkName: this.isMainnet ? 'Mainnet' : 'Testnet',
      isMainnet: this.isMainnet,
      blockHeight: this.blockHeight,
      gasPrice: this.gasPrice,
      lastSyncTimestamp: Date.now()
    };
  }

  public async getBalance(address: string, asset?: Asset): Promise<string> {
    await this.simulateOperation('getBalance');
    return '100.0';
  }

  public async executeTrade(order: TradeOrder): Promise<TradeResult> {
    await this.simulateOperation('executeTrade');
    const txHash = '0x' + Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('');
    
    return {
      success: true,
      order: {
        ...order,
        status: 'completed',
        txHash
      },
      txHash,
      executionPrice: '100.0',
      amountOut: '100.0',
      fees: {
        networkFee: '0.01',
        protocolFee: '0.005'
      },
      timestamp: Date.now()
    };
  }

  public async getQuote(fromAsset: Asset, toAsset: Asset, amount: string): Promise<{
    expectedOutput: string;
    priceImpact: number;
    route?: string[];
  }> {
    await this.simulateOperation('getQuote');
    return {
      expectedOutput: '100.0',
      priceImpact: 0.1,
      route: ['direct']
    };
  }

  public async getTransactionStatus(txHash: string): Promise<{
    status: 'pending' | 'confirmed' | 'failed';
    confirmations?: number;
    receipt?: any;
  }> {
    await this.simulateOperation('getTransactionStatus');
    return {
      status: 'confirmed',
      confirmations: 10,
      receipt: { blockNumber: this.blockHeight }
    };
  }

  // Helper to simulate operations with controlled behavior
  private async simulateOperation(operation: string): Promise<void> {
    if (this.simulateTimeout) {
      return new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error('Operation timed out'));
        }, 5000); // Long timeout to simulate hanging
      });
    }

    // Simulate operation latency
    await new Promise(resolve => setTimeout(resolve, this.operationLatency));

    if (this.failNextOperation) {
      this.failNextOperation = false; // Reset for next operation
      this.failureCount++;
      throw new Error(`Mock ${operation} operation failed`);
    }
  }
}

// Mock console methods to keep test output clean
beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe('AdapterRegistry', () => {
  // Default test config with shorter timeouts for faster tests
  const testConfig: AdapterRegistryConfig = {
    retryBaseDelayMs: 10,
    retryMaxDelayMs: 100,
    maxRetries: 3,
    circuitBreakerThreshold: 3,
    circuitBreakerResetTimeoutMs: 100,
    logger: jest.fn()
  };

  let registry: AdapterRegistry;
  let adapter1: MockAdapter;
  let adapter2: MockAdapter;

  beforeEach(() => {
    // Create fresh instances for each test
    registry = new AdapterRegistry(testConfig);
    adapter1 = new MockAdapter(1, true); // Ethereum Mainnet (chainId: 1)
    adapter2 = new MockAdapter(137, true); // Polygon Mainnet (chainId: 137)

    // Register adapters
    registry.registerAdapter(1, adapter1);
    registry.registerAdapter(137, adapter2);
  });

  afterEach(async () => {
    // Clean up
    await registry.shutdown();
  });

  describe('Basic Functionality', () => {
    it('should register adapters correctly', () => {
      expect(registry.supportsChain(1)).toBe(true);
      expect(registry.supportsChain(137)).toBe(true);
      expect(registry.supportsChain(999)).toBe(false);
      expect(registry.getSupportedChains()).toContain(1);
      expect(registry.getSupportedChains()).toContain(137);
      expect(registry.getSupportedChains().length).toBe(2);
    });

    it('should initialize all adapters', async () => {
      await registry.initialize();
      
      const status = await registry.getStatus();
      expect(status.adapters[1].status?.isConnected).toBe(true);
      expect(status.adapters[137].status?.isConnected).toBe(true);
      expect(status.allConnected).toBe(true);
      expect(status.health).toBe('healthy');
    });

    it('should get adapter by chain ID', () => {
      const ethAdapter = registry.getAdapter(1);
      const polygonAdapter = registry.getAdapter(137);
      const nonexistentAdapter = registry.getAdapter(999);
      
      expect(ethAdapter).toBe(adapter1);
      expect(polygonAdapter).toBe(adapter2);
      expect(nonexistentAdapter).toBeUndefined();
    });

    it('should return registry status with all adapters', async () => {
      await registry.initialize();
      
      const status = await registry.getStatus();
      expect(status.adapterCount).toBe(2);
      expect(status.supportedChains).toEqual(expect.arrayContaining([1, 137]));
      expect(status.adapters[1].status?.chainId).toBe(1);
      expect(status.adapters[137].status?.chainId).toBe(137);
      expect(status.adapters[1].status?.isConnected).toBe(true);
      expect(status.health).toBe('healthy');
    });
  });

  describe('Retry Mechanism', () => {
    it('should retry failed operations up to maxRetries', async () => {
      await registry.initialize();
      
      // Set adapter to fail the next operation
      adapter1.setFailNextOperation(true);
      
      // Execute operation that will fail and be retried
      await expect(registry.getBalance(1, '0x123')).resolves.toBe('100.0');
      
      // Adapter's fail flag should be reset, and the operation should succeed on retry
      expect(adapter1.getFailureCount()).toBe(1);
    });

    it('should fail after exhausting all retries', async () => {
      await registry.initialize();
      
      // Set adapter to always fail
      jest.spyOn(adapter1, 'getBalance').mockImplementation(async () => {
        throw new Error('Persistent failure');
      });
      
      // This should fail after maxRetries (3) attempts
      await expect(registry.getBalance(1, '0x123')).rejects.toThrow('Persistent failure');
      
      // Check that the mock logger was called for each retry
      expect(testConfig.logger).toHaveBeenCalledTimes(3 + 1); // 3 retries + 1 initial
    });

    it('should use exponential backoff when retrying', async () => {
      await registry.initialize();
      
      // Mock setTimeout to track delays
      const originalSetTimeout = global.setTimeout;
      const mockedSetTimeout = jest.fn();
      global.setTimeout = mockedSetTimeout as unknown as typeof setTimeout;
      
      try {
        // Make adapter always fail
        jest.spyOn(adapter1, 'getBalance').mockImplementation(async () => {
          throw new Error('Always fail');
        });
        
        // This will fail after all retries
        await expect(registry.getBalance(1, '0x123')).rejects.toThrow();
        
        // Check that setTimeout was called with exponential backoff delays
        expect(mockedSetTimeout.mock.calls.length).toBeGreaterThanOrEqual(3);
        
        // First retry should use base delay
        expect(mockedSetTimeout.mock.calls[0][1]).toBe(testConfig.retryBaseDelayMs);
        
        // Second retry should use 2x the base delay
        expect(mockedSetTimeout.mock.calls[1][1]).toBe(testConfig.retryBaseDelayMs! * 2);
        
        // Third retry should use 4x the base delay (but capped at max)
        const expectedThirdDelay = Math.min(
          testConfig.retryBaseDelayMs! * 4, 
          testConfig.retryMaxDelayMs!
        );
        expect(mockedSetTimeout.mock.calls[2][1]).toBe(expectedThirdDelay);
      } finally {
        // Restore original setTimeout
        global.setTimeout = originalSetTimeout;
      }
    });
  });

  describe('Circuit Breaker', () => {
    it('should open circuit breaker after threshold failures', async () => {
      await registry.initialize();
      
      // Set adapter to always fail
      jest.spyOn(adapter1, 'getBalance').mockImplementation(async () => {
        throw new Error('Persistent failure');
      });
      
      // Execute operations that will fail until circuit opens
      for (let i = 0; i < testConfig.circuitBreakerThreshold!; i++) {
        try {
          await registry.getBalance(1, '0x123');
        } catch (error) {
          // Expected failures
        }
      }
      
      // Next operation should fail with circuit breaker error
      await expect(registry.getBalance(1, '0x123')).rejects.toThrow('Circuit breaker open');
      
      // Check registry status reflects open circuit
      const status = await registry.getStatus();
      expect(status.adapters[1].circuitOpen).toBe(true);
      expect(status.health).toBe('degraded');
    });

    it('should reset circuit breaker after timeout', async () => {
      await registry.initialize();
      
      // Set adapter to always fail
      jest.spyOn(adapter1, 'getBalance').mockImplementation(async () => {
        throw new Error('Persistent failure');
      });
      
      // Force circuit breaker to open
      for (let i = 0; i < testConfig.circuitBreakerThreshold!; i++) {
        try {
          await registry.getBalance(1, '0x123');
        } catch (error) {
          // Expected failures
        }
      }
      
      // Verify circuit is open
      await expect(registry.getBalance(1, '0x123')).rejects.toThrow('Circuit breaker open');
      
      // Wait for circuit breaker to reset
      await new Promise(resolve => setTimeout(resolve, testConfig.circuitBreakerResetTimeoutMs! + 50));
      
      // Fix the adapter
      jest.spyOn(adapter1, 'getBalance').mockRestore();
      
      // Circuit should be closed now, allowing operations
      await expect(registry.getBalance(1, '0x123')).resolves.toBe('100.0');
      
      // Check registry status
      const status = await registry.getStatus();
      expect(status.adapters[1].circuitOpen).toBe(false);
      expect(status.health).toBe('healthy');
    });
  });

  describe('Performance Metrics', () => {
    it('should collect operation metrics', async () => {
      await registry.initialize();
      
      // Execute various operations
      await registry.getBalance(1, '0x123');
      await registry.getQuote(
        { chainId: 1, symbol: 'ETH', name: 'Ethereum', decimals: 18, isNative: true }, 
        { chainId: 1, symbol: 'USDC', name: 'USD Coin', decimals: 6, address: '0x123', isNative: false },
        '1.0'
      );
      
      // Get metrics
      const metrics = registry.getMetrics();
      
      // Check metrics for chain 1
      expect(metrics[1]).toBeDefined();
      expect(metrics[1].averageLatencyMs).toBeGreaterThanOrEqual(0);
      expect(metrics[1].successRate).toBe(100);
      expect(metrics[1].callVolume).toBeGreaterThanOrEqual(2);
      expect(metrics[1].circuitBreakerStatus).toBe('closed');
    });

    it('should track success and failure rates correctly', async () => {
      await registry.initialize();
      
      // Execute successful operations
      await registry.getBalance(1, '0x123');
      await registry.getBalance(1, '0x123');
      
      // Execute failed operation
      adapter1.setFailNextOperation(true);
      try {
        await registry.getBalance(1, '0x123');
      } catch (error) {
        // Expected failure
      }
      
      // Get metrics
      const metrics = registry.getMetrics();
      
      // 2 successes, 1 failure = 66.7% success rate
      expect(metrics[1].successRate).toBeCloseTo(66.7, 0);
      expect(metrics[1].callVolume).toBe(3);
    });

    it('should measure operation latency', async () => {
      await registry.initialize();
      
      // Set a specific latency
      adapter1.setOperationLatency(50);
      
      // Execute operation
      await registry.getBalance(1, '0x123');
      
      // Get metrics
      const metrics = registry.getMetrics();
      
      // Latency should be approximately the set value (allowing some overhead)
      expect(metrics[1].averageLatencyMs).toBeGreaterThanOrEqual(45);
    });
  });

  describe('Health Checks', () => {
    // Mock the setInterval/clearInterval functions
    let realSetInterval: typeof setInterval;
    let realClearInterval: typeof clearInterval;
    let mockSetInterval: jest.Mock;
    let mockClearInterval: jest.Mock;
    
    beforeEach(() => {
      realSetInterval = global.setInterval;
      realClearInterval = global.clearInterval;
      
      mockSetInterval = jest.fn().mockReturnValue(123);
      mockClearInterval = jest.fn();
      
      global.setInterval = mockSetInterval as unknown as typeof setInterval;
      global.clearInterval = mockClearInterval as unknown as typeof clearInterval;
    });
    
    afterEach(() => {
      global.setInterval = realSetInterval;
      global.clearInterval = realClearInterval;
    });
    
    it('should set up periodic health checks on constructor', () => {
      new AdapterRegistry(testConfig);
      
      // Check that setInterval was called with correct parameters
      expect(mockSetInterval).toHaveBeenCalledTimes(1);
      expect(mockSetInterval.mock.calls[0][1]).toBe(60000); // 1 minute
    });
    
    it('should attempt to reconnect disconnected adapters', async () => {
      await registry.initialize();
      
      // Disconnect adapter
      await adapter1.disconnect();
      
      // Mock the adapter's connect method
      const connectSpy = jest.spyOn(adapter1, 'connect');
      
      // Manually trigger health check
      await (registry as any).runHealthCheck();
      
      // Connect should have been called
      expect(connectSpy).toHaveBeenCalledTimes(1);
    });
    
    it('should clean up health check interval on shutdown', async () => {
      const reg = new AdapterRegistry(testConfig);
      await reg.initialize();
      
      // Shutdown registry
      await reg.shutdown();
      
      // clearInterval should have been called
      expect(mockClearInterval).toHaveBeenCalledTimes(1);
    });
  });

  describe('Cross-Chain Operations', () => {
    it('should detect cross-chain operations in getQuote', async () => {
      await registry.initialize();
      
      // Cross-chain quote request (Ethereum -> Polygon)
      const quote = await registry.getQuote(
        { chainId: 1, symbol: 'ETH', name: 'Ethereum', decimals: 18, isNative: true },
        { chainId: 137, symbol: 'MATIC', name: 'Polygon', decimals: 18, isNative: true },
        '1.0'
      );
      
      // Should report as cross-chain
      expect(quote.crossChain).toBe(true);
      expect(quote.route?.length).toBeGreaterThan(1);
      
      // Should include chain ids in the route
      expect(quote.route?.join()).toContain('1');
      expect(quote.route?.join()).toContain('137');
    });
    
    it('should handle same-chain quotes correctly', async () => {
      await registry.initialize();
      
      // Same-chain quote request
      const quote = await registry.getQuote(
        { chainId: 1, symbol: 'ETH', name: 'Ethereum', decimals: 18, isNative: true },
        { chainId: 1, symbol: 'USDC', name: 'USD Coin', decimals: 6, address: '0x123', isNative: false },
        '1.0'
      );
      
      // Should not be marked as cross-chain
      expect(quote.crossChain).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should reject operations for unsupported chains', async () => {
      await registry.initialize();
      
      // Try to operate on an unsupported chain
      await expect(registry.getBalance(999, '0x123')).rejects.toThrow(/No adapter registered/);
    });
    
    it('should propagate specific error messages from adapters', async () => {
      await registry.initialize();
      
      // Make adapter throw a specific error
      jest.spyOn(adapter1, 'getBalance').mockImplementation(async () => {
        throw new Error('Insufficient funds');
      });
      
      // The specific error should be propagated
      await expect(registry.getBalance(1, '0x123')).rejects.toThrow('Insufficient funds');
    });
    
    it('should handle adapter disconnection gracefully', async () => {
      await registry.initialize();
      
      // Disconnect adapter
      await adapter1.disconnect();
      
      // Get registry status
      const status = await registry.getStatus();
      
      // Registry should report adapter as disconnected but still be functional
      expect(status.adapters[1].status?.isConnected).toBe(false);
      expect(status.allConnected).toBe(false);
      expect(status.health).toBe('degraded');
      
      // Operations should still work on the connected adapter
      await expect(registry.getBalance(137, '0x123')).resolves.toBe('100.0');
    });
  });
}); 