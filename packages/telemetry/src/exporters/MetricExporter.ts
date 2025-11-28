/**
 * MetricExporter - Prometheus-compatible metric export system
 * 
 * Collects and exports runtime metrics with support for
 * histograms, gauges, counters, and summaries.
 */

import { EventEmitter } from 'events';
import { 
  Registry, 
  Counter, 
  Gauge, 
  Histogram, 
  Summary,
  collectDefaultMetrics,
  register
} from 'prom-client';
import { Logger } from 'winston';
import * as http from 'http';
import * as https from 'https';
import { gzip } from 'zlib';
import { promisify } from 'util';
import {
  MetricDefinition,
  MetricType,
  MetricValue,
  MetricInstance,
  MetricRegistry,
  ModuleMetrics,
  SystemMetrics,
  ExportConfig,
  MetricExport
} from '@noderr/types/telemetry';

const gzipAsync = promisify(gzip);

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

export class MetricExporter extends EventEmitter {
  private logger: Logger;
  private registry: Registry;
  private metrics: MetricRegistry = {};
  private config: Required<MetricExporterConfig>;
  private exportTimer: NodeJS.Timeout | undefined;
  private moduleMetrics: Map<string, ModuleMetrics> = new Map();
  private systemStartTime: number = Date.now();
  
  // Core system metrics
  private systemMetrics: {
    requestsTotal: Counter;
    errorsTotal: Counter;
    latencyHistogram: Histogram;
    activeConnections: Gauge;
    memoryUsage: Gauge;
    cpuUsage: Gauge;
    messageQueueSize: Gauge;
    moduleStatus: Gauge;
  };
  
  constructor(logger: Logger, config?: MetricExporterConfig) {
    super();
    this.logger = logger;
    
    this.config = {
      prefix: 'noderr',
      defaultLabels: {},
      collectDefaultMetrics: true,
      exportInterval: 30000, // 30 seconds
      exportEndpoint: '',
      compressionEnabled: true,
      timeout: 10000,
      retryAttempts: 3,
      retryDelay: 1000,
      ...config
    };
    
    // Initialize registry
    this.registry = new Registry();
    
    // Set default labels
    if (Object.keys(this.config.defaultLabels).length > 0) {
      this.registry.setDefaultLabels(this.config.defaultLabels);
    }
    
    // Initialize core metrics
    this.systemMetrics = this.initializeSystemMetrics();
    
    // Collect default Node.js metrics
    if (this.config.collectDefaultMetrics) {
      collectDefaultMetrics({ 
        register: this.registry,
        prefix: `${this.config.prefix}_`
      });
    }
  }
  
  /**
   * Start metric collection and export
   */
  async start(): Promise<void> {
    this.logger.info('Starting MetricExporter');
    
    // Start export timer if endpoint configured
    if (this.config.exportEndpoint) {
      this.exportTimer = setInterval(
        () => this.exportMetrics().catch(err => 
          this.logger.error('Failed to export metrics', { error: err })
        ),
        this.config.exportInterval
      );
    }
    
    this.logger.info('MetricExporter started');
  }
  
  /**
   * Stop metric collection and export
   */
  async stop(): Promise<void> {
    this.logger.info('Stopping MetricExporter');
    
    if (this.exportTimer) {
      clearInterval(this.exportTimer);
      this.exportTimer = undefined;
    }
    
    // Final export
    if (this.config.exportEndpoint) {
      try {
        await this.exportMetrics();
      } catch (error) {
        this.logger.error('Failed final metric export', { error });
      }
    }
    
    this.logger.info('MetricExporter stopped');
  }
  
