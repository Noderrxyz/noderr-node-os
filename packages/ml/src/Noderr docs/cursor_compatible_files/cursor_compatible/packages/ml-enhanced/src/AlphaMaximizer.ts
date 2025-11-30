import * as tf from '@tensorflow/tfjs-node-gpu';
import { PCA } from './models/PCA';
import * as winston from 'winston';

export interface Signal {
  timestamp: number;
  symbol: string;
  features: number[];
  strength: number;
  source: string;
}

export interface AlphaSignal {
  action: 'buy' | 'sell' | 'hold';
  confidence: number;
  size: number;
  urgency: number;
  regime: MarketRegime;
}

export type MarketRegime = 'trending' | 'mean_reverting' | 'volatile' | 'stable' | 'crisis';

export class AlphaMaximizer {
  private signalCompressor: SignalPCA;
  private regimeDetector: MarketRegimeHMM;
  private signalAmplifier: AdaptiveKalmanFilter;
  private agentEnsemble: AgentEnsemble;
  private kellyOptimizer: KellyOptimizer;
  private signalHistory: Signal[] = [];
  private logger: winston.Logger;
  
  constructor(logger: winston.Logger) {
    this.logger = logger;
    this.signalCompressor = new SignalPCA(0.95); // Keep 95% variance
    this.regimeDetector = new MarketRegimeHMM();
    this.signalAmplifier = new AdaptiveKalmanFilter();
    this.agentEnsemble = new AgentEnsemble();
    this.kellyOptimizer = new KellyOptimizer();
  }
  
  async processSignals(rawSignals: Signal[]): Promise<AlphaSignal> {
    const startTime = Date.now();
    
    // 1. Compress redundant signals
    const compressed = await this.signalCompressor.transform(rawSignals);
    
    // 2. Detect market regime
    const regime = await this.regimeDetector.predict(compressed);
    
    // 3. Amplify based on regime confidence
    const regimeWeights: Record<MarketRegime, number> = {
      'trending': 1.5,
      'mean_reverting': 0.8,
      'volatile': 0.5,
      'stable': 1.2,
      'crisis': 0.3
    };
    
    const amplified = this.signalAmplifier.filter(
      compressed,
      regimeWeights[regime]
    );
    
    // 4. Multi-agent voting
    const votes = await this.agentEnsemble.vote(amplified);
    
    // 5. Kelly criterion position sizing
    const { size, confidence } = this.kellyOptimizer.calculate({
      signalStrength: votes.meanStrength,
      uncertainty: votes.stdDeviation,
      winRate: votes.historicalWinRate,
      avgWin: votes.avgWinSize,
      avgLoss: votes.avgLossSize
    });
    
    // 6. Add anti-pattern jitter
    const jitteredSize = this.addExecutionJitter(size);
    
    // Store for learning
    this.updateSignalHistory(rawSignals);
    
    const processingTime = Date.now() - startTime;
    this.logger.debug(`Alpha signal processed in ${processingTime}ms`, {
      regime,
      confidence,
      signalCount: rawSignals.length,
      compressedCount: compressed.length
    });
    
    return {
      action: votes.consensus,
      confidence,
      size: jitteredSize,
      urgency: this.calculateUrgency(votes, regime),
      regime
    };
  }
  
  private calculateUrgency(votes: VoteResult, regime: MarketRegime): number {
    // Higher urgency for stronger consensus and certain regimes
    const consensusStrength = votes.consensusRatio;
    const regimeUrgency = {
      'trending': 0.8,
      'mean_reverting': 0.6,
      'volatile': 0.9,
      'stable': 0.4,
      'crisis': 1.0
    };
    
    return consensusStrength * regimeUrgency[regime];
  }
  
  private addExecutionJitter(size: number): number {
    // Add 5-15% random jitter to avoid predictable patterns
    const jitter = 0.05 + Math.random() * 0.1;
    const direction = Math.random() > 0.5 ? 1 : -1;
    return size * (1 + direction * jitter);
  }
  
