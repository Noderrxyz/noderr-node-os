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

// ============================================================================
// Main Entry Point
// ============================================================================

import { Logger, createStatePersistence, StatePersistenceManager } from '@noderr/utils';
import { getShutdownHandler, onShutdown } from '@noderr/utils';
// RiskEngineService already imported above for default export

let riskEngineService: RiskEngineService | null = null;
let statePersistence: StatePersistenceManager<any> | null = null;

export async function startRiskEngineService(): Promise<void> {
  const logger = new Logger('RiskEngineService');
  
  try {
    logger.info('Starting Risk Engine Service...');
    
    // Initialize risk engine with default config
    riskEngineService = new RiskEngineService(defaultRiskEngineConfig);
    
    // Initialize state persistence
    statePersistence = createStatePersistence({
      stateDir: process.env.STATE_DIR || '/app/data/state',
      serviceName: 'risk-engine',
      maxBackups: 5,
      compress: true,
      autoSave: true,
      autoSaveInterval: 60000,  // 1 minute
    });
    
    await statePersistence.initialize();
    
    // Try to recover previous state
    const previousState = await statePersistence.load();
    if (previousState) {
      logger.info('Recovered previous risk state', {
        portfolioValue: previousState.portfolioValue,
        openPositions: previousState.openPositions?.length || 0,
      });
      // TODO: Restore risk state
    }
    
    // Start risk monitoring
    await riskEngineService.start();
    
    logger.info('Risk Engine Service configuration:');
    logger.info('- VaR Confidence Level:', defaultRiskEngineConfig.varConfig.confidenceLevel);
    logger.info('- Target Volatility:', defaultRiskEngineConfig.positionSizerConfig.targetVolatility);
    logger.info('- Liquidation Threshold:', defaultRiskEngineConfig.liquidationConfig.liquidationThreshold);
    logger.info('- Drawdown Threshold:', defaultRiskEngineConfig.alertThresholds.drawdownThreshold);
    
    onShutdown('risk-engine-service', async () => {
      logger.info('Shutting down risk engine service...');
      
      if (riskEngineService) {
        // Stop risk monitoring
        await riskEngineService.stop();
        
        // Save risk state
        if (statePersistence) {
          const state = {
            portfolioValue: 0,  // TODO: Get actual portfolio value
            openPositions: [],  // TODO: Get open positions
            riskMetrics: {},    // TODO: Get current risk metrics
            timestamp: Date.now(),
          };
          await statePersistence.save(state);
          statePersistence.stopAutoSave();
        }
      }
      
      logger.info('Risk engine service shut down complete');
    }, 15000);
    
    logger.info('Risk Engine Service started successfully');
    await new Promise(() => {});
  } catch (error) {
    logger.error('Failed to start Risk Engine Service', error);
    throw error;
  }
}

if (require.main === module) {
  getShutdownHandler(30000);
  startRiskEngineService().catch((error) => {
    console.error('Fatal error starting Risk Engine Service:', error);
    process.exit(1);
  });
}
