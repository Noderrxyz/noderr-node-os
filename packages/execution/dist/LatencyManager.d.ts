import { ExecutionRoute, RateLimit, ExecutionUrgency } from '@noderr/types';
import { Logger } from 'winston';
import EventEmitter from 'events';
interface LatencyMetrics {
    exchange: string;
    averageLatency: number;
    minLatency: number;
    maxLatency: number;
    p50: number;
    p95: number;
    p99: number;
    successRate: number;
    samples: number;
    lastUpdate: number;
}
interface NetworkRoute {
    exchange: string;
    endpoint: string;
    region: string;
    latency: number;
    reliability: number;
    priority: number;
}
interface LatencyOptimizationResult {
    routes: ExecutionRoute[];
    expectedLatency: number;
    improvements: LatencyImprovement[];
}
interface LatencyImprovement {
    exchange: string;
    originalLatency: number;
    optimizedLatency: number;
    improvement: number;
    method: string;
}
export declare class LatencyManager extends EventEmitter {
    private logger;
    private metricsCache;
    private networkRoutes;
    private rateLimits;
    private pingInterval?;
    constructor(logger: Logger);
    /**
     * Optimize routes for minimum latency
     */
    optimizeForLatency(routes: ExecutionRoute[]): Promise<ExecutionRoute[]>;
    /**
     * Measure real-time latency to exchanges
     */
    measureLatency(exchange: string): Promise<number>;
    /**
     * Get latency statistics for an exchange
     */
    getLatencyStats(exchange: string): LatencyMetrics | null;
    /**
     * Predict latency based on historical data
     */
    predictLatency(exchange: string, timeOfDay?: number): number;
    /**
     * Optimize network path selection
     */
    selectOptimalPath(exchange: string, urgency: ExecutionUrgency): Promise<NetworkRoute>;
    /**
     * Check rate limits and adjust routing
     */
    checkRateLimits(exchange: string): boolean;
    /**
     * Batch optimize multiple routes
     */
    batchOptimize(routes: ExecutionRoute[], maxParallel?: number): Promise<LatencyOptimizationResult>;
    private initializeNetworkRoutes;
    private startLatencyMonitoring;
    private performInitialMeasurements;
    private pingExchange;
    private updateLatencyMetrics;
    private findOptimalNetworkRoute;
    private testEndpoint;
    private calculateLatencyPriority;
    private createDefaultRoute;
    /**
     * Update rate limits for an exchange
     */
    updateRateLimit(exchange: string, limit: RateLimit): void;
    /**
     * Get network diagnostics
     */
    getNetworkDiagnostics(): {
        exchanges: Map<string, LatencyMetrics>;
        routes: Map<string, NetworkRoute[]>;
        issues: NetworkIssue[];
    };
    /**
     * Clean up resources
     */
    destroy(): void;
}
interface NetworkIssue {
    exchange: string;
    type: 'high_latency' | 'low_reliability' | 'rate_limited';
    severity: 'warning' | 'error';
    message: string;
}
export {};
//# sourceMappingURL=LatencyManager.d.ts.map