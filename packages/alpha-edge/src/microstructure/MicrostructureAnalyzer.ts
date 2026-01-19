/**
 * Advanced Market Microstructure Analyzer
 * 

 * detecting real liquidity, and generating alpha signals from
 * market microstructure patterns.
 */

import { EventEmitter } from 'events';
import { number } from 'ethers';
import { 
  OrderBookSnapshot, 
  OrderBookLevel,
  OrderFlowImbalance,
  MicrostructureSignal,
  LiquidityMap,
  VolatilityForecast
} from '@noderr/types';

interface MicrostructureConfig {
  updateFrequency: number; // milliseconds
  orderBookDepth: number; // levels to analyze
  flowWindowSize: number; // samples for flow analysis
  liquidityDecayFactor: number; // 0-1
  spoofDetectionSensitivity: number; // 0-1
  volatilityLookback: number; // minutes
  signalThreshold: number; // minimum strength to emit
}

interface OrderBookMetrics {
  spread: number;
  midPrice: number;
  microPrice: number; // size-weighted mid
  bookImbalance: number;
  depthImbalance: number;
  resilience: number;
  toxicity: number;
}

export class MicrostructureAnalyzer extends EventEmitter {
  private config: MicrostructureConfig;
  private orderBooks: Map<string, OrderBookSnapshot[]> = new Map();
  private orderFlowHistory: Map<string, number[]> = new Map();
  private liquidityMaps: Map<string, LiquidityMap> = new Map();
  private volatilityCache: Map<string, number[]> = new Map();
  private signalBuffer: MicrostructureSignal[] = [];
  
  constructor(config: Partial<MicrostructureConfig> = {}) {
    super();
    
    this.config = {
      updateFrequency: 100, // 100ms updates
      orderBookDepth: 20,
      flowWindowSize: 1000,
      liquidityDecayFactor: 0.95,
      spoofDetectionSensitivity: 0.8,
      volatilityLookback: 60, // 1 hour
      signalThreshold: 0.7,
      ...config
    };
  }

  /**
   * Process new order book snapshot
   */
  async processOrderBook(snapshot: OrderBookSnapshot): Promise<void> {
    const symbol = snapshot.symbol;
    
    // Store snapshot history
    if (!this.orderBooks.has(symbol)) {
      this.orderBooks.set(symbol, []);
    }
    const history = this.orderBooks.get(symbol)!;
    history.push(snapshot);
    
    // Maintain rolling window
    if (history.length > this.config.flowWindowSize) {
      history.shift();
    }
    
    // Analyze order book
    const metrics = this.calculateOrderBookMetrics(snapshot);
    
    // Detect order flow imbalance
    const flowImbalance = this.analyzeOrderFlow(symbol, snapshot);
    
    // Update liquidity map
    const liquidityMap = this.updateLiquidityMap(symbol, snapshot);
    
    // Detect microstructure signals
    const signals = await this.detectSignals(symbol, metrics, flowImbalance);
    
    // Emit high-confidence signals
    for (const signal of signals) {
      if (signal.strength >= this.config.signalThreshold) {
        this.emit('signal', signal);
        this.signalBuffer.push(signal);
      }
    }
    
    // Update metrics
    this.emit('metrics', {
      symbol,
      metrics,
      flowImbalance,
      liquidityMap
    });
  }

