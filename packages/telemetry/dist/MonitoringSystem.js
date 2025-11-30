"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MonitoringSystem = void 0;
const prom_client_1 = require("prom-client");
const events_1 = require("events");
class MonitoringSystem extends events_1.EventEmitter {
    registry;
    logger;
    // Metrics
    latencyHistogram;
    throughputCounter;
    sharpeRatioGauge;
    winRateGauge;
    slippageHistogram;
    errorCounter;
    capitalUtilizationGauge;
    modelDriftGauge;
    orderFillRateGauge;
    drawdownGauge;
    // Alert thresholds
    thresholds = {
        latencyP50: 25, // ms
        latencyP99: 400, // ms
        sharpeRatio: 2.5,
        winRate: 0.55,
        slippage: 3, // bps
        errorRate: 0.03 // 3%
    };
    // Tracking
    recentAlerts = [];
    metricsBuffer = new Map();
    constructor(logger) {
        super();
        this.logger = logger;
        this.registry = new prom_client_1.Registry();
        this.initializeMetrics();
        this.startMetricsCollection();
    }
    initializeMetrics() {
        // Latency tracking
        this.latencyHistogram = new prom_client_1.Histogram({
            name: 'trading_latency_ms',
            help: 'Trading decision latency in milliseconds',
            labelNames: ['operation', 'model'],
            buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000],
            registers: [this.registry]
        });
        // Throughput
        this.throughputCounter = new prom_client_1.Counter({
            name: 'trading_operations_total',
            help: 'Total number of trading operations',
            labelNames: ['operation', 'status'],
            registers: [this.registry]
        });
        // Trading performance
        this.sharpeRatioGauge = new prom_client_1.Gauge({
            name: 'trading_sharpe_ratio',
            help: 'Current Sharpe ratio',
            registers: [this.registry]
        });
        this.winRateGauge = new prom_client_1.Gauge({
            name: 'trading_win_rate',
            help: 'Current win rate',
            registers: [this.registry]
        });
        // Execution quality
        this.slippageHistogram = new prom_client_1.Histogram({
            name: 'execution_slippage_bps',
            help: 'Execution slippage in basis points',
            labelNames: ['venue', 'order_type'],
            buckets: [0.1, 0.5, 1, 2, 5, 10, 20, 50],
            registers: [this.registry]
        });
        // System health
        this.errorCounter = new prom_client_1.Counter({
            name: 'system_errors_total',
            help: 'Total number of system errors',
            labelNames: ['component', 'severity'],
            registers: [this.registry]
        });
        // Capital and risk
        this.capitalUtilizationGauge = new prom_client_1.Gauge({
            name: 'capital_utilization_ratio',
            help: 'Current capital utilization ratio',
            registers: [this.registry]
        });
        this.drawdownGauge = new prom_client_1.Gauge({
            name: 'max_drawdown_percent',
            help: 'Maximum drawdown percentage',
            registers: [this.registry]
        });
        // ML health
        this.modelDriftGauge = new prom_client_1.Gauge({
            name: 'model_drift_score',
            help: 'Model drift detection score',
            labelNames: ['model'],
            registers: [this.registry]
        });
        // Order execution
        this.orderFillRateGauge = new prom_client_1.Gauge({
            name: 'order_fill_rate',
            help: 'Order fill rate percentage',
            labelNames: ['venue'],
            registers: [this.registry]
        });
    }
    startMetricsCollection() {
        // Collect metrics every second
        setInterval(() => {
            this.checkThresholds();
            this.calculateDerivedMetrics();
        }, 1000);
        // Clean old alerts every minute
        setInterval(() => {
            const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
            this.recentAlerts = this.recentAlerts.filter(alert => alert.timestamp > oneHourAgo);
        }, 60000);
    }
    // Record metrics
    recordLatency(operation, latencyMs, model) {
        this.latencyHistogram.observe({ operation, model: model || 'default' }, latencyMs);
        // Buffer for percentile calculations
        const key = `latency_${operation}`;
        if (!this.metricsBuffer.has(key)) {
            this.metricsBuffer.set(key, []);
        }
        this.metricsBuffer.get(key).push(latencyMs);
        // Keep only recent 1000 samples
        const buffer = this.metricsBuffer.get(key);
        if (buffer.length > 1000) {
            buffer.shift();
        }
    }
    recordThroughput(operation, status) {
        this.throughputCounter.inc({ operation, status });
    }
    updateSharpeRatio(sharpe) {
        this.sharpeRatioGauge.set(sharpe);
    }
    updateWinRate(winRate) {
        this.winRateGauge.set(winRate);
    }
    recordSlippage(slippageBps, venue, orderType) {
        this.slippageHistogram.observe({ venue, order_type: orderType }, slippageBps);
    }
    recordError(component, severity) {
        this.errorCounter.inc({ component, severity });
    }
    updateCapitalUtilization(ratio) {
        this.capitalUtilizationGauge.set(ratio);
    }
    updateDrawdown(drawdownPercent) {
        this.drawdownGauge.set(drawdownPercent);
    }
    updateModelDrift(model, driftScore) {
        this.modelDriftGauge.set({ model }, driftScore);
    }
    updateOrderFillRate(venue, fillRate) {
        this.orderFillRateGauge.set({ venue }, fillRate);
    }
    // Get metrics for Prometheus
    async getMetrics() {
        return this.registry.metrics();
    }
    // Check thresholds and generate alerts
    checkThresholds() {
        // Check latency
        const latencyBuffer = this.metricsBuffer.get('latency_trading_decision');
        if (latencyBuffer && latencyBuffer.length > 0) {
            const sorted = [...latencyBuffer].sort((a, b) => a - b);
            const p50 = sorted[Math.floor(sorted.length * 0.5)];
            const p99 = sorted[Math.floor(sorted.length * 0.99)];
            if (p50 > this.thresholds.latencyP50) {
                this.createAlert('latency_p50', 'high', `P50 latency ${p50.toFixed(1)}ms exceeds threshold ${this.thresholds.latencyP50}ms`, p50, this.thresholds.latencyP50);
            }
            if (p99 > this.thresholds.latencyP99) {
                this.createAlert('latency_p99', 'critical', `P99 latency ${p99.toFixed(1)}ms exceeds threshold ${this.thresholds.latencyP99}ms`, p99, this.thresholds.latencyP99);
            }
        }
        // Check Sharpe ratio
        const sharpe = this.sharpeRatioGauge.hashMap[''].value;
        if (sharpe < this.thresholds.sharpeRatio) {
            this.createAlert('sharpe_ratio', 'high', `Sharpe ratio ${sharpe.toFixed(2)} below threshold ${this.thresholds.sharpeRatio}`, sharpe, this.thresholds.sharpeRatio);
        }
        // Check win rate
        const winRate = this.winRateGauge.hashMap[''].value;
        if (winRate < this.thresholds.winRate) {
            this.createAlert('win_rate', 'medium', `Win rate ${(winRate * 100).toFixed(1)}% below threshold ${(this.thresholds.winRate * 100).toFixed(1)}%`, winRate, this.thresholds.winRate);
        }
    }
    createAlert(metric, severity, message, value, threshold) {
        const alert = {
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
        }
        else if (severity === 'high') {
            this.logger.warn('HIGH ALERT', alert);
        }
        else {
            this.logger.info('Alert', alert);
        }
    }
    calculateDerivedMetrics() {
        // Calculate error rate
        const errorData = this.errorCounter.hashMap;
        let totalErrors = 0;
        let totalOps = 0;
        for (const key in errorData) {
            totalErrors += errorData[key].value;
        }
        const throughputData = this.throughputCounter.hashMap;
        for (const key in throughputData) {
            totalOps += throughputData[key].value;
        }
        if (totalOps > 0) {
            const errorRate = totalErrors / totalOps;
            if (errorRate > this.thresholds.errorRate) {
                this.createAlert('error_rate', 'high', `Error rate ${(errorRate * 100).toFixed(1)}% exceeds threshold ${(this.thresholds.errorRate * 100).toFixed(1)}%`, errorRate, this.thresholds.errorRate);
            }
        }
    }
    // Get current system status
    getSystemStatus() {
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
            sharpeRatio: this.sharpeRatioGauge.hashMap['']?.value || 0,
            winRate: this.winRateGauge.hashMap['']?.value || 0,
            capitalUtilization: this.capitalUtilizationGauge.hashMap['']?.value || 0,
            maxDrawdown: this.drawdownGauge.hashMap['']?.value || 0
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
    updateThresholds(newThresholds) {
        this.thresholds = { ...this.thresholds, ...newThresholds };
        this.logger.info('Updated monitoring thresholds', this.thresholds);
    }
    // Export for Grafana dashboard
    getGrafanaDashboard() {
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
exports.MonitoringSystem = MonitoringSystem;
//# sourceMappingURL=MonitoringSystem.js.map