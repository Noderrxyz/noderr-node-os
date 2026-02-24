/**
 * Human Oversight Manager
 * 
 * Provides human oversight capabilities for autonomous trading:
 * - Multi-channel notifications (Discord, Telegram, Email, SMS)
 * - Trade approval workflows
 * - Risk alerts and warnings
 * - Performance monitoring
 * - Emergency stop mechanisms
 * 
 * @module HumanOversightManager
 */

import { Logger } from '@noderr/utils';
import { EventEmitter } from 'events';

const logger = new Logger('HumanOversightManager');
export enum AlertSeverity {
  INFO = 'INFO',
  WARNING = 'WARNING',
  CRITICAL = 'CRITICAL',
  EMERGENCY = 'EMERGENCY',
}

export enum AlertType {
  TRADE_APPROVAL_REQUIRED = 'TRADE_APPROVAL_REQUIRED',
  TRADE_EXECUTED = 'TRADE_EXECUTED',
  TRADE_FAILED = 'TRADE_FAILED',
  RISK_THRESHOLD_EXCEEDED = 'RISK_THRESHOLD_EXCEEDED',
  CONSENSUS_FAILED = 'CONSENSUS_FAILED',
  SYSTEM_ERROR = 'SYSTEM_ERROR',
  PERFORMANCE_DEGRADATION = 'PERFORMANCE_DEGRADATION',
  EMERGENCY_STOP = 'EMERGENCY_STOP',
}

export interface Alert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  data: Record<string, any>;
  timestamp: number;
  acknowledged: boolean;
  acknowledgedBy: string | null;
  acknowledgedAt: number | null;
}

export interface NotificationChannel {
  name: string;
  enabled: boolean;
  config: Record<string, any>;
}

export interface OversightConfig {
  channels: {
    discord?: {
      enabled: boolean;
      webhookUrl: string;
      mentionRoles?: string[];
    };
    telegram?: {
      enabled: boolean;
      botToken: string;
      chatId: string;
    };
    email?: {
      enabled: boolean;
      smtpHost: string;
      smtpPort: number;
      from: string;
      to: string[];
    };
    sms?: {
      enabled: boolean;
      twilioAccountSid: string;
      twilioAuthToken: string;
      twilioPhoneNumber: string;
      recipientNumbers: string[];
    };
  };
  thresholds: {
    maxDailyLoss: number;
    maxPositionSize: number;
    minConsensusConfidence: number;
  };
  approvalRequired: {
    largeTradesThreshold: number; // USD value
    lowConfidenceThreshold: number; // 0-1
    highRiskThreshold: number; // 0-1
  };
}

/**
 * Human Oversight Manager
 * 
 * Manages human oversight of autonomous trading operations.
 */
export class HumanOversightManager extends EventEmitter {
  private config: OversightConfig;
  private alerts: Map<string, Alert> = new Map();
  private pendingApprovals: Map<string, any> = new Map();
  private isEmergencyStopped: boolean = false;
  
  constructor(config: OversightConfig) {
    super();
    this.config = config;
  }
  
  /**
   * Initialize oversight manager
   */
  async initialize(): Promise<void> {
    logger.info('Initializing Human Oversight Manager...');
    
    // Test notification channels
    const enabledChannels = this.getEnabledChannels();
    
    logger.info(`Enabled notification channels: ${enabledChannels.join(', ')}`);
    
    // Send test notifications
    for (const channel of enabledChannels) {
      try {
        await this.sendTestNotification(channel);
        logger.info(`✅ ${channel} channel test successful`);
      } catch (error: any) {
        logger.error(`❌ ${channel} channel test failed:`, error.message);
      }
    }
    
    logger.info('Human Oversight Manager initialized');
    
    this.emit('initialized');
  }
  
