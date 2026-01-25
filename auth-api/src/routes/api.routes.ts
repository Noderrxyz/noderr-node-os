/**
 * API Routes for Authentication Service
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authService } from '../services/auth.service';
import { verifyStaking } from '../services/staking-verification.service';
import {
  InstallConfigRequest,
  RegisterNodeRequest,
  VerifyNodeRequest,
  AttestationData,
  SystemInfo,
} from '../models/types';

// Request schemas
const InstallConfigRequestSchema = z.object({
  installToken: z.string().min(1),
});

const AttestationDataSchema = z.object({
  quote: z.string(),
  signature: z.string(),
  pcrValues: z.record(z.string()),
  timestamp: z.string(),
});

const SystemInfoSchema = z.object({
  hostname: z.string(),
  cpuCores: z.number().min(1),
  memoryGB: z.number().min(1),
  diskGB: z.number().min(1),
  osVersion: z.string().optional(),
  kernelVersion: z.string().optional(),
  gpuHardwareId: z.string().optional(), // For Oracle nodes
});

const RegisterNodeRequestSchema = z.object({
  installToken: z.string().min(1),
  publicKey: z.string().min(1),
  attestation: AttestationDataSchema,
  systemInfo: SystemInfoSchema,
  walletAddress: z.string().min(1),
  nodeTier: z.enum(['micro', 'validator', 'guardian', 'oracle']),
});

const VerifyNodeRequestSchema = z.object({
  nodeId: z.string().min(1),
  apiKey: z.string().min(1),
  challenge: z.string().min(1),
});

const HeartbeatRequestSchema = z.object({
  nodeId: z.string().min(1),
  jwtToken: z.string().min(1),
  metrics: z.object({
    uptime: z.number().min(0),
    cpu: z.number().min(0).max(100),
    memory: z.number().min(0).max(100),
    disk: z.number().min(0).max(100).optional(),
    network: z.object({
      rx: z.number().min(0),
      tx: z.number().min(0),
    }).optional(),
    version: z.string(),
  }),
});
type HeartbeatRequest = z.infer<typeof HeartbeatRequestSchema>;

export async function registerApiRoutes(fastify: FastifyInstance) {
  /**
   * POST /api/v1/install/config
   * Get installation configuration using install token
   */
  fastify.post<{
    Body: InstallConfigRequest;
  }>(
    '/api/v1/install/config',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        // Validate request
        const validatedRequest = InstallConfigRequestSchema.parse(request.body);

        // Get install config
        const config = await authService.getInstallConfig(validatedRequest.installToken);

        return reply.code(200).send(config);
      } catch (error) {
        fastify.log.error(error);

        if (error instanceof Error) {
          if (error.message.includes('Invalid') || error.message.includes('expired') || error.message.includes('used')) {
            return reply.code(400).send({
              error: 'Bad Request',
              message: error.message,
            });
          }
        }

        return reply.code(500).send({
          error: 'Internal server error',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  /**
   * POST /api/v1/auth/register
   * Register a new node with TPM-attested public key
   */
  fastify.post<{
    Body: RegisterNodeRequest;
  }>(
    '/api/v1/auth/register',

    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        // Validate request
        const validatedRequest = RegisterNodeRequestSchema.parse(request.body);

        // Verify GPU requirement for Oracle nodes
        if (validatedRequest.nodeTier === 'oracle') {
          if (!validatedRequest.systemInfo.gpuHardwareId) {
            return reply.code(400).send({
              error: 'Missing GPU',
              message: 'Oracle nodes require a GPU. No GPU hardware ID provided.',
            });
          }
        }

        // Verify staking requirements
        const stakingResult = await verifyStaking(
          validatedRequest.walletAddress,
          'temp-node-id', // Will be replaced with actual nodeId after registration
          validatedRequest.nodeTier,
          process.env.RPC_URL || '',
          process.env.NODR_TOKEN_ADDRESS || ''
        );

        if (!stakingResult.isValid) {
          return reply.code(403).send({
            error: 'Insufficient Stake',
            message: stakingResult.message,
            requiredStake: stakingResult.requiredStake,
            currentStake: stakingResult.currentStake,
          });
        }

        // Register node
        const response = await authService.registerNode(validatedRequest as any);

        fastify.log.info({
          nodeId: response.nodeId,
          tier: validatedRequest.systemInfo,
        }, 'Node registered successfully');

        return reply.code(201).send(response);
      } catch (error) {
        fastify.log.error(error);

        if (error instanceof Error) {
          if (
            error.message.includes('Invalid') ||
            error.message.includes('expired') ||
            error.message.includes('used') ||
            error.message.includes('verification failed') ||
            error.message.includes('already registered')
          ) {
            return reply.code(400).send({
              error: 'Bad Request',
              message: error.message,
            });
          }
        }

        return reply.code(500).send({
          error: 'Internal server error',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  /**
   * POST /api/v1/auth/verify
   * Verify node credentials and get fresh JWT
   */
  fastify.post<{
    Body: VerifyNodeRequest;
  }>(
    '/api/v1/auth/verify',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        // Validate request
        const validatedRequest = VerifyNodeRequestSchema.parse(request.body);

        // Verify node
        const jwtToken = await authService.verifyNode(
          validatedRequest.nodeId,
          validatedRequest.apiKey,
          validatedRequest.challenge
        );

        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 24);

        return reply.code(200).send({
          jwtToken,
          expiresAt: expiresAt.toISOString(),
          status: 'verified',
        });
      } catch (error) {
        fastify.log.error(error);

        if (error instanceof Error) {
          if (
            error.message.includes('not found') ||
            error.message.includes('Invalid') ||
            error.message.includes('expired') ||
            error.message.includes('status')
          ) {
            return reply.code(401).send({
              error: 'Unauthorized',
              message: error.message,
            });
          }
        }

        return reply.code(500).send({
          error: 'Internal server error',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  /**
   * POST /api/v1/auth/heartbeat
   * Node heartbeat to maintain active status
   */
  fastify.post<{
    Body: HeartbeatRequest;
  }>(
    '/api/v1/auth/heartbeat',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        // Validate request
        const validatedRequest = HeartbeatRequestSchema.parse(request.body);

        // Process heartbeat
        await authService.processHeartbeat(
          validatedRequest.nodeId,
          validatedRequest.jwtToken,
          validatedRequest.metrics!
        );

        fastify.log.debug({
          nodeId: validatedRequest.nodeId,
          metrics: validatedRequest.metrics,
        }, 'Heartbeat received');

        return reply.code(200).send({
          acknowledged: true,
          shouldUpdate: false,
          targetVersion: validatedRequest.metrics.version,
        });
      } catch (error) {
        fastify.log.error(error);

        if (error instanceof Error) {
          if (error.message.includes('not found') || error.message.includes('status')) {
            return reply.code(401).send({
              error: 'Unauthorized',
              message: error.message,
            });
          }
        }

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
