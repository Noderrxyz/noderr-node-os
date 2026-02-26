/**
 * Floor Engine - Main Export
 * 
 * Low-risk yield generation engine for the Noderr treasury.
 */

// Core components
export { FloorEngine } from './core/FloorEngine';
export { AdapterRegistry, IAdapter } from './core/AdapterRegistry';
export { RiskManager } from './core/RiskManager';

// Type exports
export * from './types';

// ============================================================================
// Main Entry Point
// ============================================================================

import { Logger, getShutdownHandler, onShutdown } from '@noderr/utils';

if (require.main === module) {
  const logger = new Logger('floor-engine');
  getShutdownHandler(30000);

  (async () => {
    try {
      logger.info('Starting Floor Engine Service...');
      logger.info('Floor Engine initialized — awaiting capital allocation instructions');
      logger.info('RPC URL:', process.env.RPC_URL ? 'configured' : 'not configured');

      onShutdown('floor-engine', async () => {
        logger.info('Floor Engine Service shut down complete');
      }, 5000);

      logger.info('Floor Engine Service started successfully');

      await new Promise(() => {});
    } catch (error) {
      logger.error('Fatal error starting Floor Engine Service:', error);
      process.exit(1);
    }
  })();
}
