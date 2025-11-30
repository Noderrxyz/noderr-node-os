"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AlertManager = exports.AlertType = exports.AlertSeverity = void 0;
const events_1 = require("events");
/**
 * Alert severity levels
 */
var AlertSeverity;
(function (AlertSeverity) {
    AlertSeverity["INFO"] = "info";
    AlertSeverity["WARNING"] = "warning";
    AlertSeverity["ERROR"] = "error";
    AlertSeverity["CRITICAL"] = "critical";
})(AlertSeverity || (exports.AlertSeverity = AlertSeverity = {}));
/**
 * Alert types
 */
var AlertType;
(function (AlertType) {
    AlertType["LATENCY"] = "latency";
    AlertType["ERROR_RATE"] = "error_rate";
    AlertType["RISK_LIMIT"] = "risk_limit";
    AlertType["DRAWDOWN"] = "drawdown";
    AlertType["SYSTEM_HEALTH"] = "system_health";
    AlertType["MARKET_ANOMALY"] = "market_anomaly";
    AlertType["EXECUTION_FAILURE"] = "execution_failure";
    AlertType["CONNECTIVITY"] = "connectivity";
})(AlertType || (exports.AlertType = AlertType = {}));
/**
 * Alert manager for trading system
 */
class AlertManager extends events_1.EventEmitter {
    logger;
    rules = new Map();
    activeAlerts = new Map();
    alertHistory = [];
    cooldowns = new Map();
    maxHistorySize = 1000;
    constructor(logger) {
        super();
        this.logger = logger;
        this.initializeDefaultRules();
    }
    /**
     * Initialize default alert rules
     */
    initializeDefaultRules() {
        // Latency alerts
        this.addRule({
            id: 'high_latency_warning',
            name: 'High Latency Warning',
            description: 'Warns when P99 latency exceeds threshold',
            config: {
                type: AlertType.LATENCY,
                severity: AlertSeverity.WARNING,
                threshold: 100, // 100ms
                window: 60,
                cooldown: 300,
                enabled: true,
                actions: [
                    { type: 'log', config: {} },
                    { type: 'webhook', config: { url: process.env.ALERT_WEBHOOK_URL } }
                ]
            },
            triggerCount: 0,
            active: true
        });
        this.addRule({
            id: 'critical_latency',
            name: 'Critical Latency',
            description: 'Critical alert when P99 latency is extremely high',
            config: {
                type: AlertType.LATENCY,
                severity: AlertSeverity.CRITICAL,
                threshold: 500, // 500ms
                window: 30,
                cooldown: 600,
                enabled: true,
                actions: [
                    { type: 'log', config: {} },
                    { type: 'email', config: { to: process.env.ALERT_EMAIL } },
                    { type: 'circuit_breaker', config: { duration: 60 } }
                ]
            },
            triggerCount: 0,
            active: true
        });
        // Error rate alerts
        this.addRule({
            id: 'high_error_rate',
            name: 'High Error Rate',
            description: 'Alerts when error rate exceeds threshold',
            config: {
                type: AlertType.ERROR_RATE,
                severity: AlertSeverity.ERROR,
                threshold: 0.05, // 5%
                window: 300,
                cooldown: 600,
                enabled: true,
                actions: [
                    { type: 'log', config: {} },
                    { type: 'webhook', config: { url: process.env.ALERT_WEBHOOK_URL } }
                ]
            },
            triggerCount: 0,
            active: true
        });
        // Risk alerts
        this.addRule({
            id: 'risk_limit_breach',
            name: 'Risk Limit Breach',
            description: 'Alerts when risk limits are breached',
            config: {
                type: AlertType.RISK_LIMIT,
                severity: AlertSeverity.CRITICAL,
                threshold: 1.0, // 100% of limit
                window: 1,
                cooldown: 60,
                enabled: true,
                actions: [
                    { type: 'log', config: {} },
                    { type: 'circuit_breaker', config: { duration: 300 } }
                ]
            },
            triggerCount: 0,
            active: true
        });
        // Drawdown alerts
        this.addRule({
            id: 'drawdown_warning',
            name: 'Drawdown Warning',
            description: 'Warns when drawdown exceeds threshold',
            config: {
                type: AlertType.DRAWDOWN,
                severity: AlertSeverity.WARNING,
                threshold: 0.05, // 5%
                window: 3600,
                cooldown: 1800,
                enabled: true,
                actions: [
                    { type: 'log', config: {} },
                    { type: 'email', config: { to: process.env.ALERT_EMAIL } }
                ]
            },
            triggerCount: 0,
            active: true
        });
    }
    /**
     * Add an alert rule
     */
    addRule(rule) {
        this.rules.set(rule.id, rule);
        this.logger.info('Alert rule added', { ruleId: rule.id, name: rule.name });
    }
    /**
     * Remove an alert rule
     */
    removeRule(ruleId) {
        this.rules.delete(ruleId);
        this.logger.info('Alert rule removed', { ruleId });
    }
    /**
     * Update an alert rule
     */
    updateRule(ruleId, updates) {
        const rule = this.rules.get(ruleId);
        if (!rule) {
            throw new Error(`Rule ${ruleId} not found`);
        }
        Object.assign(rule, updates);
        this.logger.info('Alert rule updated', { ruleId, updates });
    }
    /**
     * Check if an alert should be triggered
     */
    checkAlert(type, value, metadata = {}) {
        const rules = Array.from(this.rules.values()).filter(rule => rule.config.type === type && rule.active && rule.config.enabled);
        for (const rule of rules) {
            if (this.shouldTrigger(rule, value)) {
                this.triggerAlert(rule, value, metadata);
            }
        }
    }
    /**
     * Check if a rule should trigger
     */
    shouldTrigger(rule, value) {
        // Check threshold
        if (value < rule.config.threshold) {
            return false;
        }
        // Check cooldown
        const cooldownEnd = this.cooldowns.get(rule.id);
        if (cooldownEnd && new Date() < cooldownEnd) {
            return false;
        }
        return true;
    }
    /**
     * Trigger an alert
     */
    triggerAlert(rule, value, metadata) {
        const alert = {
            id: `${rule.id}_${Date.now()}`,
            type: rule.config.type,
            severity: rule.config.severity,
            title: rule.name,
            message: this.formatAlertMessage(rule, value),
            timestamp: new Date(),
            value,
            threshold: rule.config.threshold,
            metadata,
            acknowledged: false
        };
        // Store alert
        this.activeAlerts.set(alert.id, alert);
        this.alertHistory.push(alert);
        // Maintain history size
        if (this.alertHistory.length > this.maxHistorySize) {
            this.alertHistory.shift();
        }
        // Update rule
        rule.lastTriggered = new Date();
        rule.triggerCount++;
        // Set cooldown
        const cooldownEnd = new Date();
        cooldownEnd.setSeconds(cooldownEnd.getSeconds() + rule.config.cooldown);
        this.cooldowns.set(rule.id, cooldownEnd);
        // Execute actions
        this.executeActions(alert, rule.config.actions);
        // Emit event
        this.emit('alertTriggered', alert);
        this.logger.warn('Alert triggered', {
            alertId: alert.id,
            type: alert.type,
            severity: alert.severity,
            value,
            threshold: rule.config.threshold
        });
    }
    /**
     * Format alert message
     */
    formatAlertMessage(rule, value) {
        const percentage = ((value / rule.config.threshold - 1) * 100).toFixed(1);
        return `${rule.description}. Current value: ${value}, Threshold: ${rule.config.threshold} (+${percentage}%)`;
    }
    /**
     * Execute alert actions
     */
    executeActions(alert, actions) {
        for (const action of actions) {
            try {
                switch (action.type) {
                    case 'log':
                        this.executeLogAction(alert);
                        break;
                    case 'email':
                        this.executeEmailAction(alert, action.config);
                        break;
                    case 'webhook':
                        this.executeWebhookAction(alert, action.config);
                        break;
                    case 'circuit_breaker':
                        this.executeCircuitBreakerAction(alert, action.config);
                        break;
                    default:
                        this.logger.warn('Unknown alert action type', { type: action.type });
                }
            }
            catch (error) {
                this.logger.error('Failed to execute alert action', {
                    alertId: alert.id,
                    actionType: action.type,
                    error
                });
            }
        }
    }
    /**
     * Execute log action
     */
    executeLogAction(alert) {
        const logLevel = this.getLogLevel(alert.severity);
        this.logger.log(logLevel, 'Trading Alert', {
            alert: {
                id: alert.id,
                type: alert.type,
                severity: alert.severity,
                title: alert.title,
                message: alert.message,
                value: alert.value,
                threshold: alert.threshold,
                metadata: alert.metadata
            }
        });
    }
    /**
     * Execute email action (placeholder)
     */
    executeEmailAction(alert, config) {
        // In a real implementation, this would send an email
        this.emit('emailAlert', { alert, config });
    }
    /**
     * Execute webhook action (placeholder)
     */
    executeWebhookAction(alert, config) {
        // In a real implementation, this would call a webhook
        this.emit('webhookAlert', { alert, config });
    }
    /**
     * Execute circuit breaker action
     */
    executeCircuitBreakerAction(alert, config) {
        const duration = config.duration || 60;
        this.emit('circuitBreaker', { alert, duration });
    }
    /**
     * Get log level for severity
     */
    getLogLevel(severity) {
        switch (severity) {
            case AlertSeverity.INFO:
                return 'info';
            case AlertSeverity.WARNING:
                return 'warn';
            case AlertSeverity.ERROR:
            case AlertSeverity.CRITICAL:
                return 'error';
            default:
                return 'info';
        }
    }
    /**
     * Acknowledge an alert
     */
    acknowledgeAlert(alertId) {
        const alert = this.activeAlerts.get(alertId);
        if (alert) {
            alert.acknowledged = true;
            this.emit('alertAcknowledged', alert);
            this.logger.info('Alert acknowledged', { alertId });
        }
    }
    /**
     * Resolve an alert
     */
    resolveAlert(alertId) {
        const alert = this.activeAlerts.get(alertId);
        if (alert) {
            alert.resolvedAt = new Date();
            this.activeAlerts.delete(alertId);
            this.emit('alertResolved', alert);
            this.logger.info('Alert resolved', { alertId });
        }
    }
    /**
     * Get active alerts
     */
    getActiveAlerts() {
        return Array.from(this.activeAlerts.values());
    }
    /**
     * Get alert history
     */
    getAlertHistory(limit = 100) {
        return this.alertHistory.slice(-limit);
    }
    /**
     * Get alert statistics
     */
    getAlertStatistics() {
        const activeByType = new Map();
        const activeBySeverity = new Map();
        for (const alert of this.activeAlerts.values()) {
            activeByType.set(alert.type, (activeByType.get(alert.type) || 0) + 1);
            activeBySeverity.set(alert.severity, (activeBySeverity.get(alert.severity) || 0) + 1);
        }
        const ruleStats = Array.from(this.rules.values()).map(rule => ({
            ruleId: rule.id,
            name: rule.name,
            triggerCount: rule.triggerCount,
            lastTriggered: rule.lastTriggered,
            active: rule.active
        }));
        return {
            totalActive: this.activeAlerts.size,
            totalHistory: this.alertHistory.length,
            activeByType: Object.fromEntries(activeByType),
            activeBySeverity: Object.fromEntries(activeBySeverity),
            ruleStats
        };
    }
    /**
     * Clear alert history
     */
    clearHistory() {
        this.alertHistory = [];
        this.logger.info('Alert history cleared');
    }
    /**
     * Enable/disable a rule
     */
    setRuleActive(ruleId, active) {
        const rule = this.rules.get(ruleId);
        if (rule) {
            rule.active = active;
            this.logger.info('Rule active state changed', { ruleId, active });
        }
    }
}
exports.AlertManager = AlertManager;
//# sourceMappingURL=AlertManager.js.map