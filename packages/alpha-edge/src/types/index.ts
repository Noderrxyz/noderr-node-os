/**
 * Alpha Edge Types - World-class trading infrastructure types
 */

// Ethers v6 migration: Removed unused BigNumber imports

// ==================== MICROSTRUCTURE TYPES ====================

export interface OrderBookLevel {
  price: number;
  quantity: number;
  orders: number;
  timestamp: number;
}

export interface OrderBookSnapshot {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  timestamp: number;
  venue: string;
  symbol: string;
}

export interface OrderFlowImbalance {
  ratio: number;
  buyPressure: number;
  sellPressure: number;
  netFlow: number;
  confidence: number;
}

export interface MicrostructureSignal {
  type: 'liquidity_shift' | 'price_discovery' | 'momentum_change' | 'regime_shift';
  strength: number; // 0-1
  direction: 'bullish' | 'bearish' | 'neutral';
  timeframe: number; // milliseconds
  components: {
    orderbook: number;
    trades: number;
    volatility: number;
    correlation: number;
  };
}

export interface LiquidityMap {
  levels: Array<{
    price: number;
    realLiquidity: number;
    spoofProbability: number;
    stability: number;
  }>;
  venueName: string;
  lastUpdate: number;
}

export interface VolatilityForecast {
  symbol: string;
  currentVolatility: number;
  predictedVolatility: {
    '1min': number;
    '5min': number;
    '15min': number;
    '1hour': number;
  };
  regime: 'low' | 'normal' | 'high' | 'extreme';
  confidence: number;
  drivers: string[];
}

// ==================== ARBITRAGE TYPES ====================

export interface ArbitrageOpportunity {
  id: string;
  type: 'triangular' | 'cross_venue' | 'statistical' | 'latency' | 'funding';
  profitEstimate: number;
  probability: number;
  requiredCapital: number;
  executionTime: number;
  riskScore: number;
  venues: string[];
  assets: string[];
  expiryTime: number;
}

export interface CrossChainArbitrage extends ArbitrageOpportunity {
  sourceChain: string;
  targetChain: string;
  bridgeProtocol: string;
  gasEstimate: {
    source: number;
    target: number;
  };
  slippageTolerance: number;
}

export interface StatisticalArbitrage {
  pairId: string;
  assets: [string, string];
  correlation: number;
  cointegration: {
    value: number;
    pValue: number;
    halfLife: number;
  };
  zScore: number;
  entryThreshold: number;
  exitThreshold: number;
  currentSpread: number;
  historicalMean: number;
  confidence: number;
}

export interface ArbitrageRoute {
  steps: Array<{
    action: 'swap' | 'bridge' | 'lend' | 'borrow';
    venue: string;
    inputAsset: string;
    outputAsset: string;
    inputAmount: number;
    expectedOutput: number;
    gasEstimate: number;
  }>;
  totalProfit: number;
  totalGas: number;
  executionTime: number;
  atomicity: boolean;
}

// ==================== RISK ANALYTICS TYPES ====================

export interface TailRiskMetrics {
  valueAtRisk: {
    confidence95: number;
    confidence99: number;
    confidence999: number;
  };
  conditionalVaR: {
    confidence95: number;
    confidence99: number;
  };
  maxDrawdown: {
    historical: number;
    expected: number;
    worstCase: number;
  };
  stressScenarios: Array<{
    name: string;
    probability: number;
    impact: number;
    hedgeCost: number;
  }>;
}

export interface RegimeDetection {
  currentRegime: 'bull' | 'bear' | 'sideways' | 'volatile' | 'crisis';
  confidence: number;
  transitionProbability: {
    toBull: number;
    toBear: number;
    toSideways: number;
    toVolatile: number;
    toCrisis: number;
  };
  indicators: {
    trend: number;
    volatility: number;
    correlation: number;
    liquidity: number;
    sentiment: number;
  };
  expectedDuration: number; // hours
}

export interface PortfolioOptimization {
  currentAllocation: Record<string, number>;
  optimalAllocation: Record<string, number>;
  expectedReturn: number;
  expectedRisk: number;
  sharpeRatio: number;
  diversificationRatio: number;
  concentrationRisk: number;
  rebalancingCost: number;
  constraints: {
    maxPosition: number;
    minPosition: number;
    maxSector: number;
    maxCorrelation: number;
  };
}

export interface DynamicHedge {
  portfolio: string[];
  hedgeInstruments: Array<{
    instrument: string;
    hedge_ratio: number;
    cost: number;
    effectiveness: number;
  }>;
  totalCost: number;
  riskReduction: number;
  breakEvenMove: number;
  maxLoss: number;
  rebalanceFrequency: number;
}

