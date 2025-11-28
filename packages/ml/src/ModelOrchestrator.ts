/**
 * ModelOrchestrator - Coordinates all AI models for unified predictions
 * Implements advanced model selection, ensemble strategies, and performance monitoring
 */

import { Logger } from 'winston';
import EventEmitter from 'events';
import {
  FeatureSet,
  PredictionResult,
  ModelConfig,
  ModelStatus,
  ModelPerformance,
  MarketRegime,
  TradingSignal,
  ConfidenceMetrics,
  MLError,
  MLErrorCode,
  ModelType,
  Predictions,
  FeatureImportance
} from './types';

interface ModelInstance {
  id: string;
  type: ModelType;
  model: any;
  config: ModelConfig;
  performance: ModelPerformance;
  lastPrediction?: PredictionResult;
  lastUpdate: number;
  weight: number;
  specialization?: string[];
}

interface EnsembleStrategy {
  type: 'weighted' | 'stacking' | 'voting' | 'blending' | 'dynamic';
  weights: Map<string, number>;
  metaModel?: any;
  threshold: number;
}

interface ModelSelection {
  primary: string;
  secondary: string[];
  rationale: string[];
  confidence: number;
}

interface PerformanceTracker {
  modelId: string;
  predictions: number;
  accuracy: number;
  sharpeRatio: number;
  recentPerformance: number[];
  drift: number;
  reliability: number;
}

interface OrchestratorState {
  models: Map<string, ModelInstance>;
  ensemble: EnsembleStrategy;
  performance: Map<string, PerformanceTracker>;
  marketRegime: MarketRegime;
  activeModels: Set<string>;
  status: ModelStatus;
}

export class ModelOrchestrator extends EventEmitter {
  private logger: Logger;
  private state: OrchestratorState;
  private predictionHistory: Map<string, PredictionResult[]>;
  private modelSelector: ModelSelector;
  private performanceMonitor: PerformanceMonitor;
  private ensembleBuilder: EnsembleBuilder;
  
  constructor(logger: Logger) {
    super();
    this.logger = logger;
    
    this.state = {
      models: new Map(),
      ensemble: {
        type: 'dynamic',
        weights: new Map(),
        threshold: 0.6
      },
      performance: new Map(),
      marketRegime: MarketRegime.RANGING,
      activeModels: new Set(),
      status: ModelStatus.READY
    };
    
    this.predictionHistory = new Map();
    this.modelSelector = new ModelSelector(logger);
    this.performanceMonitor = new PerformanceMonitor(logger);
    this.ensembleBuilder = new EnsembleBuilder(logger);
    
    this.setupEventHandlers();
  }
  
  /**
   * Setup internal event handlers
   */
  private setupEventHandlers(): void {
    this.performanceMonitor.on('performanceDrift', (data) => {
      this.handlePerformanceDrift(data);
    });
    
    this.modelSelector.on('modelSwitch', (data) => {
      this.handleModelSwitch(data);
    });
  }
  
  /**
   * Register a model with the orchestrator
   */
  registerModel(
    id: string,
    type: ModelType,
    model: any,
    config: ModelConfig,
    specialization?: string[]
  ): void {
    const instance: ModelInstance = {
      id,
      type,
      model,
      config,
      performance: this.initializePerformance(),
      lastUpdate: Date.now(),
      weight: 1.0 / (this.state.models.size + 1),
      specialization
    };
    
    this.state.models.set(id, instance);
    this.state.performance.set(id, {
      modelId: id,
      predictions: 0,
      accuracy: 0,
      sharpeRatio: 0,
      recentPerformance: [],
      drift: 0,
      reliability: 1
    });
    
    // Update ensemble weights
    this.rebalanceEnsembleWeights();
    
    this.logger.info('Model registered', { id, type, specialization });
    this.emit('modelRegistered', { id, type });
  }
  
