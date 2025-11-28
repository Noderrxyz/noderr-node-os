/**
 * LiveMetricsCollector - Real-time exchange performance metrics collection
 * 
 * Integrates with exchange WebSocket feeds to track:
 * - Order book depth and liquidity
 * - Latency measurements (ping/ack)
 * - Fill rates and slippage
 * - Exchange uptime and reliability
 */

import { EventEmitter } from 'events';
import { 
  Exchange, 
  OrderBookDepth, 
  PriceLevel,
  ExecutionResult,
  ExecutionStatus,
  OrderSide
} from '@noderr/types';

const createLogger = (name: string) => ({
  info: (message: string, meta?: any) => console.log(`[${name}] INFO:`, message, meta || ''),
  error: (message: string, error?: any) => console.error(`[${name}] ERROR:`, message, error || ''),
  debug: (message: string, meta?: any) => console.debug(`[${name}] DEBUG:`, message, meta || ''),
  warn: (message: string, meta?: any) => console.warn(`[${name}] WARN:`, message, meta || '')
});

export interface VenuePerformanceReport {
  exchangeId: string;
  timestamp: number;
  
  // Liquidity metrics
  bidDepth: {
    total: number; // Total bid volume
    levels: number; // Number of price levels
    spread: number; // Bid-ask spread
    topSize: number; // Size at best bid
  };
  askDepth: {
    total: number;
    levels: number;
    spread: number;
    topSize: number;
  };
  
  // Performance metrics
  latency: {
    current: number; // Current latency in ms
    avg1m: number; // 1-minute average
    avg5m: number; // 5-minute average
    p99: number; // 99th percentile
  };
  
  // Execution quality
  fillRate: {
    rate: number; // Success rate (0-1)
    totalOrders: number;
    filledOrders: number;
    partialFills: number;
  };
  
  slippage: {
    avgBps: number; // Average slippage in basis points
    maxBps: number; // Max observed slippage
    positive: number; // Positive slippage %
    negative: number; // Negative slippage %
  };
  
  // Reliability
  uptime: {
    percentage: number; // Uptime %
    lastDowntime?: number;
    consecutiveErrors: number;
  };
  
  // Market quality
  marketQuality: {
    score: number; // 0-100 quality score
    volatility: number;
    liquidityScore: number;
    stabilityScore: number;
  };
}

interface MetricsWindow {
  values: number[];
  timestamps: number[];
  maxSize: number;
}

interface ExchangeMetricsState {
  // Order book tracking
  lastOrderBook?: OrderBookDepth;
  orderBookUpdates: number;
  
  // Latency tracking
  latencyWindow: MetricsWindow;
  lastPingTime?: number;
  
  // Execution tracking
  executionHistory: ExecutionResult[];
  fillCount: number;
  partialFillCount: number;
  failureCount: number;
  
  // Slippage tracking
  slippageWindow: MetricsWindow;
  
  // Uptime tracking
  connectionStart: number;
  disconnections: number;
  lastDisconnection?: number;
  consecutiveErrors: number;
  
  // Market quality
  priceWindow: MetricsWindow;
  volumeWindow: MetricsWindow;
}

interface ExtendedExecutionResult extends ExecutionResult {
  orderPrice?: number; // Original order price for slippage calculation
}

export class LiveMetricsCollector extends EventEmitter {
  private logger: ReturnType<typeof createLogger>;
  private exchanges: Map<string, Exchange>;
  private metricsState: Map<string, ExchangeMetricsState>;
  private reportInterval: number;
  private reportTimer?: NodeJS.Timeout;
  private connectorHandlers: Map<string, any>;
  
  constructor(exchanges: Exchange[], reportInterval: number = 5000) {
    super();
    this.logger = createLogger('LiveMetricsCollector');
    this.exchanges = new Map(exchanges.map(e => [e.id, e]));
    this.metricsState = new Map();
    this.reportInterval = reportInterval;
    this.connectorHandlers = new Map();
    
    this.initializeMetricsState();
  }
  
