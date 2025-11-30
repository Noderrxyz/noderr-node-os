/**
 * FractalPatternDetector - Advanced pattern recognition using fractal analysis
 * Detects self-similar patterns across multiple timeframes for market prediction
 */

import { Logger } from 'winston';import EventEmitter from 'events';import {
  FeatureSet,
  FractalPattern,
  FractalType,
  PriceFeatures,
  TechnicalFeatures,
  MLError,
  MLErrorCode
} from './types';

interface PatternWindow {
  startIndex: number;
  endIndex: number;
  timeframe: string;
  data: number[];
}

interface ElliottWaveStructure {
  waves: WavePoint[];
  degree: string;
  trend: 'up' | 'down';
  completion: number;
  confidence: number;
}

interface WavePoint {
  index: number;
  price: number;
  label: string;
  time: number;
}

interface HarmonicPattern {
  type: string; // Gartley, Butterfly, Crab, Bat
  points: PatternPoint[];
  ratios: number[];
  completion: number;
  target: number;
  stopLoss: number;
}

interface PatternPoint {
  label: string;
  price: number;
  time: number;
}

interface WyckoffPhase {
  phase: string;
  stage: string;
  volume: number;
  priceAction: string;
  confidence: number;
}

interface FractalDimension {
  boxCounting: number;
  hurstExponent: number;
  lyapunovExponent: number;
  correlationDimension: number;
}

export class FractalPatternDetector extends EventEmitter {
  private logger: Logger;
  private priceHistory: Map<string, number[]>;
  private volumeHistory: Map<string, number[]>;
  private detectedPatterns: FractalPattern[];
  private fractalDimensions: Map<string, FractalDimension>;
  
  constructor(logger: Logger) {
    super();
    this.logger = logger;
    this.priceHistory = new Map();
    this.volumeHistory = new Map();
    this.detectedPatterns = [];
    this.fractalDimensions = new Map();
  }
  
  /**
   * Detect fractal patterns in market data
   */
  async detectPatterns(features: FeatureSet): Promise<FractalPattern[]> {
    const symbol = features.symbol;
    
    // Update price history
    this.updatePriceHistory(symbol, features.priceFeatures);
    
    // Get price data for analysis
    const prices = this.priceHistory.get(symbol) || [];
    if (prices.length < 100) {
      return []; // Need sufficient data
    }
    
    const patterns: FractalPattern[] = [];
    
    try {
      // Detect different pattern types
      const elliottPatterns = await this.detectElliottWaves(prices);
      patterns.push(...elliottPatterns);
      
      const harmonicPatterns = await this.detectHarmonicPatterns(prices);
      patterns.push(...harmonicPatterns);
      
      const wyckoffPatterns = await this.detectWyckoffPatterns(prices, this.volumeHistory.get(symbol) || []);
      patterns.push(...wyckoffPatterns);
      
      const marketProfilePatterns = await this.detectMarketProfilePatterns(features);
      patterns.push(...marketProfilePatterns);
      
      // Calculate fractal dimensions
      const dimensions = await this.calculateFractalDimensions(prices);
      this.fractalDimensions.set(symbol, dimensions);
      
      // Filter and rank patterns
      const rankedPatterns = this.rankPatterns(patterns);
      
      // Store detected patterns
      this.detectedPatterns = rankedPatterns;
      
      // Emit pattern detection event
      this.emit('patternsDetected', {
        symbol,
        patterns: rankedPatterns,
        dimensions
      });
      
      return rankedPatterns;
      
    } catch (error) {
      this.logger.error('Pattern detection failed', { error });
      throw new MLError(
        MLErrorCode.PREDICTION_FAILED,
        'Failed to detect fractal patterns',
        error
      );
    }
  }
  
