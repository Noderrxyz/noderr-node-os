import { Registry, Histogram, Counter, Gauge, Summary } from 'prom-client';
import { EventEmitter } from 'events';
import * as winston from 'winston';

/**
 * Metrics aggregation configuration
 */
export interface MetricsAggregatorConfig {
  // Aggregation window in seconds
  windowSize: number;
  // Number of windows to keep in memory
  windowCount: number;
  // Export interval in seconds
  exportInterval: number;
  // Enable detailed metrics
  detailedMetrics: boolean;
}

/**
 * Aggregated metrics window
 */
export interface MetricsWindow {
  startTime: Date;
  endTime: Date;
  metrics: AggregatedMetrics;
}

/**
 * Aggregated metrics
 */
export interface AggregatedMetrics {
  // Trading metrics
  totalOrders: number;
  successfulOrders: number;
  failedOrders: number;
  orderSuccessRate: number;
  
  // Execution metrics
  totalVolume: number;
  totalValue: number;
  avgExecutionPrice: number;
  totalSlippage: number;
  avgSlippage: number;
  
  // Performance metrics
  totalPnL: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  profitFactor: number;
  sharpeRatio: number;
  
  // Latency metrics
  avgOrderLatency: number;
  p50OrderLatency: number;
  p90OrderLatency: number;
  p99OrderLatency: number;
  
  // Risk metrics
  maxDrawdown: number;
  currentExposure: number;
  varValue: number;
  
  // System metrics
  cpuUsage: number;
  memoryUsage: number;
  networkLatency: number;
  errorRate: number;
}

/**
 * Enhanced metrics aggregator
 */
export class MetricsAggregator extends EventEmitter {
  private config: MetricsAggregatorConfig;
  private logger: winston.Logger;
  private registry: Registry;
  private windows: MetricsWindow[] = [];
  private currentWindow: MetricsWindow;
  private aggregationTimer: NodeJS.Timeout | null = null;
  private exportTimer: NodeJS.Timeout | null = null;
  
  // Prometheus metrics
  private orderCounter!: Counter;
  private volumeGauge!: Gauge;
  private pnlGauge!: Gauge;
  private latencyHistogram!: Histogram;
  private slippageSummary!: Summary;
  
  constructor(
    config: MetricsAggregatorConfig,
    registry: Registry,
    logger: winston.Logger
  ) {
    super();
    
    this.config = config;
    this.registry = registry;
    this.logger = logger;
    
    // Initialize current window
    this.currentWindow = this.createNewWindow();
    
    // Initialize Prometheus metrics
    this.initializeMetrics();
    
    // Start aggregation
    this.startAggregation();
  }
  
  /**
   * Initialize Prometheus metrics
   */
  private initializeMetrics(): void {
    this.orderCounter = new Counter({
      name: 'trading_orders_total',
      help: 'Total number of trading orders',
      labelNames: ['status', 'venue', 'symbol'],
      registers: [this.registry]
    });
    
    this.volumeGauge = new Gauge({
      name: 'trading_volume_total',
      help: 'Total trading volume',
      labelNames: ['symbol', 'side'],
      registers: [this.registry]
    });
    
    this.pnlGauge = new Gauge({
      name: 'trading_pnl_total',
      help: 'Total profit and loss',
      labelNames: ['strategy', 'symbol'],
      registers: [this.registry]
    });
    
    this.latencyHistogram = new Histogram({
      name: 'trading_order_latency_ms',
      help: 'Order execution latency in milliseconds',
      labelNames: ['venue', 'orderType'],
      buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
      registers: [this.registry]
    });
    
    this.slippageSummary = new Summary({
      name: 'trading_slippage_bps',
      help: 'Trading slippage in basis points',
      labelNames: ['venue', 'symbol'],
      percentiles: [0.5, 0.9, 0.95, 0.99],
      registers: [this.registry]
    });
  }
  
  /**
   * Start aggregation timers
   */
  private startAggregation(): void {
    // Window rotation timer
    this.aggregationTimer = setInterval(() => {
      this.rotateWindow();
    }, this.config.windowSize * 1000);
    
    // Export timer
    this.exportTimer = setInterval(() => {
      this.exportMetrics();
    }, this.config.exportInterval * 1000);
  }
  
  /**
   * Create a new metrics window
   */
  private createNewWindow(): MetricsWindow {
    return {
      startTime: new Date(),
      endTime: new Date(),
      metrics: {
        totalOrders: 0,
        successfulOrders: 0,
        failedOrders: 0,
        orderSuccessRate: 0,
        totalVolume: 0,
        totalValue: 0,
        avgExecutionPrice: 0,
        totalSlippage: 0,
        avgSlippage: 0,
        totalPnL: 0,
        winningTrades: 0,
        losingTrades: 0,
        winRate: 0,
        profitFactor: 0,
        sharpeRatio: 0,
        avgOrderLatency: 0,
        p50OrderLatency: 0,
        p90OrderLatency: 0,
        p99OrderLatency: 0,
        maxDrawdown: 0,
        currentExposure: 0,
        varValue: 0,
        cpuUsage: 0,
        memoryUsage: 0,
        networkLatency: 0,
        errorRate: 0
      }
    };
  }
  
