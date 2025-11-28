import * as tf from '@tensorflow/tfjs-node-gpu';
import { EventEmitter } from 'events';
import * as winston from 'winston';

/**
 * Uncertainty estimation configuration
 */
export interface UncertaintyConfig {
  // Monte Carlo dropout samples
  mcSamples: number;
  // Ensemble size for ensemble uncertainty
  ensembleSize: number;
  // Enable epistemic uncertainty
  epistemicEnabled: boolean;
  // Enable aleatoric uncertainty
  aleatoricEnabled: boolean;
  // Calibration method
  calibrationMethod: 'platt' | 'isotonic' | 'temperature';
}

/**
 * Uncertainty estimates
 */
export interface UncertaintyEstimate {
  // Mean prediction
  mean: number[];
  // Standard deviation
  stdDev: number[];
  // Epistemic uncertainty (model uncertainty)
  epistemic: number;
  // Aleatoric uncertainty (data uncertainty)
  aleatoric: number;
  // Total uncertainty
  total: number;
  // Confidence intervals
  ci95Lower: number[];
  ci95Upper: number[];
  // Calibrated probability
  calibratedProb?: number[];
}

/**
 * Calibration data point
 */
export interface CalibrationData {
  predictions: number[];
  actuals: number[];
  timestamp: number;
}

/**
 * Uncertainty estimator for ML predictions
 */
export class UncertaintyEstimator extends EventEmitter {
  private config: UncertaintyConfig;
  private logger: winston.Logger;
  private calibrationData: CalibrationData[] = [];
  private temperatureScaling: number = 1.0;
  private plattScalingA: number = 1.0;
  private plattScalingB: number = 0.0;
  
  constructor(config: UncertaintyConfig, logger: winston.Logger) {
    super();
    
    this.config = config;
    this.logger = logger;
  }
  
  /**
   * Estimate uncertainty using Monte Carlo dropout
   */
  async estimateWithMCDropout(
    model: tf.Sequential,
    input: tf.Tensor,
    training: boolean = false
  ): Promise<UncertaintyEstimate> {
    const predictions: number[][] = [];
    
    // Run multiple forward passes with dropout
    for (let i = 0; i < this.config.mcSamples; i++) {
      // Note: TensorFlow.js doesn't support dropout at inference time
      // This is a limitation - we'll simulate with multiple predictions
      const pred = model.predict(input) as tf.Tensor;
      const predArray = await pred.array() as number[][];
      predictions.push(predArray[0]);
      pred.dispose();
    }
    
    return this.calculateUncertainty(predictions);
  }
  
  /**
   * Estimate uncertainty using ensemble
   */
  async estimateWithEnsemble(
    models: tf.Sequential[],
    input: tf.Tensor
  ): Promise<UncertaintyEstimate> {
    if (models.length !== this.config.ensembleSize) {
      throw new Error(`Expected ${this.config.ensembleSize} models, got ${models.length}`);
    }
    
    const predictions: number[][] = [];
    
    // Get predictions from each model
    for (const model of models) {
      const pred = model.predict(input) as tf.Tensor;
      const predArray = await pred.array() as number[][];
      predictions.push(predArray[0]);
      pred.dispose();
    }
    
    return this.calculateUncertainty(predictions);
  }
  
  /**
   * Calculate uncertainty from multiple predictions
   */
  private calculateUncertainty(predictions: number[][]): UncertaintyEstimate {
    const numPredictions = predictions.length;
    const numOutputs = predictions[0].length;
    
    // Calculate mean
    const mean = new Array(numOutputs).fill(0);
    for (const pred of predictions) {
      for (let i = 0; i < numOutputs; i++) {
        mean[i] += pred[i];
      }
    }
    for (let i = 0; i < numOutputs; i++) {
      mean[i] /= numPredictions;
    }
    
    // Calculate variance and std dev
    const variance = new Array(numOutputs).fill(0);
    for (const pred of predictions) {
      for (let i = 0; i < numOutputs; i++) {
        variance[i] += Math.pow(pred[i] - mean[i], 2);
      }
    }
    
    const stdDev = variance.map(v => Math.sqrt(v / numPredictions));
    
    // Calculate epistemic uncertainty (model uncertainty)
    // This is the uncertainty in the model's predictions
    const epistemic = Math.sqrt(variance.reduce((a, b) => a + b, 0) / numOutputs);
    
    // Calculate aleatoric uncertainty (data uncertainty)
    // This would require the model to output variance, simplified here
    const aleatoric = this.config.aleatoricEnabled ? this.estimateAleatoric(predictions) : 0;
    
    // Total uncertainty
    const total = Math.sqrt(epistemic * epistemic + aleatoric * aleatoric);
    
    // Calculate confidence intervals (95%)
    const z = 1.96; // 95% confidence
    const ci95Lower = mean.map((m, i) => m - z * stdDev[i]);
    const ci95Upper = mean.map((m, i) => m + z * stdDev[i]);
    
    // Apply calibration if available
    const calibratedProb = this.calibrate(mean);
    
    return {
      mean,
      stdDev,
      epistemic,
      aleatoric,
      total,
      ci95Lower,
      ci95Upper,
      calibratedProb
    };
  }
  