  /**
   * Detect Elliott Wave patterns
   */
  private async detectElliottWaves(prices: number[]): Promise<FractalPattern[]> {
    const patterns: FractalPattern[] = [];
    const minWaveSize = 5;
    
    // Detect waves at multiple degrees
    const degrees = ['minor', 'intermediate', 'primary'];
    const windows = [20, 50, 100];
    
    for (let i = 0; i < degrees.length; i++) {
      const window = windows[i];
      const waves = this.findElliottWaves(prices, window);
      
      for (const wave of waves) {
        if (wave.completion > 0.8) {
          patterns.push({
            type: FractalType.ELLIOTT_WAVE,
            scale: window,
            dimension: this.calculateWaveDimension(wave),
            persistence: wave.completion,
            location: [wave.waves[0].index, wave.waves[wave.waves.length - 1].index],
            confidence: wave.confidence,
            predictivePower: this.calculatePredictivePower(wave)
          });
        }
      }
    }
    
    return patterns;
  }
  
  /**
   * Find Elliott Wave structures
   */
  private findElliottWaves(prices: number[], window: number): ElliottWaveStructure[] {
    const structures: ElliottWaveStructure[] = [];
    
    // Find local extrema
    const extrema = this.findLocalExtrema(prices, Math.floor(window / 10));
    
    // Try to fit 5-wave and 3-wave patterns
    for (let i = 0; i < extrema.length - 8; i++) {
      const impulsiveWave = this.checkImpulsiveWave(extrema.slice(i, i + 9));
      if (impulsiveWave) {
        structures.push(impulsiveWave);
      }
      
      const correctiveWave = this.checkCorrectiveWave(extrema.slice(i, i + 6));
      if (correctiveWave) {
        structures.push(correctiveWave);
      }
    }
    
    return structures;
  }
  
  /**
   * Check for impulsive wave pattern (5 waves)
   */
  private checkImpulsiveWave(points: WavePoint[]): ElliottWaveStructure | null {
    if (points.length < 6) return null;
    
    // Check wave relationships
    const wave1 = points[1].price - points[0].price;
    const wave2 = points[2].price - points[1].price;
    const wave3 = points[3].price - points[2].price;
    const wave4 = points[4].price - points[3].price;
    const wave5 = points[5].price - points[4].price;
    
    // Elliott Wave rules
    const isUptrend = wave1 > 0;
    
    if (isUptrend) {
      // Wave 2 cannot retrace more than 100% of wave 1
      if (wave2 < -wave1) return null;
      
      // Wave 3 cannot be the shortest
      if (Math.abs(wave3) < Math.abs(wave1) && Math.abs(wave3) < Math.abs(wave5)) return null;
      
      // Wave 4 cannot overlap wave 1
      if (points[4].price < points[1].price) return null;
    } else {
      // Inverse rules for downtrend
      if (wave2 > -wave1) return null;
      if (Math.abs(wave3) < Math.abs(wave1) && Math.abs(wave3) < Math.abs(wave5)) return null;
      if (points[4].price > points[1].price) return null;
    }
    
    // Calculate confidence based on Fibonacci ratios
    const confidence = this.calculateWaveConfidence(points);
    
    return {
      waves: points.slice(0, 6),
      degree: 'impulsive',
      trend: isUptrend ? 'up' : 'down',
      completion: 1.0,
      confidence
    };
  }
  
  /**
   * Check for corrective wave pattern (3 waves)
   */
  private checkCorrectiveWave(points: WavePoint[]): ElliottWaveStructure | null {
    if (points.length < 4) return null;
    
    const waveA = points[1].price - points[0].price;
    const waveB = points[2].price - points[1].price;
    const waveC = points[3].price - points[2].price;
    
    // Check ABC pattern
    const isCorrection = (waveA * waveC > 0) && (waveB * waveA < 0);
    
    if (!isCorrection) return null;
    
    const confidence = this.calculateWaveConfidence(points.slice(0, 4));
    
    return {
      waves: points.slice(0, 4),
      degree: 'corrective',
      trend: waveA > 0 ? 'down' : 'up', // Opposite of impulse
      completion: 1.0,
      confidence
    };
  }
  
