import { UniversalXAdapter } from '@noderr/src/adapters/UniversalXAdapter';
import { UniversalAccountService } from '@noderr/src/services/UniversalAccountService';
import { CrossChainExecutionRouter } from '@noderr/src/adapters/CrossChainExecutionRouter';
import { 
  CrossChainSwapParams, 
  SwapResult, 
  FeeEstimate,
  ChainInfo 
} from '@noderr/src/adapters/interfaces/ICrossChainAdapter';
import { Asset, TradeRequest, TradeOrder } from '@noderr/src/adapters/IChainAdapter';
import axios from 'axios';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('UniversalXAdapter', () => {
  let adapter: UniversalXAdapter;
  let mockApiClient: any;
  
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Mock axios create
    mockApiClient = {
      get: jest.fn(),
      post: jest.fn(),
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() }
      }
    };
    
    mockedAxios.create.mockReturnValue(mockApiClient);
    
    // Create adapter instance
    adapter = new UniversalXAdapter({
      apiKey: 'test-api-key',
      apiSecret: 'test-api-secret',
      environment: 'testnet'
    });
  });
  
  describe('Authentication', () => {
    it('should authenticate successfully', async () => {
      const mockSession = {
        sessionId: 'test-session-id',
        token: 'test-token',
        expiresAt: Date.now() + 3600000,
        refreshToken: 'test-refresh-token',
        accountId: 'test-account-id'
      };
      
      mockApiClient.post.mockResolvedValueOnce({ data: mockSession });
      
      const session = await adapter.authenticate({
        apiKey: 'test-api-key',
        apiSecret: 'test-api-secret'
      });
      
      expect(session).toEqual({
        id: mockSession.sessionId,
        token: mockSession.token,
        expiresAt: mockSession.expiresAt,
        refreshToken: mockSession.refreshToken,
        accountId: mockSession.accountId
      });
      
      expect(mockApiClient.post).toHaveBeenCalledWith('/auth/login', {
        apiKey: 'test-api-key',
        apiSecret: 'test-api-secret'
      });
    });
    
    it('should handle authentication failure', async () => {
      mockApiClient.post.mockRejectedValueOnce(new Error('Invalid credentials'));
      
      await expect(adapter.authenticate({
        apiKey: 'invalid-key',
        apiSecret: 'invalid-secret'
      })).rejects.toThrow('UniversalX authentication failed: Invalid credentials');
    });
  });
  
  describe('Cross-Chain Swaps', () => {
    beforeEach(async () => {
      // Mock successful authentication
      mockApiClient.post.mockResolvedValueOnce({
        data: {
          sessionId: 'test-session',
          token: 'test-token',
          expiresAt: Date.now() + 3600000,
          refreshToken: 'test-refresh',
          accountId: 'test-account'
        }
      });
      
      // Mock get supported chains
      mockApiClient.get.mockResolvedValueOnce({
        data: {
          chains: [
            { id: 'ethereum', name: 'Ethereum', chainId: 1, status: 'active', nativeToken: { symbol: 'ETH', decimals: 18 } },
            { id: 'polygon', name: 'Polygon', chainId: 137, status: 'active', nativeToken: { symbol: 'MATIC', decimals: 18 } }
          ]
        }
      });
      
      // Mock get account status
      mockApiClient.get.mockResolvedValueOnce({
        data: {
          accountId: 'test-account',
          isActive: true,
          chains: [],
          totalValueUSD: 1000
        }
      });
    });
    
    it('should execute cross-chain swap successfully', async () => {
      const swapParams: CrossChainSwapParams = {
        fromChain: '1',
        toChain: '137',
        fromToken: '0x0000000000000000000000000000000000000000',
        toToken: '0x0000000000000000000000000000000000000000',
        amount: '1000000000000000000', // 1 ETH
        slippageTolerance: 0.01
      };
      
      // Mock quote response
      mockApiClient.post.mockResolvedValueOnce({
        data: {
          quoteId: 'quote-123',
          expectedOutput: '1500000000000000000000', // 1500 MATIC
          priceImpact: 0.005,
          route: ['Uniswap', 'Bridge', 'QuickSwap']
        }
      });
      
      // Mock execute response
      mockApiClient.post.mockResolvedValueOnce({
        data: {
          transactionHash: '0x123456',
          fromChainTxHash: '0x123456',
          toChainTxHash: '0x789abc',
          estimatedTime: 120,
          expectedOutput: '1500000000000000000000',
          fee: {
            total: '10000000000000000', // 0.01 ETH
            gasFee: '5000000000000000',
            bridgeFee: '3000000000000000',
            protocolFee: '2000000000000000'
          },
          route: ['Uniswap', 'Bridge', 'QuickSwap']
        }
      });
      
      const result = await adapter.executeCrossChainSwap(swapParams);
      
      expect(result.success).toBe(true);
      expect(result.transactionHash).toBe('0x123456');
      expect(result.toAmount).toBe('1500000000000000000000');
      expect(result.fee.total).toBe('10000000000000000');
      expect(result.route).toEqual(['Uniswap', 'Bridge', 'QuickSwap']);
    });
    
    it('should handle swap failure', async () => {
      const swapParams: CrossChainSwapParams = {
        fromChain: '1',
        toChain: '137',
        fromToken: '0x0000000000000000000000000000000000000000',
        toToken: '0x0000000000000000000000000000000000000000',
        amount: '1000000000000000000',
        slippageTolerance: 0.01
      };
      
      // Mock quote failure
      mockApiClient.post.mockRejectedValueOnce(new Error('Insufficient liquidity'));
      
      const result = await adapter.executeCrossChainSwap(swapParams);
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('Insufficient liquidity');
      expect(result.toAmount).toBe('0');
    });
  });
  
  describe('Fee Estimation', () => {
    it('should estimate fees correctly', async () => {
      const swapParams: CrossChainSwapParams = {
        fromChain: '1',
        toChain: '137',
        fromToken: '0x0000000000000000000000000000000000000000',
        toToken: '0x0000000000000000000000000000000000000000',
        amount: '1000000000000000000',
        slippageTolerance: 0.01
      };
      
      mockApiClient.post.mockResolvedValueOnce({
        data: {
          totalFee: '10000000000000000',
          bridgeFee: '3000000000000000',
          gasFee: '5000000000000000',
          protocolFee: '2000000000000000',
          estimatedTime: 120,
          priceImpact: 0.005
        }
      });
      
      const estimate = await adapter.estimateCrossChainFees(swapParams);
      
      expect(estimate.totalFee).toBe('10000000000000000');
      expect(estimate.bridgeFee).toBe('3000000000000000');
      expect(estimate.gasFee).toBe('5000000000000000');
      expect(estimate.protocolFee).toBe('2000000000000000');
      expect(estimate.estimatedTime).toBe(120);
      expect(estimate.priceImpact).toBe(0.005);
    });
  });
  
  describe('Transaction Status', () => {
    it('should get transaction status', async () => {
      mockApiClient.get.mockResolvedValueOnce({
        data: {
          status: 'confirmed',
          confirmations: 12,
          blockNumber: 12345678,
          timestamp: Date.now()
        }
      });
      
      const status = await adapter.getTransactionStatus('0x123456');
      
      expect(status.transactionId).toBe('0x123456');
      expect(status.status).toBe('confirmed');
      expect(status.confirmations).toBe(12);
      expect(status.blockNumber).toBe(12345678);
    });
  });
  
  describe('Health Check', () => {
    it('should report healthy status', async () => {
      mockApiClient.get.mockResolvedValueOnce({ data: { status: 'ok' } });
      
      const health = await adapter.checkHealth();
      
      expect(health.healthy).toBe(true);
      expect(health.latency).toBeGreaterThan(0);
      expect(health.blockDelay).toBe(0);
    });
    
    it('should report unhealthy status on error', async () => {
      mockApiClient.get.mockRejectedValueOnce(new Error('Service unavailable'));
      
      const health = await adapter.checkHealth();
      
      expect(health.healthy).toBe(false);
      expect(health.errors).toContain('Service unavailable');
    });
  });
});

