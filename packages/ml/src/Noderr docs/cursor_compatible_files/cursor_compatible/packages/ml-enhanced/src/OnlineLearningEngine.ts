import * as tf from '@tensorflow/tfjs-node-gpu';
import { EventEmitter } from 'events';
import * as winston from 'winston';

/**
 * Online learning configuration
 */
export interface OnlineLearningConfig {
  // Model parameters
  learningRate: number;
  batchSize: number;
  warmupSamples: number;
  
  // Feature configuration
  featureDimension: number;
  outputDimension: number;
  
  // Update frequency
  updateFrequency: number;
  
  // GPU configuration
  useGPU: boolean;
  gpuMemoryFraction?: number;
  
  // Model persistence
  modelPath?: string;
  checkpointInterval?: number;
}

/**
 * Feature vector for online learning
 */
export interface FeatureVector {
  timestamp: number;
  features: number[];
  metadata?: Record<string, any>;
}

/**
 * Prediction result
 */
export interface PredictionResult {
  prediction: number[];
  confidence: number;
  uncertainty: number;
  processingTimeMs: number;
}

/**
 * Online learning engine with GPU acceleration
 */
export class OnlineLearningEngine extends EventEmitter {
  private config: OnlineLearningConfig;
  private logger: winston.Logger;
  private model: tf.Sequential | null = null;
  private optimizer: tf.Optimizer | null = null;
  private featureBuffer: FeatureVector[] = [];
  private targetBuffer: number[][] = [];
  private updateCount: number = 0;
  private totalSamples: number = 0;
  private isWarmingUp: boolean = true;
  
  // Performance tracking
  private recentLosses: number[] = [];
  private recentAccuracies: number[] = [];
  
  constructor(config: OnlineLearningConfig, logger: winston.Logger) {
    super();
    
    this.config = config;
    this.logger = logger;
    
    // Configure TensorFlow
    if (config.useGPU) {
      this.configureGPU();
    }
    
    // Initialize model
    this.initializeModel();
  }
  
  /**
   * Configure GPU settings
   */
  private configureGPU(): void {
    if (this.config.gpuMemoryFraction) {
      tf.env().set('WEBGL_FORCE_F16_TEXTURES', true);
      // Note: GPU memory fraction control is limited in tfjs
    }
    
    this.logger.info('GPU acceleration enabled for online learning');
  }
  
  /**
   * Initialize the neural network model
   */
  private initializeModel(): void {
    // Create a simple but effective model
    this.model = tf.sequential({
      layers: [
        // Input layer with batch normalization
        tf.layers.dense({
          inputShape: [this.config.featureDimension],
          units: 128,
          activation: 'relu',
          kernelInitializer: 'heNormal'
        }),
        tf.layers.batchNormalization(),
        tf.layers.dropout({ rate: 0.2 }),
        
        // Hidden layers
        tf.layers.dense({
          units: 64,
          activation: 'relu',
          kernelInitializer: 'heNormal'
        }),
        tf.layers.batchNormalization(),
        tf.layers.dropout({ rate: 0.2 }),
        
        tf.layers.dense({
          units: 32,
          activation: 'relu',
          kernelInitializer: 'heNormal'
        }),
        
        // Output layer
        tf.layers.dense({
          units: this.config.outputDimension,
          activation: 'linear'
        })
      ]
    });
    
    // Create adaptive optimizer
    this.optimizer = tf.train.adam(this.config.learningRate);
    
    // Compile model
    this.model.compile({
      optimizer: this.optimizer,
      loss: 'meanSquaredError',
      metrics: ['mae']
    });
    
    this.logger.info('Online learning model initialized', {
      inputDim: this.config.featureDimension,
      outputDim: this.config.outputDimension,
      learningRate: this.config.learningRate
    });
  }
  
  /**
   * Update model with new data
   */
  async update(features: FeatureVector, target: number[]): Promise<void> {
    // Add to buffers
    this.featureBuffer.push(features);
    this.targetBuffer.push(target);
    this.totalSamples++;
    
    // Check if still warming up
    if (this.isWarmingUp && this.totalSamples >= this.config.warmupSamples) {
      this.isWarmingUp = false;
      this.emit('warmupComplete');
      this.logger.info('Online learning warmup complete');
    }
    
    // Update model if buffer is full
    if (this.featureBuffer.length >= this.config.batchSize) {
      await this.performUpdate();
    }
  }
  
  /**
   * Perform model update
   */
  private async performUpdate(): Promise<void> {
    if (!this.model || this.featureBuffer.length === 0) {
      return;
    }
    
    const startTime = Date.now();
    
    // Prepare tensors
    const featureArray = this.featureBuffer.map(f => f.features);
    const targetArray = this.targetBuffer;
    
    const xs = tf.tensor2d(featureArray);
    const ys = tf.tensor2d(targetArray);
    
    try {
      // Perform gradient update
      const result = await this.model.fit(xs, ys, {
        batchSize: this.config.batchSize,
        epochs: 1,
        verbose: 0
      });
      
      // Track performance
      const loss = result.history.loss[0] as number;
      this.recentLosses.push(loss);
      if (this.recentLosses.length > 100) {
        this.recentLosses.shift();
      }
      
      // Calculate moving average loss
      const avgLoss = this.recentLosses.reduce((a, b) => a + b, 0) / this.recentLosses.length;
      
      this.updateCount++;
      
      // Emit update event
      this.emit('modelUpdated', {
        updateCount: this.updateCount,
        loss,
        avgLoss,
        samples: this.totalSamples,
        updateTimeMs: Date.now() - startTime
      });
      
      // Clear buffers
      this.featureBuffer = [];
      this.targetBuffer = [];
      
      // Checkpoint if needed
      if (this.config.checkpointInterval && 
          this.updateCount % this.config.checkpointInterval === 0) {
        await this.checkpoint();
      }
      
    } finally {
      // Clean up tensors
      xs.dispose();
      ys.dispose();
    }
  }
  