  /**
   * Calculate wave confidence based on Fibonacci ratios
   */
  private calculateWaveConfidence(points: WavePoint[]): number {
    const fibRatios = [0.236, 0.382, 0.5, 0.618, 0.786, 1.0, 1.272, 1.618, 2.618];
    let confidence = 0;
    let checks = 0;
    
    // Check retracement ratios
    for (let i = 1; i < points.length - 1; i++) {
      const prevMove = Math.abs(points[i].price - points[i-1].price);
      const currMove = Math.abs(points[i+1].price - points[i].price);
      const ratio = currMove / prevMove;
      
      // Check if ratio is close to a Fibonacci number
      const minDiff = Math.min(...fibRatios.map(fib => Math.abs(ratio - fib)));
      if (minDiff < 0.05) {
        confidence += 1 - minDiff / 0.05;
      }
      checks++;
    }
    
    return checks > 0 ? confidence / checks : 0;
  }
  
  /**
   * Detect harmonic patterns
   */
  private async detectHarmonicPatterns(prices: number[]): Promise<FractalPattern[]> {
    const patterns: FractalPattern[] = [];
    const harmonicTypes = ['gartley', 'butterfly', 'crab', 'bat'];
    
    // Find potential XABCD patterns
    const extrema = this.findLocalExtrema(prices, 5);
    
    for (let i = 0; i < extrema.length - 4; i++) {
      const points = extrema.slice(i, i + 5);
      
      for (const type of harmonicTypes) {
        const harmonic = this.checkHarmonicPattern(points, type);
        if (harmonic && harmonic.completion > 0.8) {
          patterns.push({
            type: FractalType.HARMONIC,
            scale: points[4].index - points[0].index,
            dimension: 1.618, // Golden ratio dimension
            persistence: harmonic.completion,
            location: [points[0].index, points[4].index],
            confidence: this.calculateHarmonicConfidence(harmonic),
            predictivePower: 0.7 // Harmonics have good predictive power
          });
        }
      }
    }
    
    return patterns;
  }
  
  /**
   * Check for specific harmonic pattern
   */
  private checkHarmonicPattern(points: WavePoint[], type: string): HarmonicPattern | null {
    if (points.length < 5) return null;
    
    const [X, A, B, C, D] = points;
    
    // Calculate retracement ratios
    const XA = A.price - X.price;
    const AB = B.price - A.price;
    const BC = C.price - B.price;
    const CD = D.price - C.price;
    
    const AB_XA = Math.abs(AB / XA);
    const BC_AB = Math.abs(BC / AB);
    const CD_BC = Math.abs(CD / BC);
    const AD_XA = Math.abs((D.price - A.price) / XA);
    
    // Pattern-specific ratios
    let isValid = false;
    let targetRatios: number[] = [];
    
    switch (type) {
      case 'gartley':
        isValid = this.checkRatio(AB_XA, 0.618, 0.05) &&
                  this.checkRatio(BC_AB, 0.382, 0.886, 0.1) &&
                  this.checkRatio(AD_XA, 0.786, 0.05);
        targetRatios = [0.618, 0.382, 0.786];
        break;
        
      case 'butterfly':
        isValid = this.checkRatio(AB_XA, 0.786, 0.05) &&
                  this.checkRatio(BC_AB, 0.382, 0.886, 0.1) &&
                  this.checkRatio(AD_XA, 1.27, 1.618, 0.1);
        targetRatios = [0.786, 0.618, 1.27];
        break;
        
      case 'crab':
        isValid = this.checkRatio(AB_XA, 0.382, 0.618, 0.05) &&
                  this.checkRatio(BC_AB, 0.382, 0.886, 0.1) &&
                  this.checkRatio(AD_XA, 1.618, 0.05);
        targetRatios = [0.618, 0.618, 1.618];
        break;
        
      case 'bat':
        isValid = this.checkRatio(AB_XA, 0.382, 0.5, 0.05) &&
                  this.checkRatio(BC_AB, 0.382, 0.886, 0.1) &&
                  this.checkRatio(AD_XA, 0.886, 0.05);
        targetRatios = [0.5, 0.618, 0.886];
        break;
    }
    
    if (!isValid) return null;
    
    // Calculate target and stop loss
    const target = D.price + (XA > 0 ? -0.618 * CD : 0.618 * CD);
    const stopLoss = D.price + (XA > 0 ? 0.1 * Math.abs(CD) : -0.1 * Math.abs(CD));
    
    return {
      type,
      points: [
        { label: 'X', price: X.price, time: X.time },
        { label: 'A', price: A.price, time: A.time },
        { label: 'B', price: B.price, time: B.time },
        { label: 'C', price: C.price, time: C.time },
        { label: 'D', price: D.price, time: D.time }
      ],
      ratios: [AB_XA, BC_AB, AD_XA],
      completion: this.calculatePatternCompletion(points),
      target,
      stopLoss
    };
  }
  