  /**
   * Send alert
   */
  async sendAlert(
    type: AlertType,
    severity: AlertSeverity,
    title: string,
    message: string,
    data: Record<string, any> = {}
  ): Promise<string> {
    const alert: Alert = {
      id: this.generateAlertId(),
      type,
      severity,
      title,
      message,
      data,
      timestamp: Date.now(),
      acknowledged: false,
      acknowledgedBy: null,
      acknowledgedAt: null,
    };
    
    this.alerts.set(alert.id, alert);
    
    logger.info(`\n${'='.repeat(60)}`);
    logger.info(`ALERT: ${alert.id}`);
    logger.info(`${'='.repeat(60)}`);
    logger.info(`Type: ${type}`);
    logger.info(`Severity: ${severity}`);
    logger.info(`Title: ${title}`);
    logger.info(`Message: ${message}`);
    logger.info(`${'='.repeat(60)}\n`);
    
    // Send notifications based on severity
    const channels = this.getChannelsForSeverity(severity);
    
    for (const channel of channels) {
      try {
        await this.sendNotification(channel, alert);
      } catch (error: any) {
        logger.error(`Failed to send ${channel} notification:`, error.message);
      }
    }
    
    this.emit('alertSent', alert);
    
    return alert.id;
  }
  
  /**
   * Request trade approval
   */
  async requestTradeApproval(trade: {
    symbol: string;
    side: 'BUY' | 'SELL';
    quantity: number;
    price: number;
    value: number;
    confidence: number;
    riskScore: number;
  }): Promise<string> {
    const approvalId = this.generateApprovalId();
    
    this.pendingApprovals.set(approvalId, {
      ...trade,
      requestedAt: Date.now(),
      status: 'PENDING',
    });
    
    // Send approval request notification
    await this.sendAlert(
      AlertType.TRADE_APPROVAL_REQUIRED,
      AlertSeverity.WARNING,
      'Trade Approval Required',
      `${trade.side} ${trade.quantity} ${trade.symbol} @ $${trade.price.toFixed(2)}\n` +
      `Value: $${trade.value.toFixed(2)}\n` +
      `Confidence: ${(trade.confidence * 100).toFixed(2)}%\n` +
      `Risk Score: ${trade.riskScore.toFixed(2)}\n\n` +
      `Reply with "APPROVE ${approvalId}" or "REJECT ${approvalId}"`,
      { approvalId, trade }
    );
    
    this.emit('approvalRequested', { approvalId, trade });
    
    return approvalId;
  }
  
  /**
   * Approve trade
   */
  async approveTrade(approvalId: string, approvedBy: string): Promise<boolean> {
    const approval = this.pendingApprovals.get(approvalId);
    
    if (!approval) {
      throw new Error(`Approval ${approvalId} not found`);
    }
    
    if (approval.status !== 'PENDING') {
      throw new Error(`Approval ${approvalId} already ${approval.status}`);
    }
    
    approval.status = 'APPROVED';
    approval.approvedBy = approvedBy;
    approval.approvedAt = Date.now();
    
    logger.info(`✅ Trade ${approvalId} APPROVED by ${approvedBy}`);
    
    this.emit('tradeApproved', { approvalId, approvedBy });
    
    return true;
  }
  
  /**
   * Reject trade
   */
  async rejectTrade(approvalId: string, rejectedBy: string, reason?: string): Promise<boolean> {
    const approval = this.pendingApprovals.get(approvalId);
    
    if (!approval) {
      throw new Error(`Approval ${approvalId} not found`);
    }
    
    if (approval.status !== 'PENDING') {
      throw new Error(`Approval ${approvalId} already ${approval.status}`);
    }
    
    approval.status = 'REJECTED';
    approval.rejectedBy = rejectedBy;
    approval.rejectedAt = Date.now();
    approval.rejectionReason = reason;
    
    logger.info(`❌ Trade ${approvalId} REJECTED by ${rejectedBy}`);
    if (reason) {
      logger.info(`   Reason: ${reason}`);
    }
    
    this.emit('tradeRejected', { approvalId, rejectedBy, reason });
    
    return true;
  }
  
