/**
 * CausalFeatureSelector - Causal Inference for Feature Selection
 * 
 * Implements causal discovery algorithms to identify true causal relationships
 * and filter out spurious correlations in trading features
 */

import { EventEmitter } from 'events';
import { Logger } from 'winston';
import * as stats from 'simple-statistics';
import { Matrix } from 'ml-matrix';
import { 
  CausalRelationship, 
  FeatureCausality 
} from '@noderr/types';

interface CausalConfig {
  method: 'granger' | 'pc' | 'dowhy';
  confidenceLevel: number;
  lagOrder: number;
  maxConditioningSetSize?: number;
  bootstrapSamples?: number;
  significanceThreshold?: number;
}

interface FeatureData {
  name: string;
  values: number[];
  timestamps: number[];
}

export class CausalFeatureSelector extends EventEmitter {
  private logger: Logger;
  private config: CausalConfig;
  private featureRelationships: Map<string, FeatureCausality> = new Map();
  private causalGraph: Map<string, Set<string>> = new Map();
  
  constructor(logger: Logger, config: CausalConfig) {
    super();
    this.logger = logger;
    this.config = {
      maxConditioningSetSize: 3,
      bootstrapSamples: 100,
      significanceThreshold: 0.05,
      ...config
    };
  }
  
  /**
   * Analyze causal relationships between features
   */
  async analyzeCausality(features: FeatureData[]): Promise<FeatureCausality[]> {
    this.logger.info('Analyzing causal relationships', {
      featureCount: features.length,
      method: this.config.method
    });
    
    try {
      let relationships: CausalRelationship[] = [];
      
      switch (this.config.method) {
        case 'granger':
          relationships = await this.grangerCausalityAnalysis(features);
          break;
        
        case 'pc':
          relationships = await this.pcAlgorithmAnalysis(features);
          break;
        
        case 'dowhy':
          relationships = await this.dowhyAnalysis(features);
          break;
        
        default:
          throw new Error(`Unknown causal method: ${this.config.method}`);
      }
      
      // Build feature causality map
      const featureCausalities = this.buildFeatureCausalities(features, relationships);
      
      // Filter spurious relationships
      const filtered = this.filterSpuriousRelationships(featureCausalities);
      
      // Update internal state
      filtered.forEach(fc => {
        this.featureRelationships.set(fc.feature, fc);
      });
      
      // Build causal graph
      this.buildCausalGraph(relationships);
      
      // Emit results
      this.emit('causality:analyzed', filtered);
      
      return filtered;
      
    } catch (error) {
      this.logger.error('Causal analysis failed', { error });
      throw error;
    }
  }
  
  /**
   * Granger causality test
   */
  private async grangerCausalityAnalysis(features: FeatureData[]): Promise<CausalRelationship[]> {
    const relationships: CausalRelationship[] = [];
    
    // Test pairwise Granger causality
    for (let i = 0; i < features.length; i++) {
      for (let j = 0; j < features.length; j++) {
        if (i === j) continue;
        
        const cause = features[i];
        const effect = features[j];
        
        // Align time series
        const aligned = this.alignTimeSeries(cause, effect);
        if (aligned.length < this.config.lagOrder * 2) continue;
        
        // Perform Granger test
        const result = this.grangerTest(
          aligned.map(d => d.cause),
          aligned.map(d => d.effect),
          this.config.lagOrder
        );
        
        if (result.pValue < this.config.significanceThreshold!) {
          relationships.push({
            cause: cause.name,
            effect: effect.name,
            strength: result.fStatistic,
            pValue: result.pValue,
            lag: this.config.lagOrder,
            confidence: 1 - result.pValue,
            method: 'granger'
          });
        }
      }
    }
    
    return relationships;
  }
  
