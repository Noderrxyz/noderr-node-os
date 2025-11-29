import { EthereumAdapter, EthereumAdapterConfig } from '../EthereumAdapter';
import { Asset } from '../IChainAdapter';

describe('EthereumAdapter', () => {
  let adapter: EthereumAdapter;
  
  beforeEach(() => {
    // Create a new adapter instance for each test
    adapter = new EthereumAdapter({
      chainId: 1,
      networkName: 'Ethereum Mainnet',
      rpcUrl: 'https://eth-mainnet.g.alchemy.com/v2/demo',
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
      expect(status.name).toBe('EthereumAdapter');
      expect(status.chainId).toBe(1);
      expect(status.networkName).toBe('Ethereum Mainnet');
      expect(status.isMainnet).toBe(true);
    });
    
    it('should initialize with custom config', async () => {
      // Arrange
      adapter = new EthereumAdapter();
      
      // Act
      await adapter.initialize({
        chainId: 5,
        networkName: 'Goerli Testnet',
        rpcUrl: 'https://eth-goerli.g.alchemy.com/v2/demo',
        isMainnet: false
      });
      
      // Assert
      const status = await adapter.getStatus();
      expect(status.chainId).toBe(5);
      expect(status.networkName).toBe('Goerli Testnet');
      expect(status.isMainnet).toBe(false);
    });
    
    it('should throw error when initializing with invalid config', async () => {
      // Arrange
      adapter = new EthereumAdapter();
      
      // Act & Assert
      await expect(adapter.initialize({
        chainId: 1,
        networkName: 'Ethereum Mainnet',
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
  });
  
  describe('operations', () => {
    beforeEach(async () => {
      await adapter.initialize({});
      await adapter.connect();
    });
    
    it('should get balance', async () => {
      // Arrange
      const address = '0x1234567890123456789012345678901234567890';
      
      // Act
      const balance = await adapter.getBalance(address);
      
      // Assert
      expect(balance).toBeDefined();
    });
    
    it('should get token balance', async () => {
      // Arrange
      const address = '0x1234567890123456789012345678901234567890';
      const asset: Asset = {
        symbol: 'DAI',
        name: 'Dai Stablecoin',
        decimals: 18,
        address: '0x6b175474e89094c44da98b954eedeac495271d0f', // DAI contract address
        chainId: 1,
        isNative: false
      };
      
      // Act
      const balance = await adapter.getBalance(address, asset);
      
      // Assert
      expect(balance).toBeDefined();
    });
    
    it('should get quote', async () => {
      // Arrange
      const fromAsset: Asset = {
        symbol: 'ETH',
        name: 'Ethereum',
        decimals: 18,
        chainId: 1,
        isNative: true
      };
      
      const toAsset: Asset = {
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 6,
        address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC contract address
        chainId: 1,
        isNative: false
      };
      
      // Act
      const quote = await adapter.getQuote(fromAsset, toAsset, '1.0');
      
      // Assert
      expect(quote.expectedOutput).toBeDefined();
      expect(quote.priceImpact).toBeGreaterThanOrEqual(0);
      expect(quote.route?.length).toBeGreaterThan(0);
    });
    
    it('should execute trade', async () => {
      // Arrange
      const fromAsset: Asset = {
        symbol: 'ETH',
        name: 'Ethereum',
        decimals: 18,
        chainId: 1,
        isNative: true
      };
      
      const toAsset: Asset = {
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 6,
        address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC contract address
        chainId: 1,
        isNative: false
      };
      
      const order = {
        id: 'test-order-1',
        fromAsset,
        toAsset,
        amount: '1.0',
        slippageTolerance: 0.5,
        timestamp: Date.now(),
        status: 'pending' as const
      };
      
      // Act
      const result = await adapter.executeTrade(order);
      
      // Assert
      expect(result.success).toBe(true);
      expect(result.txHash).toBeDefined();
      expect(result.order.status).toBe('completed');
    });
    
    it('should check transaction status', async () => {
      // Arrange
      const txHash = '0x' + Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('');
      
      // Act
      const status = await adapter.getTransactionStatus(txHash);
      
      // Assert
      expect(status.status).toBeDefined();
    });
  });
}); 