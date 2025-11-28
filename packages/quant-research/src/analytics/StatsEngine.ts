/**
 * StatsEngine - Advanced statistical calculations for quantitative research
 * 
 * Provides comprehensive statistical analysis, risk metrics calculation,
 * and performance attribution for trading strategies.
 */

import { Logger } from 'winston';
import {
  BacktestResult,
  RiskMetrics,
  StrategyPerformance
} from '@noderr/types';

export class StatsEngine {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Calculate comprehensive risk metrics for backtest results
   */
  async calculateRiskMetrics(result: BacktestResult): Promise<RiskMetrics> {
    const equity = result.equityCurve || [];
    const trades = result.trades || [];
    
    if (equity.length === 0) {
      return this.getDefaultRiskMetrics();
    }

    // Calculate returns
    const returns = this.calculateReturns(equity);
    
    // Basic metrics
    const totalReturn = this.calculateTotalReturn(equity);
    const annualizedReturn = this.annualizeReturn(totalReturn, equity.length);
    const volatility = this.calculateVolatility(returns);
    const annualizedVolatility = this.annualizeVolatility(volatility);
    
    // Risk-adjusted metrics
    const sharpeRatio = this.calculateSharpeRatio(annualizedReturn, annualizedVolatility);
    const sortinoRatio = this.calculateSortinoRatio(returns);
    const calmarRatio = this.calculateCalmarRatio(annualizedReturn, this.calculateMaxDrawdown(equity));
    
    // Drawdown analysis
    const maxDrawdown = this.calculateMaxDrawdown(equity);
    const avgDrawdown = this.calculateAverageDrawdown(equity);
    const maxDrawdownDuration = this.calculateMaxDrawdownDuration(equity);
    
    // Trade statistics
    const winRate = this.calculateWinRate(trades);
    const profitFactor = this.calculateProfitFactor(trades);
    const payoffRatio = this.calculatePayoffRatio(trades);
    
    // Advanced metrics
    const informationRatio = this.calculateInformationRatio(returns);
    const beta = this.calculateBeta(returns);
    const alpha = this.calculateAlpha(returns, beta);
    const treynorRatio = this.calculateTreynorRatio(annualizedReturn, beta);
    
    // Risk metrics
    const var95 = this.calculateVaR(returns, 0.95);
    const var99 = this.calculateVaR(returns, 0.99);
    const cvar95 = this.calculateCVaR(returns, 0.95);
    const cvar99 = this.calculateCVaR(returns, 0.99);
    const maxLoss = Math.min(...returns);
    
    // Trading efficiency
    const avgTradesPerDay = this.calculateAvgTradesPerDay(trades);
    const avgHoldingPeriod = this.calculateAvgHoldingPeriod(trades);
    const turnover = this.calculateTurnover(trades, result.initialCapital);
    
    return {
      totalReturn,
      annualizedReturn,
      volatility: annualizedVolatility,
      sharpeRatio,
      sortinoRatio,
      calmarRatio,
      maxDrawdown,
      avgDrawdown,
      maxDrawdownDuration,
      winRate,
      profitFactor,
      payoffRatio,
      informationRatio,
      beta,
      alpha,
      treynorRatio,
      var95,
      var99,
      cvar95,
      cvar99,
      maxLoss,
      avgTradesPerDay,
      avgHoldingPeriod,
      turnover,
      alphaDecay: 0 // Will be calculated by AlphaDecayAnalyzer
    };
  }

  /**
   * Calculate returns from equity curve
   */
  private calculateReturns(equity: number[]): number[] {
    const returns: number[] = [];
    for (let i = 1; i < equity.length; i++) {
      const ret = (equity[i] - equity[i-1]) / equity[i-1];
      returns.push(ret);
    }
    return returns;
  }

  /**
   * Calculate total return
   */
  private calculateTotalReturn(equity: number[]): number {
    if (equity.length < 2) return 0;
    return (equity[equity.length - 1] - equity[0]) / equity[0];
  }

  /**
   * Annualize return
   */
  private annualizeReturn(totalReturn: number, periods: number): number {
    const years = periods / 252; // Assuming daily data
    return Math.pow(1 + totalReturn, 1 / years) - 1;
  }

  /**
   * Calculate volatility (standard deviation)
   */
  private calculateVolatility(returns: number[]): number {
    if (returns.length === 0) return 0;
    
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    return Math.sqrt(variance);
  }

  /**
   * Annualize volatility
   */
  private annualizeVolatility(volatility: number): number {
    return volatility * Math.sqrt(252); // Assuming daily data
  }