  /**
   * Check if ratio is within tolerance
   */
  private checkRatio(value: number, target1: number, target2?: number, tolerance: number = 0.05): boolean {
    if (target2 === undefined) {
      return Math.abs(value - target1) <= tolerance;
    }
    return value >= target1 - tolerance && value <= target2 + tolerance;
  }
  
  /**
   * Detect Wyckoff patterns
   */
  private async detectWyckoffPatterns(prices: number[], volumes: number[]): Promise<FractalPattern[]> {
    const patterns: FractalPattern[] = [];
    
    // Detect accumulation and distribution phases
    const phases = this.identifyWyckoffPhases(prices, volumes);
    
    for (const phase of phases) {
      if (phase.confidence > 0.7) {
        patterns.push({
          type: FractalType.WYCKOFF,
          scale: 100, // Typical Wyckoff cycle length
          dimension: 1.5, // Fractal dimension of volume distribution
          persistence: phase.confidence,
          location: [0, prices.length - 1], // Full range for now
          confidence: phase.confidence,
          predictivePower: this.calculateWyckoffPredictivePower(phase)
        });
      }
    }
    
    return patterns;
  }
  
  /**
   * Identify Wyckoff phases
   */
  private identifyWyckoffPhases(prices: number[], volumes: number[]): WyckoffPhase[] {
    const phases: WyckoffPhase[] = [];
    const window = 20;
    
    for (let i = window; i < prices.length - window; i++) {
      const priceSlice = prices.slice(i - window, i + window);
      const volumeSlice = volumes.slice(i - window, i + window);
      
      // Analyze price and volume characteristics
      const priceRange = Math.max(...priceSlice) - Math.min(...priceSlice);
      const avgPrice = priceSlice.reduce((a, b) => a + b, 0) / priceSlice.length;
      const relativeRange = priceRange / avgPrice;
      
      const avgVolume = volumeSlice.reduce((a, b) => a + b, 0) / volumeSlice.length;
      const volumeTrend = this.calculateTrend(volumeSlice);
      
      // Identify phase based on characteristics
      let phase: WyckoffPhase | null = null;
      
      if (relativeRange < 0.05 && volumeTrend < -0.2) {
        phase = {
          phase: 'accumulation',
          stage: 'preliminary_support',
          volume: avgVolume,
          priceAction: 'ranging',
          confidence: 0.8
        };
      } else if (relativeRange > 0.1 && volumeTrend > 0.3) {
        phase = {
          phase: 'markup',
          stage: 'jump_across_creek',
          volume: avgVolume,
          priceAction: 'trending',
          confidence: 0.85
        };
      } else if (relativeRange < 0.05 && volumeTrend > 0.2) {
        phase = {
          phase: 'distribution',
          stage: 'preliminary_supply',
          volume: avgVolume,
          priceAction: 'ranging',
          confidence: 0.75
        };
      }
      
      if (phase) {
        phases.push(phase);
      }
    }
    
    return phases;
  }
  
  /**
   * Detect market profile patterns
   */
  private async detectMarketProfilePatterns(features: FeatureSet): Promise<FractalPattern[]> {
    const patterns: FractalPattern[] = [];
    
    // Extract volume profile features
    const volumeProfile = features.volumeFeatures.volumeProfile;
    const poc = features.volumeFeatures.poc;
    const valueAreaHigh = features.volumeFeatures.valueAreaHigh;
    const valueAreaLow = features.volumeFeatures.valueAreaLow;
    
    // Detect profile shapes
    const profileShape = this.analyzeProfileShape(volumeProfile);
    
    if (profileShape.confidence > 0.7) {
      patterns.push({
        type: FractalType.MARKET_PROFILE,
        scale: volumeProfile.length,
        dimension: this.calculateProfileDimension(volumeProfile),
        persistence: profileShape.balance,
        location: [0, volumeProfile.length - 1],
        confidence: profileShape.confidence,
        predictivePower: this.calculateProfilePredictivePower(profileShape)
      });
    }
    
    return patterns;
  }
  