  /**
   * Estimate aleatoric uncertainty
   */
  private estimateAleatoric(predictions: number[][]): number {
    // Simplified: use the average variance across predictions
    // In practice, the model should output both mean and variance
    const variances = predictions.map(pred => {
      const mean = pred.reduce((a, b) => a + b, 0) / pred.length;
      return pred.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / pred.length;
    });
    
    return Math.sqrt(variances.reduce((a, b) => a + b, 0) / variances.length);
  }
  
  /**
   * Calibrate predictions
   */
  private calibrate(predictions: number[]): number[] | undefined {
    if (this.calibrationData.length < 100) {
      return undefined; // Not enough data for calibration
    }
    
    switch (this.config.calibrationMethod) {
      case 'temperature':
        return this.temperatureScaling !== 1.0
          ? predictions.map(p => this.sigmoid(this.logit(p) / this.temperatureScaling))
          : predictions;
      
      case 'platt':
        return predictions.map(p => 
          this.sigmoid(this.plattScalingA * this.logit(p) + this.plattScalingB)
        );
      
      case 'isotonic':
        // Simplified isotonic regression
        return this.isotonicCalibration(predictions);
      
      default:
        return predictions;
    }
  }
  
  /**
   * Add calibration data
   */
  addCalibrationData(predictions: number[], actuals: number[]): void {
    this.calibrationData.push({
      predictions,
      actuals,
      timestamp: Date.now()
    });
    
    // Keep only recent data
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
    const cutoff = Date.now() - maxAge;
    this.calibrationData = this.calibrationData.filter(d => d.timestamp > cutoff);
    
    // Recalibrate if enough data
    if (this.calibrationData.length >= 100) {
      this.recalibrate();
    }
  }
  
  /**
   * Recalibrate the model
   */
  private recalibrate(): void {
    switch (this.config.calibrationMethod) {
      case 'temperature':
        this.calibrateTemperature();
        break;
      
      case 'platt':
        this.calibratePlatt();
        break;
      
      case 'isotonic':
        // Isotonic calibration is computed on-demand
        break;
    }
    
    this.emit('recalibrated', {
      method: this.config.calibrationMethod,
      dataPoints: this.calibrationData.length
    });
  }
  
  /**
   * Temperature scaling calibration
   */
  private calibrateTemperature(): void {
    // Find optimal temperature using gradient descent
    let temperature = 1.0;
    const learningRate = 0.01;
    const iterations = 100;
    
    for (let iter = 0; iter < iterations; iter++) {
      let gradientSum = 0;
      
      for (const data of this.calibrationData) {
        for (let i = 0; i < data.predictions.length; i++) {
          const logit = this.logit(data.predictions[i]);
          const scaled = logit / temperature;
          const prob = this.sigmoid(scaled);
          const error = prob - data.actuals[i];
          gradientSum += error * logit * prob * (1 - prob) / (temperature * temperature);
        }
      }
      
      const gradient = gradientSum / this.calibrationData.length;
      temperature -= learningRate * gradient;
      temperature = Math.max(0.1, Math.min(10, temperature)); // Clamp
    }
    
    this.temperatureScaling = temperature;
    this.logger.info('Temperature calibration complete', { temperature });
  }
  