  private updateSignalHistory(signals: Signal[]): void {
    this.signalHistory.push(...signals);
    
    // Keep only recent history (e.g., last 10000 signals)
    if (this.signalHistory.length > 10000) {
      this.signalHistory = this.signalHistory.slice(-10000);
    }
  }
  
  async detectAlphaLeaks(): Promise<AlphaLeakReport> {
    const patterns = await this.analyzeExecutionPatterns();
    const correlations = await this.analyzeSignalCorrelations();
    const footprint = await this.analyzeMarketFootprint();
    
    return {
      predictablePatterns: patterns,
      redundantSignals: correlations.filter(c => c.correlation > 0.8),
      marketImpactVisible: footprint.visibility > 0.3,
      recommendations: this.generateAntiLeakRecommendations(patterns, correlations, footprint)
    };
  }
  
  private async analyzeExecutionPatterns(): Promise<ExecutionPattern[]> {
    // Analyze timing patterns
    const timingAnalysis = this.analyzeTimingPatterns();
    
    // Analyze size patterns
    const sizeAnalysis = this.analyzeSizePatterns();
    
    // Analyze venue patterns
    const venueAnalysis = this.analyzeVenuePatterns();
    
    return [
      ...timingAnalysis,
      ...sizeAnalysis,
      ...venueAnalysis
    ];
  }
  
  private analyzeTimingPatterns(): ExecutionPattern[] {
    const patterns: ExecutionPattern[] = [];
    
    // Check for fixed intervals
    const intervals = this.signalHistory.slice(1).map((s, i) => 
      s.timestamp - this.signalHistory[i].timestamp
    );
    
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const stdInterval = Math.sqrt(
      intervals.reduce((sum, i) => sum + Math.pow(i - avgInterval, 2), 0) / intervals.length
    );
    
    if (stdInterval / avgInterval < 0.1) {
      patterns.push({
        type: 'timing',
        description: 'Fixed execution intervals detected',
        severity: 'high',
        avgInterval,
        stdInterval
      });
    }
    
    return patterns;
  }
  
  private analyzeSizePatterns(): ExecutionPattern[] {
    const patterns: ExecutionPattern[] = [];
    
    // Check for consistent size ratios
    const sizes = this.signalHistory.map(s => s.strength);
    const sizeRatios = sizes.slice(1).map((s, i) => s / sizes[i]);
    
    const uniqueRatios = new Set(sizeRatios.map(r => Math.round(r * 100) / 100));
    
    if (uniqueRatios.size < sizeRatios.length * 0.2) {
      patterns.push({
        type: 'size',
        description: 'Predictable size ratios detected',
        severity: 'medium',
        commonRatios: Array.from(uniqueRatios).slice(0, 5)
      });
    }
    
    return patterns;
  }
  
  private analyzeVenuePatterns(): ExecutionPattern[] {
    // Simplified venue pattern analysis
    return [];
  }
  
  private async analyzeSignalCorrelations(): Promise<SignalCorrelation[]> {
    const correlations: SignalCorrelation[] = [];
    
    // Group signals by source
    const signalsBySource = new Map<string, Signal[]>();
    for (const signal of this.signalHistory) {
      if (!signalsBySource.has(signal.source)) {
        signalsBySource.set(signal.source, []);
      }
      signalsBySource.get(signal.source)!.push(signal);
    }
    
    // Calculate pairwise correlations
    const sources = Array.from(signalsBySource.keys());
    for (let i = 0; i < sources.length; i++) {
      for (let j = i + 1; j < sources.length; j++) {
        const correlation = this.calculateCorrelation(
          signalsBySource.get(sources[i])!,
          signalsBySource.get(sources[j])!
        );
        
        correlations.push({
          source1: sources[i],
          source2: sources[j],
          correlation
        });
      }
    }
    
    return correlations.sort((a, b) => b.correlation - a.correlation);
  }
  
