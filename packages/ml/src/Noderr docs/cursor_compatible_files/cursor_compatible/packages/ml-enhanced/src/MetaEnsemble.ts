import * as tf from '@tensorflow/tfjs-node-gpu';
import { LightGBM, CatBoost, XGBoost } from './models/types';
import { TabNet } from './models/TabNet';
import { SAINT } from './models/SAINT';
import * as winston from 'winston';

export interface EnsemblePrediction {
  value: number;
  uncertainty: number;
  modelWeights: number[];
  confidence: number;
}

export interface ModelConfig {
  name: string;
  weight: number;
  enabled: boolean;
  latencyBudgetMs: number;
}

export class MetaEnsemble {
  private models: Map<string, any> = new Map();
  private metaLearner!: tf.Sequential;
  private modelConfigs: Map<string, ModelConfig> = new Map();
  private performanceTracker: Map<string, ModelPerformance> = new Map();
  private logger: winston.Logger;
  
  constructor(logger: winston.Logger) {
    this.logger = logger;
    this.initializeModels();
    this.initializeMetaLearner();
  }
  
  private async initializeModels(): Promise<void> {
    // LightGBM for speed
    this.models.set('lightgbm', new LightGBM({
      objective: 'regression',
      metric: 'rmse',
      boosting_type: 'gbdt',
      num_leaves: 31,
      learning_rate: 0.05,
      feature_fraction: 0.9,
      bagging_fraction: 0.8,
      bagging_freq: 5,
      verbose: -1,
      num_threads: 4,
      device_type: 'cpu',
      force_col_wise: true
    }));
    
    // CatBoost for categorical features
    this.models.set('catboost', new CatBoost({
      iterations: 100,
      learning_rate: 0.03,
      depth: 6,
      loss_function: 'RMSE',
      eval_metric: 'RMSE',
      random_seed: 42,
      logging_level: 'Silent',
      thread_count: 4,
      use_best_model: true,
      task_type: 'GPU',
      devices: '0'
    }));
    
    // XGBoost for GPU acceleration
    this.models.set('xgboost', new XGBoost({
      objective: 'reg:squarederror',
      max_depth: 6,
      eta: 0.3,
      subsample: 0.8,
      colsample_bytree: 0.8,
      tree_method: 'gpu_hist',
      gpu_id: 0,
      predictor: 'gpu_predictor',
      n_estimators: 100
    }));
    
    // TabNet for deep learning
    this.models.set('tabnet', new TabNet({
      n_d: 8,
      n_a: 8,
      n_steps: 3,
      gamma: 1.3,
      cat_idxs: [],
      cat_dims: [],
      cat_emb_dim: 1,
      n_independent: 2,
      n_shared: 2,
      epsilon: 1e-15,
      momentum: 0.98,
      lambda_sparse: 1e-3,
      seed: 42,
      clip_value: 1.0,
      verbose: 0,
      optimizer_fn: tf.train.adam,
      optimizer_params: { learningRate: 0.02 },
      scheduler_fn: null,
      scheduler_params: null,
      mask_type: 'sparsemax',
      device_name: 'gpu'
    }));
    
    // SAINT for self-attention
    this.models.set('saint', new SAINT({
      num_heads: 8,
      num_blocks: 3,
      embedding_dim: 32,
      attention_dropout: 0.1,
      ffn_dropout: 0.1,
      hidden_dim: 256,
      activation: 'gelu',
      normalization: 'layer',
      numerical_embedding_type: 'linear',
      categorical_embedding_type: 'entity',
      task: 'regression',
      device: 'cuda'
    }));
    
    // Initialize model configs
    this.modelConfigs.set('lightgbm', { 
      name: 'lightgbm', 
      weight: 0.25, 
      enabled: true, 
      latencyBudgetMs: 5 
    });
    this.modelConfigs.set('catboost', { 
      name: 'catboost', 
      weight: 0.2, 
      enabled: true, 
      latencyBudgetMs: 10 
    });
    this.modelConfigs.set('xgboost', { 
      name: 'xgboost', 
      weight: 0.25, 
      enabled: true, 
      latencyBudgetMs: 8 
    });
    this.modelConfigs.set('tabnet', { 
      name: 'tabnet', 
      weight: 0.15, 
      enabled: true, 
      latencyBudgetMs: 20 
    });
    this.modelConfigs.set('saint', { 
      name: 'saint', 
      weight: 0.15, 
      enabled: true, 
      latencyBudgetMs: 25 
    });
  }
  
  private initializeMetaLearner(): void {
    this.metaLearner = tf.sequential({
      layers: [
        tf.layers.dense({
          inputShape: [5], // 5 models
          units: 16,
          activation: 'relu',
          kernelInitializer: 'heNormal',
          kernelRegularizer: tf.regularizers.l2({ l2: 0.01 })
        }),
        tf.layers.dropout({ rate: 0.1 }),
        tf.layers.dense({
          units: 8,
          activation: 'relu',
          kernelInitializer: 'heNormal'
        }),
        tf.layers.dense({
          units: 1,
          activation: 'linear'
        })
      ]
    });
    
    this.metaLearner.compile({
      optimizer: tf.train.adam(0.001),
      loss: 'meanSquaredError',
      metrics: ['mae']
    });
  }
  
