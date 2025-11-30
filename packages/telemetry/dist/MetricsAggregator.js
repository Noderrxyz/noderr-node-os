"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MetricsAggregator = void 0;
const prom_client_1 = require("prom-client");
const events_1 = require("events");
/**
 * Enhanced metrics aggregator
 */
class MetricsAggregator extends events_1.EventEmitter {
    config;
    logger;
    registry;
    windows = [];
    currentWindow;
    aggregationTimer = null;
    exportTimer = null;
    // Prometheus metrics
    orderCounter;
    volumeGauge;
    pnlGauge;
    latencyHistogram;
    slippageSummary;
    constructor(config, registry, logger) {
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
    initializeMetrics() {
        this.orderCounter = new prom_client_1.Counter({
            name: 'trading_orders_total',
            help: 'Total number of trading orders',
            labelNames: ['status', 'venue', 'symbol'],
            registers: [this.registry]
        });
        this.volumeGauge = new prom_client_1.Gauge({
            name: 'trading_volume_total',
            help: 'Total trading volume',
            labelNames: ['symbol', 'side'],
            registers: [this.registry]
        });
        this.pnlGauge = new prom_client_1.Gauge({
            name: 'trading_pnl_total',
            help: 'Total profit and loss',
            labelNames: ['strategy', 'symbol'],
            registers: [this.registry]
        });
        this.latencyHistogram = new prom_client_1.Histogram({
            name: 'trading_order_latency_ms',
            help: 'Order execution latency in milliseconds',
            labelNames: ['venue', 'orderType'],
            buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
            registers: [this.registry]
        });
        this.slippageSummary = new prom_client_1.Summary({
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
    startAggregation() {
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
    createNewWindow() {
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
    rotateWindow() {
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
    finalizeWindow(window) {
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
    recordOrderExecution(order) {
        const metrics = this.currentWindow.metrics;
        // Update counters
        metrics.totalOrders++;
        if (order.success) {
            metrics.successfulOrders++;
            this.orderCounter.inc({ status: 'success', venue: order.venue, symbol: order.symbol });
        }
        else {
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
        this.latencyHistogram.observe({ venue: order.venue, orderType: order.orderType }, order.latencyMs);
        // Record slippage
        if (order.slippageBps !== undefined) {
            metrics.totalSlippage += Math.abs(order.slippageBps);
            this.slippageSummary.observe({ venue: order.venue, symbol: order.symbol }, order.slippageBps);
        }
    }
    /**
     * Record trade result
     */
    recordTradeResult(trade) {
        const metrics = this.currentWindow.metrics;
        // Update P&L
        metrics.totalPnL += trade.pnl;
        this.pnlGauge.inc({ strategy: trade.strategy, symbol: trade.symbol }, trade.pnl);
        // Update win/loss counts
        if (trade.pnl > 0) {
            metrics.winningTrades++;
        }
        else if (trade.pnl < 0) {
            metrics.losingTrades++;
        }
    }
    /**
     * Update system metrics
     */
    updateSystemMetrics(system) {
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
    updateRiskMetrics(risk) {
        const metrics = this.currentWindow.metrics;
        metrics.currentExposure = risk.currentExposure;
        metrics.maxDrawdown = Math.max(metrics.maxDrawdown, risk.maxDrawdown);
        metrics.varValue = risk.varValue;
    }
    /**
     * Calculate returns from windows
     */
    calculateReturns() {
        return this.windows.map(w => w.metrics.totalPnL);
    }
    /**
     * Calculate Sharpe ratio
     */
    calculateSharpeRatio(returns) {
        if (returns.length < 2)
            return 0;
        const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
        const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
        const stdDev = Math.sqrt(variance);
        if (stdDev === 0)
            return 0;
        // Annualized Sharpe ratio (assuming daily returns)
        return (mean / stdDev) * Math.sqrt(252);
    }
    /**
     * Export metrics
     */
    exportMetrics() {
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
    getAggregatedMetrics() {
        const allWindows = [...this.windows, this.currentWindow];
        if (allWindows.length === 0) {
            return this.createNewWindow().metrics;
        }
        // Aggregate across all windows
        const aggregated = {
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
    getMetricsForRange(startTime, endTime) {
        return this.windows
            .filter(w => w.startTime >= startTime && w.endTime <= endTime)
            .map(w => w.metrics);
    }
    /**
     * Stop aggregation
     */
    stop() {
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
exports.MetricsAggregator = MetricsAggregator;
//# sourceMappingURL=MetricsAggregator.js.map