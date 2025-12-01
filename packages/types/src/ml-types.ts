/**
 * Machine Learning and AI Types
 * Comprehensive type definitions for ML/AI components
 */

// ============================================================================
// Core ML Types
// ============================================================================

export interface ModelConfig {
  name: string;
  type: ModelType;
  version: string;
  parameters: Record<string, any>;
}

export enum ModelType {
  TRANSFORMER = 'transformer',
  LSTM = 'lstm',
  RL = 'rl',
  ENSEMBLE = 'ensemble',
  CAUSAL = 'causal',
  EVOLUTIONARY = 'evolutionary'
}

export interface TransformerConfig {
  sequenceLength: number;
  features: string[];
  horizon: number;
  modelDim?: number;
  numHeads?: number;
  numLayers?: number;
  dropout?: number;
  learningRate?: number;
}

export interface FeatureSet {
  timestamp: number;
  features: Record<string, number>;
  metadata?: Record<string, any>;
}

export interface PredictionResult {
  timestamp: number;
  predictions: number[];
  confidence: ConfidenceMetrics;
  metadata?: Record<string, any>;
}

export interface Predictions {
  values: number[];
  timestamps: number[];
  confidence: number[];
}

export interface ConfidenceMetrics {
  mean: number;
  std: number;
  min: number;
  max: number;
}

export interface ModelPerformance {
  mae: number;
  rmse: number;
  sharpe?: number;
  accuracy?: number;
  lastUpdated: number;
}

export enum ModelStatus {
  UNINITIALIZED = 'uninitialized',
  TRAINING = 'training',
  READY = 'ready',
  ERROR = 'error'
}

export interface ModelMetrics {
  accuracy: number;
  precision: number;
  recall: number;
  f1Score: number;
  auc?: number;
  sharpeRatio?: number;
  maxDrawdown?: number;
}

export interface ValidationResult {
  timestamp: number;
  status: 'pass' | 'warning' | 'fail';
  modules: ModuleValidation[];
  gaps: SystemGap[];
  recommendations: string[];
  performanceMetrics: SystemPerformance;
}

export interface ModuleValidation {
  name: string;
  status: 'healthy' | 'degraded' | 'failed';
  issues: ValidationIssue[];
  metrics: Record<string, number>;
}

export interface ValidationIssue {
  severity: 'low' | 'medium' | 'high' | 'critical';
  module: string;
  description: string;
  impact: string;
  recommendation: string;
  code?: string;
}

export interface SystemGap {
  type: 'integration' | 'performance' | 'logic' | 'data' | 'monitoring';
  description: string;
  affectedModules: string[];
  estimatedImpact: number; // 0-100
  suggestedFix: string;
}

export interface SystemPerformance {
  avgLatency: number;
  p99Latency: number;
  throughput: number;
  errorRate: number;
  cpuUsage: number;
  memoryUsage: number;
  activeStrategies: number;
  profitability: number;
}

// ============================================================================
// Trading Signal Types
// ============================================================================

export interface TradingSignal {
  action: TradingAction;
  symbol: string;
  confidence: number;
  source?: string;
  timestamp: number;
  metadata?: Record<string, any>;
  price?: number;
  quantity?: number;
  reasoning?: string;
}

export type TradingAction = 'buy' | 'sell' | 'hold' | 'close';

export interface MLError {
  code: MLErrorCode;
  message: string;
  details?: any;
}

export enum MLErrorCode {
  MODEL_NOT_INITIALIZED = 'MODEL_NOT_INITIALIZED',
  INVALID_INPUT = 'INVALID_INPUT',
  TRAINING_FAILED = 'TRAINING_FAILED',
  PREDICTION_FAILED = 'PREDICTION_FAILED'
}

export interface FeatureImportance {
  feature: string;
  importance: number;
  rank: number;
}

// ============================================================================
// Market State and Features
// ============================================================================

export interface MarketState {
  timestamp: number;
  prices: Record<string, number>;
  volumes: Record<string, number>;
  orderBook: OrderBookSnapshot;
  technicalIndicators: Record<string, number>;
  sentimentScores: Record<string, number>;
  positions: Position[];
  accountBalance: number;
  customFeatures: Record<string, number>;
}

export interface OrderBookSnapshot {
  bids: Array<[number, number]>; // [price, quantity]
  asks: Array<[number, number]>;
  timestamp: number;
}

export interface Position {
  symbol: string;
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnL: number;
  openTime: number;
}

export interface MarketFeatures {
  // Price features
  returns1d: number;
  returns5d: number;
  returns20d: number;
  
  // Technical indicators
  rsi14: number;
  macdHistogram: number;
  bbWidth: number; // Bollinger Band width
  
  // Volume features
  volumeRatio: number;
  volumeMA20: number;
  
  // Volatility features
  volatility1d: number;
  volatility5d: number;
  atr14: number;
  
  // Market structure
  vix?: number;
  advanceDeclineRatio?: number;
  newHighsLows?: number;
}

