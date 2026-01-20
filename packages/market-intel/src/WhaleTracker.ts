import { Logger } from '@noderr/utils';
import { EventEmitter } from 'events';
import {
  WhaleActivity,
  WhalePattern,
  MarketImpact,
  SmartMoneyAddress,
  WhaleTrackingConfig,
  TelemetryClient,
  MarketIntelTelemetryEvent
} from './types';

const logger = new Logger('WhaleTracker');
export class WhaleTracker extends EventEmitter {
  private config: WhaleTrackingConfig;
  private telemetry: TelemetryClient;
  private whaleAddresses: Map<string, SmartMoneyAddress>;
  private activityHistory: Map<string, WhaleActivity[]>;
  private patternAnalyzer: PatternAnalyzer;
  private impactAnalyzer: ImpactAnalyzer;
  private smartMoneyDetector: SmartMoneyDetector;
  private readonly HISTORY_LIMIT = 10000;

  constructor(config: WhaleTrackingConfig, telemetry: TelemetryClient) {
    super();
    this.config = config;
    this.telemetry = telemetry;
    this.whaleAddresses = new Map();
    this.activityHistory = new Map();
    this.patternAnalyzer = new PatternAnalyzer();
    this.impactAnalyzer = new ImpactAnalyzer();
    this.smartMoneyDetector = new SmartMoneyDetector(config);
  }

  async trackTransaction(activity: WhaleActivity): Promise<{
    isWhale: boolean;
    pattern?: WhalePattern;
    marketImpact?: MarketImpact;
    smartMoneyScore?: number;
  }> {
    const startTime = Date.now();

    try {
      // Check if transaction meets whale criteria
      const isWhale = this.isWhaleTransaction(activity);
      if (!isWhale) {
        return { isWhale: false };
      }

      // Update activity history
      this.updateActivityHistory(activity);

      // Analyze whale pattern
      const pattern = await this.patternAnalyzer.analyzePattern(
        activity.address,
        this.getAddressHistory(activity.address)
      );

      // Calculate market impact
      const marketImpact = await this.impactAnalyzer.calculateImpact(
        activity,
        this.getRecentActivity()
      );

      // Calculate smart money score
      const smartMoneyScore = await this.smartMoneyDetector.calculateScore(
        activity.address,
        this.getAddressHistory(activity.address)
      );

      // Update whale registry
      this.updateWhaleRegistry(activity.address, smartMoneyScore, pattern);

      // Emit events
      this.emit('whale_detected', {
        activity,
        pattern,
        marketImpact,
        smartMoneyScore
      });

      if (smartMoneyScore > this.config.smartMoneyThreshold) {
        this.emit('smart_money_alert', {
          address: activity.address,
          score: smartMoneyScore,
          activity
        });
      }

      // Track telemetry
      this.telemetry.track({
        eventType: 'whale_detected',
        data: {
          chain: activity.chain,
          amount: activity.amount.toString(),
          direction: activity.direction,
          pattern: pattern?.pattern,
          impactScore: activity.impactScore,
          smartMoneyScore
        },
        duration: Date.now() - startTime,
        timestamp: new Date()
      });

      return {
        isWhale: true,
        pattern,
        marketImpact,
        smartMoneyScore
      };
    } catch (error) {
      logger.error('Whale tracking error:', error);
      throw error;
    }
  }

  async analyzeWhaleMovements(
    symbol: string,
    timeframe: number = 24 // hours
  ): Promise<{
    netFlow: bigint;
    accumulation: WhaleActivity[];
    distribution: WhaleActivity[];
    topWhales: SmartMoneyAddress[];
    marketImpact: MarketImpact;
  }> {
    const cutoffTime = new Date(Date.now() - timeframe * 60 * 60 * 1000);
    const relevantActivity = this.getRecentActivity()
      .filter(a => 
        a.tokenSymbol === symbol && 
        a.timestamp > cutoffTime
      );

    // Calculate net flow
    let netFlow = BigInt(0);
    const accumulation: WhaleActivity[] = [];
    const distribution: WhaleActivity[] = [];

    for (const activity of relevantActivity) {
      if (activity.direction === 'accumulation') {
        netFlow += activity.amount;
        accumulation.push(activity);
      } else if (activity.direction === 'distribution') {
        netFlow -= activity.amount;
        distribution.push(activity);
      }
    }

    // Get top whales
    const topWhales = this.getTopWhales(symbol, 10);

    // Calculate aggregate market impact
    const marketImpact = await this.impactAnalyzer.calculateAggregateImpact(
      relevantActivity
    );

    return {
      netFlow,
      accumulation,
      distribution,
      topWhales,
      marketImpact
    };
  }