  async predictWithConfidence(features: number[][]): Promise<EnsemblePrediction> {
    const startTime = Date.now();
    const predictions: number[] = [];
    const modelNames: string[] = [];
    const latencies: number[] = [];
    
    // Get predictions from each enabled model
    const predictionPromises = Array.from(this.models.entries())
      .filter(([name, _]) => this.modelConfigs.get(name)?.enabled)
      .map(async ([name, model]) => {
        const modelStart = Date.now();
        try {
          const pred = await this.predictWithTimeout(
            model, 
            features, 
            this.modelConfigs.get(name)!.latencyBudgetMs
          );
          const latency = Date.now() - modelStart;
          
          return { name, prediction: pred, latency };
        } catch (error) {
          this.logger.warn(`Model ${name} failed or timed out`, error);
          return null;
        }
      });
    
    const results = await Promise.all(predictionPromises);
    
    // Filter successful predictions
    for (const result of results) {
      if (result) {
        predictions.push(result.prediction);
        modelNames.push(result.name);
        latencies.push(result.latency);
        
        // Update performance tracking
        this.updateModelPerformance(result.name, result.latency);
      }
    }
    
    if (predictions.length === 0) {
      throw new Error('All models failed to produce predictions');
    }
    
    // Calculate uncertainty as standard deviation
    const mean = predictions.reduce((a, b) => a + b, 0) / predictions.length;
    const variance = predictions.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / predictions.length;
    const uncertainty = Math.sqrt(variance);
    
    // Get model weights
    const modelWeights = modelNames.map(name => 
      this.modelConfigs.get(name)?.weight || 0
    );
    
    // Normalize weights
    const weightSum = modelWeights.reduce((a, b) => a + b, 0);
    const normalizedWeights = modelWeights.map(w => w / weightSum);
    
    // Meta-learner prediction
    let finalPrediction: number;
    
    if (predictions.length === 5) {
      // Use meta-learner if all models succeeded
      const metaInput = tf.tensor2d([predictions]);
      const metaPred = this.metaLearner.predict(metaInput) as tf.Tensor;
      finalPrediction = (await metaPred.data())[0];
      metaInput.dispose();
      metaPred.dispose();
    } else {
      // Weighted average fallback
      finalPrediction = predictions.reduce((sum, pred, i) => 
        sum + pred * normalizedWeights[i], 0
      );
    }
    
    // Calculate confidence based on agreement and historical performance
    const confidence = this.calculateConfidence(predictions, uncertainty, modelNames);
    
    const totalLatency = Date.now() - startTime;
    this.logger.debug(`Ensemble prediction completed in ${totalLatency}ms`, {
      models: modelNames.length,
      uncertainty,
      confidence
    });
    
    return {
      value: finalPrediction,
      uncertainty,
      modelWeights: normalizedWeights,
      confidence
    };
  }
  
  private async predictWithTimeout(
    model: any, 
    features: number[][], 
    timeoutMs: number
  ): Promise<number> {
    return Promise.race([
      model.predict(features),
      new Promise<number>((_, reject) => 
        setTimeout(() => reject(new Error('Prediction timeout')), timeoutMs)
      )
    ]);
  }
  
  private calculateConfidence(
    predictions: number[], 
    uncertainty: number, 
    modelNames: string[]
  ): number {
    // Base confidence on prediction agreement
    const coefficientOfVariation = uncertainty / Math.abs(
      predictions.reduce((a, b) => a + b, 0) / predictions.length
    );
    const agreementScore = 1 / (1 + coefficientOfVariation);
    
    // Factor in model performance
    const avgPerformance = modelNames.reduce((sum, name) => {
      const perf = this.performanceTracker.get(name);
      return sum + (perf?.accuracy || 0.5);
    }, 0) / modelNames.length;
    
    // Combine factors
    const confidence = 0.6 * agreementScore + 0.4 * avgPerformance;
    
    return Math.max(0, Math.min(1, confidence));
  }
  
  private updateModelPerformance(modelName: string, latency: number): void {
    let perf = this.performanceTracker.get(modelName);
    if (!perf) {
      perf = {
        totalPredictions: 0,
        avgLatency: 0,
        accuracy: 0.5, // Default accuracy
        lastUpdate: Date.now()
      };
      this.performanceTracker.set(modelName, perf);
    }
    
    // Update running average latency
    perf.totalPredictions++;
    perf.avgLatency = (perf.avgLatency * (perf.totalPredictions - 1) + latency) / perf.totalPredictions;
    perf.lastUpdate = Date.now();
  }
  
