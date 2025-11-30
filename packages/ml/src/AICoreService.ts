/**
 * AICoreService - Orchestrates all AI/ML components for the trading system
 * Provides unified interface for predictions, pattern detection, and strategy optimization
 */

import { Logger } from 'winston';
import EventEmitter from 'events';
import * as tf from '@tensorflow/tfjs';
import {
  FeatureSet,
  PredictionResult,
  TradingAction,
  FractalPattern,
  ModelPerformance,
  TransformerConfig,
  RLConfig,
  RLEnvironment,
  RLAlgorithm,
  ExplorationStrategy,
  MemoryConfig,
  RewardFunction,
  StateSpace,
  ActionSpace,
  MLError,
  MLErrorCode,
  ModelStatus,
  CrossMarketAnalysis,
  LeadLagRelation,
  MarketRegime,
  RegimeAlignment,
  PositionSizingMethod
} from './types';

import { TransformerPredictor } from './TransformerPredictor';
import { ReinforcementLearner } from './ReinforcementLearner';
import { FractalPatternDetector } from './FractalPatternDetector';
// import { createLogger } from '@noderr/utils/logger';

interface AIModels {
  transformer: TransformerPredictor;
  reinforcement: ReinforcementLearner;
  fractalDetector: FractalPatternDetector;
}

interface PredictionEnsemble {
  predictions: PredictionResult[];
  consensus: PredictionResult;
  confidence: number;
  disagreement: number;
}

interface StrategySignal {
  action: TradingAction;
  confidence: number;
  reasons: string[];
  patterns: FractalPattern[];
  marketRegime: MarketRegime;
  risk: RiskAssessment;
}

interface RiskAssessment {
  drawdownRisk: number;
  volatilityRisk: number;
  correlationRisk: number;
  liquidityRisk: number;
  overallRisk: number;
  recommendation: string;
}

interface AIState {
  models: AIModels;
  isInitialized: boolean;
  lastPrediction: PredictionResult | null;
  performance: Record<string, ModelPerformance>;
  marketRegime: MarketRegime;
  activePatterns: FractalPattern[];
}

export class AICoreService extends EventEmitter {
  private logger: Logger;
  private state: AIState;
  private featureBuffer: Map<string, FeatureSet[]>;
  private predictionHistory: Map<string, PredictionResult[]>;
  private crossMarketData: Map<string, FeatureSet>;
  
  constructor(logger?: Logger) {
    super();
    this.logger = logger || console as any;
    this.featureBuffer = new Map();
    this.predictionHistory = new Map();
    this.crossMarketData = new Map();
    
    // Initialize models
    this.state = {
      models: this.initializeModels(),
      isInitialized: false,
      lastPrediction: null,
      performance: {},
      marketRegime: MarketRegime.RANGING,
      activePatterns: []
    };
    
    this.setupEventHandlers();
  }
  
  /**
   * Initialize all AI models
   */
  private initializeModels(): AIModels {
    // Transformer configuration
    const transformerConfig: TransformerConfig = {
      sequenceLength: 100,
      embeddingDim: 256,
      numHeads: 8,
      numLayers: 6,
      ffDim: 1024,
      dropoutRate: 0.1,
      attentionDropout: 0.1,
      warmupSteps: 2000,
      learningRate: 0.0001,
      batchSize: 32,
      maxGradNorm: 1.0,
      labelSmoothing: 0.1,
      useRelativePositions: true,
      useCausalMask: true
    };
    
    // Reinforcement learning configuration
    const rlConfig: RLConfig = {
      environment: this.createTradingEnvironment(),
      algorithm: RLAlgorithm.DOUBLE_DQN,
      hyperparameters: {
        gamma: 0.99,
        tau: 0.001,
        bufferSize: 100000,
        batchSize: 64,
        updateFrequency: 4,
        targetUpdateFrequency: 1000,
        gradientSteps: 1,
        learningStarts: 10000,
        prioritizedReplay: true,
        priorityAlpha: 0.6,
        priorityBeta: 0.4
      },
      exploration: {
        type: 'epsilon_greedy',
        initialValue: 1.0,
        finalValue: 0.01,
        decaySteps: 100000
      },
      memory: {
        type: 'prioritized',
        capacity: 100000,
        alpha: 0.6,
        beta: 0.4,
        n_step: 3
      }
    };
    
    return {
      transformer: new TransformerPredictor(this.logger, transformerConfig),
      reinforcement: new ReinforcementLearner(this.logger, rlConfig),
      fractalDetector: new FractalPatternDetector(this.logger)
    };
  }
  
