/**
 * Authentication API - Main Entry Point
 * Secure authentication service for Noderr Node OS with TPM-based hardware attestation
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { registerApiRoutes } from './routes/api.routes';
import { initializeDatabaseService } from './services/database.service';

// Configuration from environment variables
const config = {
  port: parseInt(process.env.PORT || '3002', 10),
  host: process.env.HOST || '0.0.0.0',
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseKey: process.env.SUPABASE_KEY || '',
  logLevel: process.env.LOG_LEVEL || 'info',
};

async function main() {
  // Validate required configuration
  if (!config.supabaseUrl || !config.supabaseKey) {
    console.error('ERROR: SUPABASE_URL and SUPABASE_KEY environment variables are required');
    process.exit(1);
  }

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

  // Initialize database service
  fastify.log.info('Initializing database service...');
  initializeDatabaseService(config.supabaseUrl, config.supabaseKey);
  fastify.log.info('Database service initialized');

  // Register API routes
  await registerApiRoutes(fastify);

  // Start server
  try {
    await fastify.listen({ port: config.port, host: config.host });
    fastify.log.info(`Authentication API running on ${config.host}:${config.port}`);
    fastify.log.info(`Supabase: ${config.supabaseUrl}`);
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
