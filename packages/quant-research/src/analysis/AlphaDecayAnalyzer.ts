/**
 * AlphaDecayAnalyzer - Elite alpha decay analysis engine
 * 
 * Analyzes how trading signals lose effectiveness over time due to
 * market adaptation, crowding, and regime changes.
 */

import { EventEmitter } from 'events';
import { Logger } from 'winston';
import {
  BacktestResult,
  Trade,
  AlphaDecayResult,
  DecayMetrics,
  RegimeAnalysis,
  SignalStrength
} from '@noderr/types';

interface TimeWindow {
  start: Date;
  end: Date;
  trades: Trade[];
  performance: any;
}

interface SignalDecayPattern {
  signal: string;
  initialStrength: number;
  currentStrength: number;
  decayRate: number;
  halfLife: number;
  crowdingFactor: number;
}

export class AlphaDecayAnalyzer extends EventEmitter {
  private logger: Logger;
  private decayCache: Map<string, AlphaDecayResult> = new Map();
  
  constructor(logger: Logger) {
    super();
    this.logger = logger;
  }
  
  /**
   * Analyze alpha decay from backtest results
   */
  async analyze(backtestResult: BacktestResult): Promise<AlphaDecayResult> {
    this.logger.info(`Analyzing alpha decay for strategy ${backtestResult.strategyId}`);
    
    // Check cache
    const cacheKey = this.generateCacheKey(backtestResult);
    if (this.decayCache.has(cacheKey)) {
      return this.decayCache.get(cacheKey)!;
    }
    
    // Split trades into time windows
    const windows = this.createTimeWindows(backtestResult.trades);
    
    // Analyze performance decay over time
    const decayMetrics = this.calculateDecayMetrics(windows);
    
    // Analyze signal strength evolution
    const signalAnalysis = this.analyzeSignalStrength(windows, backtestResult);
    
    // Detect regime changes
    const regimeAnalysis = this.detectRegimeChanges(windows);
    
    // Analyze crowding effects
    const crowdingAnalysis = this.analyzeCrowding(windows);
    
    // Calculate optimal retraining frequency
    const retrainingFrequency = this.calculateOptimalRetraining(decayMetrics);
    
    // Generate decay patterns for each signal
    const signalPatterns = this.generateSignalPatterns(windows, backtestResult);
    
    const result: AlphaDecayResult = {
      strategyId: backtestResult.strategyId,
      decayRate: decayMetrics.overallDecayRate,
      halfLife: decayMetrics.halfLife,
      metrics: decayMetrics,
      signalAnalysis,
      regimeAnalysis,
      crowdingAnalysis,
      retrainingFrequency,
      signalPatterns,
      recommendations: this.generateRecommendations(decayMetrics, regimeAnalysis)
    };
    
    // Cache result
    this.decayCache.set(cacheKey, result);
    
    this.emit('analysisComplete', result);
    
    return result;
  }
  
  /**
   * Create time windows for analysis
   */
  private createTimeWindows(trades: Trade[]): TimeWindow[] {
    if (trades.length === 0) return [];
    
    // Sort trades by entry time
    const sortedTrades = [...trades].sort((a, b) => 
      a.entryTime.getTime() - b.entryTime.getTime()
    );
    
    // Determine window size (adaptive based on trade frequency)
    const totalDuration = sortedTrades[sortedTrades.length - 1].exitTime!.getTime() - 
                         sortedTrades[0].entryTime.getTime();
    const avgTradesPerDay = trades.length / (totalDuration / (24 * 60 * 60 * 1000));
    
    // Target ~50 trades per window
    const windowDays = Math.max(7, Math.floor(50 / avgTradesPerDay));
    const windowSize = windowDays * 24 * 60 * 60 * 1000;
    
    const windows: TimeWindow[] = [];
    let windowStart = sortedTrades[0].entryTime.getTime();
    
    while (windowStart < sortedTrades[sortedTrades.length - 1].exitTime!.getTime()) {
      const windowEnd = windowStart + windowSize;
      
      const windowTrades = sortedTrades.filter(t => 
        t.entryTime.getTime() >= windowStart && 
        t.entryTime.getTime() < windowEnd
      );
      
      if (windowTrades.length > 0) {
        windows.push({
          start: new Date(windowStart),
          end: new Date(windowEnd),
          trades: windowTrades,
          performance: this.calculateWindowPerformance(windowTrades)
        });
      }
      
      windowStart = windowEnd;
    }
    
    return windows;
  }
  
