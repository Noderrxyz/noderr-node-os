import { EventEmitter } from 'events';
import * as winston from 'winston';
/**
 * Venue metrics
 */
export interface VenueMetrics {
    venueId: string;
    timestamp: Date;
    avgLatency: number;
    p50Latency: number;
    p90Latency: number;
    p99Latency: number;
    successRate: number;
    fillRate: number;
    feeRate: number;
    avgSlippageBps: number;
    avgBidDepth: number;
    avgAskDepth: number;
    avgSpreadBps: number;
    uptime: number;
    errorRate: number;
}
/**
 * Venue score
 */
export interface VenueScore {
    venueId: string;
    overallScore: number;
    latencyScore: number;
    costScore: number;
    liquidityScore: number;
    reliabilityScore: number;
    components: Record<string, number>;
}
/**
 * Optimization configuration
 */
export interface VenueOptimizationConfig {
    weights: {
        latency: number;
        cost: number;
        liquidity: number;
        reliability: number;
    };
    minSuccessRate: number;
    minFillRate: number;
    maxLatencyMs: number;
    updateFrequency: number;
    historicalWindow: number;
}
/**
 * Venue selection criteria
 */
export interface VenueSelectionCriteria {
    symbol: string;
    orderSize: number;
    orderType: 'market' | 'limit';
    urgency: 'low' | 'medium' | 'high';
    maxVenues?: number;
}
/**
 * Venue recommendation
 */
export interface VenueRecommendation {
    venues: Array<{
        venueId: string;
        allocation: number;
        score: number;
        reasoning: string;
    }>;
    estimatedCost: number;
    estimatedLatency: number;
    confidence: number;
}
/**
 * Venue optimizer for intelligent venue selection
 */
export declare class VenueOptimizer extends EventEmitter {
    private config;
    private logger;
    private venueMetrics;
    private venueScores;
    private updateTimer;
    constructor(config: VenueOptimizationConfig, logger: winston.Logger);
    /**
     * Start the optimizer
     */
    start(): void;
    /**
     * Stop the optimizer
     */
    stop(): void;
    /**
     * Update venue metrics
     */
    updateMetrics(metrics: VenueMetrics): void;
    /**
     * Update all venue scores
     */
    private updateScores;
    /**
     * Update score for a specific venue
     */
    private updateVenueScore;
    /**
     * Aggregate metrics over time window
     */
    private aggregateMetrics;
    /**
     * Calculate latency score (0-100)
     */
    private calculateLatencyScore;
    /**
     * Calculate cost score (0-100)
     */
    private calculateCostScore;
    /**
     * Calculate liquidity score (0-100)
     */
    private calculateLiquidityScore;
    /**
     * Calculate reliability score (0-100)
     */
    private calculateReliabilityScore;
    /**
     * Get venue recommendations
     */
    getRecommendations(criteria: VenueSelectionCriteria): VenueRecommendation;
    /**
     * Filter eligible venues
     */
    private filterEligibleVenues;
    /**
     * Adjust scores based on criteria
     */
    private adjustScoresForCriteria;
    /**
     * Calculate venue allocations
     */
    private calculateAllocations;
    /**
     * Estimate execution metrics
     */
    private estimateExecution;
    /**
     * Calculate confidence score
     */
    private calculateConfidence;
    /**
     * Generate reasoning for venue selection
     */
    private generateReasoning;
    /**
     * Get latest metrics for a venue
     */
    private getLatestMetrics;
    /**
     * Get all venue scores
     */
    getVenueScores(): VenueScore[];
    /**
     * Get venue performance report
     */
    getPerformanceReport(venueId: string): VenuePerformanceReport | null;
}
/**
 * Venue performance report
 */
export interface VenuePerformanceReport {
    venueId: string;
    score: VenueScore;
    currentMetrics: VenueMetrics;
    historicalMetrics: VenueMetrics[];
    dataPoints: number;
    lastUpdated: Date;
}
//# sourceMappingURL=VenueOptimizer.d.ts.map