/**
 * Type definitions for Deployment Engine
 */

export enum NodeTier {
  VALIDATOR = 'VALIDATOR',
  GUARDIAN = 'GUARDIAN',
  ORACLE = 'ORACLE',
  ALL = 'ALL',  // Meta-tier for publishing to all tiers at once
}

export enum Cohort {
  CANARY = 'canary',
  COHORT1 = 'cohort1',
  COHORT2 = 'cohort2',
  COHORT3 = 'cohort3',
  COHORT4 = 'cohort4',
}

export enum UpdatePriority {
  NORMAL = 'normal',
  HIGH = 'high',
  EMERGENCY = 'emergency',
}

export enum HealthStatus {
  HEALTHY = 'healthy',
  DEGRADED = 'degraded',
  UNHEALTHY = 'unhealthy',
}

export enum DeploymentStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  ROLLED_BACK = 'rolled_back',
}

export interface Version {
  versionId: number;
  versionString: string;
  dockerImageTag: string;
  configHash: string;
  timestamp: number;
  publisher: string;
  isActive: boolean;
  isEmergencyRollback: boolean;
}

export interface RolloutConfig {
  canaryPercentage: number;
  cohortPercentage: number;
  cohortDelayHours: number;
  isActive: boolean;
}

export interface VersionRequest {
  nodeId: string;
  tier: NodeTier;
  currentVersion?: string;
}

export interface VersionResponse {
  versionId: number;
  versionString: string;
  dockerImageTag: string;
  configHash: string;
  cohort: Cohort;
  shouldUpdate: boolean;
  updatePriority: UpdatePriority;
}

export interface HealthMetrics {
  uptime: number;
  cpu: number;
  memory: number;
  errors: number;
}

export interface HealthReport {
  nodeId: string;
  version: string;
  metrics: HealthMetrics;
  timestamp: string;
}

export interface HealthResponse {
  acknowledged: boolean;
  healthStatus: HealthStatus;
}

export interface RolloutStatus {
  currentVersion: string;
  targetVersion: string;
  rolloutPhase: Cohort | 'complete';
  nodesUpdated: number;
  totalNodes: number;
  successRate: number;
  errors: number;
}

export interface Deployment {
  id: string;
  versionId: number;
  versionString: string;
  dockerImageTag: string;
  tier: NodeTier;
  status: DeploymentStatus;
  startedAt: Date;
  completedAt?: Date;
  rollbackReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface NodeVersion {
  id: string;
  nodeId: string;
  tier: NodeTier;
  currentVersion: string;
  targetVersion?: string;
  cohort: Cohort;
  lastHealthCheck?: Date;
  healthStatus?: HealthStatus;
  updatedAt: Date;
  createdAt: Date;
}

export interface CohortMetrics {
  cohort: Cohort;
  totalNodes: number;
  healthyNodes: number;
  unhealthyNodes: number;
  errorRate: number;
}