  async detectCoordinatedActivity(
    timeWindow: number = 60 // minutes
  ): Promise<{
    detected: boolean;
    clusters: WhaleActivity[][];
    confidence: number;
  }> {
    const recentActivity = this.getRecentActivity()
      .filter(a => 
        a.timestamp > new Date(Date.now() - timeWindow * 60 * 1000)
      );

    const clusters = this.clusterActivity(recentActivity);
    const coordinationScore = this.calculateCoordinationScore(clusters);

    return {
      detected: coordinationScore > 0.7,
      clusters: clusters.filter(c => c.length > 1),
      confidence: coordinationScore
    };
  }

  getSmartMoneyAddresses(minScore: number = 0.7): SmartMoneyAddress[] {
    return Array.from(this.whaleAddresses.values())
      .filter(addr => addr.score >= minScore)
      .sort((a, b) => b.score - a.score);
  }

  getWhalePatterns(address: string): WhalePattern | undefined {
    const history = this.getAddressHistory(address);
    if (history.length === 0) return undefined;

    return this.patternAnalyzer.analyzePattern(address, history);
  }

  private isWhaleTransaction(activity: WhaleActivity): boolean {
    // Check minimum transaction size
    const minSizeWei = BigInt(this.config.minTransactionSize * 1e18);
    if (activity.amount < minSizeWei) return false;

    // Check if chain is tracked
    if (!this.config.chains.includes(activity.chain)) return false;

    // Additional filters for DEX activity
    if (this.config.trackDexActivity) {
      // Implement DEX-specific logic
      return true;
    }

    return true;
  }

  private updateActivityHistory(activity: WhaleActivity): void {
    const address = activity.address;
    
    if (!this.activityHistory.has(address)) {
      this.activityHistory.set(address, []);
    }

    const history = this.activityHistory.get(address)!;
    history.push(activity);

    // Maintain history limit
    if (history.length > this.HISTORY_LIMIT / 100) { // Per-address limit
      history.shift();
    }

    // Update global history
    const allHistory = this.getRecentActivity();
    if (allHistory.length > this.HISTORY_LIMIT) {
      // Remove oldest entries
      const toRemove = allHistory.length - this.HISTORY_LIMIT;
      allHistory.splice(0, toRemove);
    }
  }

  private updateWhaleRegistry(
    address: string,
    smartMoneyScore: number,
    pattern?: WhalePattern
  ): void {
    const existing = this.whaleAddresses.get(address);
    const history = this.getAddressHistory(address);

    const winRate = this.calculateWinRate(history);
    const avgProfit = this.calculateAvgProfit(history);

    const whaleInfo: SmartMoneyAddress = {
      address,
      score: smartMoneyScore,
      winRate,
      avgProfit,
      totalTransactions: history.length,
      lastActivity: new Date(),
      tags: this.generateTags(pattern, smartMoneyScore, winRate)
    };

    this.whaleAddresses.set(address, whaleInfo);
  }

  private calculateWinRate(history: WhaleActivity[]): number {
    if (history.length < 2) return 0;

    // Group by token and calculate P&L
    const tokenPnL = new Map<string, { totalPnL: number; trades: number }>();

    for (let i = 1; i < history.length; i++) {
      const prev = history[i - 1];
      const curr = history[i];

      if (prev.tokenSymbol === curr.tokenSymbol &&
          prev.direction === 'accumulation' &&
          curr.direction === 'distribution') {
        // Simple P&L calculation (would need price data in real implementation)
        const pnl = curr.impactScore - prev.impactScore; // Placeholder
        
        const existing = tokenPnL.get(curr.tokenSymbol) || { totalPnL: 0, trades: 0 };
        existing.totalPnL += pnl;
        existing.trades++;
        tokenPnL.set(curr.tokenSymbol, existing);
      }
    }

    let wins = 0;
    let totalTrades = 0;

    for (const [token, data] of tokenPnL) {
      if (data.totalPnL > 0) wins += data.trades;
      totalTrades += data.trades;
    }

    return totalTrades > 0 ? wins / totalTrades : 0;
  }

