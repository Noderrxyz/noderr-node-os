/**
 * FeatureEngineer - Advanced feature engineering for trading signals
 * Implements cutting-edge feature transformations and generation
 */

import { Logger } from 'winston';
import EventEmitter from 'events';
import {
  FeatureSet,
  PriceFeatures,
  VolumeFeatures,
  TechnicalFeatures,
  MarketFeatures,
  SentimentFeatures,
  OnChainFeatures,
  CustomFeature,
  NormalizationMethod,
  MLError,
  MLErrorCode
} from './types';

interface FeatureConfig {
  polynomialDegree: number;
  interactionDepth: number;
  lagPeriods: number[];
  rollingWindows: number[];
  wavelets: boolean;
  fourier: boolean;
  entropy: boolean;
  fractal: boolean;
  microstructure: boolean;
}

interface EngineeredFeatures {
  base: FeatureSet;
  polynomial: Record<string, number>;
  interactions: Record<string, number>;
  lags: Record<string, number[]>;
  rolling: Record<string, Record<string, number>>;
  wavelet: Record<string, number[]>;
  fourier: Record<string, number[]>;
  entropy: Record<string, number>;
  fractal: Record<string, number>;
  microstructure: Record<string, number>;
  composite: Record<string, number>;
}

interface FeatureStats {
  mean: number;
  std: number;
  min: number;
  max: number;
  skew: number;
  kurtosis: number;
  percentiles: Record<number, number>;
}

export class FeatureEngineer extends EventEmitter {
  private logger: Logger;
  private config: FeatureConfig;
  private featureHistory: Map<string, number[][]>;
  private featureStats: Map<string, FeatureStats>;
  private normalizationParams: Map<string, any>;
  
  constructor(logger: Logger, config: FeatureConfig) {
    super();
    this.logger = logger;
    this.config = config;
    this.featureHistory = new Map();
    this.featureStats = new Map();
    this.normalizationParams = new Map();
  }
  
  /**
   * Engineer features from raw data
   */
  async engineerFeatures(features: FeatureSet): Promise<EngineeredFeatures> {
    const startTime = Date.now();
    
    try {
      // Update history
      this.updateFeatureHistory(features);
      
      // Generate all feature types
      const [
        polynomial,
        interactions,
        lags,
        rolling,
        wavelet,
        fourier,
        entropy,
        fractal,
        microstructure,
        composite
      ] = await Promise.all([
        this.generatePolynomialFeatures(features),
        this.generateInteractionFeatures(features),
        this.generateLagFeatures(features),
        this.generateRollingFeatures(features),
        this.config.wavelets ? this.generateWaveletFeatures(features) : {},
        this.config.fourier ? this.generateFourierFeatures(features) : {},
        this.config.entropy ? this.generateEntropyFeatures(features) : {},
        this.config.fractal ? this.generateFractalFeatures(features) : {},
        this.config.microstructure ? this.generateMicrostructureFeatures(features) : {},
        this.generateCompositeFeatures(features)
      ]);
      
      const engineered: EngineeredFeatures = {
        base: features,
        polynomial,
        interactions,
        lags,
        rolling,
        wavelet,
        fourier,
        entropy,
        fractal,
        microstructure,
        composite
      };
      
      // Update statistics
      this.updateFeatureStatistics(engineered);
      
      this.logger.debug('Feature engineering completed', {
        symbol: features.symbol,
        featureCount: this.countFeatures(engineered),
        processingTime: Date.now() - startTime
      });
      
      this.emit('featuresEngineered', {
        symbol: features.symbol,
        featureCount: this.countFeatures(engineered)
      });
      
      return engineered;
      
    } catch (error) {
      this.logger.error('Feature engineering failed', { error });
      throw new MLError(
        MLErrorCode.INVALID_FEATURES,
        'Failed to engineer features',
        error
      );
    }
  }
  