  /**
   * Calculate comprehensive order book metrics
   */
  private calculateOrderBookMetrics(snapshot: OrderBookSnapshot): OrderBookMetrics {
    const { bids, asks } = snapshot;
    
    if (bids.length === 0 || asks.length === 0) {
      throw new Error('Invalid order book snapshot');
    }
    
    // Basic metrics
    const bestBid = bids[0]!.price;
    const bestAsk = asks[0]!.price;
    const spread = bestAsk - bestBid;
    const midPrice = (bestBid + bestAsk) / 2;
    
    // Microprice (size-weighted mid)
    const bidSize = bids[0]!.quantity;
    const askSize = asks[0]!.quantity;
    const microPrice = (bestBid * askSize + bestAsk * bidSize) / (bidSize + askSize);
    
    // Book imbalance (top level)
    const bookImbalance = (bidSize - askSize) / (bidSize + askSize);
    
    // Depth imbalance (multiple levels)
    const depthLevels = Math.min(5, bids.length, asks.length);
    let bidDepth = 0;
    let askDepth = 0;
    
    for (let i = 0; i < depthLevels; i++) {
      bidDepth += bids[i]!.quantity * Math.exp(-i * 0.2); // Decay factor
      askDepth += asks[i]!.quantity * Math.exp(-i * 0.2);
    }
    
    const depthImbalance = (bidDepth - askDepth) / (bidDepth + askDepth);
    
    // Book resilience (how quickly liquidity replenishes)
    const resilience = this.calculateResilience(snapshot);
    
    // Toxicity score (likelihood of adverse selection)
    const toxicity = this.calculateToxicity(snapshot);
    
    return {
      spread,
      midPrice,
      microPrice,
      bookImbalance,
      depthImbalance,
      resilience,
      toxicity
    };
  }

  /**
   * Analyze order flow patterns
   */
  private analyzeOrderFlow(symbol: string, snapshot: OrderBookSnapshot): OrderFlowImbalance {
    const history = this.orderBooks.get(symbol) || [];
    
    if (history.length < 2) {
      return {
        ratio: 0,
        buyPressure: 0,
        sellPressure: 0,
        netFlow: 0,
        confidence: 0
      };
    }
    
    // Calculate flow metrics
    let buyVolume = 0;
    let sellVolume = 0;
    let buyCount = 0;
    let sellCount = 0;
    
    // Analyze trades (approximated from order book changes)
    for (let i = 1; i < Math.min(history.length, 100); i++) {
      const prev = history[i - 1]!;
      const curr = history[i]!;
      
      // Detect trades by price movement
      if (curr.bids[0]!.price > prev.bids[0]!.price) {
        // Buy pressure
        buyVolume += curr.asks[0]!.quantity - prev.asks[0]!.quantity;
        buyCount++;
      } else if (curr.asks[0]!.price < prev.asks[0]!.price) {
        // Sell pressure
        sellVolume += curr.bids[0]!.quantity - prev.bids[0]!.quantity;
        sellCount++;
      }
    }
    
    const totalVolume = buyVolume + sellVolume;
    const netFlow = buyVolume - sellVolume;
    const flowRatio = totalVolume > 0 ? buyVolume / totalVolume : 0.5;
    
    // Kyle's lambda (price impact coefficient)
    const lambda = this.calculateKyleLambda(history);
    
    // Confidence based on sample size and consistency
    const confidence = Math.min(1, history.length / 100) * 
                      (1 - Math.abs(flowRatio - 0.5) * 2) * 
                      (1 - lambda);
    
    return {
      ratio: flowRatio,
      buyPressure: buyVolume,
      sellPressure: sellVolume,
      netFlow,
      confidence
    };
  }

  /**
   * Update liquidity map with spoof detection
   */
  private updateLiquidityMap(symbol: string, snapshot: OrderBookSnapshot): LiquidityMap {
    const existing = this.liquidityMaps.get(symbol);
    const levels: LiquidityMap['levels'] = [];
    
    // Analyze each price level
    const allLevels = [...snapshot.bids, ...snapshot.asks]
      .sort((a, b) => Math.abs(a.price - snapshot.bids[0]!.price) - 
                      Math.abs(b.price - snapshot.bids[0]!.price));
    
    for (const level of allLevels.slice(0, this.config.orderBookDepth)) {
      const spoofProb = this.calculateSpoofProbability(symbol, level);
      const stability = this.calculateLevelStability(symbol, level.price);
      const realLiquidity = level.quantity * (1 - spoofProb) * stability;
      
      levels.push({
        price: level.price,
        realLiquidity,
        spoofProbability: spoofProb,
        stability
      });
    }
    
    const map: LiquidityMap = {
      levels,
      venueName: snapshot.venue,
      lastUpdate: Date.now()
    };
    
    this.liquidityMaps.set(symbol, map);
    return map;
  }