  /**
   * Acknowledge alert
   */
  async acknowledgeAlert(alertId: string, acknowledgedBy: string): Promise<boolean> {
    const alert = this.alerts.get(alertId);
    
    if (!alert) {
      throw new Error(`Alert ${alertId} not found`);
    }
    
    if (alert.acknowledged) {
      throw new Error(`Alert ${alertId} already acknowledged`);
    }
    
    alert.acknowledged = true;
    alert.acknowledgedBy = acknowledgedBy;
    alert.acknowledgedAt = Date.now();
    
    logger.info(`✅ Alert ${alertId} acknowledged by ${acknowledgedBy}`);
    
    this.emit('alertAcknowledged', { alertId, acknowledgedBy });
    
    return true;
  }
  
  /**
   * Trigger emergency stop
   */
  async emergencyStop(triggeredBy: string, reason: string): Promise<void> {
    if (this.isEmergencyStopped) {
      logger.warn('System already in emergency stop state');
      return;
    }
    
    this.isEmergencyStopped = true;
    
    logger.info(`\n${'='.repeat(60)}`);
    logger.info('🚨 EMERGENCY STOP TRIGGERED 🚨');
    logger.info(`${'='.repeat(60)}`);
    logger.info(`Triggered by: ${triggeredBy}`);
    logger.info(`Reason: ${reason}`);
    logger.info(`${'='.repeat(60)}\n`);
    
    // Send emergency alert to all channels
    await this.sendAlert(
      AlertType.EMERGENCY_STOP,
      AlertSeverity.EMERGENCY,
      '🚨 EMERGENCY STOP TRIGGERED',
      `All autonomous trading has been halted.\n\n` +
      `Triggered by: ${triggeredBy}\n` +
      `Reason: ${reason}\n\n` +
      `Manual intervention required to resume operations.`,
      { triggeredBy, reason }
    );
    
    this.emit('emergencyStop', { triggeredBy, reason });
  }
  
  /**
   * Resume from emergency stop
   */
  async resumeFromEmergencyStop(resumedBy: string): Promise<void> {
    if (!this.isEmergencyStopped) {
      logger.warn('System not in emergency stop state');
      return;
    }
    
    this.isEmergencyStopped = false;
    
    logger.info(`\n${'='.repeat(60)}`);
    logger.info('✅ EMERGENCY STOP CLEARED');
    logger.info(`${'='.repeat(60)}`);
    logger.info(`Resumed by: ${resumedBy}`);
    logger.info(`${'='.repeat(60)}\n`);
    
    await this.sendAlert(
      AlertType.EMERGENCY_STOP,
      AlertSeverity.INFO,
      '✅ Emergency Stop Cleared',
      `Autonomous trading has been resumed.\n\n` +
      `Resumed by: ${resumedBy}`,
      { resumedBy }
    );
    
    this.emit('emergencyStopCleared', { resumedBy });
  }
  
  /**
   * Check if trade requires approval
   */
  requiresApproval(trade: {
    value: number;
    confidence: number;
    riskScore: number;
  }): boolean {
    const { largeTradesThreshold, lowConfidenceThreshold, highRiskThreshold } = 
      this.config.approvalRequired;
    
    if (trade.value >= largeTradesThreshold) {
      return true;
    }
    
    if (trade.confidence < lowConfidenceThreshold) {
      return true;
    }
    
    if (trade.riskScore >= highRiskThreshold) {
      return true;
    }
    
    return false;
  }
  
  /**
   * Get enabled channels
   */
  private getEnabledChannels(): string[] {
    const channels: string[] = [];
    
    if (this.config.channels.discord?.enabled) {
      channels.push('discord');
    }
    
    if (this.config.channels.telegram?.enabled) {
      channels.push('telegram');
    }
    
    if (this.config.channels.email?.enabled) {
      channels.push('email');
    }
    
    if (this.config.channels.sms?.enabled) {
      channels.push('sms');
    }
    
    return channels;
  }
  
