/**
 * Market Regime Types
 */

export enum MarketRegime {
  BullishTrend = 'bullish_trend',
  BearishTrend = 'bearish_trend',
  Rangebound = 'rangebound',
  MeanReverting = 'mean_reverting',
  HighVolatility = 'high_volatility',
  LowVolatility = 'low_volatility',
  HighLiquidity = 'high_liquidity',
  LowLiquidity = 'low_liquidity',
  MarketStress = 'market_stress',
  BullVolatile = 'bull_volatile',
  BearVolatile = 'bear_volatile',
  RangeboundLowVol = 'rangebound_low_vol',
  Unknown = 'unknown'
}

export enum RegimeTransitionState {
  Stable = 'stable',
  Developing = 'developing',
  Transitioning = 'transitioning',
  Ambiguous = 'ambiguous'
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

export interface RegimeClassification {
  primaryRegime: MarketRegime;
  secondaryRegime: MarketRegime | null;
  confidence: number;
  transitionState: RegimeTransitionState;
  scores: Record<MarketRegime, number>;
  timestamp: number;
  features: MarketFeatures;
}

export interface RegimeTransition {
  fromRegime: MarketRegime;
  toRegime: MarketRegime;
  detectedAt: number;
  estimatedStartTime: number;
  confidence: number;
  transitionDurationMs: number;
}

export interface RegimeHistory {
  symbol: string;
  classifications: RegimeClassification[];
  currentRegimeStartTime: number;
  currentRegimeDurationMs: number;
  transitions: RegimeTransition[];
}

export interface RegimeClassifierConfig {
  minimumConfidence: number;
  transitionConfidenceThreshold: number;
  regimeConfirmationCount: number;
  trendWindow: number;
  volatilityWindow: number;
  maxHistoryItems: number;
  emitDetailedTelemetry: boolean;
}

export const DEFAULT_REGIME_CLASSIFIER_CONFIG: RegimeClassifierConfig = {
  minimumConfidence: 0.3,
  transitionConfidenceThreshold: 0.7,
  regimeConfirmationCount: 3,
  trendWindow: 20,
  volatilityWindow: 20,
  maxHistoryItems: 100,
  emitDetailedTelemetry: true
}; 