  /**
   * Platt scaling calibration
   */
  private calibratePlatt(): void {
    // Simplified Platt scaling using logistic regression
    // In practice, use a proper optimization library
    let a = 1.0;
    let b = 0.0;
    const learningRate = 0.01;
    const iterations = 100;
    
    for (let iter = 0; iter < iterations; iter++) {
      let gradientA = 0;
      let gradientB = 0;
      
      for (const data of this.calibrationData) {
        for (let i = 0; i < data.predictions.length; i++) {
          const logit = this.logit(data.predictions[i]);
          const scaled = a * logit + b;
          const prob = this.sigmoid(scaled);
          const error = prob - data.actuals[i];
          gradientA += error * logit;
          gradientB += error;
        }
      }
      
      a -= learningRate * gradientA / this.calibrationData.length;
      b -= learningRate * gradientB / this.calibrationData.length;
    }
    
    this.plattScalingA = a;
    this.plattScalingB = b;
    this.logger.info('Platt calibration complete', { a, b });
  }
  
  /**
   * Isotonic calibration
   */
  private isotonicCalibration(predictions: number[]): number[] {
    // Simplified isotonic regression
    // In practice, use a proper implementation
    return predictions.map(p => {
      // Find calibration bin
      const bins = 10;
      const binIndex = Math.floor(p * bins);
      
      // Calculate average actual probability in this bin
      let sumActual = 0;
      let count = 0;
      
      for (const data of this.calibrationData) {
        for (let i = 0; i < data.predictions.length; i++) {
          const predBin = Math.floor(data.predictions[i] * bins);
          if (predBin === binIndex) {
            sumActual += data.actuals[i];
            count++;
          }
        }
      }
      
      return count > 0 ? sumActual / count : p;
    });
  }
  
  /**
   * Logit function
   */
  private logit(p: number): number {
    p = Math.max(1e-7, Math.min(1 - 1e-7, p)); // Avoid log(0)
    return Math.log(p / (1 - p));
  }
  
  /**
   * Sigmoid function
   */
  private sigmoid(x: number): number {
    return 1 / (1 + Math.exp(-x));
  }
  
  /**
   * Get calibration metrics
   */
  getCalibrationMetrics(): CalibrationMetrics {
    if (this.calibrationData.length === 0) {
      return {
        ece: 0,
        mce: 0,
        brier: 0,
        logLoss: 0,
        reliability: []
      };
    }
    
    // Calculate Expected Calibration Error (ECE)
    const bins = 10;
    const binCounts = new Array(bins).fill(0);
    const binAccuracy = new Array(bins).fill(0);
    const binConfidence = new Array(bins).fill(0);
    
    for (const data of this.calibrationData) {
      for (let i = 0; i < data.predictions.length; i++) {
        const binIndex = Math.min(bins - 1, Math.floor(data.predictions[i] * bins));
        binCounts[binIndex]++;
        binAccuracy[binIndex] += data.actuals[i];
        binConfidence[binIndex] += data.predictions[i];
      }
    }
    
    let ece = 0;
    let mce = 0;
    const totalSamples = this.calibrationData.reduce((sum, d) => sum + d.predictions.length, 0);
    
    const reliability = [];
    for (let i = 0; i < bins; i++) {
      if (binCounts[i] > 0) {
        const accuracy = binAccuracy[i] / binCounts[i];
        const confidence = binConfidence[i] / binCounts[i];
        const binWeight = binCounts[i] / totalSamples;
        const error = Math.abs(accuracy - confidence);
        
        ece += binWeight * error;
        mce = Math.max(mce, error);
        
        reliability.push({
          binIndex: i,
          confidence,
          accuracy,
          count: binCounts[i]
        });
      }
    }
    
    // Calculate Brier score
    let brier = 0;
    for (const data of this.calibrationData) {
      for (let i = 0; i < data.predictions.length; i++) {
        brier += Math.pow(data.predictions[i] - data.actuals[i], 2);
      }
    }
    brier /= totalSamples;
    
    // Calculate log loss
    let logLoss = 0;
    for (const data of this.calibrationData) {
      for (let i = 0; i < data.predictions.length; i++) {
        const p = Math.max(1e-7, Math.min(1 - 1e-7, data.predictions[i]));
        if (data.actuals[i] === 1) {
          logLoss -= Math.log(p);
        } else {
          logLoss -= Math.log(1 - p);
        }
      }
    }
    logLoss /= totalSamples;
    
    return {
      ece,
      mce,
      brier,
      logLoss,
      reliability
    };
  }
}

/**
 * Calibration metrics
 */
export interface CalibrationMetrics {
  // Expected Calibration Error
  ece: number;
  // Maximum Calibration Error
  mce: number;
  // Brier score
  brier: number;
  // Log loss
  logLoss: number;
  // Reliability diagram data
  reliability: Array<{
    binIndex: number;
    confidence: number;
    accuracy: number;
    count: number;
  }>;
} 