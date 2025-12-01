import { 
  Portfolio, 
  Position, 
  VaRConfig, 
  VaRResult, 
  VaRComponent,
  CVaRResult,
  CorrelationMatrix,
  CovarianceMatrix,
  Scenario,
  RiskEngineError,
  RiskErrorCode
} from '../types';
import * as math from 'mathjs';
import * as ss from 'simple-statistics';
import { Logger } from 'winston';

export class VaRCalculator {
  private logger: Logger;
  private historicalData: Map<string, number[]> = new Map();
  private correlationCache: Map<string, CorrelationMatrix> = new Map();

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Calculate Value at Risk using specified methodology
   */
  async calculateVaR(portfolio: Portfolio, config: VaRConfig): Promise<VaRResult> {
    this.logger.info('Calculating VaR', { 
      methodology: config.methodology, 
      confidenceLevel: config.confidenceLevel 
    });

    try {
      switch (config.methodology) {
        case 'parametric':
          return await this.calculateParametricVaR(portfolio, config);
        case 'historical':
          return await this.calculateHistoricalVaR(portfolio, config);
        case 'monteCarlo':
          return await this.calculateMonteCarloVaR(portfolio, config);
        default:
          throw new RiskEngineError(
            RiskErrorCode.CONFIGURATION_ERROR,
            `Unknown VaR methodology: ${config.methodology}`
          );
      }
    } catch (error) {
      this.logger.error('VaR calculation failed', error);
      throw error;
    }
  }

  /**
   * Parametric VaR (Variance-Covariance method)
   */
  async calculateParametricVaR(portfolio: Portfolio, config: VaRConfig): Promise<VaRResult> {
    const startTime = Date.now();
    
    // Get portfolio statistics
    const { returns, weights } = await this.getPortfolioReturns(portfolio, config.lookbackPeriod);
    const correlationMatrix = config.correlationMatrix || await this.calculateCorrelationMatrix(portfolio);
    
    // Calculate portfolio mean and standard deviation
    const meanReturns = returns.map(r => ss.mean(r));
    const stdDevs = returns.map(r => ss.standardDeviation(r));
    
    // Calculate covariance matrix
    const covarianceMatrix = this.calculateCovarianceMatrix(correlationMatrix, stdDevs);
    
    // Portfolio variance = w' * Σ * w
    const portfolioVariance = this.calculatePortfolioVariance(weights, covarianceMatrix);
    const portfolioStdDev = Math.sqrt(portfolioVariance);
    const portfolioMean = math.dot(weights, meanReturns) as number;
    
    // Z-score for confidence level
    const zScore = this.getZScore(config.confidenceLevel);
    
    // VaR = μ - z * σ * √t
    const timeHorizon = 1; // 1 day
    const varValue = portfolioMean - zScore * portfolioStdDev * Math.sqrt(timeHorizon);
    const varAmount = Math.abs(varValue * portfolio.totalValue);
    
    // Calculate component VaR
    const components = this.calculateComponentVaR(
      portfolio, 
      weights, 
      covarianceMatrix, 
      portfolioStdDev,
      zScore
    );
    
    return {
      value: varAmount,
      percentage: Math.abs(varValue),
      methodology: 'parametric',
      confidenceLevel: config.confidenceLevel,
      timeHorizon,
      components,
      timestamp: Date.now()
    };
  }

  /**
   * Historical VaR (Historical Simulation)
   */
  async calculateHistoricalVaR(portfolio: Portfolio, config: VaRConfig): Promise<VaRResult> {
    const startTime = Date.now();
    
    // Get historical returns for each position
    const historicalReturns = await this.getHistoricalReturns(portfolio, config.lookbackPeriod);
    
    // Calculate portfolio returns for each historical scenario
    const portfolioReturns: number[] = [];
    const weights = this.calculateWeights(portfolio);
    
    for (let i = 0; i < historicalReturns[0].length; i++) {
      let portfolioReturn = 0;
      for (let j = 0; j < portfolio.positions.length; j++) {
        portfolioReturn += weights[j] * historicalReturns[j][i];
      }
      portfolioReturns.push(portfolioReturn);
    }
    
    // Sort returns and find percentile
    portfolioReturns.sort((a, b) => a - b);
    const percentileIndex = Math.floor((1 - config.confidenceLevel) * portfolioReturns.length);
    const varPercentage = Math.abs(portfolioReturns[percentileIndex]);
    const varAmount = varPercentage * portfolio.totalValue;
    
    // Calculate component contributions
    const components = this.calculateHistoricalComponentVaR(
      portfolio,
      historicalReturns,
      percentileIndex
    );
    
    return {
      value: varAmount,
      percentage: varPercentage,
      methodology: 'historical',
      confidenceLevel: config.confidenceLevel,
      timeHorizon: 1,
      components,
      timestamp: Date.now()
    };
  }

