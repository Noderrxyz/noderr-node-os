import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import { CrossChainExecutionRouter } from '../CrossChainExecutionRouter';
import { ExecutionSecurityLayer } from '../ExecutionSecurityLayer';
import { BlockchainTelemetry } from '../telemetry/BlockchainTelemetry';
import { CircuitBreaker } from '../telemetry/CircuitBreaker';
import { ChainId, Asset, TradeRequest, TradeOptions, Network } from '../IChainAdapter';
import { AdapterRegistry } from '../registry/AdapterRegistry';
import { ExtendedAssetAdapterCapability } from '../CoinMarketCapAdapter';

// Mock adapters and dependencies - in a real test we would use actual instances
const mockTelemetry = {
  recordTradeStart: jest.fn(),
  recordTradeSubmitted: jest.fn(),
  recordTradeFailed: jest.fn(),
  recordGasEstimation: jest.fn(),
  recordFailedGasEstimation: jest.fn(),
  recordSecurityCheck: jest.fn()
};

const mockRegistry = {
  getChainAdapter: jest.fn(),
  registerChainAdapter: jest.fn(),
  getSupportedChains: jest.fn(),
  getStatus: jest.fn(),
  checkHealth: jest.fn()
};

const mockEthereumAdapter = {
  getName: () => 'EthereumAdapter',
  getVersion: () => '1.0.0',
  getChainId: () => ChainId.ETHEREUM,
  getStatus: jest.fn().mockResolvedValue({
    isConnected: true,
    name: 'EthereumAdapter',
    version: '1.0.0',
    chainId: ChainId.ETHEREUM,
    networkName: 'Ethereum Mainnet',
    isMainnet: true
  }),
  submitTrade: jest.fn().mockResolvedValue({
    hash: '0xTEST_HASH_ETHEREUM',
    confirmations: 0,
    from: '0xTEST_WALLET',
    wait: jest.fn().mockResolvedValue({
      status: 'success'
    })
  }),
  getQuote: jest.fn().mockResolvedValue({
    expectedOutput: '500000000000000000',
    priceImpact: 0.5,
    route: ['USDC -> WETH']
  }),
  estimateGas: jest.fn().mockResolvedValue('300000'),
  getBalance: jest.fn().mockResolvedValue('1000000000000000000'),
  hasCapability: jest.fn().mockReturnValue(true),
  connect: jest.fn(),
  initialize: jest.fn()
};

const mockArbitrumAdapter = {
  getName: () => 'ArbitrumAdapter',
  getVersion: () => '1.0.0',
  getChainId: () => ChainId.ARBITRUM,
  getStatus: jest.fn().mockResolvedValue({
    isConnected: true,
    name: 'ArbitrumAdapter',
    version: '1.0.0',
    chainId: ChainId.ARBITRUM,
    networkName: 'Arbitrum One',
    isMainnet: true
  }),
  submitTrade: jest.fn().mockResolvedValue({
    hash: '0xTEST_HASH_ARBITRUM',
    confirmations: 0,
    from: '0xTEST_WALLET',
    wait: jest.fn().mockResolvedValue({
      status: 'success'
    })
  }),
  getQuote: jest.fn().mockResolvedValue({
    expectedOutput: '490000000000000000',
    priceImpact: 0.7,
    route: ['USDC -> WETH']
  }),
  estimateGas: jest.fn().mockResolvedValue('500000'),
  getBalance: jest.fn().mockResolvedValue('2000000000000000000'),
  hasCapability: jest.fn().mockReturnValue(true),
  connect: jest.fn(),
  initialize: jest.fn()
};

const mockPolygonAdapter = {
  getName: () => 'PolygonAdapter',
  getVersion: () => '1.0.0',
  getChainId: () => ChainId.POLYGON,
  getStatus: jest.fn().mockResolvedValue({
    isConnected: true,
    name: 'PolygonAdapter',
    version: '1.0.0',
    chainId: ChainId.POLYGON,
    networkName: 'Polygon Mainnet',
    isMainnet: true
  }),
  submitTrade: jest.fn().mockResolvedValue({
    hash: '0xTEST_HASH_POLYGON',
    confirmations: 0,
    from: '0xTEST_WALLET',
    wait: jest.fn().mockResolvedValue({
      status: 'success'
    })
  }),
  getQuote: jest.fn().mockResolvedValue({
    expectedOutput: '480000000000000000',
    priceImpact: 1.0,
    route: ['USDC -> WETH']
  }),
  estimateGas: jest.fn().mockResolvedValue('400000'),
  getBalance: jest.fn().mockResolvedValue('3000000000000000000'),
  hasCapability: jest.fn().mockReturnValue(true),
  connect: jest.fn(),
  initialize: jest.fn()
};

