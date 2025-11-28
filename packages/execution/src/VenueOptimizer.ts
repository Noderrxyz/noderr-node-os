import { EventEmitter } from 'events';
import * as winston from 'winston';

/**
 * Venue metrics
 */
export interface VenueMetrics {
  venueId: string;
  timestamp: Date;
  // Latency metrics (milliseconds)
  avgLatency: number;
  p50Latency: number;
  p90Latency: number;
  p99Latency: number;
  // Success metrics
  successRate: number;
  fillRate: number;
  // Cost metrics
  feeRate: number;
  avgSlippageBps: number;
  // Liquidity metrics
  avgBidDepth: number;
  avgAskDepth: number;
  avgSpreadBps: number;
  // Reliability
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
  // Score weights
  weights: {
    latency: number;
    cost: number;
    liquidity: number;
    reliability: number;
  };
  // Minimum thresholds
  minSuccessRate: number;
  minFillRate: number;
  maxLatencyMs: number;
  // Update frequency (seconds)
  updateFrequency: number;
  // Historical window (seconds)
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
export class VenueOptimizer extends EventEmitter {
  private config: VenueOptimizationConfig;
  private logger: winston.Logger;
  private venueMetrics: Map<string, VenueMetrics[]> = new Map();
  private venueScores: Map<string, VenueScore> = new Map();
  private updateTimer: NodeJS.Timeout | null = null;
  
  constructor(config: VenueOptimizationConfig, logger: winston.Logger) {
    super();
    
    this.config = config;
    this.logger = logger;
    
    // Validate weights sum to 1
    const weightSum = Object.values(config.weights).reduce((a, b) => a + b, 0);
    if (Math.abs(weightSum - 1) > 0.001) {
      throw new Error('Venue optimization weights must sum to 1');
    }
  }
  
  /**
   * Start the optimizer
   */
  start(): void {
    this.updateTimer = setInterval(() => {
      this.updateScores();
    }, this.config.updateFrequency * 1000);
    
    this.logger.info('Venue optimizer started', {
      updateFrequency: this.config.updateFrequency,
      weights: this.config.weights
    });
  }
  
  /**
   * Stop the optimizer
   */
  stop(): void {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
  }
  
  /**
   * Update venue metrics
   */
  updateMetrics(metrics: VenueMetrics): void {
    // Get or create metrics array for venue
    let venueHistory = this.venueMetrics.get(metrics.venueId);
    if (!venueHistory) {
      venueHistory = [];
      this.venueMetrics.set(metrics.venueId, venueHistory);
    }
    
    // Add new metrics
    venueHistory.push(metrics);
    
    // Clean up old metrics
    const cutoff = new Date(Date.now() - this.config.historicalWindow * 1000);
    this.venueMetrics.set(
      metrics.venueId,
      venueHistory.filter(m => m.timestamp > cutoff)
    );
    
    // Update scores immediately for this venue
    this.updateVenueScore(metrics.venueId);
  }
  
  /**
   * Update all venue scores
   */
  private updateScores(): void {
    for (const venueId of this.venueMetrics.keys()) {
      this.updateVenueScore(venueId);
    }
    
    this.emit('scoresUpdated', Array.from(this.venueScores.values()));
  }
  
  /**
   * Update score for a specific venue
   */
  private updateVenueScore(venueId: string): void {
    const metrics = this.venueMetrics.get(venueId);
    if (!metrics || metrics.length === 0) {
      return;
    }
    
    // Calculate aggregate metrics
    const aggregated = this.aggregateMetrics(metrics);
    
    // Calculate component scores (0-100)
    const latencyScore = this.calculateLatencyScore(aggregated);
    const costScore = this.calculateCostScore(aggregated);
    const liquidityScore = this.calculateLiquidityScore(aggregated);
    const reliabilityScore = this.calculateReliabilityScore(aggregated);
    
    // Calculate weighted overall score
    const overallScore = 
      this.config.weights.latency * latencyScore +
      this.config.weights.cost * costScore +
      this.config.weights.liquidity * liquidityScore +
      this.config.weights.reliability * reliabilityScore;
    
    const score: VenueScore = {
      venueId,
      overallScore,
      latencyScore,
      costScore,
      liquidityScore,
      reliabilityScore,
      components: {
        avgLatency: aggregated.avgLatency,
        successRate: aggregated.successRate,
        feeRate: aggregated.feeRate,
        avgSlippageBps: aggregated.avgSlippageBps,
        avgSpreadBps: aggregated.avgSpreadBps,
        uptime: aggregated.uptime
      }
    };
    
    this.venueScores.set(venueId, score);
  }
  