  /**
   * Make orchestrated prediction using best models
   */
  async predict(features: FeatureSet): Promise<PredictionResult> {
    if (this.state.status !== ModelStatus.READY) {
      throw new MLError(
        MLErrorCode.MODEL_NOT_FOUND,
        'Orchestrator not ready'
      );
    }
    
    const startTime = Date.now();
    
    try {
      // Select models based on current conditions
      const selection = await this.selectModels(features);
      
      // Get predictions from selected models
      const predictions = await this.getPredictions(features, selection);
      
      // Create ensemble prediction
      const ensemblePrediction = await this.createEnsemblePrediction(
        predictions,
        features,
        selection,
        startTime
      );
      
      // Update performance tracking
      this.updatePerformanceTracking(predictions, ensemblePrediction);
      
      // Store prediction
      this.storePrediction(features.symbol, ensemblePrediction);
      
      // Emit prediction event
      this.emit('predictionMade', {
        symbol: features.symbol,
        prediction: ensemblePrediction,
        models: selection,
        processingTime: Date.now() - startTime
      });
      
      return ensemblePrediction;
      
    } catch (error) {
      this.logger.error('Orchestrated prediction failed', { error });
      throw new MLError(
        MLErrorCode.PREDICTION_FAILED,
        'Failed to create orchestrated prediction',
        error
      );
    }
  }
  
  /**
   * Select best models for current conditions
   */
  private async selectModels(features: FeatureSet): Promise<ModelSelection> {
    // Get current market conditions
    const marketConditions = this.analyzeMarketConditions(features);
    
    // Score each model for current conditions
    const modelScores = new Map<string, number>();
    
    for (const [id, instance] of this.state.models) {
      const score = this.scoreModel(instance, marketConditions, features);
      modelScores.set(id, score);
    }
    
    // Sort by score
    const sortedModels = Array.from(modelScores.entries())
      .sort((a, b) => b[1] - a[1]);
    
    // Select primary and secondary models
    const primary = sortedModels[0][0];
    const secondary = sortedModels.slice(1, 4).map(([id]) => id);
    
    // Generate rationale
    const rationale = this.generateSelectionRationale(
      primary,
      secondary,
      marketConditions
    );
    
    // Calculate selection confidence
    const confidence = this.calculateSelectionConfidence(modelScores);
    
    return {
      primary,
      secondary,
      rationale,
      confidence
    };
  }
  
  /**
   * Analyze market conditions for model selection
   */
  private analyzeMarketConditions(features: FeatureSet): any {
    return {
      regime: features.marketFeatures.regime,
      volatility: features.priceFeatures.realizedVol1h,
      trend: features.marketFeatures.trendStrength,
      volume: features.volumeFeatures.volumeRatio,
      liquidity: features.volumeFeatures.liquidityScore,
      sentiment: features.sentimentFeatures.bullBearRatio,
      timeOfDay: new Date().getHours(),
      dayOfWeek: new Date().getDay()
    };
  }
  
  /**
   * Score model for current conditions
   */
  private scoreModel(
    instance: ModelInstance,
    conditions: any,
    features: FeatureSet
  ): number {
    let score = 0;
    
    // Base performance score
    const tracker = this.state.performance.get(instance.id);
    if (tracker) {
      score += tracker.reliability * 0.3;
      score += (1 - tracker.drift) * 0.2;
      score += Math.min(1, tracker.sharpeRatio / 3) * 0.2;
    }
    
    // Specialization bonus
    if (instance.specialization) {
      if (instance.specialization.includes(conditions.regime)) {
        score += 0.15;
      }
      if (conditions.volatility > 0.03 && instance.specialization.includes('high_volatility')) {
        score += 0.1;
      }
      if (conditions.volatility < 0.01 && instance.specialization.includes('low_volatility')) {
        score += 0.1;
      }
    }
    
    // Model type suitability
    score += this.getModelTypeSuitability(instance.type, conditions) * 0.15;
    
    // Recent performance
    if (tracker && tracker.recentPerformance.length > 0) {
      const recentAvg = tracker.recentPerformance.slice(-10)
        .reduce((a, b) => a + b, 0) / Math.min(10, tracker.recentPerformance.length);
      score += recentAvg * 0.1;
    }
    
    // Diversity bonus (if not primary)
    const currentActive = Array.from(this.state.activeModels);
    if (currentActive.length > 0 && !currentActive.includes(instance.id)) {
      score += 0.05;
    }
    
    return Math.max(0, Math.min(1, score));
  }
  
