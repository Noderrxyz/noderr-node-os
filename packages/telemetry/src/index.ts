/**
 * @noderr/telemetry - Unified telemetry system
 * 
 * Main entry point that starts the TelemetryService with HTTP server
 * for /health and /metrics endpoints.
 */

import { Logger, getShutdownHandler, onShutdown } from '@noderr/utils';
import { createLogger, format, transports } from 'winston';
import { TelemetryService } from './TelemetryService';
import { LogLevel } from './types/telemetry';

const logger = new Logger('telemetry');

// Re-export core classes for library usage
export { TelemetryService } from './TelemetryService';
export { MetricsCollector } from './collectors/MetricsCollector';
export { MetricExporter } from './exporters/MetricExporter';
export { LogBridge } from './loggers/LogBridge';
export { Tracer } from './tracers/Tracer';
export { ErrorAlertRouter } from './ErrorAlertRouter';
export * from './types/telemetry';

// ============================================================================
// Main Entry Point for Telemetry Service
// ============================================================================

let telemetryService: TelemetryService | null = null;

/**
 * Start the telemetry service with HTTP server
 */
export async function startTelemetryService(): Promise<void> {
  const winstonLogger = createLogger({
    format: format.combine(format.timestamp(), format.json()),
    defaultMeta: { service: 'telemetry-service' },
    transports: [
      new transports.Console({
        format: format.combine(
          format.colorize(),
          format.simple()
        )
      })
    ]
  });
  
  try {
    logger.info('Starting Telemetry Service...');
    
    // Get configuration from environment
    const metricsPort = parseInt(process.env.METRICS_PORT || '8080', 10);
    const serviceName = process.env.SERVICE_NAME || 'noderr-node';
    const environment = process.env.NODE_ENV || 'production';
    const version = process.env.VERSION || '1.0.0';
    
    logger.info('Telemetry configuration', {
      metricsPort,
      serviceName,
      environment,
      version
    });
    
    // Initialize telemetry service
    telemetryService = new TelemetryService(winstonLogger, {
      serviceName,
      environment,
      version,
      metrics: {
        enabled: true,
        port: metricsPort,
        interval: 60000 // 1 minute
      },
      logging: {
        enabled: true,
        level: LogLevel.INFO
      },
      tracing: {
        enabled: false // Disable tracing for now
      },
      alerting: {
        enabled: false // Disable alerting for now
      }
    });
    
    // Initialize and start
    await telemetryService.initialize();
    await telemetryService.start();
    
    // Register graceful shutdown handlers
    onShutdown('telemetry-service', async () => {
      logger.info('Shutting down telemetry service...');
      
      if (telemetryService) {
        await telemetryService.stop();
      }
      
      logger.info('Telemetry service shut down complete');
    }, 10000);  // 10 second timeout
    
    logger.info('Telemetry Service started successfully');
    logger.info(`HTTP server listening on port ${metricsPort}`);
    logger.info('Endpoints: /health, /metrics');
    
    // Keep process alive
    // Keep the event loop alive with a periodic heartbeat
    setInterval(() => { /* keep-alive */ }, 60000);
  } catch (error) {
    logger.error('Failed to start Telemetry Service', error);
    throw error;
  }
}

/**
 * If run directly, start the service
 */
if (require.main === module) {
  // Initialize graceful shutdown
  getShutdownHandler(30000);  // 30 second global timeout
  
  startTelemetryService().catch((error) => {
    logger.error('Fatal error starting Telemetry Service:', error);
    process.exit(1);
  });
}
