import { Registry, Counter, Gauge, Histogram, Summary } from 'prom-client';
import * as winston from 'winston';
import { EventEmitter } from 'events';

export interface MetricThresholds {
  latencyP50: number;
  latencyP99: number;
  sharpeRatio: number;
  winRate: number;
  slippage: number;
  errorRate: number;
}

export interface Alert {
  id: string;
  metric: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  value: number;
  threshold: number;
  timestamp: Date;
}

export class MonitoringSystem extends EventEmitter {
  private registry: Registry;
  private logger: winston.Logger;
  
  // Metrics
  private latencyHistogram!: Histogram<string>;
  private throughputCounter!: Counter<string>;
  private sharpeRatioGauge!: Gauge<string>;
  private winRateGauge!: Gauge<string>;
  private slippageHistogram!: Histogram<string>;
  private errorCounter!: Counter<string>;
  private capitalUtilizationGauge!: Gauge<string>;
  private modelDriftGauge!: Gauge<string>;
  private orderFillRateGauge!: Gauge<string>;
  private drawdownGauge!: Gauge<string>;
  
  // Alert thresholds
  private thresholds: MetricThresholds = {
    latencyP50: 25,    // ms
    latencyP99: 400,   // ms
    sharpeRatio: 2.5,
    winRate: 0.55,
    slippage: 3,       // bps
    errorRate: 0.03    // 3%
  };
  
  // Tracking
  private recentAlerts: Alert[] = [];
  private metricsBuffer: Map<string, number[]> = new Map();
  
  constructor(logger: winston.Logger) {
    super();
    this.logger = logger;
    this.registry = new Registry();
    this.initializeMetrics();
    this.startMetricsCollection();
  }
  
  private initializeMetrics(): void {
    // Latency tracking
    this.latencyHistogram = new Histogram({
      name: 'trading_latency_ms',
      help: 'Trading decision latency in milliseconds',
      labelNames: ['operation', 'model'],
      buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000],
      registers: [this.registry]
    });
    
    // Throughput
    this.throughputCounter = new Counter({
      name: 'trading_operations_total',
      help: 'Total number of trading operations',
      labelNames: ['operation', 'status'],
      registers: [this.registry]
    });
    
    // Trading performance
    this.sharpeRatioGauge = new Gauge({
      name: 'trading_sharpe_ratio',
      help: 'Current Sharpe ratio',
      registers: [this.registry]
    });
    
    this.winRateGauge = new Gauge({
      name: 'trading_win_rate',
      help: 'Current win rate',
      registers: [this.registry]
    });
    
    // Execution quality
    this.slippageHistogram = new Histogram({
      name: 'execution_slippage_bps',
      help: 'Execution slippage in basis points',
      labelNames: ['venue', 'order_type'],
      buckets: [0.1, 0.5, 1, 2, 5, 10, 20, 50],
      registers: [this.registry]
    });
    
    // System health
    this.errorCounter = new Counter({
      name: 'system_errors_total',
      help: 'Total number of system errors',
      labelNames: ['component', 'severity'],
      registers: [this.registry]
    });
    
    // Capital and risk
    this.capitalUtilizationGauge = new Gauge({
      name: 'capital_utilization_ratio',
      help: 'Current capital utilization ratio',
      registers: [this.registry]
    });
    
    this.drawdownGauge = new Gauge({
      name: 'max_drawdown_percent',
      help: 'Maximum drawdown percentage',
      registers: [this.registry]
    });
    
    // ML health
    this.modelDriftGauge = new Gauge({
      name: 'model_drift_score',
      help: 'Model drift detection score',
      labelNames: ['model'],
      registers: [this.registry]
    });
    
