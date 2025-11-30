import { Registry } from 'prom-client';
import { EventEmitter } from 'events';
import * as winston from 'winston';
/**
 * Latency threshold configuration
 */
export interface LatencyThresholds {
    p50Warning: number;
    p50Critical: number;
    p90Warning: number;
    p90Critical: number;
    p99Warning: number;
    p99Critical: number;
    p999Warning: number;
    p999Critical: number;
}
/**
 * Latency alert event
 */
export interface LatencyAlert {
    operation: string;
    percentile: string;
    value: number;
    threshold: number;
    severity: 'warning' | 'critical';
    timestamp: Date;
}
/**
 * Enhanced latency tracker with HDR histograms
 */
export declare class EnhancedLatencyTracker extends EventEmitter {
    private hdrHistograms;
    private promHistograms;
    private latencyCounters;
    private currentLatencyGauges;
    private thresholds;
    private registry;
    private logger;
    private checkInterval;
    constructor(registry: Registry, logger: winston.Logger, checkIntervalMs?: number);
    /**
     * Configure thresholds for an operation
     */
    configureThresholds(operation: string, thresholds: LatencyThresholds): void;
    /**
     * Record a latency measurement
     */
    recordLatency(operation: string, latencyUs: number): void;
    /**
     * Get percentile latencies for an operation
     */
    getPercentiles(operation: string): LatencyPercentiles | null;
    /**
     * Check thresholds and emit alerts
     */
    private checkThresholds;
    /**
     * Check a single percentile against thresholds
     */
    private checkPercentileThreshold;
    /**
     * Export histogram data for analysis
     */
    exportHistogram(operation: string): HistogramExport | null;
    /**
     * Reset histograms for an operation
     */
    reset(operation: string): void;
    /**
     * Reset all histograms
     */
    resetAll(): void;
    /**
     * Cleanup resources
     */
    destroy(): void;
}
/**
 * Latency percentiles
 */
export interface LatencyPercentiles {
    p50: number;
    p90: number;
    p95: number;
    p99: number;
    p999: number;
    p9999: number;
    max: number;
    min: number;
    mean: number;
    stdDev: number;
    count: number;
}
/**
 * Histogram export format
 */
export interface HistogramExport {
    operation: string;
    timestamp: Date;
    totalCount: number;
    min: number;
    max: number;
    mean: number;
    stdDev: number;
    percentiles: Array<{
        percentile: number;
        value: number;
    }>;
}
//# sourceMappingURL=LatencyTracker.d.ts.map