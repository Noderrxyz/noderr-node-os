/**
 * TelemetryService - Main orchestration service for system observability
 * 
 * Coordinates metrics collection, logging, tracing, and alerting
 * to provide comprehensive system monitoring.
 */

import { Logger } from '@noderr/utils/src';
import { EventEmitter } from 'events';
import * as winston from 'winston';
import * as http from 'http';
import { 
  MetricExporter 
} from './exporters/MetricExporter';
import { LogBridge } from './loggers/LogBridge';
import { Tracer } from './tracers/Tracer';
import { ErrorAlertRouter } from './ErrorAlertRouter';
import { MetricsCollector } from './collectors/MetricsCollector';
import {
  TelemetryEvents,
  MetricDefinition,
  MetricValue,
  ModuleMetrics,
  SystemMetrics,
  LogLevel,
  Alert,
  AlertRule,
  AlertChannel,
  Dashboard,
  TraceContext,
  SpanData
} from './types/telemetry';

const logger = new Logger('TelemetryService');
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

export class TelemetryService extends EventEmitter {
  private logger: winston.Logger;
  private config: TelemetryServiceConfig;
  private metricExporter?: MetricExporter;
  private metricsCollector?: MetricsCollector;
  private logBridge?: LogBridge;
  private tracer?: Tracer;
  private alertRouter?: ErrorAlertRouter;
  private metricsServer?: http.Server;
  private healthStatus: Record<string, boolean> = {};
  private startTime: number = Date.now();
  
  constructor(logger: winston.Logger, config: TelemetryServiceConfig) {
    super();
    this.logger = logger;
    this.config = config;
  }
  
  /**
   * Initialize telemetry components
   */
  async initialize(): Promise<void> {
    this.logger.info('Initializing TelemetryService', {
      serviceName: this.config.serviceName,
      environment: this.config.environment,
      version: this.config.version
    });
    
    // Initialize metrics
    if (this.config.metrics?.enabled) {
      await this.initializeMetrics();
    }
    
    // Initialize logging
    if (this.config.logging?.enabled) {
      await this.initializeLogging();
    }
    
    // Initialize tracing
    if (this.config.tracing?.enabled) {
      await this.initializeTracing();
    }
    
    // Initialize alerting
    if (this.config.alerting?.enabled) {
      await this.initializeAlerting();
    }
    
    // Setup internal monitoring
    this.setupInternalMonitoring();
    
    this.logger.info('TelemetryService initialized successfully');
  }
  
  /**
   * Start telemetry services
   */
  async start(): Promise<void> {
    this.logger.info('Starting TelemetryService');
    
    // Start metrics exporter
    if (this.metricExporter) {
      await this.metricExporter.start();
      
      // Start metrics collector
      if (this.metricsCollector) {
        await this.metricsCollector.start();
      }
      
      // Start metrics server
      if (this.config.metrics?.port) {
        await this.startMetricsServer(this.config.metrics.port);
      }
    }
    
    // Start log bridge
    if (this.logBridge) {
      await this.logBridge.start();
    }
    
    // Start tracer
    if (this.tracer) {
      await this.tracer.start();
    }
    
    // Alert router doesn't have a start method, just mark as healthy
    if (this.alertRouter) {
      this.healthStatus.alerting = true;
    }
    
    this.healthStatus.telemetry = true;
    this.logger.info('TelemetryService started successfully');
  }
  
  /**
   * Stop telemetry services
   */
  async stop(): Promise<void> {
    this.logger.info('Stopping TelemetryService');
    
    this.healthStatus.telemetry = false;
    
    // Stop metrics server
    if (this.metricsServer) {
      await new Promise<void>((resolve) => {
        this.metricsServer!.close(() => resolve());
      });
    }
    
    // Stop metrics collector
    if (this.metricsCollector) {
      await this.metricsCollector.stop();
    }
    
    // Stop components
    if (this.metricExporter) {
      await this.metricExporter.stop();
    }
    
    if (this.logBridge) {
      await this.logBridge.stop();
    }
    
    if (this.tracer) {
      await this.tracer.stop();
    }
    
    // Alert router doesn't have a stop method
    this.healthStatus.alerting = false;
    
    this.logger.info('TelemetryService stopped');
  }
  
  /**
   * Register a metric
   */
  registerMetric(definition: MetricDefinition): void {
    if (!this.metricExporter) {
      throw new Error('Metrics not enabled');
    }
    
    this.metricExporter.registerMetric(definition);
  }
  
  /**
   * Record a metric value
   */
  recordMetric(value: MetricValue): void {
    if (!this.metricExporter) {
      return;
    }
    
    this.metricExporter.recordMetric(value);
  }
  
  /**
   * Update module metrics
   */
  updateModuleMetrics(moduleId: string, metrics: Partial<ModuleMetrics>): void {
    if (!this.metricExporter) {
      return;
    }
    
    this.metricExporter.updateModuleMetrics(moduleId, metrics);
  }
  
