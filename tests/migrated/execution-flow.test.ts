import { CrossChainExecutionRouter } from '../../src/execution/CrossChainExecutionRouter';
import { SmartOrderRouter } from '../../src/execution/SmartOrderRouter';
import { LiquidityAggregator } from '../../packages/execution/src/LiquidityAggregator';
import { MockChainAdapter } from '../../src/execution/adapters/MockChainAdapter';
import { StrategyGenome } from '../../src/evolution/StrategyGenome';
import { Exchange } from '../../packages/execution/src/types';
import { Logger } from 'winston';

/**
 * Integration test suite for the execution flow
 * Tests the complete execution pipeline from order routing to cross-chain execution
 */
describe('Execution Flow Integration Test', () => {
  let crossChainRouter: CrossChainExecutionRouter;
  let smartOrderRouter: SmartOrderRouter;
  let liquidityAggregator: LiquidityAggregator;
  let mockLogger: Logger;

  beforeAll(async () => {
    // Mock logger for testing
    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      log: jest.fn()
    } as any;

    // Initialize components
    crossChainRouter = CrossChainExecutionRouter.getInstance({
      defaultChainId: 'ethereum',
      preferDeployedStrategies: true,
      maxFeeCostMultiplier: 2.0,
      minChainHealthScore: 0.5,
      enableAutoRetry: true,
      maxRetryAttempts: 2,
      retryBackoffBaseMs: 500,
      // Test-specific configuration
      congestionThreshold: 0.8,
      bridgeTimeoutMs: 30000,
      mevProtectionEnabled: true,
      tracingEnabled: true,
      healthCheckCacheTTL: 5000,
      congestionMonitorInterval: 10000,
      bridgeMetricsInterval: 15000
    });

    // Register mock adapters for testing
    const ethereumAdapter = new MockChainAdapter({
      chainId: 'ethereum',
      rpcUrls: ['http://mock-ethereum'],
      networkName: 'Ethereum Testnet',
      maxConfirmTimeMs: 30000,
      emitDetailedTelemetry: true,
      rpcRetries: 3,
      mockSuccessRate: 0.9,
      mockLatency: 1000
    });

    const solanaAdapter = new MockChainAdapter({
      chainId: 'solana',
      rpcUrls: ['http://mock-solana'],
      networkName: 'Solana Testnet',
      maxConfirmTimeMs: 5000,
      emitDetailedTelemetry: true,
      rpcRetries: 3,
      mockSuccessRate: 0.95,
      mockLatency: 400
    });

    const polygonAdapter = new MockChainAdapter({
      chainId: 'polygon',
      rpcUrls: ['http://mock-polygon'],
      networkName: 'Polygon Testnet',
      maxConfirmTimeMs: 10000,
      emitDetailedTelemetry: true,
      rpcRetries: 3,
      mockSuccessRate: 0.85,
      mockLatency: 800
    });

    // Initialize adapters
    await ethereumAdapter.initialize();
    await solanaAdapter.initialize();
    await polygonAdapter.initialize();

    // Register adapters with router
    crossChainRouter.registerAdapter(ethereumAdapter);
    crossChainRouter.registerAdapter(solanaAdapter);
    crossChainRouter.registerAdapter(polygonAdapter);

    // Initialize SmartOrderRouter
    smartOrderRouter = SmartOrderRouter.getInstance();

    // Mock exchanges for LiquidityAggregator
    const mockExchanges: Exchange[] = [
      {
        id: 'binance',
        name: 'Binance',
        type: 'cex',
        tradingFees: { maker: 0.001, taker: 0.001, withdrawal: {}, deposit: {} },
        capabilities: ['SPOT_TRADING', 'API_TRADING', 'WEBSOCKET_FEED'] as any,
        status: {
          operational: true,
          tradingEnabled: true,
          depositsEnabled: true,
          withdrawalsEnabled: true,
          maintenanceMode: false,
          uptime: 99.9
        },
        latency: 50,
        reliability: 0.99,
        liquidityScore: 95,
        mevProtection: false,
        apiRateLimit: { requests: 1200, period: 60 },
        supportedPairs: ['BTC/USDT', 'ETH/USDT'],
        lastUpdate: Date.now()
      },
      {
        id: 'uniswap',
        name: 'Uniswap V3',
        type: 'dex',
        chain: 'ethereum',
        tradingFees: { maker: 0.003, taker: 0.003, withdrawal: {}, deposit: {} },
        capabilities: ['SPOT_TRADING'] as any,
        status: {
          operational: true,
          tradingEnabled: true,
          depositsEnabled: true,
          withdrawalsEnabled: true,
          maintenanceMode: false,
          uptime: 99.5
        },
        latency: 15000,
        reliability: 0.95,
        liquidityScore: 85,
        mevProtection: true,
        apiRateLimit: { requests: 1000, period: 60 },
        supportedPairs: ['BTC/USDT', 'ETH/USDT'],
        lastUpdate: Date.now()
      }
    ];

    // Initialize LiquidityAggregator
    liquidityAggregator = new LiquidityAggregator(mockLogger, mockExchanges, {
      cexTTL: 500,
      dexTTL: 2000,
      defaultTTL: 1000,
      priceInvalidationThreshold: 0.001,
      maxCacheSize: 100,
      warmupPairs: ['BTC/USDT', 'ETH/USDT'],
      warmupInterval: 30000
    });
  });

  afterAll(async () => {
    // Cleanup
    liquidityAggregator.destroy();
    smartOrderRouter.cleanup();
  });

  test('End-to-End Execution Flow', async () => {
    // Test strategy genome
    const testGenome: StrategyGenome = {
      id: 'test-strategy-001',
      version: '1.0.0',
      genes: {
        riskTolerance: 0.5,
        timeHorizon: 3600,
        maxDrawdown: 0.1,
        targetVolatility: 0.2
      },
      fitness: 0.8,
      parentIds: [],
      generation: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: {
        name: 'Test Strategy',
        description: 'Integration test strategy',
        author: 'test-system'
      }
    };

    const market = 'BTC/USDT';
    const executionParams = {
      amount: 1.0,
      slippageTolerance: 0.5,
      timeoutMs: 30000,
      isSimulation: true,
      chainId: 'ethereum'
    };

    // Test 1: Chain health status check
    const healthStatuses = await crossChainRouter.getChainHealthStatuses();
    expect(Object.keys(healthStatuses)).toHaveLength(3);
    expect(healthStatuses['ethereum']).toBeGreaterThan(0);
    expect(healthStatuses['solana']).toBeGreaterThan(0);
    expect(healthStatuses['polygon']).toBeGreaterThan(0);

    // Test 2: Strategy execution on optimal chain
    const executionResult = await crossChainRouter.executeStrategy(
      testGenome,
      market,
      executionParams
    );

    expect(executionResult).toBeDefined();
    expect(executionResult.timestamp).toBeDefined();
    expect(executionResult.executionTimeMs).toBeGreaterThan(0);

    if (executionResult.success) {
      expect(executionResult.transactionId).toBeDefined();
      expect(executionResult.feeCost).toBeGreaterThanOrEqual(0);
    } else {
      expect(executionResult.error).toBeDefined();
    }

    // Test 3: Liquidity aggregation
    const liquiditySnapshot = await liquidityAggregator.getAggregatedLiquidity('BTC/USDT');
    expect(liquiditySnapshot).toBeDefined();
    expect(liquiditySnapshot.symbol).toBe('BTC/USDT');
    expect(liquiditySnapshot.timestamp).toBeGreaterThan(0);
    expect(liquiditySnapshot.exchanges).toBeDefined();

    // Test 4: Smart order routing
    const testOrder = {
      symbol: 'BTC/USDT',
      side: 'buy' as const,
      amount: 0.1,
      price: 50000,
      venues: ['binance', 'uniswap']
    };

    const orderResult = await smartOrderRouter.executeOrder(testOrder);
    expect(orderResult).toBeDefined();
    expect(orderResult.success).toBeDefined();
    expect(orderResult.venue).toBeDefined();

    // Test 5: Cross-chain routing
    const optimalPath = await crossChainRouter.getOptimalRoute('ethereum', 'solana');
    expect(optimalPath).toBeDefined();
    if (optimalPath) {
      expect(optimalPath.path).toHaveLength(2);
      expect(optimalPath.path[0]).toBe('ethereum');
      expect(optimalPath.path[1]).toBe('solana');
      expect(optimalPath.totalFee).toBeGreaterThan(0);
      expect(optimalPath.totalLatency).toBeGreaterThan(0);
      expect(optimalPath.healthScore).toBeGreaterThan(0);
      expect(optimalPath.healthScore).toBeLessThanOrEqual(1);
    }

    // Test 6: System health check
    const systemHealth = await crossChainRouter.getSystemHealthStatus();
    expect(systemHealth).toBeDefined();
    expect(systemHealth.overall).toMatch(/healthy|degraded|unhealthy/);
    expect(systemHealth.summary.totalAdapters).toBe(3);
    expect(systemHealth.summary.averageLatency).toBeGreaterThan(0);
    expect(systemHealth.timestamp).toBeGreaterThan(0);
  });

  test('Error Handling and Resilience', async () => {
    // Test with invalid strategy genome
    const invalidGenome = {
      id: '', // Invalid empty ID
      version: '1.0.0',
      genes: {},
      fitness: 0,
      parentIds: [],
      generation: 1,
      createdAt: Date.now(),
      updatedAt: Date.now()
    } as StrategyGenome;

    const executionResult = await crossChainRouter.executeStrategy(
      invalidGenome,
      'BTC/USDT',
      {
        amount: 1.0,
        slippageTolerance: 0.5,
        timeoutMs: 30000,
        isSimulation: true
      }
    );

    // Should handle invalid genome gracefully
    expect(executionResult.success).toBe(false);
    expect(executionResult.error).toBeDefined();

    // Test with non-existent market
    const validGenome: StrategyGenome = {
      id: 'test-strategy-002',
      version: '1.0.0',
      genes: { riskTolerance: 0.5 },
      fitness: 0.8,
      parentIds: [],
      generation: 1,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    const nonExistentMarketResult = await crossChainRouter.executeStrategy(
      validGenome,
      'INVALID/PAIR',
      {
        amount: 1.0,
        slippageTolerance: 0.5,
        timeoutMs: 30000,
        isSimulation: true
      }
    );

    // Should handle gracefully even with invalid market
    expect(nonExistentMarketResult).toBeDefined();
    expect(nonExistentMarketResult.timestamp).toBeGreaterThan(0);
  });

  test('Performance and Caching', async () => {
    const testSymbol = 'ETH/USDT';
    
    // First request (should be uncached)
    const start1 = Date.now();
    const result1 = await liquidityAggregator.getAggregatedLiquidity(testSymbol);
    const latency1 = Date.now() - start1;

    expect(result1).toBeDefined();
    expect(result1.symbol).toBe(testSymbol);

    // Second request (should be cached and faster)
    const start2 = Date.now();
    const result2 = await liquidityAggregator.getAggregatedLiquidity(testSymbol);
    const latency2 = Date.now() - start2;

    expect(result2).toBeDefined();
    expect(result2.symbol).toBe(testSymbol);
    
    // Cached request should be significantly faster
    expect(latency2).toBeLessThan(latency1 * 0.5); // At least 50% faster

    // Verify cache hit behavior
    expect(result1.timestamp).toBeLessThanOrEqual(result2.timestamp);
  });
}); 