  /**
   * Monte Carlo VaR
   */
  async calculateMonteCarloVaR(
    portfolio: Portfolio, 
    config: VaRConfig,
    simulations: number = 10000
  ): Promise<VaRResult> {
    const startTime = Date.now();
    
    // Get historical data for parameter estimation
    const { returns, weights } = await this.getPortfolioReturns(portfolio, config.lookbackPeriod);
    const meanReturns = returns.map(r => ss.mean(r));
    const stdDevs = returns.map(r => ss.standardDeviation(r));
    const correlationMatrix = config.correlationMatrix || await this.calculateCorrelationMatrix(portfolio);
    
    // Generate correlated random returns
    const simulatedPortfolioReturns: number[] = [];
    
    for (let sim = 0; sim < simulations; sim++) {
      const randomReturns = this.generateCorrelatedReturns(
        meanReturns,
        stdDevs,
        correlationMatrix
      );
      
      // Calculate portfolio return for this simulation
      const portfolioReturn = math.dot(weights, randomReturns) as number;
      simulatedPortfolioReturns.push(portfolioReturn);
    }
    
    // Sort and find VaR
    simulatedPortfolioReturns.sort((a, b) => a - b);
    const percentileIndex = Math.floor((1 - config.confidenceLevel) * simulations);
    const varPercentage = Math.abs(simulatedPortfolioReturns[percentileIndex]);
    const varAmount = varPercentage * portfolio.totalValue;
    
    // Calculate components using marginal VaR
    const components = await this.calculateMonteCarloComponentVaR(
      portfolio,
      config,
      simulations
    );
    
    return {
      value: varAmount,
      percentage: varPercentage,
      methodology: 'monteCarlo',
      confidenceLevel: config.confidenceLevel,
      timeHorizon: 1,
      components,
      timestamp: Date.now()
    };
  }

  /**
   * Calculate Conditional VaR (Expected Shortfall)
   */
  async calculateCVaR(portfolio: Portfolio, config: VaRConfig): Promise<CVaRResult> {
    this.logger.info('Calculating CVaR');
    
    const varResult = await this.calculateVaR(portfolio, config);
    
    // Get all scenarios worse than VaR
    const scenarios = await this.getWorstCaseScenarios(portfolio, config, varResult.percentage);
    const conditionalLosses = scenarios.map(s => s.impact);
    
    const conditionalValue = ss.mean(conditionalLosses) * portfolio.totalValue;
    const tailRisk = Math.max(...conditionalLosses) * portfolio.totalValue;
    
    return {
      ...varResult,
      conditionalValue,
      tailRisk,
      worstCaseScenarios: scenarios.slice(0, 10) // Top 10 worst scenarios
    };
  }

  /**
   * Calculate Marginal VaR - the change in portfolio VaR from a small change in position
   */
  async calculateMarginalVaR(
    portfolio: Portfolio, 
    position: Position,
    config: VaRConfig
  ): Promise<number> {
    // Calculate base VaR
    const baseVaR = await this.calculateVaR(portfolio, config);
    
    // Create portfolio with slightly increased position
    const modifiedPortfolio = { ...portfolio };
    const positionIndex = portfolio.positions.findIndex(p => p.id === position.id);
    
    if (positionIndex === -1) {
      throw new RiskEngineError(
        RiskErrorCode.CALCULATION_ERROR,
        'Position not found in portfolio'
      );
    }
    
    const deltaSize = position.size * 0.01; // 1% increase
    modifiedPortfolio.positions = [...portfolio.positions];
    modifiedPortfolio.positions[positionIndex] = {
      ...position,
      size: position.size + deltaSize
    };
    
    // Recalculate total value
    modifiedPortfolio.totalValue = portfolio.totalValue + deltaSize * position.currentPrice;
    
    // Calculate new VaR
    const newVaR = await this.calculateVaR(modifiedPortfolio, config);
    
    // Marginal VaR = (VaR_new - VaR_base) / delta
    return (newVaR.value - baseVaR.value) / (deltaSize * position.currentPrice);
  }

  // Helper methods

