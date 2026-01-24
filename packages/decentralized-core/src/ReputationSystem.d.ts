import { EventEmitter } from 'events';
import * as winston from 'winston';
/**
 * Reputation configuration
 */
export interface ReputationConfig {
    initialScore: number;
    maxScore: number;
    minScore: number;
    decayRate: number;
    minActivityThreshold: number;
    performanceWindow: number;
}
/**
 * Node performance metrics
 */
export interface NodePerformance {
    nodeId: string;
    totalSignals: number;
    accurateSignals: number;
    profitableSignals: number;
    avgSignalQuality: number;
    uptime: number;
    responseTime: number;
    dataContribution: number;
    consensusParticipation: number;
    consensusAgreement: number;
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
export declare enum ReputationTier {
    UNTRUSTED = "untrusted",
    NOVICE = "novice",
    CONTRIBUTOR = "contributor",
    TRUSTED = "trusted",
    EXPERT = "expert",
    MASTER = "master"
}
/**
 * Reputation system for node trust management
 */
export declare class ReputationSystem extends EventEmitter {
    private config;
    private logger;
    private nodeScores;
    private nodePerformance;
    private reputationHistory;
    private decayTimer;
    constructor(config: ReputationConfig, logger: winston.Logger);
    /**
     * Start reputation system
     */
    start(): void;
    /**
     * Stop reputation system
     */
    stop(): void;
    /**
     * Register a new node
     */
    registerNode(nodeId: string): void;
    /**
     * Update node reputation based on signal performance
     */
    updateSignalPerformance(nodeId: string, accurate: boolean, profitable: boolean, quality: number): void;
    /**
     * Update node reputation based on consensus participation
     */
    updateConsensusParticipation(nodeId: string, participated: boolean, agreedWithConsensus: boolean): void;
    /**
     * Update node reputation based on network contribution
     */
    updateNetworkContribution(nodeId: string, uptime: number, responseTime: number, dataShared: number): void;
    /**
     * Update reputation score
     */
    private updateReputation;
    /**
     * Apply reputation decay
     */
    private applyDecay;
    /**
     * Get recent signal count
     */
    private getRecentSignalCount;
    /**
     * Get reputation tier
     */
    getReputationTier(score: number): ReputationTier;
    /**
     * Get node reputation
     */
    getNodeReputation(nodeId: string): NodeReputation | null;
    /**
     * Get all node reputations
     */
    getAllReputations(): NodeReputation[];
    /**
     * Get nodes by tier
     */
    getNodesByTier(tier: ReputationTier): string[];
    /**
     * Check if node is trusted
     */
    isNodeTrusted(nodeId: string, minTier?: ReputationTier): boolean;
    /**
     * Get reputation metrics
     */
    getMetrics(): ReputationMetrics;
    /**
     * Calculate median
     */
    private calculateMedian;
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
//# sourceMappingURL=ReputationSystem.d.ts.map