import { Logger } from '@noderr/utils/src';
import { EventEmitter } from 'events';
import {
  OrderBook,
  OrderBookLevel,
  OrderBookMetrics,
  DepthAnalysis,
  PriceLevel,
  LiquidityPocket,
  ImbalanceZone,
  SpoofingAlert,
  LargeOrder,
  DirectionPrediction,
  OrderBookConfig,
  TelemetryClient,
  MarketIntelTelemetryEvent
} from './types';

const logger = new Logger('OrderBookAnalyzer');
export class OrderBookAnalyzer extends EventEmitter {
  private config: OrderBookConfig;
  private telemetry: TelemetryClient;
  private orderBookHistory: Map<string, OrderBook[]>;
  private spoofingDetector: SpoofingDetector;
  private microstructureAnalyzer: MicrostructureAnalyzer;
  private liquidityAnalyzer: LiquidityAnalyzer;
  private readonly MAX_HISTORY_SIZE = 1000;

  constructor(config: OrderBookConfig, telemetry: TelemetryClient) {
    super();
    this.config = config;
    this.telemetry = telemetry;
    this.orderBookHistory = new Map();
    this.spoofingDetector = new SpoofingDetector(config);
    this.microstructureAnalyzer = new MicrostructureAnalyzer();
    this.liquidityAnalyzer = new LiquidityAnalyzer();
  }

  async analyzeOrderBook(orderBook: OrderBook): Promise<{
    metrics: OrderBookMetrics;
    depthAnalysis: DepthAnalysis;
    spoofingAlerts: SpoofingAlert[];
    largeOrders: LargeOrder[];
    prediction: DirectionPrediction;
  }> {
    const startTime = Date.now();

    try {
      // Update history
      this.updateHistory(orderBook);

      // Calculate metrics
      const metrics = this.calculateMetrics(orderBook);

      // Analyze depth
      const depthAnalysis = this.analyzeDepth(orderBook);

      // Detect spoofing
      const spoofingAlerts = await this.spoofingDetector.detectSpoofing(
        orderBook,
        this.getHistory(orderBook.symbol)
      );

      // Identify large orders
      const largeOrders = this.identifyLargeOrders(orderBook);

      // Predict direction
      const prediction = await this.predictDirection(
        orderBook,
        metrics,
        depthAnalysis
      );

      // Emit events for significant findings
      if (spoofingAlerts.length > 0) {
        this.emit('spoofing_detected', { symbol: orderBook.symbol, alerts: spoofingAlerts });
      }

      if (largeOrders.length > 0) {
        this.emit('large_orders_detected', { symbol: orderBook.symbol, orders: largeOrders });
      }

      // Track telemetry
      this.telemetry.track({
        eventType: 'orderbook_analyzed',
        data: {
          symbol: orderBook.symbol,
          metrics,
          spoofingCount: spoofingAlerts.length,
          largeOrderCount: largeOrders.length,
          predictionConfidence: prediction.confidence
        },
        duration: Date.now() - startTime,
        timestamp: new Date()
      });

      return {
        metrics,
        depthAnalysis,
        spoofingAlerts,
        largeOrders,
        prediction
      };
    } catch (error) {
      logger.error('Order book analysis error:', error);
      throw error;
    }
  }

  private calculateMetrics(orderBook: OrderBook): OrderBookMetrics {
    const bestBid = orderBook.bids[0];
    const bestAsk = orderBook.asks[0];

    if (!bestBid || !bestAsk) {
      throw new Error('Invalid order book: missing best bid or ask');
    }

    const bidAskSpread = bestAsk.price - bestBid.price;
    const midPrice = (bestBid.price + bestAsk.price) / 2;
    const spreadPercentage = (bidAskSpread / midPrice) * 100;

    // Calculate depth
    const depth = this.calculateDepth(orderBook);

    // Calculate imbalance
    const imbalance = this.calculateImbalance(orderBook);

    // Calculate microstructure noise
    const microstructureNoise = this.microstructureAnalyzer.calculateNoise(
      this.getHistory(orderBook.symbol)
    );

    // Calculate toxic flow indicator
    const toxicFlow = this.calculateToxicFlow(orderBook);

    // Calculate liquidity score
    const liquidityScore = this.liquidityAnalyzer.calculateScore(orderBook);

    // Calculate price impact
    const priceImpact = this.calculatePriceImpact(orderBook);

    return {
      bidAskSpread,
      spreadPercentage,
      depth,
      imbalance,
      microstructureNoise,
      toxicFlow,
      liquidityScore,
      priceImpact
    };
  }

