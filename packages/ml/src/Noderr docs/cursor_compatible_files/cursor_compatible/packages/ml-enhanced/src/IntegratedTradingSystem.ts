import { MetaEnsemble, EnsemblePrediction } from './MetaEnsemble';
import { AlphaMaximizer, Signal, AlphaSignal } from './AlphaMaximizer';
import { OnlineRLTrader, RLState, RLAction } from './OnlineRLTrader';
import * as winston from 'winston';

export interface TradingDecision {
  action: 'buy' | 'sell' | 'hold';
  size: number;
  confidence: number;
  expectedSlippage: number;
  executionStrategy: 'market' | 'limit' | 'iceberg' | 'twap';
  urgency: number;
  reasoning: string[];
}

export interface SystemMetrics {
  latencyP50: number;
  latencyP99: number;
  sharpeRatio: number;
  winRate: number;
  avgSlippage: number;
  signalQuality: number;
}

export class IntegratedTradingSystem {
  private metaEnsemble: MetaEnsemble;
  private alphaMaximizer: AlphaMaximizer;
  private latencyAwareInference: LatencyAwareInference;
  private onlineRLTrader: OnlineRLTrader;
  private logger: winston.Logger;
  private metrics: SystemMetrics;
  
  constructor() {
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.json(),
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'trading-system.log' })
      ]
    });
    
    this.metaEnsemble = new MetaEnsemble(this.logger);
    this.alphaMaximizer = new AlphaMaximizer(this.logger);
    this.latencyAwareInference = new LatencyAwareInference(this.logger);
    this.onlineRLTrader = new OnlineRLTrader(this.logger);
    
    this.metrics = {
      latencyP50: 80,
      latencyP99: 800,
      sharpeRatio: 3.2,
      winRate: 0.58,
      avgSlippage: 1.8,
      signalQuality: 0.7
    };
  }
  
  async processTradingSignals(
    marketData: MarketData,
    latencyBudgetMs: number = 25
  ): Promise<TradingDecision> {
    const startTime = process.hrtime.bigint();
    
    try {
      // 1. Extract features from market data
      const features = this.extractFeatures(marketData);
      
      // 2. Get ML predictions with latency awareness
      const mlPrediction = await this.latencyAwareInference.predict(
        features,
        latencyBudgetMs * 0.4 // Allocate 40% of budget to ML
      );
      
      // 3. Generate trading signals
      const signals = this.generateSignals(marketData, mlPrediction);
      
      // 4. Process through alpha maximizer
      const alphaSignal = await this.alphaMaximizer.processSignals(signals);
      
      // 5. Get RL agent recommendation
      const rlState: RLState = {
        features,
        marketRegime: alphaSignal.regime,
        currentPosition: marketData.currentPosition,
        recentReturns: this.calculateRecentReturns(marketData),
        volatility: marketData.volatility
      };
      
      const rlAction = await this.onlineRLTrader.getAction(rlState);
      
      // 6. Combine all signals for final decision
      const decision = this.combineSignals(mlPrediction, alphaSignal, rlAction);
      
      // 7. Update latency metrics
      const latencyNs = process.hrtime.bigint() - startTime;
      const latencyMs = Number(latencyNs) / 1e6;
      this.updateLatencyMetrics(latencyMs);
      
      this.logger.info('Trading decision made', {
        action: decision.action,
        confidence: decision.confidence,
        latencyMs,
        regime: alphaSignal.regime
      });
      
      return decision;
      
    } catch (error) {
      this.logger.error('Error processing trading signals', error);
      
      // Fallback to safe decision
      return {
        action: 'hold',
        size: 0,
        confidence: 0,
        expectedSlippage: 0,
        executionStrategy: 'limit',
        urgency: 0,
        reasoning: ['Error in signal processing, defaulting to hold']
      };
    }
  }
  
  private extractFeatures(marketData: MarketData): number[][] {
    const features: number[] = [
      // Price features
      marketData.currentPrice,
      marketData.vwap,
      (marketData.currentPrice - marketData.vwap) / marketData.vwap,
      
      // Volume features
      marketData.volume,
      marketData.volumeProfile.buyVolume / marketData.volumeProfile.totalVolume,
      
      // Orderbook features
      marketData.orderbook.bidAskSpread,
      marketData.orderbook.imbalance,
      marketData.orderbook.depth,
      
      // Technical indicators
      ...marketData.technicalIndicators,
      
      // Market microstructure
      marketData.volatility,
      marketData.momentum,
      marketData.liquidityScore
    ];
    
    return [features]; // Return as 2D array for model input
  }
  
  private generateSignals(
    marketData: MarketData,
    mlPrediction: EnsemblePrediction
  ): Signal[] {
    const timestamp = Date.now();
    const signals: Signal[] = [];
    
    // ML signal
    signals.push({
      timestamp,
      symbol: marketData.symbol,
      features: [mlPrediction.value],
      strength: mlPrediction.value * (1 - mlPrediction.uncertainty),
      source: 'ml_ensemble'
    });
    
    // Technical signal
    const technicalStrength = this.calculateTechnicalStrength(marketData);
    signals.push({
      timestamp,
      symbol: marketData.symbol,
      features: marketData.technicalIndicators,
      strength: technicalStrength,
      source: 'technical'
    });
    
    // Microstructure signal
    const microstructureStrength = this.calculateMicrostructureStrength(marketData);
    signals.push({
      timestamp,
      symbol: marketData.symbol,
      features: [
        marketData.orderbook.imbalance,
        marketData.orderbook.bidAskSpread,
        marketData.orderbook.depth
      ],
      strength: microstructureStrength,
      source: 'microstructure'
    });
    
    // Volume signal
    const volumeStrength = this.calculateVolumeStrength(marketData);
    signals.push({
      timestamp,
      symbol: marketData.symbol,
      features: [
        marketData.volume,
        marketData.volumeProfile.buyVolume,
        marketData.volumeProfile.sellVolume
      ],
      strength: volumeStrength,
      source: 'volume'
    });
    
    return signals;
  }
  
  private calculateTechnicalStrength(marketData: MarketData): number {
    // Simplified technical analysis
    const rsi = marketData.technicalIndicators[0]; // Assume first is RSI
    const macd = marketData.technicalIndicators[1]; // Assume second is MACD
    
    let strength = 0;
    
    // RSI signals
    if (rsi < 30) strength += 0.3; // Oversold
    else if (rsi > 70) strength -= 0.3; // Overbought
    
    // MACD signals
    if (macd > 0) strength += 0.2;
    else strength -= 0.2;
    
    return Math.max(-1, Math.min(1, strength));
  }
  
  private calculateMicrostructureStrength(marketData: MarketData): number {
    const { imbalance, bidAskSpread, depth } = marketData.orderbook;
    
    // Positive imbalance (more bids) is bullish
    let strength = imbalance * 0.5;
    
    // Tight spread is good for execution
    if (bidAskSpread < marketData.currentPrice * 0.001) {
      strength *= 1.2;
    }
    
    // Deep book provides liquidity
    if (depth > 1000) {
      strength *= 1.1;
    }
    
    return Math.max(-1, Math.min(1, strength));
  }
  
  private calculateVolumeStrength(marketData: MarketData): number {
    const { buyVolume, sellVolume, totalVolume } = marketData.volumeProfile;
    
    // Volume imbalance
    const volumeImbalance = (buyVolume - sellVolume) / totalVolume;
    
    // High volume confirmation
    const relativeVolume = marketData.volume / marketData.avgVolume;
    const volumeMultiplier = Math.min(relativeVolume, 2);
    
    return volumeImbalance * volumeMultiplier;
  }
  
  private calculateRecentReturns(marketData: MarketData): number[] {
    // In production, this would use historical price data
    // For now, return mock returns
    return [0.001, -0.002, 0.003, 0.001, -0.001];
  }
  
  private combineSignals(
    mlPrediction: EnsemblePrediction,
    alphaSignal: AlphaSignal,
    rlAction: RLAction
  ): TradingDecision {
    const reasoning: string[] = [];
    
    // Weighted combination of signals
    const weights = {
      ml: 0.4,
      alpha: 0.35,
      rl: 0.25
    };
    
    // Convert signals to numeric scores
    const mlScore = mlPrediction.value;
    const alphaScore = alphaSignal.action === 'buy' ? 1 : 
                      alphaSignal.action === 'sell' ? -1 : 0;
    const rlScore = rlAction.action === 'buy' ? 1 :
                    rlAction.action === 'sell' ? -1 : 0;
    
    // Weighted average
    const combinedScore = 
      mlScore * weights.ml +
      alphaScore * weights.alpha +
      rlScore * weights.rl;
    
    // Determine action
    let action: 'buy' | 'sell' | 'hold';
    if (combinedScore > 0.2) {
      action = 'buy';
      reasoning.push(`Bullish signal: score=${combinedScore.toFixed(3)}`);
    } else if (combinedScore < -0.2) {
      action = 'sell';
      reasoning.push(`Bearish signal: score=${combinedScore.toFixed(3)}`);
    } else {
      action = 'hold';
      reasoning.push(`Neutral signal: score=${combinedScore.toFixed(3)}`);
    }
    
    // Calculate confidence
    const confidence = Math.min(
      mlPrediction.confidence * 0.4 +
      alphaSignal.confidence * 0.35 +
      rlAction.confidence * 0.25,
      0.95 // Cap at 95%
    );
    
    // Determine size (Kelly criterion already applied in alpha maximizer)
    const size = alphaSignal.size * confidence;
    
    // Expected slippage based on urgency and market conditions
    const expectedSlippage = this.estimateSlippage(alphaSignal.urgency);
    
    // Execution strategy based on urgency and size
    const executionStrategy = this.selectExecutionStrategy(
      alphaSignal.urgency,
      size,
      expectedSlippage
    );
    
    // Add reasoning
    reasoning.push(`ML prediction: ${mlPrediction.value.toFixed(3)} (conf: ${mlPrediction.confidence.toFixed(2)})`);
    reasoning.push(`Alpha signal: ${alphaSignal.action} (regime: ${alphaSignal.regime})`);
    reasoning.push(`RL action: ${rlAction.action} (reward: ${rlAction.expectedReward.toFixed(3)})`);
    reasoning.push(`Execution: ${executionStrategy} (urgency: ${alphaSignal.urgency.toFixed(2)})`);
    
    return {
      action,
      size,
      confidence,
      expectedSlippage,
      executionStrategy,
      urgency: alphaSignal.urgency,
      reasoning
    };
  }
  
  private estimateSlippage(urgency: number): number {
    // Base slippage
    let slippage = 0.5; // 0.5 bps
    
    // Higher urgency means accepting more slippage
    slippage *= (1 + urgency);
    
    // Use current metrics
    const recentSlippage = this.metrics.avgSlippage;
    slippage = 0.7 * slippage + 0.3 * recentSlippage;
    
    return slippage;
  }
  
  private selectExecutionStrategy(
    urgency: number,
    size: number,
    expectedSlippage: number
  ): 'market' | 'limit' | 'iceberg' | 'twap' {
    // High urgency -> market order
    if (urgency > 0.8) return 'market';
    
    // Large size -> iceberg or TWAP
    if (size > 0.1) {
      return urgency > 0.5 ? 'iceberg' : 'twap';
    }
    
    // Low urgency and acceptable slippage -> limit
    if (urgency < 0.3 && expectedSlippage < 1) {
      return 'limit';
    }
    
    // Default to iceberg for medium cases
    return 'iceberg';
  }
  
  private updateLatencyMetrics(latencyMs: number): void {
    // Simple exponential moving average
    const alpha = 0.1;
    
    // Update P50 (simplified - in production use proper percentile tracking)
    this.metrics.latencyP50 = this.metrics.latencyP50 * (1 - alpha) + latencyMs * alpha;
    
    // Update P99 (track max of recent window)
    if (latencyMs > this.metrics.latencyP99 * 0.9) {
      this.metrics.latencyP99 = latencyMs;
    } else {
      this.metrics.latencyP99 = this.metrics.latencyP99 * (1 - alpha * 0.1) + latencyMs * alpha * 0.1;
    }
  }
  
  async updatePerformance(
    decision: TradingDecision,
    actualOutcome: TradingOutcome
  ): Promise<void> {
    // Create RL states for update
    const currentState: RLState = {
      features: [[]], // Would be filled with actual features
      marketRegime: 'stable',
      currentPosition: 0.5,
      recentReturns: [actualOutcome.pnl / 100000],
      volatility: 0.02
    };
    
    const nextState: RLState = {
      ...currentState,
      currentPosition: currentState.currentPosition + (decision.action === 'buy' ? decision.size : -decision.size)
    };
    
    // Update RL agent with reward
    await this.onlineRLTrader.updateWithReward(
      decision,
      actualOutcome.pnl,
      actualOutcome.slippage,
      currentState,
      nextState
    );
    
    // Update metrics
    this.updateMetrics(actualOutcome);
    
    // Log performance
    this.logger.info('Performance update', {
      decision: decision.action,
      pnl: actualOutcome.pnl,
      slippage: actualOutcome.slippage,
      metrics: this.metrics,
      rlMetrics: this.onlineRLTrader.getMetrics()
    });
  }
  
  private updateMetrics(outcome: TradingOutcome): void {
    const alpha = 0.05; // Decay factor
    
    // Update slippage
    this.metrics.avgSlippage = 
      this.metrics.avgSlippage * (1 - alpha) + outcome.slippage * alpha;
    
    // Update win rate
    const isWin = outcome.pnl > 0;
    this.metrics.winRate = 
      this.metrics.winRate * (1 - alpha) + (isWin ? 1 : 0) * alpha;
    
    // Update Sharpe ratio (simplified)
    // In production, track returns properly
    const dailyReturn = outcome.pnl / 100000; // Assume 100k capital
    const riskFreeRate = 0.02 / 252; // Daily risk-free rate
    const excessReturn = dailyReturn - riskFreeRate;
    
    // Simplified Sharpe update
    this.metrics.sharpeRatio = 
      this.metrics.sharpeRatio * 0.99 + excessReturn / 0.02 * 0.01;
  }
  
  getSystemMetrics(): SystemMetrics {
    return { ...this.metrics };
  }
  
  async detectAlphaLeaks(): Promise<any> {
    return this.alphaMaximizer.detectAlphaLeaks();
  }
}

// Type definitions
interface MarketData {
  symbol: string;
  currentPrice: number;
  vwap: number;
  volume: number;
  avgVolume: number;
  volatility: number;
  momentum: number;
  liquidityScore: number;
  currentPosition: number;
  orderbook: {
    bidAskSpread: number;
    imbalance: number;
    depth: number;
  };
  volumeProfile: {
    buyVolume: number;
    sellVolume: number;
    totalVolume: number;
  };
  technicalIndicators: number[];
}

interface TradingOutcome {
  pnl: number;
  slippage: number;
  fillPrice: number;
  fillTime: number;
}

// Placeholder implementations
class LatencyAwareInference {
  constructor(private logger: winston.Logger) {}
  
  async predict(features: number[][], budgetMs: number): Promise<EnsemblePrediction> {
    // Use the meta ensemble with latency budget
    const metaEnsemble = new MetaEnsemble(this.logger);
    metaEnsemble.enableAdaptiveModelSelection(budgetMs);
    return metaEnsemble.predictWithConfidence(features);
  }
} 