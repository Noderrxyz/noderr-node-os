/**
 * Deployment Service Tests
 */

import { deploymentService } from '../src/services/deployment.service';
import { Cohort, HealthStatus, CohortMetrics } from '../src/models/types';

describe('DeploymentService', () => {
  describe('shouldTriggerRollback', () => {
    it('should trigger rollback when unhealthy ratio exceeds threshold', () => {
      const metrics: CohortMetrics = {
        cohort: Cohort.CANARY,
        totalNodes: 100,
        healthyNodes: 85,
        unhealthyNodes: 15, // 15% unhealthy
        errorRate: 0.02,
      };
      
      const shouldRollback = deploymentService.shouldTriggerRollback(metrics);
      expect(shouldRollback).toBe(true);
    });

    it('should trigger rollback when error rate exceeds threshold', () => {
      const metrics: CohortMetrics = {
        cohort: Cohort.CANARY,
        totalNodes: 100,
        healthyNodes: 95,
        unhealthyNodes: 5,
        errorRate: 0.06, // 6% error rate
      };
      
      const shouldRollback = deploymentService.shouldTriggerRollback(metrics);
      expect(shouldRollback).toBe(true);
    });

    it('should not trigger rollback when metrics are healthy', () => {
      const metrics: CohortMetrics = {
        cohort: Cohort.CANARY,
        totalNodes: 100,
        healthyNodes: 98,
        unhealthyNodes: 2, // 2% unhealthy
        errorRate: 0.01, // 1% error rate
      };
      
      const shouldRollback = deploymentService.shouldTriggerRollback(metrics);
      expect(shouldRollback).toBe(false);
    });

    it('should not trigger rollback when no nodes exist', () => {
      const metrics: CohortMetrics = {
        cohort: Cohort.CANARY,
        totalNodes: 0,
        healthyNodes: 0,
        unhealthyNodes: 0,
        errorRate: 0,
      };
      
      const shouldRollback = deploymentService.shouldTriggerRollback(metrics);
      expect(shouldRollback).toBe(false);
    });
  });

  describe('calculateCohortMetrics', () => {
    it('should calculate metrics correctly for healthy cohort', () => {
      const nodeHealthData = [
        { cohort: Cohort.CANARY, healthStatus: HealthStatus.HEALTHY, errors: 0 },
        { cohort: Cohort.CANARY, healthStatus: HealthStatus.HEALTHY, errors: 1 },
        { cohort: Cohort.CANARY, healthStatus: HealthStatus.DEGRADED, errors: 2 },
        { cohort: Cohort.COHORT1, healthStatus: HealthStatus.HEALTHY, errors: 0 },
      ];
      
      const metrics = deploymentService.calculateCohortMetrics(Cohort.CANARY, nodeHealthData);
      
      expect(metrics.cohort).toBe(Cohort.CANARY);
      expect(metrics.totalNodes).toBe(3);
      expect(metrics.healthyNodes).toBe(2);
      expect(metrics.unhealthyNodes).toBe(0);
      expect(metrics.errorRate).toBe(1); // (0 + 1 + 2) / 3
    });

    it('should calculate metrics correctly for unhealthy cohort', () => {
      const nodeHealthData = [
        { cohort: Cohort.CANARY, healthStatus: HealthStatus.UNHEALTHY, errors: 5 },
        { cohort: Cohort.CANARY, healthStatus: HealthStatus.UNHEALTHY, errors: 3 },
        { cohort: Cohort.CANARY, healthStatus: HealthStatus.HEALTHY, errors: 0 },
      ];
      
      const metrics = deploymentService.calculateCohortMetrics(Cohort.CANARY, nodeHealthData);
      
      expect(metrics.cohort).toBe(Cohort.CANARY);
      expect(metrics.totalNodes).toBe(3);
      expect(metrics.healthyNodes).toBe(1);
      expect(metrics.unhealthyNodes).toBe(2);
      expect(metrics.errorRate).toBeCloseTo(2.67, 1); // (5 + 3 + 0) / 3
    });

    it('should return zero metrics for empty cohort', () => {
      const nodeHealthData = [
        { cohort: Cohort.COHORT1, healthStatus: HealthStatus.HEALTHY, errors: 0 },
      ];
      
      const metrics = deploymentService.calculateCohortMetrics(Cohort.CANARY, nodeHealthData);
      
      expect(metrics.cohort).toBe(Cohort.CANARY);
      expect(metrics.totalNodes).toBe(0);
      expect(metrics.healthyNodes).toBe(0);
      expect(metrics.unhealthyNodes).toBe(0);
      expect(metrics.errorRate).toBe(0);
    });

    it('should filter nodes by cohort correctly', () => {
      const nodeHealthData = [
        { cohort: Cohort.CANARY, healthStatus: HealthStatus.HEALTHY, errors: 0 },
        { cohort: Cohort.COHORT1, healthStatus: HealthStatus.HEALTHY, errors: 0 },
        { cohort: Cohort.COHORT1, healthStatus: HealthStatus.DEGRADED, errors: 1 },
        { cohort: Cohort.COHORT2, healthStatus: HealthStatus.HEALTHY, errors: 0 },
      ];
      
      const canaryMetrics = deploymentService.calculateCohortMetrics(Cohort.CANARY, nodeHealthData);
      const cohort1Metrics = deploymentService.calculateCohortMetrics(Cohort.COHORT1, nodeHealthData);
      
      expect(canaryMetrics.totalNodes).toBe(1);
      expect(cohort1Metrics.totalNodes).toBe(2);
    });
  });
});