  private calculateDepth(orderBook: OrderBook): { bids: number; asks: number } {
    const depthLevels = this.config.depthLevels;
    
    const bidDepth = orderBook.bids
      .slice(0, depthLevels)
      .reduce((sum, level) => sum + level.quantity * level.price, 0);
    
    const askDepth = orderBook.asks
      .slice(0, depthLevels)
      .reduce((sum, level) => sum + level.quantity * level.price, 0);

    return { bids: bidDepth, asks: askDepth };
  }

  private calculateImbalance(orderBook: OrderBook): number {
    const topBids = orderBook.bids.slice(0, 5);
    const topAsks = orderBook.asks.slice(0, 5);

    const bidVolume = topBids.reduce((sum, level) => sum + level.quantity, 0);
    const askVolume = topAsks.reduce((sum, level) => sum + level.quantity, 0);

    return (bidVolume - askVolume) / (bidVolume + askVolume);
  }

  private calculateToxicFlow(orderBook: OrderBook): number {
    // Toxic flow indicator based on order book asymmetry and rapid changes
    const history = this.getHistory(orderBook.symbol);
    if (history.length < 10) return 0;

    let toxicScore = 0;

    // Check for sudden order book changes
    const recentBooks = history.slice(-10);
    for (let i = 1; i < recentBooks.length; i++) {
      const prevBook = recentBooks[i - 1];
      const currBook = recentBooks[i];

      // Detect large order disappearances
      const bidDisappearance = this.detectOrderDisappearance(
        prevBook.bids,
        currBook.bids
      );
      const askDisappearance = this.detectOrderDisappearance(
        prevBook.asks,
        currBook.asks
      );

      if (bidDisappearance > this.config.spoofingThreshold ||
          askDisappearance > this.config.spoofingThreshold) {
        toxicScore += 0.2;
      }
    }

    // Check for order book stuffing
    const avgOrdersPerLevel = this.calculateAvgOrdersPerLevel(orderBook);
    if (avgOrdersPerLevel > 50) {
      toxicScore += 0.3;
    }

    return Math.min(toxicScore, 1);
  }

  private detectOrderDisappearance(
    prevLevels: OrderBookLevel[],
    currLevels: OrderBookLevel[]
  ): number {
    let disappearedVolume = 0;

    for (const prevLevel of prevLevels.slice(0, 10)) {
      const currLevel = currLevels.find(l => 
        Math.abs(l.price - prevLevel.price) < 0.00001
      );

      if (!currLevel || currLevel.quantity < prevLevel.quantity * 0.1) {
        disappearedVolume += prevLevel.quantity;
      }
    }

    return disappearedVolume;
  }

  private calculateAvgOrdersPerLevel(orderBook: OrderBook): number {
    const levels = [...orderBook.bids.slice(0, 20), ...orderBook.asks.slice(0, 20)];
    const totalOrders = levels.reduce((sum, level) => sum + (level.orders || 1), 0);
    return totalOrders / levels.length;
  }

  private calculatePriceImpact(orderBook: OrderBook): { buy: number; sell: number } {
    // Calculate price impact for typical order sizes
    const typicalOrderSize = this.config.minOrderSize * 10;

    const buyImpact = this.calculateDirectionalImpact(
      orderBook.asks,
      typicalOrderSize
    );
    const sellImpact = this.calculateDirectionalImpact(
      orderBook.bids,
      typicalOrderSize
    );

    return { buy: buyImpact, sell: sellImpact };
  }