  /**
   * Register a new metric
   */
  registerMetric(definition: MetricDefinition): void {
    const metricName = `${this.config.prefix}_${definition.name}`;
    
    if (this.metrics[metricName]) {
      this.logger.warn(`Metric already registered: ${metricName}`);
      return;
    }
    
    let metric: MetricInstance;
    
    switch (definition.type) {
      case MetricType.COUNTER:
        metric = new Counter({
          name: metricName,
          help: definition.help,
          labelNames: definition.labelNames || [],
          registers: [this.registry]
        });
        break;
        
      case MetricType.GAUGE:
        metric = new Gauge({
          name: metricName,
          help: definition.help,
          labelNames: definition.labelNames || [],
          registers: [this.registry]
        });
        break;
        
      case MetricType.HISTOGRAM:
        metric = new Histogram({
          name: metricName,
          help: definition.help,
          labelNames: definition.labelNames || [],
          buckets: definition.buckets || [0.001, 0.01, 0.1, 0.5, 1, 2, 5, 10],
          registers: [this.registry]
        });
        break;
        
      case MetricType.SUMMARY:
        metric = new Summary({
          name: metricName,
          help: definition.help,
          labelNames: definition.labelNames || [],
          percentiles: definition.percentiles || [0.5, 0.9, 0.95, 0.99, 0.999],
          maxAgeSeconds: definition.maxAgeSeconds || 600,
          ageBuckets: definition.ageBuckets || 5,
          registers: [this.registry]
        });
        break;
        
      default:
        throw new Error(`Unknown metric type: ${definition.type}`);
    }
    
    this.metrics[metricName] = metric;
    this.logger.debug(`Registered metric: ${metricName}`);
  }
  
  /**
   * Record a metric value
   */
  recordMetric(value: MetricValue): void {
    const metricName = `${this.config.prefix}_${value.metric}`;
    const metric = this.metrics[metricName];
    
    if (!metric) {
      this.logger.warn(`Metric not found: ${metricName}`);
      return;
    }
    
    const labels = value.labels || {};
    
    if (metric instanceof Counter) {
      metric.inc(labels, value.value);
    } else if (metric instanceof Gauge) {
      metric.set(labels, value.value);
    } else if (metric instanceof Histogram) {
      metric.observe(labels, value.value);
    } else if (metric instanceof Summary) {
      metric.observe(labels, value.value);
    }
    
    this.emit('metric:collected', value);
  }
  
  /**
   * Update module metrics
   */
  updateModuleMetrics(moduleId: string, metrics: Partial<ModuleMetrics>): void {
    const existing = this.moduleMetrics.get(moduleId) || {
      moduleId,
      latency: { p50: 0, p95: 0, p99: 0, p999: 0 },
      throughput: { requestsPerSecond: 0, messagesPerSecond: 0 },
      errors: { count: 0, rate: 0 },
      resources: { cpu: 0, memory: 0, connections: 0 }
    };
    
    const updated = {
      ...existing,
      ...metrics,
      latency: { ...existing.latency, ...metrics.latency },
      throughput: { ...existing.throughput, ...metrics.throughput },
      errors: { ...existing.errors, ...metrics.errors },
      resources: { ...existing.resources, ...metrics.resources }
    };
    
    this.moduleMetrics.set(moduleId, updated);
    
    // Update Prometheus metrics
    const labels = { module: moduleId };
    
    if (metrics.latency) {
      this.systemMetrics.latencyHistogram.observe(labels, metrics.latency.p50);
    }
    
    if (metrics.errors?.count !== undefined) {
      this.systemMetrics.errorsTotal.inc(labels, metrics.errors.count);
    }
    
    if (metrics.resources?.memory !== undefined) {
      this.systemMetrics.memoryUsage.set(labels, metrics.resources.memory);
    }
    
    if (metrics.resources?.cpu !== undefined) {
      this.systemMetrics.cpuUsage.set(labels, metrics.resources.cpu);
    }
  }
  
  /**
   * Get current system metrics
   */
  getSystemMetrics(): SystemMetrics {
    const modules: Record<string, ModuleMetrics> = {};
    for (const [id, metrics] of this.moduleMetrics) {
      modules[id] = metrics;
    }
    
    // Calculate aggregates
    let totalRequests = 0;
    let totalErrors = 0;
    let latencySum = 0;
    let maxP99Latency = 0;
    let totalCpu = 0;
    let totalMemory = 0;
    let moduleCount = 0;
    
    for (const metrics of this.moduleMetrics.values()) {
      totalRequests += metrics.throughput.requestsPerSecond;
      totalErrors += metrics.errors.count;
      latencySum += metrics.latency.p50;
      maxP99Latency = Math.max(maxP99Latency, metrics.latency.p99);
      totalCpu += metrics.resources.cpu;
      totalMemory += metrics.resources.memory;
      moduleCount++;
    }
    
    return {
      timestamp: Date.now(),
      modules,
      aggregate: {
        totalRequests,
        totalErrors,
        avgLatency: moduleCount > 0 ? latencySum / moduleCount : 0,
        p99Latency: maxP99Latency,
        cpuUsage: totalCpu,
        memoryUsage: totalMemory,
        uptime: Date.now() - this.systemStartTime
      }
    };
  }
  