  private async getPortfolioReturns(
    portfolio: Portfolio, 
    lookbackDays: number
  ): Promise<{ returns: number[][], weights: number[] }> {
    const returns: number[][] = [];
    const weights: number[] = [];
    
    for (const position of portfolio.positions) {
      const positionReturns = await this.getAssetReturns(position.symbol, lookbackDays);
      returns.push(positionReturns);
      weights.push((position.size * position.currentPrice) / portfolio.totalValue);
    }
    
    return { returns, weights };
  }

  private async getAssetReturns(symbol: string, lookbackDays: number): Promise<number[]> {
    // In production, fetch from data provider
    // Mock implementation
    const returns: number[] = [];
    const baseMean = 0.0005; // 0.05% daily return
    const baseStd = 0.02; // 2% daily volatility
    
    for (let i = 0; i < lookbackDays; i++) {
      returns.push(this.generateRandomReturn(baseMean, baseStd));
    }
    
    return returns;
  }

  private async getHistoricalReturns(
    portfolio: Portfolio,
    lookbackDays: number
  ): Promise<number[][]> {
    const returns: number[][] = [];
    
    for (const position of portfolio.positions) {
      const assetReturns = await this.getAssetReturns(position.symbol, lookbackDays);
      returns.push(assetReturns);
    }
    
    return returns;
  }

  private calculateWeights(portfolio: Portfolio): number[] {
    return portfolio.positions.map(
      position => (position.size * position.currentPrice) / portfolio.totalValue
    );
  }

  private async calculateCorrelationMatrix(portfolio: Portfolio): Promise<CorrelationMatrix> {
    const symbols = portfolio.positions.map(p => p.symbol);
    const cacheKey = symbols.sort().join('-');
    
    // Check cache
    if (this.correlationCache.has(cacheKey)) {
      return this.correlationCache.get(cacheKey)!;
    }
    
    // Calculate correlations
    const returns = await Promise.all(
      symbols.map(symbol => this.getAssetReturns(symbol, 252))
    );
    
    const matrix: number[][] = [];
    for (let i = 0; i < symbols.length; i++) {
      matrix[i] = [];
      for (let j = 0; j < symbols.length; j++) {
        if (i === j) {
          matrix[i][j] = 1;
        } else {
          matrix[i][j] = ss.sampleCorrelation(returns[i], returns[j]);
        }
      }
    }
    
    const correlationMatrix: CorrelationMatrix = {
      assets: symbols,
      matrix,
      timeframe: 252,
      confidence: new Array(symbols.length).fill(0.95),
      lastUpdate: Date.now(),
      methodology: 'pearson'
    };
    
    this.correlationCache.set(cacheKey, correlationMatrix);
    return correlationMatrix;
  }

  private calculateCovarianceMatrix(
    correlation: CorrelationMatrix,
    stdDevs: number[]
  ): CovarianceMatrix {
    const n = correlation.assets.length;
    const matrix: number[][] = [];
    
    for (let i = 0; i < n; i++) {
      matrix[i] = [];
      for (let j = 0; j < n; j++) {
        matrix[i][j] = correlation.matrix[i][j] * stdDevs[i] * stdDevs[j];
      }
    }
    
    return {
      assets: correlation.assets,
      matrix,
      standardDeviations: stdDevs
    };
  }