  private calculateDirectionalImpact(
    levels: OrderBookLevel[],
    orderSize: number
  ): number {
    let remainingSize = orderSize;
    let totalCost = 0;
    let totalQuantity = 0;

    for (const level of levels) {
      const levelQuantity = Math.min(remainingSize, level.quantity);
      totalCost += levelQuantity * level.price;
      totalQuantity += levelQuantity;
      remainingSize -= levelQuantity;

      if (remainingSize <= 0) break;
    }

    if (totalQuantity === 0) return 0;

    const avgPrice = totalCost / totalQuantity;
    const initialPrice = levels[0].price;
    return Math.abs((avgPrice - initialPrice) / initialPrice) * 100;
  }

  private analyzeDepth(orderBook: OrderBook): DepthAnalysis {
    const supportLevels = this.findSupportLevels(orderBook.bids);
    const resistanceLevels = this.findResistanceLevels(orderBook.asks);
    const liquidityPockets = this.findLiquidityPockets(orderBook);
    const imbalanceZones = this.findImbalanceZones(orderBook);

    return {
      supportLevels,
      resistanceLevels,
      liquidityPockets,
      imbalanceZones
    };
  }

  private findSupportLevels(bids: OrderBookLevel[]): PriceLevel[] {
    const levels: PriceLevel[] = [];
    const volumeThreshold = this.calculateVolumeThreshold(bids);

    for (let i = 0; i < Math.min(bids.length - 1, 50); i++) {
      const level = bids[i];
      
      if (level.quantity > volumeThreshold) {
        const strength = this.calculateLevelStrength(bids, i);
        
        levels.push({
          price: level.price,
          strength,
          volume: level.quantity,
          type: 'support'
        });
      }
    }

    return levels.sort((a, b) => b.strength - a.strength).slice(0, 5);
  }

  private findResistanceLevels(asks: OrderBookLevel[]): PriceLevel[] {
    const levels: PriceLevel[] = [];
    const volumeThreshold = this.calculateVolumeThreshold(asks);

    for (let i = 0; i < Math.min(asks.length - 1, 50); i++) {
      const level = asks[i];
      
      if (level.quantity > volumeThreshold) {
        const strength = this.calculateLevelStrength(asks, i);
        
        levels.push({
          price: level.price,
          strength,
          volume: level.quantity,
          type: 'resistance'
        });
      }
    }

    return levels.sort((a, b) => b.strength - a.strength).slice(0, 5);
  }

  private calculateVolumeThreshold(levels: OrderBookLevel[]): number {
    const volumes = levels.slice(0, 50).map(l => l.quantity);
    const avgVolume = volumes.reduce((sum, v) => sum + v, 0) / volumes.length;
    const stdDev = Math.sqrt(
      volumes.reduce((sum, v) => sum + Math.pow(v - avgVolume, 2), 0) / volumes.length
    );
    return avgVolume + stdDev * 2;
  }

  private calculateLevelStrength(levels: OrderBookLevel[], index: number): number {
    const level = levels[index];
    let strength = 0;

    // Volume strength
    const avgVolume = levels.slice(0, 50).reduce((sum, l) => sum + l.quantity, 0) / 50;
    strength += level.quantity / avgVolume;

    // Clustering strength
    const nearbyLevels = levels.slice(
      Math.max(0, index - 5),
      Math.min(levels.length, index + 5)
    );
    const clusterVolume = nearbyLevels.reduce((sum, l) => sum + l.quantity, 0);
    strength += clusterVolume / (avgVolume * nearbyLevels.length);

    // Order count strength (if available)
    if (level.orders) {
      strength += Math.log(level.orders) / 10;
    }

    return Math.min(strength / 3, 1);
  }

