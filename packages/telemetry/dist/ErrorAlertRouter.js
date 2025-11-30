"use strict";
/**
 * ErrorAlertRouter - Critical alert routing system
 *
 * Routes alerts to multiple channels (Slack, Email, Telegram) with
 * intelligent filtering, retry logic, and incident management.
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ErrorAlertRouter = void 0;
const events_1 = require("events");
const web_api_1 = require("@slack/web-api");
const nodemailer_1 = __importDefault(require("nodemailer"));
const https = __importStar(require("https"));
const http = __importStar(require("http"));
const telemetry_1 = require("./types/telemetry");
class ErrorAlertRouter extends events_1.EventEmitter {
    logger;
    config;
    channels = new Map();
    alertHistory = new Map();
    silencedAlerts = new Map();
    throttleCounter = new Map();
    slackClient;
    emailTransporter;
    constructor(logger, config) {
        super();
        this.logger = logger;
        this.config = {
            rules: [],
            retryAttempts: 3,
            retryDelay: 5000,
            silenceWindow: 3600000, // 1 hour
            throttleLimit: 10,
            throttleWindow: 300000, // 5 minutes
            ...config
        };
        this.initializeChannels();
    }
    /**
     * Send an alert
     */
    async sendAlert(alert) {
        try {
            // Check if alert is silenced
            if (this.isSilenced(alert)) {
                this.logger.debug('Alert silenced', { alertId: alert.id });
                return;
            }
            // Check throttle
            if (this.isThrottled(alert.module)) {
                this.logger.warn('Alert throttled', {
                    module: alert.module,
                    alertId: alert.id
                });
                return;
            }
            // Update throttle counter
            this.updateThrottle(alert.module);
            // Determine target channels
            const targetChannels = this.determineChannels(alert);
            if (targetChannels.length === 0) {
                this.logger.warn('No channels configured for alert', {
                    alertId: alert.id,
                    severity: alert.severity
                });
                return;
            }
            // Create alert state
            const state = {
                alert,
                attempts: 0,
                sent: false,
                channels: []
            };
            this.alertHistory.set(alert.id, state);
            // Send to channels
            await this.routeToChannels(alert, targetChannels, state);
            // Emit event
            this.emit('alert:triggered', alert);
        }
        catch (error) {
            this.logger.error('Failed to send alert', { error, alert });
            this.emit('error', error);
            throw error;
        }
    }
    /**
     * Resolve an alert
     */
    resolveAlert(alertId, resolvedBy) {
        const state = this.alertHistory.get(alertId);
        if (!state)
            return;
        state.alert.resolvedAt = Date.now();
        if (resolvedBy) {
            state.alert.acknowledgedBy = resolvedBy;
        }
        this.emit('alert:resolved', state.alert);
    }
    /**
     * Silence an alert
     */
    silenceAlert(alertId, duration) {
        const until = Date.now() + (duration || this.config.silenceWindow);
        this.silencedAlerts.set(alertId, until);
    }
    /**
     * Get alert history
     */
    getAlertHistory() {
        return Array.from(this.alertHistory.values())
            .map(state => state.alert)
            .sort((a, b) => b.timestamp - a.timestamp);
    }
    /**
     * Private: Initialize channels
     */
    initializeChannels() {
        for (const channel of this.config.channels) {
            switch (channel.type) {
                case 'slack':
                    this.initializeSlack(channel);
                    break;
                case 'email':
                    this.initializeEmail(channel);
                    break;
                case 'telegram':
                    this.initializeTelegram(channel);
                    break;
                case 'webhook':
                    this.initializeWebhook(channel);
                    break;
            }
        }
    }
    /**
     * Private: Initialize Slack channel
     */
    initializeSlack(channel) {
        this.slackClient = new web_api_1.WebClient(channel.config.token);
        this.channels.set('slack', {
            type: 'slack',
            send: async (alert) => {
                await this.slackClient.chat.postMessage({
                    channel: channel.config.channel,
                    text: `🚨 ${alert.severity.toUpperCase()}: ${alert.title}`,
                    attachments: [{
                            color: this.getSeverityColor(alert.severity),
                            fields: [
                                {
                                    title: 'Module',
                                    value: alert.module,
                                    short: true
                                },
                                {
                                    title: 'Time',
                                    value: new Date(alert.timestamp).toISOString(),
                                    short: true
                                },
                                {
                                    title: 'Message',
                                    value: alert.message,
                                    short: false
                                }
                            ],
                            footer: alert.runbook ? `Runbook: ${alert.runbook}` : undefined
                        }]
                });
            }
        });
    }
    /**
     * Private: Initialize Email channel
     */
    initializeEmail(channel) {
        this.emailTransporter = nodemailer_1.default.createTransport({
            host: channel.config.host,
            port: channel.config.port || 587,
            secure: channel.config.secure || false,
            auth: {
                user: channel.config.username,
                pass: channel.config.password
            }
        });
        this.channels.set('email', {
            type: 'email',
            send: async (alert) => {
                await this.emailTransporter.sendMail({
                    from: channel.config.from,
                    to: channel.config.to,
                    subject: `[${alert.severity.toUpperCase()}] ${alert.title}`,
                    html: this.formatEmailBody(alert)
                });
            }
        });
    }
    /**
     * Private: Initialize Telegram channel
     */
    initializeTelegram(channel) {
        this.channels.set('telegram', {
            type: 'telegram',
            send: async (alert) => {
                const message = this.formatTelegramMessage(alert);
                const url = `https://api.telegram.org/bot${channel.config.botToken}/sendMessage`;
                await this.httpPost(url, {
                    chat_id: channel.config.chatId,
                    text: message,
                    parse_mode: 'HTML',
                    disable_notification: alert.severity === telemetry_1.AlertSeverity.INFO
                });
            }
        });
    }
    /**
     * Private: Initialize Webhook channel
     */
    initializeWebhook(channel) {
        this.channels.set('webhook', {
            type: 'webhook',
            send: async (alert) => {
                await this.httpPost(channel.config.url, {
                    alert,
                    timestamp: Date.now(),
                    source: 'noderr-protocol'
                }, channel.config.headers);
            }
        });
    }
    /**
     * Private: Route to channels
     */
    async routeToChannels(alert, channels, state) {
        const promises = channels.map(async (channelType) => {
            const channel = this.channels.get(channelType);
            if (!channel)
                return;
            try {
                await this.sendWithRetry(channel, alert, state);
                state.channels.push(channelType);
            }
            catch (error) {
                this.logger.error(`Failed to send alert to ${channelType}`, {
                    error,
                    alertId: alert.id
                });
            }
        });
        await Promise.allSettled(promises);
        state.sent = state.channels.length > 0;
    }
    /**
     * Private: Send with retry
     */
    async sendWithRetry(channel, alert, state) {
        let lastError;
        for (let attempt = 0; attempt < this.config.retryAttempts; attempt++) {
            state.attempts++;
            state.lastAttempt = Date.now();
            try {
                await channel.send(alert);
                return;
            }
            catch (error) {
                lastError = error;
                this.logger.warn(`Alert send attempt ${attempt + 1} failed`, {
                    channel: channel.type,
                    error,
                    alertId: alert.id
                });
                if (attempt < this.config.retryAttempts - 1) {
                    await new Promise(resolve => setTimeout(resolve, this.config.retryDelay * Math.pow(2, attempt)));
                }
            }
        }
        state.error = lastError;
        throw lastError || new Error('Failed to send alert');
    }
    /**
     * Private: Determine target channels
     */
    determineChannels(alert) {
        const channels = new Set();
        // Apply rules
        for (const rule of this.config.rules) {
            if (this.matchesRule(alert, rule)) {
                rule.channels.forEach((ch) => channels.add(ch.type));
            }
        }
        // Apply channel filters
        for (const [type, client] of this.channels) {
            const channel = this.config.channels.find(ch => ch.type === type);
            if (!channel?.filter) {
                channels.add(type);
                continue;
            }
            const filter = channel.filter;
            // Check severity filter
            if (filter.severities && !filter.severities.includes(alert.severity)) {
                channels.delete(type);
                continue;
            }
            // Check module filter
            if (filter.modules && !filter.modules.includes(alert.module)) {
                channels.delete(type);
                continue;
            }
        }
        return Array.from(channels);
    }
    /**
     * Private: Check if alert matches rule
     */
    matchesRule(alert, rule) {
        if (rule.severity !== alert.severity)
            return false;
        // Additional rule matching logic could go here
        // For now, just match on severity
        return true;
    }
    /**
     * Private: Check if alert is silenced
     */
    isSilenced(alert) {
        if (alert.silenced)
            return true;
        const silenceUntil = this.silencedAlerts.get(alert.id);
        if (silenceUntil && Date.now() < silenceUntil) {
            return true;
        }
        // Clean up expired silence
        if (silenceUntil) {
            this.silencedAlerts.delete(alert.id);
        }
        return false;
    }
    /**
     * Private: Check if module is throttled
     */
    isThrottled(module) {
        const timestamps = this.throttleCounter.get(module) || [];
        const now = Date.now();
        const windowStart = now - this.config.throttleWindow;
        // Filter timestamps within window
        const recentAlerts = timestamps.filter(ts => ts > windowStart);
        return recentAlerts.length >= this.config.throttleLimit;
    }
    /**
     * Private: Update throttle counter
     */
    updateThrottle(module) {
        const timestamps = this.throttleCounter.get(module) || [];
        const now = Date.now();
        const windowStart = now - this.config.throttleWindow;
        // Keep only recent timestamps
        const recentAlerts = timestamps.filter(ts => ts > windowStart);
        recentAlerts.push(now);
        this.throttleCounter.set(module, recentAlerts);
    }
    /**
     * Private: Get severity color
     */
    getSeverityColor(severity) {
        switch (severity) {
            case telemetry_1.AlertSeverity.CRITICAL:
                return '#FF0000';
            case telemetry_1.AlertSeverity.ERROR:
                return '#FF6600';
            case telemetry_1.AlertSeverity.WARNING:
                return '#FFCC00';
            case telemetry_1.AlertSeverity.INFO:
                return '#0099FF';
            default:
                return '#808080';
        }
    }
    /**
     * Private: Format email body
     */
    formatEmailBody(alert) {
        return `
      <div style="font-family: Arial, sans-serif; max-width: 600px;">
        <h2 style="color: ${this.getSeverityColor(alert.severity)}">
          ${alert.severity.toUpperCase()}: ${alert.title}
        </h2>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>Module</strong></td>
            <td style="padding: 8px; border: 1px solid #ddd;">${alert.module}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>Time</strong></td>
            <td style="padding: 8px; border: 1px solid #ddd;">${new Date(alert.timestamp).toISOString()}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>Message</strong></td>
            <td style="padding: 8px; border: 1px solid #ddd;">${alert.message}</td>
          </tr>
          ${alert.metadata ? `
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>Details</strong></td>
            <td style="padding: 8px; border: 1px solid #ddd;"><pre>${JSON.stringify(alert.metadata, null, 2)}</pre></td>
          </tr>
          ` : ''}
          ${alert.runbook ? `
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>Runbook</strong></td>
            <td style="padding: 8px; border: 1px solid #ddd;"><a href="${alert.runbook}">${alert.runbook}</a></td>
          </tr>
          ` : ''}
        </table>
      </div>
    `;
    }
    /**
     * Private: Format Telegram message
     */
    formatTelegramMessage(alert) {
        const icon = this.getSeverityIcon(alert.severity);
        return `
${icon} <b>${alert.severity.toUpperCase()}: ${alert.title}</b>

<b>Module:</b> ${alert.module}
<b>Time:</b> ${new Date(alert.timestamp).toISOString()}

<b>Message:</b>
${alert.message}

${alert.runbook ? `<b>Runbook:</b> ${alert.runbook}` : ''}
    `.trim();
    }
    /**
     * Private: Get severity icon
     */
    getSeverityIcon(severity) {
        switch (severity) {
            case telemetry_1.AlertSeverity.CRITICAL:
                return '🚨';
            case telemetry_1.AlertSeverity.ERROR:
                return '❌';
            case telemetry_1.AlertSeverity.WARNING:
                return '⚠️';
            case telemetry_1.AlertSeverity.INFO:
                return 'ℹ️';
            default:
                return '📢';
        }
    }
    /**
     * Private: HTTP POST helper
     */
    async httpPost(url, data, headers) {
        return new Promise((resolve, reject) => {
            const urlObj = new URL(url);
            const isHttps = urlObj.protocol === 'https:';
            const client = isHttps ? https : http;
            const postData = JSON.stringify(data);
            const options = {
                hostname: urlObj.hostname,
                port: urlObj.port || (isHttps ? 443 : 80),
                path: urlObj.pathname + urlObj.search,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData),
                    ...headers
                }
            };
            const req = client.request(options, (res) => {
                if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                    resolve();
                }
                else {
                    reject(new Error(`Request failed with status ${res.statusCode}`));
                }
            });
            req.on('error', reject);
            req.write(postData);
            req.end();
        });
    }
}
exports.ErrorAlertRouter = ErrorAlertRouter;
//# sourceMappingURL=ErrorAlertRouter.js.map