  /**
   * Get model type suitability for conditions
   */
  private getModelTypeSuitability(type: ModelType, conditions: any): number {
    const suitability: Record<ModelType, (c: any) => number> = {
      [ModelType.TRANSFORMER]: (c) => c.trend > 0.5 ? 0.9 : 0.7,
      [ModelType.LSTM]: (c) => c.volatility < 0.02 ? 0.8 : 0.6,
      [ModelType.GRU]: (c) => 0.75, // Generally good
      [ModelType.CNN]: (c) => c.volatility > 0.03 ? 0.8 : 0.5,
      [ModelType.REINFORCEMENT]: (c) => c.regime === MarketRegime.RANGING ? 0.9 : 0.7,
      [ModelType.ENSEMBLE]: (c) => 0.85, // Always good
      [ModelType.RANDOM_FOREST]: (c) => c.volume > 1.5 ? 0.8 : 0.6,
      [ModelType.GRADIENT_BOOST]: (c) => 0.8,
      [ModelType.NEURAL_NETWORK]: (c) => 0.7
    };
    
    return suitability[type]?.(conditions) || 0.5;
  }
  
  /**
   * Get predictions from selected models
   */
  private async getPredictions(
    features: FeatureSet,
    selection: ModelSelection
  ): Promise<Map<string, PredictionResult>> {
    const predictions = new Map<string, PredictionResult>();
    
    // Get primary prediction
    const primaryModel = this.state.models.get(selection.primary);
    if (primaryModel) {
      try {
        const prediction = await this.getModelPrediction(primaryModel, features);
        predictions.set(selection.primary, prediction);
      } catch (error) {
        this.logger.error(`Primary model ${selection.primary} failed`, { error });
      }
    }
    
    // Get secondary predictions in parallel
    const secondaryPromises = selection.secondary.map(async (modelId) => {
      const model = this.state.models.get(modelId);
      if (model) {
        try {
          const prediction = await this.getModelPrediction(model, features);
          predictions.set(modelId, prediction);
        } catch (error) {
          this.logger.warn(`Secondary model ${modelId} failed`, { error });
        }
      }
    });
    
    await Promise.all(secondaryPromises);
    
    // Ensure we have at least one prediction
    if (predictions.size === 0) {
      throw new MLError(
        MLErrorCode.PREDICTION_FAILED,
        'No models produced predictions'
      );
    }
    
    return predictions;
  }
  
  /**
   * Get prediction from a specific model
   */
  private async getModelPrediction(
    instance: ModelInstance,
    features: FeatureSet
  ): Promise<PredictionResult> {
    // Call model's predict method
    const prediction = await instance.model.predict(features);
    
    // Store last prediction
    instance.lastPrediction = prediction;
    
    // Update active models
    this.state.activeModels.add(instance.id);
    
    return prediction;
  }
  
  /**
   * Create ensemble prediction from multiple models
   */
  private async createEnsemblePrediction(
    predictions: Map<string, PredictionResult>,
    features: FeatureSet,
    selection: ModelSelection,
    startTime: number
  ): Promise<PredictionResult> {
    // Use ensemble builder
    const ensemble = await this.ensembleBuilder.build(
      predictions,
      this.state.ensemble,
      this.state.performance
    );
    
    // Adjust for market regime
    const adjusted = this.adjustForMarketRegime(ensemble, features.marketFeatures.regime);
    
    // Add metadata
    adjusted.metadata = {
      ...adjusted.metadata,
      modelVersion: '1.0.0',
      inferenceTime: Date.now() - startTime,
      preprocessingTime: 0,
      postprocessingTime: 0,
      dataQuality: {
        completeness: 1,
        validity: 1,
        consistency: 1,
        timeliness: 1,
        uniqueness: 1,
        accuracy: adjusted.confidence.overall
      },
      anomalyScore: 0
    };
    
    return adjusted;
  }
  