  /**
   * Create trading environment for RL
   */
  private createTradingEnvironment(): RLEnvironment {
    const stateSpace: StateSpace = {
      dimensions: 50,
      features: {
        priceFeatures: ['returns', 'volatility', 'spread', 'volume'],
        volumeFeatures: ['ratio', 'imbalance', 'flow'],
        technicalFeatures: ['rsi', 'macd', 'bb', 'adx'],
        marketFeatures: ['regime', 'correlation', 'vix'],
        sentimentFeatures: ['social', 'news'],
        onChainFeatures: ['tvl', 'activity']
      },
      normalization: 'standard',
      history: 20
    };
    
    const actionSpace: ActionSpace = {
      type: 'hybrid',
      actions: [
        { type: 'buy', confidence: 0.8, size: 1.0 },
        { type: 'sell', confidence: 0.8, size: 1.0 },
        { type: 'hold', confidence: 0.8, size: 0 }
      ],
      positionSizing: PositionSizingMethod.KELLY,
      constraints: {
        maxPosition: 1.0,
        maxLeverage: 3.0,
        minHoldingPeriod: 300, // 5 minutes
        maxHoldingPeriod: 86400, // 24 hours
        stopLoss: 0.02,
        maxDrawdown: 0.1,
        maxTurnover: 10
      }
    };
    
    const rewardFunction: RewardFunction = {
      type: 'sharpe',
      riskFreeRate: 0.02,
      targetReturn: 0.5,
      penaltyFactors: {
        drawdown: 2.0,
        volatility: 1.0,
        turnover: 0.5,
        slippage: 1.5
      }
    };
    
    return {
      stateSpace,
      actionSpace,
      rewardFunction,
      episodeLength: 1000,
      maxStepsPerEpisode: 2000,
      discountFactor: 0.99,
      explorationStrategy: {
        type: 'epsilon_greedy',
        initialValue: 1.0,
        finalValue: 0.01,
        decaySteps: 100000
      }
    };
  }
  
  /**
   * Setup event handlers for models
   */
  private setupEventHandlers(): void {
    // Transformer events
    this.state.models.transformer.on('modelInitialized', (data) => {
      this.logger.info('Transformer model initialized', data);
    });
    
    this.state.models.transformer.on('predictionMade', (prediction) => {
      this.handlePrediction('transformer', prediction);
    });
    
    // RL events
    this.state.models.reinforcement.on('trainingProgress', (progress) => {
      this.logger.info('RL training progress', progress);
      this.emit('trainingProgress', { model: 'reinforcement', ...progress });
    });
    
    // Fractal detector events
    this.state.models.fractalDetector.on('patternsDetected', (data) => {
      this.handlePatternDetection(data);
    });
  }
  
  /**
   * Initialize the AI Core system
   */
  async initialize(): Promise<void> {
    if (this.state.isInitialized) {
      this.logger.warn('AI Core already initialized');
      return;
    }
    
    try {
      this.logger.info('Initializing AI Core system');
      
      // Warm up models with synthetic data if needed
      await this.warmupModels();
      
      this.state.isInitialized = true;
      
      // Update performance metrics
      this.updatePerformanceMetrics();
      
      this.logger.info('AI Core system initialized successfully');
      this.emit('initialized');
      
    } catch (error) {
      this.logger.error('Failed to initialize AI Core', { error });
      throw new MLError(
        MLErrorCode.MODEL_NOT_FOUND,
        'Failed to initialize AI Core system',
        error
      );
    }
  }
  
