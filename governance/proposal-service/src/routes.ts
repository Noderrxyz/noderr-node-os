/**
 * API Routes
 * 
 * Fastify routes for proposal service
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ProposalService } from './service';
import { VersionUpdateParams, EmergencyRollbackParams } from '@noderr/multisig-client';

export async function registerRoutes(
  fastify: FastifyInstance,
  service: ProposalService
) {
  /**
   * Health check
   */
  fastify.get('/health', async (request, reply) => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  /**
   * Get multi-sig wallet info
   */
  fastify.get('/api/wallet/info', async (request, reply) => {
    try {
      const info = await service.getWalletInfo();
      return info;
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  /**
   * Create version update proposal
   */
  fastify.post<{
    Body: VersionUpdateParams & { createdBy: string };
  }>('/api/proposals/version-update', async (request, reply) => {
    try {
      const { createdBy, ...params } = request.body;

      if (!createdBy) {
        return reply.status(400).send({ error: 'createdBy is required' });
      }

      const result = await service.createVersionUpdateProposal(params, createdBy);
      return result;
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  /**
   * Create emergency rollback proposal
   */
  fastify.post<{
    Body: EmergencyRollbackParams & { createdBy: string };
  }>('/api/proposals/emergency-rollback', async (request, reply) => {
    try {
      const { createdBy, ...params } = request.body;

      if (!createdBy) {
        return reply.status(400).send({ error: 'createdBy is required' });
      }

      const result = await service.createEmergencyRollbackProposal(params, createdBy);
      return result;
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  /**
   * Get proposal by ID
   */
  fastify.get<{
    Params: { id: string };
  }>('/api/proposals/:id', async (request, reply) => {
    try {
      const proposal = await service.getProposal(request.params.id);
      
      if (!proposal) {
        return reply.status(404).send({ error: 'Proposal not found' });
      }

      return proposal;
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  /**
   * Get all pending proposals
   */
  fastify.get('/api/proposals/pending', async (request, reply) => {
    try {
      const proposals = await service.getPendingProposals();
      return proposals;
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  /**
   * Get all proposals
   */
  fastify.get<{
    Querystring: { limit?: string };
  }>('/api/proposals', async (request, reply) => {
    try {
      const limit = request.query.limit ? parseInt(request.query.limit) : 50;
      const proposals = await service.getAllProposals(limit);
      return proposals;
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  /**
   * Sign a proposal
   */
  fastify.post<{
    Params: { id: string };
  }>('/api/proposals/:id/sign', async (request, reply) => {
    try {
      const result = await service.signProposal(request.params.id);
      return result;
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  /**
   * Execute a proposal
   */
  fastify.post<{
    Params: { id: string };
  }>('/api/proposals/:id/execute', async (request, reply) => {
    try {
      const result = await service.executeProposal(request.params.id);
      return result;
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });

  /**
   * Cancel a proposal
   */
  fastify.delete<{
    Params: { id: string };
  }>('/api/proposals/:id', async (request, reply) => {
    try {
      await service.cancelProposal(request.params.id);
      return { success: true };
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });
}
