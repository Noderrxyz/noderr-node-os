"use strict";
/**
 * TelemetryService - Main orchestration service for system observability
 *
 * Coordinates metrics collection, logging, tracing, and alerting
 * to provide comprehensive system monitoring.
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
exports.TelemetryService = void 0;
const events_1 = require("events");
const http = __importStar(require("http"));
const MetricExporter_1 = require("./exporters/MetricExporter");
const LogBridge_1 = require("./loggers/LogBridge");
const Tracer_1 = require("./tracers/Tracer");
const ErrorAlertRouter_1 = require("./ErrorAlertRouter");
const MetricsCollector_1 = require("./collectors/MetricsCollector");
const telemetry_1 = require("./types/telemetry");
class TelemetryService extends events_1.EventEmitter {
    logger;
    config;
    metricExporter;
    metricsCollector;
    logBridge;
    tracer;
    alertRouter;
    metricsServer;
    healthStatus = {};
    startTime = Date.now();
    constructor(logger, config) {
        super();
        this.logger = logger;
        this.config = config;
    }
    /**
     * Initialize telemetry components
     */
    async initialize() {
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
    async start() {
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
    async stop() {
        this.logger.info('Stopping TelemetryService');
        this.healthStatus.telemetry = false;
        // Stop metrics server
        if (this.metricsServer) {
            await new Promise((resolve) => {
                this.metricsServer.close(() => resolve());
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
    registerMetric(definition) {
        if (!this.metricExporter) {
            throw new Error('Metrics not enabled');
        }
        this.metricExporter.registerMetric(definition);
    }
    /**
     * Record a metric value
     */
    recordMetric(value) {
        if (!this.metricExporter) {
            return;
        }
        this.metricExporter.recordMetric(value);
    }
    /**
     * Update module metrics
     */
    updateModuleMetrics(moduleId, metrics) {
        if (!this.metricExporter) {
            return;
        }
        this.metricExporter.updateModuleMetrics(moduleId, metrics);
    }
    /**
     * Get system metrics
     */
    getSystemMetrics() {
        if (!this.metricExporter) {
            return null;
        }
        return this.metricExporter.getSystemMetrics();
    }
    /**
     * Log a message
     */
    log(level, module, message, metadata) {
        if (!this.logBridge) {
            // Fallback to console
            console.log(`[${level}] [${module}] ${message}`, metadata);
            return;
        }
        this.logBridge.log(level, module, message, metadata);
    }
    /**
     * Convenience logging methods
     */
    debug(module, message, metadata) {
        this.log(telemetry_1.LogLevel.DEBUG, module, message, metadata);
    }
    info(module, message, metadata) {
        this.log(telemetry_1.LogLevel.INFO, module, message, metadata);
    }
    warn(module, message, metadata) {
        this.log(telemetry_1.LogLevel.WARN, module, message, metadata);
    }
    // Keep the logging error method separate from EventEmitter error event
    logError(module, message, metadata) {
        this.log(telemetry_1.LogLevel.ERROR, module, message, metadata);
    }
    /**
     * Start a trace span
     */
    startSpan(name, options) {
        if (!this.tracer) {
            return null;
        }
        return this.tracer.startSpan(name, options);
    }
    /**
     * End a trace span
     */
    endSpan(spanId, status) {
        if (!this.tracer) {
            return;
        }
        this.tracer.endSpan(spanId, status);
    }
    /**
     * Set trace context
     */
    setTraceContext(context) {
        if (this.logBridge) {
            this.logBridge.setTraceContext(context);
        }
    }
    /**
     * Trigger an alert
     */
    async triggerAlert(alert) {
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
    addAlertRule(rule) {
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
    getHealthStatus() {
        return {
            ...this.healthStatus,
            uptime: Date.now() - this.startTime
        };
    }
    /**
     * Get telemetry dashboard
     */
    getDashboard() {
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
    async initializeMetrics() {
        const exportEndpoint = this.config.metrics?.endpoint;
        this.metricExporter = new MetricExporter_1.MetricExporter(this.logger, {
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
        this.metricsCollector = new MetricsCollector_1.MetricsCollector(this.logger, this.metricExporter);
        // Setup metric event forwarding
        this.metricExporter.on('metric:collected', (metric) => {
            this.emit('metric:collected', metric);
        });
        this.metricExporter.on('metric:exported', (count) => {
            this.emit('metric:exported', count);
        });
        this.healthStatus.metrics = true;
    }
    /**
     * Initialize logging
     */
    async initializeLogging() {
        this.logBridge = new LogBridge_1.LogBridge({
            level: this.config.logging?.level || telemetry_1.LogLevel.INFO,
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
        this.logBridge.on('log:written', (entry) => {
            this.emit('log:written', entry);
        });
        this.logBridge.on('log:flushed', (count) => {
            this.emit('log:flushed', count);
        });
        this.healthStatus.logging = true;
    }
    /**
     * Initialize tracing
     */
    async initializeTracing() {
        this.tracer = new Tracer_1.Tracer({
            serviceName: this.config.serviceName,
            serviceVersion: this.config.version,
            environment: this.config.environment,
            endpoint: this.config.tracing?.endpoint || 'http://localhost:4318/v1/traces',
            samplingRate: this.config.tracing?.sampleRate || 1.0
        });
        // Setup trace event forwarding
        this.tracer.on('trace:started', (span) => {
            this.emit('trace:started', span);
        });
        this.tracer.on('trace:ended', (span) => {
            this.emit('trace:ended', span);
        });
        this.healthStatus.tracing = true;
    }
    /**
     * Initialize alerting
     */
    async initializeAlerting() {
        const channels = this.config.alerting?.channels || [];
        this.alertRouter = new ErrorAlertRouter_1.ErrorAlertRouter(this.logger, {
            channels,
            rules: this.config.alerting?.rules || []
        });
        // Setup alert event forwarding
        this.alertRouter.on('alert:triggered', (alert) => {
            this.emit('alert:triggered', alert);
        });
        this.alertRouter.on('alert:resolved', (alert) => {
            this.emit('alert:resolved', alert);
        });
        this.healthStatus.alerting = true;
    }
    /**
     * Start metrics server
     */
    async startMetricsServer(port) {
        this.metricsServer = http.createServer(async (req, res) => {
            if (req.url === '/metrics' && this.metricExporter) {
                try {
                    const metrics = await this.metricExporter.getMetrics();
                    res.writeHead(200, { 'Content-Type': 'text/plain' });
                    res.end(metrics);
                }
                catch (error) {
                    res.writeHead(500);
                    res.end('Error collecting metrics');
                }
            }
            else if (req.url === '/health') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(this.getHealthStatus()));
            }
            else {
                res.writeHead(404);
                res.end('Not found');
            }
        });
        await new Promise((resolve) => {
            this.metricsServer.listen(port, () => {
                this.logger.info(`Metrics server listening on port ${port}`);
                resolve();
            });
        });
    }
    /**
     * Setup internal monitoring
     */
    setupInternalMonitoring() {
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
    'metric:collected' = (metric) => { };
    'metric:exported' = (count) => { };
    'log:written' = (entry) => { };
    'log:flushed' = (count) => { };
    'trace:started' = (span) => { };
    'trace:ended' = (span) => { };
    'alert:triggered' = (alert) => { };
    'alert:resolved' = (alert) => { };
    'error' = (error) => { };
}
exports.TelemetryService = TelemetryService;
//# sourceMappingURL=TelemetryService.js.map