  /**
   * PC (Peter-Clark) algorithm for causal discovery
   */
  private async pcAlgorithmAnalysis(features: FeatureData[]): Promise<CausalRelationship[]> {
    const relationships: CausalRelationship[] = [];
    const n = features.length;
    
    // Step 1: Start with complete graph
    const skeleton: boolean[][] = Array(n).fill(null).map(() => Array(n).fill(true));
    for (let i = 0; i < n; i++) {
      skeleton[i][i] = false; // No self-loops
    }
    
    // Step 2: Remove edges based on conditional independence
    for (let condSize = 0; condSize <= Math.min(n - 2, this.config.maxConditioningSetSize!); condSize++) {
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          if (!skeleton[i][j]) continue;
          
          // Test conditional independence
          const independent = await this.testConditionalIndependence(
            features[i],
            features[j],
            features,
            condSize
          );
          
          if (independent) {
            skeleton[i][j] = false;
            skeleton[j][i] = false;
          }
        }
      }
    }
    
    // Step 3: Orient edges (simplified)
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (!skeleton[i][j]) continue;
        
        // Simple orientation based on variance reduction
        const strength = this.calculateCausalStrength(features[i], features[j]);
        
        relationships.push({
          cause: features[i].name,
          effect: features[j].name,
          strength: strength.coefficient,
          pValue: strength.pValue,
          lag: 1,
          confidence: strength.confidence,
          method: 'pc'
        });
      }
    }
    
    return relationships;
  }
  
  /**
   * DoWhy-style causal analysis (simplified)
   */
  private async dowhyAnalysis(features: FeatureData[]): Promise<CausalRelationship[]> {
    const relationships: CausalRelationship[] = [];
    
    // For each potential cause-effect pair
    for (let i = 0; i < features.length; i++) {
      for (let j = 0; j < features.length; j++) {
        if (i === j) continue;
        
        const cause = features[i];
        const effect = features[j];
        
        // Estimate causal effect using different methods
        const estimates = await Promise.all([
          this.estimateWithPropensityScore(cause, effect, features),
          this.estimateWithInstrumentalVariable(cause, effect, features),
          this.estimateWithRegression(cause, effect, features)
        ]);
        
        // Aggregate estimates
        const validEstimates = estimates.filter(e => e !== null);
        if (validEstimates.length === 0) continue;
        
        const avgEffect = validEstimates.reduce((a, b) => a + b!.effect, 0) / validEstimates.length;
        const avgPValue = validEstimates.reduce((a, b) => a + b!.pValue, 0) / validEstimates.length;
        
        if (avgPValue < this.config.significanceThreshold!) {
          relationships.push({
            cause: cause.name,
            effect: effect.name,
            strength: Math.abs(avgEffect),
            pValue: avgPValue,
            lag: 1,
            confidence: 1 - avgPValue,
            method: 'dowhy'
          });
        }
      }
    }
    
    return relationships;
  }
  
  /**
   * Granger causality test implementation
   */
  private grangerTest(x: number[], y: number[], lag: number): { fStatistic: number; pValue: number } {
    const n = x.length;
    
    // Create lagged variables
    const xLags: number[][] = [];
    const yLags: number[][] = [];
    
    for (let l = 1; l <= lag; l++) {
      xLags.push(x.slice(0, n - l));
      yLags.push(y.slice(0, n - l));
    }
    
    const yTrunc = y.slice(lag);
    
    // Restricted model: Y ~ Y_lags
    const restrictedRSS = this.calculateRSS(yTrunc, yLags);
    
    // Unrestricted model: Y ~ Y_lags + X_lags
    const unrestrictedRSS = this.calculateRSS(yTrunc, [...yLags, ...xLags]);
    
    // F-statistic
    const k = lag; // Number of restrictions
    const df2 = n - 2 * lag - 1;
    const fStatistic = ((restrictedRSS - unrestrictedRSS) / k) / (unrestrictedRSS / df2);
    
    // Approximate p-value (would use proper F-distribution in production)
    const pValue = Math.exp(-fStatistic / 2);
    
    return { fStatistic, pValue: Math.min(1, Math.max(0, pValue)) };
  }
  
  /**
   * Calculate residual sum of squares
   */
  private calculateRSS(y: number[], predictors: number[][]): number {
    // Simple OLS regression
    const X = new Matrix(predictors[0].map((_, i) => predictors.map(p => p[i])));
    const Y = Matrix.columnVector(y);
    
    try {
      // Beta = (X'X)^-1 X'Y
      const XtX = X.transpose().mmul(X);
      const XtY = X.transpose().mmul(Y);
      const beta = XtX.inverse().mmul(XtY);
      
      // Residuals = Y - X*beta
      const predictions = X.mmul(beta);
      const residuals = Y.sub(predictions);
      
      // RSS = residuals' * residuals
      return residuals.transpose().mmul(residuals).get(0, 0);
    } catch {
      // Return large RSS if regression fails
      return Infinity;
    }
  }
  
  /**
   * Test conditional independence
   */
  private async testConditionalIndependence(
    x: FeatureData,
    y: FeatureData,
    allFeatures: FeatureData[],
    conditioningSetSize: number
  ): Promise<boolean> {
    // Align time series
    const aligned = this.alignTimeSeries(x, y);
    if (aligned.length < 50) return false; // Not enough data
    
    // Simple correlation test (would use partial correlation in production)
    const correlation = stats.sampleCorrelation(
      aligned.map(d => d.cause),
      aligned.map(d => d.effect)
    );
    
    // Fisher's z-transformation for testing
    const z = 0.5 * Math.log((1 + correlation) / (1 - correlation));
    const se = 1 / Math.sqrt(aligned.length - 3);
    const pValue = 2 * (1 - this.normalCDF(Math.abs(z) / se));
    
    return pValue > this.config.significanceThreshold!;
  }
  
  /**
   * Calculate causal strength
   */
  private calculateCausalStrength(
    cause: FeatureData, 
    effect: FeatureData
  ): { coefficient: number; pValue: number; confidence: number } {
    const aligned = this.alignTimeSeries(cause, effect);
    
    if (aligned.length < 30) {
      return { coefficient: 0, pValue: 1, confidence: 0 };
    }
    
    // Simple linear regression
    const x = aligned.map(d => d.cause);
    const y = aligned.map(d => d.effect);
    
    const regression = stats.linearRegression([x, y]);
    const correlation = stats.sampleCorrelation(x, y);
    
    // Approximate p-value
    const t = correlation * Math.sqrt((aligned.length - 2) / (1 - correlation * correlation));
    const pValue = 2 * (1 - this.tCDF(Math.abs(t), aligned.length - 2));
    
    return {
      coefficient: Math.abs(regression.m),
      pValue,
      confidence: 1 - pValue
    };
  }
  
  /**
   * Propensity score estimation
   */
  private async estimateWithPropensityScore(
    treatment: FeatureData,
    outcome: FeatureData,
    covariates: FeatureData[]
  ): Promise<{ effect: number; pValue: number } | null> {
    // Simplified propensity score matching
    const aligned = this.alignTimeSeries(treatment, outcome);
    if (aligned.length < 50) return null;
    
    // Discretize treatment
    const median = stats.median(aligned.map(d => d.cause));
    const treated = aligned.filter(d => d.cause > median);
    const control = aligned.filter(d => d.cause <= median);
    
    if (treated.length < 10 || control.length < 10) return null;
    
    // Simple difference in means
    const treatedOutcome = stats.mean(treated.map(d => d.effect));
    const controlOutcome = stats.mean(control.map(d => d.effect));
    const effect = treatedOutcome - controlOutcome;
    
    // T-test for significance
    const pooledStd = Math.sqrt(
      (stats.variance(treated.map(d => d.effect)) + 
       stats.variance(control.map(d => d.effect))) / 2
    );
    
    const se = pooledStd * Math.sqrt(1/treated.length + 1/control.length);
    const t = effect / se;
    const pValue = 2 * (1 - this.tCDF(Math.abs(t), treated.length + control.length - 2));
    
    return { effect, pValue };
  }
  
  /**
   * Instrumental variable estimation (simplified)
   */
  private async estimateWithInstrumentalVariable(
    treatment: FeatureData,
    outcome: FeatureData,
    features: FeatureData[]
  ): Promise<{ effect: number; pValue: number } | null> {
    // Find potential instrument (most correlated with treatment, least with outcome)
    let bestInstrument: FeatureData | null = null;
    let bestScore = -Infinity;
    
    for (const feature of features) {
      if (feature.name === treatment.name || feature.name === outcome.name) continue;
      
      const treatmentCorr = Math.abs(this.calculateCorrelation(feature, treatment));
      const outcomeCorr = Math.abs(this.calculateCorrelation(feature, outcome));
      
      const score = treatmentCorr - outcomeCorr;
      if (score > bestScore && treatmentCorr > 0.3) {
        bestScore = score;
        bestInstrument = feature;
      }
    }
    
    if (!bestInstrument) return null;
    
    // Two-stage least squares (simplified)
    const aligned = this.alignThreeTimeSeries(bestInstrument, treatment, outcome);
    if (aligned.length < 50) return null;
    
    // First stage: Treatment ~ Instrument
    const stage1 = stats.linearRegression([
      aligned.map(d => d.instrument),
      aligned.map(d => d.treatment)
    ]);
    
    // Predicted treatment
    const predictedTreatment = aligned.map(d => stage1.m * d.instrument + stage1.b);
    
    // Second stage: Outcome ~ Predicted Treatment
    const stage2 = stats.linearRegression([predictedTreatment, aligned.map(d => d.outcome)]);
    
    // Approximate standard error and p-value
    const se = Math.abs(stage2.m) / Math.sqrt(aligned.length);
    const t = stage2.m / se;
    const pValue = 2 * (1 - this.tCDF(Math.abs(t), aligned.length - 2));
    
    return { effect: stage2.m, pValue };
  }
  
  /**
   * Simple regression estimation
   */
  private async estimateWithRegression(
    cause: FeatureData,
    effect: FeatureData,
    features: FeatureData[]
  ): Promise<{ effect: number; pValue: number } | null> {
    const aligned = this.alignTimeSeries(cause, effect);
    if (aligned.length < 30) return null;
    
    const regression = stats.linearRegression([
      aligned.map(d => d.cause),
      aligned.map(d => d.effect)
    ]);
    
    // Calculate R-squared
    const yMean = stats.mean(aligned.map(d => d.effect));
    const predictions = aligned.map(d => regression.m * d.cause + regression.b);
    
    const ssTotal = aligned.reduce((sum, d) => sum + Math.pow(d.effect - yMean, 2), 0);
    const ssResidual = aligned.reduce((sum, d, i) => sum + Math.pow(d.effect - predictions[i], 2), 0);
    const rSquared = 1 - ssResidual / ssTotal;
    
    // F-statistic for significance
    const fStatistic = (rSquared / 1) / ((1 - rSquared) / (aligned.length - 2));
    const pValue = Math.exp(-fStatistic / 10); // Approximate
    
    return { effect: regression.m, pValue: Math.min(1, Math.max(0, pValue)) };
  }
  
  /**
   * Build feature causality summaries
   */
  private buildFeatureCausalities(
    features: FeatureData[],
    relationships: CausalRelationship[]
  ): FeatureCausality[] {
    const causalities: Map<string, FeatureCausality> = new Map();
    
    // Initialize
    for (const feature of features) {
      causalities.set(feature.name, {
        feature: feature.name,
        causes: [],
        effects: [],
        spurious: false,
        stability: 1.0
      });
    }
    
    // Add relationships
    for (const rel of relationships) {
      const causeFeature = causalities.get(rel.cause);
      const effectFeature = causalities.get(rel.effect);
      
      if (causeFeature) {
        causeFeature.effects.push(rel);
      }
      
      if (effectFeature) {
        effectFeature.causes.push(rel);
      }
    }
    
    return Array.from(causalities.values());
  }
  
  /**
   * Filter spurious relationships
   */
  private filterSpuriousRelationships(causalities: FeatureCausality[]): FeatureCausality[] {
    // Mark spurious based on:
    // 1. Circular dependencies
    // 2. Too many causes/effects
    // 3. Weak relationships
    
    for (const causality of causalities) {
      // Check for circular dependencies
      const hasCircular = this.hasCircularDependency(causality, causalities);
      
      // Check for too many relationships
      const tooManyRelationships = 
        causality.causes.length > 10 || 
        causality.effects.length > 10;
      
      // Check average strength
      const avgStrength = [
        ...causality.causes.map(c => c.strength),
        ...causality.effects.map(e => e.strength)
      ].reduce((a, b, i, arr) => a + b / arr.length, 0);
      
      const weakRelationships = avgStrength < 0.1;
      
      // Mark as spurious
      causality.spurious = hasCircular || tooManyRelationships || weakRelationships;
      
      // Calculate stability
      causality.stability = this.calculateStability(causality);
    }
    
    return causalities;
  }
  
  /**
   * Check for circular dependencies
   */
  private hasCircularDependency(
    feature: FeatureCausality,
    allFeatures: FeatureCausality[]
  ): boolean {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    
    const dfs = (current: string): boolean => {
      visited.add(current);
      recursionStack.add(current);
      
      const currentFeature = allFeatures.find(f => f.feature === current);
      if (!currentFeature) return false;
      
      for (const effect of currentFeature.effects) {
        if (!visited.has(effect.effect)) {
          if (dfs(effect.effect)) return true;
        } else if (recursionStack.has(effect.effect)) {
          return true;
        }
      }
      
      recursionStack.delete(current);
      return false;
    };
    
    return dfs(feature.feature);
  }
  
  /**
   * Calculate feature stability score
   */
  private calculateStability(causality: FeatureCausality): number {
    // Factors: consistency of relationships, strength, confidence
    let score = 1.0;
    
    // Penalize if marked as spurious
    if (causality.spurious) score *= 0.5;
    
    // Reward strong relationships
    const avgConfidence = [
      ...causality.causes.map(c => c.confidence),
      ...causality.effects.map(e => e.confidence)
    ].reduce((a, b, i, arr) => a + b / arr.length, 0) || 0;
    
    score *= avgConfidence;
    
    // Penalize too many weak relationships
    const weakCount = [
      ...causality.causes,
      ...causality.effects
    ].filter(r => r.confidence < 0.8).length;
    
    score *= Math.exp(-weakCount / 10);
    
    return Math.max(0, Math.min(1, score));
  }
  
  /**
   * Build causal graph for visualization
   */
  private buildCausalGraph(relationships: CausalRelationship[]): void {
    this.causalGraph.clear();
    
    for (const rel of relationships) {
      if (!this.causalGraph.has(rel.cause)) {
        this.causalGraph.set(rel.cause, new Set());
      }
      this.causalGraph.get(rel.cause)!.add(rel.effect);
    }
  }
  
  /**
   * Utility functions
   */
  private alignTimeSeries(x: FeatureData, y: FeatureData): Array<{ cause: number; effect: number }> {
    const aligned: Array<{ cause: number; effect: number }> = [];
    
    let i = 0, j = 0;
    while (i < x.timestamps.length && j < y.timestamps.length) {
      if (Math.abs(x.timestamps[i] - y.timestamps[j]) < 1000) { // 1 second tolerance
        aligned.push({
          cause: x.values[i],
          effect: y.values[j]
        });
        i++;
        j++;
      } else if (x.timestamps[i] < y.timestamps[j]) {
        i++;
      } else {
        j++;
      }
    }
    
    return aligned;
  }
  
  private alignThreeTimeSeries(
    instrument: FeatureData,
    treatment: FeatureData,
    outcome: FeatureData
  ): Array<{ instrument: number; treatment: number; outcome: number }> {
    const aligned: Array<{ instrument: number; treatment: number; outcome: number }> = [];
    
    // Simple alignment (would be more sophisticated in production)
    const minLength = Math.min(
      instrument.values.length,
      treatment.values.length,
      outcome.values.length
    );
    
    for (let i = 0; i < minLength; i++) {
      aligned.push({
        instrument: instrument.values[i],
        treatment: treatment.values[i],
        outcome: outcome.values[i]
      });
    }
    
    return aligned;
  }
  
  private calculateCorrelation(x: FeatureData, y: FeatureData): number {
    const aligned = this.alignTimeSeries(x, y);
    if (aligned.length < 10) return 0;
    
    return stats.sampleCorrelation(
      aligned.map(d => d.cause),
      aligned.map(d => d.effect)
    );
  }
  
  private normalCDF(z: number): number {
    // Approximate normal CDF
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
  
  private tCDF(t: number, df: number): number {
    // Approximate t-distribution CDF
    // For large df, approaches normal
    if (df > 30) {
      return this.normalCDF(t);
    }
    
    // Simple approximation for small df
    const x = df / (df + t * t);
    return 0.5 + 0.5 * Math.sign(t) * (1 - Math.pow(x, 0.5));
  }
  
  /**
   * Get non-spurious features
   */
  getNonSpuriousFeatures(): string[] {
    return Array.from(this.featureRelationships.values())
      .filter(fc => !fc.spurious)
      .map(fc => fc.feature);
  }
  
  /**
   * Get causal parents of a feature
   */
  getCausalParents(feature: string): string[] {
    const causality = this.featureRelationships.get(feature);
    if (!causality) return [];
    
    return causality.causes
      .filter(c => c.confidence > this.config.confidenceLevel)
      .map(c => c.cause);
  }
  
  /**
   * Get causal children of a feature
   */
  getCausalChildren(feature: string): string[] {
    const causality = this.featureRelationships.get(feature);
    if (!causality) return [];
    
    return causality.effects
      .filter(e => e.confidence > this.config.confidenceLevel)
      .map(e => e.effect);
  }
  
  /**
   * Export causal graph
   */
  exportCausalGraph(): { nodes: string[]; edges: Array<[string, string]> } {
    const nodes = Array.from(this.causalGraph.keys());
    const edges: Array<[string, string]> = [];
    
    for (const [from, tos] of this.causalGraph.entries()) {
      for (const to of tos) {
        edges.push([from, to]);
      }
    }
    
    return { nodes, edges };
  }
} 