  private calculateAvgProfit(history: WhaleActivity[]): number {
    // Placeholder - would need price data for real calculation
    const profits = history
      .filter(a => a.direction === 'distribution')
      .map(a => a.impactScore * 0.1); // Simplified

    return profits.length > 0 ?
      profits.reduce((sum, p) => sum + p, 0) / profits.length : 0;
  }

  private generateTags(
    pattern?: WhalePattern,
    smartMoneyScore?: number,
    winRate?: number
  ): string[] {
    const tags: string[] = [];

    if (pattern) {
      tags.push(pattern.pattern);
    }

    if (smartMoneyScore && smartMoneyScore > 0.9) {
      tags.push('elite');
    } else if (smartMoneyScore && smartMoneyScore > 0.7) {
      tags.push('smart_money');
    }

    if (winRate && winRate > 0.8) {
      tags.push('high_win_rate');
    }

    return tags;
  }

  private getAddressHistory(address: string): WhaleActivity[] {
    return this.activityHistory.get(address) || [];
  }

  private getRecentActivity(): WhaleActivity[] {
    const allActivity: WhaleActivity[] = [];
    
    for (const history of this.activityHistory.values()) {
      allActivity.push(...history);
    }

    return allActivity.sort((a, b) => 
      b.timestamp.getTime() - a.timestamp.getTime()
    );
  }

  private getTopWhales(symbol: string, limit: number): SmartMoneyAddress[] {
    const relevantWhales: SmartMoneyAddress[] = [];

    for (const [address, whale] of this.whaleAddresses) {
      const history = this.getAddressHistory(address);
      const hasSymbol = history.some(a => a.tokenSymbol === symbol);
      
      if (hasSymbol) {
        relevantWhales.push(whale);
      }
    }

    return relevantWhales
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  private clusterActivity(activities: WhaleActivity[]): WhaleActivity[][] {
    const clusters: WhaleActivity[][] = [];
    const timeThreshold = 5 * 60 * 1000; // 5 minutes

    // Sort by timestamp
    const sorted = [...activities].sort((a, b) => 
      a.timestamp.getTime() - b.timestamp.getTime()
    );

    let currentCluster: WhaleActivity[] = [];

    for (const activity of sorted) {
      if (currentCluster.length === 0) {
        currentCluster.push(activity);
      } else {
        const lastActivity = currentCluster[currentCluster.length - 1];
        const timeDiff = activity.timestamp.getTime() - lastActivity.timestamp.getTime();

        if (timeDiff <= timeThreshold &&
            activity.tokenSymbol === lastActivity.tokenSymbol &&
            activity.direction === lastActivity.direction) {
          currentCluster.push(activity);
        } else {
          if (currentCluster.length > 1) {
            clusters.push(currentCluster);
          }
          currentCluster = [activity];
        }
      }
    }

    if (currentCluster.length > 1) {
      clusters.push(currentCluster);
    }

    return clusters;
  }

  private calculateCoordinationScore(clusters: WhaleActivity[][]): number {
    if (clusters.length === 0) return 0;

    let score = 0;
    const significantClusters = clusters.filter(c => c.length >= 3);

    // Factor 1: Number of coordinated moves
    score += Math.min(significantClusters.length / 5, 0.3);

    // Factor 2: Size of coordinated moves
    for (const cluster of significantClusters) {
      const totalAmount = cluster.reduce((sum, a) => sum + Number(a.amount), 0);
      const avgAmount = totalAmount / cluster.length;
      
      if (avgAmount > this.config.minTransactionSize * 10) {
        score += 0.1;
      }
    }

    // Factor 3: Timing precision
    for (const cluster of significantClusters) {
      const timestamps = cluster.map(a => a.timestamp.getTime());
      const avgTime = timestamps.reduce((sum, t) => sum + t, 0) / timestamps.length;
      const variance = timestamps.reduce((sum, t) => sum + Math.pow(t - avgTime, 2), 0) / timestamps.length;
      const stdDev = Math.sqrt(variance);
      
      if (stdDev < 60 * 1000) { // Less than 1 minute std dev
        score += 0.1;
      }
    }

    return Math.min(score, 1);
  }

  async stop(): Promise<void> {
    this.whaleAddresses.clear();
    this.activityHistory.clear();
    await this.telemetry.flush();
  }
}

// Supporting classes
class PatternAnalyzer {
  analyzePattern(address: string, history: WhaleActivity[]): WhalePattern | undefined {
    if (history.length < 5) return undefined;

    const patterns = {
      accumulator: this.isAccumulator(history),
      distributor: this.isDistributor(history),
      trader: this.isTrader(history),
      holder: this.isHolder(history)
    };

    // Find dominant pattern
    let dominantPattern: keyof typeof patterns | null = null;
    let maxScore = 0;

    for (const [pattern, score] of Object.entries(patterns)) {
      if (score > maxScore) {
        maxScore = score;
        dominantPattern = pattern as keyof typeof patterns;
      }
    }

    if (!dominantPattern || maxScore < 0.5) return undefined;

    const profitability = this.calculateProfitability(history);
    const avgHoldTime = this.calculateAvgHoldTime(history);

    return {
      address,
      pattern: dominantPattern,
      confidence: maxScore,
      historicalActivity: history.slice(-20), // Last 20 activities
      profitability,
      avgHoldTime
    };
  }

