/**
 * PortfolioOptimizer - Elite portfolio optimization engine
 * 
 * Implements mean-variance optimization, Black-Litterman model, and
 * advanced portfolio construction techniques for institutional trading.
 */

import { EventEmitter } from 'events';
import { Logger } from 'winston';
import {
  Portfolio,
  PortfolioObjective,
  OptimizationConstraints,
  Asset,
  PortfolioMetrics,
  RiskModel
} from '../types';

interface OptimizationResult {
  weights: { [assetId: string]: number };
  expectedReturn: number;
  expectedRisk: number;
  sharpeRatio: number;
  metrics: PortfolioMetrics;
}

interface BlackLittermanInputs {
  marketCap: { [assetId: string]: number };
  views: {
    assets: string[];
    expectedReturns: number[];
    confidence: number[];
  };
  tau?: number; // Uncertainty in prior
}

interface EfficientFrontier {
  portfolios: OptimizationResult[];
  tangentPortfolio: OptimizationResult;
  minVariancePortfolio: OptimizationResult;
}

export class PortfolioOptimizer extends EventEmitter {
  private logger: Logger;
  private optimizationCache: Map<string, OptimizationResult> = new Map();
  
  constructor(logger: Logger) {
    super();
    this.logger = logger;
  }
  
  /**
   * Optimize portfolio allocation
   */
  async optimize(
    assets: Asset[],
    objective: PortfolioObjective,
    constraints: OptimizationConstraints,
    riskModel: RiskModel
  ): Promise<Portfolio> {
    this.logger.info(`Optimizing portfolio with ${assets.length} assets`);
    
    // Validate inputs
    this.validateInputs(assets, constraints);
    
    // Calculate expected returns and covariance matrix
    const { expectedReturns, covarianceMatrix } = await this.calculateRiskReturn(
      assets,
      riskModel
    );
    
    // Perform optimization based on objective
    let result: OptimizationResult;
    
    switch (objective) {
      case PortfolioObjective.MAX_SHARPE:
        result = await this.maximizeSharpe(
          assets,
          expectedReturns,
          covarianceMatrix,
          constraints
        );
        break;
        
      case PortfolioObjective.MIN_VARIANCE:
        result = await this.minimizeVariance(
          assets,
          covarianceMatrix,
          constraints
        );
        break;
        
      case PortfolioObjective.MAX_RETURN:
        result = await this.maximizeReturn(
          assets,
          expectedReturns,
          covarianceMatrix,
          constraints
        );
        break;
        
      case PortfolioObjective.RISK_PARITY:
        result = await this.riskParity(
          assets,
          covarianceMatrix,
          constraints
        );
        break;
        
      default:
        throw new Error(`Unknown objective: ${objective}`);
    }
    
    // Apply additional constraints
    result = this.applyConstraints(result, constraints);
    
    // Calculate portfolio metrics
    const metrics = this.calculateMetrics(result, assets);
    
    // Create portfolio
    const portfolio: Portfolio = {
      id: `portfolio_${Date.now()}`,
      name: `Optimized Portfolio ${new Date().toISOString()}`,
      assets: assets.map(asset => ({
        ...asset,
        weight: result.weights[asset.id] || 0
      })),
      totalValue: constraints.totalCapital || 1000000,
      metrics,
      lastRebalance: new Date(),
      constraints
    };
    
    this.emit('portfolioOptimized', portfolio);
    
    return portfolio;
  }
  
  /**
   * Black-Litterman optimization
   */
  async blackLitterman(
    assets: Asset[],
    inputs: BlackLittermanInputs,
    constraints: OptimizationConstraints
  ): Promise<Portfolio> {
    this.logger.info('Performing Black-Litterman optimization');
    
    // Calculate market-implied returns (reverse optimization)
    const marketWeights = this.calculateMarketWeights(assets, inputs.marketCap);
    const { covarianceMatrix } = await this.calculateRiskReturn(assets, 'historical');
    const marketImpliedReturns = this.reverseOptimization(
      marketWeights,
      covarianceMatrix,
      constraints.riskAversion || 2.5
    );
    
    // Incorporate views
    const { posteriorReturns, posteriorCovariance } = this.incorporateViews(
      marketImpliedReturns,
      covarianceMatrix,
      inputs.views,
      inputs.tau || 0.05
    );
    
    // Optimize with posterior estimates
    const result = await this.maximizeSharpe(
      assets,
      posteriorReturns,
      posteriorCovariance,
      constraints
    );
    
    // Create portfolio
    const metrics = this.calculateMetrics(result, assets);
    
    const portfolio: Portfolio = {
      id: `bl_portfolio_${Date.now()}`,
      name: `Black-Litterman Portfolio ${new Date().toISOString()}`,
      assets: assets.map(asset => ({
        ...asset,
        weight: result.weights[asset.id] || 0
      })),
      totalValue: constraints.totalCapital || 1000000,
      metrics,
      lastRebalance: new Date(),
      constraints
    };
    
    this.emit('blackLittermanComplete', portfolio);
    
    return portfolio;
  }
  
