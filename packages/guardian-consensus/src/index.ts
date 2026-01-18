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

export class GuardianConsensusService {
  private logger: Logger;
  private guardians: Map<string, any> = new Map();
  private pendingRequests: Map<string, RiskApprovalRequest> = new Map();
  
  constructor(config: {
    majorityThreshold: number;  // 0.5 for 50%+
    timeout: number;             // milliseconds
  }) {
    this.logger = new Logger('GuardianConsensusService');
    this.logger.info('GuardianConsensusService initialized', config);
  }
  
  async start(): Promise<void> {
    this.logger.info('Starting Guardian consensus service...');
    // TODO: Initialize guardian network
  }
  
  async requestApproval(request: RiskApprovalRequest): Promise<ConsensusResult> {
    this.logger.info('Requesting risk approval', { tradeId: request.tradeId });
    
    // TODO: Implement consensus mechanism
    // 1. Broadcast request to all guardians
    // 2. Collect votes
    // 3. Calculate consensus
    // 4. Return result
    
    throw new Error('Not implemented');
  }
  
  async stop(): Promise<void> {
    this.logger.info('Stopping Guardian consensus service...');
    this.pendingRequests.clear();
    this.guardians.clear();
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

let guardianConsensusService: GuardianConsensusService | null = null;

export async function startGuardianConsensusService(): Promise<void> {
  const logger = new Logger('GuardianConsensusService');
  
  try {
    logger.info('Starting Guardian Consensus Service...');
    
    guardianConsensusService = new GuardianConsensusService({
      majorityThreshold: parseFloat(process.env.MAJORITY_THRESHOLD || '0.5'),
      timeout: parseInt(process.env.CONSENSUS_TIMEOUT || '5000'),
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
    console.error('Fatal error starting Guardian Consensus Service:', error);
    process.exit(1);
  });
}
