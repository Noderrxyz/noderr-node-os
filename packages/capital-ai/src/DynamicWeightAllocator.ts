import { Logger } from '@noderr/utils/src';
import { EventEmitter } from 'events';

const logger = new Logger('DynamicWeightAllocator');
const createLogger = (name: string) => ({
  info: (message: string, meta?: any) => logger.info(`[${name}] INFO: ${message}`, meta),
  error: (message: string, error?: any) => logger.error(`[${name}] ERROR: ${message}`, error),
  debug: (message: string, meta?: any) => logger.debug(`[${name}] DEBUG: ${message}`, meta),
  warn: (message: string, meta?: any) => logger.warn(`[${name}] WARN: ${message}`, meta)
});

interface Strategy {
  id: string;
  name: string;
  type: 'MOMENTUM' | 'MEAN_REVERSION' | 'ARBITRAGE' | 'MARKET_MAKING' | 'FUNDAMENTAL';
  currentWeight: number;
  targetWeight: number;
  performance: StrategyPerformance;
  positions: Position[];
  constraints: WeightConstraints;
}

interface StrategyPerformance {
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdown: number;
  returns: number[];
  volatility: number;
  downwardDeviation: number;
  winRate: number;
  profitFactor: number;
  lastUpdated: Date;
}

interface Position {
  symbol: string;
  size: number;
  value: number;
  sector?: string;
  beta?: number;
}

interface WeightConstraints {
  minWeight: number;
  maxWeight: number;
  maxDrawdown: number;
  minSharpe: number;
  maxCorrelation: number;
}

interface MarketRegime {
  type: 'BULL' | 'BEAR' | 'SIDEWAYS' | 'HIGH_VOL' | 'LOW_VOL';
  confidence: number;
  characteristics: {
    volatility: number;
    trend: number;
    momentum: number;
    correlation: number;
  };
  detectedAt: Date;
}

interface AllocationResult {
  id: string;
  timestamp: Date;
  strategies: Map<string, number>; // strategyId -> weight
  regime: MarketRegime;
  metrics: {
    expectedSharpe: number;
    expectedVolatility: number;
    diversificationRatio: number;
    maxPositionOverlap: number;
  };
  rebalanceRequired: boolean;
}

interface OptimizationConstraints {
  targetVolatility: number;
  maxLeverage: number;
  minDiversification: number;
  maxSectorConcentration: number;
  rebalanceThreshold: number;
  transactionCostBudget: number;
}

export class DynamicWeightAllocator extends EventEmitter {
  private logger: ReturnType<typeof createLogger>;
  private strategies: Map<string, Strategy>;
  private currentAllocation: AllocationResult | null = null;
  private marketRegime: MarketRegime;
  private optimizationConstraints: OptimizationConstraints;
  private correlationMatrix: number[][] = [];
  private rebalanceInterval: NodeJS.Timeout | null = null;
  private performanceWindow: number = 252; // Trading days
  
  constructor() {
    super();
    this.logger = createLogger('DynamicWeightAllocator');
    this.strategies = new Map();
    
    this.marketRegime = {
      type: 'SIDEWAYS',
      confidence: 0.5,
      characteristics: {
        volatility: 0.15,
        trend: 0,
        momentum: 0,
        correlation: 0.5
      },
      detectedAt: new Date()
    };
    
    this.optimizationConstraints = {
      targetVolatility: 0.15,
      maxLeverage: 2.0,
      minDiversification: 1.5,
      maxSectorConcentration: 0.40,
      rebalanceThreshold: 0.05,
      transactionCostBudget: 0.001
    };
    
    this.initialize();
  }
  
  private initialize(): void {
    // Start periodic rebalancing
    this.rebalanceInterval = setInterval(() => {
      this.evaluateRebalance();
    }, 300000); // Every 5 minutes
    
    this.logger.info('Dynamic weight allocator initialized');
  }
  
  public async registerStrategy(strategy: Omit<Strategy, 'currentWeight' | 'targetWeight'>): Promise<void> {
    const newStrategy: Strategy = {
      ...strategy,
      currentWeight: 0,
      targetWeight: 0
    };
    
    this.strategies.set(strategy.id, newStrategy);
    
    this.logger.info('Strategy registered', {
      strategyId: strategy.id,
      type: strategy.type,
      constraints: strategy.constraints
    });
    
    // Trigger reallocation
    await this.optimizeAllocation();
  }
  
