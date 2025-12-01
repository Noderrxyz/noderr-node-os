import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { JaegerExporter } from '@opentelemetry/exporter-jaeger';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { 
  MeterProvider, 
  PeriodicExportingMetricReader,
  ConsoleMetricExporter 
} from '@opentelemetry/sdk-metrics';
import { 
  BatchSpanProcessor,
  ConsoleSpanExporter,
  SimpleSpanProcessor
} from '@opentelemetry/sdk-trace-base';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { GrpcInstrumentation } from '@opentelemetry/instrumentation-grpc';
import { RedisInstrumentation } from '@opentelemetry/instrumentation-redis-4';
import { trace, metrics, context, SpanStatusCode, SpanKind } from '@opentelemetry/api';
import * as winston from 'winston';

export interface TelemetryConfig {
  serviceName: string;
  serviceVersion: string;
  environment: string;
  jaeger?: {
    endpoint: string;
    enabled: boolean;
  };
  prometheus?: {
    port: number;
    enabled: boolean;
  };
  console?: {
    enabled: boolean;
  };
  sampling?: {
    probability: number;
  };
}

export class TelemetrySystem {
  private sdk?: NodeSDK;
  private logger: winston.Logger;
  private config: TelemetryConfig;
  private tracer: any;
  private meter: any;
  private counters: Map<string, any> = new Map();
  private histograms: Map<string, any> = new Map();
  private gauges: Map<string, any> = new Map();

  constructor(logger: winston.Logger, config: TelemetryConfig) {
    this.logger = logger;
    this.config = config;
    this.tracer = trace.getTracer(config.serviceName, config.serviceVersion);
    this.meter = metrics.getMeter(config.serviceName, config.serviceVersion);
  }

  async initialize(): Promise<void> {
    try {
      // Create resource
      const resource = new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: this.config.serviceName,
        [SemanticResourceAttributes.SERVICE_VERSION]: this.config.serviceVersion,
        [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: this.config.environment,
      });

      // Configure span processors
      const spanProcessors = [];
      
      if (this.config.jaeger?.enabled) {
        const jaegerExporter = new JaegerExporter({
          endpoint: this.config.jaeger.endpoint,
        });
        spanProcessors.push(new BatchSpanProcessor(jaegerExporter));
      }
      
      if (this.config.console?.enabled) {
        spanProcessors.push(new SimpleSpanProcessor(new ConsoleSpanExporter()));
      }

      // Configure metric readers
      const metricReaders = [];
      
      if (this.config.prometheus?.enabled) {
        const prometheusExporter = new PrometheusExporter({
          port: this.config.prometheus.port,
        }, () => {
          this.logger.info(`Prometheus metrics server started on port ${this.config.prometheus?.port}`);
        });
        metricReaders.push(prometheusExporter);
      }
      
      if (this.config.console?.enabled) {
        metricReaders.push(new PeriodicExportingMetricReader({
          exporter: new ConsoleMetricExporter(),
          exportIntervalMillis: 5000,
        }));
      }

      // Initialize SDK
      this.sdk = new NodeSDK({
        resource,
        spanProcessor: spanProcessors[0] as any, // Use first span processor
        instrumentations: [
          getNodeAutoInstrumentations({
            '@opentelemetry/instrumentation-fs': {
              enabled: false, // Disable fs instrumentation to reduce noise
            },
          }),
          new HttpInstrumentation({
            requestHook: (span, request) => {
              // Skip body logging to avoid type issues
              span.setAttribute('http.method', 'request' in request ? 'HTTP' : 'HTTPS');
            },
          }),
          new GrpcInstrumentation(),
          new RedisInstrumentation(),
        ],
      });

      // Start SDK
      await this.sdk.start();

      // Initialize default metrics
      this.initializeMetrics();

      this.logger.info('Telemetry system initialized', {
        serviceName: this.config.serviceName,
        jaeger: this.config.jaeger?.enabled,
        prometheus: this.config.prometheus?.enabled,
      });

    } catch (error) {
      this.logger.error('Failed to initialize telemetry', error);
      throw error;
    }
  }

  private initializeMetrics(): void {
    // Order metrics
    this.counters.set('orders_total', this.meter.createCounter('orders_total', {
      description: 'Total number of orders processed',
    }));
    
    this.counters.set('orders_failed', this.meter.createCounter('orders_failed', {
      description: 'Total number of failed orders',
    }));
    
    this.histograms.set('order_latency', this.meter.createHistogram('order_latency_ms', {
      description: 'Order processing latency in milliseconds',
    }));

    // Position metrics
    this.gauges.set('positions_open', this.meter.createUpDownCounter('positions_open', {
      description: 'Number of open positions',
    }));
    
    this.histograms.set('position_drift', this.meter.createHistogram('position_drift_percent', {
      description: 'Position drift percentage',
    }));

    // Risk metrics
    this.gauges.set('risk_exposure', this.meter.createObservableGauge('risk_exposure', {
      description: 'Current risk exposure',
    }));
    
    this.counters.set('risk_violations', this.meter.createCounter('risk_violations', {
      description: 'Number of risk limit violations',
    }));

    // System metrics
    this.gauges.set('system_health', this.meter.createObservableGauge('system_health', {
      description: 'System health score (0-100)',
    }));
    
    this.histograms.set('component_restart_time', this.meter.createHistogram('component_restart_time_ms', {
      description: 'Component restart time in milliseconds',
    }));
  }

  // Tracing methods
  startSpan(name: string, options?: any): any {
    return this.tracer.startSpan(name, {
      kind: options?.kind || SpanKind.INTERNAL,
      attributes: options?.attributes,
    });
  }

  async withSpan<T>(name: string, fn: (span: any) => Promise<T>, options?: any): Promise<T> {
    const span = this.startSpan(name, options);
    
    try {
      const result = await context.with(trace.setSpan(context.active(), span), async () => {
        return await fn(span);
      });
      
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
      
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      span.recordException(error as Error);
      throw error;
      
    } finally {
      span.end();
    }
  }

  // Metric methods
  incrementCounter(name: string, value: number = 1, attributes?: Record<string, any>): void {
    const counter = this.counters.get(name);
    if (counter) {
      counter.add(value, attributes);
    }
  }

  recordHistogram(name: string, value: number, attributes?: Record<string, any>): void {
    const histogram = this.histograms.get(name);
    if (histogram) {
      histogram.record(value, attributes);
    }
  }

  setGauge(name: string, value: number, attributes?: Record<string, any>): void {
    const gauge = this.gauges.get(name);
    if (gauge) {
      if (gauge.add) {
        // UpDownCounter
        gauge.add(value - (this.lastGaugeValues.get(name) || 0), attributes);
        this.lastGaugeValues.set(name, value);
      }
    }
  }

  private lastGaugeValues: Map<string, number> = new Map();

  // Custom metric registration
  registerCounter(name: string, description: string): void {
    this.counters.set(name, this.meter.createCounter(name, { description }));
  }

  registerHistogram(name: string, description: string, unit?: string): void {
    this.histograms.set(name, this.meter.createHistogram(name, { description, unit }));
  }

  registerGauge(name: string, description: string, callback?: () => number): void {
    if (callback) {
      const gauge = this.meter.createObservableGauge(name, { description });
      gauge.addCallback((observableResult: any) => {
        observableResult.observe(callback());
      });
      this.gauges.set(name, gauge);
    } else {
      this.gauges.set(name, this.meter.createUpDownCounter(name, { description }));
    }
  }

  // Context propagation helpers
  injectContext(carrier: any): void {
    const propagator = trace.getTracer(this.config.serviceName).startSpan('dummy');
    // In production, use proper propagator
    carrier['traceparent'] = propagator.spanContext().traceId;
    propagator.end();
  }

  extractContext(carrier: any): any {
    // In production, use proper propagator
    return carrier['traceparent'];
  }

  // Shutdown
  async shutdown(): Promise<void> {
    if (this.sdk) {
      await this.sdk.shutdown();
      this.logger.info('Telemetry system shut down');
    }
  }
}

