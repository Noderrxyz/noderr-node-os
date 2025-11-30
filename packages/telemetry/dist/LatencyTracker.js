"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EnhancedLatencyTracker = void 0;
const prom_client_1 = require("prom-client");
const hdr_histogram_js_1 = require("hdr-histogram-js");
const events_1 = require("events");
/**
 * Enhanced latency tracker with HDR histograms
 */
class EnhancedLatencyTracker extends events_1.EventEmitter {
    hdrHistograms;
    promHistograms;
    latencyCounters;
    currentLatencyGauges;
    thresholds;
    registry;
    logger;
    checkInterval = null;
    constructor(registry, logger, checkIntervalMs = 1000) {
        super();
        this.registry = registry;
        this.logger = logger;
        this.hdrHistograms = new Map();
        this.promHistograms = new Map();
        this.latencyCounters = new Map();
        this.currentLatencyGauges = new Map();
        this.thresholds = new Map();
        // Start periodic threshold checking
        this.checkInterval = setInterval(() => {
            this.checkThresholds();
        }, checkIntervalMs);
    }
    /**
     * Configure thresholds for an operation
     */
    configureThresholds(operation, thresholds) {
        this.thresholds.set(operation, thresholds);
    }
    /**
     * Record a latency measurement
     */
    recordLatency(operation, latencyUs) {
        // Get or create HDR histogram
        let hdrHist = this.hdrHistograms.get(operation);
        if (!hdrHist) {
            // Create HDR histogram with microsecond precision
            // Range: 1us to 1 second, 3 significant figures
            hdrHist = (0, hdr_histogram_js_1.build)({
                lowestDiscernibleValue: 1,
                highestTrackableValue: 1000000,
                numberOfSignificantValueDigits: 3
            });
            this.hdrHistograms.set(operation, hdrHist);
        }
        // Get or create Prometheus histogram
        let promHist = this.promHistograms.get(operation);
        if (!promHist) {
            promHist = new prom_client_1.Histogram({
                name: `trading_latency_${operation.replace(/[^a-zA-Z0-9]/g, '_')}`,
                help: `Latency histogram for ${operation}`,
                labelNames: ['operation'],
                buckets: [
                    0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10
                ], // milliseconds
                registers: [this.registry]
            });
            this.promHistograms.set(operation, promHist);
        }
        // Get or create counter
        let counter = this.latencyCounters.get(operation);
        if (!counter) {
            counter = new prom_client_1.Counter({
                name: `trading_operations_total_${operation.replace(/[^a-zA-Z0-9]/g, '_')}`,
                help: `Total operations for ${operation}`,
                labelNames: ['operation'],
                registers: [this.registry]
            });
            this.latencyCounters.set(operation, counter);
        }
        // Get or create current latency gauge
        let gauge = this.currentLatencyGauges.get(operation);
        if (!gauge) {
            gauge = new prom_client_1.Gauge({
                name: `trading_current_latency_${operation.replace(/[^a-zA-Z0-9]/g, '_')}`,
                help: `Current latency for ${operation}`,
                labelNames: ['operation'],
                registers: [this.registry]
            });
            this.currentLatencyGauges.set(operation, gauge);
        }
        // Record in both histograms
        hdrHist.recordValue(latencyUs);
        promHist.observe({ operation }, latencyUs / 1000); // Convert to ms for Prometheus
        counter.inc({ operation });
        gauge.set({ operation }, latencyUs);
    }
    /**
     * Get percentile latencies for an operation
     */
    getPercentiles(operation) {
        const hdrHist = this.hdrHistograms.get(operation);
        if (!hdrHist) {
            return null;
        }
        return {
            p50: hdrHist.getValueAtPercentile(50),
            p90: hdrHist.getValueAtPercentile(90),
            p95: hdrHist.getValueAtPercentile(95),
            p99: hdrHist.getValueAtPercentile(99),
            p999: hdrHist.getValueAtPercentile(99.9),
            p9999: hdrHist.getValueAtPercentile(99.99),
            max: hdrHist.maxValue,
            min: hdrHist.minNonZeroValue,
            mean: hdrHist.mean,
            stdDev: hdrHist.stdDeviation,
            count: hdrHist.totalCount
        };
    }
    /**
     * Check thresholds and emit alerts
     */
    checkThresholds() {
        for (const [operation, thresholds] of this.thresholds) {
            const percentiles = this.getPercentiles(operation);
            if (!percentiles)
                continue;
            // Check each percentile
            this.checkPercentileThreshold(operation, 'p50', percentiles.p50, thresholds.p50Warning, thresholds.p50Critical);
            this.checkPercentileThreshold(operation, 'p90', percentiles.p90, thresholds.p90Warning, thresholds.p90Critical);
            this.checkPercentileThreshold(operation, 'p99', percentiles.p99, thresholds.p99Warning, thresholds.p99Critical);
            this.checkPercentileThreshold(operation, 'p999', percentiles.p999, thresholds.p999Warning, thresholds.p999Critical);
        }
    }
    /**
     * Check a single percentile against thresholds
     */
    checkPercentileThreshold(operation, percentile, value, warningThreshold, criticalThreshold) {
        if (value >= criticalThreshold) {
            const alert = {
                operation,
                percentile,
                value,
                threshold: criticalThreshold,
                severity: 'critical',
                timestamp: new Date()
            };
            this.logger.error('Latency threshold exceeded', alert);
            this.emit('alert', alert);
        }
        else if (value >= warningThreshold) {
            const alert = {
                operation,
                percentile,
                value,
                threshold: warningThreshold,
                severity: 'warning',
                timestamp: new Date()
            };
            this.logger.warn('Latency threshold warning', alert);
            this.emit('alert', alert);
        }
    }
    /**
     * Export histogram data for analysis
     */
    exportHistogram(operation) {
        const hdrHist = this.hdrHistograms.get(operation);
        if (!hdrHist) {
            return null;
        }
        const percentiles = [];
        for (let p = 0; p <= 100; p += 0.1) {
            percentiles.push({
                percentile: p,
                value: hdrHist.getValueAtPercentile(p)
            });
        }
        return {
            operation,
            timestamp: new Date(),
            totalCount: hdrHist.totalCount,
            min: hdrHist.minNonZeroValue,
            max: hdrHist.maxValue,
            mean: hdrHist.mean,
            stdDev: hdrHist.stdDeviation,
            percentiles
        };
    }
    /**
     * Reset histograms for an operation
     */
    reset(operation) {
        const hdrHist = this.hdrHistograms.get(operation);
        if (hdrHist) {
            hdrHist.reset();
        }
    }
    /**
     * Reset all histograms
     */
    resetAll() {
        for (const hdrHist of this.hdrHistograms.values()) {
            hdrHist.reset();
        }
    }
    /**
     * Cleanup resources
     */
    destroy() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
    }
}
exports.EnhancedLatencyTracker = EnhancedLatencyTracker;
//# sourceMappingURL=LatencyTracker.js.map