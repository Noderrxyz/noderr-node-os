/**
 * ErrorAlertRouter - Critical alert routing system
 *
 * Routes alerts to multiple channels (Slack, Email, Telegram) with
 * intelligent filtering, retry logic, and incident management.
 */
import { EventEmitter } from 'events';
import { Logger } from 'winston';
import { Alert, AlertRule, AlertChannel } from './types/telemetry';
interface AlertRouterConfig {
    channels: AlertChannel[];
    rules?: AlertRule[];
    retryAttempts?: number;
    retryDelay?: number;
    silenceWindow?: number;
    throttleLimit?: number;
    throttleWindow?: number;
}
export declare class ErrorAlertRouter extends EventEmitter {
    private logger;
    private config;
    private channels;
    private alertHistory;
    private silencedAlerts;
    private throttleCounter;
    private slackClient?;
    private emailTransporter?;
    constructor(logger: Logger, config: AlertRouterConfig);
    /**
     * Send an alert
     */
    sendAlert(alert: Alert): Promise<void>;
    /**
     * Resolve an alert
     */
    resolveAlert(alertId: string, resolvedBy?: string): void;
    /**
     * Silence an alert
     */
    silenceAlert(alertId: string, duration?: number): void;
    /**
     * Get alert history
     */
    getAlertHistory(): Alert[];
    /**
     * Private: Initialize channels
     */
    private initializeChannels;
    /**
     * Private: Initialize Slack channel
     */
    private initializeSlack;
    /**
     * Private: Initialize Email channel
     */
    private initializeEmail;
    /**
     * Private: Initialize Telegram channel
     */
    private initializeTelegram;
    /**
     * Private: Initialize Webhook channel
     */
    private initializeWebhook;
    /**
     * Private: Route to channels
     */
    private routeToChannels;
    /**
     * Private: Send with retry
     */
    private sendWithRetry;
    /**
     * Private: Determine target channels
     */
    private determineChannels;
    /**
     * Private: Check if alert matches rule
     */
    private matchesRule;
    /**
     * Private: Check if alert is silenced
     */
    private isSilenced;
    /**
     * Private: Check if module is throttled
     */
    private isThrottled;
    /**
     * Private: Update throttle counter
     */
    private updateThrottle;
    /**
     * Private: Get severity color
     */
    private getSeverityColor;
    /**
     * Private: Format email body
     */
    private formatEmailBody;
    /**
     * Private: Format Telegram message
     */
    private formatTelegramMessage;
    /**
     * Private: Get severity icon
     */
    private getSeverityIcon;
    /**
     * Private: HTTP POST helper
     */
    private httpPost;
}
export {};
//# sourceMappingURL=ErrorAlertRouter.d.ts.map