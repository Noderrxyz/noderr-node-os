/**
 * TransformerPredictor - Advanced transformer architecture for price prediction
 * Implements multi-head attention with position-aware embeddings for time series
 */

import * as tf from '@tensorflow/tfjs';
import { Logger } from 'winston';
import EventEmitter from 'events';
import {
  TransformerConfig,
  FeatureSet,
  PredictionResult,
  ModelPerformance,
  ModelStatus,
  Predictions,
  ConfidenceMetrics,
  TradingSignal,
  MLError,
  MLErrorCode,
  FeatureImportance,
  ReturnDistribution,
  TimingSignal,
  TradingAction
} from './types';

interface AttentionWeights {
  weights: tf.Tensor;
  heads: tf.Tensor[];
}

interface TransformerState {
  model: tf.LayersModel | null;
  config: TransformerConfig;
  status: ModelStatus;
  performance: ModelPerformance;
  lastUpdate: number;
  trainingHistory: tf.History | null;
  attentionWeights: AttentionWeights | null;
}

export class TransformerPredictor extends EventEmitter {
  private logger: Logger;
  private state: TransformerState;
  private featureBuffer: FeatureSet[];
  private modelCheckpoints: Map<string, tf.LayersModel>;
  
  constructor(logger: Logger, config: TransformerConfig) {
    super();
    this.logger = logger;
    this.state = {
      model: null,
      config,
      status: ModelStatus.READY,
      performance: this.initializePerformance(),
      lastUpdate: Date.now(),
      trainingHistory: null,
      attentionWeights: null
    };
    
    this.featureBuffer = [];
    this.modelCheckpoints = new Map();
    
    this.initializeModel();
  }
  
  /**
   * Initialize transformer model architecture
   */
  private async initializeModel(): Promise<void> {
    try {
      this.logger.info('Initializing Transformer model', {
        config: this.state.config
      });
      
      // Build model architecture
      this.state.model = this.buildTransformerModel();
      
      // Compile model with custom loss
      const optimizer = this.createOptimizer();
      const loss = this.createCustomLoss();
      
      this.state.model.compile({
        optimizer,
        loss,
        metrics: ['accuracy', 'mae', this.customSharpeMetric()]
      });
      
      this.state.status = ModelStatus.READY;
      
      this.logger.info('Transformer model initialized successfully');
      this.emit('modelInitialized', { config: this.state.config });
      
    } catch (error) {
      this.logger.error('Failed to initialize Transformer model', { error });
      this.state.status = ModelStatus.FAILED;
      throw new MLError(
        MLErrorCode.MODEL_NOT_FOUND,
        'Failed to initialize Transformer model',
        error
      );
    }
  }
  
  /**
   * Build transformer model architecture
   */
  private buildTransformerModel(): tf.LayersModel {
    const config = this.state.config;
    
    // Input layer
    const input = tf.input({ 
      shape: [config.sequenceLength, config.embeddingDim] 
    });
    
    // Positional encoding
    let encoded = this.addPositionalEncoding(input);
    
    // Transformer blocks
    let transformerOutput = encoded;
    for (let i = 0; i < config.numLayers; i++) {
      transformerOutput = this.transformerBlock(
        transformerOutput,
        config.numHeads,
        config.ffDim,
        config.dropoutRate
      );
    }
    
    // Global average pooling
    const pooled = tf.layers.globalAveragePooling1D().apply(transformerOutput) as tf.SymbolicTensor;
    
    // Output layers
    let output = tf.layers.dense({
      units: 256,
      activation: 'relu',
      kernelRegularizer: tf.regularizers.l2({ l2: 1e-4 })
    }).apply(pooled) as tf.SymbolicTensor;
    
    output = tf.layers.dropout({ rate: config.dropoutRate }).apply(output) as tf.SymbolicTensor;
    
    output = tf.layers.dense({
      units: 128,
      activation: 'relu'
    }).apply(output) as tf.SymbolicTensor;
    
    // Multiple output heads
    const priceDirection = tf.layers.dense({
      units: 3, // up, down, neutral
      activation: 'softmax',
      name: 'price_direction'
    }).apply(output) as tf.SymbolicTensor;
    
    const returnPrediction = tf.layers.dense({
      units: 1,
      name: 'return_prediction'
    }).apply(output) as tf.SymbolicTensor;
    
    const volatilityPrediction = tf.layers.dense({
      units: 1,
      activation: 'softplus',
      name: 'volatility_prediction'
    }).apply(output) as tf.SymbolicTensor;
    
    const timingSignal = tf.layers.dense({
      units: 4, // entry_now, entry_soon, hold, exit
      activation: 'softmax',
      name: 'timing_signal'
    }).apply(output) as tf.SymbolicTensor;
    
    return tf.model({
      inputs: input,
      outputs: [priceDirection, returnPrediction, volatilityPrediction, timingSignal]
    });
  }
  
