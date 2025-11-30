/**
 * Tracer - OpenTelemetry distributed tracing system
 *
 * Provides comprehensive tracing with automatic instrumentation,
 * span management, and integration with MessageBus routing.
 */
import { EventEmitter } from 'events';
import { SpanKind, Context, Attributes } from '@opentelemetry/api';
import { TraceContext, SpanEvent, SpanStatus, SpanLink } from '../types/telemetry';
interface TracerConfig {
    serviceName: string;
    serviceVersion: string;
    environment: string;
    endpoint?: string;
    headers?: Record<string, string>;
    batchSize?: number;
    exportTimeout?: number;
    enableConsoleExport?: boolean;
    enableAutoInstrumentation?: boolean;
    samplingRate?: number;
}
export declare class Tracer extends EventEmitter {
    private config;
    private sdk?;
    private tracer?;
    private activeSpans;
    private spanData;
    constructor(config: TracerConfig);
    /**
     * Initialize the tracer
     */
    start(): Promise<void>;
    /**
     * Stop the tracer
     */
    stop(): Promise<void>;
    /**
     * Start a new span
     */
    startSpan(name: string, options?: {
        kind?: SpanKind;
        attributes?: Attributes;
        parentContext?: Context;
        links?: SpanLink[];
    }): string;
    /**
     * End a span
     */
    endSpan(spanId: string, status?: SpanStatus): void;
    /**
     * Add event to span
     */
    addEvent(spanId: string, event: SpanEvent): void;
    /**
     * Set span attributes
     */
    setAttributes(spanId: string, attributes: Attributes): void;
    /**
     * Get current trace context
     */
    getCurrentContext(): TraceContext | undefined;
    /**
     * Create context from headers
     */
    extractContext(headers: Record<string, string>): Context;
    /**
     * Inject context into headers
     */
    injectContext(headers: Record<string, string>): void;
    /**
     * Trace async function
     */
    traceAsync<T>(name: string, fn: () => Promise<T>, options?: {
        kind?: SpanKind;
        attributes?: Attributes;
    }): Promise<T>;
    /**
     * Trace sync function
     */
    traceSync<T>(name: string, fn: () => T, options?: {
        kind?: SpanKind;
        attributes?: Attributes;
    }): T;
    /**
     * Create span decorator
     */
    span(name?: string, options?: {
        kind?: SpanKind;
        attributes?: Attributes;
    }): (target: any, propertyKey: string, descriptor: PropertyDescriptor) => PropertyDescriptor;
    /**
     * Private: Map span kind
     */
    private mapSpanKind;
    /**
     * Private: Map status code
     */
    private mapStatusCode;
    /**
     * Private: Extract baggage
     */
    private extractBaggage;
}
export {};
//# sourceMappingURL=Tracer.d.ts.map