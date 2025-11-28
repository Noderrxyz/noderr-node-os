// Main entry point for Noderr Trading System

import { SystemOrchestrator, SystemConfig } from './SystemOrchestrator';

export { SystemOrchestrator };
export type { 
  SystemConfig, 
  ComponentConfig, 
  SystemStatus, 
  ComponentStatus, 
  SystemMetrics, 
  SystemAlert 
} from './SystemOrchestrator';

// Re-export key components for direct access
export { PositionReconciliation } from '../../execution-engine/src/PositionReconciliation';
export { OrderLifecycleManager } from '../../execution-engine/src/OrderLifecycleManager';
export { BacktestingFramework } from '../../backtesting/src/BacktestingFramework';
export { DynamicRiskLimits } from '../../risk-engine/src/DynamicRiskLimits';
export { ModelVersioningSystem } from '../../ml-enhanced/src/ModelVersioning';
export { NetworkPartitionSafety } from '../../decentralized-core/src/NetworkPartitionSafety';
export { ComplianceEngine } from '../../compliance/src/ComplianceEngine';
export { MultiAssetManager } from '../../multi-asset/src/MultiAssetManager';
export { LoadTestingFramework } from '../../testing/src/LoadTestingFramework';
export { IntegrationTestSuite } from '../../testing/src/IntegrationTestSuite';

// Default configuration
export const defaultConfig: SystemConfig = {
  name: 'Noderr Trading System',
  version: '1.0.0',
  environment: 'development',
  logLevel: 'info',
  components: [
    {
      name: 'positionReconciliation',
      enabled: true,
      config: {}
    },
    {
      name: 'orderManager',
      enabled: true,
      config: {}
    },
    {
      name: 'riskLimits',
      enabled: true,
      config: {
        basePositionLimit: 100000,
        baseExposureLimit: 1000000,
        baseLeverageLimit: 10,
        baseDrawdownLimit: 0.2,
        volatilityWindow: 20,
        adjustmentFactor: 0.5,
        updateInterval: 5000
      }
    },
    {
      name: 'compliance',
      enabled: true,
      config: {
        jurisdiction: 'US',
        regulations: ['DODD_FRANK'],
        kycRequired: true,
        amlEnabled: true,
        transactionLimits: {
          dailyLimit: 1000000,
          singleTransactionLimit: 100000,
          monthlyLimit: 10000000,
          requiresApprovalAbove: 50000
        },
        reportingThresholds: {
          largeTransaction: 10000,
          suspiciousPattern: 5000,
          aggregateDaily: 100000
        },
        dataRetentionDays: 2555
      }
    },
    {
      name: 'multiAsset',
      enabled: true,
      config: {}
    },
    {
      name: 'modelVersioning',
      enabled: true,
      config: {
        basePath: './models'
      }
    },
    {
      name: 'networkSafety',
      enabled: false, // Disabled by default for single-node operation
      config: {
        nodeId: 'node-1',
        peers: []
      }
    }
  ]
};

// Quick start function
export async function createSystem(config?: Partial<SystemConfig>): Promise<SystemOrchestrator> {
  const finalConfig = {
    ...defaultConfig,
    ...config,
    components: config?.components || defaultConfig.components
  };
  
  const system = new SystemOrchestrator(finalConfig);
  await system.initialize();
  
  return system;
} 