  /**
   * Analyze market profile shape
   */
  private analyzeProfileShape(profile: number[]): any {
    if (profile.length === 0) {
      return { type: 'unknown', balance: 0, confidence: 0 };
    }
    
    // Find mode (POC)
    const maxVolume = Math.max(...profile);
    const pocIndex = profile.indexOf(maxVolume);
    
    // Calculate skewness
    const mean = profile.reduce((a, b) => a + b, 0) / profile.length;
    const variance = profile.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / profile.length;
    const std = Math.sqrt(variance);
    
    const skewness = profile.reduce((sum, val, i) => {
      return sum + Math.pow((val - mean) / std, 3);
    }, 0) / profile.length;
    
    // Determine shape type
    let type = 'balanced';
    let balance = 1 - Math.abs(skewness);
    
    if (skewness > 0.5) {
      type = 'p_shape'; // Bullish
    } else if (skewness < -0.5) {
      type = 'b_shape'; // Bearish
    } else if (Math.abs(pocIndex - profile.length / 2) < profile.length * 0.1) {
      type = 'd_shape'; // Balanced/neutral
    }
    
    return {
      type,
      balance,
      skewness,
      confidence: Math.min(1, 1 - Math.abs(skewness) / 2)
    };
  }
  
  /**
   * Calculate fractal dimensions
   */
  private async calculateFractalDimensions(prices: number[]): Promise<FractalDimension> {
    return {
      boxCounting: this.calculateBoxCountingDimension(prices),
      hurstExponent: this.calculateHurstExponent(prices),
      lyapunovExponent: this.calculateLyapunovExponent(prices),
      correlationDimension: this.calculateCorrelationDimension(prices)
    };
  }
  
  /**
   * Calculate box counting dimension
   */
  private calculateBoxCountingDimension(data: number[]): number {
    const scales = [2, 4, 8, 16, 32];
    const counts: number[] = [];
    
    for (const scale of scales) {
      let count = 0;
      const min = Math.min(...data);
      const max = Math.max(...data);
      const boxSize = (max - min) / scale;
      
      const boxes = new Set<string>();
      
      for (let i = 0; i < data.length; i++) {
        const boxX = Math.floor(i / scale);
        const boxY = Math.floor((data[i] - min) / boxSize);
        boxes.add(`${boxX},${boxY}`);
      }
      
      counts.push(boxes.size);
    }
    
    // Calculate dimension using linear regression
    const logScales = scales.map(s => Math.log(s));
    const logCounts = counts.map(c => Math.log(c));
    
    const slope = this.linearRegression(logScales, logCounts).slope;
    return -slope;
  }
  
  /**
   * Calculate Hurst exponent
   */
  private calculateHurstExponent(data: number[]): number {
    const n = data.length;
    const lags = [2, 4, 8, 16, 32, 64].filter(lag => lag < n / 2);
    const rs: number[] = [];
    
    for (const lag of lags) {
      const chunks = Math.floor(n / lag);
      let totalRS = 0;
      
      for (let i = 0; i < chunks; i++) {
        const chunk = data.slice(i * lag, (i + 1) * lag);
        const mean = chunk.reduce((a, b) => a + b, 0) / lag;
        
        // Calculate cumulative deviations
        let cumSum = 0;
        const cumDevs: number[] = [];
        
        for (const val of chunk) {
          cumSum += val - mean;
          cumDevs.push(cumSum);
        }
        
        const R = Math.max(...cumDevs) - Math.min(...cumDevs);
        const S = Math.sqrt(chunk.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / lag);
        
        if (S > 0) {
          totalRS += R / S;
        }
      }
      
      rs.push(totalRS / chunks);
    }
    
    // Calculate Hurst exponent from R/S analysis
    const logLags = lags.map(l => Math.log(l));
    const logRS = rs.map(r => Math.log(r));
    
    return this.linearRegression(logLags, logRS).slope;
  }
  
