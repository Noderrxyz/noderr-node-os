/**
 * MonteCarloSimulator - Elite Monte Carlo simulation engine
 * 
 * Generates thousands of stochastic portfolio paths to assess risk,
 * confidence intervals, and tail events for robust strategy evaluation.
 */

import { EventEmitter } from 'events';
import { Logger } from 'winston';
import {
  MonteCarloConfig,
  MonteCarloResult,
  SimulationPath,
  DistributionType,
  ConfidenceInterval,
  StrategyPerformance
} from '../types';

interface RandomGenerator {
  normal(mean: number, std: number): number;
  lognormal(mean: number, std: number): number;
  studentT(df: number): number;
  gumbel(mu: number, beta: number): number;
  levy(c: number, alpha: number): number;
}

interface PathStatistics {
  mean: number;
  std: number;
  skewness: number;
  kurtosis: number;
  min: number;
  max: number;
  percentiles: { [key: string]: number };
}

export class MonteCarloSimulator extends EventEmitter {
  private logger: Logger;
  private rng: RandomGenerator;
  private simulationCache: Map<string, MonteCarloResult> = new Map();
  
  constructor(logger: Logger) {
    super();
    this.logger = logger;
    this.rng = this.createRandomGenerator();
  }
  
  /**
   * Initialize simulator
   */
  async initialize(): Promise<void> {
    this.logger.info('Initializing MonteCarloSimulator');
  }
  
  /**
   * Run Monte Carlo simulation
   */
  async simulate(config: MonteCarloConfig): Promise<MonteCarloResult> {
    this.logger.info(`Running Monte Carlo simulation with ${config.simulations} paths`);
    
    // Check cache
    const cacheKey = this.generateCacheKey(config);
    if (this.simulationCache.has(cacheKey)) {
      this.logger.info('Returning cached simulation result');
      return this.simulationCache.get(cacheKey)!;
    }
    
    // Generate simulation paths
    const paths = await this.generatePaths(config);
    
    // Calculate statistics
    const statistics = this.calculatePathStatistics(paths);
    
    // Calculate confidence intervals
    const confidenceInterval = this.calculateConfidenceIntervals(paths);
    
    // Analyze tail risks
    
    // Calculate probability of outcomes
    const probabilities = this.calculateProbabilities(paths, config);
    
    // Create result
    const result: MonteCarloResult = {
      config,
      paths,
      statistics,
      confidenceInterval,
      tailRisk,
      probabilities,
      convergenceMetrics: this.assessConvergence(paths)
    };
    
    // Cache result
    this.simulationCache.set(cacheKey, result);
    
    // Emit completion
    this.emit('simulationComplete', result);
    
    return result;
  }
  
  /**
   * Generate simulation paths
   */
  private async generatePaths(config: MonteCarloConfig): Promise<SimulationPath[]> {
    const paths: SimulationPath[] = [];
    const batchSize = 100;
    
    for (let i = 0; i < config.simulations; i += batchSize) {
      const batch = Math.min(batchSize, config.simulations - i);
      
      // Generate batch of paths in parallel
      const batchPaths = await Promise.all(
        Array(batch).fill(0).map((_, j) => this.generateSinglePath(config, i + j))
      );
      
      paths.push(...batchPaths);
      
      // Emit progress
      this.emit('progress', {
        current: i + batch,
        total: config.simulations,
        percentage: ((i + batch) / config.simulations) * 100
      });
    }
    
    return paths;
  }
  
  /**
   * Generate single simulation path
   */
  private async generateSinglePath(
    config: MonteCarloConfig,
    pathId: number
  ): Promise<SimulationPath> {
    const { strategy, parameters, timeHorizon } = config;
    
    // Initialize path
    const values: number[] = [config.initialCapital || 100000];
    const returns: number[] = [];
    const timestamps: Date[] = [new Date()];
    
    // Get historical statistics for calibration
    const historicalStats = this.getHistoricalStatistics(strategy);
    
    // Generate returns based on distribution
    for (let t = 0; t < timeHorizon; t++) {
      // Generate return based on specified distribution
      const dailyReturn = this.generateReturn(
        config.distribution || DistributionType.NORMAL,
        historicalStats,
        config.correlationMatrix,
        t
      );
      
      // Apply strategy constraints
      const constrainedReturn = this.applyConstraints(
        dailyReturn,
        strategy,
        values[values.length - 1]
      );
      
      // Calculate new portfolio value
      const newValue = values[values.length - 1] * (1 + constrainedReturn);
      
      values.push(newValue);
      returns.push(constrainedReturn);
      timestamps.push(new Date(timestamps[0].getTime() + (t + 1) * 24 * 60 * 60 * 1000));
    }
    
    // Calculate path metrics
    const metrics = this.calculatePathMetrics(values, returns);
    
    return {
      id: pathId,
      values,
      returns,
      timestamps,
      finalValue: values[values.length - 1],
      totalReturn: (values[values.length - 1] - values[0]) / values[0],
      maxDrawdown: metrics.maxDrawdown,
      sharpeRatio: metrics.sharpeRatio,
      volatility: metrics.volatility
    };
  }
  