  /**
   * Make comprehensive prediction using all models
   */
  async predict(features: FeatureSet): Promise<StrategySignal> {
    if (!this.state.isInitialized) {
      throw new MLError(
        MLErrorCode.MODEL_NOT_FOUND,
        'AI Core not initialized'
      );
    }
    
    try {
      // Update feature buffer
      this.updateFeatureBuffer(features);
      
      // Get predictions from all models
      const [transformerPred, patterns, rlAction] = await Promise.all([
        this.state.models.transformer.predict(features),
        this.state.models.fractalDetector.detectPatterns(features),
        this.state.models.reinforcement.act(features)
      ]);
      
      // Analyze cross-market correlations
      const crossMarket = await this.analyzeCrossMarket(features);
      
      // Detect market regime
      const marketRegime = this.detectMarketRegime(features, patterns);
      
      // Create ensemble prediction
      const ensemble = this.createEnsemble([transformerPred], rlAction);
      
      // Assess risk
      const risk = this.assessRisk(ensemble.consensus, patterns, crossMarket);
      
      // Generate final signal
      const signal = this.generateSignal(ensemble, patterns, marketRegime, risk);
      
      // Store prediction
      this.storePrediction(features.symbol, ensemble.consensus);
      
      // Update state
      this.state.lastPrediction = ensemble.consensus;
      this.state.marketRegime = marketRegime;
      this.state.activePatterns = patterns;
      
      // Emit signal
      this.emit('signal', signal);
      
      return signal;
      
    } catch (error) {
      this.logger.error('Prediction failed', { error });
      throw new MLError(
        MLErrorCode.PREDICTION_FAILED,
        'Failed to generate prediction',
        error
      );
    }
  }
  
  /**
   * Train models with historical data
   */
  async train(
    trainingData: tf.Tensor,
    labels: tf.Tensor,
    validationData?: [tf.Tensor, tf.Tensor]
  ): Promise<void> {
    try {
      this.logger.info('Starting AI Core training');
      
      // Train transformer
      await this.state.models.transformer.train(trainingData, labels, validationData);
      
      // Train RL agent (requires episodes, not tensor data)
      await this.state.models.reinforcement.train(1000); // 1000 episodes
      
      // Update performance metrics
      this.updatePerformanceMetrics();
      
      this.logger.info('AI Core training completed');
      this.emit('trainingCompleted');
      
    } catch (error) {
      this.logger.error('Training failed', { error });
      throw new MLError(
        MLErrorCode.TRAINING_FAILED,
        'Failed to train models',
        error
      );
    }
  }
  
  /**
   * Analyze cross-market correlations
   */
  private async analyzeCrossMarket(features: FeatureSet): Promise<CrossMarketAnalysis> {
    // Update cross-market data
    this.crossMarketData.set(features.symbol, features);
    
    const symbols = Array.from(this.crossMarketData.keys());
    const correlationMatrix: number[][] = [];
    const leadLagRelations: LeadLagRelation[] = [];
    
    // Calculate correlation matrix
    for (let i = 0; i < symbols.length; i++) {
      correlationMatrix[i] = [];
      for (let j = 0; j < symbols.length; j++) {
        if (i === j) {
          correlationMatrix[i][j] = 1.0;
        } else {
          const corr = this.calculateCorrelation(
            this.getReturns(symbols[i]),
            this.getReturns(symbols[j])
          );
          correlationMatrix[i][j] = corr;
          
          // Check for lead-lag relationships
          if (Math.abs(corr) > 0.5) {
            const leadLag = this.detectLeadLag(symbols[i], symbols[j]);
            if (leadLag) {
              leadLagRelations.push(leadLag);
            }
          }
        }
      }
    }
    
    // Analyze regime alignment
    const regimeAlignment = this.analyzeRegimeAlignment();
    
    // Calculate contagion risk
    const contagionRisk = this.calculateContagionRisk(correlationMatrix);
    
    // Calculate diversification benefit
    const diversificationBenefit = this.calculateDiversificationBenefit(correlationMatrix);
    
    return {
      timestamp: Date.now(),
      correlationMatrix,
      leadLagRelations,
      regimeAlignment,
      contagionRisk,
      diversificationBenefit
    };
  }
  