  /**
   * Adjust predictions for market regime
   */
  private adjustForMarketRegime(
    prediction: PredictionResult,
    regime: MarketRegime
  ): PredictionResult {
    const adjusted = { ...prediction };
    
    // Regime-specific adjustments
    switch (regime) {
      case MarketRegime.BULL_VOLATILE:
        // Increase position sizing in strong trends
        adjusted.predictions.signal.action.size *= 1.2;
        // Widen stops
        if (adjusted.predictions.signal.stopLoss) {
          adjusted.predictions.signal.stopLoss *= 1.1;
        }
        break;
        
      case MarketRegime.BEAR_VOLATILE:
        // Reduce position sizing in volatile bears
        adjusted.predictions.signal.action.size *= 0.8;
        // Tighten stops
        if (adjusted.predictions.signal.stopLoss) {
          adjusted.predictions.signal.stopLoss *= 0.9;
        }
        break;
        
      case MarketRegime.RANGING:
        // Use mean reversion in ranging markets
        if (Math.abs(adjusted.predictions.expectedReturn) < 0.01) {
          adjusted.predictions.signal.action.type = 'hold';
        }
        break;
        
      case MarketRegime.TRANSITION:
        // Reduce confidence in transitions
        adjusted.confidence.overall *= 0.8;
        adjusted.predictions.signal.action.size *= 0.7;
        break;
    }
    
    // Ensure size limits
    adjusted.predictions.signal.action.size = Math.max(0, Math.min(1, 
      adjusted.predictions.signal.action.size
    ));
    
    return adjusted;
  }
  
  /**
   * Update performance tracking
   */
  private updatePerformanceTracking(
    predictions: Map<string, PredictionResult>,
    ensemble: PredictionResult
  ): void {
    // Update individual model performance
    for (const [modelId, prediction] of predictions) {
      const tracker = this.state.performance.get(modelId);
      if (tracker) {
        tracker.predictions++;
        // Performance would be updated after outcomes are known
        this.performanceMonitor.updateTracker(tracker, prediction);
      }
    }
    
    // Check for performance degradation
    this.checkPerformanceDegradation();
  }
  
  /**
   * Check for model performance degradation
   */
  private checkPerformanceDegradation(): void {
    for (const [modelId, tracker] of this.state.performance) {
      if (tracker.drift > 0.3) {
        this.logger.warn(`Model ${modelId} showing drift: ${tracker.drift}`);
        this.emit('modelDrift', { modelId, drift: tracker.drift });
      }
      
      if (tracker.reliability < 0.5) {
        this.logger.warn(`Model ${modelId} reliability low: ${tracker.reliability}`);
        // Consider removing from active rotation
        this.state.activeModels.delete(modelId);
      }
    }
  }
  
  /**
   * Handle performance drift
   */
  private handlePerformanceDrift(data: any): void {
    const { modelId, drift } = data;
    
    if (drift > 0.5) {
      // Severe drift - remove from ensemble
      this.state.activeModels.delete(modelId);
      this.logger.error(`Removing model ${modelId} due to severe drift`);
    } else {
      // Reduce weight
      const currentWeight = this.state.ensemble.weights.get(modelId) || 0;
      this.state.ensemble.weights.set(modelId, currentWeight * 0.8);
    }
    
    this.rebalanceEnsembleWeights();
  }
  
