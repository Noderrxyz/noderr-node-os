/**
 * Guardian Strategy Review Service
 * 
 * Allows Guardian nodes to review and vote on externally submitted strategies.
 * Integrates with the Guardian consensus mechanism.
 */

import { EventEmitter } from 'events';
import { Logger } from '@noderr/utils/src';

export interface StrategyReviewRequest {
  strategyId: string;
  submissionId: string;
  submitterAddress: string;
  name: string;
  description: string;
  codeUrl: string;
  backtestMetrics: {
    sharpeRatio: number;
    maxDrawdown: number;
    winRate: number;
    totalTrades: number;
    annualizedReturn: number;
  };
  riskProfile: {
    maxPositionSize: number;
    maxLeverage: number;
    stopLossRequired: boolean;
  };
}

export interface GuardianReview {
  guardianId: string;
  strategyId: string;
  approved: boolean;
  riskScore: number; // 0-100, higher = riskier
  concerns: string[];
  timestamp: number;
}

export interface ReviewConsensus {
  strategyId: string;
  approved: boolean;
  approvalRate: number;
  totalReviews: number;
  averageRiskScore: number;
  consensusTime: number;
}

/**
 * Strategy Review Service
 * 
 * Coordinates Guardian reviews of external strategy submissions.
 */
export class StrategyReviewService extends EventEmitter {
  private logger: Logger;
  private pendingReviews: Map<string, StrategyReviewRequest> = new Map();
  private reviews: Map<string, GuardianReview[]> = new Map();
  private config: {
    minReviewers: number;
    approvalThreshold: number; // 0.5 = 50%+
    reviewTimeout: number; // milliseconds
  };
  
  constructor(config?: Partial<typeof StrategyReviewService.prototype.config>) {
    super();
    this.logger = new Logger('StrategyReviewService');
    
    this.config = {
      minReviewers: config?.minReviewers || 5,
      approvalThreshold: config?.approvalThreshold || 0.6, // 60% approval required
      reviewTimeout: config?.reviewTimeout || 7 * 24 * 60 * 60 * 1000, // 7 days
    };
  }
  
  /**
   * Submit strategy for Guardian review
   */
  async submitForReview(request: StrategyReviewRequest): Promise<void> {
    this.logger.info('Strategy submitted for review', {
      strategyId: request.strategyId,
      submitter: request.submitterAddress,
    });
    
    this.pendingReviews.set(request.strategyId, request);
    this.reviews.set(request.strategyId, []);
    
    this.emit('review_requested', request);
    
    // Set timeout for review
    setTimeout(() => {
      this.checkReviewConsensus(request.strategyId);
    }, this.config.reviewTimeout);
  }
  
  /**
   * Submit Guardian review
   */
  async submitReview(review: GuardianReview): Promise<void> {
    const request = this.pendingReviews.get(review.strategyId);
    
    if (!request) {
      throw new Error(`Strategy ${review.strategyId} not found or already reviewed`);
    }
    
    // Check if Guardian already reviewed
    const existingReviews = this.reviews.get(review.strategyId) || [];
    const alreadyReviewed = existingReviews.some(r => r.guardianId === review.guardianId);
    
    if (alreadyReviewed) {
      throw new Error(`Guardian ${review.guardianId} already reviewed this strategy`);
    }
    
    // Add review
    existingReviews.push(review);
    this.reviews.set(review.strategyId, existingReviews);
    
    this.logger.info('Guardian review submitted', {
      strategyId: review.strategyId,
      guardianId: review.guardianId,
      approved: review.approved,
      riskScore: review.riskScore,
    });
    
    this.emit('review_submitted', review);
    
    // Check if we have enough reviews
    if (existingReviews.length >= this.config.minReviewers) {
      await this.checkReviewConsensus(review.strategyId);
    }
  }
  
  /**
   * Check if consensus has been reached
   */
  private async checkReviewConsensus(strategyId: string): Promise<void> {
    const request = this.pendingReviews.get(strategyId);
    const reviews = this.reviews.get(strategyId);
    
    if (!request || !reviews || reviews.length < this.config.minReviewers) {
      // Not enough reviews yet
      return;
    }
    
    // Calculate consensus
    const approvals = reviews.filter(r => r.approved).length;
    const approvalRate = approvals / reviews.length;
    const averageRiskScore = reviews.reduce((sum, r) => sum + r.riskScore, 0) / reviews.length;
    
    const consensus: ReviewConsensus = {
      strategyId,
      approved: approvalRate >= this.config.approvalThreshold,
      approvalRate,
      totalReviews: reviews.length,
      averageRiskScore,
      consensusTime: Date.now(),
    };
    
    this.logger.info('Review consensus reached', consensus);
    
    // Remove from pending
    this.pendingReviews.delete(strategyId);
    
    // Emit consensus event
    this.emit('consensus_reached', consensus);
    
    // If approved, emit approval event
    if (consensus.approved) {
      this.emit('strategy_approved', {
        strategyId,
        request,
        consensus,
      });
    } else {
      this.emit('strategy_rejected', {
        strategyId,
        request,
        consensus,
        reasons: this.aggregateConcerns(reviews),
      });
    }
  }
  
  /**
   * Aggregate concerns from all reviews
   */
  private aggregateConcerns(reviews: GuardianReview[]): string[] {
    const allConcerns = reviews.flatMap(r => r.concerns);
    
    // Count occurrences
    const concernCounts = new Map<string, number>();
    for (const concern of allConcerns) {
      concernCounts.set(concern, (concernCounts.get(concern) || 0) + 1);
    }
    
    // Return concerns mentioned by multiple Guardians
    return Array.from(concernCounts.entries())
      .filter(([_, count]) => count >= 2)
      .map(([concern, _]) => concern);
  }
  
  /**
   * Get pending reviews
   */
  getPendingReviews(): StrategyReviewRequest[] {
    return Array.from(this.pendingReviews.values());
  }
  
  /**
   * Get reviews for a strategy
   */
  getReviews(strategyId: string): GuardianReview[] {
    return this.reviews.get(strategyId) || [];
  }
  
  /**
   * Get review statistics
   */
  getStatistics(): {
    pending: number;
    completed: number;
    approvalRate: number;
  } {
    const pending = this.pendingReviews.size;
    
    // Calculate completed reviews (those that reached consensus)
    // This is a simplified version - in production, track completed reviews separately
    const completed = 0; // TODO: Track completed reviews
    
    return {
      pending,
      completed,
      approvalRate: 0, // TODO: Calculate from completed reviews
    };
  }
}
