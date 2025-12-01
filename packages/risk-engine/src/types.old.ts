// Risk Engine Type Definitions

export interface Portfolio {
  id: string;
  positions: Position[];
  totalValue: number;
  baseCurrency: string;
  marginUsed: number;
  marginAvailable: number;
  lastUpdated: Date;
}

export interface Position {
  id: string;
  symbol: string;
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnL: number;
  realizedPnL: number;
  marginRequired: number;
  positionType: 'long' | 'short';
  leverage?: number;
  stopLoss?: number;
  takeProfit?: number;
  openedAt: Date;
}

export interface Asset {
  symbol: string;
  name: string;
  type: 'crypto' | 'forex' | 'stock' | 'commodity';
  volatility: number;
  correlation?: Map<string, number>;
  liquidityScore: number;
}

export interface PriceData {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  symbol: string;
}

// VaR Types
export interface VaRResult {
  value: number;
  confidence: number;
  timeHorizon: number;
  methodology: 'parametric' | 'historical' | 'monteCarlo';
  componentVaR?: Map<string, number>;
  marginalVaR?: Map<string, number>;
  timestamp: Date;
}

export interface VaRCalculatorConfig {
  confidenceLevel: number; // 0.95 or 0.99
  lookbackPeriod: number; // days
  methodology: 'parametric' | 'historical' | 'monteCarlo';
  correlationMatrix?: CorrelationMatrix;
  decayFactor?: number; // for exponential weighting
}

export interface CorrelationMatrix {
  assets: string[];
  matrix: number[][];
  period: number;
  timestamp: Date;
}

// Position Sizing Types
export interface PositionSizerConfig {
  methodology: 'kelly' | 'volatilityTarget' | 'riskParity' | 'maxDrawdown';
  targetVolatility?: number;
  maxPositionSize: number;
  correlationAdjustment: boolean;
  confidenceLevel?: number;
}

export interface PositionSize {
  symbol: string;
  recommendedSize: number;
  maxSize: number;
  minSize: number;
  sizingMethod: string;
  riskContribution: number;
}

export interface PositionLimits {
  maxPositionSize: number;
  maxLeverage: number;
  maxConcentration: number;
  maxSectorExposure?: Map<string, number>;
}

// Stress Testing Types
export interface StressScenario {
  name: string;
  description: string;
  assetShocks: Map<string, number>; // percentage moves
  correlationShift?: number;
  volatilityMultiplier?: number;
  liquidityReduction?: number;
  duration?: number; // in days
}

export interface HistoricalEvent {
  name: string;
  startDate: Date;
  endDate: Date;
  affectedAssets: string[];
  marketConditions: MarketConditions;
}

export interface StressTestResult {
  scenario: string;
  portfolioLoss: number;
  worstPositions: Position[];
  varBreach: boolean;
  marginCall: boolean;
  liquidation: boolean;
  recoveryTime?: number;
}

export interface MarketConditions {
  volatilityRegime: 'low' | 'normal' | 'high' | 'extreme';
  correlationRegime: 'normal' | 'crisis';
  liquidityConditions: 'normal' | 'stressed' | 'frozen';
}

// Liquidation Types
export interface LiquidationConfig {
  marginCallThreshold: number; // e.g., 0.8 = 80% of margin used
  liquidationThreshold: number; // e.g., 0.95 = 95% of margin used
  deleveragingStrategy: 'proportional' | 'worstFirst' | 'riskWeighted';
  gracePeriod?: number; // minutes before liquidation
}

export interface MarginStatus {
  marginUsed: number;
  marginAvailable: number;
  marginLevel: number; // percentage
  status: 'safe' | 'warning' | 'marginCall' | 'liquidation';
  timeToMarginCall?: number;
  timeToLiquidation?: number;
}

export interface MarginCallAction {
  type: 'addFunds' | 'reducePosition' | 'closePosition';
  amount?: number;
  positions?: Position[];
  deadline: Date;
}

export interface LiquidationResult {
  liquidatedPositions: Position[];
  totalLoss: number;
  remainingPositions: Position[];
  finalMarginLevel: number;
  timestamp: Date;
}

// Risk Assessment Types
export interface RiskAssessment {
  portfolio: Portfolio;
  var: VaRResult;
  stressTests: StressTestResult[];
  marginStatus: MarginStatus;
  riskScore: number; // 0-100
  warnings: RiskWarning[];
  recommendations: RiskRecommendation[];
  timestamp: Date;
}

export interface RiskWarning {
  severity: 'low' | 'medium' | 'high' | 'critical';
  type: string;
  message: string;
  affectedPositions?: Position[];
}

export interface RiskRecommendation {
  action: string;
  rationale: string;
  expectedImpact: string;
  priority: number;
}

export interface RiskAlert {
  id: string;
  type: 'var_breach' | 'margin_warning' | 'correlation_spike' | 'liquidity_crisis' | 'position_limit';
  severity: 'info' | 'warning' | 'critical';
  message: string;
  data: any;
  timestamp: Date;
}

// Trading Signal Types
export interface TradingSignal {
  symbol: string;
  action: 'buy' | 'sell' | 'hold';
  strength: number; // 0-1
  confidence: number; // 0-1
  source: string;
  timestamp: Date;
}

// Risk Metrics Types
export interface RiskMetrics {
  portfolioVar: number;
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdown: number;
  currentDrawdown: number;
  beta: number;
  alpha: number;
  trackingError?: number;
  informationRatio?: number;
}

export interface RiskReport {
  date: Date;
  portfolio: Portfolio;
  metrics: RiskMetrics;
  varAnalysis: VaRResult;
  stressTestResults: StressTestResult[];
  positionAnalysis: PositionAnalysis[];
  correlationAnalysis: CorrelationMatrix;
  liquidityAnalysis: LiquidityAnalysis;
}

export interface PositionAnalysis {
  position: Position;
  riskContribution: number;
  varContribution: number;
  sharpeContribution: number;
  concentrationRisk: number;
}

export interface LiquidityAnalysis {
  totalLiquidity: number;
  liquidityByAsset: Map<string, number>;
  timeToLiquidate: Map<string, number>;
  liquidityCost: number;
}

// Telemetry Types
export interface RiskTelemetryEvent {
  eventType: 'var_calculation' | 'stress_test' | 'position_sizing' | 'liquidation_check' | 'risk_alert' | 'risk_assessment' | 'risk_report';
  data: any;
  duration?: number;
  timestamp: Date;
}

export interface TelemetryClient {
  track(event: RiskTelemetryEvent): void;
  flush(): Promise<void>;
} 