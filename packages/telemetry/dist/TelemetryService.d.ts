/**
 * TelemetryService - Main orchestration service for system observability
 *
 * Coordinates metrics collection, logging, tracing, and alerting
 * to provide comprehensive system monitoring.
 */
import { EventEmitter } from 'events';
import { Logger } from 'winston';
import { MetricDefinition, MetricValue, ModuleMetrics, SystemMetrics, LogLevel, Alert, AlertRule, AlertChannel, Dashboard, TraceContext, SpanData } from './types/telemetry';
interface TelemetryServiceConfig {
    serviceName: string;
    environment: string;
    version: string;
    metrics?: {
        enabled: boolean;
        endpoint?: string;
        interval?: number;
        port?: number;
    };
    logging?: {
        enabled: boolean;
        level?: LogLevel;
        outputs?: Array<{
            type: 'console' | 'file' | 'loki' | 's3';
            config: Record<string, any>;
        }>;
    };
    tracing?: {
        enabled: boolean;
        endpoint?: string;
        sampleRate?: number;
    };
    alerting?: {
        enabled: boolean;
        channels?: AlertChannel[];
        rules?: AlertRule[];
    };
}
export declare class TelemetryService extends EventEmitter {
    private logger;
    private config;
    private metricExporter?;
    private metricsCollector?;
    private logBridge?;
    private tracer?;
    private alertRouter?;
    private metricsServer?;
    private healthStatus;
    private startTime;
    constructor(logger: Logger, config: TelemetryServiceConfig);
    /**
     * Initialize telemetry components
     */
    initialize(): Promise<void>;
    /**
     * Start telemetry services
     */
    start(): Promise<void>;
    /**
     * Stop telemetry services
     */
    stop(): Promise<void>;
    /**
     * Register a metric
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
     * Get system metrics
     */
    getSystemMetrics(): SystemMetrics | null;
    /**
     * Log a message
     */
    log(level: LogLevel, module: string, message: string, metadata?: Record<string, any>): void;
    /**
     * Convenience logging methods
     */
    debug(module: string, message: string, metadata?: Record<string, any>): void;
    info(module: string, message: string, metadata?: Record<string, any>): void;
    warn(module: string, message: string, metadata?: Record<string, any>): void;
    logError(module: string, message: string, metadata?: Record<string, any>): void;
    /**
     * Start a trace span
     */
    startSpan(name: string, options?: any): string | null;
    /**
     * End a trace span
     */
    endSpan(spanId: string, status?: any): void;
    /**
     * Set trace context
     */
    setTraceContext(context: TraceContext): void;
    /**
     * Trigger an alert
     */
    triggerAlert(alert: Alert): Promise<void>;
    /**
     * Add alert rule
     */
    addAlertRule(rule: AlertRule): void;
    /**
     * Get health status
     */
    getHealthStatus(): Record<string, any>;
    /**
     * Get telemetry dashboard
     */
    getDashboard(): Dashboard;
    /**
     * Initialize metrics collection
     */
    private initializeMetrics;
    /**
     * Initialize logging
     */
    private initializeLogging;
    /**
     * Initialize tracing
     */
    private initializeTracing;
    /**
     * Initialize alerting
     */
    private initializeAlerting;
    /**
     * Start metrics server
     */
    private startMetricsServer;
    /**
     * Setup internal monitoring
     */
    private setupInternalMonitoring;
    'metric:collected': (metric: MetricValue) => void;
    'metric:exported': (count: number) => void;
    'log:written': (entry: any) => void;
    'log:flushed': (count: number) => void;
    'trace:started': (span: SpanData) => void;
    'trace:ended': (span: SpanData) => void;
    'alert:triggered': (alert: Alert) => void;
    'alert:resolved': (alert: Alert) => void;
    'error': (error: Error) => void;
}
export {};
//# sourceMappingURL=TelemetryService.d.ts.map