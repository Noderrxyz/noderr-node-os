import { EventEmitter } from 'events';
import * as winston from 'winston';

/**
 * Reputation configuration
 */
export interface ReputationConfig {
  // Initial reputation score for new nodes
  initialScore: number;
  // Maximum reputation score
  maxScore: number;
  // Minimum reputation score
  minScore: number;
  // Decay rate per day (percentage)
  decayRate: number;
  // Minimum activity threshold (signals per day)
  minActivityThreshold: number;
  // Performance window (days)
  performanceWindow: number;
}

/**
 * Node performance metrics
 */
export interface NodePerformance {
  nodeId: string;
  // Trading performance
  totalSignals: number;
  accurateSignals: number;
  profitableSignals: number;
  avgSignalQuality: number;
  // Network performance
  uptime: number;
  responseTime: number;
  dataContribution: number;
  // Consensus participation
  consensusParticipation: number;
  consensusAgreement: number;
  // Time-based metrics
  lastActive: Date;
  joinedAt: Date;
}

/**
 * Reputation update event
 */
export interface ReputationUpdate {
  nodeId: string;
  previousScore: number;
  newScore: number;
  reason: string;
  factors: Record<string, number>;
  timestamp: Date;
}

/**
 * Reputation tier
 */
export enum ReputationTier {
  UNTRUSTED = 'untrusted',
  NOVICE = 'novice',
  CONTRIBUTOR = 'contributor',
  TRUSTED = 'trusted',
  EXPERT = 'expert',
  MASTER = 'master'
}

/**
 * Reputation system for node trust management
 */
export class ReputationSystem extends EventEmitter {
  private config: ReputationConfig;
  private logger: winston.Logger;
  private nodeScores: Map<string, number> = new Map();
  private nodePerformance: Map<string, NodePerformance> = new Map();
  private reputationHistory: Map<string, ReputationUpdate[]> = new Map();
  private decayTimer: NodeJS.Timeout | null = null;
  
  constructor(config: ReputationConfig, logger: winston.Logger) {
    super();
    
    this.config = config;
    this.logger = logger;
  }
  
  /**
   * Start reputation system
   */
  start(): void {
    // Start daily decay timer
    this.decayTimer = setInterval(() => {
      this.applyDecay();
    }, 24 * 60 * 60 * 1000); // Daily
    
    this.logger.info('Reputation system started', {
      initialScore: this.config.initialScore,
      decayRate: this.config.decayRate
    });
  }
  
  /**
   * Stop reputation system
   */
  stop(): void {
    if (this.decayTimer) {
      clearInterval(this.decayTimer);
      this.decayTimer = null;
    }
  }
  
  /**
   * Register a new node
   */
  registerNode(nodeId: string): void {
    if (this.nodeScores.has(nodeId)) {
      return; // Already registered
    }
    
    this.nodeScores.set(nodeId, this.config.initialScore);
    this.nodePerformance.set(nodeId, {
      nodeId,
      totalSignals: 0,
      accurateSignals: 0,
      profitableSignals: 0,
      avgSignalQuality: 0,
      uptime: 1,
      responseTime: 0,
      dataContribution: 0,
      consensusParticipation: 0,
      consensusAgreement: 0,
      lastActive: new Date(),
      joinedAt: new Date()
    });
    
    this.logger.info('Node registered', { nodeId, initialScore: this.config.initialScore });
    this.emit('nodeRegistered', { nodeId, score: this.config.initialScore });
  }
  
  /**
   * Update node reputation based on signal performance
   */
  updateSignalPerformance(
    nodeId: string,
    accurate: boolean,
    profitable: boolean,
    quality: number
  ): void {
    const performance = this.nodePerformance.get(nodeId);
    if (!performance) {
      this.registerNode(nodeId);
      return;
    }
    
    // Update performance metrics
    performance.totalSignals++;
    if (accurate) performance.accurateSignals++;
    if (profitable) performance.profitableSignals++;
    
    // Update average quality
    performance.avgSignalQuality = 
      (performance.avgSignalQuality * (performance.totalSignals - 1) + quality) / 
      performance.totalSignals;
    
    performance.lastActive = new Date();
    
    // Calculate reputation change
    const factors: Record<string, number> = {
      accuracy: accurate ? 0.1 : -0.05,
      profitability: profitable ? 0.15 : -0.1,
      quality: (quality - 0.5) * 0.2
    };
    
    const totalChange = Object.values(factors).reduce((sum, f) => sum + f, 0);
    
    this.updateReputation(nodeId, totalChange, 'signal_performance', factors);
  }
  