  /**
   * Calculate efficient frontier
   */
  async calculateEfficientFrontier(
    assets: Asset[],
    constraints: OptimizationConstraints,
    numPortfolios: number = 50
  ): Promise<EfficientFrontier> {
    this.logger.info(`Calculating efficient frontier with ${numPortfolios} portfolios`);
    
    const { expectedReturns, covarianceMatrix } = await this.calculateRiskReturn(
      assets,
      'historical'
    );
    
    // Find min and max possible returns
    const minReturn = Math.min(...expectedReturns);
    const maxReturn = Math.max(...expectedReturns);
    
    // Generate target returns
    const targetReturns: number[] = [];
    for (let i = 0; i < numPortfolios; i++) {
      targetReturns.push(minReturn + (maxReturn - minReturn) * i / (numPortfolios - 1));
    }
    
    // Calculate portfolio for each target return
    const portfolios: OptimizationResult[] = [];
    
    for (const targetReturn of targetReturns) {
      try {
        const constraintsWithTarget = {
          ...constraints,
          minReturn: targetReturn
        };
        
        const result = await this.minimizeVariance(
          assets,
          covarianceMatrix,
          constraintsWithTarget
        );
        
        portfolios.push(result);
      } catch (e) {
        // Skip infeasible portfolios
        this.logger.debug(`Skipping infeasible portfolio with target return ${targetReturn}`);
      }
    }
    
    // Find special portfolios
    const minVariancePortfolio = await this.minimizeVariance(
      assets,
      covarianceMatrix,
      constraints
    );
    
    const tangentPortfolio = await this.maximizeSharpe(
      assets,
      expectedReturns,
      covarianceMatrix,
      constraints
    );
    
    return {
      portfolios,
      tangentPortfolio,
      minVariancePortfolio
    };
  }
  
  /**
   * Validate inputs
   */
  private validateInputs(assets: Asset[], constraints: OptimizationConstraints): void {
    if (assets.length === 0) {
      throw new Error('At least one asset required');
    }
    
    // Check weight constraints
    const sumMinWeights = assets.reduce((sum, asset) => {
      const minWeight = constraints.minWeights?.[asset.id] || 0;
      return sum + minWeight;
    }, 0);
    
    if (sumMinWeights > 1) {
      throw new Error('Sum of minimum weights exceeds 100%');
    }
    
    // Check for duplicate assets
    const assetIds = new Set(assets.map(a => a.id));
    if (assetIds.size !== assets.length) {
      throw new Error('Duplicate assets detected');
    }
  }
  
