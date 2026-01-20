/**
 * @noderr/execution - Simplified exports for working components
 */

// Export working algorithm implementations
export { TWAPAlgorithm } from './TWAPAlgorithm';
export { VWAPAlgorithm } from './VWAPAlgorithm';
export { POVAlgorithm } from './POVAlgorithm';
export { IcebergAlgorithm } from './IcebergAlgorithm';

// Export working utility classes
export { CostOptimizer } from './CostOptimizer';
export { LiquidityAggregator } from './LiquidityAggregator';
export { LatencyManager } from './LatencyManager';
export { VenueOptimizer } from './VenueOptimizer';
// ExchangeBatcher temporarily disabled due to CircuitBreaker dependency
// export { ExchangeBatcher } from './ExchangeBatcher';

// Export working services  
export { SmartExecutionEngine } from './SmartExecutionEngine';
// OrderLifecycleManager temporarily disabled due to DistributedStateManager dependency
// export { OrderLifecycleManager } from './OrderLifecycleManager';
// PositionReconciliation temporarily disabled due to CircuitBreaker dependency
// export { PositionReconciliation } from './PositionReconciliation';
export { OrderPool } from './OrderPool';

// Re-export types from @noderr/types
export type {
  Order,
  OrderStatus,
  ExecutionResult,
  ExecutionStrategy,
  VenueConfig,
  AlgorithmConfig,
  MEVConfig,
  SafetyConfig,
  Fill,
  ExecutionRoute,
  ExecutedRoute
} from '@noderr/types';

export const VERSION = '1.0.0';