  /**
   * Generate return based on distribution
   */
  private generateReturn(
    distribution: DistributionType,
    stats: any,
    correlationMatrix?: number[][],
    timeStep?: number
  ): number {
    const { mean, std, skew, kurtosis } = stats;
    
    switch (distribution) {
      case DistributionType.NORMAL:
        return this.rng.normal(mean, std);
        
      case DistributionType.LOGNORMAL:
        return this.rng.lognormal(mean, std);
        
      case DistributionType.STUDENT_T:
        // Degrees of freedom from excess kurtosis
        const df = kurtosis > 0 ? 6 / kurtosis + 4 : 30;
        return mean + std * this.rng.studentT(df);
        
      case DistributionType.GUMBEL:
        // For extreme value modeling
        const beta = std * Math.sqrt(6) / Math.PI;
        const mu = mean - 0.5772 * beta; // Euler-Mascheroni constant
        return this.rng.gumbel(mu, beta);
        
      case DistributionType.LEVY:
        // For heavy-tailed distributions
        const c = std / Math.sqrt(2);
        return mean + this.rng.levy(c, 1.5);
        
      case DistributionType.EMPIRICAL:
        // Bootstrap from historical returns
        return this.bootstrapReturn(stats.historicalReturns);
        
      case DistributionType.REGIME_SWITCHING:
        // Markov regime switching model
        return this.regimeSwitchingReturn(stats, timeStep || 0);
        
      default:
        return this.rng.normal(mean, std);
    }
  }
  
  /**
   * Apply strategy constraints
   */
  private applyConstraints(
    rawReturn: number,
    strategy: any,
    currentValue: number
  ): number {
    let constrainedReturn = rawReturn;
    
    // Apply leverage constraint
    if (strategy.riskManagement?.maxLeverage) {
      const maxLeverage = strategy.riskManagement.maxLeverage;
      constrainedReturn = Math.min(constrainedReturn, maxLeverage - 1);
      constrainedReturn = Math.max(constrainedReturn, -1 / maxLeverage);
    }
    
    // Apply stop loss
    if (strategy.riskManagement?.stopLoss) {
      const stopLoss = strategy.riskManagement.stopLoss;
      if (constrainedReturn < -stopLoss) {
        constrainedReturn = -stopLoss;
      }
    }
    
    // Apply volatility targeting
    if (strategy.parameters?.targetVolatility) {
      const targetVol = strategy.parameters.targetVolatility;
      const currentVol = Math.abs(rawReturn);
      if (currentVol > 0) {
        constrainedReturn *= targetVol / currentVol;
      }
    }
    
    return constrainedReturn;
  }
  
  /**
   * Calculate path metrics
   */
  private calculatePathMetrics(values: number[], returns: number[]): any {
    // Maximum drawdown
    let peak = values[0];
    let maxDrawdown = 0;
    
    for (const value of values) {
      if (value > peak) {
        peak = value;
      }
      const drawdown = (peak - value) / peak;
      maxDrawdown = Math.max(maxDrawdown, drawdown);
    }
    
    // Sharpe ratio (annualized)
    const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / returns.length;
    const volatility = Math.sqrt(variance * 252); // Annualized
    const annualizedReturn = Math.pow(1 + meanReturn, 252) - 1;
    const sharpeRatio = volatility > 0 ? (annualizedReturn - 0.02) / volatility : 0;
    
    return {
      maxDrawdown,
      sharpeRatio,
      volatility
    };
  }
  
