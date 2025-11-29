import { AlphaMemory } from '../memory/AlphaMemory';
import { RegimeClassifier, MarketRegime } from '../regime/RegimeClassifier';
import { StrategyMutationEngine } from '../evolution/StrategyMutationEngine';
import { RegimeCapitalAllocator } from '../capital/RegimeCapitalAllocator';
import { StrategyPortfolioOptimizer } from '../strategy/StrategyPortfolioOptimizer';
import { TelemetryBus } from '../telemetry/TelemetryBus';

// Mock dependencies to avoid actual filesystem/network operations
jest.mock('../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }
}));

// Since we'll be using singletons, create a helper to reset them between tests
const resetSingletons = async () => {
  // Access private static instances via any type
  (AlphaMemory as any).instance = null;
  (RegimeClassifier as any).instance = null;
  (StrategyMutationEngine as any).instance = null;
  (RegimeCapitalAllocator as any).instance = null;
  (StrategyPortfolioOptimizer as any).instance = null;
  (TelemetryBus as any).instance = null;
};

describe('Adaptive Intelligence Integration Tests', () => {
  // Reset singletons before each test
  beforeEach(async () => {
    await resetSingletons();
  });
  
  // Mock market features for testing
  const mockMarketFeatures = {
    price: 50000,
    returns1d: 0.02,
    returns5d: 0.05,
    returns20d: 0.1,
    volatility1d: 0.03,
    volatility5d: 0.04,
    volatility20d: 0.05,
    volumeRatio1d: 1.2,
    volumeRatio5d: 1.1,
    rsi14: 65,
    atr14: 1500,
    bbWidth: 0.05,
    macdHistogram: 0.002,
    advanceDeclineRatio: 1.5,
    marketCap: 1000000000000
  };

  // Test the regime change -> capital reallocation -> mutation cycle flow
  test('Regime change should trigger reallocation and mutation cycle', async () => {
    // Get instances
    const memory = AlphaMemory.getInstance();
    const regimeClassifier = RegimeClassifier.getInstance();
    const mutationEngine = StrategyMutationEngine.getInstance();
    const capitalAllocator = RegimeCapitalAllocator.getInstance();
    const portfolioOptimizer = StrategyPortfolioOptimizer.getInstance();
    const telemetryBus = TelemetryBus.getInstance();
    
    // Set up event listeners to track flow
    const eventSequence: string[] = [];
    const telemetryEvents: Record<string, any> = {};
    
    // Track all relevant events
    ['regime_change', 'capital_allocation', 'strategy_mutation', 'portfolio_optimized']
      .forEach(eventType => {
        telemetryBus.on(eventType, (event: any) => {
          eventSequence.push(eventType);
          telemetryEvents[eventType] = event;
        });
      });
    
    // Add test strategies to memory
    for (let i = 1; i <= 5; i++) {
      memory.addRecord({
        strategyId: `test_strategy_${i}`,
        symbol: 'BTC/USD',
        regime: MarketRegime.BullishTrend,
        parameters: { threshold: 0.01 * i, lookback: 10 * i },
        performance: {
          totalReturn: 0.05 * i,
          sharpeRatio: 0.5 * i,
          maxDrawdown: 0.1 / i,
          winRate: 0.5 + (0.05 * i),
          tradeCount: 100,
          avgProfitPerTrade: 0.005 * i,
          profitFactor: 1 + (0.2 * i)
        },
        period: {
          start: new Date(Date.now() - 86400000 * 30), // 30 days ago
          end: new Date(),
          durationMs: 86400000 * 30
        },
        metadata: {
          created: new Date(),
          strategyType: 'Test',
          tags: ['test', 'integration']
        }
      });
    }
    
    // Start the components
    mutationEngine.start();
    capitalAllocator.start();
    portfolioOptimizer.start();
    
    // Simulate a regime classification
    let classification = regimeClassifier.classifyRegime('BTC/USD', mockMarketFeatures);
    expect(classification.primaryRegime).toBeDefined();
    
    // Simulate a regime change
    const newFeatures = { 
      ...mockMarketFeatures,
      returns1d: -0.05,
      returns5d: -0.1,
      returns20d: -0.15,
      rsi14: 30
    };
    
    // This should trigger a new regime (bearish)
    classification = regimeClassifier.classifyRegime('BTC/USD', newFeatures);
    expect(classification.primaryRegime).not.toEqual(MarketRegime.BullishTrend);
    
    // Wait for all async operations to complete
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Manually trigger the allocator and optimizer to avoid waiting for timeout
    await capitalAllocator.updateAllocations();
    await portfolioOptimizer.optimizePortfolio();
    
    // Manually trigger a mutation cycle
    await mutationEngine.executeMutationCycle();
    
    // Wait for events to be processed
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Verify the event sequence
    expect(eventSequence).toContain('regime_change');
    expect(eventSequence).toContain('capital_allocation');
    expect(eventSequence).toContain('portfolio_optimized');
    
    // Get the resulting allocations
    const allocations = capitalAllocator.getAllAllocations();
    expect(allocations.length).toBeGreaterThan(0);
    
    // Get the active strategies from the optimizer
    const activeStrategies = portfolioOptimizer.getActiveStrategies();
    expect(activeStrategies.length).toBeGreaterThan(0);
    
    // Check that strategies are properly weighted
    let totalAllocation = 0;
    for (const allocation of allocations) {
      expect(allocation.finalAllocation).toBeGreaterThanOrEqual(0);
      expect(allocation.finalAllocation).toBeLessThanOrEqual(1);
      totalAllocation += allocation.finalAllocation;
    }
    expect(totalAllocation).toBeGreaterThan(0);
    expect(totalAllocation).toBeLessThanOrEqual(1);
    
    // Clean up
    mutationEngine.stop();
    capitalAllocator.stop();
    portfolioOptimizer.stop();
  });
  
  // Test the strategy degradation -> pruning -> reallocation flow
  test('Strategy degradation should trigger pruning and reallocation', async () => {
    // Get instances
    const memory = AlphaMemory.getInstance();
    const regimeClassifier = RegimeClassifier.getInstance();
    const capitalAllocator = RegimeCapitalAllocator.getInstance();
    const telemetryBus = TelemetryBus.getInstance();
    
    // Import StrategyPruner here to avoid circular dependency
    const { StrategyPruner } = require('../evolution/strategy_pruner');
    const pruner = StrategyPruner.getInstance();
    
    // Set up event listeners to track flow
    const eventSequence: string[] = [];
    
    // Track pruning and reallocation events
    ['strategy_pruned', 'capital_allocation']
      .forEach(eventType => {
        telemetryBus.on(eventType, () => {
          eventSequence.push(eventType);
        });
      });
    
    // Start components
    capitalAllocator.start();
    
    // Add a test strategy that will be pruned
    const poorStrategyId = 'poor_performing_strategy';
    
    // Update metrics for the poor performing strategy
    pruner.updateStrategyMetrics(poorStrategyId, {
      pnl: -0.2,
      sharpeRatio: 0.1,
      maxDrawdown: 0.3,
      winRate: 0.3,
      lastUpdate: Date.now()
    });
    
    // Add some good strategies
    for (let i = 1; i <= 3; i++) {
      const goodStrategyId = `good_strategy_${i}`;
      pruner.updateStrategyMetrics(goodStrategyId, {
        pnl: 0.1 * i,
        sharpeRatio: 1.0 * i,
        maxDrawdown: 0.05,
        winRate: 0.7,
        lastUpdate: Date.now()
      });
    }
    
    // Wait for events to be processed
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Check that the poor strategy was pruned
    const pruningHistory = pruner.getPruningHistory();
    
    // Should have at least one pruning event
    expect(pruningHistory.length).toBeGreaterThan(0);
    
    // Find if our poor strategy was pruned
    const pruningEvent = pruningHistory.find((e: any) => e.strategyId === poorStrategyId);
    expect(pruningEvent).toBeDefined();
    
    // Manually trigger allocation update
    await capitalAllocator.updateAllocations();
    
    // Wait for events to be processed
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Check event sequence
    expect(eventSequence).toContain('capital_allocation');
    
    // Get allocations
    const allocations = capitalAllocator.getAllAllocations();
    
    // Check that the poor strategy is not allocated capital
    const poorStrategyAlloc = allocations.find(a => a.strategyId === poorStrategyId);
    expect(poorStrategyAlloc).toBeUndefined();
    
    // Clean up
    capitalAllocator.stop();
  });
  
  // Test memory feedback loop: strategy performance -> memory -> parameter updates
  test('Strategy performance should feed back into parameter optimization', async () => {
    // This test simulates the feedback loop where strategy performance is recorded
    // in AlphaMemory and then used to optimize parameters for future strategy instances
    
    // Get instances
    const memory = AlphaMemory.getInstance();
    const regimeClassifier = RegimeClassifier.getInstance();
    
    // Create regime classification
    const classification = regimeClassifier.classifyRegime('BTC/USD', mockMarketFeatures);
    const regime = classification.primaryRegime;
    
    // Add multiple performance records for a strategy with different parameters
    const strategyId = 'adaptive_test_strategy';
    const testSymbol = 'BTC/USD';
    
    // Add records with different parameters and performance scores
    const paramSets = [
      { threshold: 0.01, lookback: 10, multiplier: 1.5 },
      { threshold: 0.02, lookback: 20, multiplier: 2.0 },
      { threshold: 0.03, lookback: 30, multiplier: 2.5 },
      { threshold: 0.01, lookback: 20, multiplier: 3.0 },
      { threshold: 0.02, lookback: 30, multiplier: 3.5 }
    ];
    
    // Performance metrics - make the third set the best performer
    const performances = [
      { totalReturn: 0.05, sharpeRatio: 0.5, maxDrawdown: 0.1, winRate: 0.55 },
      { totalReturn: 0.08, sharpeRatio: 0.8, maxDrawdown: 0.08, winRate: 0.6 },
      { totalReturn: 0.15, sharpeRatio: 1.5, maxDrawdown: 0.05, winRate: 0.7 }, // Best
      { totalReturn: 0.07, sharpeRatio: 0.7, maxDrawdown: 0.09, winRate: 0.58 },
      { totalReturn: 0.1, sharpeRatio: 1.0, maxDrawdown: 0.07, winRate: 0.65 }
    ];
    
    // Add all records to memory
    for (let i = 0; i < paramSets.length; i++) {
      memory.addRecord({
        strategyId,
        symbol: testSymbol,
        regime,
        parameters: paramSets[i],
        performance: {
          ...performances[i],
          tradeCount: 100,
          avgProfitPerTrade: performances[i].totalReturn / 100,
          profitFactor: performances[i].totalReturn > 0 ? 
            performances[i].totalReturn / (performances[i].maxDrawdown * 0.5) : 0
        },
        period: {
          start: new Date(Date.now() - 86400000 * (30 - i)), // Staggered dates
          end: new Date(Date.now() - 86400000 * (25 - i)),
          durationMs: 86400000 * 5
        },
        metadata: {
          created: new Date(Date.now() - 86400000 * (30 - i)),
          strategyType: 'Adaptive',
          tags: ['test', 'adaptive']
        }
      });
    }
    
    // Now query the best parameters
    const bestParams = memory.findBestParameters(strategyId, testSymbol, regime);
    
    // The best parameters should be from the third set (index 2)
    expect(bestParams).toBeDefined();
    expect(bestParams?.threshold).toBe(paramSets[2].threshold);
    expect(bestParams?.lookback).toBe(paramSets[2].lookback);
    expect(bestParams?.multiplier).toBe(paramSets[2].multiplier);
    
    // Test memory summary
    const summary = memory.getMemorySummary();
    expect(summary.totalRecords).toBe(paramSets.length);
    expect(summary.strategiesCount).toBe(1);
    expect(summary.bestSharpe).toBe(performances[2].sharpeRatio);
  });
}); 