  async updateModelWeights(
    predictions: number[][], 
    actuals: number[], 
    modelNames: string[]
  ): Promise<void> {
    // Calculate individual model errors
    const modelErrors = new Map<string, number>();
    
    for (let i = 0; i < modelNames.length; i++) {
      const errors = predictions[i].map((pred, j) => Math.abs(pred - actuals[j]));
      const avgError = errors.reduce((a, b) => a + b, 0) / errors.length;
      modelErrors.set(modelNames[i], avgError);
    }
    
    // Update weights inversely proportional to error
    const totalInverseError = Array.from(modelErrors.values())
      .reduce((sum, error) => sum + 1 / (error + 1e-6), 0);
    
    for (const [name, error] of modelErrors) {
      const config = this.modelConfigs.get(name);
      if (config) {
        config.weight = (1 / (error + 1e-6)) / totalInverseError;
        
        // Update accuracy tracking
        const perf = this.performanceTracker.get(name);
        if (perf) {
          perf.accuracy = 1 / (1 + error);
        }
      }
    }
    
    // Train meta-learner if we have enough data
    if (predictions[0].length >= 32) {
      const X = tf.tensor2d(predictions).transpose();
      const y = tf.tensor2d(actuals, [actuals.length, 1]);
      
      await this.metaLearner.fit(X, y, {
        epochs: 10,
        batchSize: 32,
        validationSplit: 0.2,
        verbose: 0,
        callbacks: {
          onEpochEnd: (epoch, logs) => {
            if (epoch % 5 === 0) {
              this.logger.debug(`Meta-learner training epoch ${epoch}`, logs);
            }
          }
        }
      });
      
      X.dispose();
      y.dispose();
    }
  }
  
  async train(X: number[][], y: number[], validationSplit: number = 0.2): Promise<void> {
    const trainSize = Math.floor(X.length * (1 - validationSplit));
    const trainX = X.slice(0, trainSize);
    const trainY = y.slice(0, trainSize);
    const valX = X.slice(trainSize);
    const valY = y.slice(trainSize);
    
    // Train each model in parallel
    const trainingPromises = Array.from(this.models.entries())
      .filter(([name, _]) => this.modelConfigs.get(name)?.enabled)
      .map(async ([name, model]) => {
        this.logger.info(`Training ${name}...`);
        const startTime = Date.now();
        
        try {
          await model.train(trainX, trainY, valX, valY);
          const duration = Date.now() - startTime;
          this.logger.info(`${name} training completed in ${duration}ms`);
        } catch (error) {
          this.logger.error(`${name} training failed`, error);
          // Disable failed model
          const config = this.modelConfigs.get(name);
          if (config) {
            config.enabled = false;
          }
        }
      });
    
    await Promise.all(trainingPromises);
    
    // Collect validation predictions for meta-learner training
    const valPredictions: number[][] = [];
    const enabledModels: string[] = [];
    
    for (const [name, model] of this.models) {
      if (this.modelConfigs.get(name)?.enabled) {
        try {
          const preds = await model.predict(valX);
          valPredictions.push(preds);
          enabledModels.push(name);
        } catch (error) {
          this.logger.warn(`Validation prediction failed for ${name}`, error);
        }
      }
    }
    
    // Train meta-learner
    if (valPredictions.length >= 3) {
      await this.updateModelWeights(valPredictions, valY, enabledModels);
    }
  }
  
  getModelStatus(): Map<string, ModelConfig & { performance: ModelPerformance | undefined }> {
    const status = new Map();
    
    for (const [name, config] of this.modelConfigs) {
      status.set(name, {
        ...config,
        performance: this.performanceTracker.get(name)
      });
    }
    
    return status;
  }
  
  enableAdaptiveModelSelection(targetLatencyMs: number): void {
    // Dynamically enable/disable models based on latency budget
    const sortedModels = Array.from(this.modelConfigs.entries())
      .sort((a, b) => {
        const perfA = this.performanceTracker.get(a[0]);
        const perfB = this.performanceTracker.get(b[0]);
        
        // Sort by accuracy/latency ratio
        const ratioA = (perfA?.accuracy || 0.5) / (perfA?.avgLatency || 100);
        const ratioB = (perfB?.accuracy || 0.5) / (perfB?.avgLatency || 100);
        
        return ratioB - ratioA;
      });
    
    let totalLatency = 0;
    
    for (const [name, config] of sortedModels) {
      const perf = this.performanceTracker.get(name);
      const expectedLatency = perf?.avgLatency || config.latencyBudgetMs;
      
      if (totalLatency + expectedLatency <= targetLatencyMs) {
        config.enabled = true;
        totalLatency += expectedLatency;
      } else {
        config.enabled = false;
      }
    }
    
    this.logger.info('Adaptive model selection updated', {
      targetLatency: targetLatencyMs,
      enabledModels: Array.from(this.modelConfigs.entries())
        .filter(([_, config]) => config.enabled)
        .map(([name, _]) => name)
    });
  }
}

interface ModelPerformance {
  totalPredictions: number;
  avgLatency: number;
  accuracy: number;
  lastUpdate: number;
} 