  /**
   * Calculate path statistics
   */
  private calculatePathStatistics(paths: SimulationPath[]): PathStatistics {
    const finalValues = paths.map(p => p.finalValue);
    const returns = paths.map(p => p.totalReturn);
    
    // Basic statistics
    const mean = this.mean(finalValues);
    const std = this.standardDeviation(finalValues);
    const skewness = this.skewness(finalValues);
    const kurtosis = this.kurtosis(finalValues);
    
    // Percentiles
    const sortedValues = [...finalValues].sort((a, b) => a - b);
    const percentiles: { [key: string]: number } = {};
    
    [1, 5, 10, 25, 50, 75, 90, 95, 99].forEach(p => {
      const index = Math.floor((p / 100) * sortedValues.length);
      percentiles[`p${p}`] = sortedValues[index];
    });
    
    return {
      mean,
      std,
      skewness,
      kurtosis,
      min: Math.min(...finalValues),
      max: Math.max(...finalValues),
      percentiles
    };
  }
  
  /**
   * Calculate confidence intervals
   */
  private calculateConfidenceIntervals(paths: SimulationPath[]): ConfidenceInterval {
    const finalValues = paths.map(p => p.finalValue);
    const sortedValues = [...finalValues].sort((a, b) => a - b);
    
    const getPercentile = (p: number) => {
      const index = Math.floor((p / 100) * sortedValues.length);
      return sortedValues[index];
    };
    
    return {
      mean: this.mean(finalValues),
      median: getPercentile(50),
      p5: getPercentile(5),
      p25: getPercentile(25),
      p75: getPercentile(75),
      p95: getPercentile(95),
      p99: getPercentile(99),
      p1: getPercentile(1)
    };
  }
  
  /**
   * Analyze tail risk
   */
    const returns = paths.map(p => p.totalReturn);
    const sortedReturns = [...returns].sort((a, b) => a - b);
    
    // Value at Risk (VaR)
    const var95Index = Math.floor(0.05 * sortedReturns.length);
    const var99Index = Math.floor(0.01 * sortedReturns.length);
    
    const var95 = -sortedReturns[var95Index];
    const var99 = -sortedReturns[var99Index];
    
    // Conditional Value at Risk (CVaR)
    const cvar95Returns = sortedReturns.slice(0, var95Index);
    const cvar99Returns = sortedReturns.slice(0, var99Index);
    
    const cvar95 = cvar95Returns.length > 0
      ? -this.mean(cvar95Returns)
      : var95;
    
    const cvar99 = cvar99Returns.length > 0
      ? -this.mean(cvar99Returns)
      : var99;
    
    // Maximum drawdown statistics
    const maxDrawdowns = paths.map(p => p.maxDrawdown);
    const avgMaxDrawdown = this.mean(maxDrawdowns);
    const worstDrawdown = Math.max(...maxDrawdowns);
    
    // Tail ratio
    const positiveReturns = returns.filter(r => r > 0);
    const negativeReturns = returns.filter(r => r < 0);
    
    const avgGain = positiveReturns.length > 0 ? this.mean(positiveReturns) : 0;
    const avgLoss = negativeReturns.length > 0 ? Math.abs(this.mean(negativeReturns)) : 1;
    
    const tailRatio = avgLoss > 0 ? avgGain / avgLoss : 0;
    
    // Probability of ruin
    const ruinThreshold = config.ruinThreshold || 0.5; // 50% loss
    const ruinPaths = paths.filter(p => p.finalValue < config.initialCapital! * (1 - ruinThreshold));
    const probabilityOfRuin = ruinPaths.length / paths.length;
    