  /**
   * Handle model switch
   */
  private handleModelSwitch(data: any): void {
    const { from, to, reason } = data;
    
    this.logger.info('Model switch', { from, to, reason });
    
    // Update active models
    this.state.activeModels.delete(from);
    this.state.activeModels.add(to);
    
    this.emit('modelSwitched', data);
  }
  
  /**
   * Rebalance ensemble weights
   */
  private rebalanceEnsembleWeights(): void {
    const weights = new Map<string, number>();
    let totalWeight = 0;
    
    // Calculate raw weights based on performance
    for (const [modelId, instance] of this.state.models) {
      const tracker = this.state.performance.get(modelId);
      if (tracker && this.state.activeModels.has(modelId)) {
        const weight = tracker.reliability * (1 - tracker.drift) * 
                      Math.min(1, tracker.sharpeRatio / 2);
        weights.set(modelId, Math.max(0.1, weight));
        totalWeight += weight;
      }
    }
    
    // Normalize weights
    if (totalWeight > 0) {
      for (const [modelId, weight] of weights) {
        weights.set(modelId, weight / totalWeight);
      }
    }
    
    this.state.ensemble.weights = weights;
  }
  
  /**
   * Store prediction for history
   */
  private storePrediction(symbol: string, prediction: PredictionResult): void {
    const history = this.predictionHistory.get(symbol) || [];
    history.push(prediction);
    
    // Keep last 100 predictions
    if (history.length > 100) {
      history.shift();
    }
    
    this.predictionHistory.set(symbol, history);
  }
  
  /**
   * Generate selection rationale
   */
  private generateSelectionRationale(
    primary: string,
    secondary: string[],
    conditions: any
  ): string[] {
    const rationale: string[] = [];
    
    const primaryModel = this.state.models.get(primary);
    if (primaryModel) {
      rationale.push(`Primary model ${primary} selected for ${conditions.regime} regime`);
      
      if (primaryModel.specialization?.includes(conditions.regime)) {
        rationale.push(`${primary} specializes in current market regime`);
      }
      
      const tracker = this.state.performance.get(primary);
      if (tracker && tracker.sharpeRatio > 2) {
        rationale.push(`${primary} showing excellent performance (Sharpe: ${tracker.sharpeRatio.toFixed(2)})`);
      }
    }
    
    if (conditions.volatility > 0.03) {
      rationale.push('High volatility detected - using volatility-adapted models');
    }
    
    if (secondary.length > 0) {
      rationale.push(`${secondary.length} secondary models for ensemble diversity`);
    }
    
    return rationale;
  }
  
  /**
   * Calculate selection confidence
   */
  private calculateSelectionConfidence(scores: Map<string, number>): number {
    const values = Array.from(scores.values());
    if (values.length === 0) return 0;
    
    // Higher confidence if there's clear separation
    const sorted = values.sort((a, b) => b - a);
    const topScore = sorted[0];
    const secondScore = sorted[1] || 0;
    
    const separation = topScore - secondScore;
    const confidence = Math.min(1, topScore * (1 + separation));
    
    return confidence;
  }
  
  /**
   * Initialize performance metrics
   */
  private initializePerformance(): ModelPerformance {
    return {
      accuracy: 0,
      precision: 0,
      recall: 0,
      f1Score: 0,
      auc: 0,
      sharpeRatio: 0,
      sortinoRatio: 0,
      calmarRatio: 0,
      maxDrawdown: 0,
      winRate: 0,
      profitFactor: 0,
      mse: 0,
      mae: 0,
      rmse: 0,
      mape: 0,
      r2: 0,
      directionalAccuracy: 0,
      upAccuracy: 0,
      downAccuracy: 0,
      var95: 0,
      cvar95: 0,
      tailRatio: 0,
      stabilityScore: 0,
      consistencyScore: 0,
      outOfSamplePerformance: 0
    };
  }
  
