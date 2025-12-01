// Risk Engine Types - Institutional Grade
// Comprehensive type definitions for risk management and capital protection

import { BigNumber } from 'ethers';

// Core Portfolio and Position Types
export interface Portfolio {
  id: string;
  positions: Position[];
  cash: number;
  totalValue: number;
  leverage: number;
  marginUsed: number;
  marginAvailable: number;
  lastUpdate: number;
  metadata?: Record<string, any>;
}

export interface Position {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  size: number;
  quantity: number; // Alias for size for backward compatibility
  entryPrice: number;
  currentPrice: number;
  unrealizedPnL: number;
  realizedPnL: number;
  margin: number;
  liquidationPrice: number;
  leverage?: number;
  marginRequired?: number; // For backward compatibility
  positionType?: 'long' | 'short'; // Alias for side
  averagePrice?: number; // Alias for entryPrice
  stopLoss?: number;
  takeProfit?: number;
  openTime: number;
  lastUpdate: number;
}

export interface Asset {
  symbol: string;
  price: number;
  type?: 'crypto' | 'forex' | 'stock' | 'commodity'; // For backward compatibility
  volatility: number;
  volume24h: number;
  marketCap?: number;
  correlations?: Record<string, number>;
}

// VaR Types
export interface VaRConfig {
  confidenceLevel: number; // 0.95 or 0.99
  lookbackPeriod: number; // days
  method: 'parametric' | 'historical' | 'monteCarlo';
  methodology?: 'parametric' | 'historical' | 'monteCarlo'; // Alias for method
  timeHorizon: number;
  correlationMatrix?: CorrelationMatrix;
  decayFactor?: number; // for exponential weighting
}

// Alias for backward compatibility
export type VaRCalculatorConfig = VaRConfig;

export interface _VaRConfig_OLD {
  confidenceLevel: number; // 0.95 or 0.99
  lookbackPeriod: number; // days
  methodology: 'parametric' | 'historical' | 'monteCarlo';
  correlationMatrix?: CorrelationMatrix;
  includeFees?: boolean;
  stressMultiplier?: number;
}

export interface VaRResult {
  value: number;
  percentage: number;
  methodology: string;
  confidenceLevel: number;
  confidence?: number; // Alias for confidenceLevel
  timeHorizon: number;
  components?: VaRComponent[];
  componentVaR?: Record<string, number>; // Backward compatibility - map of asset to component VaR
  marginalVaR?: Record<string, number>; // Backward compatibility - map of asset to marginal VaR
  timestamp: number;
}

export interface VaRComponent {
  asset: string;
  contribution: number;
  marginalVaR: number;
  componentVaR: number;
}

export interface CVaRResult extends VaRResult {
  conditionalValue: number;
  tailRisk: number;
  worstCaseScenarios: Scenario[];
}

// Position Sizing Types
export interface PositionSizerConfig {
  methodology: 'kelly' | 'volatilityTarget' | 'riskParity' | 'maxDrawdown' | 'optimal';
  targetVolatility?: number;
  confidenceLevel?: number; // Confidence level for risk calculations
  maxPositionSize: number;
  minPositionSize: number;
  correlationAdjustment: boolean;
  kellyFraction?: number; // Kelly criterion multiplier (e.g., 0.25 for 1/4 Kelly)
  rebalanceThreshold?: number;
}

export interface PositionLimits {
  maxLeverage?: number; // For backward compatibility
  maxPositionSize: number;
  maxPortfolioExposure: number;
  maxSectorExposure?: number;
  maxCorrelatedExposure?: number;
  maxConcentration?: number; // Maximum concentration in single asset
  minDiversification?: number;
}

export interface SizingResult {
  recommendedSize: number;
  adjustedSize: number;
  methodology: string;
  confidence: number;
  riskContribution: number;
  constraints: string[];
}

// Stress Testing Types
export interface StressScenario {
  name: string;
  description: string;
  assetShocks: Map<string, number>; // percentage moves
  correlationShift?: number;
  volatilityMultiplier?: number;
  liquidityReduction?: number;
  duration?: number; // scenario duration in hours
  probability?: number;
}

export interface HistoricalEvent {
  name: string;
  date?: Date | number; // Optional - can use startDate/endDate instead
  startDate?: Date | number; // For backward compatibility
  endDate?: Date | number; // For backward compatibility
  description?: string; // Optional
  marketMoves?: Record<string, number>; // Optional
  affectedAssets?: string[]; // For backward compatibility
  marketConditions?: any; // For backward compatibility
  volatilityRegime?: number; // Optional
  correlationBreakdown?: boolean;
}

