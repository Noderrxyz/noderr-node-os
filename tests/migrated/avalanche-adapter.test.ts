import { AvalancheAdapter, AvalancheAdapterConfig } from '../AvalancheAdapter';
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

describe('AvalancheAdapter', () => {
  let adapter: AvalancheAdapter;
  
  beforeEach(() => {
    // Create a new adapter instance for each test
    adapter = new AvalancheAdapter({
      chainId: 43114,
      networkName: 'Avalanche C-Chain',
      rpcUrl: 'https://api.avax.network/ext/bc/C/rpc',
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
      expect(status.name).toBe('AvalancheAdapter');
      expect(status.chainId).toBe(43114);
      expect(status.networkName).toBe('Avalanche C-Chain');
      expect(status.isMainnet).toBe(true);
      expect(status.metadata).toBeDefined();
      expect(status.metadata?.gasStationData).toBeDefined();
    });
    
    it('should initialize with custom config', async () => {
      // Arrange
      adapter = new AvalancheAdapter();
      
      // Act
      await adapter.initialize({
        chainId: 43113,
        networkName: 'Avalanche Fuji C-Chain',
        rpcUrl: 'https://api.avax-test.network/ext/bc/C/rpc',
        isMainnet: false
      });
      
      // Assert
      const status = await adapter.getStatus();
      expect(status.chainId).toBe(43113);
      expect(status.networkName).toBe('Avalanche Fuji C-Chain');
      expect(status.isMainnet).toBe(false);
    });
    
    it('should initialize with subnet config', async () => {
      // Arrange
      adapter = new AvalancheAdapter({
        subnetworkId: 'wagmi'
      } as AvalancheAdapterConfig);
      
      // Act
      await adapter.initialize({});
      
      // Assert
      const status = await adapter.getStatus();
      expect(status.metadata?.subnetInfo).toBeDefined();
      expect(status.metadata?.subnetInfo.name).toBe('Wagmi');
      expect(status.chainId).toBe(11111);
    });
    
    it('should correct mainnet flag for Fuji testnet', async () => {
      // Arrange - incorrectly setting isMainnet=true for Fuji testnet
      adapter = new AvalancheAdapter({
        chainId: 43113,
        isMainnet: true // Invalid combo - should be corrected
      });
      
      // Act
      await adapter.initialize({});
      
      // Assert
      const status = await adapter.getStatus();
      expect(status.chainId).toBe(43113);
      expect(status.isMainnet).toBe(false); // Should be corrected to false
    });
    
    it('should switch to testnet when isMainnet is false but chainId is mainnet', async () => {
      // Arrange
      adapter = new AvalancheAdapter({
        chainId: 43114, // Mainnet
        isMainnet: false // Conflict - should switch to testnet
      });
      
      // Act
      await adapter.initialize({});
      
      // Assert
      const status = await adapter.getStatus();
      expect(status.chainId).toBe(43113); // Should switch to Fuji
      expect(status.isMainnet).toBe(false);
      expect(status.networkName).toBe('Avalanche Fuji C-Chain');
    });
    
    it('should throw error when initializing with invalid config', async () => {
      // Arrange
      adapter = new AvalancheAdapter();
      
      // Act & Assert
      await expect(adapter.initialize({
        chainId: 43114,
        networkName: 'Avalanche C-Chain',
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
      expect(status.name).toBe('AvalancheAdapter');
      expect(status.isConnected).toBe(true);
      expect(status.gasPrice).toBeDefined();
    });
    
    it('should reject connection if not initialized', async () => {
      // Arrange
      adapter = new AvalancheAdapter(); // New uninitialized adapter
      
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
      
      // Spy on updateGasPrice to see if update is skipped
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
    
    it('should get native AVAX balance', async () => {
      // Arrange
      const address = '0x1234567890123456789012345678901234567890';
      
      // Act
      const balance = await adapter.getBalance(address);
      
      // Assert
      expect(balance).toBe('23.75'); // Mock value from adapter
    });
    
    it('should get token balance', async () => {
      // Arrange
      const address = '0x1234567890123456789012345678901234567890';
      const asset: Asset = {
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 6,
        address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', // Avalanche USDC
        chainId: 43114,
        isNative: false
      };
      
      // Act
      const balance = await adapter.getBalance(address, asset);
      
      // Assert
      expect(balance).toBe('1250.0'); // Mock value for token
    });
    
    it('should get quote for AVAX to token', async () => {
      // Arrange
      const fromAsset: Asset = {
        symbol: 'AVAX',
        name: 'Avalanche',
        decimals: 18,
        chainId: 43114,
        isNative: true
      };
      
      const toAsset: Asset = {
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 6,
        address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
        chainId: 43114,
        isNative: false
      };
      
      // Act
      const quote = await adapter.getQuote(fromAsset, toAsset, '10.0');
      
      // Assert
      expect(quote.expectedOutput).toBeDefined();
      expect(quote.priceImpact).toBeDefined();
      expect(quote.route).toContain('AVAX');
      expect(quote.route).toContain('USDC');
      // Should include DEX name
      expect(quote.route).toContain(expect.stringMatching(/Trader Joe|Pangolin/));
    });
    
    it('should get quote for token to AVAX', async () => {
      // Arrange
      const fromAsset: Asset = {
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 6,
        address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
        chainId: 43114,
        isNative: false
      };
      
      const toAsset: Asset = {
        symbol: 'AVAX',
        name: 'Avalanche',
        decimals: 18,
        chainId: 43114,
        isNative: true
      };
      
      // Act
      const quote = await adapter.getQuote(fromAsset, toAsset, '100.0');
      
      // Assert
      expect(quote.expectedOutput).toBeDefined();
      expect(quote.priceImpact).toBeDefined();
      expect(quote.route).toContain('USDC');
      expect(quote.route).toContain('AVAX');
    });
    
    it('should get quote for token to token', async () => {
      // Arrange
      const fromAsset: Asset = {
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 6,
        address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
        chainId: 43114,
        isNative: false
      };
      
      const toAsset: Asset = {
        symbol: 'WETH.e',
        name: 'Wrapped Ethereum',
        decimals: 18,
        address: '0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB',
        chainId: 43114,
        isNative: false
      };
      
      // Act
      const quote = await adapter.getQuote(fromAsset, toAsset, '1000.0');
      
      // Assert
      expect(quote.expectedOutput).toBeDefined();
      expect(quote.priceImpact).toBeDefined();
      // For token-to-token, it should route through WAVAX
      expect(quote.route).toContain('USDC');
      expect(quote.route).toContain('WAVAX');
      expect(quote.route).toContain('WETH.e');
    });
    
    it('should execute trade', async () => {
      // Arrange
      const order = {
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
      expect(result.executionPrice).toBe('10.75');
      expect(result.amountOut).toBe('107.5');
      expect(result.fees).toBeDefined();
      if (result.fees) {
        expect(result.fees.networkFee).toBe('0.005');
        expect(result.fees.protocolFee).toBe('0.001');
      }
    });
    
    it('should check transaction status', async () => {
      // Arrange
      const txHash = '0x' + Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('');
      
      // Act
      const status = await adapter.getTransactionStatus(txHash);
      
      // Assert
      expect(status.status).toBe('confirmed');
      expect(status.confirmations).toBe(12);
      expect(status.receipt).toBeDefined();
      expect(status.receipt.blockNumber).toBeDefined();
      expect(status.receipt.status).toBe(1); // Success
    });
    
    it('should perform cross-chain bridge operation', async () => {
      // Arrange
      const asset: Asset = {
        symbol: 'AVAX',
        name: 'Avalanche',
        decimals: 18,
        chainId: 43114,
        isNative: true
      };
      const amount = '10.0';
      const address = '0x1234567890123456789012345678901234567890';
      
      // Act
      const result = await adapter.bridgeToChain(asset, amount, 'C', 'X', address);
      
      // Assert
      expect(result.success).toBe(true);
      expect(result.txHash).toBeDefined();
      
      // Should reject same-chain bridge
      const sameChainResult = await adapter.bridgeToChain(asset, amount, 'C', 'C', address);
      expect(sameChainResult.success).toBe(false);
      expect(sameChainResult.error).toBeDefined();
    });
    
    it('should get staking APY information', async () => {
      // Act
      const stakingInfo = await adapter.getStakingAPY();
      
      // Assert
      expect(stakingInfo.currentAPY).toBeGreaterThan(0);
      expect(stakingInfo.minStakeAmount).toBeDefined();
      expect(stakingInfo.recommendedValidators).toBeDefined();
      expect(stakingInfo.recommendedValidators?.length).toBeGreaterThan(0);
      
      // Check first validator
      const firstValidator = stakingInfo.recommendedValidators?.[0];
      expect(firstValidator?.id).toMatch(/^NodeID-/);
      expect(firstValidator?.apy).toBeDefined();
      expect(firstValidator?.uptime).toBeGreaterThanOrEqual(0);
      expect(firstValidator?.uptime).toBeLessThanOrEqual(100);
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
      expect(status.name).toBe('AvalancheAdapter');
    });
    
    it('should not fail on disconnect if not connected', async () => {
      // Don't call connect()
      await expect(adapter.disconnect()).resolves.not.toThrow();
    });
    
    it('should handle bridge operation failures', async () => {
      // Arrange
      const asset: Asset = {
        symbol: 'AVAX',
        name: 'Avalanche',
        decimals: 18,
        chainId: 43114,
        isNative: true
      };
      
      // Test with same source and target chain (should fail)
      const result = await adapter.bridgeToChain(asset, '10.0', 'C', 'C', '0x1234...');
      
      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
}); 