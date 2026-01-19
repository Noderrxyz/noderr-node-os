import { HealthCheckResult } from "@noderr/types/src";
/**
 * Health Types - System health monitoring and recovery types
 * 
 * Comprehensive health check definitions for monitoring the entire
 * Noderr Protocol system and individual module health.
 */

export enum HealthStatus {
  HEALTHY = 'healthy',
  DEGRADED = 'degraded',
  UNHEALTHY = 'unhealthy',
  UNKNOWN = 'unknown'
}

export enum ModuleStatus {
  STARTING = 'starting',
  READY = 'ready',
  BUSY = 'busy',
  ERROR = 'error',
  STOPPING = 'stopping',
  STOPPED = 'stopped'
}

// export interface HealthCheckResult {
//   moduleId: string;
//   moduleName: string;
//   status: HealthStatus;
//   moduleStatus: ModuleStatus;
//   timestamp: number;
//   latency: number;
//   uptime: number;
//   lastError?: string;
//   metrics: HealthMetrics;
//   dependencies?: DependencyHealth[];
//   custom?: Record<string, any>;
// }

export interface HealthMetrics {
  cpu: CPUMetrics;
  memory: MemoryMetrics;
  network?: NetworkMetrics;
  eventLoop?: EventLoopMetrics;
  custom?: Record<string, number>;
}

export interface CPUMetrics {
  usage: number; // 0-100
  system: number;
  user: number;
  idle: number;
}

export interface MemoryMetrics {
  heapUsed: number;
  heapTotal: number;
  external: number;
  rss: number;
  available: number;
  percentUsed: number;
}

export interface NetworkMetrics {
  connections: number;
  requestsPerSecond: number;
  bytesIn: number;
  bytesOut: number;
  errors: number;
}

export interface EventLoopMetrics {
  lag: number;
  percentile50: number;
  percentile90: number;
  percentile99: number;
}

export interface DependencyHealth {
  name: string;
  type: 'module' | 'service' | 'database' | 'api';
  status: HealthStatus;
  latency?: number;
  error?: string;
}

export interface SystemHealth {
  status: HealthStatus;
  timestamp: number;
  modules: ModuleHealthSummary[];
  aggregateMetrics: AggregateMetrics;
  alerts: HealthAlert[];
  recommendations: string[];
}

export interface ModuleHealthSummary {
  moduleId: string;
  moduleName: string;
  status: HealthStatus;
  uptime: number;
  errorCount: number;
  lastCheck: number;
}

export interface AggregateMetrics {
  totalModules: number;
  healthyModules: number;
  degradedModules: number;
  unhealthyModules: number;
  avgCpuUsage: number;
  avgMemoryUsage: number;
  totalMemoryUsed: number;
  totalConnections: number;
  totalRequestsPerSecond: number;
}

export interface HealthAlert {
  id: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  module: string;
  message: string;
  timestamp: number;
  resolved?: boolean;
  resolvedAt?: number;
  metadata?: Record<string, any>;
}

// Recovery Types
export interface RecoveryAction {
  id: string;
  module: string;
  action: RecoveryActionType;
  reason: string;
  timestamp: number;
  attempts: number;
  success?: boolean;
  error?: string;
}

export enum RecoveryActionType {
  RESTART = 'restart',
  RELOAD = 'reload',
  RESET = 'reset',
  FAILOVER = 'failover',
  CIRCUIT_BREAK = 'circuit_break',
  ROLLBACK = 'rollback',
  SCALE_DOWN = 'scale_down',
  ALERT_ONLY = 'alert_only'
}

export interface RecoveryStrategy {
  module: string;
  triggers: RecoveryTrigger[];
  actions: RecoveryActionConfig[];
  maxAttempts: number;
  backoffMultiplier: number;
  cooldownPeriod: number;
}

export interface RecoveryTrigger {
  type: 'error_rate' | 'latency' | 'memory' | 'cpu' | 'custom';
  threshold: number;
  duration: number; // How long condition must persist
  comparison: 'gt' | 'lt' | 'eq';
}

export interface RecoveryActionConfig {
  type: RecoveryActionType;
  priority: number;
  delay?: number;
  timeout?: number;
  fallback?: RecoveryActionType;
  notify?: string[];
}

// Health Check Configuration
export interface HealthCheckConfig {
  interval: number; // ms
  timeout: number;
  retries: number;
  modules: ModuleHealthConfig[];
}

export interface ModuleHealthConfig {
  moduleId: string;
  enabled: boolean;
  interval?: number; // Override global interval
  timeout?: number;
  checks: HealthCheckType[];
  thresholds?: HealthThresholds;
}

export enum HealthCheckType {
  BASIC = 'basic',
  METRICS = 'metrics',
  DEPENDENCIES = 'dependencies',
  CUSTOM = 'custom',
  PERFORMANCE = 'performance'
}

export interface HealthThresholds {
  cpu?: { warning: number; critical: number };
  memory?: { warning: number; critical: number };
  latency?: { warning: number; critical: number };
  errorRate?: { warning: number; critical: number };
  custom?: Record<string, { warning: number; critical: number }>;
}

// Health History
export interface HealthHistory {
  moduleId: string;
  entries: HealthHistoryEntry[];
  summary: HealthHistorySummary;
}

export interface HealthHistoryEntry {
  timestamp: number;
  status: HealthStatus;
  metrics: HealthMetrics;
  alerts?: string[];
}

export interface HealthHistorySummary {
  period: number; // ms
  uptime: number; // percentage
  avgCpu: number;
  avgMemory: number;
  errorCount: number;
  statusChanges: number;
  mttr: number; // Mean time to recovery
  mtbf: number; // Mean time between failures
}

// Health Monitor Events
export interface HealthMonitorEvents {
  'health:check': (moduleId: string) => void;
  'health:updated': (result: HealthCheckResult) => void;
  'health:degraded': (moduleId: string, result: HealthCheckResult) => void;
  'health:recovered': (moduleId: string, result: HealthCheckResult) => void;
  'health:failed': (moduleId: string, error: Error) => void;
  'health:alert': (alert: HealthAlert) => void;
  'recovery:started': (action: RecoveryAction) => void;
  'recovery:completed': (action: RecoveryAction) => void;
  'recovery:failed': (action: RecoveryAction) => void;
}

// Utility Functions
export class HealthUtils {
  static calculateOverallStatus(results: HealthCheckResult[]): HealthStatus {
    if (results.length === 0) return HealthStatus.UNKNOWN;
    
    const hasUnhealthy = results.some(r => r.status === HealthStatus.UNHEALTHY);
    if (hasUnhealthy) return HealthStatus.UNHEALTHY;
    
    const hasDegraded = results.some(r => r.status === HealthStatus.DEGRADED);
    if (hasDegraded) return HealthStatus.DEGRADED;
    
    const allHealthy = results.every(r => r.status === HealthStatus.HEALTHY);
    return allHealthy ? HealthStatus.HEALTHY : HealthStatus.UNKNOWN;
  }
  
  static isHealthy(status: HealthStatus): boolean {
    return status === HealthStatus.HEALTHY;
  }
  
  static needsRecovery(status: HealthStatus): boolean {
    return status === HealthStatus.UNHEALTHY || status === HealthStatus.DEGRADED;
  }
  
  static calculateUptime(startTime: number): number {
    return Date.now() - startTime;
  }
  
  static formatUptime(ms: number): string {
    const days = Math.floor(ms / (1000 * 60 * 60 * 24));
    const hours = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    
    return `${days}d ${hours}h ${minutes}m`;
  }
} 