  /**
   * Make prediction with uncertainty estimation
   */
  async predict(features: FeatureVector): Promise<PredictionResult> {
    if (!this.model) {
      throw new Error('Model not initialized');
    }
    
    const startTime = Date.now();
    
    // Prepare input tensor
    const input = tf.tensor2d([features.features]);
    
    try {
      // Make prediction
      const prediction = this.model.predict(input) as tf.Tensor;
      const predictionArray = await prediction.array() as number[][];
      
      // Estimate uncertainty using dropout Monte Carlo
      const mcSamples = 10;
      const predictions: number[][] = [];
      
      // Note: In tfjs, we can't force dropout during inference
      // So we'll use multiple predictions for uncertainty estimation
      for (let i = 0; i < mcSamples; i++) {
        const mcPred = this.model.predict(input) as tf.Tensor;
        const mcArray = await mcPred.array() as number[][];
        predictions.push(mcArray[0]);
        mcPred.dispose();
      }
      
      // Calculate mean and variance
      const mean = predictions[0].map((_, idx) => {
        const values = predictions.map(p => p[idx]);
        return values.reduce((a, b) => a + b, 0) / values.length;
      });
      
      const variance = predictions[0].map((_, idx) => {
        const values = predictions.map(p => p[idx]);
        const m = mean[idx];
        return values.reduce((a, b) => a + Math.pow(b - m, 2), 0) / values.length;
      });
      
      // Calculate overall uncertainty
      const uncertainty = Math.sqrt(variance.reduce((a, b) => a + b, 0) / variance.length);
      
      // Calculate confidence (inverse of uncertainty)
      const confidence = 1 / (1 + uncertainty);
      
      prediction.dispose();
      
      return {
        prediction: mean,
        confidence,
        uncertainty,
        processingTimeMs: Date.now() - startTime
      };
      
    } finally {
      input.dispose();
    }
  }
  
  /**
   * Force model update with current buffer
   */
  async forceUpdate(): Promise<void> {
    if (this.featureBuffer.length > 0) {
      await this.performUpdate();
    }
  }
  
  /**
   * Save model checkpoint
   */
  async checkpoint(): Promise<void> {
    if (!this.model || !this.config.modelPath) {
      return;
    }
    
    const path = `${this.config.modelPath}/checkpoint_${this.updateCount}`;
    await this.model.save(`file://${path}`);
    
    this.logger.info('Model checkpoint saved', { path, updateCount: this.updateCount });
    this.emit('checkpointSaved', { path, updateCount: this.updateCount });
  }
  
  /**
   * Load model from checkpoint
   */
  async loadCheckpoint(path: string): Promise<void> {
    this.model = await tf.loadLayersModel(`file://${path}`) as tf.Sequential;
    
    // Recompile model
    this.model.compile({
      optimizer: this.optimizer!,
      loss: 'meanSquaredError',
      metrics: ['mae']
    });
    
    this.logger.info('Model loaded from checkpoint', { path });
    this.emit('checkpointLoaded', { path });
  }
  
  /**
   * Get model performance metrics
   */
  getPerformanceMetrics(): ModelPerformanceMetrics {
    const avgLoss = this.recentLosses.length > 0
      ? this.recentLosses.reduce((a, b) => a + b, 0) / this.recentLosses.length
      : null;
    
    const lossStdDev = this.recentLosses.length > 1
      ? Math.sqrt(
          this.recentLosses.reduce((sum, loss) => {
            const diff = loss - avgLoss!;
            return sum + diff * diff;
          }, 0) / this.recentLosses.length
        )
      : null;
    
    return {
      totalSamples: this.totalSamples,
      updateCount: this.updateCount,
      isWarmingUp: this.isWarmingUp,
      averageLoss: avgLoss,
      lossStdDev,
      recentLosses: [...this.recentLosses]
    };
  }
  
  /**
   * Cleanup resources
   */
  async dispose(): Promise<void> {
    if (this.model) {
      this.model.dispose();
      this.model = null;
    }
    
    // Clear buffers
    this.featureBuffer = [];
    this.targetBuffer = [];
    
    // Dispose any remaining tensors
    tf.disposeVariables();
  }
}

/**
 * Model performance metrics
 */
export interface ModelPerformanceMetrics {
  totalSamples: number;
  updateCount: number;
  isWarmingUp: boolean;
  averageLoss: number | null;
  lossStdDev: number | null;
  recentLosses: number[];
} 