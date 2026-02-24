/**
 * Oracle Consensus Package
 * 
 * Provides BFT consensus mechanism for Oracle network.
 * 
 * @packageDocumentation
 */

export { BFTConsensusEngine } from './BFTConsensusEngine';
export type { ConsensusConfig, OracleSubmission, ConsensusResult, OracleInfo } from './BFTConsensusEngine';

export { OracleCoordinator } from './OracleCoordinator';
export type { TradingSignal, ConsensusRequest, ConsensusResponse } from './OracleCoordinator';

export { OracleLotterySelector } from './OracleLotterySelector';
export type { CommitteeSelection, LotteryConfig } from './OracleLotterySelector';


// ============================================================================
// Main Entry Point
// ============================================================================

import { Logger, createStatePersistence, StatePersistenceManager } from '@noderr/utils';
import { getShutdownHandler, onShutdown } from '@noderr/utils';
import { BFTConsensusEngine } from './BFTConsensusEngine';
import { OracleLotterySelector } from './OracleLotterySelector';
import { OracleCoordinator } from './OracleCoordinator';
import { ethers } from 'ethers';
const logger = new Logger('oracle-consensus');

let consensusEngine: BFTConsensusEngine | null = null;
let lotterySelector: OracleLotterySelector | null = null;
let coordinator: OracleCoordinator | null = null;
let statePersistence: StatePersistenceManager<any> | null = null;

export async function startOracleConsensusService(): Promise<void> {
  const logger = new Logger('OracleConsensusService');
  
  try {
    logger.info('Starting Oracle Consensus Service...');
    
    // Initialize lottery selector
    lotterySelector = new OracleLotterySelector({
      targetCommitteeSize: parseInt(process.env.COMMITTEE_SIZE || '10'),
      minCommitteeSize: parseInt(process.env.MIN_COMMITTEE_SIZE || '7'),
      maxCommitteeSize: parseInt(process.env.MAX_COMMITTEE_SIZE || '15'),
      stakeWeighting: true,
      rotationEnabled: true,
      cooldownPeriods: parseInt(process.env.COOLDOWN_ROUNDS || '3'),
    });
    
    // Initialize BFT consensus engine
    // Note: BFTConsensusEngine requires oracleVerifierAddress, provider, and signer
    // These should be initialized from environment variables in production
    // For now, using placeholder values that will be set by the service initialization
    consensusEngine = new BFTConsensusEngine({
      oracleVerifierAddress: process.env.ORACLE_VERIFIER_ADDRESS || ethers.ZeroAddress,
      provider: new ethers.JsonRpcProvider(process.env.RPC_URL || 'http://localhost:8545'),
      signer: new ethers.Wallet(process.env.ORACLE_PRIVATE_KEY || ethers.Wallet.createRandom().privateKey),
      consensusThreshold: Math.floor(parseFloat(process.env.CONSENSUS_THRESHOLD || '0.67') * 10000),  // Convert to basis points
      submissionWindow: parseInt(process.env.CONSENSUS_TIMEOUT || '300000'),
      minOracles: parseInt(process.env.MIN_ORACLES || '4'),
      enableLottery: true,
      lotterySelector: lotterySelector || undefined,
    });
    
    // Initialize coordinator
    coordinator = new OracleCoordinator(consensusEngine);
    
    // Initialize state persistence
    statePersistence = createStatePersistence({
      stateDir: process.env.STATE_DIR || '/app/data/state',
      serviceName: 'oracle-consensus',
      maxBackups: 5,
      compress: true,
      autoSave: true,
      autoSaveInterval: 30000,  // 30 seconds (consensus is time-sensitive)
    });
    
    await statePersistence.initialize();
    
    // Try to recover previous state
    const previousState = await statePersistence.load();
    if (previousState) {
      logger.info('Recovered previous consensus state', {
        lastRound: previousState.lastRound,
        activeCommittee: previousState.activeCommittee?.length || 0,
      });
      // TODO: Restore consensus state
    }
    
    // Start coordinator
    await coordinator.start();
    
    onShutdown('oracle-consensus-service', async () => {
      logger.info('Shutting down oracle consensus service...');
      
      if (coordinator) {
        await coordinator.stop();
      }
      
      // Save consensus state
      if (statePersistence) {
        const state = {
          lastRound: 0,  // TODO: Get actual round number
          activeCommittee: [],  // TODO: Get active committee
          pendingConsensus: [],  // TODO: Get pending consensus requests
          timestamp: Date.now(),
        };
        await statePersistence.save(state);
        statePersistence.stopAutoSave();
      }
      
      logger.info('Oracle consensus service shut down complete');
    }, 20000);  // 20 second timeout (consensus can take time)
    
    logger.info('Oracle Consensus Service started successfully');
    logger.info('Committee size:', process.env.COMMITTEE_SIZE || '10');
    logger.info('Consensus threshold:', process.env.CONSENSUS_THRESHOLD || '0.67');
    
    await new Promise(() => {});
  } catch (error) {
    logger.error('Failed to start Oracle Consensus Service', error);
    throw error;
  }
}

if (require.main === module) {
  getShutdownHandler(30000);
  startOracleConsensusService().catch((error) => {
    logger.error('Fatal error starting Oracle Consensus Service:', error);
    process.exit(1);
  });
}