  /**
   * Update market regime
   */
  updateMarketRegime(regime: MarketRegime): void {
    if (this.state.marketRegime !== regime) {
      this.logger.info('Market regime updated', {
        from: this.state.marketRegime,
        to: regime
      });
      
      this.state.marketRegime = regime;
      
      // Trigger model reselection
      this.emit('regimeChanged', { regime });
      
      // Clear active models to force reselection
      this.state.activeModels.clear();
    }
  }
  
  /**
   * Get orchestrator status
   */
  getStatus(): any {
    return {
      status: this.state.status,
      modelCount: this.state.models.size,
      activeModels: Array.from(this.state.activeModels),
      marketRegime: this.state.marketRegime,
      ensembleType: this.state.ensemble.type,
      weights: Object.fromEntries(this.state.ensemble.weights)
    };
  }
  
  /**
   * Get model performance summary
   */
  getPerformanceSummary(): Map<string, PerformanceTracker> {
    return new Map(this.state.performance);
  }
  
  /**
   * Clean up resources
   */
  dispose(): void {
    this.state.models.clear();
    this.state.performance.clear();
    this.state.activeModels.clear();
    this.predictionHistory.clear();
    this.removeAllListeners();
  }
}

/**
 * Model selection helper
 */
class ModelSelector extends EventEmitter {
  constructor(private logger: Logger) {
    super();
  }
  
  selectBestModel(
    models: Map<string, ModelInstance>,
    conditions: any
  ): string {
    // Implementation handled by main orchestrator
    return '';
  }
}

/**
 * Performance monitoring helper
 */
class PerformanceMonitor extends EventEmitter {
  constructor(private logger: Logger) {
    super();
  }
  
  updateTracker(tracker: PerformanceTracker, prediction: PredictionResult): void {
    // Update recent performance
    // In production, this would track actual vs predicted outcomes
    const performance = prediction.confidence.overall;
    tracker.recentPerformance.push(performance);
    
    if (tracker.recentPerformance.length > 100) {
      tracker.recentPerformance.shift();
    }
    
    // Calculate drift
    if (tracker.recentPerformance.length >= 20) {
      const recent = tracker.recentPerformance.slice(-20);
      const older = tracker.recentPerformance.slice(-40, -20);
      
      if (older.length >= 20) {
        const recentMean = recent.reduce((a, b) => a + b, 0) / recent.length;
        const olderMean = older.reduce((a, b) => a + b, 0) / older.length;
        
        tracker.drift = Math.abs(recentMean - olderMean);
        
        if (tracker.drift > 0.2) {
          this.emit('performanceDrift', {
            modelId: tracker.modelId,
            drift: tracker.drift
          });
        }
      }
    }
    
    // Update reliability
    tracker.reliability = Math.max(0, Math.min(1,
      tracker.reliability * 0.95 + performance * 0.05
    ));
  }
}

/**
 * Ensemble builder helper
 */
class EnsembleBuilder extends EventEmitter {
  constructor(private logger: Logger) {
    super();
  }
  
  async build(
    predictions: Map<string, PredictionResult>,
    strategy: EnsembleStrategy,
    performance: Map<string, PerformanceTracker>
  ): Promise<PredictionResult> {
    switch (strategy.type) {
      case 'weighted':
        return this.buildWeightedEnsemble(predictions, strategy.weights);
        
      case 'voting':
        return this.buildVotingEnsemble(predictions);
        
      case 'stacking':
        return this.buildStackingEnsemble(predictions, strategy.metaModel);
        
      case 'blending':
        return this.buildBlendingEnsemble(predictions, performance);
        
      case 'dynamic':
      default:
        return this.buildDynamicEnsemble(predictions, strategy, performance);
    }
  }
  