  /**
   * Calculate Sharpe ratio
   */
  private calculateSharpeRatio(annualizedReturn: number, annualizedVolatility: number, riskFreeRate: number = 0.02): number {
    if (annualizedVolatility === 0) return 0;
    return (annualizedReturn - riskFreeRate) / annualizedVolatility;
  }

  /**
   * Calculate Sortino ratio
   */
  private calculateSortinoRatio(returns: number[], targetReturn: number = 0): number {
    const excessReturns = returns.map(r => r - targetReturn);
    const downside = excessReturns.filter(r => r < 0);
    
    if (downside.length === 0) return Infinity;
    
    const downsideDeviation = Math.sqrt(
      downside.reduce((sum, r) => sum + r * r, 0) / downside.length
    );
    
    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const annualizedAvgReturn = avgReturn * 252;
    const annualizedDownsideDeviation = downsideDeviation * Math.sqrt(252);
    
    if (annualizedDownsideDeviation === 0) return Infinity;
    return (annualizedAvgReturn - targetReturn) / annualizedDownsideDeviation;
  }

  /**
   * Calculate maximum drawdown
   */
  private calculateMaxDrawdown(equity: number[]): number {
    if (equity.length === 0) return 0;
    
    let maxDrawdown = 0;
    let peak = equity[0];
    
    for (const value of equity) {
      if (value > peak) {
        peak = value;
      }
      const drawdown = (peak - value) / peak;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }
    
    return maxDrawdown;
  }

  /**
   * Calculate average drawdown
   */
  private calculateAverageDrawdown(equity: number[]): number {
    if (equity.length === 0) return 0;
    
    const drawdowns: number[] = [];
    let peak = equity[0];
    let inDrawdown = false;
    let currentDrawdown = 0;
    
    for (const value of equity) {
      if (value > peak) {
        if (inDrawdown && currentDrawdown > 0) {
          drawdowns.push(currentDrawdown);
        }
        peak = value;
        inDrawdown = false;
        currentDrawdown = 0;
      } else {
        inDrawdown = true;
        currentDrawdown = (peak - value) / peak;
      }
    }
    
    if (inDrawdown && currentDrawdown > 0) {
      drawdowns.push(currentDrawdown);
    }
    
    return drawdowns.length > 0 
      ? drawdowns.reduce((sum, d) => sum + d, 0) / drawdowns.length 
      : 0;
  }

  /**
   * Calculate maximum drawdown duration
   */
  private calculateMaxDrawdownDuration(equity: number[]): number {
    if (equity.length === 0) return 0;
    
    let maxDuration = 0;
    let currentDuration = 0;
    let peak = equity[0];
    
    for (let i = 0; i < equity.length; i++) {
      if (equity[i] >= peak) {
        peak = equity[i];
        currentDuration = 0;
      } else {
        currentDuration++;
        if (currentDuration > maxDuration) {
          maxDuration = currentDuration;
        }
      }
    }
    
    return maxDuration;
  }

  /**
   * Calculate Calmar ratio
   */
  private calculateCalmarRatio(annualizedReturn: number, maxDrawdown: number): number {
    if (maxDrawdown === 0) return Infinity;
    return annualizedReturn / maxDrawdown;
  }

  /**
   * Calculate win rate
   */
  private calculateWinRate(trades: any[]): number {
    if (trades.length === 0) return 0;
    const wins = trades.filter(t => t.pnl > 0).length;
    return wins / trades.length;
  }

  /**
   * Calculate profit factor
   */
  private calculateProfitFactor(trades: any[]): number {
    const profits = trades.filter(t => t.pnl > 0).reduce((sum, t) => sum + t.pnl, 0);
    const losses = Math.abs(trades.filter(t => t.pnl < 0).reduce((sum, t) => sum + t.pnl, 0));
    
    if (losses === 0) return Infinity;
    return profits / losses;
  }

