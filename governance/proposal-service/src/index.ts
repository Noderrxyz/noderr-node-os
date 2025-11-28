/**
 * Proposal Service
 * 
 * Main entry point for governance proposal service
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { ProposalService } from './service';
import { registerRoutes } from './routes';
import dotenv from 'dotenv';
import pino from 'pino';

dotenv.config();

const logger = pino({ name: 'proposal-service' });

async function main() {
  // Validate environment variables
  const requiredEnvVars = [
    'MULTISIG_ADDRESS',
    'VERSION_BEACON_ADDRESS',
    'RPC_URL',
    'CHAIN_ID',
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY'
  ];

  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      throw new Error(`Missing required environment variable: ${envVar}`);
    }
  }

  // Create proposal service
  const service = new ProposalService({
    multiSigAddress: process.env.MULTISIG_ADDRESS!,
    versionBeaconAddress: process.env.VERSION_BEACON_ADDRESS!,
    rpcUrl: process.env.RPC_URL!,
    chainId: parseInt(process.env.CHAIN_ID!),
    signerPrivateKey: process.env.SIGNER_PRIVATE_KEY
  });

  // Create Fastify server
  const fastify = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info'
    }
  });

  // Register CORS
  await fastify.register(cors, {
    origin: process.env.CORS_ORIGIN || '*'
  });

  // Register routes
  await registerRoutes(fastify, service);

  // Start server
  const port = parseInt(process.env.PORT || '4001');
  const host = process.env.HOST || '0.0.0.0';

  try {
    await fastify.listen({ port, host });
    logger.info(`Proposal service listening on ${host}:${port}`);
  } catch (error) {
    logger.error(error);
    process.exit(1);
  }
}

main().catch((error) => {
  logger.error(error);
  process.exit(1);
});
