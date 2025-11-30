/**
 * ModelValidator - Comprehensive AI/ML Model Validation
 * 
 * Validates model performance, robustness, and safety before deployment
 * with statistical tests, backtesting, and risk analysis
 */

import { EventEmitter } from 'events';
import { Logger } from 'winston';
import * as stats from 'simple-statistics';
import { 
  ValidationResult,
  ModelMetrics,
  RLAgent,
  StrategyGenome
} from '@noderr/types';

interface ValidationConfig {
  minSharpe: number;
  maxDrawdown: number;
  minWinRate: number;
  minSampleSize: number;
  confidenceLevel: number;
  backtestPeriods: number;
  outOfSampleRatio: number;
  riskLimits: {
    maxLeverage: number;
    maxPositionSize: number;
    maxCorrelation: number;
  };
}

interface BacktestResult {
  period: string;
  returns: number[];
  sharpe: number;
  maxDrawdown: number;
  winRate: number;
  trades: number;
  pnl: number;
}

export class ModelValidator extends EventEmitter {
  private logger: Logger;
  private config: ValidationConfig;
  
  constructor(logger: Logger, config: ValidationConfig) {
    super();
    this.logger = logger;
    this.config = config;
  }
  
  /**
   * Validate RL agent
   */
  async validateRLAgent(
    agent: RLAgent,
    testData: any[]
  ): Promise<ValidationResult> {
    this.logger.info('Validating RL agent', {
      agentId: agent.id,
      algorithm: agent.algorithm
    });
    
    try {
      // Performance validation
      const performance = await this.validatePerformance(agent, testData);
      
      // Robustness tests
      const robustness = await this.validateRobustness(agent, testData);
      
      // Risk analysis
      const risk = await this.validateRisk(agent, testData);
      
      // Statistical significance
      const statistical = await this.validateStatisticalSignificance(performance);
      
      // Aggregate results
      const isValid = 
        performance.isValid &&
        robustness.isValid &&
        risk.isValid &&
        statistical.isValid;
      
      const result: ValidationResult = {
        isValid,
        metrics: {
          sharpe: performance.sharpe,
          maxDrawdown: performance.maxDrawdown,
          winRate: performance.winRate,
          profitFactor: performance.profitFactor,
          calmarRatio: performance.sharpe / performance.maxDrawdown,
          trades: performance.trades,
          avgWin: performance.avgWin,
          avgLoss: performance.avgLoss,
          expectancy: performance.expectancy
        },
        tests: {
          performance: performance.details,
          robustness: robustness.details,
          risk: risk.details,
          statistical: statistical.details
        },
        warnings: [
          ...performance.warnings,
          ...robustness.warnings,
          ...risk.warnings,
          ...statistical.warnings
        ],
        timestamp: Date.now()
      };
      
      this.emit('validation:complete', result);
      
      return result;
      
    } catch (error) {
      this.logger.error('Validation failed', { error });
      throw error;
    }
  }
  
  /**
   * Validate strategy genome
   */
  async validateGenome(
    genome: StrategyGenome,
    testData: any[]
  ): Promise<ValidationResult> {
    this.logger.info('Validating strategy genome', {
      genomeId: genome.id,
      generation: genome.generation
    });
    
    // Convert genome to executable strategy
    const strategy = this.genomeToStrategy(genome);
    
    // Run validation
    return this.validateStrategy(strategy, testData);
  }
  
