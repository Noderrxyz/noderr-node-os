import { StrategyEngineRust, StrategyEngineConfig, RiskGrade, ExecutionHorizon, SignalStatus } from '@noderr/execution/src/StrategyEngineRust';
import { StrategyEngineJs } from '@noderr/execution/src/StrategyEngineJs';
import { Signal } from '@noderr/types/strategy';
import { ExecutionStatus } from '@noderr/types/execution';

// Mock the dependencies
jest.mock('../../execution/SmartOrderRouterRust', () => ({
  SmartOrderRouterRust: {
    getInstance: jest.fn().mockImplementation(() => ({
      executeOrder: jest.fn().mockImplementation((order) => 
        Promise.resolve({
          id: 'exec-123',
          signalId: order.signalId,
          status: ExecutionStatus.Completed,
          timestamp: new Date(),
          executionTimeMs: 125,
          averagePrice: order.price * 1.001, // Small slippage
          executedQuantity: order.amount,
          realizedPnl: 0,
        })
      ),
    })),
  },
}));

jest.mock('../../execution/SmartOrderRouterJs', () => ({
  SmartOrderRouterJs: {
    getInstance: jest.fn().mockImplementation(() => ({
      executeOrder: jest.fn().mockImplementation((order) => 
        Promise.resolve({
          id: 'exec-123',
          signalId: order.signalId,
          status: ExecutionStatus.Completed,
          timestamp: new Date(),
          executionTimeMs: 150,
          averagePrice: order.price * 1.002, // More slippage in JS fallback
          executedQuantity: order.amount,
          realizedPnl: 0,
        })
      ),
    })),
  },
}));

jest.mock('../../risk/RiskCalculatorRust', () => ({
  RiskCalculatorRust: {
    getInstance: jest.fn().mockImplementation(() => ({
      checkSignal: jest.fn().mockImplementation(() => 
        Promise.resolve({
          passed: true,
          violations: [],
        })
      ),
    })),
  },
}));

jest.mock('../../risk/RiskCalculatorJs', () => ({
  RiskCalculatorJs: {
    getInstance: jest.fn().mockImplementation(() => ({
      checkSignal: jest.fn().mockImplementation(() => 
        Promise.resolve({
          passed: true,
          violations: [],
        })
      ),
    })),
  },
}));

// Mock the native binding
jest.mock('@noderr/core', () => ({
  NapiStrategyEngine: jest.fn().mockImplementation(() => ({
    executeStrategy: jest.fn().mockImplementation(() => Promise.resolve({
      id: 'exec-123',
      signalId: 'signal-123',
      status: 0, // Completed
      timestamp: Date.now(),
      execution_time_ms: 100,
      average_price: 35050,
      executed_quantity: 0.05,
      realized_pnl: 0,
    })),
    evaluateSignal: jest.fn().mockImplementation(() => Promise.resolve({
      signal_id: 'signal-123',
      passed: true,
      execution_probability: 0.85,
      expected_impact: 0.5,
      expected_slippage_pct: 0.1,
      trust_score: 0.9,
      risk_violations: '[]',
      is_latency_critical: true,
      recommended_position_size_pct: 0.05,
      latency_budget_ms: 100,
      timestamp: Date.now(),
    })),
    calculateSignalMetrics: jest.fn().mockImplementation(() => ({
      signal_id: 'signal-123',
      strategy_id: 'strategy-123',
      symbol: 'BTC/USD',
      generation_time: Date.now() - 1000,
      execution_time: Date.now(),
      execution_latency_ms: 1000,
      confidence: 0.9,
      strength: 0.8,
      success: true,
      price: 35000,
      execution_price: 35050,
      slippage_pct: 0.143,
      direction: 1,
      position_size: 0.05,
      trust_score: 0.9,
      status: 2, // Executed
      risk_grade: 1, // Medium
      execution_horizon: 1, // ShortTerm
      pnl: 0,
      additional_metrics: '{}'
    })),
    updateConfig: jest.fn(),
    getConfig: jest.fn().mockImplementation(() => ({
      dryrun_mode: false,
      apply_risk_checks: true,
      min_trust_score: 0.6,
      max_slippage_pct: 0.5,
      engine_mode: 0, // Normal
      confidence_based_sizing: true,
      require_price: true,
      default_execution_horizon: 1 // ShortTerm
    })),
  })),
}));