describe('UniversalAccountService', () => {
  let service: UniversalAccountService;
  let mockAdapter: jest.Mocked<UniversalXAdapter>;
  
  beforeEach(() => {
    // Create mock adapter
    mockAdapter = {
      getUniversalAccountStatus: jest.fn(),
      getBalance: jest.fn(),
      fundAccount: jest.fn(),
      isInitialized: jest.fn().mockReturnValue(true)
    } as any;
    
    // Get service instance
    service = UniversalAccountService.getInstance();
  });
  
  describe('Account Management', () => {
    it('should create account successfully', async () => {
      const mockStatus = {
        accountId: 'test-account-123',
        isActive: true,
        chains: [
          { id: 'ethereum', name: 'Ethereum', chainId: 1, status: 'active' as const, isSupported: true, nativeToken: { symbol: 'ETH', decimals: 18 } }
        ],
        totalValueUSD: 1000,
        lastUpdated: Date.now()
      };
      
      mockAdapter.getUniversalAccountStatus.mockResolvedValueOnce(mockStatus);
      
      await service.initialize(mockAdapter);
      const status = await service.createAccount();
      
      expect(status.accountId).toBe('test-account-123');
      expect(status.isActive).toBe(true);
    });
    
    it('should get account balances', async () => {
      mockAdapter.getBalance.mockResolvedValueOnce('1000000000000000000'); // 1 ETH
      
      const mockStatus = {
        accountId: 'test-account',
        isActive: true,
        chains: [
          { 
            id: 'ethereum', 
            name: 'Ethereum', 
            chainId: 1, 
            status: 'active' as const,
            isSupported: true,
            nativeToken: { symbol: 'ETH', decimals: 18 } 
          }
        ],
        totalValueUSD: 1000,
        lastUpdated: Date.now()
      };
      
      mockAdapter.getUniversalAccountStatus.mockResolvedValue(mockStatus);
      
      await service.initialize(mockAdapter);
      const balances = await service.getBalances();
      
      expect(balances).toHaveLength(1);
      expect(balances[0].chainName).toBe('Ethereum');
      expect(balances[0].token).toBe('ETH');
      expect(balances[0].balance).toBe('1000000000000000000');
    });
    
    it('should detect unhealthy account', async () => {
      const mockStatus = {
        accountId: 'test-account',
        isActive: false,
        chains: [
          { 
            id: 'ethereum', 
            name: 'Ethereum', 
            chainId: 1, 
            status: 'inactive' as const,
            isSupported: true,
            nativeToken: { symbol: 'ETH', decimals: 18 } 
          }
        ],
        totalValueUSD: 5, // Low balance
        lastUpdated: Date.now()
      };
      
      mockAdapter.getUniversalAccountStatus.mockResolvedValue(mockStatus);
      
      await service.initialize(mockAdapter);
      const health = await service.getHealthStatus();
      
      expect(health.isHealthy).toBe(false);
      expect(health.warnings).toContain('Low account balance detected');
      expect(health.errors).toContain('Chain Ethereum is inactive');
    });
  });
});