  private isAccumulator(history: WhaleActivity[]): number {
    const accumulations = history.filter(a => a.direction === 'accumulation').length;
    const ratio = accumulations / history.length;
    return ratio > 0.7 ? ratio : 0;
  }

  private isDistributor(history: WhaleActivity[]): number {
    const distributions = history.filter(a => a.direction === 'distribution').length;
    const ratio = distributions / history.length;
    return ratio > 0.7 ? ratio : 0;
  }

  private isTrader(history: WhaleActivity[]): number {
    // Look for alternating buy/sell patterns
    let alternations = 0;
    for (let i = 1; i < history.length; i++) {
      if (history[i].direction !== history[i - 1].direction) {
        alternations++;
      }
    }
    const ratio = alternations / (history.length - 1);
    return ratio > 0.5 ? ratio : 0;
  }

  private isHolder(history: WhaleActivity[]): number {
    // Low activity relative to position size
    const avgTimeBetween = this.calculateAvgTimeBetween(history);
    const holdScore = avgTimeBetween > 7 * 24 * 60 * 60 * 1000 ? 0.8 : 0; // 7 days
    return holdScore;
  }

  private calculateProfitability(history: WhaleActivity[]): number {
    // Simplified - would need price data
    const impactScores = history.map(a => a.impactScore);
    const avgImpact = impactScores.reduce((sum, s) => sum + s, 0) / impactScores.length;
    return avgImpact;
  }

  private calculateAvgHoldTime(history: WhaleActivity[]): number {
    return this.calculateAvgTimeBetween(history);
  }

  private calculateAvgTimeBetween(history: WhaleActivity[]): number {
    if (history.length < 2) return 0;

    let totalTime = 0;
    for (let i = 1; i < history.length; i++) {
      totalTime += history[i].timestamp.getTime() - history[i - 1].timestamp.getTime();
    }

    return totalTime / (history.length - 1);
  }
}

class ImpactAnalyzer {
  async calculateImpact(
    activity: WhaleActivity,
    recentActivity: WhaleActivity[]
  ): Promise<MarketImpact> {
    // Filter relevant activity
    const relevantActivity = recentActivity.filter(a =>
      a.tokenSymbol === activity.tokenSymbol &&
      a.timestamp > new Date(Date.now() - 24 * 60 * 60 * 1000)
    );

    // Calculate various impact factors
    const volumeImpact = this.calculateVolumeImpact(activity, relevantActivity);
    const directionImpact = this.calculateDirectionImpact(activity, relevantActivity);
    const sizeImpact = this.calculateSizeImpact(activity, relevantActivity);

    // Combine impacts
    const expectedPriceChange = (volumeImpact + directionImpact + sizeImpact) / 3;
    const confidenceInterval: [number, number] = [
      expectedPriceChange * 0.7,
      expectedPriceChange * 1.3
    ];

    // Time to impact based on market conditions
    const timeToImpact = this.estimateTimeToImpact(activity, relevantActivity);

    // Volatility increase
    const volatilityIncrease = Math.abs(expectedPriceChange) * 0.3;

    return {
      expectedPriceChange,
      confidenceInterval,
      timeToImpact,
      volatilityIncrease
    };
  }

