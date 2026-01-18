/**
 * Quant Research Types - Elite quantitative analysis and strategy development
 */

// Core Strategy Types
export interface TradingStrategy {
  id: string;
  name: string;
  description: string;
  type: StrategyType;
  parameters: StrategyParameters;
  indicators: string[];
  entryRules: TradingRule[];
  exitRules: TradingRule[];
  riskManagement: RiskParameters;
  performance?: StrategyPerformance;
  metadata: {
    created: Date;
    updated: Date;
    author: string;
    version: string;
    tags: string[];
  };
}

export enum StrategyType {
  MOMENTUM = 'momentum',
  MEAN_REVERSION = 'mean_reversion',
  ARBITRAGE = 'arbitrage',
  MARKET_MAKING = 'market_making',
  TREND_FOLLOWING = 'trend_following',
  PAIRS_TRADING = 'pairs_trading',
  STATISTICAL_ARBITRAGE = 'statistical_arbitrage',
  ML_BASED = 'ml_based',
  HYBRID = 'hybrid'
}

export interface StrategyParameters {
  // Common parameters
  lookbackPeriod: number;
  rebalanceFrequency: string; // '1m', '5m', '1h', '1d'
  minVolume: number;
  maxPositions: number;
  
  // Strategy-specific parameters
  [key: string]: any;
}

export interface TradingRule {
  id: string;
  type: 'entry' | 'exit';
  condition: RuleCondition;
  action: RuleAction;
  priority: number;
}

export interface RuleCondition {
  type: 'simple' | 'composite' | 'ml';
  indicator?: string;
  operator?: ComparisonOperator;
  value?: number | string;
  children?: RuleCondition[]; // For composite conditions
  model?: string; // For ML conditions
}

export enum ComparisonOperator {
  GT = '>',
  GTE = '>=',
  LT = '<',
  LTE = '<=',
  EQ = '==',
  NEQ = '!=',
  CROSSES_ABOVE = 'crosses_above',
  CROSSES_BELOW = 'crosses_below'
}

export interface RuleAction {
  type: 'buy' | 'sell' | 'close' | 'reverse';
  sizeType: 'fixed' | 'percentage' | 'risk_based' | 'kelly';
  size: number;
  orderType: 'market' | 'limit' | 'stop';
  limitOffset?: number; // For limit orders
}

// Risk Management
export interface RiskParameters {
  maxDrawdown: number;
  stopLoss?: number;
  takeProfit?: number;
  trailingStop?: number;
  positionSizing: PositionSizingMethod;
  maxLeverage: number;
  correlationLimit: number;
  varLimit?: number; // Value at Risk
}

export enum PositionSizingMethod {
  FIXED = 'fixed',
  PERCENTAGE = 'percentage',
  KELLY = 'kelly',
  RISK_PARITY = 'risk_parity',
  VOLATILITY_BASED = 'volatility_based',
  ATR_BASED = 'atr_based'
}

// Backtesting Types
export interface BacktestConfig {
  strategy: TradingStrategy;
  startDate: Date;
  endDate: Date;
  initialCapital: number;
  dataFrequency: string; // '1m', '5m', '1h', '1d'
  includeFees: boolean;
  feeStructure?: FeeStructure;
  slippage?: SlippageModel;
  marginRequirements?: MarginConfig;
  marketImpact?: boolean;
}

export interface FeeStructure {
  maker: number;
  taker: number;
  funding?: number; // For perpetuals
  borrowing?: number; // For margin trading
}

export interface SlippageModel {
  type: 'fixed' | 'linear' | 'square_root' | 'custom';
  baseSlippage: number;
  impactCoefficient?: number;
  customFunction?: (size: number, liquidity: number) => number;
}

export interface MarginConfig {
  initialMargin: number;
  maintenanceMargin: number;
  maxLeverage: number;
  autoDeleveraging: boolean;
}

export interface BacktestResult {
  strategyId: string;
  config: BacktestConfig;
  performance: StrategyPerformance;
  trades: Trade[];
  equity: EquityCurve;
  equityCurve?: number[]; // Added for compatibility
  drawdowns: Drawdown[];
  riskMetrics: RiskMetrics;
  executionStats: ExecutionStats;
  initialCapital: number;
}