  /**
   * Start collecting metrics
   */
  public start(): void {
    this.logger.info('Starting live metrics collection', {
      exchanges: Array.from(this.exchanges.keys()),
      reportInterval: this.reportInterval
    });
    
    // Subscribe to exchange events
    this.subscribeToExchangeEvents();
    
    // Start periodic reporting
    this.reportTimer = setInterval(() => {
      this.generatePerformanceReports();
    }, this.reportInterval);
    
    this.emit('metrics-started');
  }
  
  /**
   * Stop collecting metrics
   */
  public stop(): void {
    if (this.reportTimer) {
      clearInterval(this.reportTimer);
      this.reportTimer = undefined;
    }
    
    // Unsubscribe from exchange events
    this.unsubscribeFromExchangeEvents();
    
    this.logger.info('Stopped live metrics collection');
    this.emit('metrics-stopped');
  }
  
  /**
   * Initialize metrics state for each exchange
   */
  private initializeMetricsState(): void {
    for (const exchangeId of this.exchanges.keys()) {
      this.metricsState.set(exchangeId, {
        orderBookUpdates: 0,
        latencyWindow: { values: [], timestamps: [], maxSize: 100 },
        executionHistory: [],
        fillCount: 0,
        partialFillCount: 0,
        failureCount: 0,
        slippageWindow: { values: [], timestamps: [], maxSize: 100 },
        connectionStart: Date.now(),
        disconnections: 0,
        consecutiveErrors: 0,
        priceWindow: { values: [], timestamps: [], maxSize: 100 },
        volumeWindow: { values: [], timestamps: [], maxSize: 100 }
      });
    }
  }
  
  /**
   * Subscribe to exchange connector events
   */
  private subscribeToExchangeEvents(): void {
    // This would integrate with BinanceConnector and CoinbaseConnector
    // For now, we'll simulate the integration
    
    for (const [exchangeId, exchange] of this.exchanges) {
      const handlers = {
        orderbook: (data: any) => this.handleOrderBookUpdate(exchangeId, data),
        trade: (data: any) => this.handleTradeUpdate(exchangeId, data),
        latency: (data: any) => this.handleLatencyUpdate(exchangeId, data),
        connected: () => this.handleConnectionEvent(exchangeId, 'connected'),
        disconnected: () => this.handleConnectionEvent(exchangeId, 'disconnected'),
        error: () => this.handleErrorEvent(exchangeId)
      };
      
      this.connectorHandlers.set(exchangeId, handlers);
      
      // In production, would subscribe to actual connector events
      // connector.on('orderbook-update', handlers.orderbook);
      // etc.
    }
  }
  
  /**
   * Unsubscribe from exchange events
   */
  private unsubscribeFromExchangeEvents(): void {
    // Clean up event handlers
    this.connectorHandlers.clear();
  }
  
  /**
   * Handle order book update
   */
  private handleOrderBookUpdate(exchangeId: string, orderBook: OrderBookDepth): void {
    const state = this.metricsState.get(exchangeId);
    if (!state) return;
    
    state.lastOrderBook = orderBook;
    state.orderBookUpdates++;
    
    // Update price and volume windows
    if (orderBook.bids.length > 0 && orderBook.asks.length > 0) {
      const midPrice = (orderBook.bids[0].price + orderBook.asks[0].price) / 2;
      this.addToWindow(state.priceWindow, midPrice);
      
      const totalVolume = 
        orderBook.bids.reduce((sum, level) => sum + level.quantity, 0) +
        orderBook.asks.reduce((sum, level) => sum + level.quantity, 0);
      this.addToWindow(state.volumeWindow, totalVolume);
    }
    
    this.emit('orderbook-metrics', {
      exchangeId,
      timestamp: Date.now(),
      spread: this.calculateSpread(orderBook),
      depth: this.calculateDepth(orderBook),
      imbalance: this.calculateImbalance(orderBook)
    });
  }
  
