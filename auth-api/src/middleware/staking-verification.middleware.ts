/**
 * Staking Verification Middleware
 * 
 * Fastify middleware to verify staking requirements before allowing node operations.
 * Integrates with staking-verification.service.ts
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyStaking, NodeTier } from '../services/staking-verification.service';

const logger = {
  warn: (msg: string, data?: any) => console.warn('⚠️ ', msg, data),
  info: (msg: string, data?: any) => console.log('ℹ️ ', msg, data),
  error: (msg: string, data?: any) => console.error('❌', msg, data)
};

/**
 * Staking verification middleware
 * 
 * Verifies that the wallet has sufficient stake before allowing node startup.
 * 
 * Usage:
 * app.post('/node/start', { onRequest: [requireStaking('validator')] }, handler);
 * 
 * @param nodeTier - Required node tier
 * @returns Middleware function
 */
export function requireStaking(nodeTier: NodeTier) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Extract wallet address from request
      const walletAddress = (request.body as any)?.walletAddress || (request.query as any)?.walletAddress;
      const nodeId = (request.body as any)?.nodeId || (request.query as any)?.nodeId;

      if (!walletAddress) {
        logger.warn('⚠️ Staking verification: Missing wallet address');
        return reply.status(400).send({
          error: 'Missing wallet address',
          code: 'MISSING_WALLET_ADDRESS',
        });
      }

      if (!nodeId) {
        logger.warn('⚠️ Staking verification: Missing node ID');
        return reply.status(400).send({
          error: 'Missing node ID',
          code: 'MISSING_NODE_ID',
        });
      }

      // Get RPC URL and token address from environment
      const rpcUrl = process.env.RPC_URL || 'https://sepolia.base.org';
      const tokenAddress = process.env.NODR_TOKEN_ADDRESS || '0x0000000000000000000000000000000000000000';

      // Verify staking
      const result = await verifyStaking(walletAddress, nodeId, nodeTier, rpcUrl, tokenAddress);

      // Attach result to request for use in handler
      (request as any).stakingVerification = result;

      // Check if staking is sufficient
      if (!result.isValid) {
        logger.warn('❌ Staking verification failed:', result.message);
        return reply.status(403).send({
          error: result.message,
          code: 'INSUFFICIENT_STAKE',
          details: {
            required: result.requiredStake,
            current: result.currentStake,
            shortfall: (BigInt(result.requiredStake) - BigInt(result.currentStake)).toString(),
          },
        });
      }

      logger.info('✅ Staking verification passed:', {
        walletAddress,
        nodeId,
        nodeTier,
      });
    } catch (error) {
      logger.error('❌ Staking verification middleware error:', error);
      return reply.status(500).send({
        error: 'Staking verification error',
        code: 'STAKING_VERIFICATION_ERROR',
      });
    }
  };
}

/**
 * Optional staking verification middleware
 * 
 * Verifies staking but doesn't block if verification fails.
 * Useful for logging and monitoring.
 * 
 * @param nodeTier - Node tier
 * @returns Middleware function
 */
export function optionalStakingVerification(nodeTier: NodeTier) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const walletAddress = (request.body as any)?.walletAddress || (request.query as any)?.walletAddress;
      const nodeId = (request.body as any)?.nodeId || (request.query as any)?.nodeId;

      if (!walletAddress || !nodeId) {
        return; // Skip if missing required fields
      }

      const rpcUrl = process.env.RPC_URL || 'https://sepolia.base.org';
      const tokenAddress = process.env.NODR_TOKEN_ADDRESS || '0x0000000000000000000000000000000000000000';

      const result = await verifyStaking(walletAddress, nodeId, nodeTier, rpcUrl, tokenAddress);
      (request as any).stakingVerification = result;

      if (!result.isValid) {
        logger.warn('⚠️ Staking verification warning:', result.message);
      }
    } catch (error) {
      logger.error('⚠️ Optional staking verification error:', error);
      // Don't block the request
    }
  };
}
