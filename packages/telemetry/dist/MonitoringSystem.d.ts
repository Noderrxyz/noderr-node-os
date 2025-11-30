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
export declare class MonitoringSystem extends EventEmitter {
    private registry;
    private logger;
    private latencyHistogram;
    private throughputCounter;
    private sharpeRatioGauge;
    private winRateGauge;
    private slippageHistogram;
    private errorCounter;
    private capitalUtilizationGauge;
    private modelDriftGauge;
    private orderFillRateGauge;
    private drawdownGauge;
    private thresholds;
    private recentAlerts;
    private metricsBuffer;
    constructor(logger: winston.Logger);
    private initializeMetrics;
    private startMetricsCollection;
    recordLatency(operation: string, latencyMs: number, model?: string): void;
    recordThroughput(operation: string, status: 'success' | 'failure'): void;
    updateSharpeRatio(sharpe: number): void;
    updateWinRate(winRate: number): void;
    recordSlippage(slippageBps: number, venue: string, orderType: string): void;
    recordError(component: string, severity: 'low' | 'medium' | 'high' | 'critical'): void;
    updateCapitalUtilization(ratio: number): void;
    updateDrawdown(drawdownPercent: number): void;
    updateModelDrift(model: string, driftScore: number): void;
    updateOrderFillRate(venue: string, fillRate: number): void;
    getMetrics(): Promise<string>;
    private checkThresholds;
    private createAlert;
    private calculateDerivedMetrics;
    getSystemStatus(): {
        healthy: boolean;
        metrics: Record<string, number>;
        alerts: Alert[];
    };
    updateThresholds(newThresholds: Partial<MetricThresholds>): void;
    getGrafanaDashboard(): object;
}
//# sourceMappingURL=MonitoringSystem.d.ts.map