  /**
   * Get system metrics
   */
  getSystemMetrics(): SystemMetrics | null {
    if (!this.metricExporter) {
      return null;
    }
    
    return this.metricExporter.getSystemMetrics();
  }
  
  /**
   * Log a message
   */
  log(level: LogLevel, module: string, message: string, metadata?: Record<string, any>): void {
    if (!this.logBridge) {
      // Fallback to console
      logger.info(`[${level}] [${module}] ${message}`, metadata);
      return;
    }
    
    this.logBridge.log(level, module, message, metadata);
  }
  
  /**
   * Convenience logging methods
   */
  debug(module: string, message: string, metadata?: Record<string, any>): void {
    this.log(LogLevel.DEBUG, module, message, metadata);
  }
  
  info(module: string, message: string, metadata?: Record<string, any>): void {
    this.log(LogLevel.INFO, module, message, metadata);
  }
  
  warn(module: string, message: string, metadata?: Record<string, any>): void {
    this.log(LogLevel.WARN, module, message, metadata);
  }
  
  // Keep the logging error method separate from EventEmitter error event
  logError(module: string, message: string, metadata?: Record<string, any>): void {
    this.log(LogLevel.ERROR, module, message, metadata);
  }
  
  /**
   * Start a trace span
   */
  startSpan(name: string, options?: any): string | null {
    if (!this.tracer) {
      return null;
    }
    
    return this.tracer.startSpan(name, options);
  }
  
  /**
   * End a trace span
   */
  endSpan(spanId: string, status?: any): void {
    if (!this.tracer) {
      return;
    }
    
    this.tracer.endSpan(spanId, status);
  }
  
  /**
   * Set trace context
   */
  setTraceContext(context: TraceContext): void {
    if (this.logBridge) {
      this.logBridge.setTraceContext(context);
    }
  }
  
  /**
   * Trigger an alert
   */
  async triggerAlert(alert: Alert): Promise<void> {
    if (!this.alertRouter) {
      this.logger.error('Alert router not initialized', { alert });
      return;
    }
    
    await this.alertRouter.sendAlert(alert);
    this.emit('alert:triggered', alert);
  }
  
  /**
   * Add alert rule
   */
  addAlertRule(rule: AlertRule): void {
    if (!this.alertRouter) {
      throw new Error('Alerting not enabled');
    }
    
    // Store rule locally since ErrorAlertRouter doesn't have addRule method
    if (!this.config.alerting) {
      this.config.alerting = { enabled: true, rules: [] };
    }
    if (!this.config.alerting.rules) {
      this.config.alerting.rules = [];
    }
    this.config.alerting.rules.push(rule);
  }
  
  /**
   * Get health status
   */
  getHealthStatus(): Record<string, any> {
    return {
      ...this.healthStatus,
      uptime: Date.now() - this.startTime
    };
  }
  
  /**
   * Get telemetry dashboard
   */
  getDashboard(): Dashboard {
    return {
      uid: 'noderr-telemetry',
      title: 'Noderr Protocol Telemetry',
      description: 'System-wide observability dashboard',
      tags: ['noderr', 'telemetry', 'monitoring'],
      panels: [
        {
          id: 'system-overview',
          title: 'System Overview',
          type: 'stat',
          datasource: 'prometheus',
          query: 'up{job="noderr"}',
          unit: 'bool'
        },
        {
          id: 'request-rate',
          title: 'Request Rate',
          type: 'graph',
          datasource: 'prometheus',
          query: 'rate(noderr_requests_total[5m])',
          unit: 'ops'
        },
        {
          id: 'error-rate',
          title: 'Error Rate',
          type: 'graph',
          datasource: 'prometheus',
          query: 'rate(noderr_errors_total[5m])',
          unit: 'ops'
        },
        {
          id: 'latency-percentiles',
          title: 'Latency Percentiles',
          type: 'graph',
          datasource: 'prometheus',
          query: 'histogram_quantile(0.99, noderr_request_duration_seconds_bucket)',
          unit: 's'
        },
        {
          id: 'memory-usage',
          title: 'Memory Usage',
          type: 'graph',
          datasource: 'prometheus',
          query: 'noderr_memory_usage_bytes',
          unit: 'bytes'
        },
        {
          id: 'cpu-usage',
          title: 'CPU Usage',
          type: 'graph',
          datasource: 'prometheus',
          query: 'noderr_cpu_usage_percent',
          unit: 'percent'
        }
      ],
      variables: [
        {
          name: 'module',
          type: 'query',
          query: 'label_values(noderr_requests_total, module)',
          multi: true
        }
      ],
      time: {
        from: 'now-1h',
        to: 'now'
      },
      refresh: '30s'
    };
  }
  
