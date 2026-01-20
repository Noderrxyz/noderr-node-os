/**
 * @noderr/guardian-consensus - Guardian Consensus Service
 * 
 * Implements majority voting consensus for risk approval decisions.
 * 
 * Features:
 * - Majority voting (50%+ approval)
 * - Risk assessment aggregation
 * - Weighted voting by stake
 * - Fast consensus (< 5 seconds)
 */

import { Logger, getShutdownHandler, onShutdown } from '@noderr/utils/src';

const logger = new Logger('guardian-consensus');

export interface RiskApprovalRequest {
  tradeId: string;
  symbol: string;
  side: 'buy' | 'sell';
  amount: number;
  price: number;
  riskMetrics: {
    var: number;
    expectedLoss: number;
    portfolioImpact: number;
  };
}

export interface GuardianVote {
  guardianId: string;
  approved: boolean;
  riskScore: number;
  timestamp: number;
}

export interface ConsensusResult {
  approved: boolean;
  votes: GuardianVote[];
  approvalRate: number;
  consensusTime: number;
}

/**
 * Guardian Consensus Service
 */
export { StrategyReviewService, type StrategyReviewRequest, type GuardianReview, type ReviewConsensus } from './StrategyReviewService';
export { GuardianConsensusService } from './GuardianConsensusService';

// ============================================================================
// Main Entry Point
// ============================================================================

let guardianConsensusService: GuardianConsensusService | null = null;

import { GuardianConsensusService } from './GuardianConsensusService';

export async function startGuardianConsensusService(): Promise<void> {
  const logger = new Logger('GuardianConsensusService');
  
  try {
    logger.info('Starting Guardian Consensus Service...');
    
    guardianConsensusService = new GuardianConsensusService({
      majorityThreshold: parseFloat(process.env.MAJORITY_THRESHOLD || '0.5'),
      timeout: parseInt(process.env.CONSENSUS_TIMEOUT || '5000'),
      nodeId: process.env.NODE_ID || '',
      privateKey: process.env.PRIVATE_KEY || '',
    });
    
    await guardianConsensusService.start();
    
    onShutdown('guardian-consensus-service', async () => {
      logger.info('Shutting down guardian consensus service...');
      
      if (guardianConsensusService) {
        await guardianConsensusService.stop();
      }
      
      logger.info('Guardian consensus service shut down complete');
    }, 10000);
    
    logger.info('Guardian Consensus Service started successfully');
    logger.info('Majority threshold:', process.env.MAJORITY_THRESHOLD || '0.5');
    
    await new Promise(() => {});
  } catch (error) {
    logger.error('Failed to start Guardian Consensus Service', error);
    throw error;
  }
}

if (require.main === module) {
  getShutdownHandler(30000);
  startGuardianConsensusService().catch((error) => {
    logger.error('Fatal error starting Guardian Consensus Service:', error);
    process.exit(1);
  });
}