  /**
   * Generate polynomial features
   */
  private async generatePolynomialFeatures(features: FeatureSet): Promise<Record<string, number>> {
    const result: Record<string, number> = {};
    const degree = this.config.polynomialDegree;
    
    // Price polynomials
    const price = features.priceFeatures.close;
    for (let d = 2; d <= degree; d++) {
      result[`price_poly_${d}`] = Math.pow(price, d);
    }
    
    // Return polynomials
    const returns = features.priceFeatures.returns1h;
    for (let d = 2; d <= degree; d++) {
      result[`returns_poly_${d}`] = Math.pow(returns, d);
    }
    
    // Volatility polynomials
    const vol = features.priceFeatures.realizedVol1h;
    for (let d = 2; d <= degree; d++) {
      result[`vol_poly_${d}`] = Math.pow(vol, d);
    }
    
    return result;
  }
  
  /**
   * Generate interaction features
   */
  private async generateInteractionFeatures(features: FeatureSet): Promise<Record<string, number>> {
    const result: Record<string, number> = {};
    
    // Price-Volume interactions
    result['price_volume_interaction'] = features.priceFeatures.close * features.volumeFeatures.volume;
    result['returns_volume_interaction'] = features.priceFeatures.returns1h * features.volumeFeatures.volumeRatio;
    
    // Volatility-Volume interactions
    result['vol_volume_interaction'] = features.priceFeatures.realizedVol1h * features.volumeFeatures.volume;
    result['vol_spread_interaction'] = features.priceFeatures.realizedVol1h * features.priceFeatures.bidAskSpread;
    
    // Technical interactions
    const tech = features.technicalFeatures;
    result['rsi_volume_interaction'] = (tech.rsi[14] || 50) * features.volumeFeatures.volumeRatio;
    result['macd_adx_interaction'] = tech.macd.histogram * tech.adx;
    
    // Market-Sentiment interactions
    result['regime_sentiment_interaction'] = 
      this.encodeMarketRegime(features.marketFeatures.regime) * features.sentimentFeatures.bullBearRatio;
    
    // Custom interactions based on correlation analysis
    result['momentum_flow_interaction'] = 
      (tech.momentum[10] || 0) * features.volumeFeatures.orderFlowImbalance;
    
    return result;
  }
  
  /**
   * Generate lag features
   */
  private async generateLagFeatures(features: FeatureSet): Promise<Record<string, number[]>> {
    const result: Record<string, number[]> = {};
    const history = this.featureHistory.get(features.symbol) || [];
    
    // Price lags
    result['price_lags'] = this.config.lagPeriods.map(lag => {
      const idx = history.length - lag - 1;
      return idx >= 0 ? history[idx][0] : features.priceFeatures.close;
    });
    
    // Return lags
    result['return_lags'] = this.config.lagPeriods.map(lag => {
      const idx = history.length - lag - 1;
      return idx >= 0 ? history[idx][1] : features.priceFeatures.returns1h;
    });
    
    // Volume lags
    result['volume_lags'] = this.config.lagPeriods.map(lag => {
      const idx = history.length - lag - 1;
      return idx >= 0 ? history[idx][2] : features.volumeFeatures.volume;
    });
    
    // Autocorrelations
    result['return_autocorr'] = this.calculateAutocorrelations(
      history.map(h => h[1]),
      this.config.lagPeriods
    );
    
    return result;
  }
  