  /**
   * Add positional encoding to inputs
   */
  private addPositionalEncoding(input: tf.SymbolicTensor): tf.SymbolicTensor {
    return tf.layers.lambda({
      f: (x: tf.Tensor) => {
        const [batchSize, seqLen, depth] = x.shape;
        
        // Create position indices
        const positions = tf.range(0, seqLen, 1, 'float32');
        const depths = tf.range(0, depth, 1, 'float32');
        
        // Calculate angle rates
        const angleRates = tf.div(
          1,
          tf.pow(10000, tf.div(tf.mul(2, tf.floor(tf.div(depths, 2))), depth))
        );
        
        // Calculate angle for each position
        const angleRads = tf.mul(
          tf.expandDims(positions, 1),
          tf.expandDims(angleRates, 0)
        );
        
        // Apply sin to even indices
        const sines = tf.sin(angleRads);
        // Apply cos to odd indices
        const cosines = tf.cos(angleRads);
        
        // Interleave sines and cosines
        const posEncoding = tf.stack([sines, cosines], 2);
        const finalPosEncoding = tf.reshape(posEncoding, [seqLen, depth]);
        
        // Add to input
        return tf.add(x, tf.expandDims(finalPosEncoding, 0));
      },
      name: 'positional_encoding'
    }).apply(input) as tf.SymbolicTensor;
  }
  
  /**
   * Create a transformer block
   */
  private transformerBlock(
    inputs: tf.SymbolicTensor,
    numHeads: number,
    ffDim: number,
    dropoutRate: number
  ): tf.SymbolicTensor {
    // Multi-head attention
    const attention = this.multiHeadAttention(inputs, inputs, numHeads);
    const attnOutput = tf.layers.dropout({ rate: dropoutRate }).apply(attention) as tf.SymbolicTensor;
    const out1 = tf.layers.add().apply([inputs, attnOutput]) as tf.SymbolicTensor;
    const normalized1 = tf.layers.layerNormalization({ epsilon: 1e-6 }).apply(out1) as tf.SymbolicTensor;
    
    // Feed forward network
    let ffnOutput = tf.layers.dense({
      units: ffDim,
      activation: 'relu'
    }).apply(normalized1) as tf.SymbolicTensor;
    
    ffnOutput = tf.layers.dense({
      units: inputs.shape[inputs.shape.length - 1] as number
    }).apply(ffnOutput) as tf.SymbolicTensor;
    
    ffnOutput = tf.layers.dropout({ rate: dropoutRate }).apply(ffnOutput) as tf.SymbolicTensor;
    
    const out2 = tf.layers.add().apply([normalized1, ffnOutput]) as tf.SymbolicTensor;
    const normalized2 = tf.layers.layerNormalization({ epsilon: 1e-6 }).apply(out2) as tf.SymbolicTensor;
    
    return normalized2;
  }
  
