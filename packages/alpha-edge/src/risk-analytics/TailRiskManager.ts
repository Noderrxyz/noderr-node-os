/**
 * Advanced Tail Risk Management System
 * 

 * black swan scenarios, and sophisticated portfolio risk analytics.
 */

import { EventEmitter } from 'events';
import { number } from 'ethers';
import * as ss from 'simple-statistics';
import {
  TailRiskMetrics,
  RegimeDetection,
  PortfolioOptimization,
  DynamicHedge
} from '@noderr/types';

interface RiskConfig {
  confidenceLevels: number[]; // e.g., [0.95, 0.99, 0.999]
  lookbackPeriods: number[]; // in days
  stressTestScenarios: string[];
  rebalanceThreshold: number; // 0-1
  maxLeverage: number;
  riskBudget: number; // Maximum VaR as % of portfolio
  hedgeEfficiencyThreshold: number; // Minimum hedge effectiveness
}

interface Position {
  asset: string;
  amount: number;
  entryPrice: number;
  currentPrice: number;
  leverage: number;
  hedges: string[];
}

interface RiskFactor {
  name: string;
  sensitivity: number;
  contribution: number;
  correlation: number[][];
}

interface StressScenario {
  name: string;
  factors: Record<string, number>;
  probability: number;
  historicalFrequency: number;
}

export class TailRiskManager extends EventEmitter {
  private config: RiskConfig;
  private positions: Map<string, Position> = new Map();
  private priceHistory: Map<string, number[]> = new Map();
  private correlationMatrix: Map<string, Map<string, number>> = new Map();
  private riskFactors: Map<string, RiskFactor> = new Map();
  private currentRegime: RegimeDetection | null = null;
  private hedgePortfolio: DynamicHedge | null = null;
  
  constructor(config: Partial<RiskConfig> = {}) {
    super();
    
    this.config = {
      confidenceLevels: [0.95, 0.99, 0.999],
      lookbackPeriods: [30, 90, 252], // 1M, 3M, 1Y
      stressTestScenarios: [
        'market_crash',
        'flash_crash',
        'liquidity_crisis',
        'correlation_breakdown',
        'volatility_spike',
        'regulatory_shock'
      ],
      rebalanceThreshold: 0.05, // 5% deviation triggers rebalance
      maxLeverage: 3,
      riskBudget: 0.02, // 2% max VaR
      hedgeEfficiencyThreshold: 0.7, // 70% minimum effectiveness
      ...config
    };
    
    this.initializeRiskFactors();
    this.startRiskMonitoring();
  }

  /**
   * Initialize risk factors
   */
  private initializeRiskFactors(): void {
    // Market risk factors
    this.riskFactors.set('market_beta', {
      name: 'market_beta',
      sensitivity: 1,
      contribution: 0,
      correlation: [[1]]
    });
    
    this.riskFactors.set('volatility', {
      name: 'volatility',
      sensitivity: 0,
      contribution: 0,
      correlation: [[1]]
    });
    
    this.riskFactors.set('liquidity', {
      name: 'liquidity',
      sensitivity: 0,
      contribution: 0,
      correlation: [[1]]
    });
    
    this.riskFactors.set('credit', {
      name: 'credit',
      sensitivity: 0,
      contribution: 0,
      correlation: [[1]]
    });
    
    this.riskFactors.set('operational', {
      name: 'operational',
      sensitivity: 0,
      contribution: 0,
      correlation: [[1]]
    });
  }

  /**
   * Start continuous risk monitoring
   */
  private startRiskMonitoring(): void {
    setInterval(() => {
      this.updateRiskMetrics();
      this.detectRegimeChanges();
      this.checkRiskLimits();
    }, 60000); // Every minute
  }

  /**
   * Add position to portfolio
   */
  async addPosition(position: Position): Promise<void> {
    this.positions.set(position.asset, position);
    
    // Initialize price history if needed
    if (!this.priceHistory.has(position.asset)) {
      this.priceHistory.set(position.asset, []);
    }
    
    // Recalculate risk metrics
    await this.updateRiskMetrics();
  }

  /**
   * Update price data
   */
  async updatePrice(asset: string, price: number): Promise<void> {
    // Update position
    const position = this.positions.get(asset);
    if (position) {
      position.currentPrice = price;
    }
    
    // Update history
    const history = this.priceHistory.get(asset) || [];
    history.push(price);
    
    // Maintain rolling window (1 year max)
    if (history.length > 252 * 24) { // Hourly data
      history.shift();
    }
    
    this.priceHistory.set(asset, history);
    
    // Update correlations
    await this.updateCorrelations();
  }