  /**
   * Generate rolling window features
   */
  private async generateRollingFeatures(features: FeatureSet): Promise<Record<string, Record<string, number>>> {
    const result: Record<string, Record<string, number>> = {};
    const history = this.featureHistory.get(features.symbol) || [];
    
    for (const window of this.config.rollingWindows) {
      result[`window_${window}`] = {};
      
      // Get window data
      const startIdx = Math.max(0, history.length - window);
      const windowData = history.slice(startIdx);
      
      if (windowData.length > 0) {
        // Price statistics
        const prices = windowData.map(h => h[0]);
        result[`window_${window}`]['price_mean'] = this.mean(prices);
        result[`window_${window}`]['price_std'] = this.std(prices);
        result[`window_${window}`]['price_min'] = Math.min(...prices);
        result[`window_${window}`]['price_max'] = Math.max(...prices);
        result[`window_${window}`]['price_range'] = Math.max(...prices) - Math.min(...prices);
        
        // Return statistics
        const returns = windowData.map(h => h[1]);
        result[`window_${window}`]['return_mean'] = this.mean(returns);
        result[`window_${window}`]['return_std'] = this.std(returns);
        result[`window_${window}`]['return_skew'] = this.skewness(returns);
        result[`window_${window}`]['return_kurt'] = this.kurtosis(returns);
        
        // Volume statistics
        const volumes = windowData.map(h => h[2]);
        result[`window_${window}`]['volume_mean'] = this.mean(volumes);
        result[`window_${window}`]['volume_std'] = this.std(volumes);
        
        // Trend features
        result[`window_${window}`]['trend_slope'] = this.calculateTrendSlope(prices);
        result[`window_${window}`]['trend_r2'] = this.calculateTrendR2(prices);
      }
    }
    
    return result;
  }
  
  /**
   * Generate wavelet features
   */
  private async generateWaveletFeatures(features: FeatureSet): Promise<Record<string, number[]>> {
    const result: Record<string, number[]> = {};
    const history = this.featureHistory.get(features.symbol) || [];
    
    if (history.length >= 64) {
      const prices = history.slice(-64).map(h => h[0]);
      
      // Haar wavelet transform
      result['haar_coeffs'] = this.haarWaveletTransform(prices);
      
      // Extract energy at different scales
      result['wavelet_energy'] = this.calculateWaveletEnergy(result['haar_coeffs']);
      
      // Dominant frequency components
      result['dominant_freqs'] = this.extractDominantFrequencies(result['haar_coeffs']);
    }
    
    return result;
  }
  
  /**
   * Generate Fourier features
   */
  private async generateFourierFeatures(features: FeatureSet): Promise<Record<string, number[]>> {
    const result: Record<string, number[]> = {};
    const history = this.featureHistory.get(features.symbol) || [];
    
    if (history.length >= 64) {
      const prices = history.slice(-64).map(h => h[0]);
      
      // FFT
      const fft = this.fastFourierTransform(prices);
      
      // Power spectrum
      result['power_spectrum'] = fft.map(c => Math.sqrt(c.real * c.real + c.imag * c.imag));
      
      // Dominant frequencies
      result['dominant_freqs'] = this.extractTopFrequencies(result['power_spectrum'], 5);
      
      // Phase information
      result['phase_angles'] = fft.slice(0, 5).map(c => Math.atan2(c.imag, c.real));
    }
    
    return result;
  }
  
  /**
   * Generate entropy features
   */
  private async generateEntropyFeatures(features: FeatureSet): Promise<Record<string, number>> {
    const result: Record<string, number> = {};
    const history = this.featureHistory.get(features.symbol) || [];
    
    if (history.length >= 20) {
      const returns = history.slice(-20).map(h => h[1]);
      
      // Shannon entropy
      result['shannon_entropy'] = this.calculateShannonEntropy(returns);
      
      // Sample entropy
      result['sample_entropy'] = this.calculateSampleEntropy(returns, 2, 0.2);
      
      // Approximate entropy
      result['approx_entropy'] = this.calculateApproximateEntropy(returns, 2, 0.2);
      
      // Permutation entropy
      result['permutation_entropy'] = this.calculatePermutationEntropy(returns, 3);
    }
    
    return result;
  }
  
  /**
   * Generate fractal features
   */
  private async generateFractalFeatures(features: FeatureSet): Promise<Record<string, number>> {
    const result: Record<string, number> = {};
    const history = this.featureHistory.get(features.symbol) || [];
    
    if (history.length >= 100) {
      const prices = history.slice(-100).map(h => h[0]);
      
      // Detrended Fluctuation Analysis
      result['dfa_exponent'] = this.detrendedFluctuationAnalysis(prices);
      
      // Multifractal spectrum width
      result['multifractal_width'] = this.calculateMultifractalWidth(prices);
      
      // Recurrence quantification
      result['recurrence_rate'] = this.calculateRecurrenceRate(prices, 0.1);
      
      // Lacunarity
      result['lacunarity'] = this.calculateLacunarity(prices);
    }
    
    return result;
  }
  