    return {
      var95,
      var99,
      cvar95,
      cvar99,
      maxDrawdown: avgMaxDrawdown,
      worstDrawdown,
      tailRatio,
      probabilityOfRuin,
      expectedShortfall: cvar95,
      stressScenarios: this.generateStressScenarios(paths)
    };
  }
  
  /**
   * Calculate probabilities
   */
  private calculateProbabilities(
    paths: SimulationPath[],
    config: MonteCarloConfig
  ): { [key: string]: number } {
    const totalPaths = paths.length;
    
    return {
      // Probability of profit
      profitability: paths.filter(p => p.totalReturn > 0).length / totalPaths,
      
      // Probability of achieving target return
      targetReturn: config.targetReturn
        ? paths.filter(p => p.totalReturn >= config.targetReturn).length / totalPaths
        : 0,
      
      // Probability of exceeding max drawdown
      maxDrawdownBreach: config.maxDrawdown
        ? paths.filter(p => p.maxDrawdown > config.maxDrawdown).length / totalPaths
        : 0,
      
      // Probability of different return ranges
      return_negative: paths.filter(p => p.totalReturn < 0).length / totalPaths,
      return_0_10: paths.filter(p => p.totalReturn >= 0 && p.totalReturn < 0.1).length / totalPaths,
      return_10_20: paths.filter(p => p.totalReturn >= 0.1 && p.totalReturn < 0.2).length / totalPaths,
      return_20_50: paths.filter(p => p.totalReturn >= 0.2 && p.totalReturn < 0.5).length / totalPaths,
      return_50_100: paths.filter(p => p.totalReturn >= 0.5 && p.totalReturn < 1).length / totalPaths,
      return_over_100: paths.filter(p => p.totalReturn >= 1).length / totalPaths
    };
  }
  
  /**
   * Assess convergence
   */
  private assessConvergence(paths: SimulationPath[]): any {
    // Check if simulation has converged by analyzing stability of statistics
    const batchSize = Math.floor(paths.length / 10);
    const means: number[] = [];
    const stds: number[] = [];
    
    for (let i = batchSize; i <= paths.length; i += batchSize) {
      const batch = paths.slice(0, i);
      const values = batch.map(p => p.finalValue);
      means.push(this.mean(values));
      stds.push(this.standardDeviation(values));
    }
    
    // Calculate stability metrics
    const meanStability = this.standardDeviation(means) / this.mean(means);
    const stdStability = this.standardDeviation(stds) / this.mean(stds);
    
    return {
      converged: meanStability < 0.01 && stdStability < 0.01,
      meanStability,
      stdStability,
      effectiveSampleSize: this.calculateEffectiveSampleSize(paths),
      autocorrelation: this.calculateAutocorrelation(paths)
    };
  }
  
  /**
   * Generate stress scenarios
   */
  private generateStressScenarios(paths: SimulationPath[]): any[] {
    // Identify paths that represent different stress scenarios
    const scenarios = [];
    
    // Worst case scenario
    const worstPath = paths.reduce((worst, path) => 
      path.finalValue < worst.finalValue ? path : worst
    );
    
    scenarios.push({
      name: 'Worst Case',
      path: worstPath,
      probability: 1 / paths.length
    });
    
    // High volatility scenario
    const highVolPaths = paths.filter(p => p.volatility > this.mean(paths.map(p => p.volatility)) + 2 * this.standardDeviation(paths.map(p => p.volatility)));
    
    if (highVolPaths.length > 0) {
      scenarios.push({
        name: 'High Volatility',
        path: highVolPaths[0],
        probability: highVolPaths.length / paths.length
      });
    }
    
    // Drawdown scenario
    const severeDrawdownPaths = paths.filter(p => p.maxDrawdown > 0.3);
    
    if (severeDrawdownPaths.length > 0) {
      scenarios.push({
        name: 'Severe Drawdown',
        path: severeDrawdownPaths[0],
        probability: severeDrawdownPaths.length / paths.length
      });
    }
    
    return scenarios;
  }
  
  /**
   * Get historical statistics
   */
  private getHistoricalStatistics(strategy: any): any {
    // In production, would load from historical data
    // For now, return reasonable defaults based on strategy type
    
    const baseStats = {
      mean: 0.0003, // 0.03% daily
      std: 0.02,    // 2% daily volatility
      skew: -0.5,   // Negative skew (crashes)
      kurtosis: 3,  // Excess kurtosis (fat tails)
      historicalReturns: []
    };
    
    // Adjust based on strategy type
    if (strategy.type === 'momentum') {
      baseStats.mean = 0.0005;
      baseStats.std = 0.025;
    } else if (strategy.type === 'mean_reversion') {
      baseStats.mean = 0.0002;
      baseStats.std = 0.015;
    } else if (strategy.type === 'arbitrage') {
      baseStats.mean = 0.0004;
      baseStats.std = 0.01;
    }
    
    return baseStats;
  }
  
  /**
   * Bootstrap return from historical data
   */
  private bootstrapReturn(historicalReturns: number[]): number {
    if (historicalReturns.length === 0) {
      return this.rng.normal(0, 0.02);
    }
    
    const index = Math.floor(Math.random() * historicalReturns.length);
    return historicalReturns[index];
  }
  
  /**
   * Regime switching return
   */
  private regimeSwitchingReturn(stats: any, timeStep: number): number {
    // Simple 2-regime model: normal and crisis
    const transitionMatrix = [
      [0.98, 0.02], // Normal to [normal, crisis]
      [0.10, 0.90]  // Crisis to [normal, crisis]
    ];
    
    // Determine current regime (simplified)
    const inCrisis = Math.random() < 0.1; // 10% chance of crisis
    
    if (inCrisis) {
      // Crisis regime: higher volatility, negative drift
      return this.rng.normal(-0.002, 0.05);
    } else {
      // Normal regime
      return this.rng.normal(stats.mean, stats.std);
    }
  }
  
  /**
   * Create random number generator
   */
  private createRandomGenerator(): RandomGenerator {
    return {
      normal: (mean: number, std: number): number => {
        // Box-Muller transform
        const u1 = Math.random();
        const u2 = Math.random();
        const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        return mean + std * z0;
      },
      
      lognormal: (mean: number, std: number): number => {
        const normal = Math.sqrt(-2 * Math.log(Math.random())) * Math.cos(2 * Math.PI * Math.random());
        return Math.exp(mean + std * normal) - 1;
      },
      
      studentT: (df: number): number => {
        // Approximate Student's t-distribution
        const normal = Math.sqrt(-2 * Math.log(Math.random())) * Math.cos(2 * Math.PI * Math.random());
        const chi2 = Array(Math.floor(df)).fill(0).reduce((sum) => {
          const n = Math.sqrt(-2 * Math.log(Math.random())) * Math.cos(2 * Math.PI * Math.random());
          return sum + n * n;
        }, 0);
        return normal / Math.sqrt(chi2 / df);
      },
      
      gumbel: (mu: number, beta: number): number => {
        const u = Math.random();
        return mu - beta * Math.log(-Math.log(u));
      },
      
      levy: (c: number, alpha: number): number => {
        // Simplified Levy distribution
        const u = Math.random();
        return c / Math.pow(u, 1 / alpha);
      }
    };
  }
  
  /**
   * Statistical helper functions
   */
  private mean(values: number[]): number {
    return values.reduce((a, b) => a + b, 0) / values.length;
  }
  
  private standardDeviation(values: number[]): number {
    const avg = this.mean(values);
    const variance = values.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / values.length;
    return Math.sqrt(variance);
  }
  
  private skewness(values: number[]): number {
    const avg = this.mean(values);
    const std = this.standardDeviation(values);
    const n = values.length;
    
    const sum = values.reduce((s, v) => s + Math.pow((v - avg) / std, 3), 0);
    return (n / ((n - 1) * (n - 2))) * sum;
  }
  
  private kurtosis(values: number[]): number {
    const avg = this.mean(values);
    const std = this.standardDeviation(values);
    const n = values.length;
    
    const sum = values.reduce((s, v) => s + Math.pow((v - avg) / std, 4), 0);
    return (n * (n + 1) / ((n - 1) * (n - 2) * (n - 3))) * sum - 3 * Math.pow(n - 1, 2) / ((n - 2) * (n - 3));
  }
  
  /**
   * Calculate effective sample size
   */
  private calculateEffectiveSampleSize(paths: SimulationPath[]): number {
    // Estimate based on autocorrelation
    const returns = paths.map(p => p.totalReturn);
    const autocorr = this.calculateAutocorrelation(paths);
    
    // Effective sample size formula
    const sumAutocorr = Object.values(autocorr).reduce((sum, ac) => sum + Math.abs(ac), 0);
    return paths.length / (1 + 2 * sumAutocorr);
  }
  
  /**
   * Calculate autocorrelation
   */
  private calculateAutocorrelation(paths: SimulationPath[]): { [key: string]: number } {
    // Simplified - in production would calculate full ACF
    return {
      lag1: 0.05,
      lag2: 0.02,
      lag5: 0.01
    };
  }
  
  /**
   * Generate cache key
   */
  private generateCacheKey(config: MonteCarloConfig): string {
    return JSON.stringify({
      strategy: config.strategy.id,
      parameters: config.parameters,
      simulations: config.simulations,
      timeHorizon: config.timeHorizon,
      distribution: config.distribution
    });
  }
  
  /**
   * Clear cache
   */
  clearCache(): void {
    this.simulationCache.clear();
    this.logger.info('Simulation cache cleared');
  }
  
  /**
   * Shutdown
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down MonteCarloSimulator');
    this.clearCache();
  }
} 