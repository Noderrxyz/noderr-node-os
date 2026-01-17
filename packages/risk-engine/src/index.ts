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
export const defaultRiskEngineConfig: RiskEngineConfig = {
  var: {
    confidenceLevel: 0.99,
    lookbackPeriod: 252,
    method: 'monteCarlo' as const,
    timeHorizon: 1,
    decayFactor: 0.94
  },
  positionSizing: {
    methodology: 'volatilityTarget' as const,
    targetVolatility: 0.15,
    maxPositionSize: 0.1,
    minPositionSize: 0.001,
    correlationAdjustment: true,
    confidenceLevel: 0.25
  },
  stressTesting: {
    scenarios: [],
    historicalEvents: [],
    monteCarloConfig: {
      iterations: 10000,
      timeHorizon: 1,
      returnModel: 'normal' as const,
      volatilityModel: 'constant' as const,
      correlationModel: 'static' as const
    }
  },
  liquidation: {
    marginCallThreshold: 0.8,
    liquidationThreshold: 0.95,
    maintenanceMarginRatio: 0.05,
    deleveragingStrategy: 'riskWeighted' as const,
    gracePeriod: 60000,
    partialLiquidationAllowed: true
  },
  capitalProtection: {
    circuitBreaker: {
      dailyLossLimit: 0.05,
      weeklyLossLimit: 0.10,
      monthlyLossLimit: 0.20,
      consecutiveLossLimit: 3,
      volatilityMultiplier: 3.0,
      cooldownPeriod: 3600000,
      autoResumeEnabled: true
    },
    emergencyExit: {
      triggerConditions: [],
      exitStrategy: 'optimal' as const,
      priorityOrder: [],
      maxSlippage: 0.05,
      splitOrders: true,
      notificationChannels: []
    },
    recoveryStrategy: {
      type: 'adaptive' as const,
      targetRecoveryTime: 30,
      riskBudget: 0.02,
      allowableStrategies: [],
      reentryRules: []
    }
  },
  reporting: {
    frequency: 3600000,
    recipients: [],
    format: 'json' as const,
    includeCharts: false
  },
  telemetry: {
    enabled: true,
    endpoint: process.env.TELEMETRY_ENDPOINT || 'http://localhost:9090',
    sampleRate: 1.0
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
    riskEngineService = new RiskEngineService(defaultRiskEngineConfig, logger);
    
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