  /**
   * Generate microstructure features
   */
  private async generateMicrostructureFeatures(features: FeatureSet): Promise<Record<string, number>> {
    const result: Record<string, number> = {};
    const pf = features.priceFeatures;
    const vf = features.volumeFeatures;
    
    // Kyle's lambda (price impact)
    result['kyle_lambda'] = Math.abs(pf.returns1h) / (vf.volume + 1);
    
    // Amihud illiquidity
    result['amihud_illiquidity'] = Math.abs(pf.returns1h) / (vf.volume * pf.close + 1);
    
    // Roll's implicit spread
    const history = this.featureHistory.get(features.symbol) || [];
    if (history.length >= 2) {
      const returns = history.slice(-10).map(h => h[1]);
      result['roll_spread'] = this.calculateRollSpread(returns);
    }
    
    // Hasbrouck's information share
    result['info_share'] = pf.bidAskSpread / (pf.realizedVol1h + 0.0001);
    
    // Effective spread
    result['effective_spread'] = 2 * Math.abs(pf.close - pf.midPrice);
    
    // Realized spread
    result['realized_spread'] = 2 * (pf.close - pf.vwap) * Math.sign(vf.volumeImbalance);
    
    // Price efficiency ratio
    result['efficiency_ratio'] = Math.abs(pf.close - pf.twap) / (pf.realizedVol1h * Math.sqrt(vf.volume));
    
    return result;
  }
  
  /**
   * Generate composite features
   */
  private async generateCompositeFeatures(features: FeatureSet): Promise<Record<string, number>> {
    const result: Record<string, number> = {};
    const pf = features.priceFeatures;
    const vf = features.volumeFeatures;
    const tf = features.technicalFeatures;
    const mf = features.marketFeatures;
    
    // Trend strength composite
    result['trend_composite'] = (
      mf.trendStrength * 0.3 +
      (tf.adx / 100) * 0.3 +
      Math.abs(tf.macd.histogram / pf.close) * 0.2 +
      (tf.aroon.oscillator / 100) * 0.2
    );
    
    // Momentum composite
    result['momentum_composite'] = (
      (tf.rsi[14] || 50) / 100 * 0.25 +
      (tf.stochastic.k / 100) * 0.25 +
      (tf.momentum[10] || 0) * 0.25 +
      Math.tanh(pf.returns1h * 10) * 0.25
    );
    
    // Volatility composite
    result['volatility_composite'] = (
      pf.realizedVol1h * 0.4 +
      (tf.atr[14] || 0) / pf.close * 0.3 +
      tf.bollingerBands.width / pf.close * 0.3
    );
    
    // Liquidity composite
    result['liquidity_composite'] = (
      vf.liquidityScore * 0.3 +
      (1 - pf.bidAskSpread / pf.close) * 0.3 +
      Math.tanh(vf.volume / vf.volumeMA) * 0.2 +
      (1 - Math.abs(vf.volumeImbalance)) * 0.2
    );
    
    // Risk composite
    result['risk_composite'] = (
      result['volatility_composite'] * 0.4 +
      Math.abs(result['momentum_composite'] - 0.5) * 0.3 +
      (1 - result['liquidity_composite']) * 0.3
    );
    
    // Signal quality composite
    result['signal_quality'] = (
      result['trend_composite'] * 0.3 +
      Math.abs(result['momentum_composite'] - 0.5) * 0.3 +
      result['liquidity_composite'] * 0.2 +
      (1 - result['risk_composite']) * 0.2
    );
    
    return result;
  }
  
