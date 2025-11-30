"use strict";
/**
 * Telemetry Types - Core types for system observability
 *
 * Defines metric types, log formats, tracing, and alerting structures
 * for comprehensive system monitoring.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AlertSeverity = exports.LogLevel = exports.MetricType = void 0;
// Metric Types
var MetricType;
(function (MetricType) {
    MetricType["COUNTER"] = "counter";
    MetricType["GAUGE"] = "gauge";
    MetricType["HISTOGRAM"] = "histogram";
    MetricType["SUMMARY"] = "summary";
})(MetricType || (exports.MetricType = MetricType = {}));
// Log Types
var LogLevel;
(function (LogLevel) {
    LogLevel["DEBUG"] = "debug";
    LogLevel["INFO"] = "info";
    LogLevel["WARN"] = "warn";
    LogLevel["ERROR"] = "error";
    LogLevel["FATAL"] = "fatal";
})(LogLevel || (exports.LogLevel = LogLevel = {}));
// Alert Types
var AlertSeverity;
(function (AlertSeverity) {
    AlertSeverity["INFO"] = "info";
    AlertSeverity["WARNING"] = "warning";
    AlertSeverity["ERROR"] = "error";
    AlertSeverity["CRITICAL"] = "critical";
})(AlertSeverity || (exports.AlertSeverity = AlertSeverity = {}));
//# sourceMappingURL=telemetry.js.map