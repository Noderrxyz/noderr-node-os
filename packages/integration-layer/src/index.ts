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

// ============================================================================
// Main Entry Point
// ============================================================================

import { Logger, getShutdownHandler, onShutdown } from '@noderr/utils';

if (require.main === module) {
  const logger = new Logger('integration-layer');
  getShutdownHandler(30000);

  (async () => {
    try {
      logger.info('Starting Integration Layer Service...');
      logger.info(`Integration Layer v${VERSION} initialized`);

      onShutdown('integration-layer', async () => {
        logger.info('Integration Layer Service shut down complete');
      }, 5000);

      logger.info('Integration Layer Service started successfully');

      await new Promise(() => {});
    } catch (error) {
      logger.error('Fatal error starting Integration Layer Service:', error);
      process.exit(1);
    }
  })();
}