  private calculateCorrelation(signals1: Signal[], signals2: Signal[]): number {
    // Simplified correlation calculation
    const strengths1 = signals1.map(s => s.strength);
    const strengths2 = signals2.map(s => s.strength);
    
    const minLength = Math.min(strengths1.length, strengths2.length);
    if (minLength < 10) return 0;
    
    // Pearson correlation
    const mean1 = strengths1.reduce((a, b) => a + b, 0) / strengths1.length;
    const mean2 = strengths2.reduce((a, b) => a + b, 0) / strengths2.length;
    
    let numerator = 0;
    let denominator1 = 0;
    let denominator2 = 0;
    
    for (let i = 0; i < minLength; i++) {
      const diff1 = strengths1[i] - mean1;
      const diff2 = strengths2[i] - mean2;
      numerator += diff1 * diff2;
      denominator1 += diff1 * diff1;
      denominator2 += diff2 * diff2;
    }
    
    return numerator / (Math.sqrt(denominator1) * Math.sqrt(denominator2));
  }
  
  private async analyzeMarketFootprint(): Promise<MarketFootprint> {
    // Analyze market impact visibility
    return {
      visibility: 0.2, // Mock value
      impactDecayTime: 300, // seconds
      detectablePatterns: []
    };
  }
  
  private generateAntiLeakRecommendations(
    patterns: ExecutionPattern[],
    correlations: SignalCorrelation[],
    footprint: MarketFootprint
  ): string[] {
    const recommendations: string[] = [];
    
    if (patterns.some(p => p.type === 'timing' && p.severity === 'high')) {
      recommendations.push('Implement random execution delays (50-500ms)');
    }
    
    if (patterns.some(p => p.type === 'size')) {
      recommendations.push('Add 10-20% size randomization');
      recommendations.push('Use fibonacci-based size variations');
    }
    
    if (correlations.some(c => c.correlation > 0.8)) {
      recommendations.push('Apply PCA to reduce signal dimensions');
      recommendations.push('Implement signal orthogonalization');
    }
    
    if (footprint.visibility > 0.3) {
      recommendations.push('Enable iceberg orders for large trades');
      recommendations.push('Distribute execution across dark pools');
      recommendations.push('Implement time-weighted randomization');
    }
    
    return recommendations;
  }
}

class SignalPCA {
  private pca: PCA | null = null;
  private varianceThreshold: number;
  
  constructor(varianceThreshold: number) {
    this.varianceThreshold = varianceThreshold;
  }
  
  async transform(signals: Signal[]): Promise<Signal[]> {
    if (signals.length === 0) return [];
    
    // Extract feature matrix
    const features = signals.map(s => s.features);
    
    // Fit PCA if not already fitted
    if (!this.pca) {
      this.pca = new PCA(features);
    }
    
    // Transform to principal components
    const transformed = this.pca.predict(features, {
      nComponents: this.getOptimalComponents()
    });
    
    // Reconstruct signals with compressed features
    return signals.map((signal, i) => ({
      ...signal,
      features: transformed[i]
    }));
  }
  
  private getOptimalComponents(): number {
    if (!this.pca) return 10;
    
    const variances = this.pca.getExplainedVariance();
    let cumulative = 0;
    let components = 0;
    
    for (const variance of variances) {
      cumulative += variance;
      components++;
      if (cumulative >= this.varianceThreshold) break;
    }
    
    return components;
  }
}

class MarketRegimeHMM {
  private states: MarketRegime[] = ['trending', 'mean_reverting', 'volatile', 'stable', 'crisis'];
  private transitionMatrix: number[][] = [
    [0.7, 0.1, 0.1, 0.05, 0.05],  // trending
    [0.1, 0.6, 0.1, 0.15, 0.05],  // mean_reverting
    [0.1, 0.1, 0.5, 0.1, 0.2],    // volatile
    [0.05, 0.15, 0.1, 0.65, 0.05], // stable
    [0.05, 0.05, 0.3, 0.1, 0.5]   // crisis
  ];
  