describe('CrossChainExecutionRouter with UniversalX', () => {
  let router: CrossChainExecutionRouter;
  let mockUniversalXAdapter: jest.Mocked<UniversalXAdapter>;
  let mockEthAdapter: any;
  
  beforeEach(() => {
    // Create mock adapters
    mockUniversalXAdapter = {
      isInitialized: jest.fn().mockReturnValue(true),
      getName: jest.fn().mockReturnValue('UniversalX'),
      getChainId: jest.fn().mockReturnValue(0),
      executeCrossChainSwap: jest.fn()
    } as any;
    
    mockEthAdapter = {
      isInitialized: jest.fn().mockReturnValue(true),
      getName: jest.fn().mockReturnValue('Ethereum'),
      getChainId: jest.fn().mockReturnValue(1),
      submitTrade: jest.fn()
    };
    
    // Create router
    router = new CrossChainExecutionRouter({
      adapters: [mockEthAdapter],
      crossChainAdapter: mockUniversalXAdapter,
      enableUniversalX: true
    });
  });
  
  it('should route trade through UniversalX when enabled', async () => {
    // Register strategy with UniversalX enabled
    router.registerStrategies([{
      id: 'test-strategy',
      name: 'Test Strategy',
      chains: [1],
      enabled: true,
      useUniversalX: true
    }]);
    
    const tradeRequest: TradeRequest = {
      fromAsset: { symbol: 'ETH', name: 'Ethereum', decimals: 18, chainId: 1 },
      toAsset: { symbol: 'MATIC', name: 'Polygon', decimals: 18, chainId: 137 },
      amount: '1000000000000000000',
      slippageTolerance: 0.01
    };
    
    mockUniversalXAdapter.executeCrossChainSwap.mockResolvedValueOnce({
      success: true,
      transactionHash: '0x123456',
      status: 'completed',
      fromAmount: '1000000000000000000',
      toAmount: '1500000000000000000000',
      fee: { total: '10000000000000000' }
    });
    
    const result = await router.executeTrade({
      strategyId: 'test-strategy',
      chainId: 1,
      tradeRequest
    });
    
    expect(result.success).toBe(true);
    expect(result.usedUniversalX).toBe(true);
    expect(result.txHash).toBe('0x123456');
    expect(mockUniversalXAdapter.executeCrossChainSwap).toHaveBeenCalled();
    expect(mockEthAdapter.submitTrade).not.toHaveBeenCalled();
  });
  
  it('should fallback to legacy adapter when UniversalX is disabled', async () => {
    // Register strategy with UniversalX disabled
    router.registerStrategies([{
      id: 'test-strategy',
      name: 'Test Strategy',
      chains: [1],
      enabled: true,
      useUniversalX: false
    }]);
    
    const tradeRequest: TradeRequest = {
      fromAsset: { symbol: 'ETH', name: 'Ethereum', decimals: 18, chainId: 1 },
      toAsset: { symbol: 'USDC', name: 'USD Coin', decimals: 6, chainId: 1 },
      amount: '1000000000000000000',
      slippageTolerance: 0.01
    };
    
    mockEthAdapter.submitTrade.mockResolvedValueOnce({
      hash: '0xabc123',
      confirmations: 0,
      from: '0x123',
      to: '0x456',
      wait: jest.fn()
    });
    
    const result = await router.executeTrade({
      strategyId: 'test-strategy',
      chainId: 1,
      tradeRequest
    });
    
    expect(result.success).toBe(true);
    expect(result.usedUniversalX).toBe(false);
    expect(result.txHash).toBe('0xabc123');
    expect(mockEthAdapter.submitTrade).toHaveBeenCalled();
    expect(mockUniversalXAdapter.executeCrossChainSwap).not.toHaveBeenCalled();
  });
}); 