"use strict";
/**
 * @noderr/telemetry - Unified telemetry system
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Panel = exports.Dashboard = exports.Alert = exports.AlertManager = exports.Span = exports.Tracer = exports.Gauge = exports.Histogram = exports.Counter = exports.MetricsCollector = exports.TelemetrySystem = void 0;
const winston_1 = require("winston");
// Core telemetry system
class TelemetrySystem {
    logger;
    serviceName;
    environment;
    constructor(config) {
        this.serviceName = config.serviceName;
        this.environment = config.environment;
        this.logger = (0, winston_1.createLogger)({
            format: winston_1.format.combine(winston_1.format.timestamp(), winston_1.format.json()),
            defaultMeta: { service: `telemetry:${config.serviceName}` },
            transports: [new winston_1.transports.Console()]
        });
        this.logger.info('TelemetrySystem initialized', {
            serviceName: config.serviceName,
            environment: config.environment,
            exporters: config.exporters
        });
    }
    getMetrics() {
        return new MetricsCollector(this.serviceName);
    }
    getTracer() {
        return new Tracer(this.serviceName);
    }
}
exports.TelemetrySystem = TelemetrySystem;
// Metrics collector
class MetricsCollector {
    serviceName;
    counters = new Map();
    histograms = new Map();
    gauges = new Map();
    constructor(serviceName) {
        this.serviceName = serviceName;
    }
    counter(name) {
        if (!this.counters.has(name)) {
            this.counters.set(name, new Counter(name));
        }
        return this.counters.get(name);
    }
    histogram(name) {
        if (!this.histograms.has(name)) {
            this.histograms.set(name, new Histogram(name));
        }
        return this.histograms.get(name);
    }
    gauge(name) {
        if (!this.gauges.has(name)) {
            this.gauges.set(name, new Gauge(name));
        }
        return this.gauges.get(name);
    }
}
exports.MetricsCollector = MetricsCollector;
// Counter metric
class Counter {
    name;
    value = 0;
    constructor(name) {
        this.name = name;
    }
    increment(value = 1) {
        this.value += value;
    }
    getValue() {
        return this.value;
    }
    reset() {
        this.value = 0;
    }
}
exports.Counter = Counter;
// Histogram metric
class Histogram {
    name;
    values = [];
    constructor(name) {
        this.name = name;
    }
    record(value) {
        this.values.push(value);
    }
    getValues() {
        return [...this.values];
    }
    reset() {
        this.values = [];
    }
}
exports.Histogram = Histogram;
// Gauge metric
class Gauge {
    name;
    value = 0;
    constructor(name) {
        this.name = name;
    }
    set(value) {
        this.value = value;
    }
    getValue() {
        return this.value;
    }
    increment(value = 1) {
        this.value += value;
    }
    decrement(value = 1) {
        this.value -= value;
    }
}
exports.Gauge = Gauge;
// Tracer for distributed tracing
class Tracer {
    serviceName;
    constructor(serviceName) {
        this.serviceName = serviceName;
    }
    startSpan(name) {
        return new Span(name, this.serviceName);
    }
}
exports.Tracer = Tracer;
// Span for tracing
class Span {
    name;
    serviceName;
    startTime;
    endTime;
    attributes = {};
    constructor(name, serviceName) {
        this.name = name;
        this.serviceName = serviceName;
        this.startTime = Date.now();
    }
    setAttribute(key, value) {
        this.attributes[key] = value;
    }
    end() {
        this.endTime = Date.now();
    }
    getDuration() {
        if (!this.endTime)
            return undefined;
        return this.endTime - this.startTime;
    }
}
exports.Span = Span;
// Alert manager
class AlertManager {
    alerts = [];
    logger;
    constructor() {
        this.logger = (0, winston_1.createLogger)({
            format: winston_1.format.combine(winston_1.format.timestamp(), winston_1.format.json()),
            defaultMeta: { service: 'AlertManager' },
            transports: [new winston_1.transports.Console()]
        });
    }
    createAlert(config) {
        const alert = new Alert(config);
        this.alerts.push(alert);
        this.logger.info('Alert created', { name: config.name });
        return alert;
    }
    getAlerts() {
        return [...this.alerts];
    }
}
exports.AlertManager = AlertManager;
// Alert
class Alert {
    config;
    constructor(config) {
        this.config = config;
    }
    getName() {
        return this.config.name;
    }
    getSeverity() {
        return this.config.severity;
    }
    getChannels() {
        return [...this.config.channels];
    }
}
exports.Alert = Alert;
// Dashboard
class Dashboard {
    config;
    panels = [];
    constructor(config) {
        this.config = config;
    }
    addPanel(config) {
        this.panels.push(new Panel(config));
    }
    getPanels() {
        return [...this.panels];
    }
}
exports.Dashboard = Dashboard;
// Panel
class Panel {
    config;
    constructor(config) {
        this.config = config;
    }
    getTitle() {
        return this.config.title;
    }
    getMetric() {
        return this.config.metric;
    }
    getVisualization() {
        return this.config.visualization;
    }
}
exports.Panel = Panel;
//# sourceMappingURL=index.js.map