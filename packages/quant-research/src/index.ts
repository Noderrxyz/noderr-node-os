/**
 * Quant Research Module - Elite quantitative analysis and strategy development
 * 
 * Provides institutional-grade backtesting, optimization, factor analysis,
 * and portfolio construction for crypto trading strategies.
 */

// Core service
export { QuantResearchService } from './core/QuantResearchService';

// Components
export { Backtester } from './backtesting/Backtester';
export { WalkForwardOptimizer } from './optimization/WalkForwardOptimizer';
export { MonteCarloSimulator } from './simulation/MonteCarloSimulator';
export { AlphaDecayAnalyzer } from './analysis/AlphaDecayAnalyzer';
export { StrategyABTestEngine } from './testing/StrategyABTestEngine';
export { FactorAnalyzer } from './factors/FactorAnalyzer';
export { PortfolioOptimizer } from './portfolio/PortfolioOptimizer';

// Analytics and Data
export { StatsEngine } from './analytics/StatsEngine';
export { DataManager } from './data/DataManager';
export { TimeSeriesForecaster } from './forecasting/TimeSeriesForecaster';

// Types
export * from './types';

// Version
export const VERSION = '1.0.0'; 