  private findLiquidityPockets(orderBook: OrderBook): LiquidityPocket[] {
    const pockets: LiquidityPocket[] = [];
    const priceStep = (orderBook.asks[0].price - orderBook.bids[0].price) * 5;

    // Analyze bid side
    let currentPocket: LiquidityPocket | null = null;
    let lastPrice = orderBook.bids[0].price;

    for (const bid of orderBook.bids.slice(0, 100)) {
      if (bid.price < lastPrice - priceStep && currentPocket) {
        if (currentPocket.totalVolume > this.config.minOrderSize * 5) {
          pockets.push(currentPocket);
        }
        currentPocket = null;
      }

      if (!currentPocket) {
        currentPocket = {
          priceRange: [bid.price, bid.price],
          totalVolume: 0,
          side: 'bid'
        };
      }

      currentPocket.priceRange[0] = Math.min(currentPocket.priceRange[0], bid.price);
      currentPocket.totalVolume += bid.quantity;
      lastPrice = bid.price;
    }

    // Analyze ask side
    currentPocket = null;
    lastPrice = orderBook.asks[0].price;

    for (const ask of orderBook.asks.slice(0, 100)) {
      if (ask.price > lastPrice + priceStep && currentPocket) {
        if (currentPocket.totalVolume > this.config.minOrderSize * 5) {
          pockets.push(currentPocket);
        }
        currentPocket = null;
      }

      if (!currentPocket) {
        currentPocket = {
          priceRange: [ask.price, ask.price],
          totalVolume: 0,
          side: 'ask'
        };
      }

      currentPocket.priceRange[1] = Math.max(currentPocket.priceRange[1], ask.price);
      currentPocket.totalVolume += ask.quantity;
      lastPrice = ask.price;
    }

    return pockets;
  }

  private findImbalanceZones(orderBook: OrderBook): ImbalanceZone[] {
    const zones: ImbalanceZone[] = [];
    const midPrice = (orderBook.bids[0].price + orderBook.asks[0].price) / 2;
    const priceStep = midPrice * 0.001; // 0.1% steps

    for (let i = 0; i < 20; i++) {
      const price = midPrice + (i - 10) * priceStep;
      
      const bidVolume = this.getVolumeAtPrice(orderBook.bids, price, priceStep);
      const askVolume = this.getVolumeAtPrice(orderBook.asks, price, priceStep);
      
      if (bidVolume + askVolume > 0) {
        const imbalanceRatio = (bidVolume - askVolume) / (bidVolume + askVolume);
        
        if (Math.abs(imbalanceRatio) > 0.5) {
          zones.push({
            price,
            imbalanceRatio,
            side: imbalanceRatio > 0 ? 'bullish' : 'bearish'
          });
        }
      }
    }

    return zones;
  }

  private getVolumeAtPrice(
    levels: OrderBookLevel[],
    price: number,
    tolerance: number
  ): number {
    return levels
      .filter(l => Math.abs(l.price - price) <= tolerance)
      .reduce((sum, l) => sum + l.quantity, 0);
  }

  private identifyLargeOrders(orderBook: OrderBook): LargeOrder[] {
    const largeOrders: LargeOrder[] = [];
    const avgBidVolume = this.calculateAvgVolume(orderBook.bids.slice(0, 50));
    const avgAskVolume = this.calculateAvgVolume(orderBook.asks.slice(0, 50));

    // Check bids
    for (const bid of orderBook.bids.slice(0, 20)) {
      if (bid.quantity > avgBidVolume * 3) {
        const icebergDetected = this.detectIceberg(orderBook.bids, bid);
        largeOrders.push({
          price: bid.price,
          size: bid.quantity,
          side: 'bid',
          hiddenSize: icebergDetected ? bid.quantity * 2 : undefined,
          icebergDetected
        });
      }
    }

    // Check asks
    for (const ask of orderBook.asks.slice(0, 20)) {
      if (ask.quantity > avgAskVolume * 3) {
        const icebergDetected = this.detectIceberg(orderBook.asks, ask);
        largeOrders.push({
          price: ask.price,
          size: ask.quantity,
          side: 'ask',
          hiddenSize: icebergDetected ? ask.quantity * 2 : undefined,
          icebergDetected
        });
      }
    }

    return largeOrders;
  }

  private calculateAvgVolume(levels: OrderBookLevel[]): number {
    if (levels.length === 0) return 0;
    return levels.reduce((sum, l) => sum + l.quantity, 0) / levels.length;
  }