  /**
   * Get channels for severity
   */
  private getChannelsForSeverity(severity: AlertSeverity): string[] {
    const channels = this.getEnabledChannels();
    
    // For emergency alerts, use all channels
    if (severity === AlertSeverity.EMERGENCY) {
      return channels;
    }
    
    // For critical alerts, use Discord, Telegram, and SMS
    if (severity === AlertSeverity.CRITICAL) {
      return channels.filter(c => c !== 'email');
    }
    
    // For warnings, use Discord and Telegram
    if (severity === AlertSeverity.WARNING) {
      return channels.filter(c => c === 'discord' || c === 'telegram');
    }
    
    // For info, use Discord only
    return channels.filter(c => c === 'discord');
  }
  
  /**
   * Send test notification
   */
  private async sendTestNotification(channel: string): Promise<void> {
    const alert: Alert = {
      id: 'test',
      type: AlertType.SYSTEM_ERROR,
      severity: AlertSeverity.INFO,
      title: 'Test Notification',
      message: `This is a test notification from the Human Oversight Manager via ${channel}.`,
      data: {},
      timestamp: Date.now(),
      acknowledged: false,
      acknowledgedBy: null,
      acknowledgedAt: null,
    };
    
    await this.sendNotification(channel, alert);
  }
  
  /**
   * Send notification to channel
   */
  private async sendNotification(channel: string, alert: Alert): Promise<void> {
    logger.info(`Sending ${channel} notification for alert ${alert.id}...`);
    
    // Stub implementations
    // In production, these would call actual notification services
    
    switch (channel) {
      case 'discord':
        await this.sendDiscordNotification(alert);
        break;
      
      case 'telegram':
        await this.sendTelegramNotification(alert);
        break;
      
      case 'email':
        await this.sendEmailNotification(alert);
        break;
      
      case 'sms':
        await this.sendSMSNotification(alert);
        break;
      
      default:
        logger.warn(`Unknown notification channel: ${channel}`);
    }
  }
  
  /**
   * Send Discord notification
   */
  private async sendDiscordNotification(alert: Alert): Promise<void> {
    const webhookUrl = this.config.channels.discord?.webhookUrl;
    
    if (!webhookUrl) {
      throw new Error('Discord webhook URL not configured');
    }
    
    const color = this.getSeverityColor(alert.severity);
    
    const embed = {
      title: `${this.getSeverityEmoji(alert.severity)} ${alert.title}`,
      description: alert.message,
      color,
      fields: [
        { name: 'Type', value: alert.type, inline: true },
        { name: 'Severity', value: alert.severity, inline: true },
        { name: 'Time', value: new Date(alert.timestamp).toISOString(), inline: true },
      ],
      timestamp: new Date(alert.timestamp).toISOString(),
    };
    
    // Stub: In production, send to Discord webhook
    logger.info(`Discord notification: ${JSON.stringify(embed, null, 2)}`);
  }
  
  /**
   * Send Telegram notification
   */
  private async sendTelegramNotification(alert: Alert): Promise<void> {
    const { botToken, chatId } = this.config.channels.telegram || {};
    
    if (!botToken || !chatId) {
      throw new Error('Telegram bot token or chat ID not configured');
    }
    
    const message = 
      `${this.getSeverityEmoji(alert.severity)} *${alert.title}*\n\n` +
      `${alert.message}\n\n` +
      `Type: ${alert.type}\n` +
      `Severity: ${alert.severity}\n` +
      `Time: ${new Date(alert.timestamp).toISOString()}`;
    
    // Stub: In production, send to Telegram API
    logger.info(`Telegram notification: ${message}`);
  }
  