  /**
   * Detect microstructure signals
   */
  private async detectSignals(
    symbol: string,
    metrics: OrderBookMetrics,
    flow: OrderFlowImbalance
  ): Promise<MicrostructureSignal[]> {
    const signals: MicrostructureSignal[] = [];
    const history = this.orderBooks.get(symbol) || [];
    
    if (history.length < 10) return signals;
    
    // 1. Liquidity Shift Detection
    const liquidityShift = this.detectLiquidityShift(symbol, metrics);
    if (liquidityShift) signals.push(liquidityShift);
    
    // 2. Price Discovery Signal
    const priceDiscovery = this.detectPriceDiscovery(symbol, metrics, flow);
    if (priceDiscovery) signals.push(priceDiscovery);
    
    // 3. Momentum Change Detection
    const momentumChange = this.detectMomentumChange(symbol, flow);
    if (momentumChange) signals.push(momentumChange);
    
    // 4. Regime Shift Detection
    const regimeShift = await this.detectRegimeShift(symbol);
    if (regimeShift) signals.push(regimeShift);
    
    return signals;
  }

  /**
   * Detect liquidity shifts
   */
  private detectLiquidityShift(symbol: string, metrics: OrderBookMetrics): MicrostructureSignal | null {
    const history = this.orderBooks.get(symbol) || [];
    if (history.length < 50) return null;
    
    // Calculate liquidity metrics over time
    const recentLiquidity = history.slice(-10).reduce((sum, book) => {
      return sum + book.bids.slice(0, 5).reduce((s, l) => s + l.quantity, 0) +
                   book.asks.slice(0, 5).reduce((s, l) => s + l.quantity, 0);
    }, 0) / 10;
    
    const historicalLiquidity = history.slice(-50, -10).reduce((sum, book) => {
      return sum + book.bids.slice(0, 5).reduce((s, l) => s + l.quantity, 0) +
                   book.asks.slice(0, 5).reduce((s, l) => s + l.quantity, 0);
    }, 0) / 40;
    
    const liquidityRatio = recentLiquidity / historicalLiquidity;
    const isSignificant = liquidityRatio < 0.7 || liquidityRatio > 1.3;
    
    if (!isSignificant) return null;
    
    return {
      type: 'liquidity_shift',
      strength: Math.min(1, Math.abs(1 - liquidityRatio)),
      direction: liquidityRatio > 1 ? 'bullish' : 'bearish',
      timeframe: 5000, // 5 seconds
      components: {
        orderbook: 0.8,
        trades: 0.1,
        volatility: 0.05,
        correlation: 0.05
      }
    };
  }

  /**
   * Detect price discovery patterns
   */
  private detectPriceDiscovery(
    symbol: string, 
    metrics: OrderBookMetrics,
    flow: OrderFlowImbalance
  ): MicrostructureSignal | null {
    // Price discovery occurs when microprice leads midprice
    const priceLead = (metrics.microPrice - metrics.midPrice) / metrics.spread;
    
    // Strong order flow in same direction
    const flowAlignment = priceLead * flow.netFlow > 0;
    
    // Low toxicity indicates informed flow
    const informedFlow = metrics.toxicity < 0.3;
    
    if (Math.abs(priceLead) > 0.2 && flowAlignment && informedFlow) {
      return {
        type: 'price_discovery',
        strength: Math.min(1, Math.abs(priceLead) * 2),
        direction: priceLead > 0 ? 'bullish' : 'bearish',
        timeframe: 1000, // 1 second
        components: {
          orderbook: 0.5,
          trades: 0.3,
          volatility: 0.1,
          correlation: 0.1
        }
      };
    }
    
    return null;
  }