  private detectIceberg(levels: OrderBookLevel[], targetLevel: OrderBookLevel): boolean {
    if (!this.config.icebergDetection) return false;

    const history = this.getHistory(targetLevel.price.toString());
    if (history.length < 5) return false;

    // Check if the order has been consistently replenished
    let replenishCount = 0;
    for (let i = 1; i < history.length; i++) {
      const prevBook = history[i - 1];
      const currBook = history[i];

      const prevLevel = prevBook.bids.concat(prevBook.asks).find(
        l => Math.abs(l.price - targetLevel.price) < 0.00001
      );
      const currLevel = currBook.bids.concat(currBook.asks).find(
        l => Math.abs(l.price - targetLevel.price) < 0.00001
      );

      if (prevLevel && currLevel && 
          currLevel.quantity >= prevLevel.quantity * 0.9 &&
          prevLevel.quantity > targetLevel.quantity * 0.5) {
        replenishCount++;
      }
    }

    return replenishCount >= 3;
  }

  private async predictDirection(
    orderBook: OrderBook,
    metrics: OrderBookMetrics,
    depthAnalysis: DepthAnalysis
  ): Promise<DirectionPrediction> {
    const features = this.extractFeatures(orderBook, metrics, depthAnalysis);
    const history = this.getHistory(orderBook.symbol);

    // Simple prediction model based on multiple factors
    let bullScore = 0;
    let bearScore = 0;

    // Order book imbalance
    if (metrics.imbalance > 0.2) bullScore += 0.3;
    else if (metrics.imbalance < -0.2) bearScore += 0.3;

    // Microstructure noise (low noise = clearer signal)
    if (metrics.microstructureNoise < 0.1) {
      if (metrics.imbalance > 0) bullScore += 0.2;
      else bearScore += 0.2;
    }

    // Support/resistance analysis
    const nearestSupport = depthAnalysis.supportLevels[0];
    const nearestResistance = depthAnalysis.resistanceLevels[0];
    const midPrice = (orderBook.bids[0].price + orderBook.asks[0].price) / 2;

    if (nearestSupport && nearestResistance) {
      const supportDistance = (midPrice - nearestSupport.price) / midPrice;
      const resistanceDistance = (nearestResistance.price - midPrice) / midPrice;

      if (supportDistance < resistanceDistance * 0.5) bullScore += 0.2;
      else if (resistanceDistance < supportDistance * 0.5) bearScore += 0.2;
    }

    // Liquidity analysis
    if (metrics.liquidityScore > 0.7) {
      // High liquidity tends to dampen moves
      bullScore *= 0.8;
      bearScore *= 0.8;
    }

    // Price momentum from history
    if (history.length >= 10) {
      const momentum = this.calculateMomentum(history);
      if (momentum > 0.1) bullScore += 0.3;
      else if (momentum < -0.1) bearScore += 0.3;
    }

    // Determine direction and confidence
    const totalScore = bullScore + bearScore;
    let direction: 'up' | 'down' | 'neutral';
    let confidence: number;

    if (bullScore > bearScore * 1.5) {
      direction = 'up';
      confidence = bullScore / totalScore;
    } else if (bearScore > bullScore * 1.5) {
      direction = 'down';
      confidence = bearScore / totalScore;
    } else {
      direction = 'neutral';
      confidence = 1 - Math.abs(bullScore - bearScore) / totalScore;
    }

    // Calculate expected move based on volatility
    const volatility = this.calculateVolatility(history);
    const expectedMove = direction === 'neutral' ? 0 :
      (direction === 'up' ? 1 : -1) * volatility * confidence;

    return {
      direction,
      confidence: Math.min(confidence, 0.9),
      timeframe: 15, // 15 minutes
      expectedMove
    };
  }

  private extractFeatures(
    orderBook: OrderBook,
    metrics: OrderBookMetrics,
    depthAnalysis: DepthAnalysis
  ): number[] {
    return [
      metrics.bidAskSpread,
      metrics.spreadPercentage,
      metrics.depth.bids,
      metrics.depth.asks,
      metrics.imbalance,
      metrics.microstructureNoise,
      metrics.toxicFlow,
      metrics.liquidityScore,
      metrics.priceImpact.buy,
      metrics.priceImpact.sell,
      depthAnalysis.supportLevels.length,
      depthAnalysis.resistanceLevels.length,
      depthAnalysis.liquidityPockets.length,
      depthAnalysis.imbalanceZones.length
    ];
  }