  async calculateAggregateImpact(activities: WhaleActivity[]): Promise<MarketImpact> {
    if (activities.length === 0) {
      return {
        expectedPriceChange: 0,
        confidenceInterval: [0, 0],
        timeToImpact: 0,
        volatilityIncrease: 0
      };
    }

    // Group by direction
    const accumulations = activities.filter(a => a.direction === 'accumulation');
    const distributions = activities.filter(a => a.direction === 'distribution');

    // Net directional impact
    const netImpact = accumulations.length - distributions.length;
    const totalVolume = activities.reduce((sum, a) => sum + Number(a.amount), 0);
    
    // Simplified impact calculation
    const expectedPriceChange = (netImpact / activities.length) * 
      Math.log10(totalVolume / 1e18) * 2;

    const confidenceInterval: [number, number] = [
      expectedPriceChange * 0.5,
      expectedPriceChange * 1.5
    ];

    return {
      expectedPriceChange,
      confidenceInterval,
      timeToImpact: 30, // 30 minutes average
      volatilityIncrease: Math.abs(expectedPriceChange) * 0.4
    };
  }

  private calculateVolumeImpact(
    activity: WhaleActivity,
    recentActivity: WhaleActivity[]
  ): number {
    const totalVolume = recentActivity.reduce((sum, a) => 
      sum + Number(a.amount), 0
    );
    const activityVolume = Number(activity.amount);
    
    return activityVolume / (totalVolume + activityVolume) * 10;
  }

  private calculateDirectionImpact(
    activity: WhaleActivity,
    recentActivity: WhaleActivity[]
  ): number {
    const sameDirection = recentActivity.filter(a => 
      a.direction === activity.direction
    ).length;
    const oppositeDirection = recentActivity.filter(a => 
      a.direction !== activity.direction && a.direction !== 'transfer'
    ).length;

    const directionRatio = sameDirection / (sameDirection + oppositeDirection + 1);
    return activity.direction === 'accumulation' ? 
      directionRatio * 5 : -directionRatio * 5;
  }

  private calculateSizeImpact(
    activity: WhaleActivity,
    recentActivity: WhaleActivity[]
  ): number {
    const avgSize = recentActivity.length > 0 ?
      recentActivity.reduce((sum, a) => sum + Number(a.amount), 0) / recentActivity.length :
      Number(activity.amount);

    const sizeRatio = Number(activity.amount) / avgSize;
    return Math.log10(sizeRatio) * 3;
  }

  private estimateTimeToImpact(
    activity: WhaleActivity,
    recentActivity: WhaleActivity[]
  ): number {
    // Base time
    let timeToImpact = 15; // 15 minutes base

    // Adjust based on activity size
    const sizeMultiplier = Math.log10(Number(activity.amount) / 1e18);
    timeToImpact *= (1 + sizeMultiplier * 0.1);

    // Adjust based on market activity
    const recentActivityLevel = recentActivity.length / 24; // Activities per hour
    if (recentActivityLevel > 10) {
      timeToImpact *= 0.5; // Faster in active markets
    } else if (recentActivityLevel < 2) {
      timeToImpact *= 2; // Slower in quiet markets
    }

    return Math.max(5, Math.min(60, timeToImpact));
  }
}

class SmartMoneyDetector {
  private config: WhaleTrackingConfig;

  constructor(config: WhaleTrackingConfig) {
    this.config = config;
  }

  async calculateScore(
    address: string,
    history: WhaleActivity[]
  ): Promise<number> {
    if (history.length < 3) return 0;

    let score = 0;

    // Factor 1: Timing precision (buying before pumps, selling before dumps)
    const timingScore = this.calculateTimingScore(history);
    score += timingScore * 0.3;

    // Factor 2: Position sizing (larger positions in winners)
    const sizingScore = this.calculateSizingScore(history);
    score += sizingScore * 0.2;

    // Factor 3: Consistency
    const consistencyScore = this.calculateConsistencyScore(history);
    score += consistencyScore * 0.2;

    // Factor 4: Activity pattern
    const patternScore = this.calculatePatternScore(history);
    score += patternScore * 0.2;

    // Factor 5: Network effects (interacting with other smart money)
    const networkScore = this.calculateNetworkScore(history);
    score += networkScore * 0.1;

    return Math.min(score, 1);
  }