  /**
   * Handle trade update for market quality
   */
  private handleTradeUpdate(exchangeId: string, trade: any): void {
    const state = this.metricsState.get(exchangeId);
    if (!state) return;
    
    // Could track trade flow metrics here
    this.emit('trade-metrics', {
      exchangeId,
      timestamp: Date.now(),
      price: trade.price,
      volume: trade.quantity,
      side: trade.side
    });
  }
  
  /**
   * Handle latency update
   */
  private handleLatencyUpdate(exchangeId: string, latency: number): void {
    const state = this.metricsState.get(exchangeId);
    if (!state) return;
    
    this.addToWindow(state.latencyWindow, latency);
    
    this.emit('latency-metrics', {
      exchangeId,
      timestamp: Date.now(),
      latency
    });
  }
  
  /**
   * Handle connection events
   */
  private handleConnectionEvent(exchangeId: string, event: 'connected' | 'disconnected'): void {
    const state = this.metricsState.get(exchangeId);
    if (!state) return;
    
    if (event === 'disconnected') {
      state.disconnections++;
      state.lastDisconnection = Date.now();
      state.consecutiveErrors = 0;
    } else {
      state.consecutiveErrors = 0;
    }
    
    this.emit('connection-metrics', {
      exchangeId,
      timestamp: Date.now(),
      event
    });
  }
  
  /**
   * Handle error events
   */
  private handleErrorEvent(exchangeId: string): void {
    const state = this.metricsState.get(exchangeId);
    if (!state) return;
    
    state.consecutiveErrors++;
  }
  
  /**
   * Track execution result for quality metrics
   */
  public recordExecution(exchangeId: string, result: ExtendedExecutionResult): void {
    const state = this.metricsState.get(exchangeId);
    if (!state) return;
    
    state.executionHistory.push(result);
    
    // Keep only recent history
    if (state.executionHistory.length > 1000) {
      state.executionHistory = state.executionHistory.slice(-1000);
    }
    
    // Update fill counts
    if (result.status === ExecutionStatus.COMPLETED) {
      state.fillCount++;
      
      // Calculate slippage
      if (result.orderPrice) {
        const slippageBps = Math.abs(
          (result.averagePrice - result.orderPrice) / result.orderPrice * 10000
        );
        this.addToWindow(state.slippageWindow, slippageBps);
      }
    } else if (result.status === ExecutionStatus.PARTIAL) {
      state.partialFillCount++;
    } else if (result.status === ExecutionStatus.FAILED || result.status === ExecutionStatus.CANCELLED) {
      state.failureCount++;
    }
    
    this.emit('execution-metrics', {
      exchangeId,
      timestamp: Date.now(),
      status: result.status,
      slippage: result.slippage
    });
  }
  
  /**
   * Generate performance reports for all exchanges
   */
  private generatePerformanceReports(): void {
    const reports: VenuePerformanceReport[] = [];
    
    for (const [exchangeId, state] of this.metricsState) {
      const report = this.generateExchangeReport(exchangeId, state);
      reports.push(report);
      
      // Emit individual report
      this.emit('venue-performance', report);
    }
    
    // Emit batch report
    this.emit('performance-reports', reports);
    
    // Log summary
    this.logger.debug('Generated performance reports', {
      exchangeCount: reports.length,
      timestamp: Date.now()
    });
  }
  
