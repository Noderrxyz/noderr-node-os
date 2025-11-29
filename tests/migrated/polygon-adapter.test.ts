import { PolygonAdapter, PolygonAdapterConfig } from '../PolygonAdapter';
import { Asset } from '../IChainAdapter';

// Mock console methods to keep test output clean
beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe('PolygonAdapter', () => {
  let adapter: PolygonAdapter;
  
  beforeEach(() => {
    // Create a new adapter instance for each test
    adapter = new PolygonAdapter({
      chainId: 137,
      networkName: 'Polygon Mainnet',
      rpcUrl: 'https://polygon-rpc.com',
      isMainnet: true
    });
  });
  
  afterEach(async () => {
    // Clean up after each test
    if (adapter) {
      await adapter.shutdown();
    }
  });
  
  describe('initialization', () => {
    it('should initialize with default config', async () => {
      // Act
      await adapter.initialize({});
      
      // Assert
      const status = await adapter.getStatus();
      expect(status.name).toBe('PolygonAdapter');
      expect(status.chainId).toBe(137);
      expect(status.networkName).toBe('Polygon Mainnet');
      expect(status.isMainnet).toBe(true);
      expect(status.metadata).toBeDefined();
      expect(status.metadata?.gasStationData).toBeDefined();
    });
    
    it('should initialize with custom config', async () => {
      // Arrange
      adapter = new PolygonAdapter();
      
      // Act
      await adapter.initialize({
        chainId: 80001,
        networkName: 'Mumbai Testnet',
        rpcUrl: 'https://rpc-mumbai.maticvigil.com',
        isMainnet: false
      });
      
      // Assert
      const status = await adapter.getStatus();
      expect(status.chainId).toBe(80001);
      expect(status.networkName).toBe('Mumbai Testnet');
      expect(status.isMainnet).toBe(false);
    });
    
    it('should correct mainnet flag for Mumbai testnet', async () => {
      // Arrange - incorrectly setting isMainnet=true for Mumbai testnet
      adapter = new PolygonAdapter({
        chainId: 80001,
        isMainnet: true // Invalid combo - should be corrected
      });
      
      // Act
      await adapter.initialize({});
      
      // Assert
      const status = await adapter.getStatus();
      expect(status.chainId).toBe(80001);
      expect(status.isMainnet).toBe(false); // Should be corrected to false
    });
    
    it('should switch to testnet when isMainnet is false but chainId is mainnet', async () => {
      // Arrange
      adapter = new PolygonAdapter({
        chainId: 137, // Mainnet
        isMainnet: false // Conflict - should switch to testnet
      });
      
      // Act
      await adapter.initialize({});
      
      // Assert
      const status = await adapter.getStatus();
      expect(status.chainId).toBe(80001); // Should switch to Mumbai
      expect(status.isMainnet).toBe(false);
      expect(status.networkName).toBe('Polygon Mumbai Testnet');
    });
    
    it('should throw error when initializing with invalid config', async () => {
      // Arrange
      adapter = new PolygonAdapter();
      
      // Act & Assert
      await expect(adapter.initialize({
        chainId: 137,
        networkName: 'Polygon Mainnet',
        rpcUrl: '', // Invalid empty URL
        isMainnet: true
      })).rejects.toThrow();
    });
  });
  
  describe('connection', () => {
    beforeEach(async () => {
      await adapter.initialize({});
    });
    
    it('should connect successfully', async () => {
      // Act
      await adapter.connect();
      
      // Assert
      const status = await adapter.getStatus();
      expect(status.isConnected).toBe(true);
      expect(status.blockHeight).toBeDefined();
    });
    
    it('should disconnect successfully', async () => {
      // Arrange
      await adapter.connect();
      
      // Act
      await adapter.disconnect();
      
      // Assert
      const status = await adapter.getStatus();
      expect(status.isConnected).toBe(false);
    });
    
    it('should handle the complete lifecycle', async () => {
      // Spy on implementation methods to ensure they're called
      const initSpy = jest.spyOn(adapter as any, 'initializeImpl');
      const connectSpy = jest.spyOn(adapter as any, 'connectImpl');
      const disconnectSpy = jest.spyOn(adapter as any, 'disconnectImpl');
      const shutdownSpy = jest.spyOn(adapter as any, 'shutdownImpl');
      
      // Act - Complete lifecycle
      await adapter.connect();
      const status = await adapter.getStatus();
      await adapter.disconnect();
      await adapter.shutdown();
      
      // Assert
      expect(initSpy).toHaveBeenCalled();
      expect(connectSpy).toHaveBeenCalled();
      expect(disconnectSpy).toHaveBeenCalled();
      expect(shutdownSpy).toHaveBeenCalled();
      expect(status.name).toBe('PolygonAdapter');
      expect(status.isConnected).toBe(true);
      expect(status.gasPrice).toBeDefined();
    });
    
    it('should reject connection if not initialized', async () => {
      // Arrange
      adapter = new PolygonAdapter(); // New uninitialized adapter
      
      // Act & Assert
      await expect(adapter.connect()).rejects.toThrow(/must be initialized before connecting/);
    });
  });
  
  describe('gas price handling', () => {
    beforeEach(async () => {
      await adapter.initialize({});
      await adapter.connect();
    });
    
    it('should update gas price when getting status', async () => {
      // Spy on the updateGasPrice method
      const updateGasPriceSpy = jest.spyOn(adapter as any, 'updateGasPrice');
      
      // Act
      const status = await adapter.getStatus();
      
      // Assert
      expect(updateGasPriceSpy).toHaveBeenCalled();
      expect(status.gasPrice).toBeDefined();
      expect((adapter as any)._lastGasPrice).not.toBeNull();
      expect((adapter as any)._gasStationData).not.toBeNull();
    });
    
    it('should use cached gas price if recently updated', async () => {
      // First call to set initial values
      await adapter.getStatus();
      
      // Store the timestamp
      const initialTimestamp = (adapter as any)._lastGasUpdate;
      
      // Spy on console.log to see if update is skipped
      const updateGasPriceSpy = jest.spyOn(adapter as any, 'updateGasPrice');
      
      // Act - second call
      await adapter.getStatus();
      
      // Assert
      expect(updateGasPriceSpy).toHaveBeenCalled();
      // Timestamp should not be updated (we're using the cached value)
      expect((adapter as any)._lastGasUpdate).toBe(initialTimestamp);
    });
  });
  
  describe('operations', () => {
    beforeEach(async () => {
      await adapter.initialize({});
      await adapter.connect();
    });
    
    it('should get native MATIC balance', async () => {
      // Arrange
      const address = '0x1234567890123456789012345678901234567890';
      
      // Act
      const balance = await adapter.getBalance(address);
      
      // Assert
      expect(balance).toBe('150.5'); // Mock value from adapter
    });
    
    it('should get token balance', async () => {
      // Arrange
      const address = '0x1234567890123456789012345678901234567890';
      const asset: Asset = {
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 6,
        address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', // Polygon USDC
        chainId: 137,
        isNative: false
      };
      
      // Act
      const balance = await adapter.getBalance(address, asset);
      
      // Assert
      expect(balance).toBe('2500.0'); // Mock value for token
    });
    
    it('should get quote for MATIC to token', async () => {
      // Arrange
      const fromAsset: Asset = {
        symbol: 'MATIC',
        name: 'Polygon',
        decimals: 18,
        chainId: 137,
        isNative: true
      };
      
      const toAsset: Asset = {
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 6,
        address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
        chainId: 137,
        isNative: false
      };
      
      // Act
      const quote = await adapter.getQuote(fromAsset, toAsset, '100.0');
      
      // Assert
      expect(quote.expectedOutput).toBeDefined();
      expect(quote.priceImpact).toBeDefined();
      expect(quote.route).toContain('MATIC');
      expect(quote.route).toContain('USDC');
    });
    
    it('should get quote for token to MATIC', async () => {
      // Arrange
      const fromAsset: Asset = {
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 6,
        address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
        chainId: 137,
        isNative: false
      };
      
      const toAsset: Asset = {
        symbol: 'MATIC',
        name: 'Polygon',
        decimals: 18,
        chainId: 137,
        isNative: true
      };
      
      // Act
      const quote = await adapter.getQuote(fromAsset, toAsset, '100.0');
      
      // Assert
      expect(quote.expectedOutput).toBeDefined();
      expect(quote.priceImpact).toBeDefined();
      expect(quote.route).toContain('USDC');
      expect(quote.route).toContain('MATIC');
    });
    
    it('should get quote for token to token', async () => {
      // Arrange
      const fromAsset: Asset = {
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 6,
        address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
        chainId: 137,
        isNative: false
      };
      
      const toAsset: Asset = {
        symbol: 'WETH',
        name: 'Wrapped Ethereum',
        decimals: 18,
        address: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
        chainId: 137,
        isNative: false
      };
      
      // Act
      const quote = await adapter.getQuote(fromAsset, toAsset, '1000.0');
      
      // Assert
      expect(quote.expectedOutput).toBeDefined();
      expect(quote.priceImpact).toBeDefined();
      // For token-to-token, it should route through WMATIC
      expect(quote.route).toContain('USDC');
      expect(quote.route).toContain('WMATIC');
      expect(quote.route).toContain('WETH');
    });
    
    it('should execute trade', async () => {
      // Arrange
      const order = {
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
        status: 'pending' as const
      };
      
      // Spy on updateGasPrice to ensure it's called before executing trade
      const updateGasPriceSpy = jest.spyOn(adapter as any, 'updateGasPrice');
      
      // Act
      const result = await adapter.executeTrade(order);
      
      // Assert
      expect(updateGasPriceSpy).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.txHash).toBeDefined();
      expect(result.order.status).toBe('completed');
      expect(result.executionPrice).toBe('0.75');
      expect(result.amountOut).toBe('750.0');
      expect(result.fees).toBeDefined();
      if (result.fees) {
        expect(result.fees.networkFee).toBe('0.002');
        expect(result.fees.protocolFee).toBe('0.0005');
      }
    });
    
    it('should check transaction status', async () => {
      // Arrange
      const txHash = '0x' + Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('');
      
      // Act
      const status = await adapter.getTransactionStatus(txHash);
      
      // Assert
      expect(status.status).toBe('confirmed');
      expect(status.confirmations).toBe(15);
      expect(status.receipt).toBeDefined();
      expect(status.receipt.blockNumber).toBeDefined();
      expect(status.receipt.status).toBe(1); // Success
    });
  });
  
  describe('error handling', () => {
    beforeEach(async () => {
      await adapter.initialize({});
    });
    
    it('should handle gas price update failures gracefully', async () => {
      // Mock a failure in updateGasPrice
      jest.spyOn(adapter as any, 'updateGasPrice').mockImplementationOnce(async () => {
        throw new Error('Network error');
      });
      
      // Even with the failure, getStatus should complete
      const status = await adapter.getStatus();
      
      // Status should still be returned
      expect(status).toBeDefined();
      expect(status.name).toBe('PolygonAdapter');
    });
    
    it('should not fail on disconnect if not connected', async () => {
      // Don't call connect()
      await expect(adapter.disconnect()).resolves.not.toThrow();
    });
  });
}); 