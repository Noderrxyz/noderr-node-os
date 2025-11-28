/**
 * Tracer - OpenTelemetry distributed tracing system
 * 
 * Provides comprehensive tracing with automatic instrumentation,
 * span management, and integration with MessageBus routing.
 */

import { EventEmitter } from 'events';
import { 
  trace, 
  context, 
  SpanKind, 
  SpanStatusCode,
  Span as OTelSpan,
  Tracer as OTelTracer,
  Context,
  propagation,
  SpanOptions,
  Attributes
} from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { 
  OTLPTraceExporter 
} from '@opentelemetry/exporter-trace-otlp-http';
import { 
  BatchSpanProcessor,
  ConsoleSpanExporter,
  SimpleSpanProcessor
} from '@opentelemetry/sdk-trace-base';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { GrpcInstrumentation } from '@opentelemetry/instrumentation-grpc';
import {
  TraceContext,
  SpanData,
  SpanEvent,
  SpanStatus,
  SpanLink
} from '@noderr/types/telemetry';

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

export class Tracer extends EventEmitter {
  private config: Required<TracerConfig>;
  private sdk?: NodeSDK;
  private tracer?: OTelTracer;
  private activeSpans: Map<string, OTelSpan> = new Map();
  private spanData: Map<string, SpanData> = new Map();
  
  constructor(config: TracerConfig) {
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
  async start(): Promise<void> {
    const resource = Resource.default().merge(
      new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: this.config.serviceName,
        [SemanticResourceAttributes.SERVICE_VERSION]: this.config.serviceVersion,
        [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: this.config.environment,
      })
    );
    
    // Create exporters
    const exporters = [];
    
    if (this.config.endpoint) {
      exporters.push(
        new BatchSpanProcessor(
          new OTLPTraceExporter({
            url: this.config.endpoint,
            headers: this.config.headers,
            timeoutMillis: this.config.exportTimeout
          }),
          {
            maxQueueSize: this.config.batchSize,
            scheduledDelayMillis: 5000,
            exportTimeoutMillis: this.config.exportTimeout,
            maxExportBatchSize: this.config.batchSize
          }
        )
      );
    }
    
    if (this.config.enableConsoleExport) {
      exporters.push(
        new SimpleSpanProcessor(new ConsoleSpanExporter())
      );
    }
    
    // Initialize SDK    this.sdk = new NodeSDK({      resource,      spanProcessor: exporters.length > 0 ? exporters[0] : undefined,      instrumentations: this.config.enableAutoInstrumentation ? [        new HttpInstrumentation({          requestHook: (span, request) => {            const headers = (request as any).headers;            if (headers && headers['content-length']) {              span.setAttribute('http.request.body.size', headers['content-length']);            }          }        }),        new GrpcInstrumentation()      ] : []    });
    
    if (this.sdk) {
      await this.sdk.start();
    }
    
    // Get tracer
    this.tracer = trace.getTracer(
      this.config.serviceName,
      this.config.serviceVersion
    );
  }
  
  /**
   * Stop the tracer
   */
  async stop(): Promise<void> {
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
  startSpan(
    name: string,
    options?: {
      kind?: SpanKind;
      attributes?: Attributes;
      parentContext?: Context;
      links?: SpanLink[];
    }
  ): string {
    if (!this.tracer) {
      throw new Error('Tracer not initialized');
    }
    
    const spanOptions: SpanOptions = {
      kind: options?.kind || SpanKind.INTERNAL,
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
    
    const parentContext = options?.parentContext || context.active();
    const span = this.tracer.startSpan(name, spanOptions, parentContext);
    const spanContext = span.spanContext();
    
    // Store span
    this.activeSpans.set(spanContext.spanId, span);
    
    // Create span data
    const spanData: SpanData = {
      name,
      kind: this.mapSpanKind(spanOptions.kind!),
      startTime: Date.now(),
      attributes: options?.attributes || {},
      events: [],
      status: { code: 'ok' },
      links: options?.links
    };
    
    this.spanData.set(spanContext.spanId, spanData);
    
    // Make span active in context
    context.with(trace.setSpan(parentContext, span), () => {});
    
    this.emit('trace:started', spanData);
    
    return spanContext.spanId;
  }
  
  /**
   * End a span
   */
  endSpan(spanId: string, status?: SpanStatus): void {
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
  addEvent(spanId: string, event: SpanEvent): void {
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
  setAttributes(spanId: string, attributes: Attributes): void {
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
  getCurrentContext(): TraceContext | undefined {
    const span = trace.getActiveSpan();
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
  extractContext(headers: Record<string, string>): Context {
    return propagation.extract(context.active(), headers);
  }
  
  /**
   * Inject context into headers
   */
  injectContext(headers: Record<string, string>): void {
    propagation.inject(context.active(), headers);
  }
  
  /**
   * Trace async function
   */
  async traceAsync<T>(
    name: string,
    fn: () => Promise<T>,
    options?: {
      kind?: SpanKind;
      attributes?: Attributes;
    }
  ): Promise<T> {
    const spanId = this.startSpan(name, options);
    
    try {
      const result = await fn();
      this.endSpan(spanId);
      return result;
    } catch (error) {
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
  traceSync<T>(
    name: string,
    fn: () => T,
    options?: {
      kind?: SpanKind;
      attributes?: Attributes;
    }
  ): T {
    const spanId = this.startSpan(name, options);
    
    try {
      const result = fn();
      this.endSpan(spanId);
      return result;
    } catch (error) {
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
  span(
    name?: string,
    options?: {
      kind?: SpanKind;
      attributes?: Attributes;
    }
  ) {
    return (
      target: any,
      propertyKey: string,
      descriptor: PropertyDescriptor
    ) => {
      const originalMethod = descriptor.value;
      const spanName = name || `${target.constructor.name}.${propertyKey}`;
      
      descriptor.value = async function (...args: any[]) {
        const tracer = (this as any).tracer || this;
        
        if (tracer instanceof Tracer) {
          return tracer.traceAsync(
            spanName,
            () => originalMethod.apply(this, args),
            options
          );
        }
        
        return originalMethod.apply(this, args);
      };
      
      return descriptor;
    };
  }
  
  /**
   * Private: Map span kind
   */
  private mapSpanKind(kind: SpanKind): SpanData['kind'] {
    switch (kind) {
      case SpanKind.SERVER:
        return 'server';
      case SpanKind.CLIENT:
        return 'client';
      case SpanKind.PRODUCER:
        return 'producer';
      case SpanKind.CONSUMER:
        return 'consumer';
      default:
        return 'internal';
    }
  }
  
  /**
   * Private: Map status code
   */
  private mapStatusCode(code: SpanStatus['code']): SpanStatusCode {
    switch (code) {
      case 'ok':
        return SpanStatusCode.OK;
      case 'error':
        return SpanStatusCode.ERROR;
      default:
        return SpanStatusCode.UNSET;
    }
  }
  
  /**
   * Private: Extract baggage
   */
  private extractBaggage(): Record<string, string> {
    const baggage: Record<string, string> = {};
    const entries = propagation.getBaggage(context.active())?.getAllEntries();
    
    if (entries) {
      for (const [key, entry] of entries) {
        baggage[key] = entry.value;
      }
    }
    
    return baggage;
  }
} 