  private calculateTimingScore(history: WhaleActivity[]): number {
    // Analyze timing of accumulations vs distributions
    let goodTiming = 0;
    let totalEvents = 0;

    for (let i = 0; i < history.length - 1; i++) {
      const current = history[i];
      const next = history[i + 1];

      if (current.direction === 'accumulation' && 
          next.impactScore > current.impactScore) {
        goodTiming++;
      } else if (current.direction === 'distribution' &&
                 next.impactScore < current.impactScore) {
        goodTiming++;
      }
      totalEvents++;
    }

    return totalEvents > 0 ? goodTiming / totalEvents : 0;
  }

  private calculateSizingScore(history: WhaleActivity[]): number {
    // Check if larger positions correlate with better outcomes
    const positions = history.map(h => ({
      size: Number(h.amount),
      outcome: h.impactScore
    }));

    // Calculate correlation
    const correlation = this.calculateCorrelation(
      positions.map(p => p.size),
      positions.map(p => p.outcome)
    );

    return Math.max(0, correlation);
  }

  private calculateConsistencyScore(history: WhaleActivity[]): number {
    // Measure consistency of profitable actions
    const outcomes = history.map(h => h.impactScore);
    const avgOutcome = outcomes.reduce((sum, o) => sum + o, 0) / outcomes.length;
    const variance = outcomes.reduce((sum, o) => 
      sum + Math.pow(o - avgOutcome, 2), 0
    ) / outcomes.length;
    const stdDev = Math.sqrt(variance);

    // Lower std dev relative to mean = more consistent
    const consistencyRatio = avgOutcome > 0 ? 1 - (stdDev / avgOutcome) : 0;
    return Math.max(0, Math.min(1, consistencyRatio));
  }

  private calculatePatternScore(history: WhaleActivity[]): number {
    // Look for sophisticated patterns
    let score = 0;

    // Pattern 1: Gradual accumulation
    const hasGradualAccumulation = this.detectGradualAccumulation(history);
    if (hasGradualAccumulation) score += 0.3;

    // Pattern 2: Strategic distribution
    const hasStrategicDistribution = this.detectStrategicDistribution(history);
    if (hasStrategicDistribution) score += 0.3;

    // Pattern 3: Cross-chain activity
    const hasCrossChain = this.detectCrossChainActivity(history);
    if (hasCrossChain) score += 0.4;

    return score;
  }

  private calculateNetworkScore(history: WhaleActivity[]): number {
    // Check interactions with known smart money addresses
    const knownSmartMoney = new Set<string>(); // Would be populated from config

    let interactions = 0;
    for (const activity of history) {
      if (knownSmartMoney.has(activity.fromAddress) ||
          knownSmartMoney.has(activity.toAddress)) {
        interactions++;
      }
    }

    return Math.min(interactions / history.length, 1);
  }

  private calculateCorrelation(x: number[], y: number[]): number {
    if (x.length !== y.length || x.length === 0) return 0;

    const n = x.length;
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((total, xi, i) => total + xi * y[i], 0);
    const sumX2 = x.reduce((total, xi) => total + xi * xi, 0);
    const sumY2 = y.reduce((total, yi) => total + yi * yi, 0);

    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

    return denominator === 0 ? 0 : numerator / denominator;
  }

  private detectGradualAccumulation(history: WhaleActivity[]): boolean {
    const accumulations = history.filter(h => h.direction === 'accumulation');
    if (accumulations.length < 3) return false;

    // Check if accumulations are spread over time
    const timestamps = accumulations.map(a => a.timestamp.getTime());
    const timeSpread = Math.max(...timestamps) - Math.min(...timestamps);
    const avgTimeBetween = timeSpread / (accumulations.length - 1);

    // More than 1 day between accumulations on average
    return avgTimeBetween > 24 * 60 * 60 * 1000;
  }

  private detectStrategicDistribution(history: WhaleActivity[]): boolean {
    const distributions = history.filter(h => h.direction === 'distribution');
    if (distributions.length < 2) return false;

    // Check if distributions happen at high impact scores
    const avgImpactScore = distributions.reduce((sum, d) => 
      sum + d.impactScore, 0
    ) / distributions.length;

    return avgImpactScore > 0.7;
  }

  private detectCrossChainActivity(history: WhaleActivity[]): boolean {
    const chains = new Set(history.map(h => h.chain));
    return chains.size > 1;
  }
} 