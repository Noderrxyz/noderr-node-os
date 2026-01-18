/**
 * MetricsCollector - Comprehensive metrics collection for Noderr Dashboard
 * 
 * Collects and standardizes metrics from all modules for unified dashboard visualization
 */

import { EventEmitter } from 'events';
import * as winston from 'winston';
import { MetricExporter } from '../exporters/MetricExporter';
import { MetricType, MetricValue } from '../types/telemetry';

interface DashboardMetrics {
  // System Health
  uptime: number;
  errorRate: number;
  openIncidents: number;
  cpuPerModule: Record<string, number>;
  memoryPerModule: Record<string, number>;
  
  // Strategy & AI
  alphaHitRate: number;
  mlDriftDaily: number;
  mlDriftWeekly: number;
  modelSwapFrequency: number;
  confidenceIntervals: { lower: number; upper: number };
  sharpeRatio: number;
  
  // Execution & Routing
  fillRate: number;
  slippageBps: number;
  routingLatencyMs: number;
  twapVwapComparison: number;
  executionLatencyMs: Record<string, number>;
  
  // Risk & Capital
  currentVaR: number;
  currentCVaR: number;
  realizedVolatility: number;
  positionLimits: Record<string, number>;
  tailRiskScenarios: Array<{ scenario: string; impact: number }>;
  drawdownPercent: number;
  
  // P&L & Attribution
  pnl24h: { live: number; paper: number; backtest: number };
  pnl7d: { live: number; paper: number; backtest: number };
  pnl30d: { live: number; paper: number; backtest: number };
  realizedPnL: number;
  unrealizedPnL: number;
  pnlByAsset: Record<string, number>;
  pnlByStrategy: Record<string, number>;
  
  // Model Performance
  signalDriftScore: Record<string, number>;
  modelAccuracy: Record<string, number>;
  predictionConfidence: Record<string, number>;
  
  // System Performance
  systemHealthScore: number;
  messageQueueDepth: number;
  eventLoopLag: number;
  activeConnections: number;
}

export class MetricsCollector extends EventEmitter {
  private logger: winston.Logger;
  private exporter: MetricExporter;
  private metrics: Partial<DashboardMetrics> = {};
  private updateInterval: NodeJS.Timeout | null = null;
  
  constructor(logger: winston.Logger, exporter: MetricExporter) {
    super();
    this.logger = logger;
    this.exporter = exporter;
    this.registerAllMetrics();
  }
  
