/**
 * Deployment Service
 * Manages version deployments and automatic rollback
 */

import { getVersionBeaconService } from './version-beacon.service';
import { cohortService } from './cohort.service';
import {
  NodeTier,
  Cohort,
  VersionRequest,
  VersionResponse,
  UpdatePriority,
  CohortMetrics,
  HealthStatus,
} from '../models/types';

export class DeploymentService {
  private readonly UNHEALTHY_THRESHOLD = 0.1; // 10% unhealthy nodes triggers rollback
  private readonly ERROR_RATE_THRESHOLD = 0.05; // 5% error rate triggers rollback

  /**
   * Get applicable version for a node
   * @param request Version request from node
   * @returns Version response with update instructions
   */
  async getNodeVersion(request: VersionRequest): Promise<VersionResponse> {
    const versionBeacon = getVersionBeaconService();
    
    // Get current version for the tier
    const currentVersion = await versionBeacon.getCurrentVersion(request.tier);
    
    // Get rollout configuration
    const rolloutConfig = await versionBeacon.getRolloutConfig();
    
    // Assign node to cohort (deterministic based on nodeId)
    const cohort = cohortService.assignCohort(request.nodeId, rolloutConfig);
    
    // Check if cohort is active
    const isCohortActive = cohortService.isCohortActive(
      cohort,
      currentVersion.timestamp,
      rolloutConfig
    );
    
    // Determine if node should update
    const shouldUpdate = isCohortActive && 
      request.currentVersion !== currentVersion.versionString;
    
    // Determine update priority
    const updatePriority = currentVersion.isEmergencyRollback
      ? UpdatePriority.EMERGENCY
      : UpdatePriority.NORMAL;
    
    return {
      versionId: currentVersion.versionId,
      versionString: currentVersion.versionString,
      dockerImageTag: currentVersion.dockerImageTag,
      configHash: currentVersion.configHash,
      cohort,
      shouldUpdate,
      updatePriority,
    };
  }

  /**
   * Check if rollback should be triggered based on health metrics
   * @param metrics Cohort health metrics
   * @returns Whether to trigger rollback
   */
  shouldTriggerRollback(metrics: CohortMetrics): boolean {
    if (metrics.totalNodes === 0) {
      return false;
    }
    
    const unhealthyRatio = metrics.unhealthyNodes / metrics.totalNodes;
    
    return (
      unhealthyRatio > this.UNHEALTHY_THRESHOLD ||
      metrics.errorRate > this.ERROR_RATE_THRESHOLD
    );
  }

  /**
   * Calculate health metrics for a cohort
   * @param cohort Cohort to analyze
   * @param nodeHealthData Array of node health statuses
   * @returns Cohort health metrics
   */
  calculateCohortMetrics(
    cohort: Cohort,
    nodeHealthData: Array<{ cohort: Cohort; healthStatus: HealthStatus; errors: number }>
  ): CohortMetrics {
    const cohortNodes = nodeHealthData.filter(node => node.cohort === cohort);
    const totalNodes = cohortNodes.length;
    
    if (totalNodes === 0) {
      return {
        cohort,
        totalNodes: 0,
        healthyNodes: 0,
        unhealthyNodes: 0,
        errorRate: 0,
      };
    }
    
    const healthyNodes = cohortNodes.filter(
      node => node.healthStatus === HealthStatus.HEALTHY
    ).length;
    
    const unhealthyNodes = cohortNodes.filter(
      node => node.healthStatus === HealthStatus.UNHEALTHY
    ).length;
    
    const totalErrors = cohortNodes.reduce((sum, node) => sum + node.errors, 0);
    const errorRate = totalErrors / totalNodes;
    
    return {
      cohort,
      totalNodes,
      healthyNodes,
      unhealthyNodes,
      errorRate,
    };
  }

  /**
   * Monitor deployment and trigger rollback if needed
   * @param tier Node tier being deployed
   * @param nodeHealthData Current health data for all nodes
   * @returns Whether rollback was triggered
   */
  async monitorAndRollback(
    tier: NodeTier,
    nodeHealthData: Array<{ cohort: Cohort; healthStatus: HealthStatus; errors: number }>
  ): Promise<boolean> {
    // Check each cohort's health
    const cohorts = [Cohort.CANARY, Cohort.COHORT1, Cohort.COHORT2, Cohort.COHORT3, Cohort.COHORT4];
    
    for (const cohort of cohorts) {
      const metrics = this.calculateCohortMetrics(cohort, nodeHealthData);
      
      if (this.shouldTriggerRollback(metrics)) {
        console.error(`Rollback triggered for ${tier} tier, cohort ${cohort}`, metrics);
        
        // In production, this would call the VersionBeacon contract's
        // emergencyRollback function via a Guardian-controlled wallet
        // For now, we log the rollback event
        
        return true;
      }
    }
    
    return false;
  }
}

export const deploymentService = new DeploymentService();