  /**
   * Update node reputation based on consensus participation
   */
  updateConsensusParticipation(
    nodeId: string,
    participated: boolean,
    agreedWithConsensus: boolean
  ): void {
    const performance = this.nodePerformance.get(nodeId);
    if (!performance) {
      this.registerNode(nodeId);
      return;
    }
    
    if (participated) {
      performance.consensusParticipation++;
      if (agreedWithConsensus) {
        performance.consensusAgreement++;
      }
    }
    
    performance.lastActive = new Date();
    
    // Calculate reputation change
    const factors: Record<string, number> = {
      participation: participated ? 0.05 : -0.02,
      agreement: agreedWithConsensus ? 0.1 : 0
    };
    
    const totalChange = Object.values(factors).reduce((sum, f) => sum + f, 0);
    
    this.updateReputation(nodeId, totalChange, 'consensus_participation', factors);
  }
  
  /**
   * Update node reputation based on network contribution
   */
  updateNetworkContribution(
    nodeId: string,
    uptime: number,
    responseTime: number,
    dataShared: number
  ): void {
    const performance = this.nodePerformance.get(nodeId);
    if (!performance) {
      this.registerNode(nodeId);
      return;
    }
    
    // Update metrics
    performance.uptime = uptime;
    performance.responseTime = responseTime;
    performance.dataContribution += dataShared;
    performance.lastActive = new Date();
    
    // Calculate reputation change
    const factors: Record<string, number> = {
      uptime: (uptime - 0.95) * 2, // Reward high uptime
      responseTime: responseTime < 100 ? 0.05 : -0.05, // Reward low latency
      dataContribution: Math.min(0.1, dataShared / 1000) // Cap contribution reward
    };
    
    const totalChange = Object.values(factors).reduce((sum, f) => sum + f, 0);
    
    this.updateReputation(nodeId, totalChange, 'network_contribution', factors);
  }
  
  /**
   * Update reputation score
   */
  private updateReputation(
    nodeId: string,
    change: number,
    reason: string,
    factors: Record<string, number>
  ): void {
    const currentScore = this.nodeScores.get(nodeId) || this.config.initialScore;
    const newScore = Math.max(
      this.config.minScore,
      Math.min(this.config.maxScore, currentScore + change)
    );
    
    this.nodeScores.set(nodeId, newScore);
    
    // Record update
    const update: ReputationUpdate = {
      nodeId,
      previousScore: currentScore,
      newScore,
      reason,
      factors,
      timestamp: new Date()
    };
    
    let history = this.reputationHistory.get(nodeId);
    if (!history) {
      history = [];
      this.reputationHistory.set(nodeId, history);
    }
    history.push(update);
    
    // Emit events
    this.emit('reputationUpdated', update);
    
    // Check for tier change
    const previousTier = this.getReputationTier(currentScore);
    const newTier = this.getReputationTier(newScore);
    
    if (previousTier !== newTier) {
      this.emit('tierChanged', {
        nodeId,
        previousTier,
        newTier,
        score: newScore
      });
      
      this.logger.info('Node tier changed', {
        nodeId,
        previousTier,
        newTier,
        score: newScore
      });
    }
  }
  
  /**
   * Apply reputation decay
   */
  private applyDecay(): void {
    const now = Date.now();
    
    for (const [nodeId, performance] of this.nodePerformance) {
      const daysSinceActive = (now - performance.lastActive.getTime()) / (24 * 60 * 60 * 1000);
      
      // Apply decay for inactive nodes
      if (daysSinceActive > 1) {
        const decayFactor = Math.min(1, daysSinceActive * this.config.decayRate / 100);
        const currentScore = this.nodeScores.get(nodeId) || this.config.initialScore;
        const decay = currentScore * decayFactor;
        
        this.updateReputation(nodeId, -decay, 'inactivity_decay', {
          daysSinceActive,
          decayAmount: decay
        });
      }
      
      // Check minimum activity threshold
      const recentSignals = this.getRecentSignalCount(nodeId);
      if (recentSignals < this.config.minActivityThreshold) {
        this.updateReputation(nodeId, -0.1, 'low_activity', {
          recentSignals,
          threshold: this.config.minActivityThreshold
        });
      }
    }
  }
  
