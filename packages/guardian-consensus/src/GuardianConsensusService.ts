/**
 * Guardian Consensus Service - Full Implementation
 * 
 * Implements majority voting consensus for risk approval decisions.
 * Integrates with P2P network for decentralized guardian coordination.
 */

import { Logger } from '@noderr/utils/src';
import { EventEmitter } from 'events';
import { NodeCommunicationLayer, MessageType, P2PMessage } from '@noderr/decentralized-core/src';

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
  signature?: string;
}

export interface ConsensusResult {
  approved: boolean;
  votes: GuardianVote[];
  approvalRate: number;
  consensusTime: number;
}

interface GuardianConsensusConfig {
  majorityThreshold: number;  // 0.5 for 50%+
  timeout: number;             // milliseconds
  nodeId: string;
  privateKey: string;
}

/**
 * Guardian Consensus Service
 */
export class GuardianConsensusService extends EventEmitter {
  private logger: Logger;
  private config: GuardianConsensusConfig;
  private p2pNetwork: NodeCommunicationLayer | null = null;
  private guardians: Map<string, any> = new Map();
  private pendingRequests: Map<string, {
    request: RiskApprovalRequest;
    votes: Map<string, GuardianVote>;
    startTime: number;
    resolve: (result: ConsensusResult) => void;
    reject: (error: Error) => void;
  }> = new Map();
  
  constructor(config: GuardianConsensusConfig) {
    super();
    this.config = config;
    this.logger = new Logger('GuardianConsensusService');
    this.logger.info('GuardianConsensusService initialized', config);
  }
  
  async start(): Promise<void> {
    this.logger.info('Starting Guardian consensus service...');
    
    // Initialize P2P network
    this.p2pNetwork = new NodeCommunicationLayer(
      {
        peerId: this.config.nodeId,
        address: '', // Will be set from wallet
        reputation: 100,
        capabilities: ['guardian', 'risk-approval'],
        region: process.env.REGION || 'us-east',
        version: '1.0.0'
      },
      this.config.privateKey,
      this.logger as any
    );
    
    await this.p2pNetwork.initialize();
    
    // Subscribe to guardian consensus topic
    this.p2pNetwork.on('message', this.handleP2PMessage.bind(this));
    
    this.logger.info('Guardian consensus service started');
  }
  
  /**
   * Handle incoming P2P messages
   */
  private async handleP2PMessage(message: P2PMessage): Promise<void> {
    if (message.type === MessageType.CONSENSUS) {
      const payload = message.payload;
      
      if (payload.messageType === 'risk_approval_request') {
        // Another guardian is requesting approval
        await this.handleRiskApprovalRequest(payload.request, message.sender);
      } else if (payload.messageType === 'risk_approval_vote') {
        // Received a vote from another guardian
        await this.handleRiskApprovalVote(payload.tradeId, payload.vote);
      }
    }
  }
  
  /**
   * Handle incoming risk approval request from another guardian
   */
  private async handleRiskApprovalRequest(
    request: RiskApprovalRequest,
    senderId: string
  ): Promise<void> {
    this.logger.info('Received risk approval request', { 
      tradeId: request.tradeId,
      from: senderId 
    });
    
    // Evaluate the risk
    const vote = await this.evaluateRisk(request);
    
    // Send vote back via P2P
    if (this.p2pNetwork) {
      await this.p2pNetwork.broadcastMessage({
        type: MessageType.CONSENSUS,
        payload: {
          messageType: 'risk_approval_vote',
          tradeId: request.tradeId,
          vote
        },
        timestamp: Date.now(),
        sender: this.config.nodeId,
        signature: '' // Will be signed by NodeCommunicationLayer
      });
    }
  }
  