  /**
   * Aggregate metrics over time window
   */
  private aggregateMetrics(metrics: VenueMetrics[]): VenueMetrics {
    const n = metrics.length;
    
    return {
      venueId: metrics[0].venueId,
      timestamp: new Date(),
      avgLatency: metrics.reduce((sum, m) => sum + m.avgLatency, 0) / n,
      p50Latency: metrics.reduce((sum, m) => sum + m.p50Latency, 0) / n,
      p90Latency: metrics.reduce((sum, m) => sum + m.p90Latency, 0) / n,
      p99Latency: metrics.reduce((sum, m) => sum + m.p99Latency, 0) / n,
      successRate: metrics.reduce((sum, m) => sum + m.successRate, 0) / n,
      fillRate: metrics.reduce((sum, m) => sum + m.fillRate, 0) / n,
      feeRate: metrics.reduce((sum, m) => sum + m.feeRate, 0) / n,
      avgSlippageBps: metrics.reduce((sum, m) => sum + m.avgSlippageBps, 0) / n,
      avgBidDepth: metrics.reduce((sum, m) => sum + m.avgBidDepth, 0) / n,
      avgAskDepth: metrics.reduce((sum, m) => sum + m.avgAskDepth, 0) / n,
      avgSpreadBps: metrics.reduce((sum, m) => sum + m.avgSpreadBps, 0) / n,
      uptime: metrics.reduce((sum, m) => sum + m.uptime, 0) / n,
      errorRate: metrics.reduce((sum, m) => sum + m.errorRate, 0) / n
    };
  }
  
  /**
   * Calculate latency score (0-100)
   */
  private calculateLatencyScore(metrics: VenueMetrics): number {
    // Lower latency = higher score
    const maxLatency = this.config.maxLatencyMs;
    
    // Use P90 latency for scoring
    const latencyRatio = Math.min(1, metrics.p90Latency / maxLatency);
    const score = (1 - latencyRatio) * 100;
    
    // Penalize high variance (P99 vs P50)
    const variance = (metrics.p99Latency - metrics.p50Latency) / metrics.p50Latency;
    const variancePenalty = Math.min(20, variance * 10);
    
    return Math.max(0, score - variancePenalty);
  }
  
  /**
   * Calculate cost score (0-100)
   */
  private calculateCostScore(metrics: VenueMetrics): number {
    // Lower cost = higher score
    const feeScore = Math.max(0, 100 - metrics.feeRate * 10000); // Convert to bps
    const slippageScore = Math.max(0, 100 - metrics.avgSlippageBps);
    
    return (feeScore + slippageScore) / 2;
  }
  
  /**
   * Calculate liquidity score (0-100)
   */
  private calculateLiquidityScore(metrics: VenueMetrics): number {
    // More liquidity = higher score
    const depthScore = Math.min(100, (metrics.avgBidDepth + metrics.avgAskDepth) / 10000);
    const spreadScore = Math.max(0, 100 - metrics.avgSpreadBps);
    const fillRateScore = metrics.fillRate * 100;
    
    return (depthScore + spreadScore + fillRateScore) / 3;
  }
  
  /**
   * Calculate reliability score (0-100)
   */
  private calculateReliabilityScore(metrics: VenueMetrics): number {
    const successScore = metrics.successRate * 100;
    const uptimeScore = metrics.uptime * 100;
    const errorScore = Math.max(0, 100 - metrics.errorRate * 100);
    
    return (successScore + uptimeScore + errorScore) / 3;
  }
  
  /**
   * Get venue recommendations
   */
  getRecommendations(criteria: VenueSelectionCriteria): VenueRecommendation {
    const eligibleVenues = this.filterEligibleVenues(criteria);
    
    if (eligibleVenues.length === 0) {
      return {
        venues: [],
        estimatedCost: 0,
        estimatedLatency: 0,
        confidence: 0
      };
    }
    
    // Adjust scores based on criteria
    const adjustedScores = this.adjustScoresForCriteria(eligibleVenues, criteria);
    
    // Sort by adjusted score
    adjustedScores.sort((a, b) => b.adjustedScore - a.adjustedScore);
    
    // Select top venues
    const maxVenues = criteria.maxVenues || 3;
    const selectedVenues = adjustedScores.slice(0, maxVenues);
    
    // Calculate allocations
    const allocations = this.calculateAllocations(selectedVenues, criteria);
    
    // Estimate costs and latency
    const { estimatedCost, estimatedLatency } = this.estimateExecution(allocations, criteria);
    
    // Calculate confidence based on data quality
    const confidence = this.calculateConfidence(selectedVenues);
    
    return {
      venues: allocations.map((v, i) => ({
        venueId: v.venueId,
        allocation: v.allocation,
        score: v.adjustedScore,
        reasoning: this.generateReasoning(v, criteria)
      })),
      estimatedCost,
      estimatedLatency,
      confidence
    };
  }
  
  /**
   * Filter eligible venues
   */
  private filterEligibleVenues(criteria: VenueSelectionCriteria): VenueScore[] {
    const venues: VenueScore[] = [];
    
    for (const [venueId, score] of this.venueScores) {
      const metrics = this.getLatestMetrics(venueId);
      if (!metrics) continue;
      
      // Apply minimum thresholds
      if (metrics.successRate < this.config.minSuccessRate) continue;
      if (metrics.fillRate < this.config.minFillRate) continue;
      if (metrics.p99Latency > this.config.maxLatencyMs) continue;
      
      venues.push(score);
    }
    
    return venues;
  }
  