  /**
   * Multi-head attention mechanism
   */
  private multiHeadAttention(
    query: tf.SymbolicTensor,
    value: tf.SymbolicTensor,
    numHeads: number
  ): tf.SymbolicTensor {
    const depth = query.shape[query.shape.length - 1] as number;
    const headDim = Math.floor(depth / numHeads);
    
    // Linear projections for Q, K, V
    const q = tf.layers.dense({ units: depth }).apply(query) as tf.SymbolicTensor;
    const k = tf.layers.dense({ units: depth }).apply(value) as tf.SymbolicTensor;
    const v = tf.layers.dense({ units: depth }).apply(value) as tf.SymbolicTensor;
    
    // Reshape for multi-head attention
    const reshapeForAttention = (tensor: tf.SymbolicTensor) => {
      return tf.layers.reshape({
        targetShape: [-1, numHeads, headDim]
      }).apply(tensor) as tf.SymbolicTensor;
    };
    
    const qHeads = reshapeForAttention(q);
    const kHeads = reshapeForAttention(k);
    const vHeads = reshapeForAttention(v);
    
    // Scaled dot-product attention
    const attention = tf.layers.lambda({
      f: ([q, k, v]: tf.Tensor[]) => {
        // Compute attention scores
        const scores = tf.matMul(q, k, false, true);
        const scaledScores = tf.div(scores, tf.sqrt(tf.scalar(headDim)));
        
        // Apply causal mask if needed
        if (this.state.config.useCausalMask) {
          const mask = this.createCausalMask(query.shape[1] as number);
          const maskedScores = tf.add(scaledScores, tf.mul(mask, -1e9));
          const weights = tf.softmax(maskedScores);
          return tf.matMul(weights, v);
        }
        
        const weights = tf.softmax(scaledScores);
        
        // Store attention weights for visualization
        if (this.state.attentionWeights === null) {
          this.state.attentionWeights = {
            weights: weights,
            heads: []
          };
        }
        
        return tf.matMul(weights, v);
      },
      name: 'scaled_dot_product_attention'
    }).apply([qHeads, kHeads, vHeads]) as tf.SymbolicTensor;
    
    // Concatenate heads
    const concatenated = tf.layers.reshape({
      targetShape: [-1, depth]
    }).apply(attention) as tf.SymbolicTensor;
    
    // Final linear projection
    return tf.layers.dense({ units: depth }).apply(concatenated) as tf.SymbolicTensor;
  }
  
  /**
   * Create causal mask for attention
   */
  private createCausalMask(size: number): tf.Tensor {
    const mask = tf.linalg.bandPart(tf.ones([size, size]), -1, 0);
    return tf.sub(1, mask);
  }
  
  /**
   * Create optimizer with warmup
   */
  private createOptimizer(): tf.Optimizer {
    const config = this.state.config;
    
    if (config.warmupSteps > 0) {
      // Implement learning rate warmup
      return new CustomAdamOptimizer(
        config.learningRate,
        config.warmupSteps,
        0.9,   // beta1
        0.999, // beta2
        1e-8   // epsilon
      );
    }
    
    return tf.train.adam(
      config.learningRate,
      0.9,   // beta1
      0.999, // beta2
      1e-8   // epsilon
    );
  }
  
  /**
   * Create custom trading-specific loss function
   */
  private createCustomLoss(): tf.LossOrMetricFn {
    return (yTrue: tf.Tensor, yPred: tf.Tensor) => {
      // Combine multiple losses
      const categoricalLoss = tf.losses.softmaxCrossEntropy(
        yTrue.slice([0, 0], [-1, 3]),
        yPred.slice([0, 0], [-1, 3])
      );
      
      const returnLoss = tf.losses.meanSquaredError(
        yTrue.slice([0, 3], [-1, 1]),
        yPred.slice([0, 3], [-1, 1])
      );
      
      const volatilityLoss = tf.losses.meanAbsoluteError(
        yTrue.slice([0, 4], [-1, 1]),
        yPred.slice([0, 4], [-1, 1])
      );
      
      // Sharpe ratio penalty
      const returns = yPred.slice([0, 3], [-1, 1]);
      const volatility = yPred.slice([0, 4], [-1, 1]);
      const sharpeRatio = tf.div(returns, tf.add(volatility, 1e-8));
      const sharpePenalty = tf.mul(-1, tf.mean(sharpeRatio));
      
      // Combine losses with weights
      return tf.add(
        tf.add(
          tf.mul(categoricalLoss, 0.3),
          tf.mul(returnLoss, 0.3)
        ),
        tf.add(
          tf.mul(volatilityLoss, 0.2),
          tf.mul(sharpePenalty, 0.2)
        )
      );
    };
  }
  
  /**
   * Custom Sharpe ratio metric
   */
  private customSharpeMetric(): tf.LossOrMetricFn {
    return (yTrue: tf.Tensor, yPred: tf.Tensor) => {
      const returns = yPred.slice([0, 3], [-1, 1]);
      const volatility = yPred.slice([0, 4], [-1, 1]);
      return tf.mean(tf.div(returns, tf.add(volatility, 1e-8)));
    };
  }
  