  /**
   * Generate performance report for a single exchange
   */
  private generateExchangeReport(
    exchangeId: string, 
    state: ExchangeMetricsState
  ): VenuePerformanceReport {
    const now = Date.now();
    const orderBook = state.lastOrderBook;
    
    // Calculate bid/ask metrics
    const bidMetrics = orderBook ? this.calculateDepthMetrics(orderBook.bids) : {
      total: 0,
      levels: 0,
      spread: 0,
      topSize: 0
    };
    
    const askMetrics = orderBook ? this.calculateDepthMetrics(orderBook.asks) : {
      total: 0,
      levels: 0,
      spread: 0,
      topSize: 0
    };
    
    if (orderBook && orderBook.bids.length > 0 && orderBook.asks.length > 0) {
      bidMetrics.spread = orderBook.asks[0].price - orderBook.bids[0].price;
      askMetrics.spread = bidMetrics.spread;
    }
    
    // Calculate latency metrics
    const latencyMetrics = this.calculateWindowMetrics(state.latencyWindow, now);
    
    // Calculate fill rate
    const totalOrders = state.fillCount + state.partialFillCount + state.failureCount;
    const fillRate = totalOrders > 0 ? state.fillCount / totalOrders : 0;
    
    // Calculate slippage metrics
    const slippageMetrics = this.calculateSlippageMetrics(state.slippageWindow);
    
    // Calculate uptime
    const uptime = this.calculateUptime(state, now);
    
    // Calculate market quality
    const marketQuality = this.calculateMarketQuality(state);
    
    return {
      exchangeId,
      timestamp: now,
      bidDepth: bidMetrics,
      askDepth: askMetrics,
      latency: latencyMetrics,
      fillRate: {
        rate: fillRate,
        totalOrders,
        filledOrders: state.fillCount,
        partialFills: state.partialFillCount
      },
      slippage: slippageMetrics,
      uptime: {
        percentage: uptime,
        lastDowntime: state.lastDisconnection,
        consecutiveErrors: state.consecutiveErrors
      },
      marketQuality
    };
  }
  
  /**
   * Calculate depth metrics
   */
  private calculateDepthMetrics(levels: PriceLevel[]): {
    total: number;
    levels: number;
    spread: number;
    topSize: number;
  } {
    const total = levels.reduce((sum, level) => sum + level.quantity, 0);
    
    return {
      total,
      levels: levels.length,
      spread: 0, // Will be set by caller
      topSize: levels.length > 0 ? levels[0].quantity : 0
    };
  }
  
  /**
   * Calculate window-based metrics
   */
  private calculateWindowMetrics(
    window: MetricsWindow, 
    now: number
  ): {
    current: number;
    avg1m: number;
    avg5m: number;
    p99: number;
  } {
    if (window.values.length === 0) {
      return { current: 0, avg1m: 0, avg5m: 0, p99: 0 };
    }
    
    const current = window.values[window.values.length - 1];
    
    // Calculate time-based averages
    const oneMinuteAgo = now - 60000;
    const fiveMinutesAgo = now - 300000;
    
    const values1m = window.values.filter((_, i) => 
      window.timestamps[i] >= oneMinuteAgo
    );
    const values5m = window.values.filter((_, i) => 
      window.timestamps[i] >= fiveMinutesAgo
    );
    
    const avg1m = values1m.length > 0 
      ? values1m.reduce((a, b) => a + b, 0) / values1m.length 
      : current;
      
    const avg5m = values5m.length > 0 
      ? values5m.reduce((a, b) => a + b, 0) / values5m.length 
      : current;
    
    // Calculate p99
    const sorted = [...window.values].sort((a, b) => a - b);
    const p99Index = Math.floor(sorted.length * 0.99);
    const p99 = sorted[p99Index] || current;
    
    return { current, avg1m, avg5m, p99 };
  }
  
  /**
   * Calculate slippage metrics
   */
  private calculateSlippageMetrics(window: MetricsWindow): {
    avgBps: number;
    maxBps: number;
    positive: number;
    negative: number;
  } {
    if (window.values.length === 0) {
      return { avgBps: 0, maxBps: 0, positive: 0, negative: 0 };
    }
    
    const avgBps = window.values.reduce((a, b) => a + b, 0) / window.values.length;
    const maxBps = Math.max(...window.values);
    
    // Note: This is simplified - in reality we'd track signed slippage
    const positive = 0.5; // Placeholder
    const negative = 0.5; // Placeholder
    
    return { avgBps, maxBps, positive, negative };
  }
  
