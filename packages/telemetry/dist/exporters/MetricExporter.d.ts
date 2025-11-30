/**
 * MetricExporter - Prometheus-compatible metric export system
 *
 * Collects and exports runtime metrics with support for
 * histograms, gauges, counters, and summaries.
 */
import { EventEmitter } from 'events';
import { Logger } from 'winston';
import { MetricDefinition, MetricValue, ModuleMetrics, SystemMetrics } from '../types/telemetry';
interface MetricExporterConfig {
    prefix?: string;
    defaultLabels?: Record<string, string>;
    collectDefaultMetrics?: boolean;
    exportInterval?: number;
    exportEndpoint?: string;
    compressionEnabled?: boolean;
    timeout?: number;
    retryAttempts?: number;
    retryDelay?: number;
}
export declare class MetricExporter extends EventEmitter {
    private logger;
    private registry;
    private metrics;
    private config;
    private exportTimer;
    private moduleMetrics;
    private systemStartTime;
    private systemMetrics;
    constructor(logger: Logger, config?: MetricExporterConfig);
    /**
     * Start metric collection and export
     */
    start(): Promise<void>;
    /**
     * Stop metric collection and export
     */
    stop(): Promise<void>;
    /**
     * Register a new metric
     */
    registerMetric(definition: MetricDefinition): void;
    /**
     * Record a metric value
     */
    recordMetric(value: MetricValue): void;
    /**
     * Update module metrics
     */
    updateModuleMetrics(moduleId: string, metrics: Partial<ModuleMetrics>): void;
    /**
     * Get current system metrics
     */
    getSystemMetrics(): SystemMetrics;
    /**
     * Get metrics in Prometheus format
     */
    getMetrics(): Promise<string>;
    /**
     * Export metrics to configured endpoint
     */
    private exportMetrics;
    /**
     * Send metrics with retry logic
     */
    private sendWithRetry;
    /**
     * Send metrics to endpoint
     */
    private sendMetrics;
    /**
     * Initialize system metrics
     */
    private initializeSystemMetrics;
}
export {};
//# sourceMappingURL=MetricExporter.d.ts.map