    // Order execution
    this.orderFillRateGauge = new Gauge({
      name: 'order_fill_rate',
      help: 'Order fill rate percentage',
      labelNames: ['venue'],
      registers: [this.registry]
    });
  }
  
  private startMetricsCollection(): void {
    // Collect metrics every second
    setInterval(() => {
      this.checkThresholds();
      this.calculateDerivedMetrics();
    }, 1000);
    
    // Clean old alerts every minute
    setInterval(() => {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      this.recentAlerts = this.recentAlerts.filter(
        alert => alert.timestamp > oneHourAgo
      );
    }, 60000);
  }
  
  // Record metrics
  recordLatency(operation: string, latencyMs: number, model?: string): void {
    this.latencyHistogram.observe(
      { operation, model: model || 'default' },
      latencyMs
    );
    
    // Buffer for percentile calculations
    const key = `latency_${operation}`;
    if (!this.metricsBuffer.has(key)) {
      this.metricsBuffer.set(key, []);
    }
    this.metricsBuffer.get(key)!.push(latencyMs);
    
    // Keep only recent 1000 samples
    const buffer = this.metricsBuffer.get(key)!;
    if (buffer.length > 1000) {
      buffer.shift();
    }
  }
  
  recordThroughput(operation: string, status: 'success' | 'failure'): void {
    this.throughputCounter.inc({ operation, status });
  }
  
  updateSharpeRatio(sharpe: number): void {
    this.sharpeRatioGauge.set(sharpe);
  }
  
  updateWinRate(winRate: number): void {
    this.winRateGauge.set(winRate);
  }
  
  recordSlippage(slippageBps: number, venue: string, orderType: string): void {
    this.slippageHistogram.observe({ venue, order_type: orderType }, slippageBps);
  }
  
  recordError(component: string, severity: 'low' | 'medium' | 'high' | 'critical'): void {
    this.errorCounter.inc({ component, severity });
  }
  
  updateCapitalUtilization(ratio: number): void {
    this.capitalUtilizationGauge.set(ratio);
  }
  
  updateDrawdown(drawdownPercent: number): void {
    this.drawdownGauge.set(drawdownPercent);
  }
  
  updateModelDrift(model: string, driftScore: number): void {
    this.modelDriftGauge.set({ model }, driftScore);
  }
  
  updateOrderFillRate(venue: string, fillRate: number): void {
    this.orderFillRateGauge.set({ venue }, fillRate);
  }
  
  // Get metrics for Prometheus
  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }
  
  // Check thresholds and generate alerts
  private checkThresholds(): void {
    // Check latency
    const latencyBuffer = this.metricsBuffer.get('latency_trading_decision');
    if (latencyBuffer && latencyBuffer.length > 0) {
      const sorted = [...latencyBuffer].sort((a, b) => a - b);
      const p50 = sorted[Math.floor(sorted.length * 0.5)];
      const p99 = sorted[Math.floor(sorted.length * 0.99)];
      
      if (p50 > this.thresholds.latencyP50) {
        this.createAlert('latency_p50', 'high', 
          `P50 latency ${p50.toFixed(1)}ms exceeds threshold ${this.thresholds.latencyP50}ms`,
          p50, this.thresholds.latencyP50
        );
      }
      
      if (p99 > this.thresholds.latencyP99) {
        this.createAlert('latency_p99', 'critical',
          `P99 latency ${p99.toFixed(1)}ms exceeds threshold ${this.thresholds.latencyP99}ms`,
          p99, this.thresholds.latencyP99
        );
      }
    }
    
    // Check Sharpe ratio
    const sharpe = (this.sharpeRatioGauge as any).hashMap[''].value;
    if (sharpe < this.thresholds.sharpeRatio) {
      this.createAlert('sharpe_ratio', 'high',
        `Sharpe ratio ${sharpe.toFixed(2)} below threshold ${this.thresholds.sharpeRatio}`,
        sharpe, this.thresholds.sharpeRatio
      );
    }
    
    // Check win rate
    const winRate = (this.winRateGauge as any).hashMap[''].value;
    if (winRate < this.thresholds.winRate) {
      this.createAlert('win_rate', 'medium',
        `Win rate ${(winRate * 100).toFixed(1)}% below threshold ${(this.thresholds.winRate * 100).toFixed(1)}%`,
        winRate, this.thresholds.winRate
      );
    }
  }
  
  private createAlert(
    metric: string,
    severity: Alert['severity'],
    message: string,
    value: number,
    threshold: number
  ): void {
    const alert: Alert = {
      id: `${metric}_${Date.now()}`,
      metric,
      severity,
      message,
      value,
      threshold,
      timestamp: new Date()
    };
    
    this.recentAlerts.push(alert);
    this.emit('alert', alert);
    
    // Log based on severity
    if (severity === 'critical') {
      this.logger.error('CRITICAL ALERT', alert);
    } else if (severity === 'high') {
      this.logger.warn('HIGH ALERT', alert);
    } else {
      this.logger.info('Alert', alert);
    }
  }
  
  private calculateDerivedMetrics(): void {
    // Calculate error rate
    const errorData = (this.errorCounter as any).hashMap;
    let totalErrors = 0;
    let totalOps = 0;
    
    for (const key in errorData) {
      totalErrors += errorData[key].value;
    }
    
    const throughputData = (this.throughputCounter as any).hashMap;
    for (const key in throughputData) {
      totalOps += throughputData[key].value;
    }
    
    if (totalOps > 0) {
      const errorRate = totalErrors / totalOps;
      if (errorRate > this.thresholds.errorRate) {
        this.createAlert('error_rate', 'high',
          `Error rate ${(errorRate * 100).toFixed(1)}% exceeds threshold ${(this.thresholds.errorRate * 100).toFixed(1)}%`,
          errorRate, this.thresholds.errorRate
        );
      }
    }
  }
  
  // Get current system status
  getSystemStatus(): {
    healthy: boolean;
    metrics: Record<string, number>;
    alerts: Alert[];
  } {
    const latencyBuffer = this.metricsBuffer.get('latency_trading_decision') || [];
    const p50 = latencyBuffer.length > 0 
      ? latencyBuffer.sort((a, b) => a - b)[Math.floor(latencyBuffer.length * 0.5)]
      : 0;
    const p99 = latencyBuffer.length > 0
      ? latencyBuffer.sort((a, b) => a - b)[Math.floor(latencyBuffer.length * 0.99)]
      : 0;
    
    const metrics = {
      latencyP50: p50,
      latencyP99: p99,
      sharpeRatio: (this.sharpeRatioGauge as any).hashMap['']?.value || 0,
      winRate: (this.winRateGauge as any).hashMap['']?.value || 0,
      capitalUtilization: (this.capitalUtilizationGauge as any).hashMap['']?.value || 0,
      maxDrawdown: (this.drawdownGauge as any).hashMap['']?.value || 0
    };
    
    const criticalAlerts = this.recentAlerts.filter(a => a.severity === 'critical');
    const healthy = criticalAlerts.length === 0 && 
                   metrics.latencyP99 < this.thresholds.latencyP99 &&
                   metrics.sharpeRatio > this.thresholds.sharpeRatio;
    
    return {
      healthy,
      metrics,
      alerts: this.recentAlerts.slice(-10) // Last 10 alerts
    };
  }
  
  // Update thresholds
  updateThresholds(newThresholds: Partial<MetricThresholds>): void {
    this.thresholds = { ...this.thresholds, ...newThresholds };
    this.logger.info('Updated monitoring thresholds', this.thresholds);
  }
  
  // Export for Grafana dashboard
  getGrafanaDashboard(): object {
    return {
      dashboard: {
        title: 'Noderr Trading System',
        panels: [
          {
            title: 'Latency Percentiles',
            targets: [
              { expr: 'histogram_quantile(0.5, trading_latency_ms)' },
              { expr: 'histogram_quantile(0.99, trading_latency_ms)' }
            ]
          },
          {
            title: 'Trading Performance',
            targets: [
              { expr: 'trading_sharpe_ratio' },
              { expr: 'trading_win_rate' }
            ]
          },
          {
            title: 'Execution Quality',
            targets: [
              { expr: 'histogram_quantile(0.5, execution_slippage_bps)' },
              { expr: 'order_fill_rate' }
            ]
          },
          {
            title: 'System Health',
            targets: [
              { expr: 'rate(system_errors_total[5m])' },
              { expr: 'capital_utilization_ratio' }
            ]
          }
        ]
      }
    };
  }
} 