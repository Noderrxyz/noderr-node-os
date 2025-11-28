/**
 * Types and Configuration for Slashing Service
 */

export interface SlashingRule {
  id: string;
  name: string;
  description: string;
  condition: (metrics: NodeMetrics) => boolean;
  slashAmount: (metrics: NodeMetrics) => bigint;
  severity: 'minor' | 'moderate' | 'severe' | 'critical';
  enabled: boolean;
}

export interface NodeMetrics {
  nodeId: string;
  uptime: number;              // Percentage (0-100)
  errorRate: number;           // Errors per hour
  lastSeen: Date;              // Last heartbeat
  consecutiveFailures: number; // Number of consecutive failed health checks
  version: string;             // Current version
  expectedVersion: string;     // Expected version from VersionBeacon
  stake: bigint;               // Current stake amount
  tier: 'ALL' | 'ORACLE' | 'GUARDIAN';
}

export interface SlashingEvent {
  nodeId: string;
  operator: string;
  ruleId: string;
  ruleName: string;
  amount: bigint;
  reason: string;
  timestamp: Date;
  txHash?: string;
  status: 'pending' | 'executed' | 'failed';
}

export interface SlashingConfig {
  // Minimum stake thresholds
  minimumStake: bigint;

  // Uptime thresholds
  minUptimePercent: number;           // Below this triggers slashing
  criticalUptimePercent: number;      // Below this triggers severe slashing

  // Error rate thresholds
  maxErrorsPerHour: number;           // Above this triggers slashing
  criticalErrorsPerHour: number;      // Above this triggers severe slashing

  // Heartbeat thresholds
  maxMissedHeartbeats: number;        // Consecutive missed heartbeats before slashing
  heartbeatInterval: number;          // Expected heartbeat interval in seconds

  // Version compliance
  versionGracePeriod: number;         // Hours after version release before slashing
  outdatedVersionSlashPercent: number; // Percentage of stake to slash for outdated version

  // Slashing amounts (in basis points of stake, 10000 = 100%)
  minorSlashBps: number;              // 100 = 1%
  moderateSlashBps: number;           // 500 = 5%
  severeSlashBps: number;             // 1000 = 10%
  criticalSlashBps: number;           // 5000 = 50%

  // Protection limits
  maxSlashPerDay: bigint;             // Maximum total slash per node per day
  minTimeBetweenSlashes: number;      // Minimum seconds between slashes for same node

  // Monitoring
  checkInterval: number;              // How often to check nodes (seconds)
  metricsLookbackPeriod: number;      // How far back to look for metrics (hours)
}

export const DEFAULT_SLASHING_CONFIG: SlashingConfig = {
  minimumStake: BigInt('1000000000000000000000'), // 1000 tokens

  minUptimePercent: 95,
  criticalUptimePercent: 80,

  maxErrorsPerHour: 10,
  criticalErrorsPerHour: 50,

  maxMissedHeartbeats: 3,
  heartbeatInterval: 300, // 5 minutes

  versionGracePeriod: 24, // 24 hours
  outdatedVersionSlashPercent: 5,

  minorSlashBps: 100,      // 1%
  moderateSlashBps: 500,   // 5%
  severeSlashBps: 1000,    // 10%
  criticalSlashBps: 5000,  // 50%

  maxSlashPerDay: BigInt('100000000000000000000'), // 100 tokens
  minTimeBetweenSlashes: 3600, // 1 hour

  checkInterval: 300,      // 5 minutes
  metricsLookbackPeriod: 24 // 24 hours
};