  private buildWeightedEnsemble(
    predictions: Map<string, PredictionResult>,
    weights: Map<string, number>
  ): PredictionResult {
    // Simple weighted average implementation
    const first = predictions.values().next().value;
    if (!first) throw new Error('No predictions available');
    
    // Clone first prediction as template
    const ensemble: PredictionResult = JSON.parse(JSON.stringify(first));
    
    // Reset values
    ensemble.predictions.expectedReturn = 0;
    ensemble.predictions.volatilityForecast = 0;
    ensemble.confidence.overall = 0;
    
    let totalWeight = 0;
    
    for (const [modelId, prediction] of predictions) {
      const weight = weights.get(modelId) || 0;
      
      ensemble.predictions.expectedReturn += prediction.predictions.expectedReturn * weight;
      ensemble.predictions.volatilityForecast += prediction.predictions.volatilityForecast * weight;
      ensemble.confidence.overall += prediction.confidence.overall * weight;
      
      totalWeight += weight;
    }
    
    // Normalize if weights don't sum to 1
    if (totalWeight > 0 && totalWeight !== 1) {
      ensemble.predictions.expectedReturn /= totalWeight;
      ensemble.predictions.volatilityForecast /= totalWeight;
      ensemble.confidence.overall /= totalWeight;
    }
    
    return ensemble;
  }
  
  private buildVotingEnsemble(predictions: Map<string, PredictionResult>): PredictionResult {
    // Get first prediction to use as template
    const firstPrediction = predictions.values().next().value;
    if (!firstPrediction) {
      throw new Error('No predictions available for voting ensemble');
    }
    
    // Majority voting for discrete predictions
    const votes: Map<string, number> = new Map();
    
    for (const prediction of predictions.values()) {
      const direction = prediction.predictions.priceDirection;
      votes.set(direction, (votes.get(direction) || 0) + 1);
    }
    
    // Find winner
    let winner = 'neutral';
    let maxVotes = 0;
    
    for (const [direction, count] of votes) {
      if (count > maxVotes) {
        maxVotes = count;
        winner = direction;
      }
    }
    
    // Clone first prediction as template and update
    const ensemble: PredictionResult = JSON.parse(JSON.stringify(firstPrediction));
    ensemble.predictions.priceDirection = winner as any;
    
    return ensemble;
  }
  
  private buildStackingEnsemble(
    predictions: Map<string, PredictionResult>,
    metaModel: any
  ): PredictionResult {
    // Meta-learning ensemble
    // In production, metaModel would combine base predictions
    return this.buildWeightedEnsemble(predictions, new Map());
  }
  
  private buildBlendingEnsemble(
    predictions: Map<string, PredictionResult>,
    performance: Map<string, PerformanceTracker>
  ): PredictionResult {
    // Blend based on recent performance
    const weights = new Map<string, number>();
    
    for (const [modelId] of predictions) {
      const tracker = performance.get(modelId);
      if (tracker && tracker.recentPerformance.length > 0) {
        const recentAvg = tracker.recentPerformance.slice(-10)
          .reduce((a, b) => a + b, 0) / Math.min(10, tracker.recentPerformance.length);
        weights.set(modelId, recentAvg);
      } else {
        weights.set(modelId, 0.5);
      }
    }
    
    return this.buildWeightedEnsemble(predictions, weights);
  }
  
  private buildDynamicEnsemble(
    predictions: Map<string, PredictionResult>,
    strategy: EnsembleStrategy,
    performance: Map<string, PerformanceTracker>
  ): PredictionResult {
    // Dynamic ensemble adjusts weights based on current performance
    const dynamicWeights = new Map<string, number>();
    
    for (const [modelId, prediction] of predictions) {
      let weight = strategy.weights.get(modelId) || 0.5;
      
      // Adjust based on confidence
      weight *= prediction.confidence.overall;
      
      // Adjust based on recent performance
      const tracker = performance.get(modelId);
      if (tracker) {
        weight *= tracker.reliability;
        weight *= (1 - tracker.drift);
      }
      
      dynamicWeights.set(modelId, weight);
    }
    
    return this.buildWeightedEnsemble(predictions, dynamicWeights);
  }
} 