  /**
   * Initialize metrics collection
   */
  private async initializeMetrics(): Promise<void> {
    const exportEndpoint = this.config.metrics?.endpoint;
    
    this.metricExporter = new MetricExporter(this.logger, {
      prefix: 'noderr',
      defaultLabels: {
        service: this.config.serviceName,
        environment: this.config.environment,
        version: this.config.version
      },
      ...(exportEndpoint && { exportEndpoint }),
      exportInterval: this.config.metrics?.interval || 30000,
      collectDefaultMetrics: true,
      compressionEnabled: true
    });
    
    // Initialize comprehensive metrics collector
    this.metricsCollector = new MetricsCollector(this.logger, this.metricExporter);
    
    // Setup metric event forwarding
    this.metricExporter.on('metric:collected', (metric: any) => {
      this.emit('metric:collected', metric);
    });
    
    this.metricExporter.on('metric:exported', (count: any) => {
      this.emit('metric:exported', count);
    });
    
    this.healthStatus.metrics = true;
  }
  
  /**
   * Initialize logging
   */
  private async initializeLogging(): Promise<void> {
    this.logBridge = new LogBridge({
      level: this.config.logging?.level || LogLevel.INFO,
      format: 'json',
      outputs: this.config.logging?.outputs || [
        { type: 'console', config: {} }
      ],
      fields: {
        service: this.config.serviceName,
        environment: this.config.environment,
        version: this.config.version
      }
    });
    
    // Setup log event forwarding
    this.logBridge.on('log:written', (entry: any) => {
      this.emit('log:written', entry);
    });
    
    this.logBridge.on('log:flushed', (count: any) => {
      this.emit('log:flushed', count);
    });
    
    this.healthStatus.logging = true;
  }
  
  /**
   * Initialize tracing
   */
  private async initializeTracing(): Promise<void> {
    this.tracer = new Tracer({
      serviceName: this.config.serviceName,
      serviceVersion: this.config.version,
      environment: this.config.environment,
      endpoint: this.config.tracing?.endpoint || 'http://localhost:4318/v1/traces',
      samplingRate: this.config.tracing?.sampleRate || 1.0
    });
    
    // Setup trace event forwarding
    this.tracer.on('trace:started', (span: any) => {
      this.emit('trace:started', span);
    });
    
    this.tracer.on('trace:ended', (span: any) => {
      this.emit('trace:ended', span);
    });
    
    this.healthStatus.tracing = true;
  }
  
  /**
   * Initialize alerting
   */
  private async initializeAlerting(): Promise<void> {
    const channels = this.config.alerting?.channels || [];
    
    this.alertRouter = new ErrorAlertRouter(this.logger, {
      channels,
      rules: this.config.alerting?.rules || []
    });
    
    // Setup alert event forwarding
    this.alertRouter.on('alert:triggered', (alert: any) => {
      this.emit('alert:triggered', alert);
    });
    
    this.alertRouter.on('alert:resolved', (alert: any) => {
      this.emit('alert:resolved', alert);
    });
    
    this.healthStatus.alerting = true;
  }
  
  /**
   * Start metrics server
   */
  private async startMetricsServer(port: number): Promise<void> {
    this.metricsServer = http.createServer(async (req, res) => {
      if (req.url === '/metrics' && this.metricExporter) {
        try {
          const metrics = await this.metricExporter.getMetrics();
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end(metrics);
        } catch (error) {
          res.writeHead(500);
          res.end('Error collecting metrics');
        }
      } else if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(this.getHealthStatus()));
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });
    
    await new Promise<void>((resolve) => {
      this.metricsServer!.listen(port, () => {
        this.logger.info(`Metrics server listening on port ${port}`);
        resolve();
      });
    });
  }
  
  /**
   * Setup internal monitoring
   */
  private setupInternalMonitoring(): void {
    // Monitor telemetry health
    setInterval(() => {
      const health = this.getHealthStatus();
      
      this.recordMetric({
        metric: 'telemetry_health',
        value: Object.values(health).every(v => v === true) ? 1 : 0,
        labels: { component: 'telemetry' }
      });
      
      // Check component health
      for (const [component, healthy] of Object.entries(this.healthStatus)) {
        this.recordMetric({
          metric: 'component_health',
          value: healthy ? 1 : 0,
          labels: { component }
        });
      }
    }, 60000); // Every minute
    
    // Monitor error events
    this.on('error', (error) => {
      this.logError('TelemetryService', 'Internal error', { error });
      this.recordMetric({
        metric: 'telemetry_errors_total',
        value: 1,
        labels: { type: error.name || 'unknown' }
      });
    });
  }
  
  // Implement TelemetryEvents interface
  'metric:collected' = (metric: MetricValue) => {};
  'metric:exported' = (count: number) => {};
  'log:written' = (entry: any) => {};
  'log:flushed' = (count: number) => {};
  'trace:started' = (span: SpanData) => {};
  'trace:ended' = (span: SpanData) => {};
  'alert:triggered' = (alert: Alert) => {};
  'alert:resolved' = (alert: Alert) => {};
  'error' = (error: Error) => {};
} 