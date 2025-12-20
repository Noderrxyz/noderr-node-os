/**
 * @noderr/validator-consensus
 * 
 * Validator node consensus protocol for the Noderr decentralized network.
 * 
 * This package provides the consensus mechanism for Validator nodes,
 * which are the entry-level tier in the Noderr network hierarchy.
 * 
 * Validators:
 * - Attest to data validity from Guardian and Oracle nodes
 * - Participate in network consensus
 * - Submit attestations on-chain
 * - Maintain reputation through consistent participation
 */

import { ValidatorConsensus, ValidatorConsensusConfig } from './ValidatorConsensus';
import { createLogger, format, transports } from 'winston';

// Re-export main classes and types
export {
  ValidatorConsensus,
  ValidatorConsensusConfig,
  ConsensusState,
  Attestation,
  ConsensusRound
} from './ValidatorConsensus';

// Service instance
let consensusService: ValidatorConsensus | null = null;

/**
 * Initialize and start the Validator Consensus service
 */
async function main(): Promise<void> {
  const logger = createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: format.combine(
      format.timestamp(),
      format.json()
    ),
    defaultMeta: { service: 'validator-consensus' },
    transports: [
      new transports.Console({
        format: format.combine(
          format.colorize(),
          format.simple()
        )
      })
    ]
  });

  logger.info('Starting Validator Consensus service...');

  // Load configuration from environment
  const config: ValidatorConsensusConfig = {
    nodeId: process.env.NODE_ID || `validator-${Date.now()}`,
    privateKey: process.env.VALIDATOR_PRIVATE_KEY || '',
    rpcUrl: process.env.RPC_URL || 'https://sepolia.base.org',
    nodeRegistryAddress: process.env.NODE_REGISTRY_ADDRESS || '0x0C38842F8D2A0DF613d5Bf0f0B45E9E0a7a14F7c',
    consensusContractAddress: process.env.CONSENSUS_CONTRACT_ADDRESS || '0x0000000000000000000000000000000000000000',
    roundDurationMs: parseInt(process.env.ROUND_DURATION_MS || '60000', 10),
    minAttestations: parseInt(process.env.MIN_ATTESTATIONS || '3', 10),
    attestationTimeoutMs: parseInt(process.env.ATTESTATION_TIMEOUT_MS || '30000', 10)
  };

  // Validate required configuration
  if (!config.privateKey) {
    logger.error('VALIDATOR_PRIVATE_KEY environment variable is required');
    process.exit(1);
  }

  // Create and start the consensus service
  consensusService = new ValidatorConsensus(config);

  // Set up event handlers
  consensusService.on('started', () => {
    logger.info('Consensus service started');
  });

  consensusService.on('stopped', () => {
    logger.info('Consensus service stopped');
  });

  consensusService.on('roundStarted', (roundId: string) => {
    logger.debug('Consensus round started', { roundId });
  });

  consensusService.on('roundCompleted', (roundId: string, result: boolean) => {
    logger.info('Consensus round completed', { roundId, result });
  });

  consensusService.on('roundFailed', (roundId: string, error: any) => {
    logger.error('Consensus round failed', { roundId, error: error.message });
  });

  // Handle graceful shutdown
  process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM, shutting down...');
    await consensusService?.stop();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    logger.info('Received SIGINT, shutting down...');
    await consensusService?.stop();
    process.exit(0);
  });

  // Start the service
  try {
    await consensusService.start();
    logger.info('Validator Consensus service is running');
  } catch (error) {
    logger.error('Failed to start Validator Consensus service', { error });
    process.exit(1);
  }
}

// Run if this is the main module
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export default ValidatorConsensus;