  /**
   * Calculate window performance
   */
  private calculateWindowPerformance(trades: Trade[]): any {
    if (trades.length === 0) {
      return {
        winRate: 0,
        avgReturn: 0,
        sharpeRatio: 0,
        profitFactor: 0
      };
    }
    
    const winningTrades = trades.filter(t => t.pnl! > 0);
    const losingTrades = trades.filter(t => t.pnl! < 0);
    
    const returns = trades.map(t => t.pnlPercent!);
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const volatility = Math.sqrt(variance);
    
    const avgWin = winningTrades.length > 0
      ? winningTrades.reduce((sum, t) => sum + t.pnl!, 0) / winningTrades.length
      : 0;
    
    const avgLoss = losingTrades.length > 0
      ? Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl!, 0) / losingTrades.length)
      : 0;
    
    return {
      winRate: trades.length > 0 ? winningTrades.length / trades.length : 0,
      avgReturn,
      sharpeRatio: volatility > 0 ? (avgReturn * Math.sqrt(252)) / (volatility * Math.sqrt(252)) : 0,
      profitFactor: avgLoss > 0 ? avgWin / avgLoss : 0,
      trades: trades.length
    };
  }
  
  /**
   * Calculate decay metrics
   */
  private calculateDecayMetrics(windows: TimeWindow[]): DecayMetrics {
    if (windows.length < 2) {
      return {
        overallDecayRate: 0,
        halfLife: Infinity,
        decayCoefficient: 0,
        r2: 0,
        significantDecay: false,
        decayByMetric: {}
      };
    }
    
    // Extract performance metrics over time
    const winRates = windows.map(w => w.performance.winRate);
    const sharpeRatios = windows.map(w => w.performance.sharpeRatio);
    const profitFactors = windows.map(w => w.performance.profitFactor);
    const avgReturns = windows.map(w => w.performance.avgReturn);
    
    // Fit exponential decay model: y = a * e^(-λt)
    const winRateDecay = this.fitExponentialDecay(winRates);
    const sharpeDecay = this.fitExponentialDecay(sharpeRatios);
    const pfDecay = this.fitExponentialDecay(profitFactors);
    const returnDecay = this.fitExponentialDecay(avgReturns);
    
    // Overall decay rate (weighted average)
    const overallDecayRate = (
      winRateDecay.lambda * 0.2 +
      sharpeDecay.lambda * 0.4 +
      pfDecay.lambda * 0.2 +
      returnDecay.lambda * 0.2
    );
    
    // Half-life calculation
    const halfLife = overallDecayRate > 0 ? Math.log(2) / overallDecayRate : Infinity;
    
    // R-squared for fit quality
    const r2 = (winRateDecay.r2 + sharpeDecay.r2 + pfDecay.r2 + returnDecay.r2) / 4;
    
    return {
      overallDecayRate,
      halfLife,
      decayCoefficient: overallDecayRate,
      r2,
      significantDecay: r2 > 0.5 && overallDecayRate > 0.001,
      decayByMetric: {
        winRate: winRateDecay,
        sharpeRatio: sharpeDecay,
        profitFactor: pfDecay,
        avgReturn: returnDecay
      }
    };
  }
  
  /**
   * Fit exponential decay model
   */
  private fitExponentialDecay(values: number[]): any {
    if (values.length < 2) {
      return { lambda: 0, r2: 0, fitted: values };
    }
    
    // Remove negative values for log transform
    const positiveValues = values.map(v => Math.max(v, 0.0001));
    
    // Log transform for linear regression
    const logValues = positiveValues.map(v => Math.log(v));
    const timePoints = Array(values.length).fill(0).map((_, i) => i);
    
    // Linear regression on log values
    const n = values.length;
    const sumX = timePoints.reduce((a, b) => a + b, 0);
    const sumY = logValues.reduce((a, b) => a + b, 0);
    const sumXY = timePoints.reduce((sum, x, i) => sum + x * logValues[i], 0);
    const sumX2 = timePoints.reduce((sum, x) => sum + x * x, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    
    // Lambda is negative of slope
    const lambda = -slope;
    
    // Calculate R-squared
    const yMean = sumY / n;
    const ssTotal = logValues.reduce((sum, y) => sum + Math.pow(y - yMean, 2), 0);
    const ssResidual = logValues.reduce((sum, y, i) => {
      const predicted = intercept + slope * i;
      return sum + Math.pow(y - predicted, 2);
    }, 0);
    
    const r2 = 1 - (ssResidual / ssTotal);
    
    // Generate fitted values
    const fitted = timePoints.map(t => Math.exp(intercept) * Math.exp(-lambda * t));
    
    return {
      lambda: Math.max(0, lambda), // Ensure non-negative decay
      r2: Math.max(0, Math.min(1, r2)),
      fitted,
      initialValue: Math.exp(intercept)
    };
  }
  
  /**
   * Analyze signal strength over time
   */
  private analyzeSignalStrength(
    windows: TimeWindow[],
    backtestResult: BacktestResult
  ): SignalStrength[] {
    const signalStrengths: SignalStrength[] = [];
    
    // Extract unique signals from strategy
    const signals = this.extractSignals(backtestResult);
    
    for (const signal of signals) {
      const strengthByWindow = windows.map(window => {
        // Count trades using this signal
        const signalTrades = window.trades.filter(t => 
          this.tradeUsesSignal(t, signal, backtestResult)
        );
        
        if (signalTrades.length === 0) return 0;
        
        // Calculate signal effectiveness
        const winRate = signalTrades.filter(t => t.pnl! > 0).length / signalTrades.length;
        const avgReturn = signalTrades.reduce((sum, t) => sum + t.pnlPercent!, 0) / signalTrades.length;
        
        // Combine metrics for strength score
        return winRate * 0.5 + Math.max(0, avgReturn * 10) * 0.5;
      });
      
      // Analyze strength evolution
      const decay = this.fitExponentialDecay(strengthByWindow);
      
      signalStrengths.push({
        signal,
        initialStrength: strengthByWindow[0] || 0,
        currentStrength: strengthByWindow[strengthByWindow.length - 1] || 0,
        trend: decay.lambda > 0 ? 'declining' : 'stable',
        effectiveness: strengthByWindow.reduce((a, b) => a + b, 0) / strengthByWindow.length,
        consistency: this.calculateConsistency(strengthByWindow)
      });
    }
    
    return signalStrengths;
  }
  
  /**
   * Detect regime changes
   */
  private detectRegimeChanges(windows: TimeWindow[]): RegimeAnalysis {
    if (windows.length < 3) {
      return {
        regimes: [],
        currentRegime: 'unknown',
        transitionProbabilities: {},
        regimeStability: 1
      };
    }
    
    // Use change point detection on performance metrics
    const performances = windows.map(w => w.performance.sharpeRatio);
    const changePoints = this.detectChangePoints(performances);
    
    // Define regimes based on change points
    const regimes: any[] = [];
    let regimeStart = 0;
    
    for (const changePoint of changePoints) {
      const regimeWindows = windows.slice(regimeStart, changePoint);
      const avgPerformance = regimeWindows.reduce((sum, w) => 
        sum + w.performance.sharpeRatio, 0
      ) / regimeWindows.length;
      
      regimes.push({
        start: windows[regimeStart].start,
        end: windows[changePoint - 1].end,
        type: this.classifyRegime(avgPerformance),
        performance: avgPerformance,
        duration: changePoint - regimeStart
      });
      
      regimeStart = changePoint;
    }
    
    // Add final regime
    if (regimeStart < windows.length) {
      const regimeWindows = windows.slice(regimeStart);
      const avgPerformance = regimeWindows.reduce((sum, w) => 
        sum + w.performance.sharpeRatio, 0
      ) / regimeWindows.length;
      
      regimes.push({
        start: windows[regimeStart].start,
        end: windows[windows.length - 1].end,
        type: this.classifyRegime(avgPerformance),
        performance: avgPerformance,
        duration: windows.length - regimeStart
      });
    }
    
    // Calculate transition probabilities
    const transitionProbabilities = this.calculateTransitionProbabilities(regimes);
    
    // Calculate regime stability
    const avgRegimeDuration = regimes.reduce((sum, r) => sum + r.duration, 0) / regimes.length;
    const regimeStability = Math.min(1, avgRegimeDuration / windows.length);
    
    return {
      regimes,
      currentRegime: regimes[regimes.length - 1]?.type || 'unknown',
      transitionProbabilities,
      regimeStability
    };
  }
  
  /**
   * Analyze crowding effects
   */
  private analyzeCrowding(windows: TimeWindow[]): any {
    // Analyze how performance degrades as more capital enters strategy
    const volumeByWindow = windows.map(w => 
      w.trades.reduce((sum, t) => sum + t.size * t.entryPrice, 0)
    );
    
    const performanceByWindow = windows.map(w => w.performance.sharpeRatio);
    
    // Calculate correlation between volume and performance
    const correlation = this.calculateCorrelation(volumeByWindow, performanceByWindow);
    
    // Estimate capacity based on volume-performance relationship
    const estimatedCapacity = this.estimateCapacity(volumeByWindow, performanceByWindow);
    
    // Detect crowding signals
    const crowdingSignals = this.detectCrowdingSignals(windows);
    
    return {
      volumePerformanceCorrelation: correlation,
      estimatedCapacity,
      currentUtilization: volumeByWindow[volumeByWindow.length - 1] / estimatedCapacity,
      crowdingSignals,
      crowdingLevel: this.calculateCrowdingLevel(correlation, crowdingSignals)
    };
  }
  
  /**
   * Calculate optimal retraining frequency
   */
  private calculateOptimalRetraining(decayMetrics: DecayMetrics): number {
    // Based on half-life and decay significance
    if (!decayMetrics.significantDecay) {
      return 90; // Quarterly if no significant decay
    }
    
    // Retrain when performance drops by 20%
    const acceptableDecay = 0.2;
    const daysToDecay = -Math.log(1 - acceptableDecay) / decayMetrics.decayCoefficient;
    
    // Add safety margin
    return Math.max(7, Math.floor(daysToDecay * 0.7));
  }
  
  /**
   * Generate signal patterns
   */
  private generateSignalPatterns(
    windows: TimeWindow[],
    backtestResult: BacktestResult
  ): SignalDecayPattern[] {
    const signals = this.extractSignals(backtestResult);
    const patterns: SignalDecayPattern[] = [];
    
    for (const signal of signals) {
      const performanceByWindow = windows.map(window => {
        const signalTrades = window.trades.filter(t => 
          this.tradeUsesSignal(t, signal, backtestResult)
        );
        
        if (signalTrades.length === 0) return null;
        
        return {
          winRate: signalTrades.filter(t => t.pnl! > 0).length / signalTrades.length,
          count: signalTrades.length
        };
      }).filter(p => p !== null);
      
      if (performanceByWindow.length < 2) continue;
      
      const winRates = performanceByWindow.map(p => p!.winRate);
      const decay = this.fitExponentialDecay(winRates);
      
      // Estimate crowding based on trade frequency increase
      const tradeCounts = performanceByWindow.map(p => p!.count);
      const crowdingFactor = tradeCounts[tradeCounts.length - 1] / tradeCounts[0];
      
      patterns.push({
        signal,
        initialStrength: winRates[0],
        currentStrength: winRates[winRates.length - 1],
        decayRate: decay.lambda,
        halfLife: decay.lambda > 0 ? Math.log(2) / decay.lambda : Infinity,
        crowdingFactor
      });
    }
    
    return patterns;
  }
  
  /**
   * Generate recommendations
   */
  private generateRecommendations(
    decayMetrics: DecayMetrics,
    regimeAnalysis: RegimeAnalysis
  ): string[] {
    const recommendations: string[] = [];
    
    // Decay-based recommendations
    if (decayMetrics.significantDecay) {
      recommendations.push(
        `Significant alpha decay detected (half-life: ${Math.round(decayMetrics.halfLife)} days). ` +
        `Consider retraining models or updating strategy parameters.`
      );
    }
    
    if (decayMetrics.decayByMetric.sharpeRatio.lambda > 0.01) {
      recommendations.push(
        'Sharpe ratio showing rapid decay. Review risk management and position sizing.'
      );
    }
    
    // Regime-based recommendations
    if (regimeAnalysis.regimeStability < 0.5) {
      recommendations.push(
        'Frequent regime changes detected. Consider adaptive strategies or regime-specific models.'
      );
    }
    
    if (regimeAnalysis.currentRegime === 'bear') {
      recommendations.push(
        'Currently in bear regime. Consider reducing position sizes or switching to defensive strategies.'
      );
    }
    
    // General recommendations
    if (decayMetrics.halfLife < 30) {
      recommendations.push(
        'Rapid alpha decay suggests strategy is becoming crowded. Consider developing new signals.'
      );
    }
    
    return recommendations;
  }
  
  /**
   * Helper: Extract signals from strategy
   */
  private extractSignals(backtestResult: BacktestResult): string[] {
    // In production, would parse strategy definition
    // For now, return common signal types
    return ['momentum', 'mean_reversion', 'breakout', 'volume', 'sentiment'];
  }
  
  /**
   * Helper: Check if trade uses signal
   */
  private tradeUsesSignal(
    trade: Trade,
    signal: string,
    backtestResult: BacktestResult
  ): boolean {
    // In production, would check trade metadata
    // For now, use simple heuristic
    return Math.random() < 0.3; // 30% chance
  }
  
  /**
   * Helper: Calculate consistency
   */
  private calculateConsistency(values: number[]): number {
    if (values.length < 2) return 1;
    
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 1;
    
    return Math.max(0, 1 - cv);
  }
  
  /**
   * Helper: Detect change points
   */
  private detectChangePoints(values: number[]): number[] {
    const changePoints: number[] = [];
    const threshold = 2; // Standard deviations
    
    for (let i = 10; i < values.length - 10; i++) {
      const before = values.slice(Math.max(0, i - 10), i);
      const after = values.slice(i, Math.min(values.length, i + 10));
      
      const meanBefore = before.reduce((a, b) => a + b, 0) / before.length;
      const meanAfter = after.reduce((a, b) => a + b, 0) / after.length;
      
      const stdBefore = Math.sqrt(
        before.reduce((sum, v) => sum + Math.pow(v - meanBefore, 2), 0) / before.length
      );
      
      if (Math.abs(meanAfter - meanBefore) > threshold * stdBefore) {
        changePoints.push(i);
        i += 10; // Skip ahead to avoid multiple detections
      }
    }
    
    return changePoints;
  }
  
  /**
   * Helper: Classify regime
   */
  private classifyRegime(sharpeRatio: number): string {
    if (sharpeRatio > 2) return 'bull';
    if (sharpeRatio > 0.5) return 'normal';
    if (sharpeRatio > -0.5) return 'choppy';
    return 'bear';
  }
  
  /**
   * Helper: Calculate transition probabilities
   */
  private calculateTransitionProbabilities(regimes: any[]): any {
    const transitions: { [key: string]: { [key: string]: number } } = {};
    const regimeTypes = ['bull', 'normal', 'choppy', 'bear'];
    
    // Initialize
    for (const from of regimeTypes) {
      transitions[from] = {};
      for (const to of regimeTypes) {
        transitions[from][to] = 0;
      }
    }
    
    // Count transitions
    for (let i = 0; i < regimes.length - 1; i++) {
      const from = regimes[i].type;
      const to = regimes[i + 1].type;
      transitions[from][to]++;
    }
    
    // Normalize to probabilities
    for (const from of regimeTypes) {
      const total = Object.values(transitions[from]).reduce((a, b) => a + b, 0);
      if (total > 0) {
        for (const to of regimeTypes) {
          transitions[from][to] /= total;
        }
      }
    }
    
    return transitions;
  }
  
  /**
   * Helper: Calculate correlation
   */
  private calculateCorrelation(x: number[], y: number[]): number {
    const n = Math.min(x.length, y.length);
    if (n < 2) return 0;
    
    const sumX = x.slice(0, n).reduce((a, b) => a + b, 0);
    const sumY = y.slice(0, n).reduce((a, b) => a + b, 0);
    const sumXY = x.slice(0, n).reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumX2 = x.slice(0, n).reduce((sum, xi) => sum + xi * xi, 0);
    const sumY2 = y.slice(0, n).reduce((sum, yi) => sum + yi * yi, 0);
    
    const num = n * sumXY - sumX * sumY;
    const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
    
    return den === 0 ? 0 : num / den;
  }
  
  /**
   * Helper: Estimate capacity
   */
  private estimateCapacity(volumes: number[], performances: number[]): number {
    // Find volume level where performance starts degrading
    const maxPerformance = Math.max(...performances);
    const threshold = maxPerformance * 0.8; // 20% degradation
    
    for (let i = 0; i < performances.length; i++) {
      if (performances[i] < threshold) {
        return volumes[i];
      }
    }
    
    // If no degradation, estimate based on max observed volume
    return Math.max(...volumes) * 2;
  }
  
  /**
   * Helper: Detect crowding signals
   */
  private detectCrowdingSignals(windows: TimeWindow[]): string[] {
    const signals: string[] = [];
    
    // Check for increasing trade frequency
    const tradeCounts = windows.map(w => w.trades.length);
    const recentAvg = tradeCounts.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const historicalAvg = tradeCounts.slice(0, -5).reduce((a, b) => a + b, 0) / (tradeCounts.length - 5);
    
    if (recentAvg > historicalAvg * 2) {
      signals.push('Trade frequency doubled - possible strategy crowding');
    }
    
    // Check for decreasing average trade size
    const avgSizes = windows.map(w => 
      w.trades.reduce((sum, t) => sum + t.size, 0) / w.trades.length
    );
    
    if (avgSizes[avgSizes.length - 1] < avgSizes[0] * 0.5) {
      signals.push('Average trade size halved - market impact concerns');
    }
    
    // Check for performance degradation with volume
    const volumes = windows.map(w => 
      w.trades.reduce((sum, t) => sum + t.size * t.entryPrice, 0)
    );
    const performances = windows.map(w => w.performance.sharpeRatio);
    const correlation = this.calculateCorrelation(volumes, performances);
    
    if (correlation < -0.5) {
      signals.push('Strong negative volume-performance correlation detected');
    }
    
    return signals;
  }
  
  /**
   * Helper: Calculate crowding level
   */
  private calculateCrowdingLevel(correlation: number, signals: string[]): string {
    const score = Math.abs(correlation) * 0.5 + signals.length * 0.1;
    
    if (score > 0.7) return 'severe';
    if (score > 0.5) return 'moderate';
    if (score > 0.3) return 'mild';
    return 'minimal';
  }
  
  /**
   * Generate cache key
   */
  private generateCacheKey(backtestResult: BacktestResult): string {
    return `${backtestResult.strategyId}_${backtestResult.trades.length}`;
  }
  
  /**
   * Clear cache
   */
  clearCache(): void {
    this.decayCache.clear();
    this.logger.info('Alpha decay cache cleared');
  }
} 