export interface StressTestResult {
  scenario: string;
  portfolioLoss: number;
  percentageLoss: number;
  worstPosition: string;
  worstPositions?: string[]; // Alias/extension for backward compatibility
  worstPositionLoss: number;
  varBreach?: boolean; // For backward compatibility
  marginCall: boolean;
  liquidation: boolean;
  recoveryTime?: number;
  recommendations: string[];
}

export interface MonteCarloConfig {
  iterations: number;
  timeHorizon: number; // days
  returnModel: 'normal' | 'studentT' | 'empirical';
  volatilityModel: 'constant' | 'garch' | 'stochastic';
  correlationModel: 'static' | 'dynamic';
  randomSeed?: number;
}

// Liquidation Types
export interface LiquidationConfig {
  marginCallThreshold: number; // e.g., 0.8 = 80% of margin used
  liquidationThreshold: number; // e.g., 0.95 = 95% of margin used
  maintenanceMarginRatio: number;
  deleveragingStrategy: 'proportional' | 'worstFirst' | 'riskWeighted' | 'optimal';
  gracePeriod?: number; // milliseconds before liquidation
  partialLiquidationAllowed: boolean;
  maxSlippage?: number; // Maximum allowed slippage during liquidation
}

export interface MarginStatus {
  currentMargin: number;
  usedMargin: number;
  marginUsed?: number; // Alias for usedMargin
  availableMargin: number;
  marginLevel: number; // percentage
  status: 'safe' | 'warning' | 'marginCall' | 'liquidation';
  timeToMarginCall?: number;
  timeToLiquidation?: number;
}

export interface MarginCallAction {
  type: 'addFunds' | 'closePosition' | 'reduceSize' | 'reducePosition';
  amount?: number;
  positions?: string[];
  deadline: number;
  priority: 'low' | 'medium' | 'high' | 'critical';
}

export interface LiquidationResult {
  liquidatedPositions: Position[] | string[]; // Can be Position objects or IDs
  totalLoss?: number; // Alias for totalLiquidated
  totalLiquidated?: number;
  remainingPositions?: Position[];
  remainingExposure?: number;
  liquidationCost?: number;
  slippage?: number;
  finalMarginLevel: number;
  timestamp: number;
}

// Capital Protection Types
export interface CircuitBreakerConfig {
  dailyLossLimit: number; // percentage
  weeklyLossLimit: number;
  monthlyLossLimit: number;
  consecutiveLossLimit: number;
  volatilityMultiplier: number; // pause if volatility exceeds X times normal
  cooldownPeriod: number; // milliseconds
  autoResumeEnabled: boolean;
}

export interface CircuitBreakerStatus {
  isActive: boolean;
  triggeredBy?: 'dailyLoss' | 'weeklyLoss' | 'monthlyLoss' | 'consecutiveLoss' | 'volatility';
  triggeredAt?: number;
  currentLosses: {
    daily: number;
    weekly: number;
    monthly: number;
    consecutive: number;
  };
  resumeAt?: number;
  manualOverride: boolean;
}

export interface DrawdownControl {
  maxDrawdown: number;
  currentDrawdown: number;
  drawdownStart?: number;
  peakValue: number;
  troughValue?: number;
  recoveryStart?: number;
  adjustmentFactor: number; // position size multiplier based on drawdown
}

export interface BlackSwanDefense {
  tailHedgeRatio: number;
  hedgeInstruments: string[];
  activationThreshold: number; // VIX level or volatility spike
  hedgeCost: number;
  protection: number; // percentage of portfolio protected
  expiryDate: number;
}

export interface EmergencyExitConfig {
  triggerConditions: EmergencyTrigger[];
  exitStrategy: 'market' | 'limit' | 'twap' | 'optimal';
  priorityOrder: string[]; // asset priority for liquidation
  maxSlippage: number;
  splitOrders: boolean;
  notificationChannels: string[];
}