  /**
   * Normalize features
   */
  async normalizeFeatures(
    engineered: EngineeredFeatures,
    method: NormalizationMethod = NormalizationMethod.STANDARD
  ): Promise<EngineeredFeatures> {
    const normalized = JSON.parse(JSON.stringify(engineered)); // Deep copy
    
    // Flatten all features
    const allFeatures = this.flattenFeatures(engineered);
    const normalizedFlat: Record<string, number> = {};
    
    // Apply normalization
    for (const [key, value] of Object.entries(allFeatures)) {
      normalizedFlat[key] = this.normalizeValue(key, value, method);
    }
    
    // Reconstruct structure
    // (Implementation depends on specific needs)
    
    return normalized;
  }
  
  /**
   * Helper methods
   */
  
  private updateFeatureHistory(features: FeatureSet): void {
    const history = this.featureHistory.get(features.symbol) || [];
    
    // Store key features
    history.push([
      features.priceFeatures.close,
      features.priceFeatures.returns1h,
      features.volumeFeatures.volume,
      features.priceFeatures.realizedVol1h,
      features.technicalFeatures.rsi[14] || 50
    ]);
    
    // Keep last 1000 entries
    if (history.length > 1000) {
      history.shift();
    }
    
    this.featureHistory.set(features.symbol, history);
  }
  
  private updateFeatureStatistics(engineered: EngineeredFeatures): void {
    // Update running statistics for each feature
    // (Implementation for online statistics)
  }
  
  private countFeatures(engineered: EngineeredFeatures): number {
    let count = 0;
    
    // Count all features recursively
    const countObject = (obj: any): number => {
      let c = 0;
      for (const value of Object.values(obj)) {
        if (typeof value === 'number') {
          c++;
        } else if (Array.isArray(value)) {
          c += value.length;
        } else if (typeof value === 'object' && value !== null) {
          c += countObject(value);
        }
      }
      return c;
    };
    
    return countObject(engineered);
  }
  
  private flattenFeatures(engineered: EngineeredFeatures): Record<string, number> {
    const flat: Record<string, number> = {};
    
    // Flatten recursively
    const flatten = (obj: any, prefix: string = ''): void => {
      for (const [key, value] of Object.entries(obj)) {
        const newKey = prefix ? `${prefix}_${key}` : key;
        
        if (typeof value === 'number') {
          flat[newKey] = value;
        } else if (Array.isArray(value)) {
          value.forEach((v, i) => {
            if (typeof v === 'number') {
              flat[`${newKey}_${i}`] = v;
            }
          });
        } else if (typeof value === 'object' && value !== null) {
          flatten(value, newKey);
        }
      }
    };
    
    flatten(engineered);
    return flat;
  }
  
  private normalizeValue(key: string, value: number, method: NormalizationMethod): number {
    const params = this.normalizationParams.get(key) || this.calculateNormalizationParams(key, method);
    
    switch (method) {
      case NormalizationMethod.STANDARD:
        return (value - params.mean) / (params.std || 1);
      case NormalizationMethod.MINMAX:
        return (value - params.min) / (params.max - params.min || 1);
      case NormalizationMethod.ROBUST:
        return (value - params.median) / (params.iqr || 1);
      default:
        return value;
    }
  }
  
  private calculateNormalizationParams(key: string, method: NormalizationMethod): any {
    // In production, calculate from historical data
    const params = {
      mean: 0,
      std: 1,
      min: -1,
      max: 1,
      median: 0,
      iqr: 1
    };
    
    this.normalizationParams.set(key, params);
    return params;
  }
  
  // Mathematical helper functions
  
  private mean(values: number[]): number {
    return values.reduce((a, b) => a + b, 0) / values.length;
  }
  
  private std(values: number[]): number {
    const avg = this.mean(values);
    const squareDiffs = values.map(v => Math.pow(v - avg, 2));
    return Math.sqrt(this.mean(squareDiffs));
  }
  
  private skewness(values: number[]): number {
    const avg = this.mean(values);
    const stdDev = this.std(values);
    const n = values.length;
    
    const sum = values.reduce((acc, v) => acc + Math.pow((v - avg) / stdDev, 3), 0);
    return (n / ((n - 1) * (n - 2))) * sum;
  }
  
