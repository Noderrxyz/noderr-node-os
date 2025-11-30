/**
 * Telemetry Types - Core types for system observability
 *
 * Defines metric types, log formats, tracing, and alerting structures
 * for comprehensive system monitoring.
 */
import { Histogram, Counter, Gauge, Summary } from 'prom-client';
export declare enum MetricType {
    COUNTER = "counter",
    GAUGE = "gauge",
    HISTOGRAM = "histogram",
    SUMMARY = "summary"
}
export interface MetricDefinition {
    name: string;
    type: MetricType;
    help: string;
    labelNames?: string[];
    buckets?: number[];
    percentiles?: number[];
    maxAgeSeconds?: number;
    ageBuckets?: number;
}
export interface MetricValue {
    metric: string;
    value: number;
    labels?: Record<string, string>;
    timestamp?: number;
}
export interface ModuleMetrics {
    moduleId: string;
    latency: {
        p50: number;
        p95: number;
        p99: number;
        p999: number;
    };
    throughput: {
        requestsPerSecond: number;
        messagesPerSecond: number;
    };
    errors: {
        count: number;
        rate: number;
        lastError?: string;
    };
    resources: {
        cpu: number;
        memory: number;
        connections: number;
    };
}
export interface SystemMetrics {
    timestamp: number;
    modules: Record<string, ModuleMetrics>;
    aggregate: {
        totalRequests: number;
        totalErrors: number;
        avgLatency: number;
        p99Latency: number;
        cpuUsage: number;
        memoryUsage: number;
        uptime: number;
    };
}
export declare enum LogLevel {
    DEBUG = "debug",
    INFO = "info",
    WARN = "warn",
    ERROR = "error",
    FATAL = "fatal"
}
export interface LogEntry {
    timestamp: string;
    level: LogLevel;
    module: string;
    message: string;
    correlationId?: string;
    traceId?: string;
    spanId?: string;
    metadata?: Record<string, any>;
    error?: {
        name: string;
        message: string;
        stack?: string;
    };
}
export interface LogConfig {
    level: LogLevel;
    format: 'json' | 'text';
    outputs: LogOutput[];
    fields?: Record<string, any>;
    bufferSize?: number;
    flushInterval?: number;
}
export interface LogOutput {
    type: 'console' | 'file' | 'loki' | 's3';
    level?: LogLevel;
    config: Record<string, any>;
}
export interface TraceContext {
    traceId: string;
    spanId: string;
    parentSpanId?: string;
    flags: number;
    baggage?: Record<string, string>;
}
export interface SpanData {
    name: string;
    kind: 'internal' | 'server' | 'client' | 'producer' | 'consumer';
    startTime: number;
    endTime?: number;
    attributes: Record<string, any>;
    events: SpanEvent[];
    status: SpanStatus;
    links?: SpanLink[];
}
export interface SpanEvent {
    name: string;
    timestamp: number;
    attributes?: Record<string, any>;
}
export interface SpanStatus {
    code: 'ok' | 'error' | 'cancelled';
    message?: string;
}
export interface SpanLink {
    context: TraceContext;
    attributes?: Record<string, any>;
}
export declare enum AlertSeverity {
    INFO = "info",
    WARNING = "warning",
    ERROR = "error",
    CRITICAL = "critical"
}
export interface Alert {
    id: string;
    severity: AlertSeverity;
    module: string;
    title: string;
    message: string;
    timestamp: number;
    metadata?: Record<string, any>;
    runbook?: string;
    silenced?: boolean;
    acknowledgedBy?: string;
    resolvedAt?: number;
}
export interface AlertRule {
    id: string;
    name: string;
    condition: string;
    threshold?: number;
    duration: number;
    severity: AlertSeverity;
    channels: AlertChannel[];
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
}
export interface AlertChannel {
    type: 'slack' | 'email' | 'pagerduty' | 'webhook' | 'telegram';
    config: Record<string, any>;
    filter?: {
        severities?: AlertSeverity[];
        modules?: string[];
    };
}
export interface DashboardPanel {
    id: string;
    title: string;
    type: 'graph' | 'stat' | 'gauge' | 'table' | 'heatmap';
    datasource: string;
    query: string;
    interval?: string;
    thresholds?: number[];
    unit?: string;
    decimals?: number;
}
export interface Dashboard {
    uid: string;
    title: string;
    description?: string;
    tags: string[];
    panels: DashboardPanel[];
    variables?: DashboardVariable[];
    time?: {
        from: string;
        to: string;
    };
    refresh?: string;
}
export interface DashboardVariable {
    name: string;
    type: 'query' | 'custom' | 'interval';
    query?: string;
    options?: Array<{
        text: string;
        value: string;
    }>;
    current?: {
        text: string;
        value: string;
    };
    multi?: boolean;
}
export interface MetricExport {
    contentType: string;
    data: string | Buffer;
    timestamp: number;
}
export interface ExportConfig {
    endpoint: string;
    interval: number;
    timeout: number;
    auth?: {
        type: 'basic' | 'bearer' | 'apikey';
        credentials: Record<string, string>;
    };
    headers?: Record<string, string>;
    compression?: boolean;
}
export interface TelemetryEvents {
    'metric:collected': (metric: MetricValue) => void;
    'metric:exported': (count: number) => void;
    'log:written': (entry: LogEntry) => void;
    'log:flushed': (count: number) => void;
    'trace:started': (span: SpanData) => void;
    'trace:ended': (span: SpanData) => void;
    'alert:triggered': (alert: Alert) => void;
    'alert:resolved': (alert: Alert) => void;
    'error': (error: Error) => void;
}
export interface RetentionPolicy {
    logs: {
        debug: number;
        info: number;
        warn: number;
        error: number;
    };
    metrics: {
        raw: number;
        aggregated: number;
    };
    traces: number;
}
export interface PerformanceBudget {
    latency: {
        p50: number;
        p95: number;
        p99: number;
    };
    errorRate: number;
    availability: number;
}
export type MetricInstance = Counter | Gauge | Histogram | Summary;
export interface MetricRegistry {
    [key: string]: MetricInstance;
}
//# sourceMappingURL=telemetry.d.ts.map