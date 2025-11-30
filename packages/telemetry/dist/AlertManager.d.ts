import { EventEmitter } from 'events';
import * as winston from 'winston';
/**
 * Alert severity levels
 */
export declare enum AlertSeverity {
    INFO = "info",
    WARNING = "warning",
    ERROR = "error",
    CRITICAL = "critical"
}
/**
 * Alert types
 */
export declare enum AlertType {
    LATENCY = "latency",
    ERROR_RATE = "error_rate",
    RISK_LIMIT = "risk_limit",
    DRAWDOWN = "drawdown",
    SYSTEM_HEALTH = "system_health",
    MARKET_ANOMALY = "market_anomaly",
    EXECUTION_FAILURE = "execution_failure",
    CONNECTIVITY = "connectivity"
}
/**
 * Alert configuration
 */
export interface AlertConfig {
    type: AlertType;
    severity: AlertSeverity;
    threshold: number;
    window: number;
    cooldown: number;
    enabled: boolean;
    actions: AlertAction[];
}
/**
 * Alert action
 */
export interface AlertAction {
    type: 'log' | 'email' | 'webhook' | 'circuit_breaker';
    config: Record<string, any>;
}
/**
 * Alert instance
 */
export interface Alert {
    id: string;
    type: AlertType;
    severity: AlertSeverity;
    title: string;
    message: string;
    timestamp: Date;
    value: number;
    threshold: number;
    metadata: Record<string, any>;
    acknowledged: boolean;
    resolvedAt?: Date;
}
/**
 * Alert rule
 */
export interface AlertRule {
    id: string;
    name: string;
    description: string;
    config: AlertConfig;
    lastTriggered?: Date;
    triggerCount: number;
    active: boolean;
}
/**
 * Alert manager for trading system
 */
export declare class AlertManager extends EventEmitter {
    private logger;
    private rules;
    private activeAlerts;
    private alertHistory;
    private cooldowns;
    private maxHistorySize;
    constructor(logger: winston.Logger);
    /**
     * Initialize default alert rules
     */
    private initializeDefaultRules;
    /**
     * Add an alert rule
     */
    addRule(rule: AlertRule): void;
    /**
     * Remove an alert rule
     */
    removeRule(ruleId: string): void;
    /**
     * Update an alert rule
     */
    updateRule(ruleId: string, updates: Partial<AlertRule>): void;
    /**
     * Check if an alert should be triggered
     */
    checkAlert(type: AlertType, value: number, metadata?: Record<string, any>): void;
    /**
     * Check if a rule should trigger
     */
    private shouldTrigger;
    /**
     * Trigger an alert
     */
    private triggerAlert;
    /**
     * Format alert message
     */
    private formatAlertMessage;
    /**
     * Execute alert actions
     */
    private executeActions;
    /**
     * Execute log action
     */
    private executeLogAction;
    /**
     * Execute email action (placeholder)
     */
    private executeEmailAction;
    /**
     * Execute webhook action (placeholder)
     */
    private executeWebhookAction;
    /**
     * Execute circuit breaker action
     */
    private executeCircuitBreakerAction;
    /**
     * Get log level for severity
     */
    private getLogLevel;
    /**
     * Acknowledge an alert
     */
    acknowledgeAlert(alertId: string): void;
    /**
     * Resolve an alert
     */
    resolveAlert(alertId: string): void;
    /**
     * Get active alerts
     */
    getActiveAlerts(): Alert[];
    /**
     * Get alert history
     */
    getAlertHistory(limit?: number): Alert[];
    /**
     * Get alert statistics
     */
    getAlertStatistics(): AlertStatistics;
    /**
     * Clear alert history
     */
    clearHistory(): void;
    /**
     * Enable/disable a rule
     */
    setRuleActive(ruleId: string, active: boolean): void;
}
/**
 * Alert statistics
 */
export interface AlertStatistics {
    totalActive: number;
    totalHistory: number;
    activeByType: Record<string, number>;
    activeBySeverity: Record<string, number>;
    ruleStats: Array<{
        ruleId: string;
        name: string;
        triggerCount: number;
        lastTriggered?: Date;
        active: boolean;
    }>;
}
//# sourceMappingURL=AlertManager.d.ts.map