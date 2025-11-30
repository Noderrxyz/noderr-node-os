import { Logger } from 'winston';
// TelemetryBus will be imported from @noderr/telemetry when available
import {
  MarketRegime,
  RegimeTransitionState,
  MarketFeatures,
  RegimeClassification,
  RegimeHistory,
  RegimeClassifierConfig,
  DEFAULT_REGIME_CLASSIFIER_CONFIG
} from './MarketRegimeTypes';

const logger = createLogger('MarketRegimeClassifier');

/**
 * Market Regime Classifier
 * 
 * Detects market regimes using statistical models and machine learning approaches.
 * This classifier identifies different market behaviors across trend, volatility,
 * and liquidity dimensions.
 */
export class MarketRegimeClassifier {
  private static instance: MarketRegimeClassifier | null = null;
  private config: RegimeClassifierConfig;
  private telemetry: TelemetryBus;
  private regimeHistory: Map<string, RegimeHistory> = new Map();
  private pendingTransitions: Map<string, {
    regime: MarketRegime;
    confidence: number;
    count: number;
  }> = new Map();
  
  /**
   * Private constructor for singleton pattern
   */
  private constructor(config: Partial<RegimeClassifierConfig> = {}) {
    this.config = { ...DEFAULT_REGIME_CLASSIFIER_CONFIG, ...config };
    this.telemetry = TelemetryBus.getInstance();
    
    logger.info('MarketRegimeClassifier initialized with config', {
      minimumConfidence: this.config.minimumConfidence,
      trendWindow: this.config.trendWindow,
      volatilityWindow: this.config.volatilityWindow
    });
  }
  
  /**
   * Get singleton instance
   */
  public static getInstance(config: Partial<RegimeClassifierConfig> = {}): MarketRegimeClassifier {
    if (!MarketRegimeClassifier.instance) {
      MarketRegimeClassifier.instance = new MarketRegimeClassifier(config);
    }
    return MarketRegimeClassifier.instance;
  }
  