  public async updatePerformance(
    strategyId: string,
    performance: Partial<StrategyPerformance>
  ): Promise<void> {
    const strategy = this.strategies.get(strategyId);
    if (!strategy) return;
    
    strategy.performance = {
      ...strategy.performance,
      ...performance,
      lastUpdated: new Date()
    };
    
    this.logger.debug('Performance updated', {
      strategyId,
      sharpe: performance.sharpeRatio,
      drawdown: performance.maxDrawdown
    });
    
    // Check if rebalance needed
    if (this.shouldTriggerRebalance(strategy)) {
      await this.optimizeAllocation();
    }
  }
  
  public async updateMarketRegime(regime: MarketRegime): Promise<void> {
    const previousRegime = this.marketRegime.type;
    this.marketRegime = regime;
    
    this.logger.info('Market regime updated', {
      from: previousRegime,
      to: regime.type,
      confidence: regime.confidence
    });
    
    // Regime change triggers reallocation
    if (previousRegime !== regime.type) {
      await this.optimizeAllocation();
    }
  }
  
  private async optimizeAllocation(): Promise<AllocationResult> {
    this.logger.info('Optimizing capital allocation');
    
    try {
      // Update correlation matrix
      this.updateCorrelationMatrix();
      
      // Get regime-adjusted weights
      const regimeWeights = this.getRegimeAdjustedWeights();
      
      // Optimize using mean-variance optimization
      const optimalWeights = this.meanVarianceOptimization(regimeWeights);
      
      // Apply position overlap constraints
      const adjustedWeights = this.minimizePositionOverlap(optimalWeights);
      
      // Apply final constraints
      const finalWeights = this.applyConstraints(adjustedWeights);
      
      // Calculate allocation metrics
      const metrics = this.calculateAllocationMetrics(finalWeights);
      
      // Create allocation result
      const result: AllocationResult = {
        id: `alloc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date(),
        strategies: finalWeights,
        regime: this.marketRegime,
        metrics,
        rebalanceRequired: this.isRebalanceRequired(finalWeights)
      };
      
      this.currentAllocation = result;
      
      // Update target weights
      for (const [strategyId, weight] of finalWeights) {
        const strategy = this.strategies.get(strategyId);
        if (strategy) {
          strategy.targetWeight = weight;
        }
      }
      
      this.logger.info('Allocation optimized', {
        strategiesAllocated: finalWeights.size,
        expectedSharpe: metrics.expectedSharpe,
        rebalanceRequired: result.rebalanceRequired
      });
      
      this.emit('allocation-updated', result);
      
      return result;
      
    } catch (error) {
      this.logger.error('Allocation optimization failed', error);
      throw error;
    }
  }
  
  private updateCorrelationMatrix(): void {
    const strategies = Array.from(this.strategies.values());
    const n = strategies.length;
    
    this.correlationMatrix = Array(n).fill(null).map(() => Array(n).fill(0));
    
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) {
          this.correlationMatrix[i][j] = 1;
        } else {
          this.correlationMatrix[i][j] = this.calculateCorrelation(
            strategies[i].performance.returns,
            strategies[j].performance.returns
          );
        }
      }
    }
  }
  
  private calculateCorrelation(returns1: number[], returns2: number[]): number {
    if (returns1.length !== returns2.length || returns1.length === 0) return 0;
    
    const mean1 = returns1.reduce((a, b) => a + b, 0) / returns1.length;
    const mean2 = returns2.reduce((a, b) => a + b, 0) / returns2.length;
    
    let numerator = 0;
    let denominator1 = 0;
    let denominator2 = 0;
    
    for (let i = 0; i < returns1.length; i++) {
      const diff1 = returns1[i] - mean1;
      const diff2 = returns2[i] - mean2;
      
      numerator += diff1 * diff2;
      denominator1 += diff1 * diff1;
      denominator2 += diff2 * diff2;
    }
    
    const denominator = Math.sqrt(denominator1 * denominator2);
    return denominator === 0 ? 0 : numerator / denominator;
  }
  
  private getRegimeAdjustedWeights(): Map<string, number> {
    const weights = new Map<string, number>();
    
    for (const [id, strategy] of this.strategies) {
      let baseWeight = 1 / this.strategies.size; // Equal weight baseline
      
      // Adjust based on regime
      switch (this.marketRegime.type) {
        case 'BULL':
          if (strategy.type === 'MOMENTUM') baseWeight *= 1.5;
          if (strategy.type === 'MEAN_REVERSION') baseWeight *= 0.7;
          break;
          
        case 'BEAR':
          if (strategy.type === 'MEAN_REVERSION') baseWeight *= 1.3;
          if (strategy.type === 'MOMENTUM') baseWeight *= 0.5;
          if (strategy.type === 'MARKET_MAKING') baseWeight *= 1.2;
          break;
          
        case 'HIGH_VOL':
          if (strategy.type === 'ARBITRAGE') baseWeight *= 1.4;
          if (strategy.type === 'MARKET_MAKING') baseWeight *= 1.3;
          if (strategy.type === 'MOMENTUM') baseWeight *= 0.6;
          break;
          
        case 'LOW_VOL':
          if (strategy.type === 'MOMENTUM') baseWeight *= 1.2;
          if (strategy.type === 'FUNDAMENTAL') baseWeight *= 1.3;
          break;
          
        case 'SIDEWAYS':
          if (strategy.type === 'MEAN_REVERSION') baseWeight *= 1.4;
          if (strategy.type === 'MARKET_MAKING') baseWeight *= 1.2;
          break;
      }
      
      // Adjust by regime confidence
      baseWeight = baseWeight * (0.5 + 0.5 * this.marketRegime.confidence);
      
      weights.set(id, baseWeight);
    }
    
    // Normalize
    const sum = Array.from(weights.values()).reduce((a, b) => a + b, 0);
    for (const [id, weight] of weights) {
      weights.set(id, weight / sum);
    }
    
    return weights;
  }
  
  private meanVarianceOptimization(initialWeights: Map<string, number>): Map<string, number> {
    const strategies = Array.from(this.strategies.values());
    const n = strategies.length;
    
    if (n === 0) return new Map();
    
    // Expected returns vector
    const returns = strategies.map(s => 
      s.performance.sharpeRatio * Math.sqrt(252) * this.optimizationConstraints.targetVolatility
    );
    
    // Covariance matrix (simplified using correlation and volatilities)
    const covariance = Array(n).fill(null).map(() => Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        covariance[i][j] = this.correlationMatrix[i][j] * 
          strategies[i].performance.volatility * 
          strategies[j].performance.volatility;
      }
    }
    
    // Simplified optimization (in production would use quadratic programming)
    // Using risk parity approach
    const weights = new Array(n).fill(0);
    const riskContributions = new Array(n).fill(0);
    
    // Initialize with equal risk contribution
    for (let i = 0; i < n; i++) {
      weights[i] = 1 / n;
    }
    
    // Iterate to find risk parity weights
    for (let iter = 0; iter < 20; iter++) {
      // Calculate risk contributions
      for (let i = 0; i < n; i++) {
        let contribution = 0;
        for (let j = 0; j < n; j++) {
          contribution += weights[j] * covariance[i][j];
        }
        riskContributions[i] = weights[i] * contribution;
      }
      
      // Update weights
      const totalRisk = riskContributions.reduce((a, b) => a + b, 0);
      for (let i = 0; i < n; i++) {
        weights[i] = weights[i] * Math.sqrt((totalRisk / n) / riskContributions[i]);
      }
      
      // Normalize
      const sum = weights.reduce((a, b) => a + b, 0);
      for (let i = 0; i < n; i++) {
        weights[i] /= sum;
      }
    }
    
    // Blend with regime weights
    const alpha = 0.3; // Blend factor
    const result = new Map<string, number>();
    
    strategies.forEach((strategy, index) => {
      const mvWeight = weights[index];
      const regimeWeight = initialWeights.get(strategy.id) || 0;
      const blendedWeight = alpha * mvWeight + (1 - alpha) * regimeWeight;
      result.set(strategy.id, blendedWeight);
    });
    
    return result;
  }
  
  private minimizePositionOverlap(weights: Map<string, number>): Map<string, number> {
    const adjustedWeights = new Map(weights);
    
    // Calculate position overlap matrix
    const strategies = Array.from(this.strategies.values());
    const overlapMatrix = this.calculatePositionOverlap(strategies);
    
    // Penalize strategies with high overlap
    for (let i = 0; i < strategies.length; i++) {
      let overlapPenalty = 0;
      
      for (let j = 0; j < strategies.length; j++) {
        if (i !== j) {
          const weight_j = weights.get(strategies[j].id) || 0;
          overlapPenalty += overlapMatrix[i][j] * weight_j;
        }
      }
      
      const currentWeight = weights.get(strategies[i].id) || 0;
      const adjustedWeight = currentWeight * (1 - overlapPenalty * 0.5); // 50% max penalty
      adjustedWeights.set(strategies[i].id, adjustedWeight);
    }
    
    // Renormalize
    const sum = Array.from(adjustedWeights.values()).reduce((a, b) => a + b, 0);
    for (const [id, weight] of adjustedWeights) {
      adjustedWeights.set(id, weight / sum);
    }
    
    return adjustedWeights;
  }
  
  private calculatePositionOverlap(strategies: Strategy[]): number[][] {
    const n = strategies.length;
    const overlap = Array(n).fill(null).map(() => Array(n).fill(0));
    
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) {
          overlap[i][j] = 1;
        } else {
          const positions1 = strategies[i].positions;
          const positions2 = strategies[j].positions;
          
          // Calculate Jaccard similarity of positions
          const symbols1 = new Set(positions1.map(p => p.symbol));
          const symbols2 = new Set(positions2.map(p => p.symbol));
          
          const intersection = new Set([...symbols1].filter(x => symbols2.has(x)));
          const union = new Set([...symbols1, ...symbols2]);
          
          overlap[i][j] = union.size > 0 ? intersection.size / union.size : 0;
        }
      }
    }
    
    return overlap;
  }
  
  private applyConstraints(weights: Map<string, number>): Map<string, number> {
    const constrainedWeights = new Map<string, number>();
    
    // Apply individual strategy constraints
    for (const [id, weight] of weights) {
      const strategy = this.strategies.get(id);
      if (!strategy) continue;
      
      let constrainedWeight = weight;
      
      // Min/max weight constraints
      constrainedWeight = Math.max(strategy.constraints.minWeight, constrainedWeight);
      constrainedWeight = Math.min(strategy.constraints.maxWeight, constrainedWeight);
      
      // Performance-based constraints
      if (strategy.performance.sharpeRatio < strategy.constraints.minSharpe) {
        constrainedWeight = Math.min(constrainedWeight, strategy.constraints.minWeight);
      }
      
      if (strategy.performance.maxDrawdown > strategy.constraints.maxDrawdown) {
        constrainedWeight *= 0.5; // Halve allocation for excessive drawdown
      }
      
      constrainedWeights.set(id, constrainedWeight);
    }
    
    // Apply portfolio-level constraints
    const totalWeight = Array.from(constrainedWeights.values()).reduce((a, b) => a + b, 0);
    
    if (totalWeight > this.optimizationConstraints.maxLeverage) {
      // Scale down to meet leverage constraint
      const scale = this.optimizationConstraints.maxLeverage / totalWeight;
      for (const [id, weight] of constrainedWeights) {
        constrainedWeights.set(id, weight * scale);
      }
    }
    
    return constrainedWeights;
  }
  
  private calculateAllocationMetrics(weights: Map<string, number>): AllocationResult['metrics'] {
    const strategies = Array.from(this.strategies.values());
    const weightArray = strategies.map(s => weights.get(s.id) || 0);
    
    // Expected portfolio Sharpe
    let expectedReturn = 0;
    let expectedVolatility = 0;
    
    for (let i = 0; i < strategies.length; i++) {
      expectedReturn += weightArray[i] * strategies[i].performance.sharpeRatio * 
        strategies[i].performance.volatility;
    }
    
    // Portfolio volatility
    for (let i = 0; i < strategies.length; i++) {
      for (let j = 0; j < strategies.length; j++) {
        expectedVolatility += weightArray[i] * weightArray[j] * 
          this.correlationMatrix[i][j] * 
          strategies[i].performance.volatility * 
          strategies[j].performance.volatility;
      }
    }
    expectedVolatility = Math.sqrt(expectedVolatility);
    
    const expectedSharpe = expectedVolatility > 0 ? expectedReturn / expectedVolatility : 0;
    
    // Diversification ratio
    const weightedVolSum = strategies.reduce((sum, s, i) => 
      sum + weightArray[i] * s.performance.volatility, 0
    );
    const diversificationRatio = expectedVolatility > 0 ? weightedVolSum / expectedVolatility : 1;
    
    // Max position overlap
    const overlapMatrix = this.calculatePositionOverlap(strategies);
    let maxOverlap = 0;
    for (let i = 0; i < strategies.length; i++) {
      for (let j = i + 1; j < strategies.length; j++) {
        if (weightArray[i] > 0 && weightArray[j] > 0) {
          maxOverlap = Math.max(maxOverlap, overlapMatrix[i][j]);
        }
      }
    }
    
    return {
      expectedSharpe,
      expectedVolatility,
      diversificationRatio,
      maxPositionOverlap: maxOverlap
    };
  }
  
  private shouldTriggerRebalance(strategy: Strategy): boolean {
    // Check if performance has degraded significantly
    if (strategy.performance.sharpeRatio < strategy.constraints.minSharpe * 0.8) {
      return true;
    }
    
    if (strategy.performance.maxDrawdown > strategy.constraints.maxDrawdown * 1.2) {
      return true;
    }
    
    // Check if weight deviation is significant
    const weightDeviation = Math.abs(strategy.currentWeight - strategy.targetWeight);
    if (weightDeviation > this.optimizationConstraints.rebalanceThreshold) {
      return true;
    }
    
    return false;
  }
  
  private isRebalanceRequired(newWeights: Map<string, number>): boolean {
    if (!this.currentAllocation) return true;
    
    let totalDeviation = 0;
    
    for (const [id, newWeight] of newWeights) {
      const strategy = this.strategies.get(id);
      if (!strategy) continue;
      
      const currentWeight = strategy.currentWeight;
      totalDeviation += Math.abs(newWeight - currentWeight);
    }
    
    return totalDeviation > this.optimizationConstraints.rebalanceThreshold;
  }
  
  private async evaluateRebalance(): Promise<void> {
    if (!this.currentAllocation) return;
    
    const timeSinceLastRebalance = Date.now() - this.currentAllocation.timestamp.getTime();
    const minRebalanceInterval = 3600000; // 1 hour
    
    if (timeSinceLastRebalance < minRebalanceInterval) {
      return;
    }
    
    // Check if any strategy needs rebalancing
    let rebalanceNeeded = false;
    
    for (const strategy of this.strategies.values()) {
      if (this.shouldTriggerRebalance(strategy)) {
        rebalanceNeeded = true;
        break;
      }
    }
    
    if (rebalanceNeeded) {
      await this.optimizeAllocation();
    }
  }
  
  public getCurrentAllocation(): AllocationResult | null {
    return this.currentAllocation;
  }
  
  public getStrategyWeight(strategyId: string): number {
    return this.strategies.get(strategyId)?.currentWeight || 0;
  }
  
  public async executeRebalance(allocation: AllocationResult): Promise<void> {
    this.logger.info('Executing rebalance', {
      allocationId: allocation.id,
      strategies: allocation.strategies.size
    });
    
    // Update current weights
    for (const [strategyId, weight] of allocation.strategies) {
      const strategy = this.strategies.get(strategyId);
      if (strategy) {
        strategy.currentWeight = weight;
      }
    }
    
    this.emit('rebalance-executed', allocation);
  }
  
  public updateConstraints(constraints: Partial<OptimizationConstraints>): void {
    this.optimizationConstraints = {
      ...this.optimizationConstraints,
      ...constraints
    };
    
    this.logger.info('Constraints updated', constraints);
  }
  
  public destroy(): void {
    if (this.rebalanceInterval) {
      clearInterval(this.rebalanceInterval);
      this.rebalanceInterval = null;
    }
    
    this.logger.info('Dynamic weight allocator destroyed');
  }
} 