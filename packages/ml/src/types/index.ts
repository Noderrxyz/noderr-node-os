/**
 * Model Expansion Type Definitions
 * 
 * Core types and interfaces for the elite 0.001% AI/ML expansion
 */

import { Logger } from 'winston';
import * as tf from '@tensorflow/tfjs';

// ============ Core ML Types ============

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

export interface TradingSignal {
  action: TradingAction;
  symbol: string;
  confidence: number;
  source?: string;
  timestamp: number;
  metadata?: Record<string, any>;
}

export type TradingAction = 'buy' | 'sell' | 'hold';

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

export interface ReturnDistribution {
  mean: number;
  std: number;
  skew: number;
  kurtosis: number;
  quantiles: Record<string, number>;
}

export interface TimingSignal {
  timestamp: number;
  signal: number;
  confidence: number;
}

// ============ RL Types ============

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
  normalization?: 'minmax' | 'zscore' | 'none';
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

export interface RLEnvironment {
  reset(): Promise<any>;
  step(action: any): Promise<{ state: any; reward: number; done: boolean }>;
  getState(): any;
}

export interface ExplorationStrategy {
  type: 'epsilon-greedy' | 'boltzmann' | 'ucb';
  params: Record<string, number>;
}

// ============ External Integration Types ============

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
  CUSTOM = 'custom'
}

export interface OrchestrationState {
  activeModels: string[];
  activeComponents: string[];
  isActive: boolean;
  performance: Record<string, ModelPerformance>;
  allocation: Record<string, number>;
  currentSignals: TradingSignal[];
  lastUpdate: number;
}

// ============ Model Expansion Types ============

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
  integration: {
    numerai: {
      enabled: boolean;
      apiKey: string;
      modelId: string;
      submissionEnabled: boolean;
    };
    externalSignals: ExternalSignalConfig[];
  };
  validation: {
    autoAudit: boolean;
    auditFrequency: number; // hours
    performanceThresholds: PerformanceThresholds;
  };
}

// ============ LLM Types ============

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

// ============ RL Types ============

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

// ============ Evolution Types ============

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

// ============ Causal Types ============

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

// ============ Integration Types ============

export interface NumeraiSignal {
  id: string;
  roundNumber: number;
  predictions: Record<string, number>;
  confidence: number;
  modelId: string;
  timestamp: number;
  metadata?: Record<string, any>;
}

export interface ExternalSignalConfig {
  name: string;
  type: 'webhook' | 'api' | 'websocket' | 'file';
  endpoint: string;
  authentication?: {
    type: 'apikey' | 'oauth' | 'basic';
    credentials: Record<string, string>;
  };
  mapping: SignalMapping;
  refreshInterval: number; // seconds
}

export interface SignalMapping {
  symbolField: string;
  actionField: string;
  confidenceField: string;
  timestampField: string;
  customFields?: Record<string, string>;
}

// ============ Validation Types ============

export interface ValidationReport {
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

export interface PerformanceThresholds {
  minSharpe: number;
  maxDrawdown: number;
  minWinRate: number;
  maxLatency: number;
  minProfitFactor: number;
}

// ============ Common Types ============

export interface StrategyPerformance {
  pnl: number;
  sharpeRatio: number;
  winRate: number;
  maxDrawdown: number;
  trades: number;
  avgHoldTime: number;
  profitFactor: number;
}

export interface Position {
  symbol: string;
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnL: number;
  openTime: number;
}

export interface OrderBookSnapshot {
  bids: Array<[number, number]>; // [price, quantity]
  asks: Array<[number, number]>;
  timestamp: number;
}

// ============ Event Types ============

export interface ModelExpansionEvents {
  'llm:strategy:generated': (strategy: LLMStrategy) => void;
  'llm:feature:suggested': (feature: FeatureSuggestion) => void;
  'rl:action:taken': (action: RLAction) => void;
  'rl:episode:complete': (performance: AgentPerformance) => void;
  'evolution:generation:complete': (metrics: EvolutionMetrics) => void;
  'evolution:strategy:deployed': (genome: StrategyGenome) => void;
  'causal:relationship:found': (relationship: CausalRelationship) => void;
  'numerai:signal:received': (signal: NumeraiSignal) => void;
  'validation:complete': (report: ValidationReport) => void;
  'validation:issue:critical': (issue: ValidationIssue) => void;
  'system:performance:degraded': (metrics: SystemPerformance) => void;
}

// ============ Service Interfaces ============

export interface IModelExpansionService {
  initialize(config: ModelExpansionConfig): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  getStatus(): ServiceStatus;
  getMetrics(): ModelExpansionMetrics;
}

export interface ServiceStatus {
  running: boolean;
  startTime?: number;
  modules: Record<string, ModuleStatus>;
  errors: Error[];
}

export interface ModuleStatus {
  name: string;
  enabled: boolean;
  healthy: boolean;
  lastActivity?: number;
  metrics?: Record<string, any>;
}

export interface ModelExpansionMetrics {
  llm: {
    strategiesGenerated: number;
    successRate: number;
    avgGenerationTime: number;
    activeStrategies: number;
  };
  rl: {
    trainingEpisodes: number;
    avgReward: number;
    currentSharpe: number;
    explorationRate: number;
  };
  evolution: {
    currentGeneration: number;
    populationSize: number;
    bestFitness: number;
    mutationsSinceImprovement: number;
  };
  causal: {
    featuresAnalyzed: number;
    relationshipsFound: number;
    spuriousFiltered: number;
    avgStability: number;
  };
  integration: {
    numeraiSignals: number;
    externalSignals: number;
    signalQuality: number;
    integrationLatency: number;
  };
  validation: {
    lastAuditTime: number;
    issuesFound: number;
    systemHealth: number;
    recommendations: number;
  };
}

// ============ Orchestration Types ============

export interface OrchestrationStrategy {
  id: string;
  name: string;
  components: ComponentAllocation[];
  rules: OrchestrationRule[];
  performance: StrategyPerformance;
}

export interface ComponentAllocation {
  component: 'llm' | 'rl' | 'evolution' | 'causal' | 'external';
  weight: number;
  enabled: boolean;
  config?: Record<string, any>;
}

export interface OrchestrationRule {
  condition: string;
  action: string;
  priority: number;
  enabled: boolean;
}

// Export namespace for convenience
export namespace ModelExpansion {
  export type Config = ModelExpansionConfig;
  export type Events = ModelExpansionEvents;
  export type Metrics = ModelExpansionMetrics;
} 
// Additional validation types
export interface ModelMetrics {
  accuracy: number;
  precision: number;
  recall: number;
  f1Score: number;
  auc?: number;
}

export type ValidationResult = ValidationReport;
