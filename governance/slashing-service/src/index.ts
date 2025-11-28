/**
 * Slashing Service
 * 
 * Main entry point with cron scheduler
 */

import { SlashingService } from './service';
import { DEFAULT_SLASHING_CONFIG } from './types';
import * as cron from 'node-cron';
import dotenv from 'dotenv';
import pino from 'pino';

dotenv.config();

const logger = pino({ name: 'slashing-service' });

async function main() {
  // Validate environment variables
  const requiredEnvVars = [
    'RPC_URL',
    'PRIVATE_KEY',
    'STAKING_CONTRACT_ADDRESS',
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY'
  ];

  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      throw new Error(`Missing required environment variable: ${envVar}`);
    }
  }

  // Create slashing service
  const service = new SlashingService(
    process.env.RPC_URL!,
    process.env.PRIVATE_KEY!,
    process.env.STAKING_CONTRACT_ADDRESS!,
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    DEFAULT_SLASHING_CONFIG
  );

  logger.info('Slashing service initialized');

  // Get check interval from config (default: 5 minutes)
  const checkIntervalMinutes = Math.floor(DEFAULT_SLASHING_CONFIG.checkInterval / 60);

  // Schedule periodic checks
  const cronExpression = `*/${checkIntervalMinutes} * * * *`; // Every N minutes

  logger.info({ cronExpression, checkIntervalMinutes }, 'Scheduling periodic checks');

  cron.schedule(cronExpression, async () => {
    logger.info('Running scheduled slashing check');

    try {
      const events = await service.checkAllNodes();

      if (events.length > 0) {
        logger.warn({ count: events.length }, 'Nodes slashed in this check');
      } else {
        logger.info('No nodes slashed in this check');
      }
    } catch (error) {
      logger.error({ error }, 'Error during scheduled check');
    }
  });

  // Run initial check
  logger.info('Running initial slashing check');

  try {
    const events = await service.checkAllNodes();
    logger.info({ count: events.length }, 'Initial check complete');
  } catch (error) {
    logger.error({ error }, 'Error during initial check');
  }

  // Keep process alive
  logger.info('Slashing service running');
}

main().catch((error) => {
  logger.error({ error }, 'Fatal error');
  process.exit(1);
});