describe('StrategyEngineRust', () => {
  let engine: StrategyEngineRust;
  let defaultConfig: StrategyEngineConfig;
  let testSignal: Signal;

  beforeEach(() => {
    defaultConfig = {
      dryrunMode: false,
      applyRiskChecks: true,
      minTrustScore: 0.6,
      maxSlippagePct: 0.5,
      engineMode: 0, // Normal
      confidenceBasedSizing: true,
      requirePrice: true,
      defaultExecutionHorizon: ExecutionHorizon.ShortTerm
    };

    testSignal = {
      id: 'signal-123',
      strategyId: 'strategy-123',
      symbol: 'BTC/USD',
      action: 1, // Enter
      direction: 1, // Long
      price: 35000,
      confidence: 0.9,
      strength: 0.8,
      timestamp: new Date(),
      riskGrade: RiskGrade.Medium,
      executionHorizon: ExecutionHorizon.ShortTerm,
      trustVector: {
        'signal_quality': 0.9,
        'market_context': 0.85
      }
    };

    // Reset mocks
    jest.clearAllMocks();

    // Initialize engine
    engine = StrategyEngineRust.getInstance();
  });

  test('should be created as singleton', () => {
    const instance1 = StrategyEngineRust.getInstance();
    const instance2 = StrategyEngineRust.getInstance();
    
    expect(instance1).toBe(instance2);
  });

  test('should execute strategy with valid signal', async () => {
    const result = await engine.executeStrategy(testSignal);
    
    expect(result).toBeDefined();
    expect(result.signalId).toBe(testSignal.id);
    expect(result.status).toBe(ExecutionStatus.Completed);
    expect(result.executionTimeMs).toBeGreaterThan(0);
  });

  test('should evaluate signal and return evaluation result', async () => {
    const evaluation = await engine.evaluateSignal(testSignal);
    
    expect(evaluation).toBeDefined();
    expect(evaluation.signalId).toBe(testSignal.id);
    expect(evaluation.passed).toBe(true);
    expect(evaluation.trustScore).toBeGreaterThan(0);
    expect(evaluation.executionProbability).toBeGreaterThan(0);
    expect(evaluation.latencyBudgetMs).toBeGreaterThan(0);
  });

  test('should calculate signal metrics', () => {
    const executionResult = {
      id: 'exec-123',
      signalId: testSignal.id,
      status: ExecutionStatus.Completed,
      timestamp: new Date(),
      executionTimeMs: 125,
      averagePrice: 35050,
      executedQuantity: 0.05,
      realizedPnl: 0,
    };
    
    const metrics = engine.calculateSignalMetrics(testSignal, executionResult);
    
    expect(metrics).toBeDefined();
    expect(metrics.signalId).toBe(testSignal.id);
    expect(metrics.strategyId).toBe(testSignal.strategyId);
    expect(metrics.symbol).toBe(testSignal.symbol);
    expect(metrics.confidence).toBe(testSignal.confidence);
    expect(metrics.strength).toBe(testSignal.strength);
    expect(metrics.executionLatencyMs).toBeDefined();
    expect(metrics.slippagePct).toBeDefined();
  });

  test('should update and get config', () => {
    const newConfig = {
      dryrunMode: true,
      minTrustScore: 0.7
    };
    
    engine.updateConfig(newConfig);
    const config = engine.getConfig();
    
    expect(config.dryrunMode).toBe(true);
    expect(config.minTrustScore).toBe(0.7);
    expect(config.applyRiskChecks).toBe(defaultConfig.applyRiskChecks);
  });
});