  /**
   * Detect momentum changes
   */
  private detectMomentumChange(symbol: string, flow: OrderFlowImbalance): MicrostructureSignal | null {
    const flowHistory = this.orderFlowHistory.get(symbol) || [];
    flowHistory.push(flow.ratio);
    
    if (flowHistory.length > 100) {
      flowHistory.shift();
    }
    
    this.orderFlowHistory.set(symbol, flowHistory);
    
    if (flowHistory.length < 20) return null;
    
    // Calculate momentum indicators
    const recentMomentum = flowHistory.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const previousMomentum = flowHistory.slice(-20, -5).reduce((a, b) => a + b, 0) / 15;
    
    const momentumChange = recentMomentum - previousMomentum;
    const isSignificant = Math.abs(momentumChange) > 0.2;
    
    if (!isSignificant) return null;
    
    return {
      type: 'momentum_change',
      strength: Math.min(1, Math.abs(momentumChange) * 2),
      direction: momentumChange > 0 ? 'bullish' : 'bearish',
      timeframe: 10000, // 10 seconds
      components: {
        orderbook: 0.2,
        trades: 0.6,
        volatility: 0.1,
        correlation: 0.1
      }
    };
  }

  /**
   * Detect regime shifts using advanced statistics
   */
  private async detectRegimeShift(symbol: string): Promise<MicrostructureSignal | null> {
    const history = this.orderBooks.get(symbol) || [];
    if (history.length < 200) return null;
    
    // Calculate rolling volatility
    const volatilities: number[] = [];
    for (let i = 20; i < history.length; i++) {
      const window = history.slice(i - 20, i);
      const returns = window.slice(1).map((book, idx) => {
        const prevMid = (window[idx]!.bids[0]!.price + window[idx]!.asks[0]!.price) / 2;
        const currMid = (book.bids[0]!.price + book.asks[0]!.price) / 2;
        return Math.log(currMid / prevMid);
      });
      
      const vol = Math.sqrt(returns.reduce((sum, r) => sum + r * r, 0) / returns.length) * Math.sqrt(252 * 24 * 60 * 60 * 10); // Annualized
      volatilities.push(vol);
    }
    
    // Detect volatility regime change
    const recentVol = volatilities.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const historicalVol = volatilities.slice(-100, -20).reduce((a, b) => a + b, 0) / 80;
    
    const volRatio = recentVol / historicalVol;
    const regimeChange = volRatio > 1.5 || volRatio < 0.67;
    
    if (!regimeChange) return null;
    
    return {
      type: 'regime_shift',
      strength: Math.min(1, Math.abs(Math.log(volRatio))),
      direction: 'neutral', // Regime shifts are directionally neutral
      timeframe: 60000, // 1 minute
      components: {
        orderbook: 0.3,
        trades: 0.2,
        volatility: 0.4,
        correlation: 0.1
      }
    };
  }

  /**
   * Get real liquidity assessment
   */
  async detectRealLiquidity(symbol: string): Promise<LiquidityMap> {
    const existing = this.liquidityMaps.get(symbol);
    if (existing && Date.now() - existing.lastUpdate < 1000) {
      return existing;
    }
    
    // Force update if stale
    const latestBook = this.orderBooks.get(symbol)?.[this.orderBooks.get(symbol)!.length - 1];
    if (latestBook) {
      return this.updateLiquidityMap(symbol, latestBook);
    }
    
    throw new Error(`No order book data for ${symbol}`);
  }