  /**
   * Detect market regime
   */
  private detectMarketRegime(features: FeatureSet, patterns: FractalPattern[]): MarketRegime {
    const mf = features.marketFeatures;
    
    // Use existing regime if provided
    if (mf.regime) {
      return mf.regime;
    }
    
    // Analyze patterns for regime detection
          const elliottWaves = patterns.filter(p => p.type === FractalType.ELLIOTT_WAVE);      const wyckoffPhases = patterns.filter(p => p.type === FractalType.WYCKOFF);
    
    // Combine multiple signals
    const trendStrength = mf.trendStrength;
    const volatility = mf.volatilityRegime;
    
    if (trendStrength > 0.7 && volatility === 'low') {
      return MarketRegime.BULL_QUIET;
    } else if (trendStrength > 0.7 && volatility === 'high') {
      return MarketRegime.BULL_VOLATILE;
    } else if (trendStrength < -0.7 && volatility === 'low') {
      return MarketRegime.BEAR_QUIET;
    } else if (trendStrength < -0.7 && volatility === 'high') {
      return MarketRegime.BEAR_VOLATILE;
    } else if (Math.abs(trendStrength) < 0.3) {
      return MarketRegime.RANGING;
    } else {
      return MarketRegime.TRANSITION;
    }
  }
  
  /**
   * Create ensemble prediction
   */
  private createEnsemble(predictions: PredictionResult[], rlAction: TradingAction): PredictionEnsemble {
    // For now, we only have one prediction (transformer)
    // In production, we'd have multiple models
    const consensus = predictions[0];
    
    // Incorporate RL action into consensus
    if (rlAction.type !== consensus.predictions.signal.action.type) {
      // Disagreement between models
      consensus.confidence.overall *= 0.8;
    }
    
    // Calculate disagreement metric
    const disagreement = this.calculateDisagreement(predictions);
    
    return {
      predictions,
      consensus,
      confidence: consensus.confidence.overall,
      disagreement
    };
  }
  
  /**
   * Assess risk
   */
  private assessRisk(
    prediction: PredictionResult,
    patterns: FractalPattern[],
    crossMarket: CrossMarketAnalysis
  ): RiskAssessment {
    const pred = prediction.predictions;
    
    // Base risks from prediction
    const drawdownRisk = pred.drawdownRisk;
    const volatilityRisk = pred.volatilityForecast;
    
    // Correlation risk from cross-market analysis
    const correlationRisk = crossMarket.contagionRisk;
    
    // Liquidity risk (simplified)
    const liquidityRisk = prediction.features.global['bidAskSpread'] || 0.1;
    
    // Pattern-based risk adjustment
    let patternRisk = 0;
    for (const pattern of patterns) {
      if (pattern.type === 'HARMONIC' && pattern.confidence > 0.8) {
        patternRisk = Math.max(patternRisk, 0.2); // Harmonics indicate reversal risk
      }
    }
    
    // Calculate overall risk
    const overallRisk = (
      drawdownRisk * 0.3 +
      volatilityRisk * 0.3 +
      correlationRisk * 0.2 +
      liquidityRisk * 0.1 +
      patternRisk * 0.1
    );
    
    // Generate recommendation
    let recommendation = 'proceed';
    if (overallRisk > 0.7) {
      recommendation = 'avoid';
    } else if (overallRisk > 0.5) {
      recommendation = 'reduce_size';
    }
    
    return {
      drawdownRisk,
      volatilityRisk,
      correlationRisk,
      liquidityRisk,
      overallRisk,
      recommendation
    };
  }
  