  async predict(signals: Signal[]): Promise<MarketRegime> {
    if (signals.length === 0) return 'stable';
    
    // Extract regime features
    const features = this.extractRegimeFeatures(signals);
    
    // Simple regime detection based on features
    const volatility = features.volatility;
    const trend = features.trend;
    const volume = features.volume;
    
    if (volatility > 0.03 && volume > 1.5) return 'crisis';
    if (volatility > 0.02) return 'volatile';
    if (Math.abs(trend) > 0.001) return 'trending';
    if (features.meanReversion > 0.7) return 'mean_reverting';
    
    return 'stable';
  }
  
  private extractRegimeFeatures(signals: Signal[]): RegimeFeatures {
    const strengths = signals.map(s => s.strength);
    
    // Calculate returns
    const returns = strengths.slice(1).map((s, i) => 
      (s - strengths[i]) / strengths[i]
    );
    
    // Volatility
    const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const volatility = Math.sqrt(
      returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / returns.length
    );
    
    // Trend
    const trend = this.calculateTrend(strengths);
    
    // Mean reversion
    const meanReversion = this.calculateMeanReversion(strengths);
    
    // Volume proxy
    const volume = signals.length / 100; // Normalized
    
    return { volatility, trend, meanReversion, volume };
  }
  
  private calculateTrend(values: number[]): number {
    if (values.length < 2) return 0;
    
    // Simple linear regression slope
    const n = values.length;
    const sumX = (n * (n - 1)) / 2;
    const sumY = values.reduce((a, b) => a + b, 0);
    const sumXY = values.reduce((sum, y, x) => sum + x * y, 0);
    const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;
    
    return (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  }
  
  private calculateMeanReversion(values: number[]): number {
    if (values.length < 10) return 0.5;
    
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    let crossings = 0;
    
    for (let i = 1; i < values.length; i++) {
      if ((values[i-1] - mean) * (values[i] - mean) < 0) {
        crossings++;
      }
    }
    
    return crossings / (values.length - 1);
  }
}

class AdaptiveKalmanFilter {
  private Q = 0.01; // Process noise
  private R = 0.1;  // Measurement noise
  private x = 0;    // State estimate
  private P = 1;    // Error covariance
  
  filter(signals: Signal[], amplification: number): Signal[] {
    return signals.map(signal => {
      // Kalman filter update
      const prediction = this.x;
      const predictionError = this.P + this.Q;
      
      const kalmanGain = predictionError / (predictionError + this.R);
      this.x = prediction + kalmanGain * (signal.strength - prediction);
      this.P = (1 - kalmanGain) * predictionError;
      
      // Apply amplification
      const filteredStrength = this.x * amplification;
      
      return {
        ...signal,
        strength: filteredStrength
      };
    });
  }
}

class AgentEnsemble {
  private agents: TradingAgent[] = [];
  
  constructor() {
    // Initialize diverse agents
    this.agents = [
      new MomentumAgent(),
      new MeanReversionAgent(),
      new MLAgent(),
      new SentimentAgent(),
      new TechnicalAgent()
    ];
  }
  
