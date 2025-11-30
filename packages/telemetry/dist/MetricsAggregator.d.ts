import { Registry } from 'prom-client';
import { EventEmitter } from 'events';
import * as winston from 'winston';
/**
 * Metrics aggregation configuration
 */
export interface MetricsAggregatorConfig {
    windowSize: number;
    windowCount: number;
    exportInterval: number;
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
    totalOrders: number;
    successfulOrders: number;
    failedOrders: number;
    orderSuccessRate: number;
    totalVolume: number;
    totalValue: number;
    avgExecutionPrice: number;
    totalSlippage: number;
    avgSlippage: number;
    totalPnL: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number;
    profitFactor: number;
    sharpeRatio: number;
    avgOrderLatency: number;
    p50OrderLatency: number;
    p90OrderLatency: number;
    p99OrderLatency: number;
    maxDrawdown: number;
    currentExposure: number;
    varValue: number;
    cpuUsage: number;
    memoryUsage: number;
    networkLatency: number;
    errorRate: number;
}
/**
 * Enhanced metrics aggregator
 */
export declare class MetricsAggregator extends EventEmitter {
    private config;
    private logger;
    private registry;
    private windows;
    private currentWindow;
    private aggregationTimer;
    private exportTimer;
    private orderCounter;
    private volumeGauge;
    private pnlGauge;
    private latencyHistogram;
    private slippageSummary;
    constructor(config: MetricsAggregatorConfig, registry: Registry, logger: winston.Logger);
    /**
     * Initialize Prometheus metrics
     */
    private initializeMetrics;
    /**
     * Start aggregation timers
     */
    private startAggregation;
    /**
     * Create a new metrics window
     */
    private createNewWindow;
    /**
     * Rotate to a new window
     */
    private rotateWindow;
    /**
     * Finalize window metrics
     */
    private finalizeWindow;
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
    }): void;
    /**
     * Record trade result
     */
    recordTradeResult(trade: {
        strategy: string;
        symbol: string;
        pnl: number;
        returnPct: number;
    }): void;
    /**
     * Update system metrics
     */
    updateSystemMetrics(system: {
        cpuUsage: number;
        memoryUsage: number;
        networkLatency: number;
        errorRate: number;
    }): void;
    /**
     * Update risk metrics
     */
    updateRiskMetrics(risk: {
        currentExposure: number;
        maxDrawdown: number;
        varValue: number;
    }): void;
    /**
     * Calculate returns from windows
     */
    private calculateReturns;
    /**
     * Calculate Sharpe ratio
     */
    private calculateSharpeRatio;
    /**
     * Export metrics
     */
    private exportMetrics;
    /**
     * Get aggregated metrics across all windows
     */
    getAggregatedMetrics(): AggregatedMetrics;
    /**
     * Get metrics for a specific time range
     */
    getMetricsForRange(startTime: Date, endTime: Date): AggregatedMetrics[];
    /**
     * Stop aggregation
     */
    stop(): void;
}
//# sourceMappingURL=MetricsAggregator.d.ts.map