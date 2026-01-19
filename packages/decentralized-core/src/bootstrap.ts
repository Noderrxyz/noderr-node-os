/**
 * Bootstrap Node Entry Point
 * 
 * Lightweight P2P bootstrap node that helps new nodes discover the network.
 * Does not participate in trading or consensus.
 */

import { Logger, getShutdownHandler, onShutdown } from '@noderr/utils/src';
import { NodeCommunicationLayer } from './NodeCommunicationLayer';

const logger = new Logger('bootstrap-node');

let p2pNode: NodeCommunicationLayer | null = null;

/**
 * Start the bootstrap node
 */
async function startBootstrapNode(): Promise<void> {
  try {
    logger.info('🚀 Starting Noderr Bootstrap Node');
    logger.info('==================================');
    
    const nodeId = process.env.NODE_ID || `bootstrap-${Date.now()}`;
    const listenPort = parseInt(process.env.P2P_LISTEN_PORT || '4001', 10);
    const wsPort = parseInt(process.env.P2P_WS_PORT || '4002', 10);
    
    logger.info('Configuration:', {
      nodeId,
      listenPort,
      wsPort
    });
    
    // Create P2P node
    p2pNode = new NodeCommunicationLayer(
      {
        peerId: nodeId,
        address: '', // Bootstrap nodes don't need wallet address
        reputation: 100,
        capabilities: ['bootstrap'],
        region: process.env.REGION || 'us-east',
        version: '1.0.0'
      },
      '', // No private key needed for bootstrap
      logger as any
    );
    
    // Initialize P2P network
    await p2pNode.initialize();
    
    logger.info('✅ Bootstrap node started successfully');
    logger.info(`Listening on TCP port ${listenPort} and WebSocket port ${wsPort}`);
    logger.info('Peer ID:', nodeId);
    
    // Log peer count every minute
    setInterval(() => {
      logger.info('Active peers: (TODO: implement peer count)');
    }, 60000);
    
    // Register graceful shutdown
    onShutdown('bootstrap-node', async () => {
      logger.info('Shutting down bootstrap node...');
      
      if (p2pNode) {
        // TODO: Add disconnect method to NodeCommunicationLayer
        p2pNode = null;
      }
      
      logger.info('Bootstrap node shut down complete');
    }, 10000);
    
    // Keep process alive
    await new Promise(() => {});
  } catch (error) {
    logger.error('Failed to start bootstrap node:', error);
    throw error;
  }
}

/**
 * If run directly, start the bootstrap node
 */
if (require.main === module) {
  getShutdownHandler(30000);
  
  startBootstrapNode().catch((error) => {
    logger.error('Fatal error starting bootstrap node:', error);
    process.exit(1);
  });
}

export { startBootstrapNode };