  /**
   * Adjust scores based on criteria
   */
  private adjustScoresForCriteria(
    venues: VenueScore[],
    criteria: VenueSelectionCriteria
  ): Array<VenueScore & { adjustedScore: number }> {
    return venues.map(venue => {
      let adjustedScore = venue.overallScore;
      
      // Adjust based on urgency
      if (criteria.urgency === 'high') {
        // Prioritize latency for urgent orders
        adjustedScore = venue.latencyScore * 0.6 + 
                       venue.reliabilityScore * 0.3 +
                       venue.costScore * 0.1;
      } else if (criteria.urgency === 'low') {
        // Prioritize cost for non-urgent orders
        adjustedScore = venue.costScore * 0.5 +
                       venue.liquidityScore * 0.3 +
                       venue.reliabilityScore * 0.2;
      }
      
      // Adjust based on order type
      if (criteria.orderType === 'limit') {
        // Liquidity matters more for limit orders
        adjustedScore = adjustedScore * 0.7 + venue.liquidityScore * 0.3;
      }
      
      return { ...venue, adjustedScore };
    });
  }
  
  /**
   * Calculate venue allocations
   */
  private calculateAllocations(
    venues: Array<VenueScore & { adjustedScore: number }>,
    criteria: VenueSelectionCriteria
  ): Array<VenueScore & { adjustedScore: number; allocation: number }> {
    const totalScore = venues.reduce((sum, v) => sum + v.adjustedScore, 0);
    
    return venues.map(venue => ({
      ...venue,
      allocation: venue.adjustedScore / totalScore
    }));
  }
  
  /**
   * Estimate execution metrics
   */
  private estimateExecution(
    allocations: Array<VenueScore & { adjustedScore: number; allocation: number }>,
    criteria: VenueSelectionCriteria
  ): { estimatedCost: number; estimatedLatency: number } {
    let estimatedCost = 0;
    let estimatedLatency = 0;
    
    for (const venue of allocations) {
      const metrics = this.getLatestMetrics(venue.venueId);
      if (!metrics) continue;
      
      const venueSize = criteria.orderSize * venue.allocation;
      const venueCost = venueSize * (metrics.feeRate + metrics.avgSlippageBps / 10000);
      
      estimatedCost += venueCost;
      estimatedLatency += metrics.avgLatency * venue.allocation;
    }
    
    return { estimatedCost, estimatedLatency };
  }
  
  /**
   * Calculate confidence score
   */
  private calculateConfidence(venues: Array<VenueScore & { adjustedScore: number }>): number {
    // Base confidence on data quality and score consistency
    let confidence = 0.5;
    
    // More data points = higher confidence
    for (const venue of venues) {
      const metrics = this.venueMetrics.get(venue.venueId);
      if (metrics && metrics.length > 10) {
        confidence += 0.1;
      }
    }
    
    // High scores = higher confidence
    const avgScore = venues.reduce((sum, v) => sum + v.adjustedScore, 0) / venues.length;
    confidence += avgScore / 200; // Max 0.5 additional
    
    return Math.min(1, confidence);
  }
  
  /**
   * Generate reasoning for venue selection
   */
  private generateReasoning(
    venue: VenueScore & { adjustedScore: number },
    criteria: VenueSelectionCriteria
  ): string {
    const reasons: string[] = [];
    
    if (venue.latencyScore > 80) {
      reasons.push('excellent latency');
    }
    if (venue.costScore > 80) {
      reasons.push('competitive fees');
    }
    if (venue.liquidityScore > 80) {
      reasons.push('deep liquidity');
    }
    if (venue.reliabilityScore > 90) {
      reasons.push('high reliability');
    }
    
    if (criteria.urgency === 'high' && venue.latencyScore === Math.max(
      venue.latencyScore, venue.costScore, venue.liquidityScore, venue.reliabilityScore
    )) {
      reasons.push('optimal for urgent execution');
    }
    
    return reasons.join(', ');
  }
  
  /**
   * Get latest metrics for a venue
   */
  private getLatestMetrics(venueId: string): VenueMetrics | null {
    const history = this.venueMetrics.get(venueId);
    if (!history || history.length === 0) {
      return null;
    }
    
    return history[history.length - 1];
  }
  
  /**
   * Get all venue scores
   */
  getVenueScores(): VenueScore[] {
    return Array.from(this.venueScores.values());
  }
  
  /**
   * Get venue performance report
   */
  getPerformanceReport(venueId: string): VenuePerformanceReport | null {
    const metrics = this.venueMetrics.get(venueId);
    const score = this.venueScores.get(venueId);
    
    if (!metrics || !score) {
      return null;
    }
    
    const aggregated = this.aggregateMetrics(metrics);
    
    return {
      venueId,
      score,
      currentMetrics: aggregated,
      historicalMetrics: metrics,
      dataPoints: metrics.length,
      lastUpdated: metrics[metrics.length - 1].timestamp
    };
  }
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