  /**
   * Rotate to a new window
   */
  private rotateWindow(): void {
    // Finalize current window
    this.currentWindow.endTime = new Date();
    this.finalizeWindow(this.currentWindow);
    
    // Add to history
    this.windows.push(this.currentWindow);
    
    // Maintain window count
    if (this.windows.length > this.config.windowCount) {
      this.windows.shift();
    }
    
    // Create new window
    this.currentWindow = this.createNewWindow();
    
    // Emit rotation event
    this.emit('windowRotated', this.currentWindow);
  }
  
  /**
   * Finalize window metrics
   */
  private finalizeWindow(window: MetricsWindow): void {
    const metrics = window.metrics;
    
    // Calculate rates and averages
    if (metrics.totalOrders > 0) {
      metrics.orderSuccessRate = metrics.successfulOrders / metrics.totalOrders;
      metrics.avgSlippage = metrics.totalSlippage / metrics.totalOrders;
    }
    
    if (metrics.totalVolume > 0) {
      metrics.avgExecutionPrice = metrics.totalValue / metrics.totalVolume;
    }
    
    const totalTrades = metrics.winningTrades + metrics.losingTrades;
    if (totalTrades > 0) {
      metrics.winRate = metrics.winningTrades / totalTrades;
    }
    
    // Calculate Sharpe ratio (simplified)
    if (this.windows.length > 0) {
      const returns = this.calculateReturns();
      metrics.sharpeRatio = this.calculateSharpeRatio(returns);
    }
  }
  
  /**
   * Record order execution
   */
  recordOrderExecution(order: {
    venue: string;
    symbol: string;
    side: 'buy' | 'sell';
    orderType: string;
    quantity: number;
    price: number;
    executedPrice: number;
    latencyMs: number;
    success: boolean;
    slippageBps?: number;
  }): void {
    const metrics = this.currentWindow.metrics;
    
    // Update counters
    metrics.totalOrders++;
    if (order.success) {
      metrics.successfulOrders++;
      this.orderCounter.inc({ status: 'success', venue: order.venue, symbol: order.symbol });
    } else {
      metrics.failedOrders++;
      this.orderCounter.inc({ status: 'failed', venue: order.venue, symbol: order.symbol });
    }
    
    // Update volume and value
    if (order.success) {
      metrics.totalVolume += order.quantity;
      metrics.totalValue += order.quantity * order.executedPrice;
      this.volumeGauge.inc({ symbol: order.symbol, side: order.side }, order.quantity);
    }
    
    // Record latency
    this.latencyHistogram.observe(
      { venue: order.venue, orderType: order.orderType },
      order.latencyMs
    );
    
    // Record slippage
    if (order.slippageBps !== undefined) {
      metrics.totalSlippage += Math.abs(order.slippageBps);
      this.slippageSummary.observe(
        { venue: order.venue, symbol: order.symbol },
        order.slippageBps
      );
    }
  }
  
  /**
   * Record trade result
   */
  recordTradeResult(trade: {
    strategy: string;
    symbol: string;
    pnl: number;
    returnPct: number;
  }): void {
    const metrics = this.currentWindow.metrics;
    
    // Update P&L
    metrics.totalPnL += trade.pnl;
    this.pnlGauge.inc({ strategy: trade.strategy, symbol: trade.symbol }, trade.pnl);
    
    // Update win/loss counts
    if (trade.pnl > 0) {
      metrics.winningTrades++;
    } else if (trade.pnl < 0) {
      metrics.losingTrades++;
    }
  }
  
  /**
   * Update system metrics
   */
  updateSystemMetrics(system: {
    cpuUsage: number;
    memoryUsage: number;
    networkLatency: number;
    errorRate: number;
  }): void {
    const metrics = this.currentWindow.metrics;
    
    // Use exponential moving average for system metrics
    const alpha = 0.1;
    metrics.cpuUsage = alpha * system.cpuUsage + (1 - alpha) * metrics.cpuUsage;
    metrics.memoryUsage = alpha * system.memoryUsage + (1 - alpha) * metrics.memoryUsage;
    metrics.networkLatency = alpha * system.networkLatency + (1 - alpha) * metrics.networkLatency;
    metrics.errorRate = alpha * system.errorRate + (1 - alpha) * metrics.errorRate;
  }
  