  /**
   * Register all dashboard metrics with Prometheus
   */
  private registerAllMetrics(): void {
    // System Health Metrics
    this.exporter.registerMetric({
      name: 'system_uptime_seconds',
      type: MetricType.GAUGE,
      help: 'System uptime in seconds',
      labelNames: []
    });
    
    this.exporter.registerMetric({
      name: 'error_rate_percent',
      type: MetricType.GAUGE,
      help: 'Error rate percentage',
      labelNames: ['module']
    });
    
    this.exporter.registerMetric({
      name: 'open_incidents_total',
      type: MetricType.GAUGE,
      help: 'Number of open incidents',
      labelNames: ['severity']
    });
    
    // Strategy & AI Metrics
    this.exporter.registerMetric({
      name: 'alpha_hit_rate',
      type: MetricType.GAUGE,
      help: 'Alpha strategy hit rate',
      labelNames: ['module']
    });
    
    this.exporter.registerMetric({
      name: 'ml_drift_score',
      type: MetricType.GAUGE,
      help: 'ML model drift score',
      labelNames: ['model', 'timeframe']
    });
    
    this.exporter.registerMetric({
      name: 'model_swap_frequency',
      type: MetricType.COUNTER,
      help: 'Number of model swaps',
      labelNames: ['model']
    });
    
    this.exporter.registerMetric({
      name: 'sharpe_ratio',
      type: MetricType.GAUGE,
      help: 'Current Sharpe ratio',
      labelNames: ['module', 'strategy']
    });
    
    // Execution Metrics
    this.exporter.registerMetric({
      name: 'execution_latency_ms',
      type: MetricType.HISTOGRAM,
      help: 'Execution latency in milliseconds',
      labelNames: ['module', 'venue'],
      buckets: [0.1, 0.5, 1, 2, 5, 10, 25, 50, 100, 250, 500, 1000]
    });
    
    this.exporter.registerMetric({
      name: 'fill_rate_percent',
      type: MetricType.GAUGE,
      help: 'Order fill rate percentage',
      labelNames: ['venue', 'order_type']
    });
    
    this.exporter.registerMetric({
      name: 'slippage_bps',
      type: MetricType.HISTOGRAM,
      help: 'Execution slippage in basis points',
      labelNames: ['venue', 'order_type'],
      buckets: [0, 1, 2, 5, 10, 20, 50, 100]
    });
    
    // Risk Metrics
    this.exporter.registerMetric({
      name: 'var_usd',
      type: MetricType.GAUGE,
      help: 'Value at Risk in USD',
      labelNames: ['confidence_level', 'timeframe']
    });
    
    this.exporter.registerMetric({
      name: 'cvar_usd',
      type: MetricType.GAUGE,
      help: 'Conditional Value at Risk in USD',
      labelNames: ['confidence_level', 'timeframe']
    });
    
    this.exporter.registerMetric({
      name: 'realized_volatility',
      type: MetricType.GAUGE,
      help: 'Realized volatility',
      labelNames: ['asset', 'timeframe']
    });
    
    this.exporter.registerMetric({
      name: 'drawdown_percent',
      type: MetricType.GAUGE,
      help: 'Current drawdown percentage',
      labelNames: ['portfolio']
    });
    
    // P&L Metrics
    this.exporter.registerMetric({
      name: 'pnl_24h',
      type: MetricType.GAUGE,
      help: '24-hour P&L',
      labelNames: ['mode'] // live, paper, backtest
    });
    
    this.exporter.registerMetric({
      name: 'pnl_7d',
      type: MetricType.GAUGE,
      help: '7-day P&L',
      labelNames: ['mode']
    });
    
    this.exporter.registerMetric({
      name: 'pnl_30d',
      type: MetricType.GAUGE,
      help: '30-day P&L',
      labelNames: ['mode']
    });
    
    this.exporter.registerMetric({
      name: 'pnl_by_asset',
      type: MetricType.GAUGE,
      help: 'P&L by asset',
      labelNames: ['asset']
    });
    
    this.exporter.registerMetric({
      name: 'pnl_by_strategy',
      type: MetricType.GAUGE,
      help: 'P&L by strategy',
      labelNames: ['strategy']
    });
    
    // Model Performance Metrics
    this.exporter.registerMetric({
      name: 'signal_drift_score',
      type: MetricType.GAUGE,
      help: 'Signal drift score',
      labelNames: ['model']
    });
    
    this.exporter.registerMetric({
      name: 'model_accuracy',
      type: MetricType.GAUGE,
      help: 'Model accuracy percentage',
      labelNames: ['model']
    });
    
    this.exporter.registerMetric({
      name: 'prediction_confidence',
      type: MetricType.GAUGE,
      help: 'Model prediction confidence',
      labelNames: ['model']
    });
    
    // System Performance
    this.exporter.registerMetric({
      name: 'system_health_score',
      type: MetricType.GAUGE,
      help: 'Overall system health score (0-100)',
      labelNames: ['module']
    });
    
    this.exporter.registerMetric({
      name: 'message_queue_depth',
      type: MetricType.GAUGE,
      help: 'Message queue depth',
      labelNames: ['queue', 'priority']
    });
    
    this.exporter.registerMetric({
      name: 'event_loop_lag_ms',
      type: MetricType.GAUGE,
      help: 'Event loop lag in milliseconds',
      labelNames: ['module']
    });
  }
  
  /**
   * Start collecting metrics from all modules
   */
  async start(): Promise<void> {
    this.logger.info('Starting MetricsCollector');
    
    // Update metrics every 5 seconds
    this.updateInterval = setInterval(() => {
      this.collectAllMetrics().catch(err => 
        this.logger.error('Failed to collect metrics', { error: err })
      );
    }, 5000);
    
    // Collect initial metrics
    await this.collectAllMetrics();
  }
  
  /**
   * Stop collecting metrics
   */
  async stop(): Promise<void> {
    this.logger.info('Stopping MetricsCollector');
    
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }
  
  /**
   * Collect all metrics from modules
   */
  private async collectAllMetrics(): Promise<void> {
    await Promise.all([
      this.collectSystemHealthMetrics(),
      this.collectStrategyMetrics(),
      this.collectExecutionMetrics(),
      this.collectRiskMetrics(),
      this.collectPnLMetrics(),
      this.collectModelMetrics(),
      this.collectPerformanceMetrics()
    ]);
    
    this.emit('metrics:collected', this.metrics);
  }
  