  /**
   * Handle incoming vote from another guardian
   */
  private async handleRiskApprovalVote(
    tradeId: string,
    vote: GuardianVote
  ): Promise<void> {
    const pending = this.pendingRequests.get(tradeId);
    if (!pending) {
      return; // Not our request or already resolved
    }
    
    this.logger.info('Received vote', { 
      tradeId,
      guardianId: vote.guardianId,
      approved: vote.approved 
    });
    
    // Add vote
    pending.votes.set(vote.guardianId, vote);
    
    // Check if we have enough votes
    const totalGuardians = this.guardians.size || 3; // Assume at least 3 guardians
    const votesReceived = pending.votes.size;
    
    if (votesReceived >= totalGuardians || 
        (Date.now() - pending.startTime) >= this.config.timeout) {
      // Calculate consensus
      const result = this.calculateConsensus(pending.votes, pending.startTime);
      
      // Resolve the request
      pending.resolve(result);
      this.pendingRequests.delete(tradeId);
    }
  }
  
  /**
   * Evaluate risk and generate vote
   */
  private async evaluateRisk(request: RiskApprovalRequest): Promise<GuardianVote> {
    // Simple risk evaluation logic
    // In production, this would use sophisticated risk models
    
    const { var: varValue, expectedLoss, portfolioImpact } = request.riskMetrics;
    
    // Calculate risk score (0-100, higher = riskier)
    const riskScore = Math.min(100, 
      (varValue * 0.4) + 
      (expectedLoss * 0.3) + 
      (portfolioImpact * 0.3)
    );
    
    // Approve if risk score is below 70
    const approved = riskScore < 70;
    
    return {
      guardianId: this.config.nodeId,
      approved,
      riskScore,
      timestamp: Date.now()
    };
  }
  
  /**
   * Calculate consensus from collected votes
   */
  private calculateConsensus(
    votes: Map<string, GuardianVote>,
    startTime: number
  ): ConsensusResult {
    const voteArray = Array.from(votes.values());
    const approvedVotes = voteArray.filter(v => v.approved).length;
    const totalVotes = voteArray.length;
    const approvalRate = totalVotes > 0 ? approvedVotes / totalVotes : 0;
    
    return {
      approved: approvalRate >= this.config.majorityThreshold,
      votes: voteArray,
      approvalRate,
      consensusTime: Date.now() - startTime
    };
  }
  
  /**
   * Request approval for a trade
   */
  async requestApproval(request: RiskApprovalRequest): Promise<ConsensusResult> {
    this.logger.info('Requesting risk approval', { tradeId: request.tradeId });
    
    // Create promise that will be resolved when consensus is reached
    const consensusPromise = new Promise<ConsensusResult>((resolve, reject) => {
      this.pendingRequests.set(request.tradeId, {
        request,
        votes: new Map(),
        startTime: Date.now(),
        resolve,
        reject
      });
      
      // Set timeout
      setTimeout(() => {
        const pending = this.pendingRequests.get(request.tradeId);
        if (pending) {
          // Timeout reached, calculate with votes we have
          const result = this.calculateConsensus(pending.votes, pending.startTime);
          resolve(result);
          this.pendingRequests.delete(request.tradeId);
        }
      }, this.config.timeout);
    });
    
    // Broadcast request to all guardians via P2P
    if (this.p2pNetwork) {
      await this.p2pNetwork.broadcastMessage({
        type: MessageType.CONSENSUS,
        payload: {
          messageType: 'risk_approval_request',
          request
        },
        timestamp: Date.now(),
        sender: this.config.nodeId,
        signature: '' // Will be signed by NodeCommunicationLayer
      });
    }
    
    // Also vote ourselves
    const ourVote = await this.evaluateRisk(request);
    await this.handleRiskApprovalVote(request.tradeId, ourVote);
    
    return consensusPromise;
  }
  
  async stop(): Promise<void> {
    this.logger.info('Stopping Guardian consensus service...');
    
    // Reject all pending requests
    for (const [tradeId, pending] of this.pendingRequests.entries()) {
      pending.reject(new Error('Service stopping'));
    }
    
    this.pendingRequests.clear();
    this.guardians.clear();
    
    if (this.p2pNetwork) {
      // TODO: Add disconnect method to NodeCommunicationLayer
      this.p2pNetwork = null;
    }
  }
}
