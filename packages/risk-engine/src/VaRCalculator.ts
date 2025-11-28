import {
  Portfolio,
  Position,
  PriceData,
  VaRResult,
  VaRCalculatorConfig,
  CorrelationMatrix,
  RiskTelemetryEvent,
  TelemetryClient
} from './types';
import { EventEmitter } from 'events';

/**
 * Institutional-grade Value at Risk (VaR) Calculator
 * Implements parametric, historical, and Monte Carlo VaR methodologies
 */
export class VaRCalculator extends EventEmitter {
  private config: VaRCalculatorConfig;
  private telemetry?: TelemetryClient;
  private cache: Map<string, VaRResult> = new Map();
  private cacheExpiry: number = 5 * 60 * 1000; // 5 minutes

  constructor(config: VaRCalculatorConfig, telemetry?: TelemetryClient) {
    super();
    this.config = config;
    this.telemetry = telemetry;
  }

  /**
   * Calculate VaR using the configured methodology
   */
  async calculate(portfolio: Portfolio, priceData: Map<string, PriceData[]>): Promise<VaRResult> {
    const startTime = Date.now();
    const cacheKey = this.generateCacheKey(portfolio);
    
    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp.getTime()) < this.cacheExpiry) {
      return cached;
    }

    let result: VaRResult;

    try {
      switch (this.config.methodology) {
        case 'parametric':
          result = await this.calculateParametricVaR(portfolio, priceData);
          break;
        case 'historical':
          result = await this.calculateHistoricalVaR(portfolio, priceData);
          break;
        case 'monteCarlo':
          result = await this.calculateMonteCarloVaR(portfolio, priceData);
          break;
        default:
          throw new Error(`Unknown VaR methodology: ${this.config.methodology}`);
      }

      // Calculate component and marginal VaR
      result.componentVaR = await this.calculateComponentVaR(portfolio, priceData, result);
      result.marginalVaR = await this.calculateMarginalVaR(portfolio, priceData, result);

      // Cache result
      this.cache.set(cacheKey, result);

      // Emit telemetry
      if (this.telemetry) {
        this.telemetry.track({
          eventType: 'var_calculation',
          data: {
            methodology: this.config.methodology,
            portfolioValue: portfolio.totalValue,
            varValue: result.value,
            confidence: result.confidence
          },
          duration: Date.now() - startTime,
          timestamp: new Date()
        });
      }

      this.emit('varCalculated', result);
      return result;

    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Parametric VaR (Variance-Covariance method)
   */
  async calculateParametricVaR(
    portfolio: Portfolio, 
    priceData: Map<string, PriceData[]>
  ): Promise<VaRResult> {
    // Calculate portfolio returns
    const returns = this.calculateReturns(portfolio, priceData);
    
    // Calculate portfolio volatility
    const volatility = this.calculatePortfolioVolatility(portfolio, returns);
    
    // Get z-score for confidence level
    const zScore = this.getZScore(this.config.confidenceLevel);
    
    // Calculate VaR
    const timeHorizon = 1; // 1 day
    const portfolioValue = portfolio.totalValue;
    const var_value = portfolioValue * volatility * zScore * Math.sqrt(timeHorizon);

    return {
      value: var_value,
      confidence: this.config.confidenceLevel,
      timeHorizon,
      methodology: 'parametric',
      timestamp: new Date()
    };
  }

  /**
   * Historical VaR (Historical Simulation)
   */
  async calculateHistoricalVaR(
    portfolio: Portfolio,
    priceData: Map<string, PriceData[]>
  ): Promise<VaRResult> {
    // Calculate historical portfolio returns
    const portfolioReturns = this.calculateHistoricalPortfolioReturns(portfolio, priceData);
    
    // Sort returns in ascending order
    portfolioReturns.sort((a, b) => a - b);
    
    // Find VaR at confidence level
    const percentileIndex = Math.floor((1 - this.config.confidenceLevel) * portfolioReturns.length);
    const var_percentile = portfolioReturns[percentileIndex];
    const var_value = Math.abs(portfolio.totalValue * var_percentile);

    return {
      value: var_value,
      confidence: this.config.confidenceLevel,
      timeHorizon: 1,
      methodology: 'historical',
      timestamp: new Date()
    };
  }

  /**
   * Monte Carlo VaR
   */
  async calculateMonteCarloVaR(
    portfolio: Portfolio,
    priceData: Map<string, PriceData[]>,
    simulations: number = 10000
  ): Promise<VaRResult> {
    const returns = this.calculateReturns(portfolio, priceData);
    const correlationMatrix = this.config.correlationMatrix || 
      await this.calculateCorrelationMatrix(portfolio, returns);
    
    // Run Monte Carlo simulations
    const simulatedReturns: number[] = [];
    
    for (let i = 0; i < simulations; i++) {
      const simulatedPortfolioReturn = this.simulatePortfolioReturn(
        portfolio, 
        returns, 
        correlationMatrix
      );
      simulatedReturns.push(simulatedPortfolioReturn);
    }
    
    // Sort returns and find VaR
    simulatedReturns.sort((a, b) => a - b);
    const percentileIndex = Math.floor((1 - this.config.confidenceLevel) * simulatedReturns.length);
    const var_percentile = simulatedReturns[percentileIndex];
    const var_value = Math.abs(portfolio.totalValue * var_percentile);

    return {
      value: var_value,
      confidence: this.config.confidenceLevel,
      timeHorizon: 1,
      methodology: 'monteCarlo',
      timestamp: new Date()
    };
  }

  /**
   * Calculate Conditional VaR (CVaR) or Expected Shortfall
   */
  async calculateCVaR(portfolio: Portfolio, priceData: Map<string, PriceData[]>): Promise<number> {
    const returns = this.calculateHistoricalPortfolioReturns(portfolio, priceData);
    returns.sort((a, b) => a - b);
    
    const percentileIndex = Math.floor((1 - this.config.confidenceLevel) * returns.length);
    const tailReturns = returns.slice(0, percentileIndex);
    
    const avgTailReturn = tailReturns.reduce((sum, ret) => sum + ret, 0) / tailReturns.length;
    return Math.abs(portfolio.totalValue * avgTailReturn);
  }

  /**
   * Calculate Component VaR - contribution of each position to total VaR
   */
  private async calculateComponentVaR(
    portfolio: Portfolio,
    priceData: Map<string, PriceData[]>,
    totalVaR: VaRResult
  ): Promise<Map<string, number>> {
    const componentVaR = new Map<string, number>();
    const returns = this.calculateReturns(portfolio, priceData);
    
    for (const position of portfolio.positions) {
      const positionWeight = (position.quantity * position.currentPrice) / portfolio.totalValue;
      const positionReturns = returns.get(position.symbol) || [];
      const positionVolatility = this.calculateVolatility(positionReturns);
      
      // Simplified component VaR calculation
      const component = positionWeight * positionVolatility * totalVaR.value / 
        this.calculatePortfolioVolatility(portfolio, returns);
      
      componentVaR.set(position.symbol, component);
    }
    
    return componentVaR;
  }

  /**
   * Calculate Marginal VaR - change in VaR from adding one unit of position
   */
  private async calculateMarginalVaR(
    portfolio: Portfolio,
    priceData: Map<string, PriceData[]>,
    currentVaR: VaRResult
  ): Promise<Map<string, number>> {
    const marginalVaR = new Map<string, number>();
    
    for (const position of portfolio.positions) {
      // Create portfolio with slightly increased position
      const modifiedPortfolio = this.clonePortfolio(portfolio);
      const modifiedPosition = modifiedPortfolio.positions.find(p => p.symbol === position.symbol);
      if (modifiedPosition) {
        modifiedPosition.quantity += 1;
        modifiedPortfolio.totalValue += modifiedPosition.currentPrice;
      }
      
      // Calculate new VaR
      const newVaR = await this.calculate(modifiedPortfolio, priceData);
      const marginal = newVaR.value - currentVaR.value;
      
      marginalVaR.set(position.symbol, marginal);
    }
    
    return marginalVaR;
  }

  /**
   * Helper Methods
   */
  
  private calculateReturns(
    portfolio: Portfolio, 
    priceData: Map<string, PriceData[]>
  ): Map<string, number[]> {
    const returns = new Map<string, number[]>();
    
    for (const [symbol, prices] of priceData) {
      const symbolReturns: number[] = [];
      
      for (let i = 1; i < prices.length && i <= this.config.lookbackPeriod; i++) {
        const dailyReturn = (prices[i].close - prices[i-1].close) / prices[i-1].close;
        
        // Apply exponential decay if configured
        const weight = this.config.decayFactor ? 
          Math.pow(this.config.decayFactor, prices.length - i) : 1;
        
        symbolReturns.push(dailyReturn * weight);
      }
      
      returns.set(symbol, symbolReturns);
    }
    
    return returns;
  }

  private calculateHistoricalPortfolioReturns(
    portfolio: Portfolio,
    priceData: Map<string, PriceData[]>
  ): number[] {
    const portfolioReturns: number[] = [];
    const minLength = Math.min(...Array.from(priceData.values()).map(p => p.length));
    
    for (let i = 1; i < minLength && i <= this.config.lookbackPeriod; i++) {
      let portfolioReturn = 0;
      
      for (const position of portfolio.positions) {
        const prices = priceData.get(position.symbol);
        if (prices && prices[i] && prices[i-1]) {
          const positionWeight = (position.quantity * position.currentPrice) / portfolio.totalValue;
          const dailyReturn = (prices[i].close - prices[i-1].close) / prices[i-1].close;
          portfolioReturn += positionWeight * dailyReturn;
        }
      }
      
      portfolioReturns.push(portfolioReturn);
    }
    
    return portfolioReturns;
  }

  private calculatePortfolioVolatility(
    portfolio: Portfolio,
    returns: Map<string, number[]>
  ): number {
    let portfolioVariance = 0;
    const weights: number[] = [];
    const volatilities: number[] = [];
    
    // Calculate individual volatilities and weights
    for (const position of portfolio.positions) {
      const positionReturns = returns.get(position.symbol) || [];
      const weight = (position.quantity * position.currentPrice) / portfolio.totalValue;
      const volatility = this.calculateVolatility(positionReturns);
      
      weights.push(weight);
      volatilities.push(volatility);
    }
    
    // Calculate portfolio variance (simplified without correlation)
    if (this.config.correlationMatrix) {
      // Use provided correlation matrix
      for (let i = 0; i < weights.length; i++) {
        for (let j = 0; j < weights.length; j++) {
          const correlation = this.config.correlationMatrix.matrix[i][j];
          portfolioVariance += weights[i] * weights[j] * volatilities[i] * 
            volatilities[j] * correlation;
        }
      }
    } else {
      // Assume no correlation (simplified)
      for (let i = 0; i < weights.length; i++) {
        portfolioVariance += Math.pow(weights[i] * volatilities[i], 2);
      }
    }
    
    return Math.sqrt(portfolioVariance);
  }

  private calculateVolatility(returns: number[]): number {
    if (returns.length === 0) return 0;
    
    const mean = returns.reduce((sum, ret) => sum + ret, 0) / returns.length;
    const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - mean, 2), 0) / returns.length;
    
    return Math.sqrt(variance);
  }

  private async calculateCorrelationMatrix(
    portfolio: Portfolio,
    returns: Map<string, number[]>
  ): Promise<CorrelationMatrix> {
    const assets = portfolio.positions.map(p => p.symbol);
    const matrix: number[][] = [];
    
    for (let i = 0; i < assets.length; i++) {
      matrix[i] = [];
      for (let j = 0; j < assets.length; j++) {
        if (i === j) {
          matrix[i][j] = 1;
        } else {
          const correlation = this.calculateCorrelation(
            returns.get(assets[i]) || [],
            returns.get(assets[j]) || []
          );
          matrix[i][j] = correlation;
        }
      }
    }
    
    return {
      assets,
      matrix,
      period: this.config.lookbackPeriod,
      timestamp: new Date()
    };
  }

  private calculateCorrelation(returns1: number[], returns2: number[]): number {
    if (returns1.length !== returns2.length || returns1.length === 0) return 0;
    
    const mean1 = returns1.reduce((sum, ret) => sum + ret, 0) / returns1.length;
    const mean2 = returns2.reduce((sum, ret) => sum + ret, 0) / returns2.length;
    
    let covariance = 0;
    let variance1 = 0;
    let variance2 = 0;
    
    for (let i = 0; i < returns1.length; i++) {
      const diff1 = returns1[i] - mean1;
      const diff2 = returns2[i] - mean2;
      
      covariance += diff1 * diff2;
      variance1 += diff1 * diff1;
      variance2 += diff2 * diff2;
    }
    
    const denominator = Math.sqrt(variance1 * variance2);
    return denominator === 0 ? 0 : covariance / denominator;
  }

  private simulatePortfolioReturn(
    portfolio: Portfolio,
    historicalReturns: Map<string, number[]>,
    correlationMatrix: CorrelationMatrix
  ): number {
    const assets = portfolio.positions.map(p => p.symbol);
    const choleskyMatrix = this.choleskyDecomposition(correlationMatrix.matrix);
    const randomNormals = assets.map(() => this.generateNormalRandom());
    const correlatedRandoms = this.multiplyMatrixVector(choleskyMatrix, randomNormals);
    
    let portfolioReturn = 0;
    
    for (let i = 0; i < portfolio.positions.length; i++) {
      const position = portfolio.positions[i];
      const weight = (position.quantity * position.currentPrice) / portfolio.totalValue;
      const returns = historicalReturns.get(position.symbol) || [];
      const volatility = this.calculateVolatility(returns);
      const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
      
      const simulatedReturn = mean + volatility * correlatedRandoms[i];
      portfolioReturn += weight * simulatedReturn;
    }
    
    return portfolioReturn;
  }

  private choleskyDecomposition(matrix: number[][]): number[][] {
    const n = matrix.length;
    const L: number[][] = Array(n).fill(null).map(() => Array(n).fill(0));
    
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        let sum = 0;
        
        for (let k = 0; k < j; k++) {
          sum += L[i][k] * L[j][k];
        }
        
        if (i === j) {
          L[i][j] = Math.sqrt(matrix[i][i] - sum);
        } else {
          L[i][j] = (matrix[i][j] - sum) / L[j][j];
        }
      }
    }
    
    return L;
  }

  private multiplyMatrixVector(matrix: number[][], vector: number[]): number[] {
    return matrix.map(row => 
      row.reduce((sum, val, idx) => sum + val * vector[idx], 0)
    );
  }

  private generateNormalRandom(): number {
    // Box-Muller transform for normal distribution
    const u1 = Math.random();
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  private getZScore(confidenceLevel: number): number {
    // Approximate z-scores for common confidence levels
    const zScores: { [key: number]: number } = {
      0.90: 1.282,
      0.95: 1.645,
      0.99: 2.326,
      0.995: 2.576,
      0.999: 3.090
    };
    
    return zScores[confidenceLevel] || 1.645;
  }

  private generateCacheKey(portfolio: Portfolio): string {
    const positionKeys = portfolio.positions
      .map(p => `${p.symbol}:${p.quantity}`)
      .sort()
      .join('|');
    
    return `${this.config.methodology}:${this.config.confidenceLevel}:${positionKeys}`;
  }

  private clonePortfolio(portfolio: Portfolio): Portfolio {
    return {
      ...portfolio,
      positions: portfolio.positions.map(p => ({ ...p }))
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<VaRCalculatorConfig>): void {
    this.config = { ...this.config, ...config };
    this.cache.clear(); // Clear cache when config changes
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }
} 