  /**
   * Collect system health metrics
   */
  private async collectSystemHealthMetrics(): Promise<void> {
    const uptime = process.uptime();
    this.recordMetric('system_uptime_seconds', uptime);
    
    // Calculate error rate from telemetry data
    const errorRate = await this.calculateErrorRate();
    this.recordMetric('error_rate_percent', errorRate);
    
    // Get open incidents (mock for now)
    const openIncidents = await this.getOpenIncidentCount();
    this.recordMetric('open_incidents_total', openIncidents, { severity: 'all' });
    
    // Collect CPU/Memory per module
    const moduleMetrics = await this.getModuleResourceMetrics();
    for (const [module, metrics] of Object.entries(moduleMetrics)) {
      this.recordMetric('cpu_usage_percent', metrics.cpu, { module });
      this.recordMetric('memory_usage_bytes', metrics.memory, { module });
    }
    
    // Calculate overall health score
    const healthScore = this.calculateSystemHealthScore(uptime, errorRate, openIncidents);
    this.recordMetric('system_health_score', healthScore, { module: 'integration-layer' });
  }
  
  /**
   * Collect strategy and AI metrics
   */
  private async collectStrategyMetrics(): Promise<void> {
    // Alpha hit rate from alpha-exploitation module
    const alphaHitRate = await this.getAlphaHitRate();
    this.recordMetric('alpha_hit_rate', alphaHitRate, { module: 'alpha-exploitation' });
    
    // ML drift scores
    const driftScores = await this.getMLDriftScores();
    this.recordMetric('ml_drift_score', driftScores.daily, { model: 'transformer', timeframe: 'daily' });
    this.recordMetric('ml_drift_score', driftScores.weekly, { model: 'transformer', timeframe: 'weekly' });
    
    // Sharpe ratio
    const sharpeRatio = await this.getSharpeRatio();
    this.recordMetric('sharpe_ratio', sharpeRatio, { module: 'ai-core', strategy: 'combined' });
  }
  
  /**
   * Collect execution metrics
   */
  private async collectExecutionMetrics(): Promise<void> {
    // Execution latency
    const latencies = await this.getExecutionLatencies();
    for (const [venue, latency] of Object.entries(latencies)) {
      this.recordMetric('execution_latency_ms', latency, { module: 'execution-optimizer', venue });
    }
    
    // Fill rate
    const fillRate = await this.getFillRate();
    this.recordMetric('fill_rate_percent', fillRate, { venue: 'all', order_type: 'all' });
    
    // Slippage
    const slippage = await this.getSlippageBps();
    this.recordMetric('slippage_bps', slippage, { venue: 'all', order_type: 'market' });
  }
  
  /**
   * Collect risk metrics
   */
  private async collectRiskMetrics(): Promise<void> {
    // VaR and CVaR
    const var95 = await this.getVaR(0.95);
    const cvar95 = await this.getCVaR(0.95);
    
    this.recordMetric('var_usd', var95, { confidence_level: '95', timeframe: '1d' });
    this.recordMetric('cvar_usd', cvar95, { confidence_level: '95', timeframe: '1d' });
    
    // Realized volatility
    const volatility = await this.getRealizedVolatility();
    this.recordMetric('realized_volatility', volatility, { asset: 'portfolio', timeframe: '30d' });
    
    // Drawdown
    const drawdown = await this.getDrawdownPercent();
    this.recordMetric('drawdown_percent', drawdown, { portfolio: 'default' });
  }
  
  /**
   * Collect P&L metrics
   */
  private async collectPnLMetrics(): Promise<void> {
    // 24h P&L for each mode
    const pnl24h = await this.getPnL24h();
    this.recordMetric('pnl_24h', pnl24h.live, { mode: 'live' });
    this.recordMetric('pnl_24h', pnl24h.paper, { mode: 'paper' });
    this.recordMetric('pnl_24h', pnl24h.backtest, { mode: 'backtest' });
    
    // 7d P&L
    const pnl7d = await this.getPnL7d();
    this.recordMetric('pnl_7d', pnl7d.live, { mode: 'live' });
    this.recordMetric('pnl_7d', pnl7d.paper, { mode: 'paper' });
    this.recordMetric('pnl_7d', pnl7d.backtest, { mode: 'backtest' });
    
    // 30d P&L
    const pnl30d = await this.getPnL30d();
    this.recordMetric('pnl_30d', pnl30d.live, { mode: 'live' });
    this.recordMetric('pnl_30d', pnl30d.paper, { mode: 'paper' });
    this.recordMetric('pnl_30d', pnl30d.backtest, { mode: 'backtest' });
    
    // P&L by asset
    const pnlByAsset = await this.getPnLByAsset();
    for (const [asset, pnl] of Object.entries(pnlByAsset)) {
      this.recordMetric('pnl_by_asset', pnl, { asset });
    }
    
    // P&L by strategy
    const pnlByStrategy = await this.getPnLByStrategy();
    for (const [strategy, pnl] of Object.entries(pnlByStrategy)) {
      this.recordMetric('pnl_by_strategy', pnl, { strategy });
    }
  }
  