export interface StrategyPerformance {
  totalReturn: number;
  annualizedReturn: number;
  volatility: number;
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  maxDrawdown: number;
  winRate: number;
  profitFactor: number;
  averageWin: number;
  averageLoss: number;
  expectancy: number;
  trades: number;
}

export interface Trade {
  id: string;
  entryTime: Date;
  exitTime?: Date;
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  exitPrice?: number;
  size: number;
  fees: number;
  pnl?: number;
  pnlPercent?: number;
  holdingPeriod?: number;
  mae: number; // Maximum Adverse Excursion
  mfe: number; // Maximum Favorable Excursion
}

export interface EquityCurve {
  timestamps: Date[];
  values: number[];
  returns: number[];
  drawdown: number[];
}

export interface Drawdown {
  start: Date;
  end?: Date;
  peak: number;
  trough: number;
  depth: number;
  duration?: number;
  recovery?: number;
}

export interface RiskMetrics {
  totalReturn: number;
  annualizedReturn: number;
  volatility: number;
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  maxDrawdown: number;
  avgDrawdown: number;
  maxDrawdownDuration: number;
  winRate: number;
  profitFactor: number;
  payoffRatio: number;
  informationRatio: number;
  beta: number;
  alpha: number;
  treynorRatio: number;
  var95: number; // Value at Risk 95%
  var99: number; // Value at Risk 99%
  cvar95: number; // Conditional VaR 95%
  cvar99: number; // Conditional VaR 99%
  maxLoss: number;
  avgTradesPerDay: number;
  avgHoldingPeriod: number;
  turnover: number;
  alphaDecay: number;
  omega?: number;
  kurtosis?: number;
  skewness?: number;
  correlation?: number;
}

export interface ExecutionStats {
  totalOrders: number;
  filledOrders: number;
  partialFills: number;
  rejectedOrders: number;
  averageSlippage: number;
  totalFees: number;
  averageLatency: number;
}

// Optimization Types
export interface OptimizationConfig {
  strategy: TradingStrategy;
  parameters: ParameterRange[];
  objective: OptimizationObjective;
  method: OptimizationMethod;
  constraints?: OptimizationConstraint[];
  walkForward?: WalkForwardConfig;
  parallelJobs?: number;
  maxIterations?: number;
  convergenceTolerance?: number;
}

export interface ParameterRange {
  name: string;
  type: 'continuous' | 'discrete' | 'categorical';
  min?: number;
  max?: number;
  step?: number;
  values?: any[];
}

export enum OptimizationObjective {
  SHARPE_RATIO = 'sharpe_ratio',
  TOTAL_RETURN = 'total_return',
  CALMAR_RATIO = 'calmar_ratio',
  SORTINO_RATIO = 'sortino_ratio',
  PROFIT_FACTOR = 'profit_factor',
  WIN_RATE = 'win_rate',
  CUSTOM = 'custom'
}

export enum OptimizationMethod {
  GRID_SEARCH = 'grid_search',
  RANDOM_SEARCH = 'random_search',
  BAYESIAN = 'bayesian',
  GENETIC = 'genetic',
  PSO = 'particle_swarm',
  DIFFERENTIAL_EVOLUTION = 'differential_evolution'
}

export interface OptimizationConstraint {
  type: 'min' | 'max' | 'equal';
  metric: string;
  value: number;
}

export interface WalkForwardConfig {
  windowSize: number; // Training window
  stepSize: number; // Step forward size
  minSamples: number; // Minimum samples for training
  outOfSampleRatio: number; // Ratio for out-of-sample testing
}

export interface OptimizationResult {
  bestParameters: { [key: string]: any };
  bestScore: number;
  iterations: number;
  convergenceHistory: number[];
  parameterImportance?: { [key: string]: number };
  robustnessScore?: number;
  outOfSamplePerformance?: StrategyPerformance;
}

// Research Tools
export interface ResearchDataset {
  id: string;
  name: string;
  description: string;
  symbols: string[];
  timeframe: string;
  frequency?: string;
  startDate: Date;
  endDate: Date;
  features: Feature[];
  size: number;
  format: 'csv' | 'parquet' | 'hdf5' | 'pickle';
  path: string;
  data?: HistoricalData;
  metadata?: { [key: string]: any };
}