  async vote(signals: Signal[]): Promise<VoteResult> {
    const votes = await Promise.all(
      this.agents.map(agent => agent.evaluate(signals))
    );
    
    // Count votes
    const voteCounts = { buy: 0, sell: 0, hold: 0 };
    const strengths: number[] = [];
    
    for (const vote of votes) {
      voteCounts[vote.action]++;
      strengths.push(vote.strength);
    }
    
    // Determine consensus
    const consensus = Object.entries(voteCounts)
      .sort((a, b) => b[1] - a[1])[0][0] as 'buy' | 'sell' | 'hold';
    
    const consensusRatio = voteCounts[consensus] / votes.length;
    const meanStrength = strengths.reduce((a, b) => a + b, 0) / strengths.length;
    const stdDeviation = Math.sqrt(
      strengths.reduce((sum, s) => sum + Math.pow(s - meanStrength, 2), 0) / strengths.length
    );
    
    return {
      consensus,
      consensusRatio,
      meanStrength,
      stdDeviation,
      votes,
      historicalWinRate: 0.58, // Mock
      avgWinSize: 0.02,        // Mock
      avgLossSize: 0.015       // Mock
    };
  }
}

class KellyOptimizer {
  calculate(params: KellyParams): { size: number; confidence: number } {
    const { signalStrength, uncertainty, winRate, avgWin, avgLoss } = params;
    
    // Kelly formula: f = (p * b - q) / b
    // where p = win rate, q = loss rate, b = win/loss ratio
    const p = winRate;
    const q = 1 - winRate;
    const b = avgWin / avgLoss;
    
    let kellyFraction = (p * b - q) / b;
    
    // Adjust for uncertainty
    kellyFraction *= (1 - uncertainty);
    
    // Adjust for signal strength
    kellyFraction *= signalStrength;
    
    // Apply safety factor (never bet more than 25%)
    kellyFraction = Math.min(kellyFraction, 0.25);
    
    // Ensure non-negative
    kellyFraction = Math.max(kellyFraction, 0);
    
    const confidence = p * (1 - uncertainty) * signalStrength;
    
    return {
      size: kellyFraction,
      confidence
    };
  }
}

// Type definitions
interface VoteResult {
  consensus: 'buy' | 'sell' | 'hold';
  consensusRatio: number;
  meanStrength: number;
  stdDeviation: number;
  votes: AgentVote[];
  historicalWinRate: number;
  avgWinSize: number;
  avgLossSize: number;
}

interface AgentVote {
  agent: string;
  action: 'buy' | 'sell' | 'hold';
  strength: number;
  reasoning: string;
}

interface KellyParams {
  signalStrength: number;
  uncertainty: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
}

interface AlphaLeakReport {
  predictablePatterns: ExecutionPattern[];
  redundantSignals: SignalCorrelation[];
  marketImpactVisible: boolean;
  recommendations: string[];
}

interface ExecutionPattern {
  type: 'timing' | 'size' | 'venue';
  description: string;
  severity: 'low' | 'medium' | 'high';
  [key: string]: any;
}

interface SignalCorrelation {
  source1: string;
  source2: string;
  correlation: number;
}

interface MarketFootprint {
  visibility: number;
  impactDecayTime: number;
  detectablePatterns: string[];
}

interface RegimeFeatures {
  volatility: number;
  trend: number;
  meanReversion: number;
  volume: number;
}

// Mock agent implementations
abstract class TradingAgent {
  abstract name: string;
  abstract evaluate(signals: Signal[]): Promise<AgentVote>;
}

class MomentumAgent extends TradingAgent {
  name = 'momentum';
  
  async evaluate(signals: Signal[]): Promise<AgentVote> {
    const momentum = signals.reduce((sum, s) => sum + s.strength, 0) / signals.length;
    
    return {
      agent: this.name,
      action: momentum > 0.1 ? 'buy' : momentum < -0.1 ? 'sell' : 'hold',
      strength: Math.abs(momentum),
      reasoning: `Momentum: ${momentum.toFixed(3)}`
    };
  }
}

class MeanReversionAgent extends TradingAgent {
  name = 'mean_reversion';
  
  async evaluate(signals: Signal[]): Promise<AgentVote> {
    // Simplified mean reversion logic
    return {
      agent: this.name,
      action: 'hold',
      strength: 0.5,
      reasoning: 'Mean reversion neutral'
    };
  }
}

class MLAgent extends TradingAgent {
  name = 'ml_predictor';
  
  async evaluate(signals: Signal[]): Promise<AgentVote> {
    // Mock ML prediction
    return {
      agent: this.name,
      action: 'buy',
      strength: 0.7,
      reasoning: 'ML confidence: 70%'
    };
  }
}

class SentimentAgent extends TradingAgent {
  name = 'sentiment';
  
  async evaluate(signals: Signal[]): Promise<AgentVote> {
    return {
      agent: this.name,
      action: 'hold',
      strength: 0.4,
      reasoning: 'Neutral sentiment'
    };
  }
}

class TechnicalAgent extends TradingAgent {
  name = 'technical';
  
  async evaluate(signals: Signal[]): Promise<AgentVote> {
    return {
      agent: this.name,
      action: 'buy',
      strength: 0.6,
      reasoning: 'Technical indicators bullish'
    };
  }
} 