  /**
   * Calculate uptime percentage
   */
  private calculateUptime(state: ExchangeMetricsState, now: number): number {
    const totalTime = now - state.connectionStart;
    const downtime = state.disconnections * 5000; // Estimate 5s per disconnection
    
    return Math.max(0, Math.min(100, ((totalTime - downtime) / totalTime) * 100));
  }
  
  /**
   * Calculate market quality score
   */
  private calculateMarketQuality(state: ExchangeMetricsState): {
    score: number;
    volatility: number;
    liquidityScore: number;
    stabilityScore: number;
  } {
    // Calculate volatility from price window
    const volatility = this.calculateVolatility(state.priceWindow);
    
    // Calculate liquidity score from volume window
    const avgVolume = state.volumeWindow.values.length > 0
      ? state.volumeWindow.values.reduce((a, b) => a + b, 0) / state.volumeWindow.values.length
      : 0;
    const liquidityScore = Math.min(100, avgVolume / 1000); // Normalize
    
    // Calculate stability score
    const stabilityScore = Math.max(0, 100 - state.consecutiveErrors * 10 - state.disconnections * 5);
    
    // Overall quality score
    const score = (liquidityScore * 0.4 + stabilityScore * 0.4 + (100 - volatility) * 0.2);
    
    return {
      score: Math.round(score),
      volatility,
      liquidityScore,
      stabilityScore
    };
  }
  
  /**
   * Calculate price volatility
   */
  private calculateVolatility(priceWindow: MetricsWindow): number {
    if (priceWindow.values.length < 2) return 0;
    
    const returns = [];
    for (let i = 1; i < priceWindow.values.length; i++) {
      const ret = (priceWindow.values[i] - priceWindow.values[i-1]) / priceWindow.values[i-1];
      returns.push(ret);
    }
    
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - avgReturn, 2), 0) / returns.length;
    
    return Math.sqrt(variance) * 100; // Return as percentage
  }
  
  /**
   * Helper to add value to metrics window
   */
  private addToWindow(window: MetricsWindow, value: number): void {
    window.values.push(value);
    window.timestamps.push(Date.now());
    
    // Maintain max size
    if (window.values.length > window.maxSize) {
      window.values.shift();
      window.timestamps.shift();
    }
  }
  
  /**
   * Calculate spread from order book
   */
  private calculateSpread(orderBook: OrderBookDepth): number {
    if (orderBook.bids.length === 0 || orderBook.asks.length === 0) {
      return 0;
    }
    return orderBook.asks[0].price - orderBook.bids[0].price;
  }
  
  /**
   * Calculate depth score
   */
  private calculateDepth(orderBook: OrderBookDepth): number {
    const bidDepth = orderBook.bids.reduce((sum, level) => sum + level.quantity, 0);
    const askDepth = orderBook.asks.reduce((sum, level) => sum + level.quantity, 0);
    return bidDepth + askDepth;
  }
  
  /**
   * Calculate order book imbalance
   */
  private calculateImbalance(orderBook: OrderBookDepth): number {
    const bidVolume = orderBook.bids.reduce((sum, level) => sum + level.quantity, 0);
    const askVolume = orderBook.asks.reduce((sum, level) => sum + level.quantity, 0);
    const totalVolume = bidVolume + askVolume;
    
    if (totalVolume === 0) return 0;
    
    return (bidVolume - askVolume) / totalVolume;
  }
  
  /**
   * Get latest report for an exchange
   */
  public getLatestReport(exchangeId: string): VenuePerformanceReport | null {
    const state = this.metricsState.get(exchangeId);
    if (!state) return null;
    
    return this.generateExchangeReport(exchangeId, state);
  }
  
  /**
   * Get all latest reports
   */
  public getAllReports(): VenuePerformanceReport[] {
    const reports: VenuePerformanceReport[] = [];
    
    for (const [exchangeId, state] of this.metricsState) {
      reports.push(this.generateExchangeReport(exchangeId, state));
    }
    
    return reports;
  }
} 