export interface Feature {
  name: string;
  type: 'price' | 'volume' | 'indicator' | 'fundamental' | 'sentiment' | 'onchain';
  dataType: 'numeric' | 'categorical' | 'boolean';
  description?: string;
  source?: string;
}

export interface ResearchExperiment {
  id: string;
  name: string;
  hypothesis: string;
  dataset: string;
  methodology: string;
  results: ExperimentResults;
  conclusion: string;
  timestamp: Date;
}

export interface ExperimentResults {
  statistics: { [key: string]: any };
  visualizations: string[]; // Paths to saved plots
  models?: string[]; // Paths to saved models
  insights: string[];
}

// Factor Models
export interface FactorModel {
  id: string;
  name: string;
  factors: Factor[];
  weights: number[];
  correlationMatrix?: number[][];
  method: 'linear' | 'nonlinear' | 'ml';
  performance: FactorPerformance | any;
  principalComponents?: number[][];
  explainedVariance?: number[];
  createdAt?: Date;
}

export interface Factor {
  id: string;
  name: string;
  category: 'value' | 'momentum' | 'quality' | 'sentiment' | 'technical' | 'macro';
  calculation: string; // Formula or description
  weight?: number;
  importance?: number;
  correlation?: number;
}

export interface FactorPerformance {
  factorId?: string;
  ic: number; // Information Coefficient
  icir: number; // IC Information Ratio
  factorReturns: number[];
  returns?: number[];
  factorSharpe: number;
  sharpeRatio?: number;
  informationRatio?: number;
  turnover: number;
  capacity: number;
}

// Portfolio Construction
export interface Portfolio {
  id: string;
  name: string;
  assets: Asset[];
  weights: number[];
  totalValue?: number;
  constraints: PortfolioConstraint[];
  objective: PortfolioObjective;
  rebalanceFrequency: string;
  performance?: PortfolioPerformance;
  metrics?: any;
}

export interface Asset {
  id: string;
  symbol: string;
  type: 'spot' | 'perpetual' | 'option' | 'defi';
  weight: number;
  targetWeight?: number;
  expectedReturn?: number;
  volatility?: number;
  constraints?: AssetConstraint;
}

export interface AssetConstraint {
  minWeight?: number;
  maxWeight?: number;
  minHolding?: number;
  maxHolding?: number;
}

export interface PortfolioConstraint {
  type: 'weight' | 'exposure' | 'turnover' | 'risk';
  limit: number;
  assets?: string[]; // Specific assets, or all if not specified
}

export enum PortfolioObjective {
  MAX_SHARPE = 'max_sharpe',
  MIN_VARIANCE = 'min_variance',
  MAX_RETURN = 'max_return',
  RISK_PARITY = 'risk_parity',
  MAX_DIVERSIFICATION = 'max_diversification',
  TARGET_RETURN = 'target_return',
  TARGET_RISK = 'target_risk'
}

export interface PortfolioPerformance {
  returns: number[];
  volatility: number;
  sharpeRatio: number;
  diversificationRatio: number;
  effectiveAssets: number;
  turnover: number;
  costs: number;
}

// Statistical Models
export interface TimeSeriesModel {
  id: string;
  type: 'ARIMA' | 'GARCH' | 'LSTM' | 'Prophet' | 'arima' | 'garch' | 'var' | 'lstm' | 'transformer';
  parameters: { [key: string]: any };
  fitted: boolean;
  fittedParameters?: { [key: string]: any };
  metrics?: ModelMetrics;
}

export interface ModelMetrics {
  mse: number;
  mae: number;
  rmse: number;
  mape: number;
  r2: number;
  aic: number;
  bic: number;
  logLikelihood?: number;
}

// Service Interface
export interface IQuantResearchService {
  // Strategy Development
  createStrategy(config: Partial<TradingStrategy>): Promise<TradingStrategy>;
  backtest(config: BacktestConfig): Promise<BacktestResult>;
  optimizeStrategy(config: OptimizationConfig): Promise<OptimizationResult>;
  
  // Research Tools
  loadDataset(id: string): Promise<ResearchDataset>;
  runExperiment(experiment: ResearchExperiment): Promise<ExperimentResults>;
  