  /**
   * Calculate payoff ratio
   */
  private calculatePayoffRatio(trades: any[]): number {
    const wins = trades.filter(t => t.pnl > 0);
    const losses = trades.filter(t => t.pnl < 0);
    
    if (wins.length === 0 || losses.length === 0) return 0;
    
    const avgWin = wins.reduce((sum, t) => sum + t.pnl, 0) / wins.length;
    const avgLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0) / losses.length);
    
    if (avgLoss === 0) return Infinity;
    return avgWin / avgLoss;
  }

  /**
   * Calculate Information Ratio
   */
  private calculateInformationRatio(returns: number[], benchmarkReturns?: number[]): number {
    if (!benchmarkReturns || benchmarkReturns.length === 0) {
      // Use 0 as benchmark if not provided
      benchmarkReturns = new Array(returns.length).fill(0);
    }
    
    const activeReturns = returns.map((r, i) => r - (benchmarkReturns[i] || 0));
    const trackingError = this.calculateVolatility(activeReturns);
    const avgActiveReturn = activeReturns.reduce((sum, r) => sum + r, 0) / activeReturns.length;
    
    if (trackingError === 0) return 0;
    return (avgActiveReturn * 252) / (trackingError * Math.sqrt(252));
  }

  /**
   * Calculate Beta
   */
  private calculateBeta(returns: number[], marketReturns?: number[]): number {
    if (!marketReturns || marketReturns.length === 0) {
      // Default beta of 1 if no market returns
      return 1;
    }
    
    const n = Math.min(returns.length, marketReturns.length);
    if (n === 0) return 1;
    
    const avgReturn = returns.slice(0, n).reduce((sum, r) => sum + r, 0) / n;
    const avgMarketReturn = marketReturns.slice(0, n).reduce((sum, r) => sum + r, 0) / n;
    
    let covariance = 0;
    let marketVariance = 0;
    
    for (let i = 0; i < n; i++) {
      const returnDev = returns[i] - avgReturn;
      const marketDev = marketReturns[i] - avgMarketReturn;
      covariance += returnDev * marketDev;
      marketVariance += marketDev * marketDev;
    }
    
    if (marketVariance === 0) return 1;
    return covariance / marketVariance;
  }

  /**
   * Calculate Alpha
   */
  private calculateAlpha(returns: number[], beta: number, riskFreeRate: number = 0.02): number {
    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const annualizedAvgReturn = avgReturn * 252;
    const marketReturn = 0.08; // Assume 8% market return
    
    return annualizedAvgReturn - (riskFreeRate + beta * (marketReturn - riskFreeRate));
  }

  /**
   * Calculate Treynor Ratio
   */
  private calculateTreynorRatio(annualizedReturn: number, beta: number, riskFreeRate: number = 0.02): number {
    if (beta === 0) return 0;
    return (annualizedReturn - riskFreeRate) / beta;
  }

  /**
   * Calculate Value at Risk (VaR)
   */
  private calculateVaR(returns: number[], confidence: number): number {
    const sorted = returns.slice().sort((a, b) => a - b);
    const index = Math.floor((1 - confidence) * sorted.length);
    return sorted[index] || 0;
  }

  /**
   * Calculate Conditional Value at Risk (CVaR)
   */
  private calculateCVaR(returns: number[], confidence: number): number {
    const var_ = this.calculateVaR(returns, confidence);
    const tail = returns.filter(r => r <= var_);
    
    if (tail.length === 0) return var_;
    return tail.reduce((sum, r) => sum + r, 0) / tail.length;
  }

  /**
   * Calculate average trades per day
   */
  private calculateAvgTradesPerDay(trades: any[]): number {
    if (trades.length === 0) return 0;
    
    const days = new Set(trades.map(t => 
      new Date(t.timestamp).toISOString().split('T')[0]
    )).size;
    
    return days > 0 ? trades.length / days : 0;
  }

  /**
   * Calculate average holding period
   */
  private calculateAvgHoldingPeriod(trades: any[]): number {
    if (trades.length === 0) return 0;
    
    const holdingPeriods = trades
      .filter(t => t.exitTime && t.entryTime)
      .map(t => t.exitTime - t.entryTime);
    
    if (holdingPeriods.length === 0) return 0;
    
    const avgHoldingMs = holdingPeriods.reduce((sum, p) => sum + p, 0) / holdingPeriods.length;
    return avgHoldingMs / (1000 * 60 * 60); // Convert to hours
  }

  /**
   * Calculate turnover
   */
  private calculateTurnover(trades: any[], initialCapital: number): number {
    if (trades.length === 0 || initialCapital === 0) return 0;
    
    const totalVolume = trades.reduce((sum, t) => sum + Math.abs(t.size * t.price), 0);
    return totalVolume / initialCapital;
  }

  /**
   * Get default risk metrics
   */
  private getDefaultRiskMetrics(): RiskMetrics {
    return {
      totalReturn: 0,
      annualizedReturn: 0,
      volatility: 0,
      sharpeRatio: 0,
      sortinoRatio: 0,
      calmarRatio: 0,
      maxDrawdown: 0,
      avgDrawdown: 0,
      maxDrawdownDuration: 0,
      winRate: 0,
      profitFactor: 0,
      payoffRatio: 0,
      informationRatio: 0,
      beta: 1,
      alpha: 0,
      treynorRatio: 0,
      var95: 0,
      var99: 0,
      cvar95: 0,
      cvar99: 0,
      maxLoss: 0,
      avgTradesPerDay: 0,
      avgHoldingPeriod: 0,
      turnover: 0,
      alphaDecay: 0
    };
  }
} 