  /**
   * Classify market regime based on features
   * @param symbol Market symbol (e.g. "BTC/USD")
   * @param features Market features used for classification
   * @returns Regime classification result
   */
  public classifyRegime(symbol: string, features: MarketFeatures): RegimeClassification {
    try {
      const startTime = Date.now();
      
      // Calculate scores for each regime
      const scores = this.calculateRegimeScores(features);
      
      // Find the highest scoring regime
      let primaryRegime = MarketRegime.Unknown;
      let highestScore = -Infinity;
      let secondaryRegime: MarketRegime | null = null;
      let secondHighestScore = -Infinity;
      
      Object.entries(scores).forEach(([regime, score]) => {
        if (score > highestScore) {
          secondHighestScore = highestScore;
          secondaryRegime = primaryRegime;
          highestScore = score;
          primaryRegime = regime as MarketRegime;
        } else if (score > secondHighestScore) {
          secondHighestScore = score;
          secondaryRegime = regime as MarketRegime;
        }
      });
      
      // Calculate confidence as the difference between highest and second highest scores
      // normalized to [0, 1] range
      const confidence = Math.min(1, Math.max(0, 
        (highestScore - secondHighestScore) / 2 + 0.5
      ));
      
      // Determine transition state
      const transitionState = this.determineTransitionState(symbol, primaryRegime, confidence);
      
      // Create result
      const result: RegimeClassification = {
        primaryRegime,
        secondaryRegime: secondaryRegime === MarketRegime.Unknown ? null : secondaryRegime,
        confidence,
        transitionState,
        scores,
        timestamp: Date.now(),
        features
      };
      
      // Update history and handle potential regime transitions
      this.updateHistory(symbol, result);
      
      // Emit telemetry
      if (this.config.emitDetailedTelemetry) {
        this.telemetry.emit('regime.classification', {
          symbol,
          primaryRegime: result.primaryRegime,
          confidence: result.confidence,
          transitionState: result.transitionState,
          elapsedMs: Date.now() - startTime
        });
      }
      
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error in regime classification for ${symbol}: ${errorMessage}`, error);
      
      // Emit error telemetry
      this.telemetry.emit('regime.classification_error', {
        symbol,
        error: errorMessage,
        timestamp: Date.now()
      });
      
      // Return Unknown regime with low confidence
      return {
        primaryRegime: MarketRegime.Unknown,
        secondaryRegime: null,
        confidence: 0.1,
        transitionState: RegimeTransitionState.Ambiguous,
        scores: { [MarketRegime.Unknown]: 1 } as Record<MarketRegime, number>,
        timestamp: Date.now(),
        features
      };
    }
  }
  
  /**
   * Get current regime for a market
   * @param symbol Market symbol
   * @returns Current regime classification or null if no history
   */
  public getCurrentRegime(symbol: string): RegimeClassification | null {
    const history = this.regimeHistory.get(symbol);
    if (!history || history.classifications.length === 0) {
      return null;
    }
    return history.classifications[0];
  }
  
  /**
   * Get current primary regime for a market
   * @param symbol Market symbol
   * @returns Current regime or Unknown if no history
   */
  public getCurrentPrimaryRegime(symbol: string): MarketRegime {
    const current = this.getCurrentRegime(symbol);
    return current ? current.primaryRegime : MarketRegime.Unknown;
  }
  
  /**
   * Get regime history for a market
   * @param symbol Market symbol
   * @returns Regime history or null if no history
   */
  public getRegimeHistory(symbol: string): RegimeHistory | null {
    return this.regimeHistory.get(symbol) || null;
  }
  
  /**
   * Check if regime has changed recently
   * @param symbol Market symbol
   * @param lookbackItems Number of history items to look back
   * @returns True if regime has changed within lookback period
   */
  public hasRegimeChanged(symbol: string, lookbackItems: number = 2): boolean {
    const history = this.regimeHistory.get(symbol);
    if (!history || history.classifications.length < lookbackItems) {
      return false;
    }
    
    const currentRegime = history.classifications[0].primaryRegime;
    
    // Check if any of the previous classifications had a different regime
    for (let i = 1; i < Math.min(lookbackItems, history.classifications.length); i++) {
      if (history.classifications[i].primaryRegime !== currentRegime) {
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * Get all tracked market symbols
   * @returns Array of market symbols
   */
  public getTrackedSymbols(): string[] {
    return Array.from(this.regimeHistory.keys());
  }
  
  /**
   * Reset history for a specific market
   * @param symbol Market symbol
   */
  public resetHistory(symbol: string): void {
    this.regimeHistory.delete(symbol);
    this.pendingTransitions.delete(symbol);
    logger.info(`Reset regime history for ${symbol}`);
  }
  
  /**
   * Reset all history
   */
  public resetAllHistory(): void {
    this.regimeHistory.clear();
    this.pendingTransitions.clear();
    logger.info('Reset all regime history');
  }
  
  /**
   * Update history with a new classification
   * @param symbol Market symbol
   * @param classification New classification
   */
  private updateHistory(symbol: string, classification: RegimeClassification): void {
    // Get or create history object
    let history = this.regimeHistory.get(symbol);
    
    if (!history) {
      history = {
        symbol,
        classifications: [],
        currentRegimeStartTime: classification.timestamp,
        currentRegimeDurationMs: 0,
        transitions: []
      };
      this.regimeHistory.set(symbol, history);
    }
    
    // Check for regime change
    const previousRegime = history.classifications.length > 0 
      ? history.classifications[0].primaryRegime 
      : null;
    
    const isNewRegime = previousRegime !== null && 
                       previousRegime !== classification.primaryRegime;
    
    // If this is a new regime and it has sufficient confidence, record the transition
    if (isNewRegime && classification.confidence >= this.config.transitionConfidenceThreshold) {
      // Add transition record
      const transition = {
        fromRegime: previousRegime!,
        toRegime: classification.primaryRegime,
        detectedAt: classification.timestamp,
        estimatedStartTime: this.estimateTransitionStartTime(symbol, classification),
        confidence: classification.confidence,
        transitionDurationMs: classification.timestamp - history.currentRegimeStartTime
      };
      
      history.transitions.push(transition);
      history.currentRegimeStartTime = classification.timestamp;
      
      // Emit telemetry for regime change
      this.telemetry.emit('regime.transition', {
        symbol,
        from: previousRegime,
        to: classification.primaryRegime,
        confidence: classification.confidence,
        durationMs: transition.transitionDurationMs,
        timestamp: classification.timestamp
      });
      
      logger.info(`Regime transition for ${symbol}: ${previousRegime} -> ${classification.primaryRegime}`, {
        confidence: classification.confidence,
        durationMs: transition.transitionDurationMs
      });
      
      // Clear any pending transitions for this symbol
      this.pendingTransitions.delete(symbol);
    } else if (isNewRegime) {
      // Track potential regime change that doesn't yet meet confidence threshold
      this.trackPendingTransition(symbol, classification);
    }
    
    // Update current regime duration
    history.currentRegimeDurationMs = classification.timestamp - history.currentRegimeStartTime;
    
    // Add classification to history (at the beginning)
    history.classifications.unshift(classification);
    
    // Trim history if needed
    if (history.classifications.length > this.config.maxHistoryItems) {
      history.classifications = history.classifications.slice(0, this.config.maxHistoryItems);
    }
  }
  
  /**
   * Track potential regime transitions that haven't yet met confidence threshold
   */
  private trackPendingTransition(symbol: string, classification: RegimeClassification): void {
    const pendingKey = `${symbol}:${classification.primaryRegime}`;
    const pending = this.pendingTransitions.get(pendingKey);
    
    if (pending) {
      // Update existing pending transition
      pending.confidence = Math.max(pending.confidence, classification.confidence);
      pending.count++;
      
      // Check if we've seen this regime enough times to confirm it
      if (pending.count >= this.config.regimeConfirmationCount) {
        // Force an update with higher confidence to trigger the transition
        const forcedClassification: RegimeClassification = {
          ...classification,
          confidence: Math.max(classification.confidence, this.config.transitionConfidenceThreshold)
        };
        
        this.updateHistory(symbol, forcedClassification);
        this.pendingTransitions.delete(pendingKey);
        
        logger.info(`Confirmed regime transition for ${symbol} to ${classification.primaryRegime} after ${pending.count} observations`);
      }
    } else {
      // Create new pending transition
      this.pendingTransitions.set(pendingKey, {
        regime: classification.primaryRegime,
        confidence: classification.confidence,
        count: 1
      });
    }
  }
  
  /**
   * Determine transition state based on classification history
   */
  private determineTransitionState(
    symbol: string, 
    currentRegime: MarketRegime, 
    confidence: number
  ): RegimeTransitionState {
    // If confidence is too low, regime is ambiguous
    if (confidence < this.config.minimumConfidence) {
      return RegimeTransitionState.Ambiguous;
    }
    
    const history = this.regimeHistory.get(symbol);
    if (!history || history.classifications.length < 2) {
      return confidence >= this.config.transitionConfidenceThreshold 
        ? RegimeTransitionState.Stable 
        : RegimeTransitionState.Developing;
    }
    
    const previousClassification = history.classifications[0];
    
    // Check for regime change
    if (previousClassification.primaryRegime !== currentRegime) {
      // Check if we have multiple consecutive readings in the new regime
      const pendingKey = `${symbol}:${currentRegime}`;
      const pending = this.pendingTransitions.get(pendingKey);
      
      if (pending && pending.count >= 2) {
        return RegimeTransitionState.Transitioning;
      }
      
      return RegimeTransitionState.Developing;
    }
    
    // In the same regime
    // Check for confidence change
    const confidenceDelta = confidence - previousClassification.confidence;
    
    if (confidenceDelta < -0.15) {
      // Significant drop in confidence could indicate developing transition
      return RegimeTransitionState.Developing;
    }
    
    // Otherwise stable
    return RegimeTransitionState.Stable;
  }
  
  /**
   * Estimate when a regime transition may have started
   */
  private estimateTransitionStartTime(symbol: string, classification: RegimeClassification): number {
    const history = this.regimeHistory.get(symbol);
    if (!history || history.classifications.length < 2) {
      return classification.timestamp;
    }
    
    // Look back through recent classifications to find where confidence started dropping
    // or when mixed signals began appearing
    const classifications = history.classifications;
    let maxConfidence = classifications[0].confidence;
    let changePoint = 0;
    
    for (let i = 1; i < classifications.length; i++) {
      if (classifications[i].confidence > maxConfidence) {
        maxConfidence = classifications[i].confidence;
        changePoint = i;
      } else if (maxConfidence - classifications[i].confidence > 0.15) {
        // Found a significant confidence drop
        return classifications[i].timestamp;
      }
    }
    
    // If no clear drop, use most recent high confidence point
    return classifications[changePoint].timestamp;
  }
  
  /**
   * Calculate scores for each regime based on market features
   */
  private calculateRegimeScores(features: MarketFeatures): Record<MarketRegime, number> {
    // Initialize scores
    const scores: Record<MarketRegime, number> = {} as Record<MarketRegime, number>;
    
    // Calculate scores for each regime type
    scores[MarketRegime.BullishTrend] = this.calculateBullishTrendScore(features);
    scores[MarketRegime.BearishTrend] = this.calculateBearishTrendScore(features);
    scores[MarketRegime.Rangebound] = this.calculateRangeboundScore(features);
    scores[MarketRegime.MeanReverting] = this.calculateMeanRevertingScore(features);
    scores[MarketRegime.HighVolatility] = this.calculateHighVolatilityScore(features);
    scores[MarketRegime.LowVolatility] = this.calculateLowVolatilityScore(features);
    scores[MarketRegime.HighLiquidity] = this.calculateHighLiquidityScore(features);
    scores[MarketRegime.LowLiquidity] = this.calculateLowLiquidityScore(features);
    scores[MarketRegime.MarketStress] = this.calculateMarketStressScore(features);
    
    // Calculate combined regimes
    scores[MarketRegime.BullVolatile] = (scores[MarketRegime.BullishTrend] + scores[MarketRegime.HighVolatility]) / 2;
    scores[MarketRegime.BearVolatile] = (scores[MarketRegime.BearishTrend] + scores[MarketRegime.HighVolatility]) / 2;
    scores[MarketRegime.RangeboundLowVol] = (scores[MarketRegime.Rangebound] + scores[MarketRegime.LowVolatility]) / 2;
    
    // Add a small score for Unknown to avoid it having exactly 0
    scores[MarketRegime.Unknown] = 0.05;
    
    return scores;
  }
  
  /**
   * Calculate bullish trend score
   */
  private calculateBullishTrendScore(features: MarketFeatures): number {
    // Positive returns
    const returnScore = (features.returns5d + (features.returns20d * 2)) / 3;
    
    // RSI reading
    const rsiScore = Math.min(1, features.rsi14 / 100);
    
    // MACD and other trend indicators
    const macdScore = features.macdHistogram > 0 ? 
                      Math.min(1, features.macdHistogram) : 0;
    
    // Higher weight to recent returns and MACD
    const score = (returnScore * 0.4) + (rsiScore * 0.3) + (macdScore * 0.3);
    
    return Math.max(0, Math.min(1, score));
  }
  
  /**
   * Calculate bearish trend score
   */
  private calculateBearishTrendScore(features: MarketFeatures): number {
    // Negative returns
    const returnScore = Math.min(1, Math.max(0, -features.returns20d)) * 0.7 + 
                      Math.min(1, Math.max(0, -features.returns5d)) * 0.3;
    
    // Low RSI reading
    const rsiScore = Math.max(0, 1 - (features.rsi14 / 50));
    
    // Negative MACD
    const macdScore = features.macdHistogram < 0 ? 
                      Math.min(1, -features.macdHistogram) : 0;
    
    // Higher weight to recent returns and MACD
    const score = (returnScore * 0.4) + (rsiScore * 0.3) + (macdScore * 0.3);
    
    return Math.max(0, Math.min(1, score));
  }
  
  /**
   * Calculate rangebound score
   */
  private calculateRangeboundScore(features: MarketFeatures): number {
    // Near-zero returns over longer timeframe
    const trendlessScore = 1 - Math.min(1, Math.abs(features.returns20d) * 10);
    
    // Balanced RSI (around the midpoint)
    const rsiBalanceScore = 1 - Math.min(1, Math.abs(features.rsi14 - 50) / 20);
    
    // Narrow Bollinger Bands indicating low volatility
    const bandwidthScore = Math.min(1, features.bbWidth);
    
    // Short-term mean reversion
    const meanReversionScore = Math.min(1, Math.max(0, 
      (features.returns1d > 0 && features.returns5d < 0) || 
      (features.returns1d < 0 && features.returns5d > 0) ? 1 : 0
    ));
    
    const score = (trendlessScore * 0.3) + 
                (rsiBalanceScore * 0.2) + 
                (bandwidthScore * 0.2) + 
                (meanReversionScore * 0.3);
    
    return Math.max(0, Math.min(1, score));
  }
  
  /**
   * Calculate mean reverting score
   */
  private calculateMeanRevertingScore(features: MarketFeatures): number {
    // Calculate level of reversion
    // Look for returns that move in opposite directions
    const shortReversion = (features.returns1d > 0 && features.returns5d < 0) || 
                         (features.returns1d < 0 && features.returns5d > 0);
    
    const mediumReversion = (features.returns5d > 0 && features.returns20d < 0) || 
                          (features.returns5d < 0 && features.returns20d > 0);
    
    const reversionScore = (shortReversion ? 0.6 : 0) + (mediumReversion ? 0.4 : 0);
    
    // RSI extremes that tend to revert
    const rsiReversionScore = 
      features.rsi14 > 70 ? 0.8 :  // Overbought
      features.rsi14 < 30 ? 0.8 :  // Oversold
      0;
    
    // Market breadth showing potential reversals
    const breadthScore = features.advanceDeclineRatio 
      ? Math.min(1, Math.abs(features.advanceDeclineRatio - 1))
      : 0.5;
    
    const score = (reversionScore * 0.5) + 
                (rsiReversionScore * 0.3) + 
                (breadthScore * 0.2);
    
    return Math.max(0, Math.min(1, score));
  }
  
  /**
   * Calculate high volatility score
   */
  private calculateHighVolatilityScore(features: MarketFeatures): number {
    // ATR indicates higher volatility
    const atrScore = Math.min(1, features.atr14 / 5);
    
    // Wide Bollinger Bands
    const bandwidthScore = Math.min(1, features.bbWidth);
    
    // Recent volatility readings
    const volScore = Math.min(1, (features.volatility5d / 0.05) * 0.7) + 
                   Math.min(1, (features.volatility1d / 0.03) * 0.3);
    
    // VIX or equivalent if available
    const vixScore = features.vix ? Math.min(1, features.vix / 30) : 0.5;
    
    // Higher weight to actual volatility measurements
    const score = (atrScore * 0.2) + 
                (bandwidthScore * 0.2) + 
                (volScore * 0.5) + 
                (vixScore * 0.1);
    
    return Math.max(0, Math.min(1, score));
  }
  
  /**
   * Calculate low volatility score
   */
  private calculateLowVolatilityScore(features: MarketFeatures): number {
    // Inverse of high volatility indicators
    const atrScore = Math.max(0, 1 - features.atr14 / 2);
    
    // Narrow Bollinger Bands
    const bandwidthScore = Math.max(0, 1 - features.bbWidth * 2);
    
    // Low recent volatility
    const volScore = Math.max(0, 1 - features.volatility5d / 0.02) * 0.7 + 
                   Math.max(0, 1 - features.volatility1d / 0.01) * 0.3;
    
    // Low VIX if available
    const vixScore = features.vix ? Math.max(0, 1 - features.vix / 20) : 0.5;
    
    const score = (atrScore * 0.2) + 
                (bandwidthScore * 0.2) + 
                (volScore * 0.5) + 
                (vixScore * 0.1);
    
    return Math.max(0, Math.min(1, score));
  }
  
  /**
   * Calculate high liquidity score
   */
  private calculateHighLiquidityScore(features: MarketFeatures): number {
    // Use volumeRatio instead of volumeRatio1d/5d
    const volumeScore = Math.min(1, features.volumeRatio);
    
    // Consistent volume above average
    const consistencyScore = features.volumeMA20 > 0 
      ? Math.min(1, features.volumeRatio)
      : 0.5;
    
    const score = (volumeScore * 0.6) + (consistencyScore * 0.4);
    
    return Math.max(0, Math.min(1, score));
  }
  
  /**
   * Calculate low liquidity score
   */
  private calculateLowLiquidityScore(features: MarketFeatures): number {
    // Use volumeRatio instead of volumeRatio1d/5d
    const volumeScore = Math.max(0, 1 - features.volumeRatio);
    
    // Volume below average
    const consistencyScore = features.volumeMA20 > 0
      ? Math.max(0, 1 - features.volumeRatio)
      : 0.5;
    
    const score = (volumeScore * 0.6) + (consistencyScore * 0.4);
    
    return Math.max(0, Math.min(1, score));
  }
  
  /**
   * Calculate market stress score
   */
  private calculateMarketStressScore(features: MarketFeatures): number {
    // High volatility is a component of market stress
    const volatilityScore = this.calculateHighVolatilityScore(features);
    
    // Sharp negative returns
    const returnScore = Math.min(1, Math.max(0, -features.returns5d * 3));
    
    // Extreme RSI (especially oversold)
    const rsiScore = features.rsi14 < 30 ? (30 - features.rsi14) / 30 : 0;
    
    // VIX spike if available
    const vixScore = features.vix ? Math.min(1, features.vix / 35) : 0;
    
    const score = (volatilityScore * 0.3) + 
                (returnScore * 0.4) + 
                (rsiScore * 0.2) + 
                (vixScore * 0.1);
    
    return Math.max(0, Math.min(1, score));
  }
} 