  private calculatePortfolioVariance(
    weights: number[],
    covariance: CovarianceMatrix
  ): number {
    const n = weights.length;
    let variance = 0;
    
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        variance += weights[i] * weights[j] * covariance.matrix[i][j];
      }
    }
    
    return variance;
  }

  private getZScore(confidenceLevel: number): number {
    const zScores: Record<number, number> = {
      0.90: 1.282,
      0.95: 1.645,
      0.99: 2.326,
      0.995: 2.576
    };
    
    return zScores[confidenceLevel] || 1.645;
  }

  private calculateComponentVaR(
    portfolio: Portfolio,
    weights: number[],
    covariance: CovarianceMatrix,
    portfolioStdDev: number,
    zScore: number
  ): VaRComponent[] {
    const components: VaRComponent[] = [];
    const n = weights.length;
    
    for (let i = 0; i < n; i++) {
      const position = portfolio.positions[i];
      
      // Marginal VaR = ∂VaR/∂w_i
      let marginalVaR = 0;
      for (let j = 0; j < n; j++) {
        marginalVaR += weights[j] * covariance.matrix[i][j];
      }
      marginalVaR = (marginalVaR / portfolioStdDev) * zScore;
      
      // Component VaR = w_i * Marginal VaR
      const componentVaR = weights[i] * marginalVaR;
      
      components.push({
        asset: position.symbol,
        contribution: componentVaR,
        marginalVaR,
        componentVaR: componentVaR * portfolio.totalValue
      });
    }
    
    return components;
  }

  private calculateHistoricalComponentVaR(
    portfolio: Portfolio,
    historicalReturns: number[][],
    percentileIndex: number
  ): VaRComponent[] {
    const components: VaRComponent[] = [];
    const weights = this.calculateWeights(portfolio);
    
    for (let i = 0; i < portfolio.positions.length; i++) {
      const position = portfolio.positions[i];
      const contribution = weights[i] * historicalReturns[i][percentileIndex];
      
      components.push({
        asset: position.symbol,
        contribution: Math.abs(contribution),
        marginalVaR: Math.abs(historicalReturns[i][percentileIndex]),
        componentVaR: Math.abs(contribution * portfolio.totalValue)
      });
    }
    
    return components;
  }

  private async calculateMonteCarloComponentVaR(
    portfolio: Portfolio,
    config: VaRConfig,
    simulations: number
  ): Promise<VaRComponent[]> {
    const components: VaRComponent[] = [];
    
    for (const position of portfolio.positions) {
      const marginalVaR = await this.calculateMarginalVaR(portfolio, position, config);
      const weight = (position.size * position.currentPrice) / portfolio.totalValue;
      
      components.push({
        asset: position.symbol,
        contribution: weight * marginalVaR,
        marginalVaR,
        componentVaR: weight * marginalVaR * portfolio.totalValue
      });
    }
    
    return components;
  }

  private generateCorrelatedReturns(
    means: number[],
    stdDevs: number[],
    correlation: CorrelationMatrix
  ): number[] {
    const n = means.length;
    
    // Generate independent standard normal random variables
    const independent: number[] = [];
    for (let i = 0; i < n; i++) {
      independent.push(this.generateStandardNormal());
    }
    
    // Apply Cholesky decomposition to correlation matrix
    const cholesky = this.choleskyDecomposition(correlation.matrix);
    
    // Transform to correlated returns
    const correlated: number[] = [];
    for (let i = 0; i < n; i++) {
      let value = 0;
      for (let j = 0; j <= i; j++) {
        value += cholesky[i][j] * independent[j];
      }
      // Scale and shift to match mean and std dev
      correlated.push(means[i] + stdDevs[i] * value);
    }
    
    return correlated;
  }

  private choleskyDecomposition(matrix: number[][]): number[][] {
    const n = matrix.length;
    const L: number[][] = Array(n).fill(null).map(() => Array(n).fill(0));
    
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        let sum = 0;
        
        if (j === i) {
          for (let k = 0; k < j; k++) {
            sum += L[j][k] * L[j][k];
          }
          L[j][j] = Math.sqrt(matrix[j][j] - sum);
        } else {
          for (let k = 0; k < j; k++) {
            sum += L[i][k] * L[j][k];
          }
          L[i][j] = (matrix[i][j] - sum) / L[j][j];
        }
      }
    }
    
    return L;
  }

  private generateStandardNormal(): number {
    // Box-Muller transform
    const u1 = Math.random();
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  private generateRandomReturn(mean: number, stdDev: number): number {
    return mean + stdDev * this.generateStandardNormal();
  }

  private async getWorstCaseScenarios(
    portfolio: Portfolio,
    config: VaRConfig,
    varThreshold: number
  ): Promise<Scenario[]> {
    // Generate scenarios worse than VaR threshold
    const scenarios: Scenario[] = [];
    
    // Historical scenarios
    const historicalScenarios = [
      { name: '2008 Financial Crisis', impact: -0.45, probability: 0.02 },
      { name: 'COVID-19 Crash', impact: -0.35, probability: 0.03 },
      { name: 'Dot-com Bubble', impact: -0.40, probability: 0.02 },
      { name: 'Black Monday 1987', impact: -0.22, probability: 0.01 },
      { name: 'Flash Crash 2010', impact: -0.09, probability: 0.05 }
    ];
    
    for (const scenario of historicalScenarios) {
      if (Math.abs(scenario.impact) > varThreshold) {
        scenarios.push({
          id: `hist-${Date.now()}-${Math.random()}`,
          name: scenario.name,
          probability: scenario.probability,
          impact: scenario.impact,
          duration: 24, // hours
          affectedAssets: portfolio.positions.map(p => p.symbol),
          marketConditions: [
            {
              metric: 'volatility',
              operator: '>',
              value: 50 // VIX > 50
            }
          ] as any
        });
      }
    }
    
    return scenarios.sort((a, b) => a.impact - b.impact);
  }
} 