  /**
   * Calculate Lyapunov exponent
   */
  private calculateLyapunovExponent(data: number[]): number {
    const dim = 3; // Embedding dimension
    const tau = 1; // Time delay
    
    // Create embedded vectors
    const vectors: number[][] = [];
    for (let i = 0; i < data.length - (dim - 1) * tau; i++) {
      const vec: number[] = [];
      for (let j = 0; j < dim; j++) {
        vec.push(data[i + j * tau]);
      }
      vectors.push(vec);
    }
    
    // Calculate average divergence
    let sumLog = 0;
    let count = 0;
    
    for (let i = 0; i < vectors.length - 1; i++) {
      // Find nearest neighbor
      let minDist = Infinity;
      let nearestIdx = -1;
      
      for (let j = 0; j < vectors.length - 1; j++) {
        if (Math.abs(i - j) > 10) { // Temporal separation
          const dist = this.euclideanDistance(vectors[i], vectors[j]);
          if (dist < minDist && dist > 0) {
            minDist = dist;
            nearestIdx = j;
          }
        }
      }
      
      if (nearestIdx >= 0 && i + 1 < vectors.length && nearestIdx + 1 < vectors.length) {
        const finalDist = this.euclideanDistance(vectors[i + 1], vectors[nearestIdx + 1]);
        if (finalDist > 0 && minDist > 0) {
          sumLog += Math.log(finalDist / minDist);
          count++;
        }
      }
    }
    
    return count > 0 ? sumLog / count : 0;
  }
  
  /**
   * Calculate correlation dimension
   */
  private calculateCorrelationDimension(data: number[]): number {
    const embedded = this.embedTimeSeries(data, 3, 1);
    const radii = [0.1, 0.2, 0.3, 0.4, 0.5].map(r => r * this.calculateStdDev(data));
    const correlations: number[] = [];
    
    for (const radius of radii) {
      let count = 0;
      let total = 0;
      
      for (let i = 0; i < embedded.length; i++) {
        for (let j = i + 1; j < embedded.length; j++) {
          const dist = this.euclideanDistance(embedded[i], embedded[j]);
          if (dist < radius) count++;
          total++;
        }
      }
      
      correlations.push(count / total);
    }
    
    // Calculate dimension from scaling
    const logRadii = radii.map(r => Math.log(r));
    const logCorr = correlations.map(c => Math.log(c + 1e-10));
    
    return this.linearRegression(logRadii, logCorr).slope;
  }
  
  /**
   * Helper functions
   */
  
  private updatePriceHistory(symbol: string, priceFeatures: PriceFeatures): void {
    const history = this.priceHistory.get(symbol) || [];
    history.push(priceFeatures.close);
    
    // Keep last 1000 points
    if (history.length > 1000) {
      history.shift();
    }
    
    this.priceHistory.set(symbol, history);
    
    // Update volume history if available
    const volumeHistory = this.volumeHistory.get(symbol) || [];
    volumeHistory.push(priceFeatures.close * 1000); // Mock volume
    
    if (volumeHistory.length > 1000) {
      volumeHistory.shift();
    }
    
    this.volumeHistory.set(symbol, volumeHistory);
  }
  
  private findLocalExtrema(data: number[], window: number): WavePoint[] {
    const extrema: WavePoint[] = [];
    
    for (let i = window; i < data.length - window; i++) {
      const slice = data.slice(i - window, i + window + 1);
      const max = Math.max(...slice);
      const min = Math.min(...slice);
      
      if (data[i] === max || data[i] === min) {
        extrema.push({
          index: i,
          price: data[i],
          label: data[i] === max ? 'H' : 'L',
          time: i // Using index as time for simplicity
        });
      }
    }
    
    return extrema;
  }
  
  private calculateTrend(data: number[]): number {
    if (data.length < 2) return 0;
    
    const xValues = Array.from({ length: data.length }, (_, i) => i);
    const regression = this.linearRegression(xValues, data);
    
    return regression.slope / Math.abs(data[0]);
  }
  
