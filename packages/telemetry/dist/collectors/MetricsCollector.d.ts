/**
 * MetricsCollector - Comprehensive metrics collection for Noderr Dashboard
 *
 * Collects and standardizes metrics from all modules for unified dashboard visualization
 */
import { EventEmitter } from 'events';
import { Logger } from 'winston';
import { MetricExporter } from '../exporters/MetricExporter';
export declare class MetricsCollector extends EventEmitter {
    private logger;
    private exporter;
    private metrics;
    private updateInterval;
    constructor(logger: Logger, exporter: MetricExporter);
    /**
     * Register all dashboard metrics with Prometheus
     */
    private registerAllMetrics;
    /**
     * Start collecting metrics from all modules
     */
    start(): Promise<void>;
    /**
     * Stop collecting metrics
     */
    stop(): Promise<void>;
    /**
     * Collect all metrics from modules
     */
    private collectAllMetrics;
    /**
     * Collect system health metrics
     */
    private collectSystemHealthMetrics;
    /**
     * Collect strategy and AI metrics
     */
    private collectStrategyMetrics;
    /**
     * Collect execution metrics
     */
    private collectExecutionMetrics;
    /**
     * Collect risk metrics
     */
    private collectRiskMetrics;
    /**
     * Collect P&L metrics
     */
    private collectPnLMetrics;
    /**
     * Collect model performance metrics
     */
    private collectModelMetrics;
    /**
     * Collect system performance metrics
     */
    private collectPerformanceMetrics;
    /**
     * Record a metric value
     */
    private recordMetric;
    private calculateErrorRate;
    private getOpenIncidentCount;
    private getModuleResourceMetrics;
    private calculateSystemHealthScore;
    private getAlphaHitRate;
    private getMLDriftScores;
    private getSharpeRatio;
    private getExecutionLatencies;
    private getFillRate;
    private getSlippageBps;
    private getVaR;
    private getCVaR;
    private getRealizedVolatility;
    private getDrawdownPercent;
    private getPnL24h;
    private getPnL7d;
    private getPnL30d;
    private getPnLByAsset;
    private getPnLByStrategy;
    private getSignalDriftScores;
    private getModelAccuracies;
    private getPredictionConfidences;
    private getMessageQueueDepths;
    private getEventLoopLag;
}
//# sourceMappingURL=MetricsCollector.d.ts.map