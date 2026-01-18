/**
 * FactorAnalyzer - Elite multi-factor model analysis engine
 * 
 * Analyzes factor exposures, correlations, and predictive power for
 * institutional-grade quantitative trading strategies.
 */

import { EventEmitter } from 'events';
import { Logger } from 'winston';
import {
  Factor,
  FactorModel,
  FactorPerformance,
  FactorCorrelation,
  FactorExposure,
  FactorAnalysisResult
} from '../types';

interface FactorTimeSeries {
  factor: Factor;
  values: number[];
  timestamps: Date[];
}

interface RegressionResult {
  coefficients: { [factorId: string]: number };
  intercept: number;
  rSquared: number;
  adjustedRSquared: number;
  pValues: { [factorId: string]: number };
  standardErrors: { [factorId: string]: number };
}

export class FactorAnalyzer extends EventEmitter {
  private logger: Logger;
  private factorCache: Map<string, FactorTimeSeries> = new Map();
  private modelCache: Map<string, FactorModel> = new Map();
  
  constructor(logger: Logger) {
    super();
    this.logger = logger;
  }
  
  /**
   * Create factor model from factors
   */
  async createModel(factors: Factor[]): Promise<FactorModel> {
    this.logger.info(`Creating factor model with ${factors.length} factors`);
    
    // Validate factors
    this.validateFactors(factors);
    
    // Calculate factor statistics
    const factorStats = await this.calculateFactorStatistics(factors);
    
    // Perform factor selection
    const selectedFactors = await this.selectFactors(factors, factorStats);
    
    // Build correlation matrix
    const correlationMatrix = await this.buildCorrelationMatrix(selectedFactors);
    
    // Perform PCA for dimensionality reduction
    const pcaResult = this.performPCA(correlationMatrix);
    
    // Create model
    const model: FactorModel = {
      id: `model_${Date.now()}`,
      name: `Factor Model ${new Date().toISOString()}`,
      factors: selectedFactors,
      weights: this.calculateFactorWeights(selectedFactors, pcaResult),
      correlationMatrix,
      principalComponents: pcaResult.components,
      explainedVariance: pcaResult.explainedVariance,
      createdAt: new Date(),
      performance: {
        inSample: { sharpeRatio: 0, returns: 0, volatility: 0 },
        outOfSample: { sharpeRatio: 0, returns: 0, volatility: 0 }
      }
    };
    
    // Cache model
    this.modelCache.set(model.id, model);
    
    this.emit('modelCreated', model);
    
    return model;
  }
  
  /**
   * Analyze factor model performance
   */
  async analyze(
    model: FactorModel,
    data: any
  ): Promise<FactorAnalysisResult> {
    this.logger.info(`Analyzing factor model ${model.id}`);
    
    // Extract returns and factor values
    const { returns, factorData } = this.prepareData(data);
    
    // Perform regression analysis
    const regression = this.performRegression(returns, factorData, model.factors);
    
    // Calculate factor exposures
    const exposures = this.calculateExposures(regression, model);
    
    // Analyze factor performance
    const performance = await this.analyzeFactorPerformance(
      model.factors,
      factorData,
      returns
    );
    
    // Calculate risk attribution
    const riskAttribution = this.calculateRiskAttribution(
      exposures,
      model.correlationMatrix || []
    );
    
    // Generate insights
    const insights = this.generateInsights(regression, performance, riskAttribution);
    
    const result: FactorAnalysisResult = {
      modelId: model.id,
      timestamp: new Date(),
      regression,
      exposures,
      performance,
      riskAttribution,
      insights,
      recommendations: this.generateRecommendations(insights)
    };
    
    this.emit('analysisComplete', result);
    
    return result;
  }
  
  /**
   * Calculate factor correlations
   */
  async calculateCorrelations(factors: Factor[]): Promise<FactorCorrelation[]> {
    this.logger.info(`Calculating correlations for ${factors.length} factors`);
    
    const correlations: FactorCorrelation[] = [];
    
    // Get factor time series data
    const factorData = await this.loadFactorData(factors);
    
    // Calculate pairwise correlations
    for (let i = 0; i < factors.length; i++) {
      for (let j = i + 1; j < factors.length; j++) {
        const correlation = this.calculateCorrelation(
          factorData[i].values,
          factorData[j].values
        );
        
        correlations.push({
          factorId1: factors[i].id,
          factorId2: factors[j].id,
          correlation,
          pValue: this.calculateCorrelationPValue(correlation, factorData[i].values.length)
        });
      }
    }
    
    return correlations;
  }
  