export interface EmergencyTrigger {
  type: 'technicalFailure' | 'marketCrash' | 'liquidityDry' | 'systemCompromise' | 'manual';
  threshold?: number;
  confirmation: 'immediate' | 'delayed' | 'manual';
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface RecoveryStrategy {
  type: 'gradual' | 'aggressive' | 'conservative' | 'adaptive';
  targetRecoveryTime: number; // days
  riskBudget: number;
  allowableStrategies: string[];
  reentryRules: ReentryRule[];
}

export interface ReentryRule {
  condition: string;
  metric: 'drawdown' | 'volatility' | 'trend' | 'sentiment';
  threshold: number;
  action: 'increase' | 'maintain' | 'decrease';
  sizingAdjustment: number;
}

// Risk Metrics and Reporting
export interface RiskMetrics {
  portfolio: Portfolio;
  var: VaRResult;
  portfolioVar?: number; // Alias for var.value
  cvar?: CVaRResult;
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  maxDrawdown: number;
  currentDrawdown: number;
  beta: number;
  alpha: number;
  correlation: number;
  informationRatio?: number;
  treynorRatio?: number;
  trackingError?: number; // Tracking error vs benchmark
  downsideDeviation: number;
  uptime: number;
  lastUpdate: number;
}

export interface RiskReport {
  timestamp: number;
  date?: Date | number; // Alias for timestamp
  portfolio: Portfolio;
  metrics: RiskMetrics;
  stressTests: StressTestResult[];
  marginStatus: MarginStatus;
  circuitBreakerStatus: CircuitBreakerStatus;
  alerts: RiskAlert[];
  recommendations: RiskRecommendation[];
  nextReviewTime: number;
}

export interface RiskAlert {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  type: 'var' | 'margin' | 'drawdown' | 'correlation' | 'liquidity' | 'concentration' | 'var_breach' | 'margin_warning';
  message: string;
  metric?: string;
  currentValue?: number;
  threshold?: number;
  timestamp: number;
  acknowledged: boolean;
}

export interface RiskRecommendation {
  action: string;
  reason: string;
  impact: string;
  urgency: 'low' | 'medium' | 'high';
  positions?: string[];
  alternativeActions?: string[];
}

// Correlation and Covariance
export interface CorrelationMatrix {
  assets: string[];
  matrix: number[][];
  timeframe: number; // days
  period?: number; // Alias for timeframe
  confidence: number[];
  lastUpdate: number;
  timestamp?: number; // Alias for lastUpdate
  methodology: 'pearson' | 'spearman' | 'kendall';
}

export interface CovarianceMatrix {
  assets: string[];
  matrix: number[][];
  standardDeviations: number[];
  eigenvalues?: number[];
  eigenvectors?: number[][];
  conditionNumber?: number;
}

// Scenario Types
export interface Scenario {
  id: string;
  name: string;
  probability: number;
  impact: number;
  duration: number;
  affectedAssets: string[];
  marketConditions: MarketCondition[];
}

export enum MarketCondition {
  CALM = 'CALM',
  NORMAL = 'NORMAL',
  VOLATILE = 'VOLATILE',
  EXTREME = 'EXTREME'
}

export interface MarketConditionRule {
  metric: string;
  operator: '>' | '<' | '=' | '>=' | '<=';
  value: number;
  weight?: number;
}

// Telemetry and Performance
export interface RiskTelemetry {
  calculationTime: Record<string, number>;
  alertsTriggered: number;
  marginCallsIssued: number;
  liquidationsExecuted: number;
  circuitBreakerActivations: number;
  stressTestsRun: number;
  errors: RiskError[];
  performance: PerformanceMetrics;
}

export interface PerformanceMetrics {
  avgCalculationTime: number;
  peakMemoryUsage: number;
  cpuUsage: number;
  apiCalls: number;
  cacheHitRate: number;
  uptime: number;
}

export interface RiskError {
  code: string;
  message: string;
  severity: 'low' | 'medium' | 'high';
  timestamp: number;
  context?: any;
  stackTrace?: string;
}

// Configuration and Settings
export interface RiskEngineConfig {
  var: VaRConfig;
  positionSizing: PositionSizerConfig;
  stressTesting: {
    scenarios: StressScenario[];
    historicalEvents: HistoricalEvent[];
    monteCarloConfig: MonteCarloConfig;
  };
  liquidation: LiquidationConfig;
  capitalProtection: {
    circuitBreaker: CircuitBreakerConfig;
    emergencyExit: EmergencyExitConfig;
    recoveryStrategy: RecoveryStrategy;
    blackSwanDefense?: BlackSwanDefense;
  };
  reporting: {
    frequency: number; // milliseconds
    recipients: string[];
    format: 'json' | 'html' | 'pdf';
    includeCharts: boolean;
  };
  telemetry: {
    enabled: boolean;
    endpoint: string;
    apiKey?: string;
    sampleRate: number;
  };
}

// Enums for better type safety
export enum RiskLevel {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

export enum PositionStatus {
  OPEN = 'open',
  CLOSING = 'closing',
  CLOSED = 'closed',
  LIQUIDATED = 'liquidated',
  EXPIRED = 'expired'
}

export enum MarketRegime {
  BULL = 'bull',
  BEAR = 'bear',
  SIDEWAYS = 'sideways',
  VOLATILE = 'volatile',
  STABLE = 'stable'
}

// Error types
export enum RiskErrorCode {
  CALCULATION_ERROR = 'CALCULATION_ERROR',
  DATA_INSUFFICIENT = 'DATA_INSUFFICIENT',
  LIMIT_EXCEEDED = 'LIMIT_EXCEEDED',
  MARGIN_INSUFFICIENT = 'MARGIN_INSUFFICIENT',
  LIQUIDATION_FAILED = 'LIQUIDATION_FAILED',
  CIRCUIT_BREAKER_TRIGGERED = 'CIRCUIT_BREAKER_TRIGGERED',
  CONFIGURATION_ERROR = 'CONFIGURATION_ERROR'
}

export class RiskEngineError extends Error {
  constructor(
    public code: RiskErrorCode,
    message: string,
    public details?: any
  ) {
    super(message);
    this.name = 'RiskEngineError';
  }
}

 
// Telemetry types for backward compatibility
export interface TelemetryClient {
  track(event: any): void;
  flush(): Promise<void>;
}

export interface RiskTelemetryEvent {
  eventType: string;
  data: any;
  duration?: number;
  timestamp: number;
}

export interface PriceData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  symbol: string;
}

// Additional types for backward compatibility
export interface TradingSignal {
  symbol: string;
  action: 'buy' | 'sell' | 'hold';
  strength: number;
  confidence: number;
  source: string;
  timestamp: number;
}

export interface PositionSize {
  symbol: string;
  recommendedSize: number;
  maxSize: number;
  minSize: number;
  sizingMethod: string;
  riskContribution: number;
}

// Execution Integration Types
export enum RiskViolationType {
  POSITION_LIMIT = 'POSITION_LIMIT',
  LEVERAGE_LIMIT = 'LEVERAGE_LIMIT',
  LEVERAGE = 'LEVERAGE', // Alias
  DAILY_LOSS_LIMIT = 'DAILY_LOSS_LIMIT',
  DAILY_LOSS = 'DAILY_LOSS', // Alias
  ORDER_SIZE_LIMIT = 'ORDER_SIZE_LIMIT',
  ORDER_SIZE = 'ORDER_SIZE', // Alias
  MARGIN_REQUIREMENT = 'MARGIN_REQUIREMENT',
  MARGIN = 'MARGIN', // Alias
  CONCENTRATION_RISK = 'CONCENTRATION_RISK',
  CONCENTRATION = 'CONCENTRATION', // Alias
  OPEN_ORDER_LIMIT = 'OPEN_ORDER_LIMIT',
  ORDER_COUNT = 'ORDER_COUNT', // Alias
  MARKET_CONDITION = 'MARKET_CONDITION',
  LIQUIDITY = 'LIQUIDITY',
  SLIPPAGE = 'SLIPPAGE',
  VENUE = 'VENUE'
}

export interface RiskCheckResult {
  approved: boolean;
  violationType?: RiskViolationType;
  reason?: string;
  details?: any;
  maxSlippage?: number;
  urgency?: 'low' | 'medium' | 'high' | 'critical';
  allowedVenues?: string[];
  adjustedSize?: number;
  riskScore?: number;
  timestamp: number;
}

export interface RoutingDecision {
  orderId: string;
  routes: OrderRoute[];
  totalQuantity: number;
  estimatedCost: number;
  estimatedSlippage: number;
  expectedSlippage?: number; // Alias for estimatedSlippage
  estimatedExecutionTime: number;
  riskScore: number;
  timestamp: number;
}

export interface OrderRoute {
  venue: string;
  exchange?: string; // Alias for venue
  quantity: number;
  estimatedPrice: number;
  estimatedFee: number;
  priority: number;
  darkPool?: boolean;
}



// Risk Assessment Types
export interface RiskAssessment {
  portfolio: Portfolio;
  var: VaRResult;
  stressTests: StressTestResult[];
  marginStatus: MarginStatus;
  riskScore: number;
  warnings: string[];
  recommendations: string[];
  timestamp: number;
}