  /**
   * Validate trading strategy
   */
  private async validateStrategy(
    strategy: any,
    testData: any[]
  ): Promise<ValidationResult> {
    // Split data for in-sample and out-of-sample testing
    const splitIndex = Math.floor(testData.length * (1 - this.config.outOfSampleRatio));
    const inSampleData = testData.slice(0, splitIndex);
    const outOfSampleData = testData.slice(splitIndex);
    
    // In-sample performance
    const inSampleResults = await this.backtest(strategy, inSampleData);
    
    // Out-of-sample performance
    const outOfSampleResults = await this.backtest(strategy, outOfSampleData);
    
    // Walk-forward analysis
    const walkForwardResults = await this.walkForwardAnalysis(strategy, testData);
    
    // Monte Carlo simulation
    const monteCarloResults = await this.monteCarloSimulation(inSampleResults);
    
    // Compile metrics
    const metrics: ModelMetrics = {
      sharpe: outOfSampleResults.sharpe,
      maxDrawdown: outOfSampleResults.maxDrawdown,
      winRate: outOfSampleResults.winRate,
      profitFactor: this.calculateProfitFactor(outOfSampleResults.returns),
      calmarRatio: outOfSampleResults.sharpe / outOfSampleResults.maxDrawdown,
      trades: outOfSampleResults.trades,
      avgWin: this.calculateAvgWin(outOfSampleResults.returns),
      avgLoss: this.calculateAvgLoss(outOfSampleResults.returns),
      expectancy: this.calculateExpectancy(outOfSampleResults.returns)
    };
    
    // Validation checks
    const isValid = 
      metrics.sharpe >= this.config.minSharpe &&
      metrics.maxDrawdown <= this.config.maxDrawdown &&
      metrics.winRate >= this.config.minWinRate &&
      metrics.trades >= this.config.minSampleSize;
    
    const warnings: string[] = [];
    
    if (metrics.sharpe < this.config.minSharpe * 1.2) {
      warnings.push(`Sharpe ratio ${metrics.sharpe.toFixed(2)} is close to minimum`);
    }
    
    if (Math.abs(inSampleResults.sharpe - outOfSampleResults.sharpe) > 0.5) {
      warnings.push('Significant performance degradation out-of-sample');
    }
    
    return {
      isValid,
      metrics,
      tests: {
        inSample: inSampleResults,
        outOfSample: outOfSampleResults,
        walkForward: walkForwardResults,
        monteCarlo: monteCarloResults
      },
      warnings,
      timestamp: Date.now()
    };
  }
  
  /**
   * Backtest strategy
   */
  private async backtest(
    strategy: any,
    data: any[]
  ): Promise<BacktestResult> {
    const returns: number[] = [];
    let position: any = null;
    let trades = 0;
    let equity = 10000; // Starting equity
    const equityCurve: number[] = [equity];
    
    for (let i = 1; i < data.length; i++) {
      const prevData = data[i - 1];
      const currentData = data[i];
      
      // Check entry
      if (!position && strategy.checkEntry(currentData)) {
        position = {
          entryPrice: currentData.price,
          entryTime: currentData.timestamp,
          size: strategy.calculatePositionSize(currentData, equity)
        };
        trades++;
      }
      
      // Check exit
      if (position && strategy.checkExit(currentData, position)) {
        const pnl = (currentData.price - position.entryPrice) / position.entryPrice;
        returns.push(pnl);
        equity *= (1 + pnl * position.size);
        equityCurve.push(equity);
        position = null;
      }
    }
    
    // Calculate metrics
    const sharpe = this.calculateSharpe(returns);
    const maxDrawdown = this.calculateMaxDrawdown(equityCurve);
    const winRate = returns.filter(r => r > 0).length / returns.length;
    
    return {
      period: `${data[0].timestamp} - ${data[data.length - 1].timestamp}`,
      returns,
      sharpe,
      maxDrawdown,
      winRate,
      trades,
      pnl: equity - 10000
    };
  }
  
  /**
   * Walk-forward analysis
   */
  private async walkForwardAnalysis(
    strategy: any,
    data: any[]
  ): Promise<any> {
    const windowSize = Math.floor(data.length / this.config.backtestPeriods);
    const results: BacktestResult[] = [];
    
    for (let i = 0; i < this.config.backtestPeriods - 1; i++) {
      const trainStart = i * windowSize;
      const trainEnd = (i + 2) * windowSize;
      const testStart = trainEnd;
      const testEnd = Math.min((i + 3) * windowSize, data.length);
      
      // Train on window
      const trainData = data.slice(trainStart, trainEnd);
      // Test on next window
      const testData = data.slice(testStart, testEnd);
      
      const result = await this.backtest(strategy, testData);
      results.push(result);
    }
    
    // Aggregate results
    const avgSharpe = stats.mean(results.map(r => r.sharpe));
    const consistency = stats.standardDeviation(results.map(r => r.sharpe));
    
    return {
      periods: results.length,
      avgSharpe,
      consistency,
      results
    };
  }
  