  /**
   * Generate final trading signal
   */
  private generateSignal(
    ensemble: PredictionEnsemble,
    patterns: FractalPattern[],
    marketRegime: MarketRegime,
    risk: RiskAssessment
  ): StrategySignal {
    const prediction = ensemble.consensus;
    const action = prediction.predictions.signal.action;
    
    // Adjust confidence based on risk
    let confidence = ensemble.confidence;
    if (risk.recommendation === 'avoid') {
      confidence *= 0.1;
    } else if (risk.recommendation === 'reduce_size') {
      confidence *= 0.5;
    }
    
    // Generate reasons
    const reasons: string[] = [];
    
    if (prediction.predictions.priceDirection === 'up') {
      reasons.push('Bullish price prediction');
    } else if (prediction.predictions.priceDirection === 'down') {
      reasons.push('Bearish price prediction');
    }
    
    if (patterns.length > 0) {
      const topPattern = patterns[0];
      reasons.push(`${topPattern.type} pattern detected with ${(topPattern.confidence * 100).toFixed(1)}% confidence`);
    }
    
    reasons.push(`Market regime: ${marketRegime}`);
    reasons.push(`Risk level: ${risk.recommendation}`);
    
    // Adjust action based on risk
    if (risk.recommendation === 'avoid') {
      action.type = 'hold';
      action.size = 0;
    } else if (risk.recommendation === 'reduce_size') {
      action.size *= 0.5;
    }
    
    return {
      action,
      confidence,
      reasons,
      patterns,
      marketRegime,
      risk
    };
  }
  
  /**
   * Helper methods
   */
  
  private warmupModels(): Promise<void> {
    // In production, load pre-trained weights or warm up with synthetic data
    return Promise.resolve();
  }
  
  private updateFeatureBuffer(features: FeatureSet): void {
    const buffer = this.featureBuffer.get(features.symbol) || [];
    buffer.push(features);
    
    // Keep last 1000 features
    if (buffer.length > 1000) {
      buffer.shift();
    }
    
    this.featureBuffer.set(features.symbol, buffer);
  }
  
  private storePrediction(symbol: string, prediction: PredictionResult): void {
    const history = this.predictionHistory.get(symbol) || [];
    history.push(prediction);
    
    // Keep last 100 predictions
    if (history.length > 100) {
      history.shift();
    }
    
    this.predictionHistory.set(symbol, history);
  }
  
  private handlePrediction(model: string, prediction: PredictionResult): void {
    this.logger.debug(`Prediction from ${model}`, {
      symbol: prediction.symbol,
      direction: prediction.predictions.priceDirection,
      confidence: prediction.confidence.overall
    });
  }
  
  private handlePatternDetection(data: any): void {
    this.logger.info('Patterns detected', {
      symbol: data.symbol,
      count: data.patterns.length,
      topPattern: data.patterns[0]?.type
    });
    
    this.emit('patternsDetected', data);
  }
  
  private updatePerformanceMetrics(): void {
    this.state.performance = {
      transformer: this.state.models.transformer.getPerformance(),
      reinforcement: this.state.models.reinforcement.getPerformance()
    };
    
    this.emit('performanceUpdate', this.state.performance);
  }
  
  private calculateCorrelation(returns1: number[], returns2: number[]): number {
    if (returns1.length !== returns2.length || returns1.length === 0) return 0;
    
    const mean1 = returns1.reduce((a, b) => a + b, 0) / returns1.length;
    const mean2 = returns2.reduce((a, b) => a + b, 0) / returns2.length;
    
    let numerator = 0;
    let denominator1 = 0;
    let denominator2 = 0;
    
    for (let i = 0; i < returns1.length; i++) {
      const diff1 = returns1[i] - mean1;
      const diff2 = returns2[i] - mean2;
      numerator += diff1 * diff2;
      denominator1 += diff1 * diff1;
      denominator2 += diff2 * diff2;
    }
    
    const denominator = Math.sqrt(denominator1 * denominator2);
    return denominator === 0 ? 0 : numerator / denominator;
  }
  
  private getReturns(symbol: string): number[] {
    const buffer = this.featureBuffer.get(symbol) || [];
    return buffer.map(f => f.priceFeatures.returns1h);
  }
  