  /**
   * Validate factors
   */
  private validateFactors(factors: Factor[]): void {
    if (factors.length === 0) {
      throw new Error('At least one factor required');
    }
    
    // Check for duplicate factors
    const factorIds = new Set<string>();
    for (const factor of factors) {
      if (factorIds.has(factor.id)) {
        throw new Error(`Duplicate factor: ${factor.id}`);
      }
      factorIds.add(factor.id);
    }
    
    // Validate factor definitions
    for (const factor of factors) {
      if (!factor.name || !factor.category) {
        throw new Error(`Invalid factor definition: ${factor.id}`);
      }
    }
  }
  
  /**
   * Calculate factor statistics
   */
  private async calculateFactorStatistics(factors: Factor[]): Promise<any> {
    const stats: any = {};
    
    const factorData = await this.loadFactorData(factors);
    
    for (let i = 0; i < factors.length; i++) {
      const values = factorData[i].values;
      
      stats[factors[i].id] = {
        mean: this.mean(values),
        std: this.standardDeviation(values),
        skewness: this.skewness(values),
        kurtosis: this.kurtosis(values),
        sharpeRatio: this.calculateSharpeRatio(values),
        informationRatio: this.calculateInformationRatio(values),
        maxDrawdown: this.calculateMaxDrawdown(values)
      };
    }
    
    return stats;
  }
  
  /**
   * Select factors based on criteria
   */
  private async selectFactors(
    factors: Factor[],
    stats: any
  ): Promise<Factor[]> {
    // Filter factors based on quality criteria
    const selectedFactors = factors.filter(factor => {
      const factorStats = stats[factor.id];
      
      // Quality checks
      const hasGoodSharpe = factorStats.sharpeRatio > 0.5;
      const hasLowDrawdown = factorStats.maxDrawdown < 0.3;
      const isStable = factorStats.std < 0.5;
      
      return hasGoodSharpe && hasLowDrawdown && isStable;
    });
    
    // Remove highly correlated factors
    const correlations = await this.calculateCorrelations(selectedFactors);
    const finalFactors: Factor[] = [];
    const used = new Set<string>();
    
    for (const factor of selectedFactors) {
      if (used.has(factor.id)) continue;
      
      // Check correlations with already selected factors
      let highlyCorrelated = false;
      for (const selected of finalFactors) {
        const corr = correlations.find(c => 
          (c.factorId1 === factor.id && c.factorId2 === selected.id) ||
          (c.factorId2 === factor.id && c.factorId1 === selected.id)
        );
        
        if (corr && Math.abs(corr.correlation) > 0.8) {
          highlyCorrelated = true;
          break;
        }
      }
      
      if (!highlyCorrelated) {
        finalFactors.push(factor);
        used.add(factor.id);
      }
    }
    
    this.logger.info(`Selected ${finalFactors.length} factors from ${factors.length}`);
    
    return finalFactors;
  }
  