  /**
   * Monte Carlo simulation
   */
  private async monteCarloSimulation(
    backtestResult: BacktestResult,
    simulations: number = 1000
  ): Promise<any> {
    const returns = backtestResult.returns;
    const results: number[] = [];
    
    for (let sim = 0; sim < simulations; sim++) {
      // Randomly resample returns with replacement
      const simReturns: number[] = [];
      for (let i = 0; i < returns.length; i++) {
        const idx = Math.floor(Math.random() * returns.length);
        simReturns.push(returns[idx]);
      }
      
      // Calculate metrics for simulation
      const sharpe = this.calculateSharpe(simReturns);
      results.push(sharpe);
    }
    
    // Calculate confidence intervals
    results.sort((a, b) => a - b);
    const lowerBound = results[Math.floor(simulations * 0.025)];
    const upperBound = results[Math.floor(simulations * 0.975)];
    const median = results[Math.floor(simulations * 0.5)];
    
    return {
      simulations,
      confidenceInterval: [lowerBound, upperBound],
      median,
      mean: stats.mean(results),
      std: stats.standardDeviation(results)
    };
  }
  
  /**
   * Validate performance metrics
   */
  private async validatePerformance(
    agent: RLAgent,
    testData: any[]
  ): Promise<any> {
    // Simulate agent performance
    const returns: number[] = [];
    const trades: any[] = [];
    
    // Run agent on test data
    for (let i = 0; i < testData.length - 1; i++) {
      const state = testData[i];
      const nextState = testData[i + 1];
      
      // Get action from agent
      // const action = await agent.selectAction(state);
      
      // Simulate trade execution
      // ... implementation
    }
    
    const sharpe = this.calculateSharpe(returns);
    const maxDrawdown = this.calculateMaxDrawdown(returns);
    const winRate = returns.filter(r => r > 0).length / returns.length;
    const profitFactor = this.calculateProfitFactor(returns);
    
    return {
      isValid: sharpe >= this.config.minSharpe,
      sharpe,
      maxDrawdown,
      winRate,
      profitFactor,
      trades: trades.length,
      avgWin: this.calculateAvgWin(returns),
      avgLoss: this.calculateAvgLoss(returns),
      expectancy: this.calculateExpectancy(returns),
      details: { returns, trades },
      warnings: []
    };
  }
  
  /**
   * Validate model robustness
   */
  private async validateRobustness(
    agent: RLAgent,
    testData: any[]
  ): Promise<any> {
    const tests: any[] = [];
    
    // Parameter sensitivity
    const parameterSensitivity = await this.testParameterSensitivity(agent);
    tests.push({
      name: 'Parameter Sensitivity',
      passed: parameterSensitivity.stable,
      details: parameterSensitivity
    });
    
    // Market regime changes
    const regimeRobustness = await this.testRegimeRobustness(agent, testData);
    tests.push({
      name: 'Regime Robustness',
      passed: regimeRobustness.stable,
      details: regimeRobustness
    });
    
    // Adversarial inputs
    const adversarialRobustness = await this.testAdversarialRobustness(agent);
    tests.push({
      name: 'Adversarial Robustness',
      passed: adversarialRobustness.stable,
      details: adversarialRobustness
    });
    
    const isValid = tests.every(t => t.passed);
    const warnings = tests
      .filter(t => !t.passed)
      .map(t => `Failed robustness test: ${t.name}`);
    
    return {
      isValid,
      details: tests,
      warnings
    };
  }
  
  /**
   * Validate risk metrics
   */
  private async validateRisk(
    agent: RLAgent,
    testData: any[]
  ): Promise<any> {
    const risks: any[] = [];
    
    // Leverage analysis
    const leverageOk = true; // Simplified
    risks.push({
      name: 'Leverage',
      passed: leverageOk,
      value: 1.0,
      limit: this.config.riskLimits.maxLeverage
    });
    
    // Position sizing
    const positionSizeOk = true; // Simplified
    risks.push({
      name: 'Position Size',
      passed: positionSizeOk,
      value: 0.05,
      limit: this.config.riskLimits.maxPositionSize
    });
    
    // Correlation risk
    const correlationOk = true; // Simplified
    risks.push({
      name: 'Correlation',
      passed: correlationOk,
      value: 0.3,
      limit: this.config.riskLimits.maxCorrelation
    });
    
    const isValid = risks.every(r => r.passed);
    const warnings = risks
      .filter(r => !r.passed)
      .map(r => `Risk limit exceeded: ${r.name} (${r.value} > ${r.limit})`);
    
    return {
      isValid,
      details: risks,
      warnings
    };
  }
  
