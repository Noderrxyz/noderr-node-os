/**
 * Auto-Updater Main Entry Point
 * 
 * Automated version update agent for Noderr Node OS.
 * 
 * When the required environment variables (VERSION_BEACON_ADDRESS,
 * RPC_ENDPOINT) are not set, the process stays alive in an idle state
 * rather than crash-looping.  This is expected during manual testing
 * or for nodes deployed before the auto-updater was integrated.
 * 
 * @module index
 */

import cron from 'node-cron';
import { loadConfig, validateConfig, AutoUpdaterConfig } from './config';
import { UpdateOrchestrator, UpdateStatus } from './updater';
import { logger } from './logger';

/**
 * Telemetry reporter
 */
async function reportTelemetry(
  config: AutoUpdaterConfig,
  result: Awaited<ReturnType<UpdateOrchestrator['checkAndUpdate']>>
): Promise<void> {
  if (!config.telemetryEndpoint) return;

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
async function runUpdateCheck(orchestrator: UpdateOrchestrator, config: AutoUpdaterConfig): Promise<void> {
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
      logger.info('Update successful', {
        from: result.oldVersion,
        to: result.newVersion,
      });
    } else if (result.status === UpdateStatus.ROLLED_BACK) {
      logger.warn('Update rolled back', {
        version: result.newVersion,
        error: result.error,
      });
    } else if (result.status === UpdateStatus.FAILED) {
      logger.error('Update failed', {
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
 * Idle loop — keeps the process alive in PM2 when the auto-updater
 * is not configured.  Periodically re-checks env vars so that if an
 * operator adds them to node.env and restarts the container, the
 * auto-updater will pick them up without a full redeploy.
 */
async function idle(): Promise<void> {
  logger.info(
    'Auto-updater is not configured (VERSION_BEACON_ADDRESS / RPC_ENDPOINT not set). ' +
    'Idling until environment variables are provided. ' +
    'This is normal during manual testing or for pre-existing deployments.',
  );

  // Re-check every 5 minutes in case env vars are hot-reloaded
  const RECHECK_MS = 5 * 60 * 1000;

  const check = () => {
    const config = loadConfig();
    if (config) {
      logger.info('Configuration detected — starting auto-updater.');
      startWithConfig(config);
    } else {
      setTimeout(check, RECHECK_MS);
    }
  };

  setTimeout(check, RECHECK_MS);
}

/**
 * Start the auto-updater with a validated configuration.
 */
async function startWithConfig(config: AutoUpdaterConfig): Promise<void> {
  try {
    validateConfig(config);
  } catch (err) {
    logger.error('Configuration validation failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    // Don't exit — stay alive so PM2 doesn't crash-loop
    return;
  }

  logger.info('Configuration loaded', {
    nodeTier: config.nodeTier,
    nodeId: config.nodeId,
    checkInterval: config.checkInterval,
    autoUpdateEnabled: config.autoUpdateEnabled,
  });

  // Get current version from environment
  const currentVersion = process.env.CURRENT_VERSION || process.env.NODE_VERSION || '0.1.0';
  logger.info('Current version', { version: currentVersion });

  // Create orchestrator
  const orchestrator = new UpdateOrchestrator(config, currentVersion);

  // Test VersionBeacon connection
  logger.info('Testing VersionBeacon connection...');
  const versionBeacon = orchestrator['versionBeacon'];
  const connected = await versionBeacon.testConnection();

  if (!connected) {
    logger.warn(
      'Could not connect to VersionBeacon contract. ' +
      'Will retry on next scheduled check.',
    );
    // Don't exit — schedule checks anyway; the RPC might come back
  } else {
    logger.info('VersionBeacon connection successful');
  }

  // Run initial check
  logger.info('Running initial update check...');
  await runUpdateCheck(orchestrator, config);

  // Schedule periodic checks
  const intervalMinutes = Math.max(1, Math.floor(config.checkInterval / 60000));
  const cronExpression = `*/${intervalMinutes} * * * *`;
  logger.info('Scheduling periodic checks', {
    interval: config.checkInterval,
    cronExpression,
  });

  cron.schedule(cronExpression, async () => {
    await runUpdateCheck(orchestrator, config);
  });

  logger.info('Auto-updater running');
}

/**
 * Main function
 */
async function main(): Promise<void> {
  logger.info('Noderr Auto-Updater starting...');

  // Graceful shutdown handlers
  process.on('SIGINT', () => {
    logger.info('Received SIGINT, shutting down gracefully...');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    logger.info('Received SIGTERM, shutting down gracefully...');
    process.exit(0);
  });

  const config = loadConfig();

  if (!config) {
    await idle();
    return;
  }

  await startWithConfig(config);
}

// Run if executed directly
if (require.main === module) {
  main().catch(error => {
    logger.error('Unhandled error', {
      error: error instanceof Error ? error.message : String(error),
    });
    // Stay alive — let PM2 manage restarts
  });
}

export { UpdateOrchestrator, UpdateStatus };
export * from './config';
export * from './version-beacon';
export * from './cohort';
export * from './docker';
export * from './health';
export * from './rollback';