  /**
   * Update risk metrics
   */
  updateRiskMetrics(risk: {
    currentExposure: number;
    maxDrawdown: number;
    varValue: number;
  }): void {
    const metrics = this.currentWindow.metrics;
    
    metrics.currentExposure = risk.currentExposure;
    metrics.maxDrawdown = Math.max(metrics.maxDrawdown, risk.maxDrawdown);
    metrics.varValue = risk.varValue;
  }
  
  /**
   * Calculate returns from windows
   */
  private calculateReturns(): number[] {
    return this.windows.map(w => w.metrics.totalPnL);
  }
  
  /**
   * Calculate Sharpe ratio
   */
  private calculateSharpeRatio(returns: number[]): number {
    if (returns.length < 2) return 0;
    
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    
    if (stdDev === 0) return 0;
    
    // Annualized Sharpe ratio (assuming daily returns)
    return (mean / stdDev) * Math.sqrt(252);
  }
  
  /**
   * Export metrics
   */
  private exportMetrics(): void {
    const aggregated = this.getAggregatedMetrics();
    
    this.emit('metricsExported', aggregated);
    
    if (this.config.detailedMetrics) {
      this.logger.info('Metrics exported', {
        windowCount: this.windows.length,
        currentWindow: this.currentWindow.metrics
      });
    }
  }
  
  /**
   * Get aggregated metrics across all windows
   */
  getAggregatedMetrics(): AggregatedMetrics {
    const allWindows = [...this.windows, this.currentWindow];
    
    if (allWindows.length === 0) {
      return this.createNewWindow().metrics;
    }
    
    // Aggregate across all windows
    const aggregated: AggregatedMetrics = {
      totalOrders: 0,
      successfulOrders: 0,
      failedOrders: 0,
      orderSuccessRate: 0,
      totalVolume: 0,
      totalValue: 0,
      avgExecutionPrice: 0,
      totalSlippage: 0,
      avgSlippage: 0,
      totalPnL: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      profitFactor: 0,
      sharpeRatio: 0,
      avgOrderLatency: 0,
      p50OrderLatency: 0,
      p90OrderLatency: 0,
      p99OrderLatency: 0,
      maxDrawdown: 0,
      currentExposure: 0,
      varValue: 0,
      cpuUsage: 0,
      memoryUsage: 0,
      networkLatency: 0,
      errorRate: 0
    };
    
    // Sum up metrics
    for (const window of allWindows) {
      const m = window.metrics;
      aggregated.totalOrders += m.totalOrders;
      aggregated.successfulOrders += m.successfulOrders;
      aggregated.failedOrders += m.failedOrders;
      aggregated.totalVolume += m.totalVolume;
      aggregated.totalValue += m.totalValue;
      aggregated.totalSlippage += m.totalSlippage;
      aggregated.totalPnL += m.totalPnL;
      aggregated.winningTrades += m.winningTrades;
      aggregated.losingTrades += m.losingTrades;
      aggregated.maxDrawdown = Math.max(aggregated.maxDrawdown, m.maxDrawdown);
    }
    
    // Calculate averages
    if (aggregated.totalOrders > 0) {
      aggregated.orderSuccessRate = aggregated.successfulOrders / aggregated.totalOrders;
      aggregated.avgSlippage = aggregated.totalSlippage / aggregated.totalOrders;
    }
    
    if (aggregated.totalVolume > 0) {
      aggregated.avgExecutionPrice = aggregated.totalValue / aggregated.totalVolume;
    }
    
    const totalTrades = aggregated.winningTrades + aggregated.losingTrades;
    if (totalTrades > 0) {
      aggregated.winRate = aggregated.winningTrades / totalTrades;
    }
    
    // Use latest values for current metrics
    const latest = allWindows[allWindows.length - 1].metrics;
    aggregated.currentExposure = latest.currentExposure;
    aggregated.varValue = latest.varValue;
    aggregated.cpuUsage = latest.cpuUsage;
    aggregated.memoryUsage = latest.memoryUsage;
    aggregated.networkLatency = latest.networkLatency;
    aggregated.errorRate = latest.errorRate;
    aggregated.sharpeRatio = latest.sharpeRatio;
    
    return aggregated;
  }
  
  /**
   * Get metrics for a specific time range
   */
  getMetricsForRange(startTime: Date, endTime: Date): AggregatedMetrics[] {
    return this.windows
      .filter(w => w.startTime >= startTime && w.endTime <= endTime)
      .map(w => w.metrics);
  }
  
  /**
   * Stop aggregation
   */
  stop(): void {
    if (this.aggregationTimer) {
      clearInterval(this.aggregationTimer);
      this.aggregationTimer = null;
    }
    
    if (this.exportTimer) {
      clearInterval(this.exportTimer);
      this.exportTimer = null;
    }
  }
} 