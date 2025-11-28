/**
 * Cohort Service Tests
 */

import { cohortService } from '../src/services/cohort.service';
import { Cohort, RolloutConfig } from '../src/models/types';

describe('CohortService', () => {
  const defaultRolloutConfig: RolloutConfig = {
    canaryPercentage: 5,
    cohortPercentage: 25,
    cohortDelayHours: 24,
    isActive: true,
  };

  describe('assignCohort', () => {
    it('should assign nodes deterministically to cohorts', () => {
      const nodeId = 'test-node-123';
      
      // Same node ID should always get same cohort
      const cohort1 = cohortService.assignCohort(nodeId, defaultRolloutConfig);
      const cohort2 = cohortService.assignCohort(nodeId, defaultRolloutConfig);
      
      expect(cohort1).toBe(cohort2);
    });

    it('should distribute nodes across all cohorts', () => {
      const cohorts = new Set<Cohort>();
      
      // Test 1000 different node IDs
      for (let i = 0; i < 1000; i++) {
        const nodeId = `node-${i}`;
        const cohort = cohortService.assignCohort(nodeId, defaultRolloutConfig);
        cohorts.add(cohort);
      }
      
      // Should have nodes in all 5 cohorts
      expect(cohorts.size).toBe(5);
      expect(cohorts).toContain(Cohort.CANARY);
      expect(cohorts).toContain(Cohort.COHORT1);
      expect(cohorts).toContain(Cohort.COHORT2);
      expect(cohorts).toContain(Cohort.COHORT3);
      expect(cohorts).toContain(Cohort.COHORT4);
    });

    it('should respect rollout configuration percentages', () => {
      const cohortCounts = {
        [Cohort.CANARY]: 0,
        [Cohort.COHORT1]: 0,
        [Cohort.COHORT2]: 0,
        [Cohort.COHORT3]: 0,
        [Cohort.COHORT4]: 0,
      };
      
      const totalNodes = 10000;
      
      // Assign many nodes to get statistical distribution
      for (let i = 0; i < totalNodes; i++) {
        const nodeId = `node-${i}`;
        const cohort = cohortService.assignCohort(nodeId, defaultRolloutConfig);
        cohortCounts[cohort]++;
      }
      
      // Check distribution (allow 2% margin of error)
      expect(cohortCounts[Cohort.CANARY] / totalNodes).toBeCloseTo(0.05, 1);
      expect(cohortCounts[Cohort.COHORT1] / totalNodes).toBeCloseTo(0.25, 1);
      expect(cohortCounts[Cohort.COHORT2] / totalNodes).toBeCloseTo(0.25, 1);
      expect(cohortCounts[Cohort.COHORT3] / totalNodes).toBeCloseTo(0.25, 1);
      expect(cohortCounts[Cohort.COHORT4] / totalNodes).toBeCloseTo(0.20, 1);
    });
  });

  describe('isCohortActive', () => {
    const now = Math.floor(Date.now() / 1000);
    
    it('should activate canary immediately', () => {
      const versionPublishTime = now;
      const isActive = cohortService.isCohortActive(
        Cohort.CANARY,
        versionPublishTime,
        defaultRolloutConfig
      );
      
      expect(isActive).toBe(true);
    });

    it('should activate cohort1 after delay', () => {
      const versionPublishTime = now - (25 * 3600); // 25 hours ago
      const isActive = cohortService.isCohortActive(
        Cohort.COHORT1,
        versionPublishTime,
        defaultRolloutConfig
      );
      
      expect(isActive).toBe(true);
    });

    it('should not activate cohort1 before delay', () => {
      const versionPublishTime = now - (23 * 3600); // 23 hours ago
      const isActive = cohortService.isCohortActive(
        Cohort.COHORT1,
        versionPublishTime,
        defaultRolloutConfig
      );
      
      expect(isActive).toBe(false);
    });

    it('should activate cohort2 after 2x delay', () => {
      const versionPublishTime = now - (49 * 3600); // 49 hours ago
      const isActive = cohortService.isCohortActive(
        Cohort.COHORT2,
        versionPublishTime,
        defaultRolloutConfig
      );
      
      expect(isActive).toBe(true);
    });

    it('should activate cohort3 after 3x delay', () => {
      const versionPublishTime = now - (73 * 3600); // 73 hours ago
      const isActive = cohortService.isCohortActive(
        Cohort.COHORT3,
        versionPublishTime,
        defaultRolloutConfig
      );
      
      expect(isActive).toBe(true);
    });

    it('should activate cohort4 after 4x delay', () => {
      const versionPublishTime = now - (97 * 3600); // 97 hours ago
      const isActive = cohortService.isCohortActive(
        Cohort.COHORT4,
        versionPublishTime,
        defaultRolloutConfig
      );
      
      expect(isActive).toBe(true);
    });
  });

  describe('getCurrentPhase', () => {
    const now = Math.floor(Date.now() / 1000);
    
    it('should return canary phase immediately after publish', () => {
      const versionPublishTime = now;
      const phase = cohortService.getCurrentPhase(versionPublishTime, defaultRolloutConfig);
      
      expect(phase).toBe(Cohort.CANARY);
    });

    it('should return cohort1 phase after first delay', () => {
      const versionPublishTime = now - (25 * 3600);
      const phase = cohortService.getCurrentPhase(versionPublishTime, defaultRolloutConfig);
      
      expect(phase).toBe(Cohort.COHORT1);
    });

    it('should return cohort2 phase after second delay', () => {
      const versionPublishTime = now - (49 * 3600);
      const phase = cohortService.getCurrentPhase(versionPublishTime, defaultRolloutConfig);
      
      expect(phase).toBe(Cohort.COHORT2);
    });

    it('should return complete after all cohorts', () => {
      const versionPublishTime = now - (121 * 3600); // 121 hours ago
      const phase = cohortService.getCurrentPhase(versionPublishTime, defaultRolloutConfig);
      
      expect(phase).toBe('complete');
    });
  });
});
