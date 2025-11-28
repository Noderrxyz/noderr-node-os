/**
 * Slashing Rules Engine
 * 
 * Defines and evaluates slashing rules based on node metrics
 */

import { SlashingRule, NodeMetrics, SlashingConfig, DEFAULT_SLASHING_CONFIG } from './types';

export class SlashingRules {
  private config: SlashingConfig;
  private rules: Map<string, SlashingRule>;

  constructor(config: SlashingConfig = DEFAULT_SLASHING_CONFIG) {
    this.config = config;
    this.rules = new Map();
    this.initializeRules();
  }

  /**
   * Initialize default slashing rules
   */
  private initializeRules() {
    // Rule 1: Low Uptime (Minor)
    this.addRule({
      id: 'low_uptime_minor',
      name: 'Low Uptime (Minor)',
      description: `Uptime below ${this.config.minUptimePercent}%`,
      condition: (metrics) => {
        return metrics.uptime < this.config.minUptimePercent &&
               metrics.uptime >= this.config.criticalUptimePercent;
      },
      slashAmount: (metrics) => {
        return (metrics.stake * BigInt(this.config.minorSlashBps)) / BigInt(10000);
      },
      severity: 'minor',
      enabled: true
    });

    // Rule 2: Critical Uptime (Severe)
    this.addRule({
      id: 'low_uptime_critical',
      name: 'Critical Uptime',
      description: `Uptime below ${this.config.criticalUptimePercent}%`,
      condition: (metrics) => {
        return metrics.uptime < this.config.criticalUptimePercent;
      },
      slashAmount: (metrics) => {
        return (metrics.stake * BigInt(this.config.severeSlashBps)) / BigInt(10000);
      },
      severity: 'severe',
      enabled: true
    });

    // Rule 3: High Error Rate (Moderate)
    this.addRule({
      id: 'high_error_rate',
      name: 'High Error Rate',
      description: `Error rate above ${this.config.maxErrorsPerHour} per hour`,
      condition: (metrics) => {
        return metrics.errorRate > this.config.maxErrorsPerHour &&
               metrics.errorRate < this.config.criticalErrorsPerHour;
      },
      slashAmount: (metrics) => {
        return (metrics.stake * BigInt(this.config.moderateSlashBps)) / BigInt(10000);
      },
      severity: 'moderate',
      enabled: true
    });

    // Rule 4: Critical Error Rate (Severe)
    this.addRule({
      id: 'critical_error_rate',
      name: 'Critical Error Rate',
      description: `Error rate above ${this.config.criticalErrorsPerHour} per hour`,
      condition: (metrics) => {
        return metrics.errorRate >= this.config.criticalErrorsPerHour;
      },
      slashAmount: (metrics) => {
        return (metrics.stake * BigInt(this.config.severeSlashBps)) / BigInt(10000);
      },
      severity: 'severe',
      enabled: true
    });

    // Rule 5: Missed Heartbeats (Moderate)
    this.addRule({
      id: 'missed_heartbeats',
      name: 'Missed Heartbeats',
      description: `${this.config.maxMissedHeartbeats} consecutive missed heartbeats`,
      condition: (metrics) => {
        return metrics.consecutiveFailures >= this.config.maxMissedHeartbeats;
      },
      slashAmount: (metrics) => {
        return (metrics.stake * BigInt(this.config.moderateSlashBps)) / BigInt(10000);
      },
      severity: 'moderate',
      enabled: true
    });

    // Rule 6: Offline Node (Critical)
    this.addRule({
      id: 'node_offline',
      name: 'Node Offline',
      description: 'Node has been offline for extended period',
      condition: (metrics) => {
        const now = new Date();
        const timeSinceLastSeen = (now.getTime() - metrics.lastSeen.getTime()) / 1000;
        const maxOfflineTime = this.config.heartbeatInterval * this.config.maxMissedHeartbeats * 2;
        return timeSinceLastSeen > maxOfflineTime;
      },
      slashAmount: (metrics) => {
        return (metrics.stake * BigInt(this.config.criticalSlashBps)) / BigInt(10000);
      },
      severity: 'critical',
      enabled: true
    });

    // Rule 7: Outdated Version (Minor)
    this.addRule({
      id: 'outdated_version',
      name: 'Outdated Version',
      description: `Running outdated version after ${this.config.versionGracePeriod}h grace period`,
      condition: (metrics) => {
        // This would need to check version release time from VersionBeacon
        // For now, just check if versions don't match
        return metrics.version !== metrics.expectedVersion;
      },
      slashAmount: (metrics) => {
        const slashPercent = this.config.outdatedVersionSlashPercent;
        return (metrics.stake * BigInt(slashPercent * 100)) / BigInt(10000);
      },
      severity: 'minor',
      enabled: true
    });

    // Rule 8: Below Minimum Stake (Critical)
    this.addRule({
      id: 'below_minimum_stake',
      name: 'Below Minimum Stake',
      description: 'Stake has fallen below minimum required',
      condition: (metrics) => {
        return metrics.stake < this.config.minimumStake;
      },
      slashAmount: (metrics) => {
        // This is more of a deactivation trigger than a slash
        return BigInt(0);
      },
      severity: 'critical',
      enabled: true
    });
  }