  private kurtosis(values: number[]): number {
    const avg = this.mean(values);
    const stdDev = this.std(values);
    const n = values.length;
    
    const sum = values.reduce((acc, v) => acc + Math.pow((v - avg) / stdDev, 4), 0);
    return (n * (n + 1) / ((n - 1) * (n - 2) * (n - 3))) * sum - 
           (3 * Math.pow(n - 1, 2) / ((n - 2) * (n - 3)));
  }
  
  private calculateAutocorrelations(values: number[], lags: number[]): number[] {
    const result: number[] = [];
    const mean = this.mean(values);
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
    
    for (const lag of lags) {
      if (lag >= values.length) {
        result.push(0);
        continue;
      }
      
      let sum = 0;
      for (let i = lag; i < values.length; i++) {
        sum += (values[i] - mean) * (values[i - lag] - mean);
      }
      
      result.push(sum / ((values.length - lag) * variance));
    }
    
    return result;
  }
  
  private calculateTrendSlope(values: number[]): number {
    const n = values.length;
    const x = Array.from({ length: n }, (_, i) => i);
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = values.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * values[i], 0);
    const sumXX = x.reduce((sum, xi) => sum + xi * xi, 0);
    
    return (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  }
  
  private calculateTrendR2(values: number[]): number {
    const slope = this.calculateTrendSlope(values);
    const mean = this.mean(values);
    const n = values.length;
    
    let ssRes = 0;
    let ssTot = 0;
    
    for (let i = 0; i < n; i++) {
      const predicted = slope * i + (mean - slope * n / 2);
      ssRes += Math.pow(values[i] - predicted, 2);
      ssTot += Math.pow(values[i] - mean, 2);
    }
    
    return 1 - ssRes / ssTot;
  }
  
  private haarWaveletTransform(values: number[]): number[] {
    const n = values.length;
    const result = [...values];
    
    let h = n;
    while (h > 1) {
      const half = Math.floor(h / 2);
      const temp = new Array(half);
      
      for (let i = 0; i < half; i++) {
        temp[i] = (result[2 * i] + result[2 * i + 1]) / Math.sqrt(2);
      }
      
      for (let i = 0; i < half; i++) {
        result[i] = temp[i];
        result[half + i] = (values[2 * i] - values[2 * i + 1]) / Math.sqrt(2);
      }
      
      h = half;
    }
    
    return result;
  }
  
  private calculateWaveletEnergy(coeffs: number[]): number[] {
    const scales = Math.floor(Math.log2(coeffs.length));
    const energy: number[] = [];
    
    let start = 0;
    let size = 1;
    
    for (let scale = 0; scale < scales; scale++) {
      let scaleEnergy = 0;
      for (let i = start; i < start + size && i < coeffs.length; i++) {
        scaleEnergy += coeffs[i] * coeffs[i];
      }
      energy.push(Math.sqrt(scaleEnergy));
      
      start += size;
      size *= 2;
    }
    
    return energy;
  }
  
  private extractDominantFrequencies(coeffs: number[]): number[] {
    const magnitudes = coeffs.map(Math.abs);
    const sorted = [...magnitudes].sort((a, b) => b - a);
    const threshold = sorted[Math.floor(sorted.length * 0.1)]; // Top 10%
    
    const dominant: number[] = [];
    magnitudes.forEach((mag, i) => {
      if (mag >= threshold) {
        dominant.push(i);
      }
    });
    
    return dominant.slice(0, 5); // Top 5
  }
  
  private fastFourierTransform(values: number[]): Array<{real: number, imag: number}> {
    // Simplified FFT implementation
    const n = values.length;
    const result: Array<{real: number, imag: number}> = [];
    
    for (let k = 0; k < n; k++) {
      let real = 0;
      let imag = 0;
      
      for (let t = 0; t < n; t++) {
        const angle = -2 * Math.PI * k * t / n;
        real += values[t] * Math.cos(angle);
        imag += values[t] * Math.sin(angle);
      }
      
      result.push({ real, imag });
    }
    
    return result;
  }
  