  /**
   * Build correlation matrix
   */
  private async buildCorrelationMatrix(factors: Factor[]): Promise<number[][]> {
    const n = factors.length;
    const matrix: number[][] = Array(n).fill(0).map(() => Array(n).fill(0));
    
    const factorData = await this.loadFactorData(factors);
    
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) {
          matrix[i][j] = 1;
        } else {
          matrix[i][j] = this.calculateCorrelation(
            factorData[i].values,
            factorData[j].values
          );
        }
      }
    }
    
    return matrix;
  }
  
  /**
   * Perform PCA
   */
  private performPCA(correlationMatrix: number[][]): any {
    const n = correlationMatrix.length;
    
    // Simplified PCA - in production would use proper library
    // Calculate eigenvalues and eigenvectors
    const eigenResult = this.calculateEigenvalues(correlationMatrix);
    
    // Sort by eigenvalue
    const sorted = eigenResult.values
      .map((value: number, index: number) => ({ value, vector: eigenResult.vectors[index] }))
      .sort((a: any, b: any) => b.value - a.value);
    
    // Calculate explained variance
    const totalVariance = sorted.reduce((sum: number, item: any) => sum + item.value, 0);
    const explainedVariance = sorted.map((item: any) => item.value / totalVariance);
    
    // Select components that explain 95% of variance
    let cumulative = 0;
    const components = [];
    for (let i = 0; i < sorted.length; i++) {
      components.push(sorted[i].vector);
      cumulative += explainedVariance[i];
      if (cumulative > 0.95) break;
    }
    
    return {
      components,
      explainedVariance: explainedVariance.slice(0, components.length),
      eigenvalues: sorted.map((item: any) => item.value).slice(0, components.length)
    };
  }
  
  /**
   * Calculate factor weights
   */
  private calculateFactorWeights(factors: Factor[], pcaResult: any): { [factorId: string]: number } {
    const weights: { [factorId: string]: number } = {};
    
    // Use first principal component for weights
    const firstPC = pcaResult.components[0];
    const sumAbsWeights = firstPC.reduce((sum: number, w: number) => sum + Math.abs(w), 0);
    
    factors.forEach((factor, i) => {
      weights[factor.id] = firstPC[i] / sumAbsWeights;
    });
    
    return weights;
  }
  
  /**
   * Prepare data for analysis
   */
  private prepareData(data: any): { returns: number[], factorData: any } {
    // Extract returns and align with factor data
    // In production, would handle missing data, alignment, etc.
    
    const returns = data.returns || this.generateSyntheticReturns(100);
    const factorData: any = {};
    
    for (const factorId in data.factors) {
      factorData[factorId] = data.factors[factorId] || this.generateSyntheticFactorData(100);
    }
    
    return { returns, factorData };
  }
  
  /**
   * Perform regression analysis
   */
  private performRegression(
    returns: number[],
    factorData: any,
    factors: Factor[]
  ): RegressionResult {
    const n = returns.length;
    const k = factors.length;
    
    // Build design matrix
    const X: number[][] = Array(n).fill(0).map(() => Array(k + 1).fill(1)); // +1 for intercept
    
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < k; j++) {
        X[i][j + 1] = factorData[factors[j].id][i];
      }
    }
    
    // OLS regression: β = (X'X)^(-1)X'y
    const XtX = this.matrixMultiply(this.transpose(X), X);
    const XtXinv = this.matrixInverse(XtX);
    const Xty = this.matrixVectorMultiply(this.transpose(X), returns);
    const beta = this.matrixVectorMultiply(XtXinv, Xty);
    
    // Calculate residuals
    const fitted = this.matrixVectorMultiply(X, beta);
    const residuals = returns.map((r, i) => r - fitted[i]);
    
    // Calculate R-squared
    const yMean = this.mean(returns);
    const ssTotal = returns.reduce((sum, y) => sum + Math.pow(y - yMean, 2), 0);
    const ssResidual = residuals.reduce((sum, e) => sum + e * e, 0);
    const rSquared = 1 - ssResidual / ssTotal;
    
    // Adjusted R-squared
    const adjustedRSquared = 1 - (1 - rSquared) * (n - 1) / (n - k - 1);
    
    // Standard errors and p-values
    const mse = ssResidual / (n - k - 1);
    const varCovar = XtXinv.map(row => row.map(val => val * mse));
    const standardErrors = varCovar.map((row, i) => Math.sqrt(row[i]));
    
    // Build result
    const coefficients: { [factorId: string]: number } = {};
    const pValues: { [factorId: string]: number } = {};
    const ses: { [factorId: string]: number } = {};
    
    factors.forEach((factor, i) => {
      coefficients[factor.id] = beta[i + 1];
      const tStat = beta[i + 1] / standardErrors[i + 1];
      pValues[factor.id] = this.calculatePValue(tStat, n - k - 1);
      ses[factor.id] = standardErrors[i + 1];
    });
    
    return {
      coefficients,
      intercept: beta[0],
      rSquared,
      adjustedRSquared,
      pValues,
      standardErrors: ses
    };
  }
  
  /**
   * Calculate factor exposures
   */
  private calculateExposures(
    regression: RegressionResult,
    model: FactorModel
  ): FactorExposure[] {
    const exposures: FactorExposure[] = [];
    
    for (const factor of model.factors) {
      const coefficient = regression.coefficients[factor.id];
      const pValue = regression.pValues[factor.id];
      
      exposures.push({
        factorId: factor.id,
        exposure: coefficient,
        tStatistic: coefficient / regression.standardErrors[factor.id],
        pValue,
        contribution: coefficient * (Array.isArray(model.weights) ? 1 : (model.weights[factor.id] || 1)),
        isSignificant: pValue < 0.05
      });
    }
    
    return exposures;
  }
  
  /**
   * Analyze factor performance
   */
  private async analyzeFactorPerformance(
    factors: Factor[],
    factorData: any,
    returns: number[]
  ): Promise<FactorPerformance[]> {
    const performances: FactorPerformance[] = [];
    
    for (const factor of factors) {
      const factorReturns = this.calculateFactorReturns(factorData[factor.id]);
      
      // Calculate performance metrics
      const sharpeRatio = this.calculateSharpeRatio(factorReturns);
      const informationRatio = this.calculateInformationRatio(factorReturns, returns);
      const correlation = this.calculateCorrelation(factorReturns, returns);
      
      // Calculate rolling performance
      const rollingWindow = 60; // 60 periods
      const rollingSharpe = this.calculateRollingSharpe(factorReturns, rollingWindow);
      const stability = this.standardDeviation(rollingSharpe);
      
      performances.push({
        factorId: factor.id,
        returns: this.mean(factorReturns) * 252, // Annualized
        volatility: this.standardDeviation(factorReturns) * Math.sqrt(252),
        sharpeRatio,
        informationRatio,
        maxDrawdown: this.calculateMaxDrawdown(factorReturns),
        correlation,
        stability: 1 / (1 + stability), // Higher is more stable
        significance: Math.abs(correlation) * sharpeRatio
      });
    }
    
    return performances;
  }
  
  /**
   * Calculate risk attribution
   */
  private calculateRiskAttribution(
    exposures: FactorExposure[],
    correlationMatrix: number[][]
  ): any {
    const factorRisks: { [factorId: string]: number } = {};
    const totalRisk = 0.15; // Assumed portfolio volatility
    
    // Calculate factor contributions to risk
    let totalContribution = 0;
    
    for (let i = 0; i < exposures.length; i++) {
      let factorRisk = 0;
      
      for (let j = 0; j < exposures.length; j++) {
        factorRisk += exposures[i].exposure * exposures[j].exposure * correlationMatrix[i][j];
      }
      
      factorRisks[exposures[i].factorId] = Math.sqrt(Math.max(0, factorRisk));
      totalContribution += factorRisks[exposures[i].factorId];
    }
    
    // Normalize to percentage
    const riskAttribution: { [factorId: string]: number } = {};
    
    for (const factorId in factorRisks) {
      riskAttribution[factorId] = totalContribution > 0
        ? factorRisks[factorId] / totalContribution
        : 0;
    }
    
    return {
      factorRisks,
      riskAttribution,
      totalRisk,
      diversificationRatio: totalContribution > 0 ? totalRisk / totalContribution : 1
    };
  }
  
  /**
   * Generate insights
   */
  private generateInsights(
    regression: RegressionResult,
    performance: FactorPerformance[],
    riskAttribution: any
  ): string[] {
    const insights: string[] = [];
    
    // Model fit insights
    if (regression.rSquared > 0.7) {
      insights.push(`Strong model fit with R² of ${(regression.rSquared * 100).toFixed(1)}%`);
    } else if (regression.rSquared < 0.3) {
      insights.push(`Weak model fit (R² = ${(regression.rSquared * 100).toFixed(1)}%) - consider additional factors`);
    }
    
    // Factor significance
    const significantFactors = Object.entries(regression.pValues)
      .filter(([_, pValue]) => pValue < 0.05)
      .map(([factorId, _]) => factorId);
    
    if (significantFactors.length > 0) {
      insights.push(`${significantFactors.length} factors show statistical significance`);
    }
    
    // Performance insights
    const topPerformers = performance
      .sort((a, b) => (b.sharpeRatio || 0) - (a.sharpeRatio || 0))
      .slice(0, 3);
    
    for (const perf of topPerformers) {
      insights.push(`Factor ${perf.factorId}: Sharpe ${(perf.sharpeRatio || 0).toFixed(2)}, IC ${(perf.informationRatio || 0).toFixed(2)}`);
    }
    
    // Risk insights
    const concentratedRisks = Object.entries(riskAttribution.riskAttribution)
      .filter(([_, risk]) => (risk as number) > 0.3)
      .map(([factorId, risk]) => ({ factorId, risk: risk as number }));
    
    if (concentratedRisks.length > 0) {
      insights.push(`Risk concentration warning: ${concentratedRisks[0].factorId} contributes ${(concentratedRisks[0].risk * 100).toFixed(1)}% of risk`);
    }
    
    // Diversification
    if (riskAttribution.diversificationRatio > 1.5) {
      insights.push(`Good diversification with ratio of ${riskAttribution.diversificationRatio.toFixed(2)}`);
    }
    
    return insights;
  }
  
  /**
   * Generate recommendations
   */
  private generateRecommendations(insights: string[]): string[] {
    const recommendations: string[] = [];
    
    // Based on insights, generate actionable recommendations
    if (insights.some(i => i.includes('Weak model fit'))) {
      recommendations.push('Consider adding momentum or sentiment factors to improve model fit');
    }
    
    if (insights.some(i => i.includes('Risk concentration'))) {
      recommendations.push('Reduce exposure to concentrated factors or add hedging positions');
    }
    
    if (insights.some(i => i.includes('Good diversification'))) {
      recommendations.push('Current factor mix provides good diversification - maintain allocations');
    }
    
    // Always add some general recommendations
    recommendations.push('Monitor factor stability over rolling windows');
    recommendations.push('Rebalance factor exposures monthly based on regime');
    
    return recommendations;
  }
  
  /**
   * Load factor data
   */
  private async loadFactorData(factors: Factor[]): Promise<FactorTimeSeries[]> {
    const data: FactorTimeSeries[] = [];
    
    for (const factor of factors) {
      // Check cache
      if (this.factorCache.has(factor.id)) {
        data.push(this.factorCache.get(factor.id)!);
        continue;
      }
      
      // Generate synthetic data for demo
      const timeSeries: FactorTimeSeries = {
        factor,
        values: this.generateSyntheticFactorData(252), // 1 year daily
        timestamps: this.generateTimestamps(252)
      };
      
      this.factorCache.set(factor.id, timeSeries);
      data.push(timeSeries);
    }
    
    return data;
  }
  
  /**
   * Helper: Generate synthetic returns
   */
  private generateSyntheticReturns(n: number): number[] {
    const returns: number[] = [];
    const mu = 0.0005; // Daily return
    const sigma = 0.02; // Daily volatility
    
    for (let i = 0; i < n; i++) {
      returns.push(this.randomNormal(mu, sigma));
    }
    
    return returns;
  }
  
  /**
   * Helper: Generate synthetic factor data
   */
  private generateSyntheticFactorData(n: number): number[] {
    const data: number[] = [];
    let value = 0;
    
    for (let i = 0; i < n; i++) {
      value += this.randomNormal(0, 0.1);
      data.push(value);
    }
    
    return data;
  }
  
  /**
   * Helper: Generate timestamps
   */
  private generateTimestamps(n: number): Date[] {
    const timestamps: Date[] = [];
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    
    for (let i = n - 1; i >= 0; i--) {
      timestamps.push(new Date(now - i * dayMs));
    }
    
    return timestamps;
  }
  
  /**
   * Helper: Calculate factor returns
   */
  private calculateFactorReturns(values: number[]): number[] {
    const returns: number[] = [];
    
    for (let i = 1; i < values.length; i++) {
      returns.push((values[i] - values[i - 1]) / Math.abs(values[i - 1] + 1));
    }
    
    return returns;
  }
  
  /**
   * Helper: Calculate rolling Sharpe
   */
  private calculateRollingSharpe(returns: number[], window: number): number[] {
    const rollingSharpe: number[] = [];
    
    for (let i = window; i < returns.length; i++) {
      const windowReturns = returns.slice(i - window, i);
      rollingSharpe.push(this.calculateSharpeRatio(windowReturns));
    }
    
    return rollingSharpe;
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
  
  private calculateSharpeRatio(returns: number[]): number {
    const avgReturn = this.mean(returns);
    const vol = this.standardDeviation(returns);
    return vol > 0 ? (avgReturn * Math.sqrt(252)) / (vol * Math.sqrt(252)) : 0;
  }
  
  private calculateInformationRatio(returns: number[], benchmark?: number[]): number {
    if (!benchmark || benchmark.length !== returns.length) {
      return this.calculateSharpeRatio(returns);
    }
    
    const activeReturns = returns.map((r, i) => r - benchmark[i]);
    return this.calculateSharpeRatio(activeReturns);
  }
  
  private calculateMaxDrawdown(values: number[]): number {
    let peak = values[0];
    let maxDrawdown = 0;
    
    for (const value of values) {
      if (value > peak) peak = value;
      const drawdown = (peak - value) / Math.abs(peak);
      maxDrawdown = Math.max(maxDrawdown, drawdown);
    }
    
    return maxDrawdown;
  }
  
  private calculateCorrelationPValue(correlation: number, n: number): number {
    const t = correlation * Math.sqrt((n - 2) / (1 - correlation * correlation));
    return this.calculatePValue(t, n - 2);
  }
  
  private calculatePValue(tStat: number, df: number): number {
    // Simplified p-value calculation
    // In production would use proper t-distribution
    const z = Math.abs(tStat) / Math.sqrt(1 + tStat * tStat / df);
    return 2 * (1 - this.normalCDF(z));
  }
  
  private normalCDF(x: number): number {
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;
    
    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x) / Math.sqrt(2);
    
    const t = 1 / (1 + p * x);
    const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    
    return 0.5 * (1 + sign * y);
  }
  
  private randomNormal(mu: number, sigma: number): number {
    const u1 = Math.random();
    const u2 = Math.random();
    const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mu + sigma * z0;
  }
  
  /**
   * Matrix operations
   */
  private transpose(matrix: number[][]): number[][] {
    return matrix[0].map((_, i) => matrix.map(row => row[i]));
  }
  
  private matrixMultiply(a: number[][], b: number[][]): number[][] {
    const result: number[][] = Array(a.length).fill(0).map(() => Array(b[0].length).fill(0));
    
    for (let i = 0; i < a.length; i++) {
      for (let j = 0; j < b[0].length; j++) {
        for (let k = 0; k < b.length; k++) {
          result[i][j] += a[i][k] * b[k][j];
        }
      }
    }
    
    return result;
  }
  
  private matrixVectorMultiply(matrix: number[][], vector: number[]): number[] {
    return matrix.map(row => 
      row.reduce((sum, val, i) => sum + val * vector[i], 0)
    );
  }
  
  private matrixInverse(matrix: number[][]): number[][] {
    // Simplified matrix inversion using Gauss-Jordan
    // In production would use optimized library
    const n = matrix.length;
    const augmented: number[][] = matrix.map((row, i) => 
      [...row, ...Array(n).fill(0).map((_, j) => i === j ? 1 : 0)]
    );
    
    // Forward elimination
    for (let i = 0; i < n; i++) {
      // Find pivot
      let maxRow = i;
      for (let k = i + 1; k < n; k++) {
        if (Math.abs(augmented[k][i]) > Math.abs(augmented[maxRow][i])) {
          maxRow = k;
        }
      }
      
      // Swap rows
      [augmented[i], augmented[maxRow]] = [augmented[maxRow], augmented[i]];
      
      // Make diagonal 1
      const pivot = augmented[i][i];
      for (let j = 0; j < 2 * n; j++) {
        augmented[i][j] /= pivot;
      }
      
      // Eliminate column
      for (let k = 0; k < n; k++) {
        if (k !== i) {
          const factor = augmented[k][i];
          for (let j = 0; j < 2 * n; j++) {
            augmented[k][j] -= factor * augmented[i][j];
          }
        }
      }
    }
    
    // Extract inverse
    return augmented.map(row => row.slice(n));
  }
  
  private calculateEigenvalues(matrix: number[][]): any {
    // Simplified eigenvalue calculation
    // In production would use proper numerical methods
    const n = matrix.length;
    
    // Power iteration for largest eigenvalue
    let vector = Array(n).fill(1 / Math.sqrt(n));
    let eigenvalue = 0;
    
    for (let iter = 0; iter < 100; iter++) {
      const newVector = this.matrixVectorMultiply(matrix, vector);
      eigenvalue = Math.sqrt(newVector.reduce((sum, v) => sum + v * v, 0));
      vector = newVector.map(v => v / eigenvalue);
    }
    
    return {
      values: [eigenvalue], // Simplified - only largest
      vectors: [vector]
    };
  }
} 