// ==================== LIQUIDITY PROVISION TYPES ====================

export interface MarketMakingOpportunity {
  pair: string;
  venue: string;
  currentSpread: number;
  optimalSpread: number;
  volumeProfile: {
    avg24h: number;
    current: number;
    trend: 'increasing' | 'decreasing' | 'stable';
  };
  competitorCount: number;
  inventoryRisk: number;
  expectedProfit: number;
  requiredCapital: number;
}

export interface SpreadOptimization {
  bidSpread: number;
  askSpread: number;
  skew: number; // positive = bullish, negative = bearish
  inventoryAdjustment: number;
  competitiveAdjustment: number;
  volatilityAdjustment: number;
  targetInventory: {
    base: number;
    quote: number;
  };
}

export interface InventoryManagement {
  currentInventory: Record<string, number>;
  targetInventory: Record<string, number>;
  imbalance: Record<string, number>;
  hedgeRequired: boolean;
  rebalanceActions: Array<{
    asset: string;
    action: 'buy' | 'sell';
    amount: number;
    urgency: 'low' | 'medium' | 'high';
  }>;
  maxExposure: Record<string, number>;
  utilizationRate: number;
}

export interface ImpermanentLossProtection {
  position: {
    pool: string;
    assets: [string, string];
    amounts: [number, number];
    entryPrice: number;
  };
  currentIL: number;
  projectedIL: {
    pessimistic: number;
    expected: number;
    optimistic: number;
  };
  hedgeStrategy: {
    type: 'options' | 'perps' | 'dynamic';
    cost: number;
    effectiveness: number;
    breakeven: number;
  };
}

// ==================== STATISTICAL ARBITRAGE TYPES ====================

export interface PairsTradingSignal {
  pair: [string, string];
  zScore: number;
  meanReversion: {
    probability: number;
    expectedTime: number; // hours
    targetPrice: number;
  };
  signal: 'long_spread' | 'short_spread' | 'neutral';
  confidence: number;
  historicalWinRate: number;
  kellySize: number; // optimal position size
}

export interface FactorExposure {
  factors: {
    momentum: number;
    value: number;
    size: number;
    volatility: number;
    liquidity: number;
    quality: number;
  };
  customFactors: Record<string, number>;
  riskContribution: Record<string, number>;
  factorReturns: Record<string, number>;
  orthogonality: number; // 0-1, higher = more independent
}

export interface CointegrationAnalysis {
  assets: string[];
  cointegrationMatrix: number[][];
  eigenvalues: number[];
  eigenvectors: number[][];
  stationaryPortfolios: Array<{
    weights: Record<string, number>;
    halfLife: number;
    variance: number;
    sharpeRatio: number;
  }>;
  johanesenStats: {
    trace: number;
    maxEigen: number;
    criticalValues: {
      '90%': number;
      '95%': number;
      '99%': number;
    };
  };
}

export interface MeanReversionSignal {
  asset: string;
  currentValue: number;
  mean: {
    sma20: number;
    sma50: number;
    vwap: number;
    bollinger: {
      middle: number;
      upper: number;
      lower: number;
    };
  };
  deviation: number;
  reversionProbability: number;
  expectedReturn: number;
  timeToReversion: number;
  stopLoss: number;
  takeProfit: number;
}

// ==================== INTEGRATION TYPES ====================

export interface AlphaSignal {
  id: string;
  source: 'microstructure' | 'arbitrage' | 'statistical' | 'liquidity' | 'risk';
  strength: number; // 0-1
  confidence: number; // 0-1
  expectedReturn: number;
  riskAdjustedReturn: number;
  timeHorizon: number; // milliseconds
  capitalRequired: number;
  priority: 'critical' | 'high' | 'medium' | 'low';
  metadata: any;
}

export interface ExecutionPlan {
  signals: AlphaSignal[];
  allocations: Array<{
    signal: AlphaSignal;
    capital: number;
    weight: number;
  }>;
  totalCapital: number;
  expectedReturn: number;
  maxDrawdown: number;
  executionSteps: Array<{
    step: number;
    action: string;
    params: any;
    dependency?: number;
  }>;
  contingencies: Array<{
    condition: string;
    action: string;
  }>;
}

export interface PerformanceMetrics {
  pnl: {
    realized: number;
    unrealized: number;
    total: number;
  };
  returns: {
    daily: number;
    weekly: number;
    monthly: number;
    yearly: number;
  };
  riskMetrics: {
    sharpe: number;
    sortino: number;
    calmar: number;
    maxDrawdown: number;
    var95: number;
  };
  executionMetrics: {
    fillRate: number;
    slippage: number;
    timing: number;
    costs: number;
  };
  alphaAttribution: Record<string, number>;
} 