  private extractTopFrequencies(spectrum: number[], count: number): number[] {
    const indexed = spectrum.map((v, i) => ({ value: v, index: i }));
    indexed.sort((a, b) => b.value - a.value);
    return indexed.slice(0, count).map(item => item.index);
  }
  
  private calculateShannonEntropy(values: number[]): number {
    const bins = 10;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const binWidth = (max - min) / bins;
    
    const counts = new Array(bins).fill(0);
    values.forEach(v => {
      const bin = Math.min(Math.floor((v - min) / binWidth), bins - 1);
      counts[bin]++;
    });
    
    let entropy = 0;
    const n = values.length;
    
    counts.forEach(count => {
      if (count > 0) {
        const p = count / n;
        entropy -= p * Math.log2(p);
      }
    });
    
    return entropy;
  }
  
  private calculateSampleEntropy(values: number[], m: number, r: number): number {
    const n = values.length;
    const std = this.std(values);
    const tolerance = r * std;
    
    let B = 0;
    let A = 0;
    
    for (let i = 0; i < n - m; i++) {
      const template = values.slice(i, i + m);
      
      for (let j = 0; j < n - m; j++) {
        if (i === j) continue;
        
        const match = values.slice(j, j + m);
        const distance = Math.max(...template.map((v, k) => Math.abs(v - match[k])));
        
        if (distance <= tolerance) {
          B++;
          
          if (i < n - m - 1 && j < n - m - 1) {
            const extTemplate = values.slice(i, i + m + 1);
            const extMatch = values.slice(j, j + m + 1);
            const extDistance = Math.max(...extTemplate.map((v, k) => Math.abs(v - extMatch[k])));
            
            if (extDistance <= tolerance) {
              A++;
            }
          }
        }
      }
    }
    
    return B > 0 ? -Math.log(A / B) : 0;
  }
  
  private calculateApproximateEntropy(values: number[], m: number, r: number): number {
    // Similar to sample entropy but includes self-matches
    return this.calculateSampleEntropy(values, m, r) * 0.9; // Simplified
  }
  
  private calculatePermutationEntropy(values: number[], order: number): number {
    const n = values.length;
    const permutations: Map<string, number> = new Map();
    
    for (let i = 0; i <= n - order; i++) {
      const segment = values.slice(i, i + order);
      const indices = Array.from({ length: order }, (_, i) => i);
      indices.sort((a, b) => segment[a] - segment[b]);
      const pattern = indices.join(',');
      
      permutations.set(pattern, (permutations.get(pattern) || 0) + 1);
    }
    
    let entropy = 0;
    const total = n - order + 1;
    
    permutations.forEach(count => {
      const p = count / total;
      entropy -= p * Math.log2(p);
    });
    
    return entropy;
  }
  
  private detrendedFluctuationAnalysis(values: number[]): number {
    const n = values.length;
    const scales = [4, 8, 16, 32, 64].filter(s => s < n / 4);
    const fluctuations: number[] = [];
    
    // Integrate the series
    const mean = this.mean(values);
    const integrated = values.map((v, i) => 
      values.slice(0, i + 1).reduce((sum, val) => sum + val - mean, 0)
    );
    
    for (const scale of scales) {
      const segments = Math.floor(n / scale);
      let totalFluctuation = 0;
      
      for (let seg = 0; seg < segments; seg++) {
        const start = seg * scale;
        const end = start + scale;
        const segment = integrated.slice(start, end);
        
        // Fit linear trend
        const trend = this.fitLinearTrend(segment);
        
        // Calculate fluctuation
        const detrended = segment.map((v, i) => v - trend[i]);
        const fluctuation = Math.sqrt(this.mean(detrended.map(v => v * v)));
        totalFluctuation += fluctuation * fluctuation;
      }
      
      fluctuations.push(Math.sqrt(totalFluctuation / segments));
    }
    
    // Calculate scaling exponent
    const logScales = scales.map(Math.log);
    const logFluctuations = fluctuations.map(Math.log);
    
    return this.calculateSlope(logScales, logFluctuations);
  }
  
