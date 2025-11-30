"use strict";
/**
 * MetricExporter - Prometheus-compatible metric export system
 *
 * Collects and exports runtime metrics with support for
 * histograms, gauges, counters, and summaries.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.MetricExporter = void 0;
const events_1 = require("events");
const prom_client_1 = require("prom-client");
const http = __importStar(require("http"));
const https = __importStar(require("https"));
const zlib_1 = require("zlib");
const util_1 = require("util");
const telemetry_1 = require("../types/telemetry");
const gzipAsync = (0, util_1.promisify)(zlib_1.gzip);
class MetricExporter extends events_1.EventEmitter {
    logger;
    registry;
    metrics = {};
    config;
    exportTimer;
    moduleMetrics = new Map();
    systemStartTime = Date.now();
    // Core system metrics
    systemMetrics;
    constructor(logger, config) {
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
        this.registry = new prom_client_1.Registry();
        // Set default labels
        if (Object.keys(this.config.defaultLabels).length > 0) {
            this.registry.setDefaultLabels(this.config.defaultLabels);
        }
        // Initialize core metrics
        this.systemMetrics = this.initializeSystemMetrics();
        // Collect default Node.js metrics
        if (this.config.collectDefaultMetrics) {
            (0, prom_client_1.collectDefaultMetrics)({
                register: this.registry,
                prefix: `${this.config.prefix}_`
            });
        }
    }
    /**
     * Start metric collection and export
     */
    async start() {
        this.logger.info('Starting MetricExporter');
        // Start export timer if endpoint configured
        if (this.config.exportEndpoint) {
            this.exportTimer = setInterval(() => this.exportMetrics().catch(err => this.logger.error('Failed to export metrics', { error: err })), this.config.exportInterval);
        }
        this.logger.info('MetricExporter started');
    }
    /**
     * Stop metric collection and export
     */
    async stop() {
        this.logger.info('Stopping MetricExporter');
        if (this.exportTimer) {
            clearInterval(this.exportTimer);
            this.exportTimer = undefined;
        }
        // Final export
        if (this.config.exportEndpoint) {
            try {
                await this.exportMetrics();
            }
            catch (error) {
                this.logger.error('Failed final metric export', { error });
            }
        }
        this.logger.info('MetricExporter stopped');
    }
    /**
     * Register a new metric
     */
    registerMetric(definition) {
        const metricName = `${this.config.prefix}_${definition.name}`;
        if (this.metrics[metricName]) {
            this.logger.warn(`Metric already registered: ${metricName}`);
            return;
        }
        let metric;
        switch (definition.type) {
            case telemetry_1.MetricType.COUNTER:
                metric = new prom_client_1.Counter({
                    name: metricName,
                    help: definition.help,
                    labelNames: definition.labelNames || [],
                    registers: [this.registry]
                });
                break;
            case telemetry_1.MetricType.GAUGE:
                metric = new prom_client_1.Gauge({
                    name: metricName,
                    help: definition.help,
                    labelNames: definition.labelNames || [],
                    registers: [this.registry]
                });
                break;
            case telemetry_1.MetricType.HISTOGRAM:
                metric = new prom_client_1.Histogram({
                    name: metricName,
                    help: definition.help,
                    labelNames: definition.labelNames || [],
                    buckets: definition.buckets || [0.001, 0.01, 0.1, 0.5, 1, 2, 5, 10],
                    registers: [this.registry]
                });
                break;
            case telemetry_1.MetricType.SUMMARY:
                metric = new prom_client_1.Summary({
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
    recordMetric(value) {
        const metricName = `${this.config.prefix}_${value.metric}`;
        const metric = this.metrics[metricName];
        if (!metric) {
            this.logger.warn(`Metric not found: ${metricName}`);
            return;
        }
        const labels = value.labels || {};
        if (metric instanceof prom_client_1.Counter) {
            metric.inc(labels, value.value);
        }
        else if (metric instanceof prom_client_1.Gauge) {
            metric.set(labels, value.value);
        }
        else if (metric instanceof prom_client_1.Histogram) {
            metric.observe(labels, value.value);
        }
        else if (metric instanceof prom_client_1.Summary) {
            metric.observe(labels, value.value);
        }
        this.emit('metric:collected', value);
    }
    /**
     * Update module metrics
     */
    updateModuleMetrics(moduleId, metrics) {
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
    getSystemMetrics() {
        const modules = {};
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
    async getMetrics() {
        return this.registry.metrics();
    }
    /**
     * Export metrics to configured endpoint
     */
    async exportMetrics() {
        if (!this.config.exportEndpoint) {
            return;
        }
        const startTime = Date.now();
        try {
            const metrics = await this.getMetrics();
            const exportData = {
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
        }
        catch (error) {
            this.logger.error('Failed to export metrics', { error });
            throw error;
        }
    }
    /**
     * Send metrics with retry logic
     */
    async sendWithRetry(exportData) {
        let lastError;
        for (let attempt = 0; attempt < this.config.retryAttempts; attempt++) {
            try {
                await this.sendMetrics(exportData);
                return;
            }
            catch (error) {
                lastError = error;
                this.logger.warn(`Export attempt ${attempt + 1} failed`, { error });
                if (attempt < this.config.retryAttempts - 1) {
                    await new Promise(resolve => setTimeout(resolve, this.config.retryDelay * Math.pow(2, attempt)));
                }
            }
        }
        throw lastError || new Error('Failed to export metrics');
    }
    /**
     * Send metrics to endpoint
     */
    async sendMetrics(exportData) {
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
                }
                else {
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
    initializeSystemMetrics() {
        return {
            requestsTotal: new prom_client_1.Counter({
                name: `${this.config.prefix}_requests_total`,
                help: 'Total number of requests',
                labelNames: ['module', 'method', 'status'],
                registers: [this.registry]
            }),
            errorsTotal: new prom_client_1.Counter({
                name: `${this.config.prefix}_errors_total`,
                help: 'Total number of errors',
                labelNames: ['module', 'type'],
                registers: [this.registry]
            }),
            latencyHistogram: new prom_client_1.Histogram({
                name: `${this.config.prefix}_request_duration_seconds`,
                help: 'Request latency in seconds',
                labelNames: ['module', 'method'],
                buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5],
                registers: [this.registry]
            }),
            activeConnections: new prom_client_1.Gauge({
                name: `${this.config.prefix}_active_connections`,
                help: 'Number of active connections',
                labelNames: ['module'],
                registers: [this.registry]
            }),
            memoryUsage: new prom_client_1.Gauge({
                name: `${this.config.prefix}_memory_usage_bytes`,
                help: 'Memory usage in bytes',
                labelNames: ['module'],
                registers: [this.registry]
            }),
            cpuUsage: new prom_client_1.Gauge({
                name: `${this.config.prefix}_cpu_usage_percent`,
                help: 'CPU usage percentage',
                labelNames: ['module'],
                registers: [this.registry]
            }),
            messageQueueSize: new prom_client_1.Gauge({
                name: `${this.config.prefix}_message_queue_size`,
                help: 'Size of message queue',
                labelNames: ['module', 'priority'],
                registers: [this.registry]
            }),
            moduleStatus: new prom_client_1.Gauge({
                name: `${this.config.prefix}_module_status`,
                help: 'Module health status (1=healthy, 0=unhealthy)',
                labelNames: ['module'],
                registers: [this.registry]
            })
        };
    }
}
exports.MetricExporter = MetricExporter;
//# sourceMappingURL=MetricExporter.js.map