  // Factor Analysis
  createFactorModel(factors: Factor[]): Promise<FactorModel>;
  analyzeFactors(model: FactorModel, data: any): Promise<FactorPerformance>;
  
  // Portfolio Construction
  constructPortfolio(config: Portfolio): Promise<Portfolio>;
  optimizePortfolio(portfolio: Portfolio, objective: PortfolioObjective): Promise<Portfolio>;
  
  // Statistical Analysis
  fitTimeSeries(data: number[], model: TimeSeriesModel): Promise<ModelMetrics>;
  forecast(model: TimeSeriesModel, steps: number): Promise<number[]>;
}

// Additional types for new components
export interface HistoricalData {
  symbols: string[];
  startDate: Date;
  endDate: Date;
  frequency: string;
  data: { [symbol: string]: OHLCV[] };
}

export interface OHLCV {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface AssetData {
  symbol: string;
  name: string;
  sector: string;
  marketCap: number;
  volume24h: number;
  circulatingSupply: number;
  price: number;
  returns: number;
  volatility: number;
  beta: number;
  correlations: { [symbol: string]: number };
}

export interface ForecastResult {
  forecast: number[];
  confidenceInterval?: {
    lower: number[];
    upper: number[];
  };
  model: TimeSeriesModel;
} 
// Risk Model
export interface RiskModel {
  id: string;
  name: string;
  type: 'parametric' | 'historical' | 'monte_carlo';
  parameters: { [key: string]: any };
  covarianceMatrix?: number[][];
  expectedReturns?: number[];
  riskFactors?: Factor[];
}

// Additional exports for FactorAnalyzer
export interface FactorExposure {
  [factorId: string]: number;
}

export interface FactorResilience {
  factor: Factor;
  volatility: number;
  maxDrawdown: number;
  recoveryTime: number;
  stability: number;
}


export interface FactorCorrelation {
  factorId1: string;
  factorId2: string;
  correlation: number;
  pValue?: number;
}

export interface FactorAnalysisResult {
  factors: Factor[];
  correlations: FactorCorrelation[];
  performance: FactorPerformance[];
  exposures?: FactorExposure[];
  timestamp: Date;
}


export interface ConfidenceInterval {
  lower?: number;
  upper?: number;
  level?: number;
  mean?: number;
  median?: number;
  p1?: number;
  p5?: number;
  p25?: number;
  p75?: number;
  p95?: number;
  p99?: number;
}


export enum DistributionType {
  NORMAL = 'normal',
  LOG_NORMAL = 'log_normal',
  LOGNORMAL = 'log_normal',
  STUDENT_T = 't',
  HISTORICAL = 'historical',
  GUMBEL = 'gumbel',
  LEVY = 'levy',
  EMPIRICAL = 'empirical',
  REGIME_SWITCHING = 'regime_switching'
}

export interface MonteCarloConfig {
  numSimulations: number;
  timeHorizon: number;
  initialValue: number;
  distribution: DistributionType;
  mean?: number;
  volatility?: number;
  confidenceLevel?: number;
  seed?: number;
  strategy?: any;
  parameters?: any;
  initialCapital?: number;
  correlationMatrix?: number[][];
  ruinThreshold?: number;
  targetReturn?: number;
  maxDrawdown?: number;
}

export interface SimulationPath {
  id?: string;
  path: number[];
  finalValue: number;
  totalReturn: number;
  maxDrawdown: number;
  volatility: number;
}

export interface MonteCarloResult {
  config?: MonteCarloConfig;
  paths: SimulationPath[];
  statistics: any;
  confidenceInterval?: any;
  confidenceIntervals?: {
    [key: string]: ConfidenceInterval;
  };
  percentiles?: { [key: string]: number };
  probabilities?: { [key: string]: number };
  tailRisk?: any;
  convergenceMetrics?: any;
}


export interface PortfolioMetrics {
  totalReturn: number;
  expectedReturn?: number;
  sharpeRatio: number;
  volatility: number;
  maxDrawdown: number;
  beta?: number;
  alpha?: number;
}


export interface OptimizationConstraints {
  minWeights?: number[];
  maxWeights?: number[];
  minReturn?: number;
  maxRisk?: number;
  riskFreeRate?: number;
  maxTurnover?: number;
  currentWeights?: number[];
  constraints?: OptimizationConstraint[];
}