// Telemetry decorators for easy instrumentation
export function Traced(spanName?: string) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    
    descriptor.value = async function (...args: any[]) {
      const telemetry = (this as any).telemetry;
      if (!telemetry) {
        return originalMethod.apply(this, args);
      }
      
      const name = spanName || `${target.constructor.name}.${propertyKey}`;
      return telemetry.withSpan(name, async (span: any) => {
        span.setAttribute('class', target.constructor.name);
        span.setAttribute('method', propertyKey);
        return originalMethod.apply(this, args);
      });
    };
    
    return descriptor;
  };
}

export function Metered(metricName: string, metricType: 'counter' | 'histogram' = 'counter') {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    
    descriptor.value = async function (...args: any[]) {
      const telemetry = (this as any).telemetry;
      const startTime = Date.now();
      
      try {
        const result = await originalMethod.apply(this, args);
        
        if (telemetry) {
          if (metricType === 'counter') {
            telemetry.incrementCounter(metricName, 1, { status: 'success' });
          } else {
            telemetry.recordHistogram(metricName, Date.now() - startTime, { status: 'success' });
          }
        }
        
        return result;
        
      } catch (error) {
        if (telemetry) {
          if (metricType === 'counter') {
            telemetry.incrementCounter(metricName, 1, { status: 'error' });
          } else {
            telemetry.recordHistogram(metricName, Date.now() - startTime, { status: 'error' });
          }
        }
        throw error;
      }
    };
    
    return descriptor;
  };
}

// Integration with existing components
export class TelemetryIntegration {
  static instrumentOrderManager(orderManager: any, telemetry: TelemetrySystem): void {
    // Instrument order submission
    const originalSubmit = orderManager.submitOrder;
    orderManager.submitOrder = async function(...args: any[]) {
      return telemetry.withSpan('OrderManager.submitOrder', async (span) => {
        span.setAttribute('order.symbol', args[0]?.symbol);
        span.setAttribute('order.side', args[0]?.side);
        span.setAttribute('order.quantity', args[0]?.quantity);
        
        const startTime = Date.now();
        try {
          const result = await originalSubmit.apply(this, args);
          telemetry.incrementCounter('orders_total', 1, { status: 'success' });
          telemetry.recordHistogram('order_latency', Date.now() - startTime);
          return result;
        } catch (error) {
          telemetry.incrementCounter('orders_total', 1, { status: 'failed' });
          telemetry.incrementCounter('orders_failed', 1);
          throw error;
        }
      });
    };
  }

  static instrumentRiskEngine(riskEngine: any, telemetry: TelemetrySystem): void {
    // Instrument risk checks
    riskEngine.on('violation', (violation: any) => {
      telemetry.incrementCounter('risk_violations', 1, {
        type: violation.type,
        severity: violation.severity,
      });
    });
    
    // Register risk exposure gauge
    telemetry.registerGauge('risk_exposure_current', 'Current risk exposure', () => {
      return riskEngine.getCurrentExposure?.() || 0;
    });
  }

  static instrumentPositionReconciliation(reconciliation: any, telemetry: TelemetrySystem): void {
    // Instrument reconciliation
    reconciliation.on('reconciliation', (result: any) => {
      telemetry.recordHistogram('position_drift', result.driftPercentage * 100);
      
      if (result.action === 'pause') {
        telemetry.incrementCounter('trading_pauses', 1, { reason: 'drift' });
      }
    });
  }
} 