  /**
   * Collect model performance metrics
   */
  private async collectModelMetrics(): Promise<void> {
    // Signal drift scores
    const driftScores = await this.getSignalDriftScores();
    for (const [model, score] of Object.entries(driftScores)) {
      this.recordMetric('signal_drift_score', score, { model });
    }
    
    // Model accuracy
    const accuracies = await this.getModelAccuracies();
    for (const [model, accuracy] of Object.entries(accuracies)) {
      this.recordMetric('model_accuracy', accuracy, { model });
    }
    
    // Prediction confidence
    const confidences = await this.getPredictionConfidences();
    for (const [model, confidence] of Object.entries(confidences)) {
      this.recordMetric('prediction_confidence', confidence, { model });
    }
  }
  
  /**
   * Collect system performance metrics
   */
  private async collectPerformanceMetrics(): Promise<void> {
    // Message queue depth
    const queueDepths = await this.getMessageQueueDepths();
    for (const [queue, depth] of Object.entries(queueDepths)) {
      this.recordMetric('message_queue_depth', depth, { queue, priority: 'all' });
    }
    
    // Event loop lag
    const eventLoopLag = await this.getEventLoopLag();
    this.recordMetric('event_loop_lag_ms', eventLoopLag, { module: 'all' });
  }
  
  /**
   * Record a metric value
   */
  private recordMetric(name: string, value: number, labels?: Record<string, string>): void {
    this.exporter.recordMetric({
      metric: name,
      value,
      ...(labels && { labels })
    });
  }
  
  // Helper methods to fetch actual metrics from modules
  // These would connect to the actual module APIs/services
  
  private async calculateErrorRate(): Promise<number> {
    // TODO: Implement actual error rate calculation
    return Math.random() * 2; // Mock: 0-2% error rate
  }
  
  private async getOpenIncidentCount(): Promise<number> {
    // TODO: Connect to incident management system
    return Math.floor(Math.random() * 5); // Mock: 0-5 incidents
  }
  
  private async getModuleResourceMetrics(): Promise<Record<string, { cpu: number; memory: number }>> {
    // TODO: Collect actual metrics from each module
    return {
      'risk-engine': { cpu: 15 + Math.random() * 10, memory: 512 * 1024 * 1024 },
      'market-intelligence': { cpu: 20 + Math.random() * 15, memory: 768 * 1024 * 1024 },
      'execution-optimizer': { cpu: 10 + Math.random() * 5, memory: 256 * 1024 * 1024 },
      'ai-core': { cpu: 60 + Math.random() * 20, memory: 2048 * 1024 * 1024 },
      'alpha-exploitation': { cpu: 25 + Math.random() * 10, memory: 512 * 1024 * 1024 }
    };
  }
  
  private calculateSystemHealthScore(uptime: number, errorRate: number, incidents: number): number {
    // Simple health score calculation
    let score = 100;
    score -= errorRate * 10; // -10 points per 1% error rate
    score -= incidents * 5; // -5 points per incident
    score -= uptime < 3600 ? 20 : 0; // -20 points if uptime < 1 hour
    return Math.max(0, Math.min(100, score));
  }
  
  private async getAlphaHitRate(): Promise<number> {
    // TODO: Connect to alpha-exploitation module
    return 80 + Math.random() * 15; // Mock: 80-95% hit rate
  }
  
  private async getMLDriftScores(): Promise<{ daily: number; weekly: number }> {
    // TODO: Connect to AI core module
    return {
      daily: Math.random() * 10, // Mock: 0-10% drift
      weekly: Math.random() * 20 // Mock: 0-20% drift
    };
  }
  
  private async getSharpeRatio(): Promise<number> {
    // TODO: Connect to quant research module
    return 2.5 + Math.random() * 1.5; // Mock: 2.5-4.0 Sharpe
  }
  
