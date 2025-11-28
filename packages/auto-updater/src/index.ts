/**
 * Auto-Updater Main Entry Point
 * 
 * Automated version update agent for Noderr Node OS
 * 
 * @module index
 */

import cron from 'node-cron';
import { loadConfig, validateConfig } from './config';
import { UpdateOrchestrator, UpdateStatus } from './updater';
import { logger } from './logger';

/**
 * Telemetry reporter
 */
async function reportTelemetry(
  config: ReturnType<typeof loadConfig>,
  result: Awaited<ReturnType<UpdateOrchestrator['checkAndUpdate']>>
): Promise<void> {
  try {
    const response = await fetch(config.telemetryEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        nodeId: config.nodeId,
        nodeTier: config.nodeTier,
        timestamp: Date.now(),
        updateResult: result,
      }),
    });
    
    if (!response.ok) {
      logger.warn('Failed to report telemetry', {
        status: response.status,
        statusText: response.statusText,
      });
    } else {
      logger.debug('Telemetry reported successfully');
    }
  } catch (error) {
    logger.error('Telemetry reporting error', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Main update check function
 */
async function runUpdateCheck(orchestrator: UpdateOrchestrator, config: ReturnType<typeof loadConfig>): Promise<void> {
  logger.info('Running scheduled update check');
  
  try {
    const result = await orchestrator.checkAndUpdate();
    
    logger.info('Update check complete', {
      status: result.status,
      oldVersion: result.oldVersion,
      newVersion: result.newVersion,
      duration: result.duration,
    });
    
    // Report telemetry
    await reportTelemetry(config, result);
    
    // Log important status changes
    if (result.status === UpdateStatus.SUCCESS) {
      logger.info('✅ Update successful', {
        from: result.oldVersion,
        to: result.newVersion,
      });
    } else if (result.status === UpdateStatus.ROLLED_BACK) {
      logger.warn('⚠️  Update rolled back', {
        version: result.newVersion,
        error: result.error,
      });
    } else if (result.status === UpdateStatus.FAILED) {
      logger.error('❌ Update failed', {
        error: result.error,
      });
    }
  } catch (error) {
    logger.error('Update check error', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Main function
 */
async function main(): Promise<void> {
  logger.info('🚀 Noderr Auto-Updater starting...');
  
  try {
    // Load and validate configuration
    const config = loadConfig();
    validateConfig(config);
    
    logger.info('Configuration loaded', {
      nodeTier: config.nodeTier,
      nodeId: config.nodeId,
      checkInterval: config.checkInterval,
      autoUpdateEnabled: config.autoUpdateEnabled,
    });
    
    // Get current version from environment
    const currentVersion = process.env.CURRENT_VERSION || '0.1.0';
    logger.info('Current version', { version: currentVersion });
    
    // Create orchestrator
    const orchestrator = new UpdateOrchestrator(config, currentVersion);
    
    // Test VersionBeacon connection
    logger.info('Testing VersionBeacon connection...');
    const versionBeacon = orchestrator['versionBeacon'];
    const connected = await versionBeacon.testConnection();
    
    if (!connected) {
      logger.error('❌ Failed to connect to VersionBeacon contract');
      process.exit(1);
    }
    
    logger.info('✅ VersionBeacon connection successful');
    
    // Run initial check
    logger.info('Running initial update check...');
    await runUpdateCheck(orchestrator, config);
    
    // Schedule periodic checks
    const cronExpression = `*/${Math.floor(config.checkInterval / 60000)} * * * *`;
    logger.info('Scheduling periodic checks', {
      interval: config.checkInterval,
      cronExpression,
    });
    
    cron.schedule(cronExpression, async () => {
      await runUpdateCheck(orchestrator, config);
    });
    
    logger.info('✅ Auto-Updater running');
    
    // Keep process alive
    process.on('SIGINT', () => {
      logger.info('Received SIGINT, shutting down gracefully...');
      process.exit(0);
    });
    
    process.on('SIGTERM', () => {
      logger.info('Received SIGTERM, shutting down gracefully...');
      process.exit(0);
    });
  } catch (error) {
    logger.error('Fatal error during startup', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch(error => {
    logger.error('Unhandled error', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
}

export { UpdateOrchestrator, UpdateStatus };
export * from './config';
export * from './version-beacon';
export * from './cohort';
export * from './docker';
export * from './health';
export * from './rollback';