  /**
   * Predict volatility regimes
   */
  async predictVolatilityRegimes(symbol: string): Promise<VolatilityForecast> {
    const history = this.orderBooks.get(symbol) || [];
    
    if (history.length < 100) {
      throw new Error('Insufficient data for volatility prediction');
    }
    
    // Calculate current volatility
    const returns = history.slice(-60).map((book, idx, arr) => {
      if (idx === 0) return 0;
      const prevMid = (arr[idx - 1]!.bids[0]!.price + arr[idx - 1]!.asks[0]!.price) / 2;
      const currMid = (book.bids[0]!.price + book.asks[0]!.price) / 2;
      return Math.log(currMid / prevMid);
    }).slice(1);
    
    const currentVol = Math.sqrt(returns.reduce((sum, r) => sum + r * r, 0) / returns.length) * 
                       Math.sqrt(252 * 24 * 60 * 60 * 10); // Annualized
    
    // GARCH-style volatility prediction
    const predictions = this.garchPredict(returns);
    
    // Determine regime
    let regime: VolatilityForecast['regime'] = 'normal';
    if (currentVol < 0.1) regime = 'low';
    else if (currentVol > 0.5) regime = 'high';
    else if (currentVol > 1) regime = 'extreme';
    
    // Identify volatility drivers
    const drivers: string[] = [];
    if (Math.abs(history[history.length - 1]!.bids[0]!.quantity - 
                 history[history.length - 10]!.bids[0]!.quantity) > 1000) {
      drivers.push('liquidity_change');
    }
    if (this.detectNewsFlow(symbol)) {
      drivers.push('news_flow');
    }
    if (this.detectWhaleActivity(symbol)) {
      drivers.push('whale_activity');
    }
    
    return {
      symbol,
      currentVolatility: currentVol,
      predictedVolatility: {
        '1min': predictions[0] || currentVol,
        '5min': predictions[1] || currentVol,
        '15min': predictions[2] || currentVol,
        '1hour': predictions[3] || currentVol
      },
      regime,
      confidence: Math.min(1, history.length / 1000),
      drivers
    };
  }

  /**
   * Optimize execution timing based on microstructure
   */
  async optimizeExecutionTiming(
    symbol: string,
    orderSize: number,
    side: 'buy' | 'sell'
  ): Promise<{ optimalDelay: number; expectedImpact: number }> {
    const metrics = await this.getLatestMetrics(symbol);
    const liquidity = await this.detectRealLiquidity(symbol);
    
    // Calculate expected market impact
    const totalLiquidity = liquidity.levels
      .filter(l => side === 'buy' ? l.price > metrics.midPrice : l.price < metrics.midPrice)
      .reduce((sum, l) => sum + l.realLiquidity, 0);
    
    const expectedImpact = this.calculateMarketImpact(orderSize, totalLiquidity);
    
    // Optimal timing based on liquidity replenishment rate
    const replenishmentRate = metrics.resilience;
    const optimalDelay = Math.min(5000, (orderSize / totalLiquidity) * 10000 / replenishmentRate);
    
    return {
      optimalDelay: Math.round(optimalDelay),
      expectedImpact
    };
  }

  /**
   * Identify structural inefficiencies
   */
  async identifyStructuralInefficiencies(symbol: string): Promise<any[]> {
    const inefficiencies: any[] = [];
    const history = this.orderBooks.get(symbol) || [];
    
    if (history.length < 100) return inefficiencies;
    
    // 1. Persistent spread inefficiencies
    const spreads = history.map(book => 
      book.asks[0]!.price - book.bids[0]!.price
    );
    const avgSpread = spreads.reduce((a, b) => a + b, 0) / spreads.length;
    const theoreticalSpread = this.calculateTheoreticalSpread(symbol);
    
    if (avgSpread > theoreticalSpread * 1.2) {
      inefficiencies.push({
        type: 'excessive_spread',
        magnitude: avgSpread / theoreticalSpread,
        opportunity: 'market_making'
      });
    }
    
    // 2. Order book asymmetry
    const asymmetry = history.map(book => {
      const bidDepth = book.bids.slice(0, 5).reduce((s, l) => s + l.quantity, 0);
      const askDepth = book.asks.slice(0, 5).reduce((s, l) => s + l.quantity, 0);
      return (bidDepth - askDepth) / (bidDepth + askDepth);
    });
    
    const persistentAsymmetry = Math.abs(asymmetry.reduce((a, b) => a + b, 0) / asymmetry.length);
    if (persistentAsymmetry > 0.2) {
      inefficiencies.push({
        type: 'persistent_asymmetry',
        magnitude: persistentAsymmetry,
        direction: persistentAsymmetry > 0 ? 'bid_heavy' : 'ask_heavy',
        opportunity: 'directional_liquidity_provision'
      });
    }
    
    // 3. Price level clustering
    const priceClusters = this.detectPriceClusters(history);
    if (priceClusters.length > 0) {
      inefficiencies.push({
        type: 'price_clustering',
        clusters: priceClusters,
        opportunity: 'limit_order_placement'
      });
    }
    
    return inefficiencies;
  }

