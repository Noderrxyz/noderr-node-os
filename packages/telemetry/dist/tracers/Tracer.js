"use strict";
/**
 * Tracer - OpenTelemetry distributed tracing system
 *
 * Provides comprehensive tracing with automatic instrumentation,
 * span management, and integration with MessageBus routing.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Tracer = void 0;
const events_1 = require("events");
const api_1 = require("@opentelemetry/api");
const resources_1 = require("@opentelemetry/resources");
const semantic_conventions_1 = require("@opentelemetry/semantic-conventions");
const exporter_trace_otlp_http_1 = require("@opentelemetry/exporter-trace-otlp-http");
const sdk_trace_base_1 = require("@opentelemetry/sdk-trace-base");
class Tracer extends events_1.EventEmitter {
    config;
    sdk;
    tracer;
    activeSpans = new Map();
    spanData = new Map();
    constructor(config) {
        super();
        this.config = {
            batchSize: 512,
            exportTimeout: 30000,
            enableConsoleExport: false,
            enableAutoInstrumentation: true,
            samplingRate: 1.0,
            endpoint: 'http://localhost:4318/v1/traces',
            headers: {},
            ...config
        };
    }
    /**
     * Initialize the tracer
     */
    async start() {
        const resource = resources_1.Resource.default().merge(new resources_1.Resource({
            [semantic_conventions_1.SemanticResourceAttributes.SERVICE_NAME]: this.config.serviceName,
            [semantic_conventions_1.SemanticResourceAttributes.SERVICE_VERSION]: this.config.serviceVersion,
            [semantic_conventions_1.SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: this.config.environment,
        }));
        // Create exporters
        const exporters = [];
        if (this.config.endpoint) {
            exporters.push(new sdk_trace_base_1.BatchSpanProcessor(new exporter_trace_otlp_http_1.OTLPTraceExporter({
                url: this.config.endpoint,
                headers: this.config.headers,
                timeoutMillis: this.config.exportTimeout
            }), {
                maxQueueSize: this.config.batchSize,
                scheduledDelayMillis: 5000,
                exportTimeoutMillis: this.config.exportTimeout,
                maxExportBatchSize: this.config.batchSize
            }));
        }
        if (this.config.enableConsoleExport) {
            exporters.push(new sdk_trace_base_1.SimpleSpanProcessor(new sdk_trace_base_1.ConsoleSpanExporter()));
        }
        // Initialize SDK    this.sdk = new NodeSDK({      resource,      spanProcessor: exporters.length > 0 ? exporters[0] : undefined,      instrumentations: this.config.enableAutoInstrumentation ? [        new HttpInstrumentation({          requestHook: (span, request) => {            const headers = (request as any).headers;            if (headers && headers['content-length']) {              span.setAttribute('http.request.body.size', headers['content-length']);            }          }        }),        new GrpcInstrumentation()      ] : []    });
        if (this.sdk) {
            await this.sdk.start();
        }
        // Get tracer
        this.tracer = api_1.trace.getTracer(this.config.serviceName, this.config.serviceVersion);
    }
    /**
     * Stop the tracer
     */
    async stop() {
        // End all active spans
        for (const [spanId, span] of this.activeSpans) {
            span.end();
            this.activeSpans.delete(spanId);
        }
        // Shutdown SDK
        if (this.sdk) {
            await this.sdk.shutdown();
        }
    }
    /**
     * Start a new span
     */
    startSpan(name, options) {
        if (!this.tracer) {
            throw new Error('Tracer not initialized');
        }
        const spanOptions = {
            kind: options?.kind || api_1.SpanKind.INTERNAL,
            attributes: options?.attributes,
            links: options?.links?.map(link => ({
                context: {
                    traceId: link.context.traceId,
                    spanId: link.context.spanId,
                    traceFlags: link.context.flags
                },
                attributes: link.attributes
            }))
        };
        const parentContext = options?.parentContext || api_1.context.active();
        const span = this.tracer.startSpan(name, spanOptions, parentContext);
        const spanContext = span.spanContext();
        // Store span
        this.activeSpans.set(spanContext.spanId, span);
        // Create span data
        const spanData = {
            name,
            kind: this.mapSpanKind(spanOptions.kind),
            startTime: Date.now(),
            attributes: options?.attributes || {},
            events: [],
            status: { code: 'ok' },
            links: options?.links
        };
        this.spanData.set(spanContext.spanId, spanData);
        // Make span active in context
        api_1.context.with(api_1.trace.setSpan(parentContext, span), () => { });
        this.emit('trace:started', spanData);
        return spanContext.spanId;
    }
    /**
     * End a span
     */
    endSpan(spanId, status) {
        const span = this.activeSpans.get(spanId);
        const data = this.spanData.get(spanId);
        if (!span || !data) {
            return;
        }
        // Set status
        if (status) {
            const code = this.mapStatusCode(status.code);
            span.setStatus({
                code,
                message: status.message
            });
            data.status = status;
        }
        // End span
        span.end();
        data.endTime = Date.now();
        // Clean up
        this.activeSpans.delete(spanId);
        this.spanData.delete(spanId);
        this.emit('trace:ended', data);
    }
    /**
     * Add event to span
     */
    addEvent(spanId, event) {
        const span = this.activeSpans.get(spanId);
        const data = this.spanData.get(spanId);
        if (!span || !data) {
            return;
        }
        span.addEvent(event.name, event.attributes, event.timestamp);
        data.events.push(event);
    }
    /**
     * Set span attributes
     */
    setAttributes(spanId, attributes) {
        const span = this.activeSpans.get(spanId);
        const data = this.spanData.get(spanId);
        if (!span || !data) {
            return;
        }
        span.setAttributes(attributes);
        Object.assign(data.attributes, attributes);
    }
    /**
     * Get current trace context
     */
    getCurrentContext() {
        const span = api_1.trace.getActiveSpan();
        if (!span) {
            return undefined;
        }
        const spanContext = span.spanContext();
        return {
            traceId: spanContext.traceId,
            spanId: spanContext.spanId,
            parentSpanId: undefined, // Would need to track this separately
            flags: spanContext.traceFlags,
            baggage: this.extractBaggage()
        };
    }
    /**
     * Create context from headers
     */
    extractContext(headers) {
        return api_1.propagation.extract(api_1.context.active(), headers);
    }
    /**
     * Inject context into headers
     */
    injectContext(headers) {
        api_1.propagation.inject(api_1.context.active(), headers);
    }
    /**
     * Trace async function
     */
    async traceAsync(name, fn, options) {
        const spanId = this.startSpan(name, options);
        try {
            const result = await fn();
            this.endSpan(spanId);
            return result;
        }
        catch (error) {
            this.endSpan(spanId, {
                code: 'error',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
            throw error;
        }
    }
    /**
     * Trace sync function
     */
    traceSync(name, fn, options) {
        const spanId = this.startSpan(name, options);
        try {
            const result = fn();
            this.endSpan(spanId);
            return result;
        }
        catch (error) {
            this.endSpan(spanId, {
                code: 'error',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
            throw error;
        }
    }
    /**
     * Create span decorator
     */
    span(name, options) {
        return (target, propertyKey, descriptor) => {
            const originalMethod = descriptor.value;
            const spanName = name || `${target.constructor.name}.${propertyKey}`;
            descriptor.value = async function (...args) {
                const tracer = this.tracer || this;
                if (tracer instanceof Tracer) {
                    return tracer.traceAsync(spanName, () => originalMethod.apply(this, args), options);
                }
                return originalMethod.apply(this, args);
            };
            return descriptor;
        };
    }
    /**
     * Private: Map span kind
     */
    mapSpanKind(kind) {
        switch (kind) {
            case api_1.SpanKind.SERVER:
                return 'server';
            case api_1.SpanKind.CLIENT:
                return 'client';
            case api_1.SpanKind.PRODUCER:
                return 'producer';
            case api_1.SpanKind.CONSUMER:
                return 'consumer';
            default:
                return 'internal';
        }
    }
    /**
     * Private: Map status code
     */
    mapStatusCode(code) {
        switch (code) {
            case 'ok':
                return api_1.SpanStatusCode.OK;
            case 'error':
                return api_1.SpanStatusCode.ERROR;
            default:
                return api_1.SpanStatusCode.UNSET;
        }
    }
    /**
     * Private: Extract baggage
     */
    extractBaggage() {
        const baggage = {};
        const entries = api_1.propagation.getBaggage(api_1.context.active())?.getAllEntries();
        if (entries) {
            for (const [key, entry] of entries) {
                baggage[key] = entry.value;
            }
        }
        return baggage;
    }
}
exports.Tracer = Tracer;
//# sourceMappingURL=Tracer.js.map