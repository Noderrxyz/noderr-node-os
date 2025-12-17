"use strict";
/**
 * Machine Learning and AI Types
 * Comprehensive type definitions for ML/AI components
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SignalProvider = exports.FractalType = exports.PositionSizingMethod = exports.NormalizationMethod = exports.RLAlgorithm = exports.MarketRegime = exports.MLErrorCode = exports.ModelStatus = exports.ModelType = void 0;
var ModelType;
(function (ModelType) {
    ModelType["TRANSFORMER"] = "transformer";
    ModelType["LSTM"] = "lstm";
    ModelType["RL"] = "rl";
    ModelType["ENSEMBLE"] = "ensemble";
    ModelType["CAUSAL"] = "causal";
    ModelType["EVOLUTIONARY"] = "evolutionary";
})(ModelType || (exports.ModelType = ModelType = {}));
var ModelStatus;
(function (ModelStatus) {
    ModelStatus["UNINITIALIZED"] = "uninitialized";
    ModelStatus["TRAINING"] = "training";
    ModelStatus["READY"] = "ready";
    ModelStatus["ERROR"] = "error";
})(ModelStatus || (exports.ModelStatus = ModelStatus = {}));
var MLErrorCode;
(function (MLErrorCode) {
    MLErrorCode["MODEL_NOT_INITIALIZED"] = "MODEL_NOT_INITIALIZED";
    MLErrorCode["INVALID_INPUT"] = "INVALID_INPUT";
    MLErrorCode["TRAINING_FAILED"] = "TRAINING_FAILED";
    MLErrorCode["PREDICTION_FAILED"] = "PREDICTION_FAILED";
})(MLErrorCode || (exports.MLErrorCode = MLErrorCode = {}));
// ============================================================================
// Market Regime Types
// ============================================================================
var MarketRegime;
(function (MarketRegime) {
    MarketRegime["BULLISH_TREND"] = "bullish_trend";
    MarketRegime["BEARISH_TREND"] = "bearish_trend";
    MarketRegime["RANGEBOUND"] = "rangebound";
    MarketRegime["MEAN_REVERTING"] = "mean_reverting";
    MarketRegime["HIGH_VOLATILITY"] = "high_volatility";
    MarketRegime["LOW_VOLATILITY"] = "low_volatility";
    MarketRegime["HIGH_LIQUIDITY"] = "high_liquidity";
    MarketRegime["LOW_LIQUIDITY"] = "low_liquidity";
    MarketRegime["MARKET_STRESS"] = "market_stress";
    MarketRegime["BULL_VOLATILE"] = "bull_volatile";
    MarketRegime["BEAR_VOLATILE"] = "bear_volatile";
    MarketRegime["RANGEBOUND_LOW_VOL"] = "rangebound_low_vol";
    MarketRegime["UNKNOWN"] = "unknown";
})(MarketRegime || (exports.MarketRegime = MarketRegime = {}));
var RLAlgorithm;
(function (RLAlgorithm) {
    RLAlgorithm["DQN"] = "DQN";
    RLAlgorithm["DDQN"] = "DDQN";
    RLAlgorithm["PPO"] = "PPO";
    RLAlgorithm["A3C"] = "A3C";
    RLAlgorithm["SAC"] = "SAC";
})(RLAlgorithm || (exports.RLAlgorithm = RLAlgorithm = {}));
var NormalizationMethod;
(function (NormalizationMethod) {
    NormalizationMethod["MINMAX"] = "minmax";
    NormalizationMethod["ZSCORE"] = "zscore";
    NormalizationMethod["ROBUST"] = "robust";
    NormalizationMethod["NONE"] = "none";
})(NormalizationMethod || (exports.NormalizationMethod = NormalizationMethod = {}));
var PositionSizingMethod;
(function (PositionSizingMethod) {
    PositionSizingMethod["FIXED"] = "fixed";
    PositionSizingMethod["KELLY"] = "kelly";
    PositionSizingMethod["RISK_PARITY"] = "risk_parity";
    PositionSizingMethod["VOLATILITY_SCALED"] = "volatility_scaled";
    PositionSizingMethod["DYNAMIC"] = "dynamic";
})(PositionSizingMethod || (exports.PositionSizingMethod = PositionSizingMethod = {}));
// ============================================================================
// Fractal Pattern Types
// ============================================================================
var FractalType;
(function (FractalType) {
    FractalType["BULLISH"] = "bullish";
    FractalType["BEARISH"] = "bearish";
    FractalType["NEUTRAL"] = "neutral";
    FractalType["COMPLEX"] = "complex";
})(FractalType || (exports.FractalType = FractalType = {}));
var SignalProvider;
(function (SignalProvider) {
    SignalProvider["NUMERAI"] = "numerai";
    SignalProvider["QUANTCONNECT"] = "quantconnect";
    SignalProvider["CUSTOM"] = "custom";
    SignalProvider["INTERNAL"] = "internal";
})(SignalProvider || (exports.SignalProvider = SignalProvider = {}));
//# sourceMappingURL=ml-types.js.map