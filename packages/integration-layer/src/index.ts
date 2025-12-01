/**
 * Integration Layer - Production-ready orchestration layer for Noderr Protocol
 * 
 * Provides system orchestration, message routing, health monitoring,
 * recovery management, and configuration services for all modules.
 */

// Core
// TODO: Fix type errors in these files (Phase 1.5 refinement)
// export { SystemOrchestrator } from './core/SystemOrchestrator';
// export { EliteSystemIntegrator, validateEliteSystemIntegration } from './core/EliteSystemIntegrator';

// Message Bus
// TODO: Fix type errors (Phase 1.5 refinement)
// export { MessageBus } from './bus/MessageBus';
// export { DeadLetterQueue } from './bus/DeadLetterQueue';

// Health Monitoring
// TODO: Fix type errors (Phase 1.5 refinement)
// export { HealthMonitor } from './health/HealthMonitor';

// Recovery
// TODO: Fix type errors (Phase 1.5 refinement)
// export { RecoveryManager } from './recovery/RecoveryManager';

// Configuration
// TODO: Fix type errors (Phase 1.5 refinement)
// export { ConfigurationService } from './config/ConfigurationService';

// Re-export winston for consistency
export { Logger } from 'winston';

// Export all types
export * from './types';

/**
 * Version information
 */
export const VERSION = '1.0.0';
export const API_VERSION = 'v1'; 