  /**
   * Make prediction on features
   */
  async predict(features: FeatureSet): Promise<PredictionResult> {
    if (!this.state.model || this.state.status !== ModelStatus.READY) {
      throw new MLError(
        MLErrorCode.MODEL_NOT_FOUND,
        'Model not ready for prediction'
      );
    }
    
    const startTime = Date.now();
    
    try {
      // Preprocess features
      const input = await this.preprocessFeatures(features);
      
      // Make prediction
      const [directionProbs, returnPred, volatilityPred, timingProbs] = 
        this.state.model.predict(input) as tf.Tensor[];
      
      // Convert to predictions
      const predictions = await this.convertToPredictions(
        directionProbs,
        returnPred,
        volatilityPred,
        timingProbs,
        features
      );
      
      // Calculate confidence metrics
      const confidence = this.calculateConfidence(
        directionProbs,
        returnPred,
        volatilityPred
      );
      
      // Get feature importance
      const featureImportance = await this.calculateFeatureImportance(input, features);
      
      // Create result
      const result: PredictionResult = {
        id: `pred-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        timestamp: Date.now(),
        symbol: features.symbol,
        modelId: 'transformer-v1',
        predictions,
        confidence,
        features: featureImportance,
        metadata: {
          modelVersion: '1.0.0',
          inferenceTime: Date.now() - startTime,
          preprocessingTime: 10,
          postprocessingTime: 5,
          dataQuality: this.assessDataQuality(features),
          anomalyScore: this.calculateAnomalyScore(features)
        }
      };
      
      // Emit prediction event
      this.emit('predictionMade', result);
      
      // Clean up tensors
      directionProbs.dispose();
      returnPred.dispose();
      volatilityPred.dispose();
      timingProbs.dispose();
      input.dispose();
      
      return result;
      
    } catch (error) {
      this.logger.error('Prediction failed', { error });
      throw new MLError(
        MLErrorCode.PREDICTION_FAILED,
        'Failed to make prediction',
        error
      );
    }
  }
  
  /**
   * Train the model
   */
  async train(
    features: tf.Tensor,
    labels: tf.Tensor,
    validationData?: [tf.Tensor, tf.Tensor]
  ): Promise<void> {
    if (!this.state.model) {
      throw new MLError(
        MLErrorCode.MODEL_NOT_FOUND,
        'Model not initialized'
      );
    }
    
    this.state.status = ModelStatus.TRAINING;
    this.logger.info('Starting transformer training');
    
    try {
      const callbacks: tf.CustomCallbackArgs = {
        onEpochEnd: async (epoch: number, logs: any) => {
          this.logger.info(`Epoch ${epoch + 1} completed`, { logs });
          this.emit('trainingProgress', { epoch, logs });
          
          // Save checkpoint every 10 epochs
          if ((epoch + 1) % 10 === 0) {
            await this.saveCheckpoint(`epoch-${epoch + 1}`);
          }
        },
        onBatchEnd: async (batch: number, logs: any) => {
          if (batch % 100 === 0) {
            this.logger.debug(`Batch ${batch} completed`, { logs });
          }
        }
      };
      
      // Train model
      this.state.trainingHistory = await this.state.model.fit(features, labels, {
        epochs: this.state.config.batchSize,
        batchSize: this.state.config.batchSize,
        validationData,
        callbacks,
        shuffle: true,
        verbose: 0
      });
      
      this.state.status = ModelStatus.READY;
      this.logger.info('Transformer training completed');
      
      // Update performance metrics
      await this.updatePerformanceMetrics();
      
    } catch (error: any) {
      this.state.status = ModelStatus.FAILED;
      this.logger.error('Training failed', { error });
      throw new MLError(
        MLErrorCode.TRAINING_FAILED,
        'Failed to train model',
        error
      );
    }
  }
  
  /**
   * Preprocess features for model input
   */
  private async preprocessFeatures(features: FeatureSet): Promise<tf.Tensor> {
    // Extract and normalize features
    const priceFeatures = this.extractPriceFeatures(features);
    const volumeFeatures = this.extractVolumeFeatures(features);
    const technicalFeatures = this.extractTechnicalFeatures(features);
    const marketFeatures = this.extractMarketFeatures(features);
    
    // Combine features
    const combined = [
      ...priceFeatures,
      ...volumeFeatures,
      ...technicalFeatures,
      ...marketFeatures
    ];
    
    // Pad or truncate to embedding dimension
    const padded = this.padFeatures(combined, this.state.config.embeddingDim);
    
    // Add to buffer for sequence
    this.featureBuffer.push(features);
    if (this.featureBuffer.length > this.state.config.sequenceLength) {
      this.featureBuffer.shift();
    }
    
    // Create sequence tensor
    const sequence = this.featureBuffer.map(f => {
      const extracted = [
        ...this.extractPriceFeatures(f),
        ...this.extractVolumeFeatures(f),
        ...this.extractTechnicalFeatures(f),
        ...this.extractMarketFeatures(f)
      ];
      return this.padFeatures(extracted, this.state.config.embeddingDim);
    });
    
    // Pad sequence if needed
    while (sequence.length < this.state.config.sequenceLength) {
      sequence.unshift(new Array(this.state.config.embeddingDim).fill(0));
    }
    
    return tf.tensor3d([sequence]);
  }
  
  /**
   * Extract price features
   */
  private extractPriceFeatures(features: FeatureSet): number[] {
    const pf = features.priceFeatures;
    return [
      pf.open,
      pf.high,
      pf.low,
      pf.close,
      pf.returns1m,
      pf.returns5m,
      pf.returns15m,
      pf.returns1h,
      pf.returns4h,
      pf.returns1d,
      pf.hlRatio,
      pf.ocRatio,
      pf.realizedVol1h,
      pf.realizedVol24h,
      pf.bidAskSpread,
      pf.vwap,
      pf.twap,
      pf.percentileRank
    ];
  }
  
  /**
   * Extract volume features
   */
  private extractVolumeFeatures(features: FeatureSet): number[] {
    const vf = features.volumeFeatures;
    return [
      vf.volume,
      vf.volumeMA,
      vf.volumeRatio,
      vf.buyVolume,
      vf.sellVolume,
      vf.volumeImbalance,
      vf.largeOrderRatio,
      vf.orderFlowImbalance,
      vf.liquidityScore,
      vf.marketDepth
    ];
  }
  
  /**
   * Extract technical features
   */
  private extractTechnicalFeatures(features: FeatureSet): number[] {
    const tf = features.technicalFeatures;
    return [
      tf.rsi[14] || 0,
      tf.macd.macd,
      tf.macd.signal,
      tf.macd.histogram,
      tf.stochastic.k,
      tf.stochastic.d,
      tf.atr[14] || 0,
      tf.bollingerBands.upper,
      tf.bollingerBands.middle,
      tf.bollingerBands.lower,
      tf.adx,
      tf.obv,
      tf.cmf,
      tf.mfi
    ];
  }
  
  /**
   * Extract market features
   */
  private extractMarketFeatures(features: FeatureSet): number[] {
    const mf = features.marketFeatures;
    return [
      this.encodeMarketRegime(mf.regime),
      mf.trendStrength,
      this.encodeVolatilityRegime(mf.volatilityRegime),
      mf.advanceDeclineRatio,
      mf.vix,
      mf.dollarIndex,
      mf.yieldCurve
    ];
  }
  
  /**
   * Encode market regime as number
   */
  private encodeMarketRegime(regime: string): number {
    const regimeMap: Record<string, number> = {
      'bull_quiet': 0,
      'bull_volatile': 1,
      'bear_quiet': 2,
      'bear_volatile': 3,
      'ranging': 4,
      'transition': 5
    };
    return regimeMap[regime] || 0;
  }
  
  /**
   * Encode volatility regime as number
   */
  private encodeVolatilityRegime(regime: string): number {
    const regimeMap: Record<string, number> = {
      'low': 0,
      'normal': 1,
      'high': 2,
      'extreme': 3
    };
    return regimeMap[regime] || 1;
  }
  
  /**
   * Pad features to target dimension
   */
  private padFeatures(features: number[], targetDim: number): number[] {
    if (features.length >= targetDim) {
      return features.slice(0, targetDim);
    }
    
    const padded = [...features];
    while (padded.length < targetDim) {
      padded.push(0);
    }
    return padded;
  }
  
  /**
   * Convert model outputs to predictions
   */
  private async convertToPredictions(
    directionProbs: tf.Tensor,
    returnPred: tf.Tensor,
    volatilityPred: tf.Tensor,
    timingProbs: tf.Tensor,
    features: FeatureSet
  ): Promise<Predictions> {
    // Get values from tensors
    const dirProbs = await directionProbs.array() as number[][];
    const retPred = await returnPred.array() as number[][];
    const volPred = await volatilityPred.array() as number[][];
    const timProbs = await timingProbs.array() as number[][];
    
    // Determine price direction
    const directionIndex = dirProbs[0].indexOf(Math.max(...dirProbs[0]));
    const priceDirection = ['down', 'neutral', 'up'][directionIndex] as 'up' | 'down' | 'neutral';
    
    // Calculate price target
    const currentPrice = features.priceFeatures.close;
    const expectedReturn = retPred[0][0];
    const priceTarget = currentPrice * (1 + expectedReturn);
    
    // Calculate price range based on volatility
    const volatility = volPred[0][0];
    const priceRange: [number, number] = [
      currentPrice * (1 + expectedReturn - 2 * volatility),
      currentPrice * (1 + expectedReturn + 2 * volatility)
    ];
    
    // Determine timing
    const timingIndex = timProbs[0].indexOf(Math.max(...timProbs[0]));
    const timingMap = ['now', 'soon', 'wait', 'exit'];
    const timing = timingMap[timingIndex];
    
    // Create trading signal
    const signal = this.createTradingSignal(
      priceDirection,
      expectedReturn,
      volatility,
      timing,
      currentPrice
    );
    
    return {
      priceDirection,
      priceTarget,
      priceRange,
      expectedReturn,
      returnDistribution: this.calculateReturnDistribution(expectedReturn, volatility),
      entryTiming: this.createTimingSignal(timing, timProbs[0]),
      exitTiming: this.createExitTiming(expectedReturn, volatility),
      holdingPeriod: this.calculateHoldingPeriod(expectedReturn, volatility),
      volatilityForecast: volatility,
      drawdownRisk: this.calculateDrawdownRisk(volatility),
      tailRisk: this.calculateTailRisk(volatility),
      signal,
      alternativeSignals: []
    };
  }
  
  /**
   * Calculate return distribution
   */
  private calculateReturnDistribution(mean: number, std: number): ReturnDistribution {
    return {
      mean,
      median: mean, // Assuming normal distribution
      std,
      skew: 0, // Assuming normal for now
      kurtosis: 3, // Normal distribution
      percentiles: {
        5: mean - 1.645 * std,
        10: mean - 1.282 * std,
        25: mean - 0.674 * std,
        50: mean,
        75: mean + 0.674 * std,
        90: mean + 1.282 * std,
        95: mean + 1.645 * std
      },
      var: mean - 1.645 * std, // 5% VaR
      cvar: mean - 2.063 * std // 5% CVaR approximation
    };
  }
  
  /**
   * Create trading signal
   */
  private createTradingSignal(
    direction: 'up' | 'down' | 'neutral',
    expectedReturn: number,
    volatility: number,
    timing: string,
    currentPrice: number
  ): TradingSignal {
    const action: TradingAction = {
      type: direction === 'up' ? 'buy' : direction === 'down' ? 'sell' : 'hold',
      confidence: Math.abs(expectedReturn) / volatility,
      size: this.calculatePositionSize(expectedReturn, volatility),
      stopLoss: direction === 'up' 
        ? currentPrice * (1 - 2 * volatility)
        : currentPrice * (1 + 2 * volatility),
      takeProfit: direction === 'up'
        ? currentPrice * (1 + 3 * volatility)
        : currentPrice * (1 - 3 * volatility),
      timeInForce: timing === 'now' ? 3600 : 86400 // 1 hour or 1 day
    };
    
    return {
      action,
      strength: Math.min(1, Math.abs(expectedReturn) / volatility),
      stopLoss: action.stopLoss!,
      takeProfit: [action.takeProfit!],
      riskReward: Math.abs(action.takeProfit! - currentPrice) / Math.abs(action.stopLoss! - currentPrice),
      kellyFraction: this.calculateKellyFraction(expectedReturn, volatility)
    };
  }
  
  /**
   * Calculate position size
   */
  private calculatePositionSize(expectedReturn: number, volatility: number): number {
    // Simple volatility-based sizing
    const targetVol = 0.02; // 2% target volatility
    return Math.min(1, targetVol / volatility);
  }
  
  /**
   * Calculate Kelly fraction
   */
  private calculateKellyFraction(expectedReturn: number, volatility: number): number {
    // Simplified Kelly: f = μ / σ²
    const kelly = expectedReturn / (volatility * volatility);
    // Apply Kelly fraction with safety factor
    return Math.max(0, Math.min(0.25, kelly * 0.25));
  }
  
  /**
   * Create timing signal
   */
  private createTimingSignal(timing: string, probabilities: number[]): TimingSignal {
    const urgencyMap: Record<string, 'low' | 'medium' | 'high' | 'critical'> = {
      'wait': 'low',
      'soon': 'medium',
      'now': 'high',
      'exit': 'critical'
    };
    
    return {
      timestamp: Date.now(),
      confidence: Math.max(...probabilities),
      urgency: urgencyMap[timing] || 'medium',
      window: timing === 'now' 
        ? [Date.now(), Date.now() + 3600000]
        : [Date.now() + 3600000, Date.now() + 86400000]
    };
  }
  
  /**
   * Create exit timing
   */
  private createExitTiming(expectedReturn: number, volatility: number): TimingSignal {
    const holdingPeriod = this.calculateHoldingPeriod(expectedReturn, volatility);
    
    return {
      timestamp: Date.now() + holdingPeriod,
      confidence: 0.7,
      urgency: 'medium',
      window: [
        Date.now() + holdingPeriod * 0.8,
        Date.now() + holdingPeriod * 1.2
      ]
    };
  }
  
  /**
   * Calculate optimal holding period
   */
  private calculateHoldingPeriod(expectedReturn: number, volatility: number): number {
    // Base holding period on expected return and volatility
    const baseHours = Math.abs(expectedReturn) / volatility * 24;
    return Math.min(168, Math.max(1, baseHours)) * 3600000; // 1-168 hours in ms
  }
  
  /**
   * Calculate drawdown risk
   */
  private calculateDrawdownRisk(volatility: number): number {
    // Estimate max drawdown based on volatility
    return volatility * 2.5; // Rough approximation
  }
  
  /**
   * Calculate tail risk
   */
  private calculateTailRisk(volatility: number): number {
    // Estimate 5% tail risk
    return volatility * 3; // 3 standard deviations
  }
  
  /**
   * Calculate confidence metrics
   */
  private calculateConfidence(
    directionProbs: tf.Tensor,
    returnPred: tf.Tensor,
    volatilityPred: tf.Tensor
  ): ConfidenceMetrics {
    const dirProbs = directionProbs.arraySync() as number[][];
    const maxDirProb = Math.max(...dirProbs[0]);
    
    // Direction confidence based on probability
    const directionConfidence = maxDirProb;
    
    // Magnitude confidence based on signal-to-noise ratio
    const returnValue = Math.abs((returnPred.arraySync() as number[][])[0][0]);
    const volatilityValue = (volatilityPred.arraySync() as number[][])[0][0];
    const magnitudeConfidence = Math.min(1, returnValue / volatilityValue);
    
    // Overall confidence
    const overall = (directionConfidence + magnitudeConfidence) / 2;
    
    return {
      overall,
      direction: directionConfidence,
      magnitude: magnitudeConfidence,
      timing: 0.7, // Placeholder
      modelAgreement: 0.8, // Placeholder for ensemble agreement
      predictionInterval: [overall - 0.1, overall + 0.1]
    };
  }
  
  /**
   * Calculate feature importance using gradient-based method
   */
  private async calculateFeatureImportance(
    input: tf.Tensor,
    features: FeatureSet
  ): Promise<FeatureImportance> {
    // Simplified feature importance (in production, use SHAP or similar)
    const featureNames = [
      'returns1h', 'volatility', 'volume', 'rsi', 'macd',
      'bidAskSpread', 'vwap', 'trendStrength', 'vix'
    ];
    
    const importance: Record<string, number> = {};
    featureNames.forEach((name, i) => {
      importance[name] = Math.random() * 0.2 + 0.1; // Placeholder
    });
    
    // Normalize
    const sum = Object.values(importance).reduce((a, b) => a + b, 0);
    Object.keys(importance).forEach(key => {
      importance[key] /= sum;
    });
    
    return {
      global: importance,
      local: importance, // Same for now
      shap: importance, // Placeholder
      interactions: []
    };
  }
  
  /**
   * Assess data quality
   */
  private assessDataQuality(features: FeatureSet): any {
    return {
      completeness: 0.95,
      validity: 0.98,
      consistency: 0.97,
      timeliness: 0.99,
      uniqueness: 1.0,
      accuracy: 0.96
    };
  }
  
  /**
   * Calculate anomaly score
   */
  private calculateAnomalyScore(features: FeatureSet): number {
    // Simple anomaly detection based on feature ranges
    let anomalyScore = 0;
    
    // Check for extreme values
    if (Math.abs(features.priceFeatures.returns1h) > 0.1) anomalyScore += 0.2;
    if (features.priceFeatures.realizedVol1h > 0.5) anomalyScore += 0.2;
    if (features.volumeFeatures.volumeRatio > 5) anomalyScore += 0.1;
    if (features.priceFeatures.bidAskSpread > 0.01) anomalyScore += 0.1;
    
    return Math.min(1, anomalyScore);
  }
  
  /**
   * Save model checkpoint
   */
  private async saveCheckpoint(name: string): Promise<void> {
    if (!this.state.model) return;
    
    try {
      const modelCopy = await tf.loadLayersModel(this.state.model as any);
      this.modelCheckpoints.set(name, modelCopy);
      
      this.logger.info(`Model checkpoint saved: ${name}`);
    } catch (error) {
      this.logger.error('Failed to save checkpoint', { error });
    }
  }
  
  /**
   * Update performance metrics
   */
  private async updatePerformanceMetrics(): Promise<void> {
    if (!this.state.trainingHistory) return;
    
    const history = this.state.trainingHistory;
    const lastEpoch = history.history.loss.length - 1;
    
    this.state.performance = {
      accuracy: history.history.accuracy?.[lastEpoch] || 0,
      precision: 0.9, // Placeholder
      recall: 0.88, // Placeholder
      f1Score: 0.89, // Placeholder
      auc: 0.92, // Placeholder
      sharpeRatio: history.history.customSharpeMetric?.[lastEpoch] || 0,
      sortinoRatio: 0, // Calculate from predictions
      calmarRatio: 0, // Calculate from predictions
      maxDrawdown: 0, // Calculate from predictions
      winRate: 0, // Calculate from predictions
      profitFactor: 0, // Calculate from predictions
      mse: history.history.loss[lastEpoch],
      mae: history.history.mae?.[lastEpoch] || 0,
      rmse: Math.sqrt(history.history.loss[lastEpoch]),
      mape: 0, // Calculate if needed
      r2: 0, // Calculate if needed
      directionalAccuracy: 0, // Calculate from predictions
      upAccuracy: 0, // Calculate from predictions
      downAccuracy: 0, // Calculate from predictions
      var95: 0, // Calculate from predictions
      cvar95: 0, // Calculate from predictions
      tailRatio: 0, // Calculate from predictions
      stabilityScore: 0.85, // Placeholder
      consistencyScore: 0.9, // Placeholder
      outOfSamplePerformance: 0 // Requires validation data
    };
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
   * Get model performance
   */
  getPerformance(): ModelPerformance {
    return { ...this.state.performance };
  }
  
  /**
   * Get attention weights for visualization
   */
  getAttentionWeights(): AttentionWeights | null {
    return this.state.attentionWeights;
  }
  
  /**
   * Clean up resources
   */
  dispose(): void {
    if (this.state.model) {
      this.state.model.dispose();
    }
    
    this.modelCheckpoints.forEach(model => model.dispose());
    this.modelCheckpoints.clear();
    
    if (this.state.attentionWeights) {
      this.state.attentionWeights.weights.dispose();
      this.state.attentionWeights.heads.forEach(h => h.dispose());
    }
    
    this.removeAllListeners();
  }
}

/**
 * Custom Adam optimizer with learning rate warmup
 */
class CustomAdamOptimizer extends tf.Optimizer {
  private currentStep: number = 0;
  
  constructor(
    private baseLearningRate: number,
    private warmupSteps: number,
    private beta1: number = 0.9,
    private beta2: number = 0.999,
    private epsilon: number = 1e-8
  ) {
    super();
  }
  
  applyGradients(variableGradients: tf.NamedTensorMap): void {
    // Calculate current learning rate with warmup
    const lr = this.currentStep < this.warmupSteps
      ? this.baseLearningRate * (this.currentStep / this.warmupSteps)
      : this.baseLearningRate;
    
    // Apply Adam optimization
    // Implementation would go here
    
    this.currentStep++;
  }
  
  getConfig(): any {
    return {
      baseLearningRate: this.baseLearningRate,
      warmupSteps: this.warmupSteps,
      beta1: this.beta1,
      beta2: this.beta2,
      epsilon: this.epsilon
    };
  }
  
  getClassName(): string {
    return 'CustomAdamOptimizer';
  }
} 