  /**
   * Get metrics in Prometheus format
   */
  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }
  
  /**
   * Export metrics to configured endpoint
   */
  private async exportMetrics(): Promise<void> {
    if (!this.config.exportEndpoint) {
      return;
    }
    
    const startTime = Date.now();
    
    try {
      const metrics = await this.getMetrics();
      const exportData: MetricExport = {
        contentType: this.registry.contentType,
        data: metrics,
        timestamp: Date.now()
      };
      
      // Compress if enabled
      if (this.config.compressionEnabled) {
        exportData.data = await gzipAsync(metrics);
      }
      
      // Send with retry
      await this.sendWithRetry(exportData);
      
      const duration = Date.now() - startTime;
      this.logger.debug(`Metrics exported in ${duration}ms`);
      
      this.emit('metric:exported', this.registry.getMetricsAsArray().length);
    } catch (error) {
      this.logger.error('Failed to export metrics', { error });
      throw error;
    }
  }
  
  /**
   * Send metrics with retry logic
   */
  private async sendWithRetry(exportData: MetricExport): Promise<void> {
    let lastError: Error | undefined;
    
    for (let attempt = 0; attempt < this.config.retryAttempts; attempt++) {
      try {
        await this.sendMetrics(exportData);
        return;
      } catch (error) {
        lastError = error as Error;
        this.logger.warn(`Export attempt ${attempt + 1} failed`, { error });
        
        if (attempt < this.config.retryAttempts - 1) {
          await new Promise(resolve => 
            setTimeout(resolve, this.config.retryDelay * Math.pow(2, attempt))
          );
        }
      }
    }
    
    throw lastError || new Error('Failed to export metrics');
  }
  
  /**
   * Send metrics to endpoint
   */
  private async sendMetrics(exportData: MetricExport): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = new URL(this.config.exportEndpoint);
      const isHttps = url.protocol === 'https:';
      const client = isHttps ? https : http;
      
      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': exportData.contentType,
          'Content-Length': Buffer.byteLength(exportData.data),
          ...(this.config.compressionEnabled && { 'Content-Encoding': 'gzip' })
        },
        timeout: this.config.timeout
      };
      
      const req = client.request(options, (res) => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
        } else {
          reject(new Error(`Export failed with status ${res.statusCode}`));
        }
      });
      
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Export request timeout'));
      });
      
      req.write(exportData.data);
      req.end();
    });
  }
  
  /**
   * Initialize system metrics
   */
  private initializeSystemMetrics() {
    return {
      requestsTotal: new Counter({
        name: `${this.config.prefix}_requests_total`,
        help: 'Total number of requests',
        labelNames: ['module', 'method', 'status'],
        registers: [this.registry]
      }),
      
      errorsTotal: new Counter({
        name: `${this.config.prefix}_errors_total`,
        help: 'Total number of errors',
        labelNames: ['module', 'type'],
        registers: [this.registry]
      }),
      
      latencyHistogram: new Histogram({
        name: `${this.config.prefix}_request_duration_seconds`,
        help: 'Request latency in seconds',
        labelNames: ['module', 'method'],
        buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5],
        registers: [this.registry]
      }),
      
      activeConnections: new Gauge({
        name: `${this.config.prefix}_active_connections`,
        help: 'Number of active connections',
        labelNames: ['module'],
        registers: [this.registry]
      }),
      
      memoryUsage: new Gauge({
        name: `${this.config.prefix}_memory_usage_bytes`,
        help: 'Memory usage in bytes',
        labelNames: ['module'],
        registers: [this.registry]
      }),
      
      cpuUsage: new Gauge({
        name: `${this.config.prefix}_cpu_usage_percent`,
        help: 'CPU usage percentage',
        labelNames: ['module'],
        registers: [this.registry]
      }),
      
      messageQueueSize: new Gauge({
        name: `${this.config.prefix}_message_queue_size`,
        help: 'Size of message queue',
        labelNames: ['module', 'priority'],
        registers: [this.registry]
      }),
      
      moduleStatus: new Gauge({
        name: `${this.config.prefix}_module_status`,
        help: 'Module health status (1=healthy, 0=unhealthy)',
        labelNames: ['module'],
        registers: [this.registry]
      })
    };
  }
} 