  /**
   * Calculate comprehensive tail risk metrics
   */
  async calculateTailRiskMetrics(): Promise<TailRiskMetrics> {
    const returns = this.calculatePortfolioReturns();
    
    if (returns.length < 100) {
      throw new Error('Insufficient data for tail risk calculation');
    }
    
    // Value at Risk (VaR)
    const valueAtRisk = {
      confidence95: this.calculateVaR(returns, 0.95),
      confidence99: this.calculateVaR(returns, 0.99),
      confidence999: this.calculateVaR(returns, 0.999)
    };
    
    // Conditional VaR (CVaR/Expected Shortfall)
    const conditionalVaR = {
      confidence95: this.calculateCVaR(returns, 0.95),
      confidence99: this.calculateCVaR(returns, 0.99)
    };
    
    // Maximum Drawdown
    const maxDrawdown = {
      historical: this.calculateMaxDrawdown(returns),
      expected: this.calculateExpectedDrawdown(returns),
      worstCase: this.calculateWorstCaseDrawdown(returns)
    };
    
    // Stress scenarios
    const stressScenarios = await this.runStressTests();
    
    return {
      valueAtRisk,
      conditionalVaR,
      maxDrawdown,
      stressScenarios
    };
  }

  /**
   * Detect market regime changes
   */
  async detectRegimeChanges(): Promise<RegimeDetection> {
    const returns = this.calculatePortfolioReturns();
    
    if (returns.length < 50) {
      throw new Error('Insufficient data for regime detection');
    }
    
    // Calculate regime indicators
    const indicators = {
      trend: this.calculateTrendStrength(returns),
      volatility: this.calculateVolatilityRegime(returns),
      correlation: this.calculateCorrelationRegime(),
      liquidity: this.calculateLiquidityScore(),
      sentiment: this.calculateMarketSentiment()
    };
    
    // Classify regime using Hidden Markov Model (simplified)
    const regime = this.classifyRegime(indicators);
    
    // Calculate transition probabilities
    const transitionProbability = this.calculateTransitionProbabilities(regime);
    
    // Estimate regime duration
    const expectedDuration = this.estimateRegimeDuration(regime);
    
    this.currentRegime = {
      currentRegime: regime,
      confidence: this.calculateRegimeConfidence(indicators),
      transitionProbability,
      indicators,
      expectedDuration
    };
    
    // Emit regime change if different
    if (this.currentRegime.currentRegime !== regime) {
      this.emit('regime_change', this.currentRegime);
    }
    
    return this.currentRegime;
  }

  /**
   * Optimize portfolio allocation
   */
  async optimizePortfolio(): Promise<PortfolioOptimization> {
    const assets = Array.from(this.positions.keys());
    const returns = assets.map(asset => {
      const history = this.priceHistory.get(asset) || [];
      return this.calculateReturns(history);
    });
    
    // Current weights
    const totalValue = this.calculatePortfolioValue();
    const currentAllocation: Record<string, number> = {};
    
    for (const [asset, position] of this.positions) {
      const value = position.amount * position.currentPrice;
      currentAllocation[asset] = value / totalValue;
    }
    
    // Optimize using Modern Portfolio Theory
    const optimization = this.meanVarianceOptimization(assets, returns);
    
    // Apply constraints
    const constrainedOptimization = this.applyPortfolioConstraints(optimization);
    
    // Calculate metrics
    const metrics = this.calculatePortfolioMetrics(
      constrainedOptimization.weights,
      returns
    );
    
    // Calculate rebalancing cost
    const rebalancingCost = this.calculateRebalancingCost(
      currentAllocation,
      constrainedOptimization.weights
    );
    
    return {
      currentAllocation,
      optimalAllocation: constrainedOptimization.weights,
      expectedReturn: metrics.expectedReturn,
      expectedRisk: metrics.risk,
      sharpeRatio: metrics.sharpeRatio,
      diversificationRatio: this.calculateDiversificationRatio(constrainedOptimization.weights),
      concentrationRisk: this.calculateConcentrationRisk(constrainedOptimization.weights),
      rebalancingCost,
      constraints: {
        maxPosition: 0.3,
        minPosition: 0.01,
        maxSector: 0.4,
        maxCorrelation: 0.7
      }
    };
  }

