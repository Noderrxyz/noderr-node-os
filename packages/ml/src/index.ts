/**
 * @noderr/ml - Unified ML/AI engine
 * Production-ready machine learning models for algorithmic trading
 */

// Core ML Models
export { TransformerPredictor } from './TransformerPredictor';
export { ReinforcementLearner } from './ReinforcementLearner';
export { StrategyEvolution } from './StrategyEvolution';
export { FeatureEngineer } from './FeatureEngineer';

// Advanced Components
export { AICoreService } from './AICoreService';
export { ModelOrchestrator } from './ModelOrchestrator';
export { FractalPatternDetector } from './FractalPatternDetector';
export { MarketRegimeClassifier } from './MarketRegimeClassifier';

// Type Exports
export type { MarketRegime, RegimeTransition, RegimeFeatures } from './MarketRegimeTypes';

// Aliases for backward compatibility
export { ReinforcementLearner as RLTrader } from './ReinforcementLearner';
export { FeatureEngineer as FeatureEngine } from './FeatureEngineer';

// Version
export const VERSION = '1.0.0';