// Mocking CircuitBreaker
class MockCircuitBreaker {
  private name: string;
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  
  constructor(name: string) {
    this.name = name;
  }
  
  public getStatus() {
    return {
      name: this.name,
      state: this.state,
      failureCount: 0,
      successCount: 0,
      lastFailure: null,
      lastSuccess: null
    };
  }
  
  public setState(state: 'closed' | 'open' | 'half-open') {
    this.state = state;
  }
  
  public execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      return Promise.reject(new Error('Circuit breaker is open'));
    }
    return fn();
  }
}

// Common asset definitions for tests
const USDC: Asset = {
  symbol: 'USDC',
  name: 'USD Coin',
  decimals: 6,
  address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  chainId: ChainId.ETHEREUM
};

const WETH: Asset = {
  symbol: 'WETH',
  name: 'Wrapped Ether',
  decimals: 18,
  address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  chainId: ChainId.ETHEREUM
};

describe('Cross-Chain Infrastructure Tests', () => {
  let registry: AdapterRegistry;
  let ethereumAdapter: any;
  let arbitrumAdapter: any;
  let polygonAdapter: any;
  let router: CrossChainExecutionRouter;
  let ethereumTelemetry: BlockchainTelemetry;
  let arbitrumTelemetry: BlockchainTelemetry;
  let polygonTelemetry: BlockchainTelemetry;
  let ethereumCircuitBreaker: MockCircuitBreaker;
  let arbitrumCircuitBreaker: MockCircuitBreaker;
  let polygonCircuitBreaker: MockCircuitBreaker;
  
  beforeEach(async () => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Create registry and adapters
    registry = new AdapterRegistry();
    
    ethereumAdapter = {...mockEthereumAdapter};
    arbitrumAdapter = {...mockArbitrumAdapter};
    polygonAdapter = {...mockPolygonAdapter};
    
    // Initialize adapters
    await Promise.all([
      ethereumAdapter.initialize(),
      arbitrumAdapter.initialize(),
      polygonAdapter.initialize()
    ]);
    
    // Create telemetry and circuit breakers
    ethereumTelemetry = new BlockchainTelemetry({
      enabled: true,
      metricsPersistenceInterval: 60000,
      chainId: ChainId.ETHEREUM,
      logLevel: 'info'
    });
    
    arbitrumTelemetry = new BlockchainTelemetry({
      enabled: true,
      metricsPersistenceInterval: 60000,
      chainId: ChainId.ARBITRUM,
      logLevel: 'info'
    });
    
    polygonTelemetry = new BlockchainTelemetry({
      enabled: true,
      metricsPersistenceInterval: 60000,
      chainId: ChainId.POLYGON,
      logLevel: 'info'
    });
    
    ethereumCircuitBreaker = new MockCircuitBreaker('EthereumCircuitBreaker');
    arbitrumCircuitBreaker = new MockCircuitBreaker('ArbitrumCircuitBreaker');
    polygonCircuitBreaker = new MockCircuitBreaker('PolygonCircuitBreaker');
    
    // Create security layers
    const ethereumSecurity = new ExecutionSecurityLayer({
      slippageProtection: {
        defaultTolerance: 0.5,
        maxTolerance: 2.0,
        enablePriceChecking: true,
        timeBound: 60000
      },
      mevProtection: {
        enabled: true
      }
    });
    
    const arbitrumSecurity = new ExecutionSecurityLayer({
      slippageProtection: {
        defaultTolerance: 0.7,
        maxTolerance: 2.5,
        enablePriceChecking: true,
        timeBound: 60000
      },
      mevProtection: {
        enabled: true
      }
    });
    
    const polygonSecurity = new ExecutionSecurityLayer({
      slippageProtection: {
        defaultTolerance: 0.6,
        maxTolerance: 2.2,
        enablePriceChecking: true,
        timeBound: 60000
      },
      mevProtection: {
        enabled: true
      }
    });
    
    // Create router
    router = new CrossChainExecutionRouter({
      adapters: [
        {
          adapter: ethereumAdapter,
          telemetry: ethereumTelemetry,
          circuitBreaker: ethereumCircuitBreaker,
          security: ethereumSecurity,
          priority: 1 // Primary chain
        },
        {
          adapter: arbitrumAdapter,
          telemetry: arbitrumTelemetry,
          circuitBreaker: arbitrumCircuitBreaker,
          security: arbitrumSecurity,
          priority: 2 // First fallback
        },
        {
          adapter: polygonAdapter,
          telemetry: polygonTelemetry,
          circuitBreaker: polygonCircuitBreaker,
          security: polygonSecurity,
          priority: 3 // Second fallback
        }
      ],
      fallbackEnabled: true,
      maxFallbacks: 2,
      errorCasesEligibleForFallback: [
        'rpc_error',
        'gas_too_high',
        'timeout',
        'network_congestion',
        'transaction_underpriced'
      ]
    });
    
    // Initialize the router
    await router.initialize();
  });
  
  // Clean up after tests
  afterEach(async () => {
    await router.shutdown();
    await Promise.all([
      ethereumAdapter.shutdown(),
      arbitrumAdapter.shutdown(),
      polygonAdapter.shutdown()
    ]);
  });
  
  describe('Cross-Chain Execution Tests', () => {
    it('should execute a trade on the primary chain successfully', async () => {
      // Create trade request
      const tradeRequest: TradeRequest = {
        fromAsset: USDC,
        toAsset: WETH,
        amount: '1000000000', // 1000 USDC (6 decimals)
        slippageTolerance: 0.5,
        deadline: Math.floor(Date.now() / 1000) + 60 * 20 // 20 minutes
      };
      
      // Trade options
      const tradeOptions: TradeOptions = {
        gasLimit: BigInt(350000),
        waitForConfirmation: true,
        confirmations: 1,
        mevProtection: true
      };
      
      // Execute the trade
      const result = await router.executeTrade(tradeRequest);
      
      // Assert the result
      expect(result).not.toBeNull();
      expect(result.success).toBeTruthy();
      expect(result.chainId).toEqual(ChainId.ETHEREUM);
      expect(result.txHash).toEqual('0xTEST_HASH_ETHEREUM');
      expect(result.amountOut).toEqual('500000000000000000');
    });
    
    it('should fallback to a secondary chain if the primary fails', async () => {
      // Make Ethereum adapter fail
      ethereumAdapter.submitTrade.mockRejectedValueOnce(new Error('RPC Error: connection refused'));
      
      // Create trade request
      const tradeRequest: TradeRequest = {
        fromAsset: USDC,
        toAsset: WETH,
        amount: '1000000000', // 1000 USDC (6 decimals)
        slippageTolerance: 0.5,
        deadline: Math.floor(Date.now() / 1000) + 60 * 20 // 20 minutes
      };
      
      // Trade options
      const tradeOptions: TradeOptions = {
        gasLimit: BigInt(350000),
        waitForConfirmation: true,
        confirmations: 1,
        mevProtection: true
      };
      
      // Execute the trade
      const result = await router.executeTrade(tradeRequest);
      
      // Assert the result
      expect(result).not.toBeNull();
      expect(result.success).toBeTruthy();
      expect(result.chainId).toEqual(ChainId.ARBITRUM);
      expect(result.txHash).toEqual('0xTEST_HASH_ARBITRUM');
      expect(result.amountOut).toEqual('490000000000000000');
      expect(result.fallbacksAttempted).toEqual(1);
    });
    
    it('should apply security measures like MEV protection', async () => {
      // Create trade request
      const tradeRequest: TradeRequest = {
        fromAsset: USDC,
        toAsset: WETH,
        amount: '1000000000', // 1000 USDC
        slippageTolerance: 0.5,
        deadline: Math.floor(Date.now() / 1000) + 60 * 20 // 20 minutes
      };
      
      // Trade options with MEV protection
      const tradeOptions: TradeOptions = {
        mevProtection: true,
        waitForConfirmation: true
      };
      
      // Mock the security layer
      const originalSubmitTrade = ethereumAdapter.submitTrade;
      let mevProtectionApplied = false;
      
      ethereumAdapter.submitTrade = async (req, opts) => {
        if (opts?.mevProtection) {
          mevProtectionApplied = true;
        }
        return {
          hash: '0xTEST_HASH_ETHEREUM',
          confirmations: 0,
          from: '0xTEST_WALLET',
          wait: async () => ({
            status: 'success'
          })
        };
      };
      
      // Execute the trade
      const result = await router.executeTrade(tradeRequest);
      
      // Restore the original function
      ethereumAdapter.submitTrade = originalSubmitTrade;
      
      // Assert the result
      expect(result).not.toBeNull();
      expect(result.success).toBeTruthy();
      expect(result.mevProtectionApplied).toBeTruthy();
      expect(mevProtectionApplied).toBeTruthy();
    });
  });
  
  describe('Circuit Breaker Tests', () => {
    it('should trip the circuit breaker after threshold errors', async () => {
      const mockExecute = jest.fn();
      
      // Simulate circuit breaker behavior
      ethereumCircuitBreaker.setState('open');
      
      // Create trade request
      const tradeRequest: TradeRequest = {
        fromAsset: USDC,
        toAsset: WETH,
        amount: '1000000000',
        slippageTolerance: 0.5
      };
      
      // Execute a trade - should fallback to Arbitrum
      const result = await router.executeTrade(tradeRequest);
      
      // Verify we didn't call Ethereum
      expect(ethereumAdapter.submitTrade).not.toHaveBeenCalled();
      
      // Verify we used Arbitrum
      expect(result.chainId).toEqual(ChainId.ARBITRUM);
      expect(arbitrumAdapter.submitTrade).toHaveBeenCalled();
    });
  });
  
  describe('AdapterRegistry Tests', () => {
    it('should register and retrieve adapters', async () => {
      // Setup registry
      const registry = new AdapterRegistry();
      
      // Register adapters
      registry.registerChainAdapter(ChainId.ETHEREUM, ethereumAdapter);
      registry.registerChainAdapter(ChainId.ARBITRUM, arbitrumAdapter);
      registry.registerChainAdapter(ChainId.POLYGON, polygonAdapter);
      
      // Verify registration
      expect(registry.supportsChain(ChainId.ETHEREUM)).toBeTruthy();
      expect(registry.supportsChain(ChainId.ARBITRUM)).toBeTruthy();
      expect(registry.supportsChain(ChainId.POLYGON)).toBeTruthy();
      
      // Get adapters
      const ethAdapter = registry.getChainAdapter(ChainId.ETHEREUM);
      const arbAdapter = registry.getChainAdapter(ChainId.ARBITRUM);
      const polyAdapter = registry.getChainAdapter(ChainId.POLYGON);
      
      // Verify adapter retrieval
      expect(ethAdapter).toEqual(ethereumAdapter);
      expect(arbAdapter).toEqual(arbitrumAdapter);
      expect(polyAdapter).toEqual(polygonAdapter);
      
      // Get supported chains
      const supportedChains = registry.getSupportedChains();
      expect(supportedChains).toContain(ChainId.ETHEREUM);
      expect(supportedChains).toContain(ChainId.ARBITRUM);
      expect(supportedChains).toContain(ChainId.POLYGON);
    });
    
    it('should check adapter health', async () => {
      // Setup registry
      const registry = new AdapterRegistry();
      
      // Register adapters
      registry.registerChainAdapter(ChainId.ETHEREUM, ethereumAdapter);
      registry.registerChainAdapter(ChainId.ARBITRUM, arbitrumAdapter);
      
      // Initialize registry
      await registry.initialize();
      
      // Check health
      const health = await registry.checkHealth();
      
      // Verify health check results
      expect(health.healthy).toBeTruthy();
      expect(health.adapters.length).toBeGreaterThanOrEqual(2);
      expect(health.chainAdapters[ChainId.ETHEREUM.toString()]).toBeTruthy();
      expect(health.chainAdapters[ChainId.ARBITRUM.toString()]).toBeTruthy();
    });
  });
}); 