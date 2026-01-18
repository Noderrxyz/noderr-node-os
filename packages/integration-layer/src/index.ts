/**
 * Integration Layer - Production-ready orchestration layer for Noderr Protocol
 * 
 * Provides system orchestration, message routing, health monitoring,
 * recovery management, and configuration services for all modules.
 */

// Core
export { SystemOrchestrator } from './core/SystemOrchestrator';
export { EliteSystemIntegrator, validateEliteSystemIntegration } from './core/EliteSystemIntegrator';

// Message Bus
export { MessageBus } from './bus/MessageBus';
export { DeadLetterQueue } from './bus/DeadLetterQueue';

// Health Monitoring
export { HealthMonitor } from './health/HealthMonitor';

// Recovery
export { RecoveryManager } from './recovery/RecoveryManager';

// Configuration
export { ConfigurationService } from './config/ConfigurationService';

// Re-export winston for consistency
export { Logger } from 'winston';

// Export all types
export * from './types';

/**
 * Version information
 */
export const VERSION = '1.0.0';
export const API_VERSION = 'v1'; 
