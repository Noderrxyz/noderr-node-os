/**
 * Cohort Determination Logic
 * 
 * Determines which cohort a node belongs to for staged rollouts
 * 
 * @module cohort
 */

import { keccak256, toUtf8Bytes } from 'ethers';
import { VersionInfo } from './version-beacon';
import { logger } from './logger';

/**
 * Cohort types
 */
export enum Cohort {
  CANARY = 'canary',
  COHORT_1 = 'cohort_1',
  COHORT_2 = 'cohort_2',
  COHORT_3 = 'cohort_3',
  COHORT_4 = 'cohort_4',
  NOT_ELIGIBLE = 'not_eligible',
}

/**
 * Determine which cohort a node belongs to
 * 
 * Uses deterministic hashing to assign nodes to cohorts
 * 
 * @param nodeId - Unique node identifier
 * @param versionInfo - Version information with rollout config
 * @param deployedAt - When the version was deployed (timestamp)
 * @returns Cohort assignment
 */
export function determineNodeCohort(
  nodeId: string,
  versionInfo: VersionInfo
): Cohort {
  const { canaryPercent, cohortPercent, delayBetweenCohorts } = versionInfo.rollout;
  const deployedAt = versionInfo.deployedAt;
  
  // Calculate time since deployment
  const now = Math.floor(Date.now() / 1000);
  const timeSinceDeployment = now - deployedAt;
  
  // Deterministic hash of nodeId
  const hash = keccak256(toUtf8Bytes(nodeId));
  const hashValue = BigInt(hash);
  const percentage = Number((hashValue % 100n) + 1n); // 1-100
  
  logger.debug('Cohort determination', {
    nodeId,
    percentage,
    timeSinceDeployment,
    canaryPercent,
    cohortPercent,
    delayBetweenCohorts,
  });
  
  // Canary cohort (immediate)
  if (percentage <= canaryPercent) {
    logger.info('Node assigned to canary cohort', { nodeId, percentage });
    return Cohort.CANARY;
  }
  
  // Calculate cohort thresholds
  let threshold = canaryPercent;
  const cohorts = [Cohort.COHORT_1, Cohort.COHORT_2, Cohort.COHORT_3, Cohort.COHORT_4];
  
  for (let i = 0; i < cohorts.length; i++) {
    threshold += cohortPercent;
    const cohortDelay = delayBetweenCohorts * (i + 1);
    
    if (percentage <= threshold) {
      // Check if enough time has passed for this cohort
      if (timeSinceDeployment >= cohortDelay) {
        logger.info('Node assigned to cohort', {
          nodeId,
          cohort: cohorts[i],
          percentage,
          threshold,
          timeSinceDeployment,
          requiredDelay: cohortDelay,
        });
        return cohorts[i];
      } else {
        logger.info('Node not yet eligible for cohort', {
          nodeId,
          cohort: cohorts[i],
          percentage,
          threshold,
          timeSinceDeployment,
          requiredDelay: cohortDelay,
          remainingTime: cohortDelay - timeSinceDeployment,
        });
        return Cohort.NOT_ELIGIBLE;
      }
    }
  }
  
  logger.info('Node not in any cohort', { nodeId, percentage, threshold });
  return Cohort.NOT_ELIGIBLE;
}

/**
 * Check if node should update now
 * 
 * @param nodeId - Unique node identifier
 * @param versionInfo - Version information
 * @returns True if node should update
 */
export function shouldUpdateNow(
  nodeId: string,
  versionInfo: VersionInfo
): boolean {
  const cohort = determineNodeCohort(nodeId, versionInfo);
  const shouldUpdate = cohort !== Cohort.NOT_ELIGIBLE;
  
  logger.info('Update eligibility check', {
    nodeId,
    cohort,
    shouldUpdate,
  });
  
  return shouldUpdate;
}

/**
 * Get estimated time until update eligibility
 * 
 * @param nodeId - Unique node identifier
 * @param versionInfo - Version information
 * @returns Seconds until eligible, or 0 if already eligible
 */
export function getTimeUntilEligible(
  nodeId: string,
  versionInfo: VersionInfo
): number {
  const { canaryPercent, cohortPercent, delayBetweenCohorts } = versionInfo.rollout;
  const deployedAt = versionInfo.deployedAt;
  
  // Deterministic hash of nodeId
  const hash = keccak256(toUtf8Bytes(nodeId));
  const hashValue = BigInt(hash);
  const percentage = Number((hashValue % 100n) + 1n);
  
  // Canary is immediate
  if (percentage <= canaryPercent) {
    return 0;
  }
  
  // Calculate which cohort this node belongs to
  let threshold = canaryPercent;
  const cohorts = [1, 2, 3, 4];
  
  for (const cohortNum of cohorts) {
    threshold += cohortPercent;
    
    if (percentage <= threshold) {
      const cohortDelay = delayBetweenCohorts * cohortNum;
      const now = Math.floor(Date.now() / 1000);
      const timeSinceDeployment = now - deployedAt;
      
      if (timeSinceDeployment >= cohortDelay) {
        return 0; // Already eligible
      }
      
      return cohortDelay - timeSinceDeployment;
    }
  }
  
  // Not in any cohort
  return -1;
}
