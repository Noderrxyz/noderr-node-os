/**
 * Cohort Selection Service
 * Implements deterministic cohort assignment algorithm
 */

import { keccak256, toUtf8Bytes } from 'ethers';
import { Cohort, RolloutConfig } from '../models/types';

export class CohortService {
  /**
   * Assign a node to a cohort based on deterministic hashing
   * @param nodeId Unique node identifier
   * @param rolloutConfig Rollout configuration from VersionBeacon
   * @returns Assigned cohort
   */
  assignCohort(nodeId: string, rolloutConfig: RolloutConfig): Cohort {
    // Use keccak256 hash of nodeId for deterministic assignment
    const hash = keccak256(toUtf8Bytes(nodeId));
    
    // Convert hash to number between 0-99
    const hashBigInt = BigInt(hash);
    const hashNumber = Number(hashBigInt % 100n);
    
    const canaryThreshold = rolloutConfig.canaryPercentage;
    const cohortSize = rolloutConfig.cohortPercentage;
    
    // Assign to cohorts based on hash distribution
    if (hashNumber < canaryThreshold) {
      return Cohort.CANARY;
    } else if (hashNumber < canaryThreshold + cohortSize) {
      return Cohort.COHORT1;
    } else if (hashNumber < canaryThreshold + cohortSize * 2) {
      return Cohort.COHORT2;
    } else if (hashNumber < canaryThreshold + cohortSize * 3) {
      return Cohort.COHORT3;
    } else {
      return Cohort.COHORT4;
    }
  }

  /**
   * Check if a cohort is active based on time since version publish
   * @param cohort Cohort to check
   * @param versionPublishTime Unix timestamp when version was published
   * @param rolloutConfig Rollout configuration
   * @returns Whether the cohort should receive the update
   */
  isCohortActive(
    cohort: Cohort,
    versionPublishTime: number,
    rolloutConfig: RolloutConfig
  ): boolean {
    const now = Math.floor(Date.now() / 1000);
    const hoursSincePublish = (now - versionPublishTime) / 3600;
    
    const cohortDelayHours = rolloutConfig.cohortDelayHours;
    
    switch (cohort) {
      case Cohort.CANARY:
        return true; // Canary always active immediately
      case Cohort.COHORT1:
        return hoursSincePublish >= cohortDelayHours;
      case Cohort.COHORT2:
        return hoursSincePublish >= cohortDelayHours * 2;
      case Cohort.COHORT3:
        return hoursSincePublish >= cohortDelayHours * 3;
      case Cohort.COHORT4:
        return hoursSincePublish >= cohortDelayHours * 4;
      default:
        return false;
    }
  }

  /**
   * Get the current rollout phase based on time since publish
   * @param versionPublishTime Unix timestamp when version was published
   * @param rolloutConfig Rollout configuration
   * @returns Current rollout phase
   */
  getCurrentPhase(
    versionPublishTime: number,
    rolloutConfig: RolloutConfig
  ): Cohort | 'complete' {
    const now = Math.floor(Date.now() / 1000);
    const hoursSincePublish = (now - versionPublishTime) / 3600;
    
    const cohortDelayHours = rolloutConfig.cohortDelayHours;
    
    if (hoursSincePublish < cohortDelayHours) {
      return Cohort.CANARY;
    } else if (hoursSincePublish < cohortDelayHours * 2) {
      return Cohort.COHORT1;
    } else if (hoursSincePublish < cohortDelayHours * 3) {
      return Cohort.COHORT2;
    } else if (hoursSincePublish < cohortDelayHours * 4) {
      return Cohort.COHORT3;
    } else if (hoursSincePublish < cohortDelayHours * 5) {
      return Cohort.COHORT4;
    } else {
      return 'complete';
    }
  }
}

export const cohortService = new CohortService();