  private calculateMomentum(history: OrderBook[]): number {
    if (history.length < 2) return 0;

    const oldMidPrice = (history[0].bids[0].price + history[0].asks[0].price) / 2;
    const newMidPrice = (history[history.length - 1].bids[0].price + 
                        history[history.length - 1].asks[0].price) / 2;

    return (newMidPrice - oldMidPrice) / oldMidPrice;
  }

  private calculateVolatility(history: OrderBook[]): number {
    if (history.length < 2) return 0;

    const midPrices = history.map(ob => 
      (ob.bids[0].price + ob.asks[0].price) / 2
    );

    const returns: number[] = [];
    for (let i = 1; i < midPrices.length; i++) {
      returns.push((midPrices[i] - midPrices[i - 1]) / midPrices[i - 1]);
    }

    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;

    return Math.sqrt(variance) * 100; // Return as percentage
  }

  private updateHistory(orderBook: OrderBook): void {
    const symbol = orderBook.symbol;
    if (!this.orderBookHistory.has(symbol)) {
      this.orderBookHistory.set(symbol, []);
    }

    const history = this.orderBookHistory.get(symbol)!;
    history.push(orderBook);

    // Maintain max history size
    if (history.length > this.MAX_HISTORY_SIZE) {
      history.shift();
    }
  }

  private getHistory(symbol: string): OrderBook[] {
    return this.orderBookHistory.get(symbol) || [];
  }

  async stop(): Promise<void> {
    this.orderBookHistory.clear();
    await this.telemetry.flush();
  }
}

// Supporting classes
class SpoofingDetector {
  private config: OrderBookConfig;

  constructor(config: OrderBookConfig) {
    this.config = config;
  }

  async detectSpoofing(
    currentBook: OrderBook,
    history: OrderBook[]
  ): Promise<SpoofingAlert[]> {
    if (history.length < 5) return [];

    const alerts: SpoofingAlert[] = [];
    const recentBooks = history.slice(-5);

    // Pattern 1: Large order appears and disappears quickly
    const flashOrders = this.detectFlashOrders(currentBook, recentBooks);
    alerts.push(...flashOrders);

    // Pattern 2: Layering - multiple orders at different price levels
    const layering = this.detectLayering(currentBook);
    alerts.push(...layering);

    // Pattern 3: Order book stuffing
    const stuffing = this.detectStuffing(currentBook);
    alerts.push(...stuffing);

    return alerts;
  }

  private detectFlashOrders(
    currentBook: OrderBook,
    recentBooks: OrderBook[]
  ): SpoofingAlert[] {
    const alerts: SpoofingAlert[] = [];

    for (let i = 0; i < recentBooks.length - 1; i++) {
      const prevBook = recentBooks[i];
      const nextBook = recentBooks[i + 1];

      // Check bid side
      const bidFlash = this.findFlashOrder(
        prevBook.bids,
        nextBook.bids,
        'bid'
      );
      if (bidFlash) alerts.push(bidFlash);

      // Check ask side
      const askFlash = this.findFlashOrder(
        prevBook.asks,
        nextBook.asks,
        'ask'
      );
      if (askFlash) alerts.push(askFlash);
    }

    return alerts;
  }

  private findFlashOrder(
    prevLevels: OrderBookLevel[],
    nextLevels: OrderBookLevel[],
    side: 'bid' | 'ask'
  ): SpoofingAlert | null {
    for (const prevLevel of prevLevels.slice(0, 10)) {
      if (prevLevel.quantity < this.config.spoofingThreshold) continue;

      const nextLevel = nextLevels.find(
        l => Math.abs(l.price - prevLevel.price) < 0.00001
      );

      if (!nextLevel || nextLevel.quantity < prevLevel.quantity * 0.1) {
        return {
          timestamp: new Date(),
          side,
          price: prevLevel.price,
          size: prevLevel.quantity,
          confidence: 0.8,
          pattern: 'flash_order'
        };
      }
    }

    return null;
  }

  private detectLayering(orderBook: OrderBook): SpoofingAlert[] {
    const alerts: SpoofingAlert[] = [];

    // Check for suspicious patterns in order distribution
    const bidPattern = this.checkLayeringPattern(orderBook.bids, 'bid');
    if (bidPattern) alerts.push(bidPattern);

    const askPattern = this.checkLayeringPattern(orderBook.asks, 'ask');
    if (askPattern) alerts.push(askPattern);

    return alerts;
  }

