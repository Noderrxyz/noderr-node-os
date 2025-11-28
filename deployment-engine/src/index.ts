/**
 * Deployment Engine - Main Entry Point
 * Microservice for managing Noderr Node OS staged rollouts
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { registerApiRoutes } from './routes/api.routes';
import { initializeVersionBeaconService } from './services/version-beacon.service';

// Configuration from environment variables
const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  host: process.env.HOST || '0.0.0.0',
  versionBeaconAddress: process.env.VERSION_BEACON_ADDRESS || '0xA5Be5522bb3C748ea262a2A7d877d00AE387FDa6',
  rpcUrl: process.env.RPC_URL || 'https://base-sepolia.g.alchemy.com/v2/Z6Vsdc0TcuwUWBvlIzOqT',
  logLevel: process.env.LOG_LEVEL || 'info',
};

async function main() {
  // Create Fastify instance
  const fastify = Fastify({
    logger: {
      level: config.logLevel,
      transport: {
        target: 'pino-pretty',
        options: {
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname',
        },
      },
    },
  });

  // Register plugins
  await fastify.register(cors, {
    origin: true, // Allow all origins (configure for production)
  });

  await fastify.register(helmet, {
    contentSecurityPolicy: false, // Disable for API
  });

  await fastify.register(rateLimit, {
    max: 100, // Max 100 requests
    timeWindow: '1 minute', // Per minute
  });

  // Initialize VersionBeacon service
  fastify.log.info('Initializing VersionBeacon service...');
  initializeVersionBeaconService(config.versionBeaconAddress, config.rpcUrl);
  fastify.log.info(`VersionBeacon initialized at ${config.versionBeaconAddress}`);

  // Register API routes
  await registerApiRoutes(fastify);

  // Start server
  try {
    await fastify.listen({ port: config.port, host: config.host });
    fastify.log.info(`Deployment Engine running on ${config.host}:${config.port}`);
    fastify.log.info(`VersionBeacon: ${config.versionBeaconAddress}`);
    fastify.log.info(`RPC: ${config.rpcUrl}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }

  // Graceful shutdown
  const signals = ['SIGINT', 'SIGTERM'];
  signals.forEach((signal) => {
    process.on(signal, async () => {
      fastify.log.info(`Received ${signal}, shutting down gracefully...`);
      await fastify.close();
      process.exit(0);
    });
  });
}

// Start the server
main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