export interface PriceFeatures {
  open: number;
  high: number;
  low: number;
  close: number;
  vwap: number;
  returns: number;
  logReturns: number;
  priceChange: number;
  priceChangePercent: number;
}

export interface VolumeFeatures {
  volume: number;
  volumeMA: number;
  volumeStd: number;
  volumeRatio: number;
  buyVolume: number;
  sellVolume: number;
  volumeImbalance: number;
}

export interface TechnicalFeatures {
  sma: Record<number, number>; // e.g., {20: 100.5, 50: 99.8}
  ema: Record<number, number>;
  rsi: number;
  macd: number;
  macdSignal: number;
  macdHistogram: number;
  bollingerUpper: number;
  bollingerLower: number;
  bollingerWidth: number;
  atr: number;
  adx: number;
  stochastic: number;
}

export interface SentimentFeatures {
  newsScore: number;
  socialScore: number;
  fearGreedIndex: number;
  putCallRatio: number;
  shortInterest: number;
  analystRating: number;
  institutionalFlow: number;
}

export interface OnChainFeatures {
  activeAddresses: number;
  transactionVolume: number;
  exchangeInflow: number;
  exchangeOutflow: number;
  whaleActivity: number;
  networkValue: number;
  nvtRatio: number;
}

export interface CustomFeature {
  name: string;
  value: number;
  importance: number;
  category: string;
  timestamp: number;
}

// ============================================================================
// Market Regime Types
// ============================================================================

export enum MarketRegime {
  BULLISH_TREND = 'bullish_trend',
  BEARISH_TREND = 'bearish_trend',
  RANGEBOUND = 'rangebound',
  MEAN_REVERTING = 'mean_reverting',
  HIGH_VOLATILITY = 'high_volatility',
  LOW_VOLATILITY = 'low_volatility',
  HIGH_LIQUIDITY = 'high_liquidity',
  LOW_LIQUIDITY = 'low_liquidity',
  MARKET_STRESS = 'market_stress',
  BULL_VOLATILE = 'bull_volatile',
  BEAR_VOLATILE = 'bear_volatile',
  RANGEBOUND_LOW_VOL = 'rangebound_low_vol',
  UNKNOWN = 'unknown'
}

export interface RegimeFeatures {
  trend: number; // -1 to 1
  volatility: number;
  momentum: number;
  liquidity: number;
  correlation: number;
}

export interface RegimeAlignment {
  regime: MarketRegime;
  confidence: number;
  duration: number;
  stability: number;
}

// ============================================================================
// Reinforcement Learning Types
// ============================================================================

export interface RLConfig {
  algorithm: RLAlgorithm;
  stateSpace: StateSpace;
  actionSpace: ActionSpace;
  rewardFunction: RewardFunction;
  hyperparameters: RLHyperparameters;
  memory?: MemoryConfig;
}

export enum RLAlgorithm {
  DQN = 'DQN',
  DDQN = 'DDQN',
  PPO = 'PPO',
  A3C = 'A3C',
  SAC = 'SAC'
}

export interface StateSpace {
  dimensions: number;
  features: string[];
  normalization?: NormalizationMethod;
}

export enum NormalizationMethod {
  MINMAX = 'minmax',
  ZSCORE = 'zscore',
  ROBUST = 'robust',
  NONE = 'none'
}

export interface ActionSpace {
  type: 'discrete' | 'continuous';
  dimensions: number;
  actions?: string[];
  bounds?: [number, number][];
}

export interface RLHyperparameters {
  learningRate: number;
  discountFactor: number;
  epsilon?: number;
  epsilonDecay?: number;
  batchSize: number;
  bufferSize?: number;
}

export interface MemoryConfig {
  type: 'uniform' | 'prioritized';
  capacity: number;
  alpha?: number;
  beta?: number;
}

export interface RLAction {
  type: 'buy' | 'sell' | 'hold' | 'close';
  symbol: string;
  quantity: number;
  orderType: 'market' | 'limit' | 'stop';
  price?: number;
  confidence: number;
  reasoning?: string;
}

export interface RLAgent {
  id: string;
  algorithm: string;
  version: string;
  trainingEpisodes: number;
  currentPolicy: any; // Neural network weights
  performanceHistory: AgentPerformance[];
  hyperparameters: Record<string, any>;
}

export interface AgentPerformance {
  episode: number;
  totalReward: number;
  sharpeRatio: number;
  winRate: number;
  avgDrawdown: number;
  actions: number;
}

export interface RewardFunction {
  name: string;
  calculate(state: MarketState, action: RLAction, nextState: MarketState): number;
}

// ============================================================================
// LLM Types
// ============================================================================

export interface LLMProvider {
  name: 'claude-3' | 'gpt-4' | 'gpt-4-turbo' | 'local';
  apiKey?: string;
  endpoint?: string;
  maxConcurrency: number;
}

export interface SafetyConstraints {
  maxPositionSize: number; // % of portfolio
  maxLeverage: number;
  maxDrawdown: number; // %
  minSharpe: number;
  forbiddenAssets: string[];
  maxOrdersPerMinute: number;
}

