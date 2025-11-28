/**
 * API Routes for Deployment Engine
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { deploymentService } from '../services/deployment.service';
import { getVersionBeaconService } from '../services/version-beacon.service';
import { cohortService } from '../services/cohort.service';
import { NodeTier, HealthStatus } from '../models/types';

// Request schemas
const VersionRequestSchema = z.object({
  nodeId: z.string().min(1),
  tier: z.nativeEnum(NodeTier),
  currentVersion: z.string().optional(),
});

const HealthReportSchema = z.object({
  nodeId: z.string().min(1),
  version: z.string().min(1),
  metrics: z.object({
    uptime: z.number().min(0),
    cpu: z.number().min(0).max(100),
    memory: z.number().min(0).max(100),
    errors: z.number().min(0),
  }),
  timestamp: z.string(),
});

export async function registerApiRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/v1/version/:nodeId
   * Get applicable version for a specific node
   */
  fastify.get<{
    Params: { nodeId: string };
    Querystring: { tier: NodeTier; currentVersion?: string };
  }>(
    '/api/v1/version/:nodeId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { nodeId } = request.params as { nodeId: string };
        const { tier, currentVersion } = request.query as { tier: NodeTier; currentVersion?: string };

        // Validate request
        const validatedRequest = VersionRequestSchema.parse({
          nodeId,
          tier,
          currentVersion,
        });

        // Get version for node
        const versionResponse = await deploymentService.getNodeVersion(validatedRequest);

        return reply.code(200).send(versionResponse);
      } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send({
          error: 'Internal server error',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  /**
   * POST /api/v1/health
   * Report node health status
   */
  fastify.post<{
    Body: {
      nodeId: string;
      version: string;
      metrics: {
        uptime: number;
        cpu: number;
        memory: number;
        errors: number;
      };
      timestamp: string;
    };
  }>(
    '/api/v1/health',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        // Validate request
        const healthReport = HealthReportSchema.parse(request.body);

        // Determine health status based on metrics
        let healthStatus = HealthStatus.HEALTHY;
        
        if (healthReport.metrics.cpu > 90 || healthReport.metrics.memory > 90) {
          healthStatus = HealthStatus.DEGRADED;
        }
        
        if (healthReport.metrics.errors > 10 || healthReport.metrics.cpu > 95) {
          healthStatus = HealthStatus.UNHEALTHY;
        }

        // In production, this would store the health report in the database
        // For now, we just acknowledge it
        fastify.log.info({
          nodeId: healthReport.nodeId,
          version: healthReport.version,
          healthStatus,
          metrics: healthReport.metrics,
        }, 'Health report received');

        return reply.code(200).send({
          acknowledged: true,
          healthStatus,
        });
      } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send({
          error: 'Internal server error',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  /**
   * GET /api/v1/rollout/status
   * Get current rollout status
   */
  fastify.get(
    '/api/v1/rollout/status',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const versionBeacon = getVersionBeaconService();
        
        // Get current versions for all tiers
        const allVersion = await versionBeacon.getCurrentVersion(NodeTier.ALL);
        const rolloutConfig = await versionBeacon.getRolloutConfig();
        
        // Get current rollout phase
        const currentPhase = cohortService.getCurrentPhase(
          allVersion.timestamp,
          rolloutConfig
        );

        // In production, these would come from the database
        const nodesUpdated = 0;
        const totalNodes = 0;
        const successRate = 0;
        const errors = 0;

        return reply.code(200).send({
          currentVersion: allVersion.versionString,
          targetVersion: allVersion.versionString,
          rolloutPhase: currentPhase,
          nodesUpdated,
          totalNodes,
          successRate,
          errors,
        });
      } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send({
          error: 'Internal server error',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  /**
   * GET /api/v1/health-check
   * Simple health check endpoint
   */
  fastify.get('/api/v1/health-check', async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.code(200).send({
      status: 'healthy',
      timestamp: new Date().toISOString(),
    });
  });
}