  private linearRegression(x: number[], y: number[]): { slope: number; intercept: number } {
    const n = x.length;
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumXX = x.reduce((sum, xi) => sum + xi * xi, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    
    return { slope, intercept };
  }
  
  private euclideanDistance(v1: number[], v2: number[]): number {
    return Math.sqrt(v1.reduce((sum, val, i) => sum + Math.pow(val - v2[i], 2), 0));
  }
  
  private embedTimeSeries(data: number[], dim: number, tau: number): number[][] {
    const embedded: number[][] = [];
    
    for (let i = 0; i < data.length - (dim - 1) * tau; i++) {
      const vec: number[] = [];
      for (let j = 0; j < dim; j++) {
        vec.push(data[i + j * tau]);
      }
      embedded.push(vec);
    }
    
    return embedded;
  }
  
  private calculateStdDev(data: number[]): number {
    const mean = data.reduce((a, b) => a + b, 0) / data.length;
    const variance = data.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / data.length;
    return Math.sqrt(variance);
  }
  
  private calculateWaveDimension(wave: ElliottWaveStructure): number {
    // Fractal dimension based on wave structure
    const points = wave.waves.map(w => w.price);
    return this.calculateBoxCountingDimension(points);
  }
  
  private calculatePredictivePower(wave: ElliottWaveStructure): number {
    // Higher completion and confidence = higher predictive power
    return wave.completion * wave.confidence * 0.8;
  }
  
  private calculateHarmonicConfidence(harmonic: HarmonicPattern): number {
    // Average deviation from ideal ratios
    const idealRatios = this.getIdealRatios(harmonic.type);
    let totalDev = 0;
    
    for (let i = 0; i < harmonic.ratios.length && i < idealRatios.length; i++) {
      totalDev += Math.abs(harmonic.ratios[i] - idealRatios[i]);
    }
    
    return Math.max(0, 1 - totalDev / idealRatios.length);
  }
  
  private getIdealRatios(type: string): number[] {
    const ratios: Record<string, number[]> = {
      gartley: [0.618, 0.618, 0.786],
      butterfly: [0.786, 0.618, 1.27],
      crab: [0.5, 0.618, 1.618],
      bat: [0.45, 0.618, 0.886]
    };
    
    return ratios[type] || [0.618, 0.618, 1.0];
  }
  
  private calculatePatternCompletion(points: WavePoint[]): number {
    // Simple completion based on point count
    return Math.min(1, points.length / 5);
  }
  
  private calculateWyckoffPredictivePower(phase: WyckoffPhase): number {
    const phasePower: Record<string, number> = {
      accumulation: 0.8,
      markup: 0.9,
      distribution: 0.7,
      markdown: 0.85
    };
    
    return (phasePower[phase.phase] || 0.5) * phase.confidence;
  }
  
  private calculateProfileDimension(profile: number[]): number {
    // Fractal dimension of volume distribution
    return this.calculateBoxCountingDimension(profile);
  }
  
  private calculateProfilePredictivePower(profileShape: any): number {
    // Balanced profiles have lower predictive power
    // Skewed profiles indicate directional bias
    return Math.abs(profileShape.skewness) * profileShape.confidence;
  }
  
  private rankPatterns(patterns: FractalPattern[]): FractalPattern[] {
    // Sort by predictive power and confidence
    return patterns.sort((a, b) => {
      const scoreA = a.predictivePower * a.confidence;
      const scoreB = b.predictivePower * b.confidence;
      return scoreB - scoreA;
    });
  }
  
  /**
   * Get fractal dimensions for a symbol
   */
  getFractalDimensions(symbol: string): FractalDimension | null {
    return this.fractalDimensions.get(symbol) || null;
  }
  
  /**
   * Get detected patterns
   */
  getDetectedPatterns(): FractalPattern[] {
    return [...this.detectedPatterns];
  }
  
  /**
   * Clean up resources
   */
  dispose(): void {
    this.priceHistory.clear();
    this.volumeHistory.clear();
    this.detectedPatterns = [];
    this.fractalDimensions.clear();
    this.removeAllListeners();
  }
} 