  /**
   * Create dynamic hedging strategy
   */
  async createDynamicHedge(): Promise<DynamicHedge> {
    const portfolio = Array.from(this.positions.keys());
    const exposures = this.calculateExposures();
    
    // Identify hedge instruments
    const hedgeInstruments = await this.identifyOptimalHedges(exposures);
    
    // Calculate hedge ratios using minimum variance hedging
    const hedgeRatios = this.calculateHedgeRatios(exposures, hedgeInstruments);
    
    // Evaluate hedge effectiveness
    const effectiveness = this.calculateHedgeEffectiveness(hedgeInstruments, hedgeRatios);
    
    // Calculate costs
    const hedgeCosts = this.calculateHedgeCosts(hedgeInstruments, hedgeRatios);
    
    // Risk metrics with hedge
    const hedgedRisk = await this.calculateHedgedRiskMetrics(hedgeInstruments, hedgeRatios);
    
    this.hedgePortfolio = {
      portfolio,
      hedgeInstruments: hedgeInstruments.map((instrument, i) => ({
        instrument: instrument.name,
        hedge_ratio: hedgeRatios[i]!,
        cost: hedgeCosts[i]!,
        effectiveness: effectiveness[i]!
      })),
      totalCost: hedgeCosts.reduce((a, b) => a + b, 0),
      riskReduction: (1 - hedgedRisk.var / this.calculatePortfolioVaR()) * 100,
      breakEvenMove: this.calculateBreakEvenMove(hedgeCosts),
      maxLoss: hedgedRisk.maxLoss,
      rebalanceFrequency: this.calculateOptimalRebalanceFrequency()
    };
    
    return this.hedgePortfolio;
  }

  /**
   * Run stress tests
   */
  private async runStressTests(): Promise<TailRiskMetrics['stressScenarios']> {
    const scenarios: TailRiskMetrics['stressScenarios'] = [];
    
    for (const scenarioName of this.config.stressTestScenarios) {
      const scenario = this.getStressScenario(scenarioName);
      const impact = await this.calculateScenarioImpact(scenario);
      const hedgeCost = await this.calculateScenarioHedgeCost(scenario);
      
      scenarios.push({
        name: scenarioName,
        probability: scenario.probability,
        impact,
        hedgeCost
      });
    }
    
    return scenarios.sort((a, b) => b.impact - a.impact);
  }

  /**
   * Calculate VaR using historical simulation
   */
  private calculateVaR(returns: number[], confidence: number): number {
    const sorted = returns.sort((a, b) => a - b);
    const index = Math.floor((1 - confidence) * sorted.length);
    return Math.abs(sorted[index]!);
  }

  /**
   * Calculate Conditional VaR (Expected Shortfall)
   */
  private calculateCVaR(returns: number[], confidence: number): number {
    const sorted = returns.sort((a, b) => a - b);
    const varIndex = Math.floor((1 - confidence) * sorted.length);
    const tailReturns = sorted.slice(0, varIndex);
    
    return Math.abs(ss.mean(tailReturns));
  }

  /**
   * Calculate maximum drawdown
   */
  private calculateMaxDrawdown(returns: number[]): number {
    let peak = 1;
    let maxDrawdown = 0;
    let cumulativeReturn = 1;
    
    for (const ret of returns) {
      cumulativeReturn *= (1 + ret);
      if (cumulativeReturn > peak) {
        peak = cumulativeReturn;
      }
      const drawdown = (peak - cumulativeReturn) / peak;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }
    
    return maxDrawdown;
  }

  /**
   * Calculate expected drawdown using extreme value theory
   */
  private calculateExpectedDrawdown(returns: number[]): number {
    // Fit Generalized Extreme Value distribution
    const blockMaxima = this.extractBlockMaxima(returns, 20);
    const gevParams = this.fitGEV(blockMaxima);
    
    // Expected value of maximum drawdown
    return this.gevExpectedValue(gevParams);
  }