  /**
   * Calculate risk and return estimates
   */
  private async calculateRiskReturn(
    assets: Asset[],
    riskModel: RiskModel | string
  ): Promise<{ expectedReturns: number[], covarianceMatrix: number[][] }> {
    // In production, would use actual historical data
    // For now, generate synthetic estimates
    
    const n = assets.length;
    const expectedReturns: number[] = [];
    const covarianceMatrix: number[][] = Array(n).fill(0).map(() => Array(n).fill(0));
    
    // Generate expected returns (annual)
    for (let i = 0; i < n; i++) {
      expectedReturns.push(0.05 + Math.random() * 0.15); // 5-20% expected return
    }
    
    // Generate covariance matrix
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) {
          // Variance (annual)
          covarianceMatrix[i][j] = Math.pow(0.15 + Math.random() * 0.25, 2);
        } else {
          // Covariance
          const correlation = -0.3 + Math.random() * 0.8; // -0.3 to 0.5 correlation
          const vol_i = Math.sqrt(covarianceMatrix[i][i] || 0.04);
          const vol_j = Math.sqrt(covarianceMatrix[j][j] || 0.04);
          covarianceMatrix[i][j] = correlation * vol_i * vol_j;
          covarianceMatrix[j][i] = covarianceMatrix[i][j];
        }
      }
    }
    
    return { expectedReturns, covarianceMatrix };
  }
  
  /**
   * Maximize Sharpe ratio
   */
  private async maximizeSharpe(
    assets: Asset[],
    expectedReturns: number[],
    covarianceMatrix: number[][],
    constraints: OptimizationConstraints
  ): Promise<OptimizationResult> {
    const n = assets.length;
    const riskFreeRate = constraints.riskFreeRate || 0.02;
    
    // Use quadratic programming to solve
    // max (w'μ - rf) / sqrt(w'Σw)
    // This is equivalent to solving a series of mean-variance problems
    
    // Binary search for optimal risk aversion parameter
    let lambdaLow = 0.01;
    let lambdaHigh = 100;
    let bestSharpe = -Infinity;
    let bestResult: OptimizationResult | null = null;
    
    for (let iter = 0; iter < 20; iter++) {
      const lambda = (lambdaLow + lambdaHigh) / 2;
      
      // Solve mean-variance problem with this risk aversion
      const weights = this.solveMeanVariance(
        expectedReturns,
        covarianceMatrix,
        lambda,
        constraints
      );
      
      // Calculate portfolio metrics
      const portfolioReturn = this.dotProduct(weights, expectedReturns);
      const portfolioVariance = this.calculatePortfolioVariance(weights, covarianceMatrix);
      const portfolioRisk = Math.sqrt(portfolioVariance);
      const sharpe = (portfolioReturn - riskFreeRate) / portfolioRisk;
      
      if (sharpe > bestSharpe) {
        bestSharpe = sharpe;
        bestResult = {
          weights: this.arrayToWeightMap(weights, assets),
          expectedReturn: portfolioReturn,
          expectedRisk: portfolioRisk,
          sharpeRatio: sharpe,
          metrics: {} as PortfolioMetrics
        };
      }
      
      // Adjust search range
      if (portfolioReturn < constraints.minReturn!) {
        lambdaHigh = lambda;
      } else {
        lambdaLow = lambda;
      }
    }
    
    if (!bestResult) {
      throw new Error('Failed to find optimal portfolio');
    }
    
    return bestResult;
  }
  
  /**
   * Minimize variance
   */
  private async minimizeVariance(
    assets: Asset[],
    covarianceMatrix: number[][],
    constraints: OptimizationConstraints
  ): Promise<OptimizationResult> {
    const n = assets.length;
    
    // Solve quadratic program: min w'Σw subject to constraints
    const weights = this.solveQuadraticProgram(
      covarianceMatrix,
      Array(n).fill(0), // No linear term for min variance
      constraints,
      assets
    );
    
    // Calculate expected return (if available)
    const expectedReturns = assets.map(a => a.expectedReturn || 0.1);
    const portfolioReturn = this.dotProduct(weights, expectedReturns);
    const portfolioVariance = this.calculatePortfolioVariance(weights, covarianceMatrix);
    const portfolioRisk = Math.sqrt(portfolioVariance);
    
    return {
      weights: this.arrayToWeightMap(weights, assets),
      expectedReturn: portfolioReturn,
      expectedRisk: portfolioRisk,
      sharpeRatio: (portfolioReturn - 0.02) / portfolioRisk,
      metrics: {} as PortfolioMetrics
    };
  }
  
  /**
   * Maximize return
   */
  private async maximizeReturn(
    assets: Asset[],
    expectedReturns: number[],
    covarianceMatrix: number[][],
    constraints: OptimizationConstraints
  ): Promise<OptimizationResult> {
    const n = assets.length;
    
    // Linear programming problem: max w'μ subject to constraints
    const weights = this.solveLinearProgram(
      expectedReturns,
      constraints,
      assets
    );
    
    const portfolioReturn = this.dotProduct(weights, expectedReturns);
    const portfolioVariance = this.calculatePortfolioVariance(weights, covarianceMatrix);
    const portfolioRisk = Math.sqrt(portfolioVariance);
    
    return {
      weights: this.arrayToWeightMap(weights, assets),
      expectedReturn: portfolioReturn,
      expectedRisk: portfolioRisk,
      sharpeRatio: (portfolioReturn - 0.02) / portfolioRisk,
      metrics: {} as PortfolioMetrics
    };
  }
  
  /**
   * Risk parity optimization
   */
  private async riskParity(
    assets: Asset[],
    covarianceMatrix: number[][],
    constraints: OptimizationConstraints
  ): Promise<OptimizationResult> {
    const n = assets.length;
    
    // Initialize with equal weights
    let weights = Array(n).fill(1 / n);
    
    // Iterative algorithm to achieve equal risk contribution
    for (let iter = 0; iter < 100; iter++) {
      // Calculate marginal risk contributions
      const marginalRisks = this.calculateMarginalRisks(weights, covarianceMatrix);
      const totalRisk = Math.sqrt(this.calculatePortfolioVariance(weights, covarianceMatrix));
      
      // Calculate risk contributions
      const riskContributions = weights.map((w, i) => w * marginalRisks[i] / totalRisk);
      
      // Update weights to equalize risk contributions
      const targetContribution = 1 / n;
      const newWeights = weights.map((w, i) => {
        const adjustment = targetContribution / riskContributions[i];
        return w * Math.pow(adjustment, 0.2); // Damped update
      });
      
      // Normalize
      const sum = newWeights.reduce((a, b) => a + b, 0);
      weights = newWeights.map(w => w / sum);
      
      // Check convergence
      const maxChange = Math.max(...weights.map((w, i) => Math.abs(w - weights[i])));
      if (maxChange < 1e-6) break;
    }
    
    // Apply constraints
    weights = this.applyWeightConstraints(weights, constraints, assets);
    
    // Calculate metrics
    const expectedReturns = assets.map(a => a.expectedReturn || 0.1);
    const portfolioReturn = this.dotProduct(weights, expectedReturns);
    const portfolioVariance = this.calculatePortfolioVariance(weights, covarianceMatrix);
    const portfolioRisk = Math.sqrt(portfolioVariance);
    
    return {
      weights: this.arrayToWeightMap(weights, assets),
      expectedReturn: portfolioReturn,
      expectedRisk: portfolioRisk,
      sharpeRatio: (portfolioReturn - 0.02) / portfolioRisk,
      metrics: {} as PortfolioMetrics
    };
  }
  
  /**
   * Apply constraints to optimization result
   */
  private applyConstraints(
    result: OptimizationResult,
    constraints: OptimizationConstraints
  ): OptimizationResult {
    const weights = { ...result.weights };
    
    // Apply turnover constraint
    if (constraints.maxTurnover && constraints.currentWeights) {
      const turnover = Object.keys(weights).reduce((sum, assetId) => {
        const currentWeight = constraints.currentWeights![assetId] || 0;
        return sum + Math.abs(weights[assetId] - currentWeight);
      }, 0);
      
      if (turnover > constraints.maxTurnover) {
        // Scale down changes proportionally
        const scale = constraints.maxTurnover / turnover;
        
        for (const assetId in weights) {
          const currentWeight = constraints.currentWeights![assetId] || 0;
          const change = weights[assetId] - currentWeight;
          weights[assetId] = currentWeight + change * scale;
        }
      }
    }
    
    return {
      ...result,
      weights
    };
  }
  
  /**
   * Calculate portfolio metrics
   */
  private calculateMetrics(
    result: OptimizationResult,
    assets: Asset[]
  ): PortfolioMetrics {
    // Calculate concentration metrics
    const weights = Object.values(result.weights);
    const sortedWeights = [...weights].sort((a, b) => b - a);
    
    const top5Concentration = sortedWeights.slice(0, 5).reduce((a, b) => a + b, 0);
    const herfindahlIndex = weights.reduce((sum, w) => sum + w * w, 0);
    
    // Calculate diversification ratio
    const assetVols = assets.map(a => a.volatility || 0.2);
    const weightedAvgVol = this.dotProduct(
      Object.values(result.weights),
      assetVols
    );
    const diversificationRatio = weightedAvgVol / result.expectedRisk;
    
    return {
      totalReturn: result.expectedReturn,
      expectedReturn: result.expectedReturn,
      expectedRisk: result.expectedRisk,
      volatility: result.expectedRisk,
      sharpeRatio: result.sharpeRatio,
      sortinoRatio: result.sharpeRatio * 1.2, // Simplified
      calmarRatio: result.expectedReturn / (result.expectedRisk * 2), // Simplified
      maxDrawdown: result.expectedRisk * 2, // Simplified estimate
      valueAtRisk95: result.expectedRisk * 1.645,
      conditionalVaR95: result.expectedRisk * 2.063,
      beta: 1, // Simplified
      alpha: result.expectedReturn - 0.08 // Simplified
    };
  }
  
  /**
   * Black-Litterman: Calculate market weights
   */
  private calculateMarketWeights(
    assets: Asset[],
    marketCap: { [assetId: string]: number }
  ): number[] {
    const totalMarketCap = Object.values(marketCap).reduce((a, b) => a + b, 0);
    
    return assets.map(asset => {
      const cap = marketCap[asset.id] || 0;
      return cap / totalMarketCap;
    });
  }
  
  /**
   * Black-Litterman: Reverse optimization
   */
  private reverseOptimization(
    marketWeights: number[],
    covarianceMatrix: number[][],
    riskAversion: number
  ): number[] {
    // π = λΣw
    return marketWeights.map((_, i) => {
      let impliedReturn = 0;
      for (let j = 0; j < marketWeights.length; j++) {
        impliedReturn += riskAversion * covarianceMatrix[i][j] * marketWeights[j];
      }
      return impliedReturn;
    });
  }
  
  /**
   * Black-Litterman: Incorporate views
   */
  private incorporateViews(
    priorReturns: number[],
    priorCovariance: number[][],
    views: BlackLittermanInputs['views'],
    tau: number
  ): { posteriorReturns: number[], posteriorCovariance: number[][] } {
    const n = priorReturns.length;
    
    // Scale prior covariance by tau
    const scaledPriorCov = priorCovariance.map(row => 
      row.map(val => val * tau)
    );
    
    // Build pick matrix P (which assets views are about)
    const P: number[][] = [];
    const viewReturns: number[] = [];
    const omega: number[][] = []; // Uncertainty in views
    
    for (let i = 0; i < views.assets.length; i++) {
      const row = Array(n).fill(0);
      const assetIndex = i; // Simplified - assume views.assets contains indices
      row[assetIndex] = 1;
      P.push(row);
      viewReturns.push(views.expectedReturns[i]);
      
      // Diagonal omega matrix
      const uncertainty = (1 - views.confidence[i]) * 0.1; // Convert confidence to uncertainty
      omega.push(Array(views.assets.length).fill(0));
      omega[i][i] = uncertainty * uncertainty;
    }
    
    // Black-Litterman formula
    // Posterior returns: μ_BL = [(τΣ)^(-1) + P'Ω^(-1)P]^(-1)[(τΣ)^(-1)π + P'Ω^(-1)Q]
    
    // For simplicity, using approximation
    const posteriorReturns = priorReturns.map((prior, i) => {
      if (i < views.assets.length && views.confidence[i] > 0.5) {
        // Blend prior and view based on confidence
        const viewWeight = views.confidence[i];
        return prior * (1 - viewWeight) + views.expectedReturns[i] * viewWeight;
      }
      return prior;
    });
    
    // Posterior covariance (simplified)
    const posteriorCovariance = priorCovariance.map(row => [...row]);
    
    return { posteriorReturns, posteriorCovariance };
  }
  
  /**
   * Solve mean-variance optimization
   */
  private solveMeanVariance(
    expectedReturns: number[],
    covarianceMatrix: number[][],
    riskAversion: number,
    constraints: OptimizationConstraints
  ): number[] {
    // Solve: max w'μ - (λ/2)w'Σw subject to constraints
    // This is equivalent to solving a quadratic program
    
    const n = expectedReturns.length;
    
    // Adjust covariance matrix by risk aversion
    const Q = covarianceMatrix.map(row => 
      row.map(val => val * riskAversion)
    );
    
    // Linear term is negative expected returns (for minimization)
    const c = expectedReturns.map(r => -r);
    
    return this.solveQuadraticProgram(Q, c, constraints);
  }
  
  /**
   * Solve quadratic programming problem
   */
  private solveQuadraticProgram(
    Q: number[][],
    c: number[],
    constraints: OptimizationConstraints,
    assets?: Asset[]
  ): number[] {
    const n = Q.length;
    
    // Simplified solver using gradient projection
    let weights = Array(n).fill(1 / n); // Start with equal weights
    const stepSize = 0.01;
    const maxIter = 1000;
    
    for (let iter = 0; iter < maxIter; iter++) {
      // Calculate gradient: ∇f = Qw + c
      const gradient = c.map((ci, i) => {
        let grad = ci;
        for (let j = 0; j < n; j++) {
          grad += Q[i][j] * weights[j];
        }
        return grad;
      });
      
      // Update weights
      const newWeights = weights.map((w, i) => w - stepSize * gradient[i]);
      
      // Project onto constraints
      weights = this.projectOntoSimplex(newWeights);
      
      // Apply additional constraints
      if (assets) {
        weights = this.applyWeightConstraints(weights, constraints, assets);
      }
      
      // Check convergence
      const change = Math.max(...weights.map((w, i) => Math.abs(w - newWeights[i])));
      if (change < 1e-6) break;
    }
    
    return weights;
  }
  
  /**
   * Solve linear programming problem
   */
  private solveLinearProgram(
    c: number[],
    constraints: OptimizationConstraints,
    assets: Asset[]
  ): number[] {
    const n = c.length;
    
    // Simple greedy approach for linear objective
    const indices = Array(n).fill(0).map((_, i) => i);
    indices.sort((i, j) => c[j] - c[i]); // Sort by return (descending)
    
    const weights = Array(n).fill(0);
    let remainingWeight = 1;
    
    // Allocate to highest return assets respecting constraints
    for (const i of indices) {
      const maxWeight = constraints.maxWeights?.[assets[i].id] || 1;
      const minWeight = constraints.minWeights?.[assets[i].id] || 0;
      
      const allocation = Math.min(remainingWeight, maxWeight - minWeight);
      weights[i] = minWeight + allocation;
      remainingWeight -= allocation;
      
      if (remainingWeight <= 0) break;
    }
    
    return weights;
  }
  
  /**
   * Project weights onto simplex (sum to 1, all non-negative)
   */
  private projectOntoSimplex(weights: number[]): number[] {
    // Sort in descending order
    const sorted = [...weights].sort((a, b) => b - a);
    
    // Find threshold
    let cumsum = 0;
    let threshold = 0;
    
    for (let i = 0; i < sorted.length; i++) {
      cumsum += sorted[i];
      if (sorted[i] + (1 - cumsum) / (i + 1) > 0) {
        threshold = (cumsum - 1) / (i + 1);
      } else {
        break;
      }
    }
    
    // Project
    return weights.map(w => Math.max(0, w - threshold));
  }
  
  /**
   * Apply weight constraints
   */
  private applyWeightConstraints(
    weights: number[],
    constraints: OptimizationConstraints,
    assets: Asset[]
  ): number[] {
    const constrainedWeights = [...weights];
    
    // Apply min/max constraints
    for (let i = 0; i < assets.length; i++) {
      const assetId = assets[i].id;
      const minWeight = constraints.minWeights?.[assetId] || 0;
      const maxWeight = constraints.maxWeights?.[assetId] || 1;
      
      constrainedWeights[i] = Math.max(minWeight, Math.min(maxWeight, constrainedWeights[i]));
    }
    
    // Renormalize
    const sum = constrainedWeights.reduce((a, b) => a + b, 0);
    return constrainedWeights.map(w => w / sum);
  }
  
  /**
   * Calculate marginal risk contributions
   */
  private calculateMarginalRisks(weights: number[], covarianceMatrix: number[][]): number[] {
    // ∂σ/∂w_i = (Σw)_i / σ
    const sigmaw = weights.map((_, i) => {
      let sum = 0;
      for (let j = 0; j < weights.length; j++) {
        sum += covarianceMatrix[i][j] * weights[j];
      }
      return sum;
    });
    
    const portfolioVol = Math.sqrt(this.calculatePortfolioVariance(weights, covarianceMatrix));
    
    return sigmaw.map(sw => sw / portfolioVol);
  }
  
  /**
   * Helper functions
   */
  private dotProduct(a: number[], b: number[]): number {
    return a.reduce((sum, val, i) => sum + val * b[i], 0);
  }
  
  private calculatePortfolioVariance(weights: number[], covarianceMatrix: number[][]): number {
    let variance = 0;
    
    for (let i = 0; i < weights.length; i++) {
      for (let j = 0; j < weights.length; j++) {
        variance += weights[i] * weights[j] * covarianceMatrix[i][j];
      }
    }
    
    return variance;
  }
  
  private arrayToWeightMap(weights: number[], assets: Asset[]): { [assetId: string]: number } {
    const weightMap: { [assetId: string]: number } = {};
    
    assets.forEach((asset, i) => {
      if (weights[i] > 1e-6) { // Ignore tiny weights
        weightMap[asset.id] = weights[i];
      }
    });
    
    return weightMap;
  }
} 