  /**
   * Send email notification
   */
  private async sendEmailNotification(alert: Alert): Promise<void> {
    const { smtpHost, smtpPort, from, to } = this.config.channels.email || {};
    
    if (!smtpHost || !from || !to) {
      throw new Error('Email configuration incomplete');
    }
    
    const subject = `[${alert.severity}] ${alert.title}`;
    const body = 
      `${alert.message}\n\n` +
      `Type: ${alert.type}\n` +
      `Severity: ${alert.severity}\n` +
      `Time: ${new Date(alert.timestamp).toISOString()}\n` +
      `Alert ID: ${alert.id}`;
    
    // Stub: In production, send via SMTP
    logger.info(`Email notification: ${subject}\n${body}`);
  }
  
  /**
   * Send SMS notification
   */
  private async sendSMSNotification(alert: Alert): Promise<void> {
    const { twilioAccountSid, twilioAuthToken, twilioPhoneNumber, recipientNumbers } = 
      this.config.channels.sms || {};
    
    if (!twilioAccountSid || !twilioAuthToken || !twilioPhoneNumber || !recipientNumbers) {
      throw new Error('SMS configuration incomplete');
    }
    
    const message = 
      `${this.getSeverityEmoji(alert.severity)} ${alert.title}\n` +
      `${alert.message.substring(0, 100)}...`;
    
    // Stub: In production, send via Twilio
    logger.info(`SMS notification: ${message}`);
  }
  
  /**
   * Get severity color for Discord
   */
  private getSeverityColor(severity: AlertSeverity): number {
    switch (severity) {
      case AlertSeverity.INFO:
        return 0x3498db; // Blue
      case AlertSeverity.WARNING:
        return 0xf39c12; // Orange
      case AlertSeverity.CRITICAL:
        return 0xe74c3c; // Red
      case AlertSeverity.EMERGENCY:
        return 0x8b0000; // Dark Red
      default:
        return 0x95a5a6; // Gray
    }
  }
  
  /**
   * Get severity emoji
   */
  private getSeverityEmoji(severity: AlertSeverity): string {
    switch (severity) {
      case AlertSeverity.INFO:
        return 'ℹ️';
      case AlertSeverity.WARNING:
        return '⚠️';
      case AlertSeverity.CRITICAL:
        return '🔴';
      case AlertSeverity.EMERGENCY:
        return '🚨';
      default:
        return '❓';
    }
  }
  
  /**
   * Generate alert ID
   */
  private generateAlertId(): string {
    return `alert_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }
  
  /**
   * Generate approval ID
   */
  private generateApprovalId(): string {
    return `approval_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }
  
  /**
   * Get alerts
   */
  getAlerts(filter?: {
    type?: AlertType;
    severity?: AlertSeverity;
    acknowledged?: boolean;
  }): Alert[] {
    let alerts = Array.from(this.alerts.values());
    
    if (filter) {
      if (filter.type) {
        alerts = alerts.filter(a => a.type === filter.type);
      }
      
      if (filter.severity) {
        alerts = alerts.filter(a => a.severity === filter.severity);
      }
      
      if (filter.acknowledged !== undefined) {
        alerts = alerts.filter(a => a.acknowledged === filter.acknowledged);
      }
    }
    
    return alerts.sort((a, b) => b.timestamp - a.timestamp);
  }
  
  /**
   * Get pending approvals
   */
  getPendingApprovals(): any[] {
    return Array.from(this.pendingApprovals.values())
      .filter(a => a.status === 'PENDING')
      .sort((a, b) => b.requestedAt - a.requestedAt);
  }
  
  /**
   * Check if emergency stopped
   */
  isInEmergencyStop(): boolean {
    return this.isEmergencyStopped;
  }
  
  /**
   * Shutdown oversight manager
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down Human Oversight Manager...');
    
    this.alerts.clear();
    this.pendingApprovals.clear();
    
    this.emit('shutdown');
  }
}
