/**
 * Node Operator Dashboard
 * 
 * Real-time monitoring dashboard for node operators.
 * Displays node status, performance metrics, earnings, and alerts.
 * 
 * @module node-dashboard
 */

import { EventEmitter } from 'events';
import chalk from 'chalk';
import boxen from 'boxen';
import { ethers } from 'ethers';

export interface NodeStatus {
  nodeId: string;
  tier: string;
  walletAddress: string;
  isActive: boolean;
  uptime: number; // seconds
  lastHeartbeat: number; // timestamp
  gpuHardwareId?: string;
}

export interface PerformanceMetrics {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  averageResponseTime: number; // ms
  successRate: number; // 0-1
  trustFingerprint: number; // 0-1
}

export interface EarningsData {
  totalEarned: string; // NODR
  pendingRewards: string; // NODR
  lastRewardTimestamp: number;
  estimatedAPY: number; // percentage
}

export interface Alert {
  id: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  message: string;
  timestamp: number;
}

export interface DashboardData {
  status: NodeStatus;
  metrics: PerformanceMetrics;
  earnings: EarningsData;
  alerts: Alert[];
}

export class NodeDashboard extends EventEmitter {
  private data: DashboardData;
  private refreshInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  constructor() {
    super();
    this.data = this.getInitialData();
  }

  /**
   * Start dashboard with auto-refresh
   */
  start(refreshIntervalMs: number = 5000) {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.render();

    this.refreshInterval = setInterval(() => {
      this.render();
    }, refreshIntervalMs);
  }