  // ========== HELPER METHODS ==========

  private calculateResilience(snapshot: OrderBookSnapshot): number {
    // Measure how quickly liquidity replenishes
    // Higher = more resilient market
    const depth = snapshot.bids.length + snapshot.asks.length;
    const totalVolume = [...snapshot.bids, ...snapshot.asks]
      .reduce((sum, level) => sum + level.quantity, 0);
    
    return Math.min(1, (depth * totalVolume) / 100000);
  }

  private calculateToxicity(snapshot: OrderBookSnapshot): number {
    // Estimate probability of adverse selection
    // Based on order book shape and recent price movements
    const spread = snapshot.asks[0]!.price - snapshot.bids[0]!.price;
    const midPrice = (snapshot.asks[0]!.price + snapshot.bids[0]!.price) / 2;
    const relativeSpread = spread / midPrice;
    
    // Wider spreads indicate higher toxicity
    return Math.min(1, relativeSpread * 100);
  }

  private calculateKyleLambda(history: OrderBookSnapshot[]): number {
    // Kyle's lambda measures price impact per unit volume
    if (history.length < 10) return 0;
    
    const priceChanges: number[] = [];
    const volumes: number[] = [];
    
    for (let i = 1; i < history.length; i++) {
      const prevMid = (history[i - 1]!.bids[0]!.price + history[i - 1]!.asks[0]!.price) / 2;
      const currMid = (history[i]!.bids[0]!.price + history[i]!.asks[0]!.price) / 2;
      
      priceChanges.push(Math.abs(currMid - prevMid));
      volumes.push(history[i]!.bids[0]!.quantity + history[i]!.asks[0]!.quantity);
    }
    
    // Simple linear regression
    const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
    const avgPriceChange = priceChanges.reduce((a, b) => a + b, 0) / priceChanges.length;
    
    return avgVolume > 0 ? avgPriceChange / avgVolume : 0;
  }

  private calculateSpoofProbability(symbol: string, level: OrderBookLevel): number {
    const history = this.orderBooks.get(symbol) || [];
    if (history.length < 20) return 0;
    
    // Check if this price level appears and disappears frequently
    let appearances = 0;
    let disappearances = 0;
    
    for (let i = 1; i < history.length; i++) {
      const prevLevels = [...history[i - 1]!.bids, ...history[i - 1]!.asks];
      const currLevels = [...history[i]!.bids, ...history[i]!.asks];
      
      const prevHasLevel = prevLevels.some(l => 
        Math.abs(l.price - level.price) < 0.0001 && l.quantity > level.quantity * 0.8
      );
      const currHasLevel = currLevels.some(l => 
        Math.abs(l.price - level.price) < 0.0001 && l.quantity > level.quantity * 0.8
      );
      
      if (!prevHasLevel && currHasLevel) appearances++;
      if (prevHasLevel && !currHasLevel) disappearances++;
    }
    
    // High appearance/disappearance ratio indicates spoofing
    const flickerRate = (appearances + disappearances) / history.length;
    return Math.min(1, flickerRate * 5);
  }