  /**
   * Add a custom rule
   */
  addRule(rule: SlashingRule) {
    this.rules.set(rule.id, rule);
  }

  /**
   * Remove a rule
   */
  removeRule(ruleId: string) {
    this.rules.delete(ruleId);
  }

  /**
   * Enable/disable a rule
   */
  setRuleEnabled(ruleId: string, enabled: boolean) {
    const rule = this.rules.get(ruleId);
    if (rule) {
      rule.enabled = enabled;
    }
  }

  /**
   * Get all rules
   */
  getAllRules(): SlashingRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * Get enabled rules
   */
  getEnabledRules(): SlashingRule[] {
    return Array.from(this.rules.values()).filter(rule => rule.enabled);
  }

  /**
   * Evaluate all rules against node metrics
   * Returns array of triggered rules
   */
  evaluateRules(metrics: NodeMetrics): SlashingRule[] {
    const triggeredRules: SlashingRule[] = [];

    for (const rule of this.getEnabledRules()) {
      try {
        if (rule.condition(metrics)) {
          triggeredRules.push(rule);
        }
      } catch (error) {
        console.error(`Error evaluating rule ${rule.id}:`, error);
      }
    }

    // Sort by severity (critical first)
    const severityOrder = { critical: 0, severe: 1, moderate: 2, minor: 3 };
    triggeredRules.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    return triggeredRules;
  }

  /**
   * Calculate total slash amount for triggered rules
   */
  calculateTotalSlash(metrics: NodeMetrics, triggeredRules: SlashingRule[]): bigint {
    let total = BigInt(0);

    for (const rule of triggeredRules) {
      try {
        const amount = rule.slashAmount(metrics);
        total += amount;
      } catch (error) {
        console.error(`Error calculating slash amount for rule ${rule.id}:`, error);
      }
    }

    // Cap at max slash per day
    if (total > this.config.maxSlashPerDay) {
      total = this.config.maxSlashPerDay;
    }

    // Cap at total stake
    if (total > metrics.stake) {
      total = metrics.stake;
    }

    return total;
  }

  /**
   * Get most severe triggered rule
   */
  getMostSevereRule(triggeredRules: SlashingRule[]): SlashingRule | null {
    if (triggeredRules.length === 0) {
      return null;
    }

    // Rules are already sorted by severity
    return triggeredRules[0];
  }

  /**
   * Generate slash reason from triggered rules
   */
  generateSlashReason(triggeredRules: SlashingRule[]): string {
    if (triggeredRules.length === 0) {
      return 'No violations';
    }

    if (triggeredRules.length === 1) {
      return triggeredRules[0].description;
    }

    const reasons = triggeredRules.map(rule => rule.name);
    return `Multiple violations: ${reasons.join(', ')}`;
  }
}
