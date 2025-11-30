"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CapitalFlowLimiter = void 0;
const events_1 = require("events");
const createLogger = (name) => ({
    info: (message, meta) => console.log(`[${name}] INFO:`, message, meta || ''),
    error: (message, error) => console.error(`[${name}] ERROR:`, message, error || ''),
    debug: (message, meta) => console.debug(`[${name}] DEBUG:`, message, meta || ''),
    warn: (message, meta) => console.warn(`[${name}] WARN:`, message, meta || '')
});
class CapitalFlowLimiter extends events_1.EventEmitter {
    logger;
    config;
    flowEvents = [];
    metricsCache = new Map();
    emergencyStopTriggered = false;
    constructor(config) {
        super();
        this.logger = createLogger('CapitalFlowLimiter');
        this.config = config;
        this.logger.info('Capital flow limiter initialized', {
            totalCapital: config.totalCapital,
            limits: Object.keys(config.limits).length
        });
    }
    /**
     * Validate a capital flow
     */
    async validateFlow(type, amount, description, metadata) {
        const flowEvent = {
            id: this.generateFlowId(),
            type,
            amount,
            from: metadata?.from,
            to: metadata?.to,
            timestamp: new Date(),
            description,
            approved: false
        };
        // Check emergency stop
        if (this.emergencyStopTriggered) {
            flowEvent.rejectionReason = 'Emergency stop active';
            this.flowEvents.push(flowEvent);
            this.emit('flow-rejected', flowEvent);
            return { approved: false, reason: flowEvent.rejectionReason, flowEvent };
        }
        // Validate against all configured limits
        const violations = [];
        // Check minute limit
        if (this.config.limits.minute) {
            const violation = this.checkLimit('minute', this.config.limits.minute, amount, type);
            if (violation)
                violations.push(violation);
        }
        // Check hour limit
        if (this.config.limits.hour) {
            const violation = this.checkLimit('hour', this.config.limits.hour, amount, type);
            if (violation)
                violations.push(violation);
        }
        // Check day limit
        if (this.config.limits.day) {
            const violation = this.checkLimit('day', this.config.limits.day, amount, type);
            if (violation)
                violations.push(violation);
        }
        // Check custom limits
        if (this.config.limits.custom) {
            for (const limit of this.config.limits.custom) {
                const violation = this.checkLimit(`custom-${limit.periodMs}`, limit, amount, type);
                if (violation)
                    violations.push(violation);
            }
        }
        // Make decision
        if (violations.length > 0) {
            flowEvent.approved = false;
            flowEvent.rejectionReason = violations.join('; ');
            this.logger.warn('Capital flow rejected', {
                type,
                amount,
                violations
            });
            this.emit('flow-rejected', flowEvent);
        }
        else {
            flowEvent.approved = true;
            this.logger.info('Capital flow approved', {
                type,
                amount,
                description
            });
            // Check warning threshold
            this.checkWarningThreshold(amount, type);
            // Check emergency threshold
            this.checkEmergencyThreshold(amount, type);
            this.emit('flow-approved', flowEvent);
        }
        // Record the event
        this.flowEvents.push(flowEvent);
        this.invalidateMetricsCache();
        return {
            approved: flowEvent.approved,
            reason: flowEvent.rejectionReason,
            flowEvent
        };
    }
    /**
     * Get flow metrics for a period
     */
    getMetrics(periodMs) {
        const cacheKey = `metrics-${periodMs}`;
        const cached = this.metricsCache.get(cacheKey);
        if (cached && cached.periodEnd.getTime() > Date.now() - 1000) {
            return cached;
        }
        const now = Date.now();
        const periodStart = new Date(now - periodMs);
        const periodEnd = new Date(now);
        const relevantEvents = this.flowEvents.filter(event => event.timestamp.getTime() >= periodStart.getTime());
        let totalInflow = 0;
        let totalOutflow = 0;
        let rejectedCount = 0;
        let largestFlow = null;
        for (const event of relevantEvents) {
            if (!event.approved) {
                rejectedCount++;
                continue;
            }
            if (event.type === 'INFLOW') {
                totalInflow += event.amount;
            }
            else if (event.type === 'OUTFLOW') {
                totalOutflow += event.amount;
            }
            if (!largestFlow || event.amount > largestFlow.amount) {
                largestFlow = event;
            }
        }
        const metrics = {
            periodStart,
            periodEnd,
            totalInflow,
            totalOutflow,
            netFlow: totalInflow - totalOutflow,
            eventCount: relevantEvents.length,
            rejectedCount,
            largestFlow
        };
        this.metricsCache.set(cacheKey, metrics);
        return metrics;
    }
    /**
     * Reset emergency stop
     */
    resetEmergencyStop(reason) {
        if (!this.emergencyStopTriggered) {
            return;
        }
        this.emergencyStopTriggered = false;
        this.logger.info('Emergency stop reset', { reason });
        this.emit('emergency-stop-reset', { reason });
    }
    /**
     * Update total capital
     */
    updateTotalCapital(newTotal) {
        const oldTotal = this.config.totalCapital;
        this.config.totalCapital = newTotal;
        this.logger.info('Total capital updated', {
            oldTotal,
            newTotal,
            change: newTotal - oldTotal
        });
        this.emit('capital-updated', {
            oldTotal,
            newTotal
        });
    }
    /**
     * Get flow history
     */
    getFlowHistory(filter) {
        let events = [...this.flowEvents];
        if (filter) {
            if (filter.type) {
                events = events.filter(e => e.type === filter.type);
            }
            if (filter.approved !== undefined) {
                events = events.filter(e => e.approved === filter.approved);
            }
            if (filter.startDate) {
                const startDate = filter.startDate;
                events = events.filter(e => e.timestamp >= startDate);
            }
            if (filter.endDate) {
                const endDate = filter.endDate;
                events = events.filter(e => e.timestamp <= endDate);
            }
        }
        return events;
    }
    /**
     * Clear old flow events
     */
    cleanup(olderThanMs = 7 * 24 * 60 * 60 * 1000) {
        const cutoff = Date.now() - olderThanMs;
        const before = this.flowEvents.length;
        this.flowEvents = this.flowEvents.filter(event => event.timestamp.getTime() > cutoff);
        const removed = before - this.flowEvents.length;
        if (removed > 0) {
            this.logger.info(`Cleaned up ${removed} old flow events`);
            this.invalidateMetricsCache();
        }
        return removed;
    }
    // Private methods
    generateFlowId() {
        return `flow-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    }
    checkLimit(name, limit, amount, type) {
        const metrics = this.getMetrics(limit.periodMs);
        // Calculate what the new total would be
        let projectedTotal = 0;
        if (type === 'OUTFLOW' || type === 'TRANSFER') {
            projectedTotal = metrics.totalOutflow + amount;
        }
        else {
            // For inflows, we might want different logic
            return null;
        }
        // Check absolute limit
        if (limit.maxAmount && projectedTotal > limit.maxAmount) {
            return `Exceeds ${name} absolute limit: ${projectedTotal} > ${limit.maxAmount}`;
        }
        // Check percentage limit
        if (limit.maxPercentage) {
            const percentage = (projectedTotal / this.config.totalCapital) * 100;
            if (percentage > limit.maxPercentage) {
                return `Exceeds ${name} percentage limit: ${percentage.toFixed(2)}% > ${limit.maxPercentage}%`;
            }
        }
        return null;
    }
    checkWarningThreshold(amount, type) {
        if (!this.config.warningThreshold || type === 'INFLOW') {
            return;
        }
        const percentage = (amount / this.config.totalCapital) * 100;
        if (percentage >= this.config.warningThreshold) {
            this.logger.warn('Large capital flow warning', {
                amount,
                percentage: percentage.toFixed(2),
                type
            });
            this.emit('warning-threshold', {
                amount,
                percentage,
                type,
                threshold: this.config.warningThreshold
            });
        }
    }
    checkEmergencyThreshold(amount, type) {
        if (!this.config.emergencyStopThreshold || type === 'INFLOW') {
            return;
        }
        const percentage = (amount / this.config.totalCapital) * 100;
        if (percentage >= this.config.emergencyStopThreshold) {
            this.emergencyStopTriggered = true;
            this.logger.error('🚨 EMERGENCY STOP TRIGGERED - Excessive capital flow', {
                amount,
                percentage: percentage.toFixed(2),
                type,
                threshold: this.config.emergencyStopThreshold
            });
            this.emit('emergency-stop-triggered', {
                amount,
                percentage,
                type,
                threshold: this.config.emergencyStopThreshold
            });
        }
    }
    invalidateMetricsCache() {
        this.metricsCache.clear();
    }
    /**
     * Get current status
     */
    getStatus() {
        return {
            emergencyStopActive: this.emergencyStopTriggered,
            totalCapital: this.config.totalCapital,
            recentFlows: {
                minute: this.getMetrics(60 * 1000),
                hour: this.getMetrics(60 * 60 * 1000),
                day: this.getMetrics(24 * 60 * 60 * 1000)
            },
            limits: this.config.limits
        };
    }
    /**
     * Destroy and clean up
     */
    destroy() {
        this.flowEvents = [];
        this.metricsCache.clear();
        this.removeAllListeners();
        this.logger.info('Capital flow limiter destroyed');
    }
}
exports.CapitalFlowLimiter = CapitalFlowLimiter;
//# sourceMappingURL=CapitalFlowLimiter.js.map