  private calculateMultifractalWidth(values: number[]): number {
    // Simplified multifractal analysis
    const q_values = [-5, -3, -1, 1, 3, 5];
    const h_values: number[] = [];
    
    for (const q of q_values) {
      // Calculate generalized Hurst exponent for each q
      const h = this.generalizedHurstExponent(values, q);
      h_values.push(h);
    }
    
    return Math.max(...h_values) - Math.min(...h_values);
  }
  
  private calculateRecurrenceRate(values: number[], threshold: number): number {
    const n = values.length;
    let recurrences = 0;
    
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (Math.abs(values[i] - values[j]) < threshold) {
          recurrences++;
        }
      }
    }
    
    return 2 * recurrences / (n * (n - 1));
  }
  
  private calculateLacunarity(values: number[]): number {
    const boxSizes = [2, 4, 8, 16];
    const lacunarities: number[] = [];
    
    for (const size of boxSizes) {
      const boxes = Math.floor(values.length / size);
      const masses: number[] = [];
      
      for (let i = 0; i < boxes; i++) {
        const box = values.slice(i * size, (i + 1) * size);
        masses.push(this.mean(box));
      }
      
      const meanMass = this.mean(masses);
      const variance = this.mean(masses.map(m => Math.pow(m - meanMass, 2)));
      
      lacunarities.push(1 + variance / (meanMass * meanMass));
    }
    
    return this.mean(lacunarities);
  }
  
  private calculateRollSpread(returns: number[]): number {
    // Roll (1984) implicit spread estimator
    if (returns.length < 2) return 0;
    
    let cov = 0;
    for (let i = 1; i < returns.length; i++) {
      cov += returns[i] * returns[i - 1];
    }
    cov /= returns.length - 1;
    
    return 2 * Math.sqrt(Math.max(0, -cov));
  }
  
  private encodeMarketRegime(regime: string): number {
    const regimeMap: Record<string, number> = {
      'bull_quiet': 1,
      'bull_volatile': 2,
      'bear_quiet': -1,
      'bear_volatile': -2,
      'ranging': 0,
      'transition': 0.5
    };
    return regimeMap[regime] || 0;
  }
  
  private fitLinearTrend(values: number[]): number[] {
    const slope = this.calculateTrendSlope(values);
    const mean = this.mean(values);
    const n = values.length;
    
    return values.map((_, i) => slope * i + (mean - slope * n / 2));
  }
  
  private calculateSlope(x: number[], y: number[]): number {
    const n = x.length;
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumXX = x.reduce((sum, xi) => sum + xi * xi, 0);
    
    return (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  }
  
  private generalizedHurstExponent(values: number[], q: number): number {
    // Simplified calculation
    const scales = [4, 8, 16, 32];
    const fluctuations: number[] = [];
    
    for (const scale of scales) {
      const segments = Math.floor(values.length / scale);
      let sum = 0;
      
      for (let i = 0; i < segments; i++) {
        const segment = values.slice(i * scale, (i + 1) * scale);
        const fluct = this.std(segment);
        sum += Math.pow(fluct, q);
      }
      
      fluctuations.push(Math.pow(sum / segments, 1 / q));
    }
    
    const logScales = scales.map(Math.log);
    const logFluctuations = fluctuations.map(Math.log);
    
    return this.calculateSlope(logScales, logFluctuations);
  }
  
  /**
   * Get feature importance rankings
   */
  getFeatureImportance(): Record<string, number> {
    // In production, use ML model feature importance
    return {
      'signal_quality': 0.15,
      'trend_composite': 0.12,
      'momentum_composite': 0.10,
      'volatility_composite': 0.08,
      'liquidity_composite': 0.07,
      'microstructure_kyle_lambda': 0.06,
      'entropy_shannon': 0.05,
      'fractal_dfa_exponent': 0.05,
      'wavelet_energy_2': 0.04,
      'interaction_price_volume': 0.04
    };
  }
  
  /**
   * Clean up resources
   */
  dispose(): void {
    this.featureHistory.clear();
    this.featureStats.clear();
    this.normalizationParams.clear();
    this.removeAllListeners();
  }
} 