/**
 * @noderr/data-connectors - External Data Connectivity Service
 * 
 * Manages connections to external data sources (news, social media, on-chain data).
 * 
 * Features:
 * - News API integration
 * - Twitter/X sentiment analysis
 * - Reddit data collection
 * - On-chain analytics
 * - Alternative data sources
 */

import { Logger } from '@noderr/utils';
import { getShutdownHandler, onShutdown } from '@noderr/utils';
const logger = new Logger('data-connectors');

/**
 * Data Connectors Service
 */
export class DataConnectorsService {
  private logger: Logger;
  private connections: Map<string, any> = new Map();
  
  constructor(config: {
    sources: string[];
  }) {
    this.logger = new Logger('DataConnectorsService');
    this.logger.info('DataConnectorsService initialized', config);
  }
  
  async connect(): Promise<void> {
    this.logger.info('Connecting to data sources...');
    // TODO: Implement data source connections
  }
  
  async disconnect(): Promise<void> {
    this.logger.info('Disconnecting from data sources...');
    
    for (const [source, connection] of this.connections) {
      try {
        if (connection && typeof connection.close === 'function') {
          await connection.close();
        }
        this.logger.info(`Disconnected from ${source}`);
      } catch (error) {
        this.logger.error(`Error disconnecting from ${source}`, error);
      }
    }
    
    this.connections.clear();
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

let dataConnectorsService: DataConnectorsService | null = null;

export async function startDataConnectorsService(): Promise<void> {
  const logger = new Logger('DataConnectorsService');
  
  try {
    logger.info('Starting Data Connectors Service...');
    
    const sources = process.env.DATA_SOURCES?.split(',') || ['news', 'twitter', 'reddit'];
    
    dataConnectorsService = new DataConnectorsService({ sources });
    await dataConnectorsService.connect();
    
    onShutdown('data-connectors-service', async () => {
      logger.info('Shutting down data connectors service...');
      if (dataConnectorsService) {
        await dataConnectorsService.disconnect();
      }
      logger.info('Data connectors service shut down complete');
    }, 15000);
    
    logger.info('Data Connectors Service started successfully');
    // Keep the process alive indefinitely until a shutdown signal is received.
    // Using a timer-based keep-alive ensures the Node.js event loop stays active
    // even when there are no other pending async operations.
    await new Promise<void>((resolve) => {
      const keepAlive = setInterval(() => {
        // intentional no-op — just keeps the event loop ticking
      }, 60_000);
      // The GracefulShutdown handler will call process.exit(), which clears
      // the interval automatically. But we also clear it explicitly on resolve.
      process.once('exit', () => clearInterval(keepAlive));
    });
  } catch (error) {
    logger.error('Failed to start Data Connectors Service', error);
    throw error;
  }
}

if (require.main === module) {
  getShutdownHandler(30000);
  // Top-level await via IIFE so the pending promise keeps the event loop alive
  (async () => {
    try {
      await startDataConnectorsService();
    } catch (error) {
      logger.error('Fatal error starting Data Connectors Service:', error);
      process.exit(1);
    }
  })();
}
