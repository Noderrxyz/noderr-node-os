/**
 * @fileoverview Comprehensive type system for the Phoenix ML trading system.
 * @author Manus AI
 * @version 1.0.0
 */
/**
 * Represents a single feature set for a given timestamp.
 */
export interface FeatureSet {
    timestamp: number;
    symbol: string;
    priceFeatures: PriceFeatures;
    volumeFeatures: VolumeFeatures;
    technicalFeatures: TechnicalFeatures;
    marketFeatures: MarketFeatures;
    sentimentFeatures: SentimentFeatures;
    onChainFeatures: OnChainFeatures;
    customFeatures?: Record<string, number>;
}
/**
 * Represents the output of a prediction model.
 */
export interface PredictionResult {
    timestamp: number;
    symbol: string;
    predictions: Predictions;
    confidence: ConfidenceMetrics;
    attentionWeights?: AttentionWeights;
    featureImportance?: FeatureImportance[];
}
/**
 * Represents the performance of a model.
 */
export interface ModelPerformance {
    accuracy: number;
    precision: number;
    recall: number;
    f1Score: number;
    sharpeRatio: number;
    sortinoRatio: number;
    maxDrawdown: number;
    winRate: number;
    avgWin: number;
    avgLoss: number;
    totalTrades: number;
}
/**
 * Represents the status of a model.
 */
export declare enum ModelStatus {
    READY = "READY",
    TRAINING = "TRAINING",
    PREDICTING = "PREDICTING",
    EVALUATING = "EVALUATING",
    FAILED = "FAILED"
}
export interface PriceFeatures {
    open: number;
    high: number;
    low: number;
    close: number;
    vwap: number;
    returns1h: number;
    returns24h: number;
    realizedVol1h: number;
    realizedVol24h: number;
    bidAskSpread: number;
}
export interface VolumeFeatures {
    volume: number;
    volumeRatio: number;
    buyVolume: number;
    sellVolume: number;
    trades: number;
}
export interface TechnicalFeatures {
    rsi: Record<number, number>;
    macd: {
        line: number;
        signal: number;
        histogram: number;
    };
    bollingerBands: {
        upper: number;
        middle: number;
        lower: number;
    };
    adx: number;
    atr: number;
    obv: number;
    stoch: {
        k: number;
        d: number;
    };
}
export interface MarketFeatures {
    regime: 'trending' | 'ranging' | 'volatile';
    correlation: Record<string, number>;
    fundingRate: number;
    openInterest: number;
}
export interface SentimentFeatures {
    bullBearRatio: number;
    socialMediaMentions: number;
    newsSentiment: number;
}
export interface OnChainFeatures {
    activeAddresses: number;
    transactionCount: number;
    largeTransactions: number;
    hashRate: number;
}
export interface TransformerConfig {
    sequenceLength: number;
    embeddingDim: number;
    numHeads: number;
    ffDim: number;
    numLayers: number;
    dropoutRate: number;
    learningRate: number;
}
export interface Predictions {
    priceDirection: 'up' | 'down' | 'neutral';
    volatilityForecast: number;
    returnDistribution: ReturnDistribution;
    timingSignal: TimingSignal;
}
export interface ConfidenceMetrics {
    priceDirection: number;
    volatility: number;
    overall: number;
}
export interface AttentionWeights {
    weights: number[][];
    heads: number[][][];
}
export interface FeatureImportance {
    feature: string;
    importance: number;
}
export interface ReturnDistribution {
    mean: number;
    std: number;
    skew: number;
    kurtosis: number;
}
export interface TimingSignal {
    action: 'buy' | 'sell' | 'hold';
    confidence: number;
}
export interface KellyCriterionConfig {
    confidenceLevel: number;
    minTrades: number;
}
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
export interface GAFConfig {
    imageSize: number;
    method: 'GASF' | 'GADF';
    scaling: 'minmax' | 'standard';
}
export interface GAFImage {
    timestamp: number;
    symbol: string;
    image: number[][];
    method: 'GASF' | 'GADF';
}
export declare enum MLErrorCode {
    INVALID_FEATURES = "INVALID_FEATURES",
    MODEL_NOT_FOUND = "MODEL_NOT_FOUND",
    TRAINING_FAILED = "TRAINING_FAILED",
    PREDICTION_FAILED = "PREDICTION_FAILED"
}
export declare class MLError extends Error {
    code: MLErrorCode;
    cause?: any | undefined;
    constructor(code: MLErrorCode, message: string, cause?: any | undefined);
}
//# sourceMappingURL=ml.d.ts.map