  /**
   * Get recent signal count
   */
  private getRecentSignalCount(nodeId: string): number {
    // This is a placeholder - in practice, track signals over time
    const performance = this.nodePerformance.get(nodeId);
    return performance ? performance.totalSignals : 0;
  }
  
  /**
   * Get reputation tier
   */
  getReputationTier(score: number): ReputationTier {
    const maxScore = this.config.maxScore;
    
    if (score < maxScore * 0.2) return ReputationTier.UNTRUSTED;
    if (score < maxScore * 0.4) return ReputationTier.NOVICE;
    if (score < maxScore * 0.6) return ReputationTier.CONTRIBUTOR;
    if (score < maxScore * 0.8) return ReputationTier.TRUSTED;
    if (score < maxScore * 0.95) return ReputationTier.EXPERT;
    return ReputationTier.MASTER;
  }
  
  /**
   * Get node reputation
   */
  getNodeReputation(nodeId: string): NodeReputation | null {
    const score = this.nodeScores.get(nodeId);
    const performance = this.nodePerformance.get(nodeId);
    
    if (!score || !performance) {
      return null;
    }
    
    return {
      nodeId,
      score,
      tier: this.getReputationTier(score),
      performance,
      history: this.reputationHistory.get(nodeId) || []
    };
  }
  
  /**
   * Get all node reputations
   */
  getAllReputations(): NodeReputation[] {
    const reputations: NodeReputation[] = [];
    
    for (const [nodeId, score] of this.nodeScores) {
      const reputation = this.getNodeReputation(nodeId);
      if (reputation) {
        reputations.push(reputation);
      }
    }
    
    return reputations.sort((a, b) => b.score - a.score);
  }
  
  /**
   * Get nodes by tier
   */
  getNodesByTier(tier: ReputationTier): string[] {
    const nodes: string[] = [];
    
    for (const [nodeId, score] of this.nodeScores) {
      if (this.getReputationTier(score) === tier) {
        nodes.push(nodeId);
      }
    }
    
    return nodes;
  }
  
  /**
   * Check if node is trusted
   */
  isNodeTrusted(nodeId: string, minTier: ReputationTier = ReputationTier.CONTRIBUTOR): boolean {
    const score = this.nodeScores.get(nodeId);
    if (!score) return false;
    
    const tier = this.getReputationTier(score);
    const tierOrder = Object.values(ReputationTier);
    
    return tierOrder.indexOf(tier) >= tierOrder.indexOf(minTier);
  }
  
  /**
   * Get reputation metrics
   */
  getMetrics(): ReputationMetrics {
    const nodes = Array.from(this.nodeScores.entries());
    const scores = nodes.map(([_, score]) => score);
    
    const tierCounts = new Map<ReputationTier, number>();
    for (const tier of Object.values(ReputationTier)) {
      tierCounts.set(tier, this.getNodesByTier(tier).length);
    }
    
    return {
      totalNodes: nodes.length,
      averageScore: scores.reduce((sum, s) => sum + s, 0) / nodes.length,
      medianScore: this.calculateMedian(scores),
      tierDistribution: Object.fromEntries(tierCounts),
      activeNodes: Array.from(this.nodePerformance.values()).filter(p => 
        Date.now() - p.lastActive.getTime() < 24 * 60 * 60 * 1000
      ).length
    };
  }
  
  /**
   * Calculate median
   */
  private calculateMedian(values: number[]): number {
    if (values.length === 0) return 0;
    
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }
}

/**
 * Node reputation data
 */
export interface NodeReputation {
  nodeId: string;
  score: number;
  tier: ReputationTier;
  performance: NodePerformance;
  history: ReputationUpdate[];
}

/**
 * Reputation metrics
 */
export interface ReputationMetrics {
  totalNodes: number;
  averageScore: number;
  medianScore: number;
  tierDistribution: Record<string, number>;
  activeNodes: number;
} 