  private async getExecutionLatencies(): Promise<Record<string, number>> {
    // TODO: Connect to execution optimizer
    return {
      'binance': 0.5 + Math.random() * 0.5,
      'coinbase': 0.8 + Math.random() * 0.7,
      'kraken': 1.0 + Math.random() * 1.0,
      'uniswap': 2.0 + Math.random() * 3.0
    };
  }
  
  private async getFillRate(): Promise<number> {
    // TODO: Connect to execution optimizer
    return 95 + Math.random() * 4; // Mock: 95-99% fill rate
  }
  
  private async getSlippageBps(): Promise<number> {
    // TODO: Connect to execution optimizer
    return Math.random() * 5; // Mock: 0-5 bps
  }
  
  private async getVaR(confidence: number): Promise<number> {
    // TODO: Connect to risk engine
    return -50000 - Math.random() * 50000; // Mock: -$50k to -$100k
  }
  
  private async getCVaR(confidence: number): Promise<number> {
    // TODO: Connect to risk engine
    return -75000 - Math.random() * 75000; // Mock: -$75k to -$150k
  }
  
  private async getRealizedVolatility(): Promise<number> {
    // TODO: Connect to risk engine
    return 0.2 + Math.random() * 0.3; // Mock: 20-50% annualized vol
  }
  
  private async getDrawdownPercent(): Promise<number> {
    // TODO: Connect to risk engine
    return Math.random() * 10; // Mock: 0-10% drawdown
  }
  
  private async getPnL24h(): Promise<{ live: number; paper: number; backtest: number }> {
    // TODO: Connect to actual P&L tracking
    return {
      live: -5000 + Math.random() * 15000, // Mock: -$5k to +$10k
      paper: -2000 + Math.random() * 8000,
      backtest: 1000 + Math.random() * 5000
    };
  }
  
  private async getPnL7d(): Promise<{ live: number; paper: number; backtest: number }> {
    // TODO: Connect to actual P&L tracking
    return {
      live: -10000 + Math.random() * 50000, // Mock: -$10k to +$40k
      paper: -5000 + Math.random() * 30000,
      backtest: 5000 + Math.random() * 20000
    };
  }
  
  private async getPnL30d(): Promise<{ live: number; paper: number; backtest: number }> {
    // TODO: Connect to actual P&L tracking
    return {
      live: -20000 + Math.random() * 150000, // Mock: -$20k to +$130k
      paper: -10000 + Math.random() * 100000,
      backtest: 20000 + Math.random() * 80000
    };
  }
  
  private async getPnLByAsset(): Promise<Record<string, number>> {
    // TODO: Connect to P&L attribution system
    return {
      'BTC': 25000 + Math.random() * 50000,
      'ETH': 15000 + Math.random() * 30000,
      'SOL': 5000 + Math.random() * 10000,
      'AVAX': -2000 + Math.random() * 8000
    };
  }
  
  private async getPnLByStrategy(): Promise<Record<string, number>> {
    // TODO: Connect to strategy attribution
    return {
      'arbitrage': 30000 + Math.random() * 20000,
      'market-making': 15000 + Math.random() * 15000,
      'trend-following': -5000 + Math.random() * 25000,
      'mean-reversion': 5000 + Math.random() * 10000
    };
  }
  
  private async getSignalDriftScores(): Promise<Record<string, number>> {
    // TODO: Connect to AI core
    return {
      'transformer': Math.random() * 15,
      'lstm': Math.random() * 20,
      'ensemble': Math.random() * 10
    };
  }
  
  private async getModelAccuracies(): Promise<Record<string, number>> {
    // TODO: Connect to AI core
    return {
      'transformer': 90 + Math.random() * 8,
      'lstm': 85 + Math.random() * 10,
      'ensemble': 92 + Math.random() * 6
    };
  }
  
  private async getPredictionConfidences(): Promise<Record<string, number>> {
    // TODO: Connect to AI core
    return {
      'transformer': 0.8 + Math.random() * 0.15,
      'lstm': 0.75 + Math.random() * 0.2,
      'ensemble': 0.85 + Math.random() * 0.1
    };
  }
  
  private async getMessageQueueDepths(): Promise<Record<string, number>> {
    // TODO: Connect to message bus
    return {
      'orders': Math.floor(Math.random() * 100),
      'market-data': Math.floor(Math.random() * 1000),
      'signals': Math.floor(Math.random() * 50)
    };
  }
  
  private async getEventLoopLag(): Promise<number> {
    // Measure actual event loop lag
    return new Promise((resolve) => {
      const start = Date.now();
      setImmediate(() => {
        resolve(Date.now() - start);
      });
    });
  }
} 