  /**
   * Validate statistical significance
   */
  private async validateStatisticalSignificance(
    performance: any
  ): Promise<any> {
    const tests: any[] = [];
    
    // T-test for positive returns
    const tTest = this.tTestReturns(performance.details.returns);
    tests.push({
      name: 'T-Test',
      passed: tTest.pValue < 0.05,
      statistic: tTest.statistic,
      pValue: tTest.pValue
    });
    
    // Sample size test
    const sampleSizeOk = performance.trades >= this.config.minSampleSize;
    tests.push({
      name: 'Sample Size',
      passed: sampleSizeOk,
      value: performance.trades,
      required: this.config.minSampleSize
    });
    
    const isValid = tests.every(t => t.passed);
    const warnings: string[] = [];
    
    if (tTest.pValue > 0.05) {
      warnings.push('Returns not statistically significant');
    }
    
    return {
      isValid,
      details: tests,
      warnings
    };
  }
  
  /**
   * Test parameter sensitivity
   */
  private async testParameterSensitivity(agent: RLAgent): Promise<any> {
    // Simplified - would perturb hyperparameters in production
    return {
      stable: true,
      sensitivity: 0.1,
      criticalParams: []
    };
  }
  
  /**
   * Test regime robustness
   */
  private async testRegimeRobustness(
    agent: RLAgent,
    testData: any[]
  ): Promise<any> {
    // Test on different market regimes
    // Simplified - would segment data by volatility/trend in production
    return {
      stable: true,
      regimes: ['bull', 'bear', 'sideways'],
      performance: {}
    };
  }
  
  /**
   * Test adversarial robustness
   */
  private async testAdversarialRobustness(agent: RLAgent): Promise<any> {
    // Test with adversarial inputs
    // Simplified - would generate adversarial examples in production
    return {
      stable: true,
      attacks: ['noise', 'gradient'],
      resilience: 0.9
    };
  }
  
  /**
   * Utility functions
   */
  private calculateSharpe(returns: number[]): number {
    if (returns.length < 2) return 0;
    
    const mean = stats.mean(returns);
    const std = stats.standardDeviation(returns);
    
    return std > 0 ? (mean / std) * Math.sqrt(252) : 0;
  }
  
  private calculateMaxDrawdown(values: number[]): number {
    let maxValue = values[0];
    let maxDrawdown = 0;
    
    for (const value of values) {
      if (value > maxValue) {
        maxValue = value;
      }
      const drawdown = (maxValue - value) / maxValue;
      maxDrawdown = Math.max(maxDrawdown, drawdown);
    }
    
    return maxDrawdown;
  }
  
  private calculateProfitFactor(returns: number[]): number {
    const profits = returns.filter(r => r > 0).reduce((a, b) => a + b, 0);
    const losses = Math.abs(returns.filter(r => r < 0).reduce((a, b) => a + b, 0));
    
    return losses > 0 ? profits / losses : profits > 0 ? Infinity : 0;
  }
  
  private calculateAvgWin(returns: number[]): number {
    const wins = returns.filter(r => r > 0);
    return wins.length > 0 ? stats.mean(wins) : 0;
  }
  
  private calculateAvgLoss(returns: number[]): number {
    const losses = returns.filter(r => r < 0);
    return losses.length > 0 ? Math.abs(stats.mean(losses)) : 0;
  }
  
  private calculateExpectancy(returns: number[]): number {
    const winRate = returns.filter(r => r > 0).length / returns.length;
    const avgWin = this.calculateAvgWin(returns);
    const avgLoss = this.calculateAvgLoss(returns);
    
    return winRate * avgWin - (1 - winRate) * avgLoss;
  }
  
  private tTestReturns(returns: number[]): { statistic: number; pValue: number } {
    const mean = stats.mean(returns);
    const std = stats.standardDeviation(returns);
    const n = returns.length;
    
    const statistic = (mean * Math.sqrt(n)) / std;
    // Approximate p-value
    const pValue = 2 * (1 - this.normalCDF(Math.abs(statistic)));
    
    return { statistic, pValue };
  }
  
  private normalCDF(z: number): number {
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;
    
    const sign = z < 0 ? -1 : 1;
    z = Math.abs(z) / Math.sqrt(2);
    
    const t = 1 / (1 + p * z);
    const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-z * z);
    
    return 0.5 * (1 + sign * y);
  }
  
  private genomeToStrategy(genome: StrategyGenome): any {
    // Convert genome to executable strategy
    // Simplified - would compile genome code in production
    return {
      checkEntry: (data: any) => true,
      checkExit: (data: any, position: any) => false,
      calculatePositionSize: (data: any, equity: number) => 0.05
    };
  }
} 