  private checkLayeringPattern(
    levels: OrderBookLevel[],
    side: 'bid' | 'ask'
  ): SpoofingAlert | null {
    const topLevels = levels.slice(0, 10);
    const sizes = topLevels.map(l => l.quantity);
    
    // Check for suspiciously similar sizes
    const avgSize = sizes.reduce((sum, s) => sum + s, 0) / sizes.length;
    const variance = sizes.reduce((sum, s) => sum + Math.pow(s - avgSize, 2), 0) / sizes.length;
    const stdDev = Math.sqrt(variance);

    if (stdDev < avgSize * 0.1 && avgSize > this.config.minOrderSize * 5) {
      return {
        timestamp: new Date(),
        side,
        price: levels[5].price, // Middle of the pattern
        size: avgSize * topLevels.length,
        confidence: 0.7,
        pattern: 'layering'
      };
    }

    return null;
  }

  private detectStuffing(orderBook: OrderBook): SpoofingAlert[] {
    const alerts: SpoofingAlert[] = [];

    // Check for excessive order count
    const bidOrderCount = orderBook.bids
      .slice(0, 20)
      .reduce((sum, l) => sum + (l.orders || 1), 0);
    
    const askOrderCount = orderBook.asks
      .slice(0, 20)
      .reduce((sum, l) => sum + (l.orders || 1), 0);

    if (bidOrderCount > 200) {
      alerts.push({
        timestamp: new Date(),
        side: 'bid',
        price: orderBook.bids[0].price,
        size: 0,
        confidence: 0.6,
        pattern: 'stuffing'
      });
    }

    if (askOrderCount > 200) {
      alerts.push({
        timestamp: new Date(),
        side: 'ask',
        price: orderBook.asks[0].price,
        size: 0,
        confidence: 0.6,
        pattern: 'stuffing'
      });
    }

    return alerts;
  }
}

class MicrostructureAnalyzer {
  calculateNoise(history: OrderBook[]): number {
    if (history.length < 10) return 0;

    const midPrices = history.map(ob => 
      (ob.bids[0].price + ob.asks[0].price) / 2
    );

    // Calculate noise using variance ratio
    const returns1 = this.calculateReturns(midPrices, 1);
    const returns5 = this.calculateReturns(midPrices, 5);

    if (returns5.length === 0) return 0;

    const var1 = this.calculateVariance(returns1);
    const var5 = this.calculateVariance(returns5);

    const varianceRatio = (var1 * 5) / var5;
    return Math.abs(1 - varianceRatio);
  }

  private calculateReturns(prices: number[], lag: number): number[] {
    const returns: number[] = [];
    for (let i = lag; i < prices.length; i++) {
      returns.push((prices[i] - prices[i - lag]) / prices[i - lag]);
    }
    return returns;
  }

  private calculateVariance(values: number[]): number {
    if (values.length === 0) return 0;
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    return values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
  }
}

class LiquidityAnalyzer {
  calculateScore(orderBook: OrderBook): number {
    // Composite liquidity score based on multiple factors
    let score = 0;

    // Factor 1: Tight spread
    const spread = orderBook.asks[0].price - orderBook.bids[0].price;
    const midPrice = (orderBook.bids[0].price + orderBook.asks[0].price) / 2;
    const spreadPct = spread / midPrice;
    score += Math.max(0, 1 - spreadPct * 100) * 0.3;

    // Factor 2: Deep order book
    const bidDepth = orderBook.bids
      .slice(0, 50)
      .reduce((sum, l) => sum + l.quantity * l.price, 0);
    const askDepth = orderBook.asks
      .slice(0, 50)
      .reduce((sum, l) => sum + l.quantity * l.price, 0);
    const totalDepth = bidDepth + askDepth;
    const depthScore = Math.min(totalDepth / (midPrice * 1000), 1);
    score += depthScore * 0.4;

    // Factor 3: Order book balance
    const imbalance = Math.abs((bidDepth - askDepth) / (bidDepth + askDepth));
    score += (1 - imbalance) * 0.3;

    return Math.min(score, 1);
  }
} 