  /**
   * Stop dashboard
   */
  stop() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
    this.isRunning = false;
  }

  /**
   * Update dashboard data
   */
  updateData(data: Partial<DashboardData>) {
    this.data = {
      ...this.data,
      ...data
    };
    this.emit('data:updated', this.data);
  }

  /**
   * Add alert
   */
  addAlert(alert: Omit<Alert, 'id' | 'timestamp'>) {
    const newAlert: Alert = {
      id: Math.random().toString(36).substring(7),
      timestamp: Date.now(),
      ...alert
    };

    this.data.alerts.unshift(newAlert);
    
    // Keep only last 10 alerts
    if (this.data.alerts.length > 10) {
      this.data.alerts = this.data.alerts.slice(0, 10);
    }

    this.emit('alert:added', newAlert);
  }

  /**
   * Render dashboard
   */
  private render() {
    console.clear();

    // Header
    this.renderHeader();

    // Node Status
    this.renderNodeStatus();

    // Performance Metrics
    this.renderPerformanceMetrics();

    // Earnings
    this.renderEarnings();

    // Alerts
    this.renderAlerts();

    // Footer
    this.renderFooter();
  }

  /**
   * Render header
   */
  private renderHeader() {
    console.log(boxen(
      chalk.bold.cyan('NODERR PROTOCOL\n') +
      chalk.white('Node Operator Dashboard'),
      {
        padding: { top: 0, bottom: 0, left: 2, right: 2 },
        margin: { top: 1, bottom: 1, left: 0, right: 0 },
        borderStyle: 'double',
        borderColor: 'cyan'
      }
    ));
  }

  /**
   * Render node status
   */
  private renderNodeStatus() {
    const { status } = this.data;
    const statusColor = status.isActive ? chalk.green : chalk.red;
    const statusText = status.isActive ? '● ACTIVE' : '● INACTIVE';

    const uptimeDays = Math.floor(status.uptime / 86400);
    const uptimeHours = Math.floor((status.uptime % 86400) / 3600);
    const uptimeMinutes = Math.floor((status.uptime % 3600) / 60);

    console.log(chalk.bold.white('NODE STATUS'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log(`${chalk.white('Status:')}          ${statusColor(statusText)}`);
    console.log(`${chalk.white('Tier:')}            ${chalk.cyan(status.tier)}`);
    console.log(`${chalk.white('Node ID:')}         ${chalk.gray(status.nodeId.substring(0, 16))}...`);
    console.log(`${chalk.white('Wallet:')}          ${chalk.gray(status.walletAddress.substring(0, 16))}...`);
    console.log(`${chalk.white('Uptime:')}          ${chalk.cyan(`${uptimeDays}d ${uptimeHours}h ${uptimeMinutes}m`)}`);
    
    if (status.gpuHardwareId) {
      console.log(`${chalk.white('GPU:')}             ${chalk.green('✓')} ${chalk.gray(status.gpuHardwareId.substring(0, 16))}...`);
    }
    
    console.log();
  }

  /**
   * Render performance metrics
   */
  private renderPerformanceMetrics() {
    const { metrics } = this.data;

    const successRateColor = metrics.successRate >= 0.95 ? chalk.green :
                             metrics.successRate >= 0.85 ? chalk.yellow : chalk.red;

    const tfColor = metrics.trustFingerprint >= 0.90 ? chalk.green :
                    metrics.trustFingerprint >= 0.75 ? chalk.yellow : chalk.red;

    console.log(chalk.bold.white('PERFORMANCE METRICS'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log(`${chalk.white('Total Tasks:')}     ${chalk.cyan(metrics.totalTasks.toLocaleString())}`);
    console.log(`${chalk.white('Completed:')}       ${chalk.green(metrics.completedTasks.toLocaleString())}`);
    console.log(`${chalk.white('Failed:')}          ${chalk.red(metrics.failedTasks.toLocaleString())}`);
    console.log(`${chalk.white('Success Rate:')}    ${successRateColor((metrics.successRate * 100).toFixed(2) + '%')}`);
    console.log(`${chalk.white('Avg Response:')}    ${chalk.cyan(metrics.averageResponseTime.toFixed(0) + 'ms')}`);
    console.log(`${chalk.white('Trust Score:')}     ${tfColor((metrics.trustFingerprint * 100).toFixed(2) + '%')}`);
    console.log();
  }

  /**
   * Render earnings
   */
  private renderEarnings() {
    const { earnings } = this.data;

    const apyColor = earnings.estimatedAPY >= 15 ? chalk.green :
                     earnings.estimatedAPY >= 10 ? chalk.yellow : chalk.red;

    console.log(chalk.bold.white('EARNINGS'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log(`${chalk.white('Total Earned:')}    ${chalk.green(earnings.totalEarned)} ${chalk.gray('NODR')}`);
    console.log(`${chalk.white('Pending:')}         ${chalk.yellow(earnings.pendingRewards)} ${chalk.gray('NODR')}`);
    console.log(`${chalk.white('Estimated APY:')}   ${apyColor(earnings.estimatedAPY.toFixed(2) + '%')}`);
    console.log();
  }

  /**
   * Render alerts
   */
  private renderAlerts() {
    const { alerts } = this.data;

    console.log(chalk.bold.white('RECENT ALERTS'));
    console.log(chalk.gray('─'.repeat(60)));

    if (alerts.length === 0) {
      console.log(chalk.gray('No recent alerts'));
    } else {
      alerts.slice(0, 5).forEach(alert => {
        const icon = this.getAlertIcon(alert.severity);
        const color = this.getAlertColor(alert.severity);
        const time = new Date(alert.timestamp).toLocaleTimeString();
        
        console.log(`${color(icon)} ${chalk.white(time)} - ${color(alert.message)}`);
      });
    }

    console.log();
  }

  /**
   * Render footer
   */
  private renderFooter() {
    console.log(chalk.gray('─'.repeat(60)));
    console.log(chalk.gray(`Last updated: ${new Date().toLocaleString()}`));
    console.log(chalk.gray('Press Ctrl+C to exit'));
  }

  /**
   * Get alert icon
   */
  private getAlertIcon(severity: Alert['severity']): string {
    switch (severity) {
      case 'info': return 'ℹ';
      case 'warning': return '⚠';
      case 'error': return '✗';
      case 'critical': return '🔥';
    }
  }

  /**
   * Get alert color
   */
  private getAlertColor(severity: Alert['severity']) {
    switch (severity) {
      case 'info': return chalk.blue;
      case 'warning': return chalk.yellow;
      case 'error': return chalk.red;
      case 'critical': return chalk.bgRed.white;
    }
  }

  /**
   * Get initial data
   */
  private getInitialData(): DashboardData {
    return {
      status: {
        nodeId: '0x0000000000000000',
        tier: 'UNKNOWN',
        walletAddress: '0x0000000000000000',
        isActive: false,
        uptime: 0,
        lastHeartbeat: 0
      },
      metrics: {
        totalTasks: 0,
        completedTasks: 0,
        failedTasks: 0,
        averageResponseTime: 0,
        successRate: 0,
        trustFingerprint: 0
      },
      earnings: {
        totalEarned: '0',
        pendingRewards: '0',
        lastRewardTimestamp: 0,
        estimatedAPY: 0
      },
      alerts: []
    };
  }
}

/**
 * Create and start dashboard
 */
export function createDashboard(): NodeDashboard {
  const dashboard = new NodeDashboard();
  
  // Handle Ctrl+C
  process.on('SIGINT', () => {
    dashboard.stop();
    process.exit(0);
  });

  return dashboard;
}
