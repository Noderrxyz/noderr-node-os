import * as winston from 'winston';
export interface Position {
    symbol: string;
    quantity: number;
    avgPrice: number;
    currentPrice: number;
    unrealizedPnl: number;
}
export interface RiskMetrics {
    totalExposure: number;
    var95: number;
    var99: number;
    sharpeRatio: number;
    maxDrawdown: number;
    beta: number;
    correlation: number;
}
export interface LazyMetric<T> {
    isDirty: boolean;
    value: T | null;
    lastComputed: number;
    computeTime: number;
}
/**
 * Lazy evaluation system for risk metrics
 * Only computes metrics when accessed and data has changed
 * Target: -2ms per risk check
 */
export declare class LazyRiskMetrics {
    private logger;
    private positions;
    private marketData;
    private metrics;
    private positionsVersion;
    private marketDataVersion;
    private lastComputedVersions;
    private computeCount;
    private cacheHits;
    private totalComputeTime;
    constructor(logger: winston.Logger);
    /**
     * Update position data
     */
    updatePosition(symbol: string, position: Position): void;
    /**
     * Update market data
     */
    updateMarketData(symbol: string, price: number): void;
    /**
     * Get total exposure (lazy computed)
     */
    getTotalExposure(): number;
    /**
     * Get VaR 95% (lazy computed)
     */
    getVaR95(): number;
    /**
     * Get VaR 99% (lazy computed)
     */
    getVaR99(): number;
    /**
     * Get Sharpe ratio (lazy computed)
     */
    getSharpeRatio(): number;
    /**
     * Get max drawdown (lazy computed)
     */
    getMaxDrawdown(): number;
    /**
     * Get all metrics at once
     */
    getAllMetrics(): RiskMetrics;
    /**
     * Get beta (lazy computed)
     */
    private getBeta;
    /**
     * Get correlation (lazy computed)
     */
    private getCorrelation;
    /**
     * Generic lazy computation
     */
    private getOrCompute;
    /**
     * Create a new lazy metric
     */
    private createLazyMetric;
    /**
     * Invalidate all metrics
     */
    private invalidateMetrics;
    /**
     * Invalidate only market-dependent metrics
     */
    private invalidateMarketDependentMetrics;
    /**
     * Calculate returns (simplified)
     */
    private calculateReturns;
    /**
     * Calculate portfolio values (simplified)
     */
    private calculatePortfolioValues;
    /**
     * Get performance statistics
     */
    getPerformanceStats(): {
        computeCount: number;
        cacheHits: number;
        cacheHitRate: number;
        avgComputeTime: number;
    };
}
/**
 * Benchmark for lazy risk metrics
 */
export declare class LazyRiskMetricsBenchmark {
    static runBenchmark(logger: winston.Logger): Promise<void>;
}
//# sourceMappingURL=LazyRiskMetrics.d.ts.map