export interface LLMStrategy {
  id: string;
  prompt: string;
  generatedCode: string;
  description?: string;
  entryConditions?: any;
  targetAssets?: string[];
  confidence?: number;
  constraints: SafetyConstraints;
  performance?: StrategyPerformance;
  status: 'generating' | 'validating' | 'backtesting' | 'paper' | 'live' | 'rejected';
  createdAt: Date;
  deployedAt?: Date;
}

export interface FeatureSuggestion {
  name: string;
  description: string;
  importance: number;
  category: 'market' | 'technical' | 'fundamental' | 'alternative' | 'synthetic';
  implementation: string;
  requiredData: string[];
}

// ============================================================================
// Strategy Evolution Types
// ============================================================================

export interface StrategyGenome {
  id: string;
  genes: StrategyGene[];
  fitness?: number;
  generation: number;
  parents?: string[];
  mutations?: MutationRecord[];
}

export interface StrategyGene {
  type: 'entry' | 'exit' | 'filter' | 'sizing' | 'risk';
  name: string;
  parameters: Record<string, any>;
  weight: number;
  active: boolean;
}

export interface MutationRecord {
  timestamp: number;
  type: 'add' | 'remove' | 'modify' | 'crossover';
  gene: string;
  oldValue: any;
  newValue: any;
}

export interface EvolutionMetrics {
  currentGeneration: number;
  bestFitness: number;
  avgFitness: number;
  diversity: number;
  convergenceRate: number;
  eliteStrategies: StrategyGenome[];
}

export interface StrategyPerformance {
  pnl: number;
  sharpeRatio: number;
  winRate: number;
  maxDrawdown: number;
  trades: number;
  avgHoldTime: number;
  profitFactor: number;
}

export enum PositionSizingMethod {
  FIXED = 'fixed',
  KELLY = 'kelly',
  RISK_PARITY = 'risk_parity',
  VOLATILITY_SCALED = 'volatility_scaled',
  DYNAMIC = 'dynamic'
}

// ============================================================================
// Causal Analysis Types
// ============================================================================

export interface CausalRelationship {
  cause: string;
  effect: string;
  strength: number;
  pValue: number;
  lag: number;
  confidence: number;
  method: string;
}

export interface FeatureCausality {
  feature: string;
  causes: CausalRelationship[];
  effects: CausalRelationship[];
  spurious: boolean;
  stability: number;
}

export interface LeadLagRelation {
  leader: string;
  follower: string;
  lag: number;
  correlation: number;
  confidence: number;
}

export interface CrossMarketAnalysis {
  markets: string[];
  correlations: Record<string, Record<string, number>>;
  leadLagRelations: LeadLagRelation[];
  timestamp: number;
}

// ============================================================================
// Fractal Pattern Types
// ============================================================================

export enum FractalType {
  BULLISH = 'bullish',
  BEARISH = 'bearish',
  NEUTRAL = 'neutral',
  COMPLEX = 'complex'
}

export interface FractalPattern {
  type: FractalType;
  scale: number;
  confidence: number;
  startTime: number;
  endTime: number;
  priceRange: [number, number];
  selfSimilarity: number;
  hurstExponent: number;
}

// ============================================================================
// External Integration Types
// ============================================================================

export interface ExternalSignal {
  provider: SignalProvider;
  symbol: string;
  signal: number;
  strength: number;
  confidence: number;
  timestamp: number;
  metadata?: Record<string, any>;
}

export enum SignalProvider {
  NUMERAI = 'numerai',
  QUANTCONNECT = 'quantconnect',
  CUSTOM = 'custom',
  INTERNAL = 'internal'
}

// ============================================================================
// Model Expansion Types
// ============================================================================

export interface ModelExpansionConfig {
  llm: {
    enabled: boolean;
    providers: LLMProvider[];
    maxTokens: number;
    temperature: number;
    safetyConstraints: SafetyConstraints;
  };
  rl: {
    enabled: boolean;
    algorithm: 'PPO' | 'DQN' | 'A3C' | 'SAC';
    learningRate: number;
    discountFactor: number;
    explorationRate: number;
    batchSize: number;
  };
  evolution: {
    enabled: boolean;
    populationSize: number;
    mutationRate: number;
    crossoverRate: number;
    eliteRatio: number;
    maxGenerations: number;
  };
  causal: {
    enabled: boolean;
    method: 'granger' | 'pc' | 'dowhy';
    confidenceLevel: number;
    lagOrder: number;
  };
}

// ============================================================================
// Orchestration Types
// ============================================================================

export interface OrchestrationState {
  activeModels: string[];
  activeComponents: string[];
  isActive: boolean;
  performance: Record<string, ModelPerformance>;
  allocation: Record<string, number>;
  currentSignals: TradingSignal[];
  lastUpdate: number;
}

// ============================================================================
// TensorFlow Types
// ============================================================================

// Generic tensor type for TensorFlow operations
export type Tensor = any;
export type LossOrMetricFn = (yTrue: Tensor, yPred: Tensor) => Tensor;
