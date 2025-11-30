/**
 * Risk Engine Module
 * Institutional-grade risk management for Noderr Protocol
 */

// Risk Engine - Main Exports
export * from './types';
export { VaRCalculator } from './core/VaRCalculator';
export { PositionSizer } from './core/PositionSizer';
export { StressTester } from './core/StressTester';
export { LiquidationTrigger } from './core/LiquidationTrigger';
export { CircuitBreakerService } from './capital-protection/CircuitBreakerService';
export { RiskEngineService } from './services/RiskEngineService';

// Default export for convenience
import { RiskEngineService } from './services/RiskEngineService';
export default RiskEngineService;

// Export default configuration
export const defaultRiskEngineConfig = {
  varConfig: {
    confidenceLevel: 0.99,
    lookbackPeriod: 252,
    methodology: 'monteCarlo' as const,
    decayFactor: 0.94
  },
  positionSizerConfig: {
    methodology: 'volatilityTarget' as const,
    targetVolatility: 0.15,
    maxPositionSize: 0.1,
    correlationAdjustment: true,
    confidenceLevel: 0.25
  },
  liquidationConfig: {
    marginCallThreshold: 0.8,
    liquidationThreshold: 0.95,
    deleveragingStrategy: 'riskWeighted' as const,
    gracePeriod: 60
  },
  alertThresholds: {
    varBreachThreshold: 0.05,
    drawdownThreshold: 0.20,
    correlationSpikeThreshold: 0.8,
    liquidityThreshold: 0.3
  }
}; 