describe('StrategyEngineJs', () => {
  let engine: StrategyEngineJs;
  let defaultConfig: StrategyEngineConfig;
  let testSignal: Signal;

  beforeEach(() => {
    defaultConfig = {
      dryrunMode: false,
      applyRiskChecks: true,
      minTrustScore: 0.6,
      maxSlippagePct: 0.5,
      engineMode: 0, // Normal
      confidenceBasedSizing: true,
      requirePrice: true,
      defaultExecutionHorizon: ExecutionHorizon.ShortTerm
    };

    testSignal = {
      id: 'signal-123',
      strategyId: 'strategy-123',
      symbol: 'BTC/USD',
      action: 1, // Enter
      direction: 1, // Long
      price: 35000,
      confidence: 0.9,
      strength: 0.8,
      timestamp: new Date(),
      riskGrade: RiskGrade.Medium,
      executionHorizon: ExecutionHorizon.ShortTerm,
      trustVector: {
        'signal_quality': 0.9,
        'market_context': 0.85
      }
    };

    // Reset mocks
    jest.clearAllMocks();

    // Initialize engine
    engine = new StrategyEngineJs(defaultConfig);
  });

  test('should execute strategy with valid signal', async () => {
    const result = await engine.executeStrategy(testSignal);
    
    expect(result).toBeDefined();
    expect(result.signalId).toBe(testSignal.id);
    expect(result.status).toBe(ExecutionStatus.Completed);
    expect(result.executionTimeMs).toBeGreaterThan(0);
  });

  test('should evaluate signal and return evaluation result', async () => {
    const evaluation = await engine.evaluateSignal(testSignal);
    
    expect(evaluation).toBeDefined();
    expect(evaluation.signalId).toBe(testSignal.id);
    expect(evaluation.passed).toBe(true);
    expect(evaluation.trustScore).toBeGreaterThan(0);
    expect(evaluation.executionProbability).toBeGreaterThan(0);
    expect(evaluation.latencyBudgetMs).toBeGreaterThan(0);
  });

  test('should calculate signal metrics', () => {
    const executionResult = {
      id: 'exec-123',
      signalId: testSignal.id,
      status: ExecutionStatus.Completed,
      timestamp: new Date(),
      executionTimeMs: 125,
      averagePrice: 35050,
      executedQuantity: 0.05,
      realizedPnl: 0,
    };
    
    const metrics = engine.calculateSignalMetrics(testSignal, executionResult);
    
    expect(metrics).toBeDefined();
    expect(metrics.signalId).toBe(testSignal.id);
    expect(metrics.strategyId).toBe(testSignal.strategyId);
    expect(metrics.symbol).toBe(testSignal.symbol);
    expect(metrics.confidence).toBe(testSignal.confidence);
    expect(metrics.strength).toBe(testSignal.strength);
    expect(metrics.executionLatencyMs).toBeDefined();
    expect(metrics.slippagePct).toBeDefined();
  });

  test('should handle signal with missing required price', async () => {
    const signalWithoutPrice = { ...testSignal, price: undefined };
    engine.updateConfig({ requirePrice: true });
    
    await expect(engine.evaluateSignal(signalWithoutPrice)).rejects.toThrow();
  });

  test('should handle invalid trust vector', () => {
    const signalWithBadTrust = { ...testSignal, trustVector: undefined };
    
    const metrics = engine.calculateSignalMetrics(signalWithBadTrust);
    
    expect(metrics).toBeDefined();
    expect(metrics.trustScore).toBeUndefined();
  });

  test('should update and get config', () => {
    const newConfig = {
      dryrunMode: true,
      minTrustScore: 0.7
    };
    
    engine.updateConfig(newConfig);
    const config = engine.getConfig();
    
    expect(config.dryrunMode).toBe(true);
    expect(config.minTrustScore).toBe(0.7);
    expect(config.applyRiskChecks).toBe(defaultConfig.applyRiskChecks);
  });
}); 