  /**
   * Calculate worst-case drawdown
   */
  private calculateWorstCaseDrawdown(returns: number[]): number {
    // Use Cornish-Fisher expansion for non-normal distributions
    const mean = ss.mean(returns);
    const std = ss.standardDeviation(returns);
    const skew = this.calculateSkewness(returns);
    const kurt = this.calculateKurtosis(returns);
    
    // 99.9% worst case with higher order moments
    const z = 3.09; // 99.9% quantile
    const cf = z + (z * z - 1) * skew / 6 + 
               (z * z * z - 3 * z) * (kurt - 3) / 24 -
               (2 * z * z * z - 5 * z) * skew * skew / 36;
    
    return Math.abs(mean - cf * std);
  }

  /**
   * Calculate portfolio returns
   */
  private calculatePortfolioReturns(): number[] {
    const portfolioValues: number[] = [];
    const minLength = Math.min(...Array.from(this.priceHistory.values()).map(h => h.length));
    
    for (let i = 0; i < minLength; i++) {
      let value = 0;
      for (const [asset, position] of this.positions) {
        const prices = this.priceHistory.get(asset)!;
        value += position.amount * prices[i]!;
      }
      portfolioValues.push(value);
    }
    
    return this.calculateReturns(portfolioValues);
  }

  /**
   * Calculate returns from price series
   */
  private calculateReturns(prices: number[]): number[] {
    const returns: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      returns.push((prices[i]! - prices[i - 1]!) / prices[i - 1]!);
    }
    return returns;
  }

  /**
   * Update correlation matrix
   */
  private async updateCorrelations(): Promise<void> {
    const assets = Array.from(this.positions.keys());
    
    for (let i = 0; i < assets.length; i++) {
      for (let j = i; j < assets.length; j++) {
        const asset1 = assets[i]!;
        const asset2 = assets[j]!;
        
        const returns1 = this.calculateReturns(this.priceHistory.get(asset1) || []);
        const returns2 = this.calculateReturns(this.priceHistory.get(asset2) || []);
        
        if (returns1.length >= 20 && returns2.length >= 20) {
          const correlation = this.calculateCorrelation(returns1, returns2);
          
          if (!this.correlationMatrix.has(asset1)) {
            this.correlationMatrix.set(asset1, new Map());
          }
          if (!this.correlationMatrix.has(asset2)) {
            this.correlationMatrix.set(asset2, new Map());
          }
          
          this.correlationMatrix.get(asset1)!.set(asset2, correlation);
          this.correlationMatrix.get(asset2)!.set(asset1, correlation);
        }
      }
    }
  }

  /**
   * Calculate correlation between two series
   */
  private calculateCorrelation(series1: number[], series2: number[]): number {
    const n = Math.min(series1.length, series2.length);
    if (n < 2) return 0;
    
    const mean1 = ss.mean(series1.slice(0, n));
    const mean2 = ss.mean(series2.slice(0, n));
    
    let cov = 0;
    let var1 = 0;
    let var2 = 0;
    
    for (let i = 0; i < n; i++) {
      const diff1 = series1[i]! - mean1;
      const diff2 = series2[i]! - mean2;
      cov += diff1 * diff2;
      var1 += diff1 * diff1;
      var2 += diff2 * diff2;
    }
    
    return cov / Math.sqrt(var1 * var2);
  }

  /**
   * Calculate skewness
   */
  private calculateSkewness(returns: number[]): number {
    const mean = ss.mean(returns);
    const std = ss.standardDeviation(returns);
    const n = returns.length;
    
    let sum = 0;
    for (const ret of returns) {
      sum += Math.pow((ret - mean) / std, 3);
    }
    
    return (n / ((n - 1) * (n - 2))) * sum;
  }

  /**
   * Calculate kurtosis
   */
  private calculateKurtosis(returns: number[]): number {
    const mean = ss.mean(returns);
    const std = ss.standardDeviation(returns);
    const n = returns.length;
    
    let sum = 0;
    for (const ret of returns) {
      sum += Math.pow((ret - mean) / std, 4);
    }
    
    return (n * (n + 1) / ((n - 1) * (n - 2) * (n - 3))) * sum - 
           (3 * (n - 1) * (n - 1)) / ((n - 2) * (n - 3));
  }

  /**
   * Mean-variance optimization
   */
  private meanVarianceOptimization(
    assets: string[],
    returns: number[][]
  ): { weights: Record<string, number>; return: number; risk: number } {
    // Simplified Markowitz optimization
    // In production, use quadratic programming solver
    
    const n = assets.length;
    const means = returns.map(r => ss.mean(r));
    const covMatrix = this.calculateCovarianceMatrix(returns);
    
    // Equal weight as starting point
    const weights = new Array(n).fill(1 / n);
    
    // Gradient descent optimization (simplified)
    const learningRate = 0.01;
    const iterations = 1000;
    
    for (let iter = 0; iter < iterations; iter++) {
      // Calculate portfolio return and risk
      let portfolioReturn = 0;
      let portfolioVariance = 0;
      
      for (let i = 0; i < n; i++) {
        portfolioReturn += weights[i]! * means[i]!;
        for (let j = 0; j < n; j++) {
          portfolioVariance += weights[i]! * weights[j]! * covMatrix[i]![j]!;
        }
      }
      
      // Update weights (maximize Sharpe ratio)
      for (let i = 0; i < n; i++) {
        const gradient = means[i]! - 2 * weights.reduce((sum, w, j) => 
          sum + w * covMatrix[i]![j]!, 0
        );
        weights[i] = Math.max(0, weights[i]! + learningRate * gradient);
      }
      
      // Normalize
      const sum = weights.reduce((a, b) => a + b, 0);
      for (let i = 0; i < n; i++) {
        weights[i] = weights[i]! / sum;
      }
    }
    
    // Convert to object
    const weightMap: Record<string, number> = {};
    assets.forEach((asset, i) => {
      weightMap[asset] = weights[i]!;
    });
    
    return {
      weights: weightMap,
      return: means.reduce((sum, mean, i) => sum + mean * weights[i]!, 0),
      risk: Math.sqrt(this.calculatePortfolioVariance(weights, covMatrix))
    };
  }

  /**
   * Calculate covariance matrix
   */
  private calculateCovarianceMatrix(returns: number[][]): number[][] {
    const n = returns.length;
    const matrix: number[][] = [];
    
    for (let i = 0; i < n; i++) {
      matrix[i] = [];
      for (let j = 0; j < n; j++) {
        const cov = this.calculateCovariance(returns[i]!, returns[j]!);
        matrix[i]![j] = cov;
      }
    }
    
    return matrix;
  }

  /**
   * Calculate covariance
   */
  private calculateCovariance(returns1: number[], returns2: number[]): number {
    const n = Math.min(returns1.length, returns2.length);
    const mean1 = ss.mean(returns1.slice(0, n));
    const mean2 = ss.mean(returns2.slice(0, n));
    
    let cov = 0;
    for (let i = 0; i < n; i++) {
      cov += (returns1[i]! - mean1) * (returns2[i]! - mean2);
    }
    
    return cov / (n - 1);
  }

  /**
   * Calculate portfolio variance
   */
  private calculatePortfolioVariance(weights: number[], covMatrix: number[][]): number {
    let variance = 0;
    const n = weights.length;
    
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        variance += weights[i]! * weights[j]! * covMatrix[i]![j]!;
      }
    }
    
    return variance;
  }

  /**
   * Update risk metrics
   */
  private async updateRiskMetrics(): Promise<void> {
    try {
      const metrics = await this.calculateTailRiskMetrics();
      this.emit('risk_update', metrics);
      
      // Check if rebalancing needed
      if (this.shouldRebalance()) {
        const optimization = await this.optimizePortfolio();
        this.emit('rebalance_signal', optimization);
      }
    } catch (error) {
      this.emit('risk_error', error);
    }
  }

  /**
   * Check if rebalancing is needed
   */
  private shouldRebalance(): boolean {
    // Implement rebalancing logic based on drift from target
    const optimization = this.getLastOptimization();
    if (!optimization) return false;
    
    let maxDeviation = 0;
    for (const [asset, targetWeight] of Object.entries(optimization.optimalAllocation)) {
      const currentWeight = this.getCurrentWeight(asset);
      const deviation = Math.abs(currentWeight - targetWeight);
      maxDeviation = Math.max(maxDeviation, deviation);
    }
    
    return maxDeviation > this.config.rebalanceThreshold;
  }

  /**
   * Calculate diversification ratio
   */
  private calculateDiversificationRatio(weights: Record<string, number>): number {
    const assets = Object.keys(weights);
    const n = assets.length;
    
    // Calculate weighted average volatility
    let weightedVol = 0;
    const vols: number[] = [];
    
    for (const asset of assets) {
      const returns = this.calculateReturns(this.priceHistory.get(asset) || []);
      const vol = ss.standardDeviation(returns);
      vols.push(vol);
      weightedVol += weights[asset]! * vol;
    }
    
    // Calculate portfolio volatility
    const portfolioVol = this.calculatePortfolioVolatility(weights);
    
    return weightedVol / portfolioVol;
  }

  /**
   * Calculate concentration risk (Herfindahl index)
   */
  private calculateConcentrationRisk(weights: Record<string, number>): number {
    return Object.values(weights).reduce((sum, w) => sum + w * w, 0);
  }

  /**
   * Helper methods implementations...
   */
  
  private calculatePortfolioValue(): number {
    let value = 0;
    for (const [_, position] of this.positions) {
      value += position.amount * position.currentPrice;
    }
    return value;
  }

  private getCurrentWeight(asset: string): number {
    const position = this.positions.get(asset);
    if (!position) return 0;
    
    const assetValue = position.amount * position.currentPrice;
    const totalValue = this.calculatePortfolioValue();
    
    return assetValue / totalValue;
  }

  private getLastOptimization(): PortfolioOptimization | null {
    // Placeholder - would retrieve from storage
    return null;
  }

  private calculatePortfolioVolatility(weights: Record<string, number>): number {
    const assets = Object.keys(weights);
    const returns = assets.map(asset => 
      this.calculateReturns(this.priceHistory.get(asset) || [])
    );
    
    const covMatrix = this.calculateCovarianceMatrix(returns);
    const weightArray = assets.map(asset => weights[asset]!);
    
    return Math.sqrt(this.calculatePortfolioVariance(weightArray, covMatrix));
  }

  // Additional helper methods would be implemented here...
  
  private extractBlockMaxima(returns: number[], blockSize: number): number[] {
    const maxima: number[] = [];
    for (let i = 0; i < returns.length; i += blockSize) {
      const block = returns.slice(i, i + blockSize);
      if (block.length > 0) {
        maxima.push(Math.max(...block.map(Math.abs)));
      }
    }
    return maxima;
  }

  private fitGEV(data: number[]): { xi: number; mu: number; sigma: number } {
    // Simplified GEV fitting - in production use MLE
    return {
      xi: 0.1, // Shape parameter
      mu: ss.mean(data), // Location
      sigma: ss.standardDeviation(data) // Scale
    };
  }

  private gevExpectedValue(params: { xi: number; mu: number; sigma: number }): number {
    const { xi, mu, sigma } = params;
    if (xi >= 1) return Infinity;
    if (xi === 0) return mu + sigma * 0.5772; // Euler's constant
    return mu + sigma * (this.gamma(1 - xi) - 1) / xi;
  }

  private gamma(x: number): number {
    // Simplified gamma function
    return Math.sqrt(2 * Math.PI / x) * Math.pow(x / Math.E, x);
  }

  private calculateTrendStrength(returns: number[]): number {
    // Moving average crossover strength
    const ma20 = ss.mean(returns.slice(-20));
    const ma50 = ss.mean(returns.slice(-50));
    return (ma20 - ma50) / Math.abs(ma50);
  }

  private calculateVolatilityRegime(returns: number[]): number {
    const recentVol = ss.standardDeviation(returns.slice(-20));
    const historicalVol = ss.standardDeviation(returns);
    return recentVol / historicalVol;
  }

  private calculateCorrelationRegime(): number {
    // Average pairwise correlation
    let totalCorr = 0;
    let count = 0;
    
    for (const [asset1, corrMap] of this.correlationMatrix) {
      for (const [asset2, corr] of corrMap) {
        if (asset1 !== asset2) {
          totalCorr += Math.abs(corr);
          count++;
        }
      }
    }
    
    return count > 0 ? totalCorr / count : 0;
  }

  private calculateLiquidityScore(): number {
    // Placeholder - would use actual market depth data
    return 0.7;
  }

  private calculateMarketSentiment(): number {
    // Placeholder - would use sentiment indicators
    return 0.5;
  }

  private classifyRegime(indicators: RegimeDetection['indicators']): RegimeDetection['currentRegime'] {
    const { trend, volatility, correlation } = indicators;
    
    if (volatility > 2 && correlation > 0.8) return 'crisis';
    if (volatility > 1.5) return 'volatile';
    if (trend > 0.1 && volatility < 1.2) return 'bull';
    if (trend < -0.1 && volatility < 1.2) return 'bear';
    return 'sideways';
  }

  private calculateRegimeConfidence(indicators: RegimeDetection['indicators']): number {
    // Confidence based on indicator strength
    const strengths = Object.values(indicators).map(Math.abs);
    return Math.min(...strengths);
  }

  private calculateTransitionProbabilities(
    currentRegime: RegimeDetection['currentRegime']
  ): RegimeDetection['transitionProbability'] {
    // Simplified transition matrix
    const transitions = {
      bull: { toBull: 0.7, toBear: 0.1, toSideways: 0.15, toVolatile: 0.05, toCrisis: 0 },
      bear: { toBull: 0.1, toBear: 0.7, toSideways: 0.15, toVolatile: 0.05, toCrisis: 0 },
      sideways: { toBull: 0.3, toBear: 0.3, toSideways: 0.3, toVolatile: 0.1, toCrisis: 0 },
      volatile: { toBull: 0.2, toBear: 0.2, toSideways: 0.2, toVolatile: 0.3, toCrisis: 0.1 },
      crisis: { toBull: 0.05, toBear: 0.3, toSideways: 0.1, toVolatile: 0.4, toCrisis: 0.15 }
    };
    
    return transitions[currentRegime];
  }

  private estimateRegimeDuration(regime: RegimeDetection['currentRegime']): number {
    // Average duration in hours
    const durations = {
      bull: 720, // 30 days
      bear: 480, // 20 days
      sideways: 360, // 15 days
      volatile: 168, // 7 days
      crisis: 72 // 3 days
    };
    
    return durations[regime];
  }

  private getStressScenario(name: string): StressScenario {
    const scenarios: Record<string, StressScenario> = {
      market_crash: {
        name: 'market_crash',
        factors: { market: -0.3, volatility: 3, liquidity: -0.5 },
        probability: 0.05,
        historicalFrequency: 0.02
      },
      flash_crash: {
        name: 'flash_crash',
        factors: { market: -0.1, volatility: 5, liquidity: -0.8 },
        probability: 0.01,
        historicalFrequency: 0.005
      },
      liquidity_crisis: {
        name: 'liquidity_crisis',
        factors: { market: -0.05, volatility: 2, liquidity: -0.9 },
        probability: 0.03,
        historicalFrequency: 0.01
      },
      correlation_breakdown: {
        name: 'correlation_breakdown',
        factors: { market: 0, volatility: 1.5, correlation: -0.8 },
        probability: 0.1,
        historicalFrequency: 0.05
      },
      volatility_spike: {
        name: 'volatility_spike',
        factors: { market: -0.02, volatility: 4, liquidity: -0.2 },
        probability: 0.15,
        historicalFrequency: 0.1
      },
      regulatory_shock: {
        name: 'regulatory_shock',
        factors: { market: -0.15, volatility: 2, liquidity: -0.3 },
        probability: 0.02,
        historicalFrequency: 0.01
      }
    };
    
    return scenarios[name] || scenarios.market_crash!;
  }

  private async calculateScenarioImpact(scenario: StressScenario): Promise<number> {
    let impact = 0;
    const portfolioValue = this.calculatePortfolioValue();
    
    for (const [factor, change] of Object.entries(scenario.factors)) {
      const factorImpact = this.calculateFactorImpact(factor, change);
      impact += factorImpact;
    }
    
    return impact * portfolioValue;
  }

  private calculateFactorImpact(factor: string, change: number): number {
    // Simplified factor model
    const sensitivities = {
      market: 1,
      volatility: -0.2,
      liquidity: -0.1,
      correlation: -0.05
    };
    
    return (sensitivities[factor as keyof typeof sensitivities] || 0) * change;
  }

  private async calculateScenarioHedgeCost(scenario: StressScenario): Promise<number> {
    // Estimate cost of hedging against scenario
    const impact = await this.calculateScenarioImpact(scenario);
    const hedgeEfficiency = 0.8; // 80% hedge effectiveness
    
    // Option pricing for tail hedge
    const volatility = scenario.factors.volatility || 1;
    const timeToExpiry = 0.25; // 3 months
    const hedgeCost = Math.abs(impact) * 0.02 * volatility * Math.sqrt(timeToExpiry);
    
    return hedgeCost / hedgeEfficiency;
  }

  private applyPortfolioConstraints(
    optimization: ReturnType<typeof this.meanVarianceOptimization>
  ): typeof optimization {
    const { weights } = optimization;
    const constrained = { ...weights };
    
    // Apply position limits
    for (const [asset, weight] of Object.entries(constrained)) {
      constrained[asset] = Math.max(0.01, Math.min(0.3, weight));
    }
    
    // Normalize
    const sum = Object.values(constrained).reduce((a, b) => a + b, 0);
    for (const asset of Object.keys(constrained)) {
      constrained[asset] = constrained[asset]! / sum;
    }
    
    return { ...optimization, weights: constrained };
  }

  private calculatePortfolioMetrics(
    weights: Record<string, number>,
    returns: number[][]
  ): { expectedReturn: number; risk: number; sharpeRatio: number } {
    const assets = Object.keys(weights);
    const weightArray = assets.map(a => weights[a]!);
    
    // Expected return
    const expectedReturns = returns.map(r => ss.mean(r));
    const portfolioReturn = weightArray.reduce((sum, w, i) => 
      sum + w * expectedReturns[i]!, 0
    );
    
    // Risk
    const covMatrix = this.calculateCovarianceMatrix(returns);
    const portfolioVariance = this.calculatePortfolioVariance(weightArray, covMatrix);
    const portfolioRisk = Math.sqrt(portfolioVariance);
    
    // Sharpe ratio (assuming 0 risk-free rate)
    const sharpeRatio = portfolioReturn / portfolioRisk;
    
    return {
      expectedReturn: portfolioReturn,
      risk: portfolioRisk,
      sharpeRatio
    };
  }

  private calculateRebalancingCost(
    current: Record<string, number>,
    target: Record<string, number>
  ): number {
    let totalTurnover = 0;
    
    for (const asset of Object.keys({ ...current, ...target })) {
      const currentWeight = current[asset] || 0;
      const targetWeight = target[asset] || 0;
      totalTurnover += Math.abs(targetWeight - currentWeight);
    }
    
    // Assume 10 bps transaction cost
    return totalTurnover * 0.001;
  }

  private calculateExposures(): any[] {
    // Calculate factor exposures for portfolio
    return [];
  }

  private async identifyOptimalHedges(exposures: any[]): Promise<any[]> {
    // Identify best hedging instruments
    return [];
  }

  private calculateHedgeRatios(exposures: any[], instruments: any[]): number[] {
    // Calculate optimal hedge ratios
    return instruments.map(() => 0.5);
  }

  private calculateHedgeEffectiveness(instruments: any[], ratios: number[]): number[] {
    // Calculate effectiveness of each hedge
    return ratios.map(r => Math.min(0.95, 0.7 + r * 0.2));
  }

  private calculateHedgeCosts(instruments: any[], ratios: number[]): number[] {
    // Calculate cost of each hedge
    return ratios.map(r => r * 0.01);
  }

  private async calculateHedgedRiskMetrics(
    instruments: any[],
    ratios: number[]
  ): Promise<{ var: number; maxLoss: number }> {
    // Calculate risk metrics with hedges
    return {
      var: this.calculatePortfolioVaR() * 0.6,
      maxLoss: this.calculatePortfolioVaR() * 2
    };
  }

  private calculatePortfolioVaR(): number {
    const returns = this.calculatePortfolioReturns();
    return this.calculateVaR(returns, 0.95);
  }

  private calculateBreakEvenMove(costs: number[]): number {
    const totalCost = costs.reduce((a, b) => a + b, 0);
    const portfolioValue = this.calculatePortfolioValue();
    return totalCost / portfolioValue;
  }

  private calculateOptimalRebalanceFrequency(): number {
    // Daily rebalancing for now
    return 24;
  }

  private checkRiskLimits(): void {
    const currentVaR = this.calculatePortfolioVaR();
    const portfolioValue = this.calculatePortfolioValue();
    const varPercent = currentVaR / portfolioValue;
    
    if (varPercent > this.config.riskBudget) {
      this.emit('risk_limit_breach', {
        metric: 'VaR',
        current: varPercent,
        limit: this.config.riskBudget
      });
    }
    
    // Check leverage
    const totalLeverage = Array.from(this.positions.values())
      .reduce((sum, pos) => sum + pos.leverage, 0);
    
    if (totalLeverage > this.config.maxLeverage) {
      this.emit('risk_limit_breach', {
        metric: 'leverage',
        current: totalLeverage,
        limit: this.config.maxLeverage
      });
    }
  }
} 