  private detectLeadLag(symbol1: string, symbol2: string): LeadLagRelation | null {
    // Simplified lead-lag detection
    const returns1 = this.getReturns(symbol1);
    const returns2 = this.getReturns(symbol2);
    
    if (returns1.length < 20 || returns2.length < 20) return null;
    
    // Check correlation at different lags
    const maxLag = 5;
    let bestLag = 0;
    let bestCorr = 0;
    
    for (let lag = -maxLag; lag <= maxLag; lag++) {
      const corr = this.calculateLaggedCorrelation(returns1, returns2, lag);
      if (Math.abs(corr) > Math.abs(bestCorr)) {
        bestCorr = corr;
        bestLag = lag;
      }
    }
    
    if (Math.abs(bestCorr) < 0.5) return null;
    
    return {
      leader: bestLag > 0 ? symbol1 : symbol2,
      follower: bestLag > 0 ? symbol2 : symbol1,
      lag: Math.abs(bestLag),
      correlation: bestCorr,
      granger: {
        fStatistic: 0, // Placeholder
        pValue: 0.05,
        significant: true,
        lag: Math.abs(bestLag)
      }
    };
  }
  
  private calculateLaggedCorrelation(series1: number[], series2: number[], lag: number): number {
    if (lag === 0) {
      return this.calculateCorrelation(series1, series2);
    }
    
    if (lag > 0) {
      // series1 leads series2
      return this.calculateCorrelation(
        series1.slice(0, -lag),
        series2.slice(lag)
      );
    } else {
      // series2 leads series1
      return this.calculateCorrelation(
        series1.slice(-lag),
        series2.slice(0, lag)
      );
    }
  }
  
  private analyzeRegimeAlignment(): RegimeAlignment {
    const assets = Array.from(this.crossMarketData.keys());
    const currentRegimes: Record<string, MarketRegime> = {};
    
    for (const asset of assets) {
      const features = this.crossMarketData.get(asset)!;
      currentRegimes[asset] = this.detectMarketRegime(features, []);
    }
    
    // Calculate alignment score
    const regimeValues = Object.values(currentRegimes);
    const uniqueRegimes = new Set(regimeValues);
    const alignment = 1 - (uniqueRegimes.size - 1) / (regimeValues.length - 1);
    
    // Find divergences
    const divergences: string[] = [];
    const mainRegime = regimeValues[0];
    
    for (const [asset, regime] of Object.entries(currentRegimes)) {
      if (regime !== mainRegime) {
        divergences.push(asset);
      }
    }
    
    return {
      assets,
      currentRegimes,
      alignment,
      divergences
    };
  }
  
  private calculateContagionRisk(correlationMatrix: number[][]): number {
    // Average absolute correlation as contagion risk
    let sum = 0;
    let count = 0;
    
    for (let i = 0; i < correlationMatrix.length; i++) {
      for (let j = i + 1; j < correlationMatrix[i].length; j++) {
        sum += Math.abs(correlationMatrix[i][j]);
        count++;
      }
    }
    
    return count > 0 ? sum / count : 0;
  }
  
  private calculateDiversificationBenefit(correlationMatrix: number[][]): number {
    // Simplified: lower average correlation = higher diversification benefit
    const avgCorrelation = this.calculateContagionRisk(correlationMatrix);
    return 1 - avgCorrelation;
  }
  
  private calculateDisagreement(predictions: PredictionResult[]): number {
    if (predictions.length <= 1) return 0;
    
    // Calculate variance in predictions
    const returns = predictions.map(p => p.predictions.expectedReturn);
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    
    return Math.sqrt(variance);
  }
  
  /**
   * Get current performance metrics
   */
  getPerformance(): Record<string, ModelPerformance> {
    return { ...this.state.performance };
  }
  
  /**
   * Get active patterns
   */
  getActivePatterns(): FractalPattern[] {
    return [...this.state.activePatterns];
  }
  
  /**
   * Get market regime
   */
  getMarketRegime(): MarketRegime {
    return this.state.marketRegime;
  }
  
  /**
   * Clean up resources
   */
  dispose(): void {
    this.state.models.transformer.dispose();
    this.state.models.reinforcement.dispose();
    this.state.models.fractalDetector.dispose();
    
    this.featureBuffer.clear();
    this.predictionHistory.clear();
    this.crossMarketData.clear();
    
    this.removeAllListeners();
  }
} 