  private calculateLevelStability(symbol: string, price: number): number {
    const history = this.orderBooks.get(symbol) || [];
    if (history.length < 10) return 0.5;
    
    // Check how long liquidity persists at this level
    let persistenceCount = 0;
    
    for (const book of history.slice(-10)) {
      const hasLevel = [...book.bids, ...book.asks].some(l => 
        Math.abs(l.price - price) < 0.0001 && l.quantity > 0
      );
      if (hasLevel) persistenceCount++;
    }
    
    return persistenceCount / 10;
  }

  private garchPredict(returns: number[]): number[] {
    // Simplified GARCH(1,1) volatility prediction
    const omega = 0.00001;
    const alpha = 0.1;
    const beta = 0.85;
    
    let vol = Math.sqrt(returns.reduce((sum, r) => sum + r * r, 0) / returns.length);
    const predictions: number[] = [];
    
    // Predict for different horizons
    const horizons = [10, 50, 150, 600]; // in 100ms units
    
    for (const horizon of horizons) {
      let predictedVol = vol;
      for (let i = 0; i < horizon; i++) {
        predictedVol = Math.sqrt(omega + alpha * Math.pow(returns[returns.length - 1] || 0, 2) + 
                                beta * Math.pow(predictedVol, 2));
      }
      predictions.push(predictedVol * Math.sqrt(252 * 24 * 60 * 60 * 10)); // Annualized
    }
    
    return predictions;
  }

  private detectNewsFlow(symbol: string): boolean {
    // Placeholder for news detection logic
    // In production, this would integrate with news APIs
    return Math.random() < 0.1;
  }

  private detectWhaleActivity(symbol: string): boolean {
    const history = this.orderBooks.get(symbol) || [];
    if (history.length < 2) return false;
    
    // Detect sudden large orders
    const recent = history[history.length - 1]!;
    const previous = history[history.length - 2]!;
    
    const recentMaxSize = Math.max(
      ...recent.bids.map(l => l.quantity),
      ...recent.asks.map(l => l.quantity)
    );
    const previousMaxSize = Math.max(
      ...previous.bids.map(l => l.quantity),
      ...previous.asks.map(l => l.quantity)
    );
    
    return recentMaxSize > previousMaxSize * 5;
  }

  private async getLatestMetrics(symbol: string): Promise<OrderBookMetrics> {
    const history = this.orderBooks.get(symbol) || [];
    if (history.length === 0) {
      throw new Error(`No data for ${symbol}`);
    }
    
    return this.calculateOrderBookMetrics(history[history.length - 1]!);
  }

  private calculateMarketImpact(orderSize: number, liquidity: number): number {
    // Square-root market impact model
    const lambda = 0.01; // Impact coefficient
    return lambda * Math.sqrt(orderSize / liquidity);
  }

  private calculateTheoreticalSpread(symbol: string): number {
    // Theoretical spread based on volatility and volume
    const vol = 0.02; // Placeholder
    const volume = 1000000; // Placeholder
    
    return 2 * vol / Math.sqrt(volume);
  }

  private detectPriceClusters(history: OrderBookSnapshot[]): number[] {
    // Detect psychological price levels where liquidity clusters
    const allPrices: number[] = [];
    
    for (const book of history) {
      allPrices.push(...book.bids.map(l => l.price));
      allPrices.push(...book.asks.map(l => l.price));
    }
    
    // Find round number clusters
    const clusters: number[] = [];
    const roundLevels = [1, 5, 10, 25, 50, 100];
    
    for (const level of roundLevels) {
      const clusterCount = allPrices.filter(p => p % level === 0).length;
      if (clusterCount > allPrices.length * 0.1) {
        clusters.push(level);
      }
    }
    
    return clusters;
  }
} 