/**
 * Admin Routes - Token Generation and Typeform Webhook
 *
 * These endpoints are secured by ADMIN_API_KEY and are used by:
 * 1. The Typeform webhook to automatically generate install tokens on purchase
 * 2. Manual admin operations for token management
 *
 * P0-7: Provides the missing user onboarding flow
 * P1-7: Includes email notification via Resend (optional, degrades gracefully)
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { tokenService } from '../services/token.service';
import { NodeTier, OperatingSystem } from '../models/types';
import { createHmac } from 'crypto';

// ============================================================================
// Schemas
// ============================================================================

const GenerateTokenSchema = z.object({
  applicationId: z.string().min(1),
  tier: z.enum(['ORACLE', 'GUARDIAN', 'VALIDATOR']),
  os: z.enum(['linux', 'windows']),
  email: z.string().email().optional(),
  name: z.string().optional(),
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Must be a valid Ethereum address').optional(),
  rpcEndpoint: z.string().url('Must be a valid URL').optional(),
});

// ============================================================================
// Middleware
// ============================================================================

/**
 * Verify the request is from an authorized admin.
 * Uses a shared ADMIN_API_KEY for simplicity.
 */
function verifyAdminKey(request: FastifyRequest, reply: FastifyReply): boolean {
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey) {
    reply.code(503).send({ error: 'Admin API not configured' });
    return false;
  }

  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    reply.code(401).send({ error: 'Missing or invalid Authorization header' });
    return false;
  }

  const providedKey = authHeader.slice(7);
  // Constant-time comparison to prevent timing attacks
  const expected = Buffer.from(adminKey);
  const provided = Buffer.from(providedKey);
  if (expected.length !== provided.length || !require('crypto').timingSafeEqual(expected, provided)) {
    reply.code(403).send({ error: 'Invalid admin API key' });
    return false;
  }

  return true;
}

/**
 * Verify Typeform webhook signature (HMAC SHA-256)
 */
function verifyTypeformSignature(payload: string, signature: string): boolean {
  const secret = process.env.TYPEFORM_WEBHOOK_SECRET;
  if (!secret) {
    // If no secret is configured, skip verification (log warning)
    console.warn('[Admin] TYPEFORM_WEBHOOK_SECRET not set — skipping signature verification');
    return true;
  }

  const expectedSig = createHmac('sha256', secret)
    .update(payload)
    .digest('base64');

  return `sha256=${expectedSig}` === signature;
}

// ============================================================================
// Email Notification (optional — degrades gracefully)
// ============================================================================

async function sendInstallTokenEmail(
  email: string,
  name: string,
  token: string,
  tier: string,
  os: string
): Promise<boolean> {
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    console.warn('[Admin] RESEND_API_KEY not set — skipping email notification');
    return false;
  }

  const fromEmail = process.env.EMAIL_FROM || 'noreply@noderr.xyz';

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify({
        from: fromEmail,
        to: email,
        subject: `Your Noderr ${tier} Node Install Token`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
            <h1 style="color: #1a1a2e; margin-bottom: 24px;">Welcome to Noderr, ${name || 'Node Operator'}!</h1>
            <p style="color: #333; font-size: 16px; line-height: 1.6;">
              Your <strong>${tier}</strong> node license has been activated. Use the install token below to deploy your node.
            </p>
            <div style="background: #f4f4f8; border-radius: 8px; padding: 20px; margin: 24px 0; border-left: 4px solid #4f46e5;">
              <p style="margin: 0 0 8px 0; font-size: 14px; color: #666;">Install Token:</p>
              <code style="font-size: 14px; color: #1a1a2e; word-break: break-all; background: #fff; padding: 8px 12px; border-radius: 4px; display: block;">${token}</code>
            </div>
            <h2 style="color: #1a1a2e; margin-top: 32px;">Quick Start (${os === 'linux' ? 'Linux' : 'Windows'})</h2>
            ${os === 'linux' ? `
            <pre style="background: #1a1a2e; color: #e0e0e0; padding: 16px; border-radius: 8px; overflow-x: auto; font-size: 13px;">curl -fsSL https://raw.githubusercontent.com/Noderrxyz/noderr-node-os/master/installation-scripts/linux/install.sh | sudo bash -s -- "${token}"</pre>
            <p style="color: #888; font-size: 13px; margin-top: 8px;">Your wallet address and RPC endpoint are embedded in the token — no additional configuration needed.</p>
            ` : `
            <pre style="background: #1a1a2e; color: #e0e0e0; padding: 16px; border-radius: 8px; overflow-x: auto; font-size: 13px;">irm https://raw.githubusercontent.com/Noderrxyz/noderr-node-os/master/installation-scripts/windows/install.ps1 | iex -InstallToken "${token}"</pre>
            <p style="color: #888; font-size: 13px; margin-top: 8px;">Your wallet address and RPC endpoint are embedded in the token — no additional configuration needed.</p>
            `}
            <p style="color: #666; font-size: 14px; margin-top: 24px;">
              This token expires in 7 days. If you need help, visit <a href="https://docs.noderr.xyz" style="color: #4f46e5;">docs.noderr.xyz</a> or join our Discord.
            </p>
            <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 32px 0;" />
            <p style="color: #999; font-size: 12px;">Noderr Network — Decentralized Intelligence Infrastructure</p>
          </div>
        `,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Admin] Failed to send email: ${response.status} ${errorText}`);
      return false;
    }

    console.log(`[Admin] Install token email sent to ${email}`);
    return true;
  } catch (error) {
    console.error('[Admin] Email sending error:', error);
    return false;
  }
}

// ============================================================================
// Routes
// ============================================================================

export async function registerAdminRoutes(fastify: FastifyInstance) {
  /**
   * POST /api/v1/admin/tokens
   * Generate a new install token (admin-only)
   */
  fastify.post(
    '/api/v1/admin/tokens',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!verifyAdminKey(request, reply)) return;

      try {
        const body = GenerateTokenSchema.parse(request.body);

        const token = await tokenService.generateInstallToken(
          body.applicationId,
          body.tier as NodeTier,
          body.os as OperatingSystem,
          body.walletAddress || '',
          body.rpcEndpoint || ''
        );

        // Send email notification if email is provided
        let emailSent = false;
        if (body.email) {
          emailSent = await sendInstallTokenEmail(
            body.email,
            body.name || '',
            token,
            body.tier,
            body.os
          );
        }

        fastify.log.info({
          applicationId: body.applicationId,
          tier: body.tier,
          os: body.os,
          emailSent,
        }, 'Install token generated');

        return reply.code(201).send({
          token,
          tier: body.tier,
          os: body.os,
          expiresIn: '7 days',
          emailSent,
        });
      } catch (error) {
        fastify.log.error(error);
        return reply.code(400).send({
          error: 'Failed to generate token',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  /**
   * GET /api/v1/admin/tokens/:applicationId
   * List tokens for an application (admin-only)
   */
  fastify.get(
    '/api/v1/admin/tokens/:applicationId',
    async (request: FastifyRequest<{ Params: { applicationId: string } }>, reply: FastifyReply) => {
      if (!verifyAdminKey(request, reply)) return;

      try {
        const { applicationId } = request.params as { applicationId: string };
        const tokens = await tokenService.listTokensForApplication(applicationId);

        return reply.code(200).send({ tokens });
      } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send({
          error: 'Failed to list tokens',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  /**
   * DELETE /api/v1/admin/tokens/:token
   * Revoke an install token (admin-only)
   */
  fastify.delete(
    '/api/v1/admin/tokens/:token',
    async (request: FastifyRequest<{ Params: { token: string } }>, reply: FastifyReply) => {
      if (!verifyAdminKey(request, reply)) return;

      try {
        const { token } = request.params as { token: string };
        await tokenService.revokeToken(token);

        return reply.code(200).send({ revoked: true });
      } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send({
          error: 'Failed to revoke token',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  /**
   * POST /api/v1/admin/tokens/cleanup
   * Clean up expired tokens (admin-only, can be called by a cron job)
   */
  fastify.post(
    '/api/v1/admin/tokens/cleanup',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!verifyAdminKey(request, reply)) return;

      try {
        const count = await tokenService.cleanupExpiredTokens();
        return reply.code(200).send({ cleaned: count });
      } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send({
          error: 'Failed to cleanup tokens',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );

  /**
   * POST /api/v1/webhooks/typeform
   * Typeform webhook handler — automatically generates install tokens on purchase
   *
   * Flow:
   * 1. User completes Typeform purchase
   * 2. Typeform sends webhook to this endpoint
   * 3. We extract email, tier, OS from the form answers
   * 4. Generate install token
   * 5. Send email with install token and instructions
   */
  fastify.post(
    '/api/v1/webhooks/typeform',
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Verify Typeform signature
      const rawBody = JSON.stringify(request.body);
      const signature = request.headers['typeform-signature'] as string || '';
      if (!verifyTypeformSignature(rawBody, signature)) {
        return reply.code(403).send({ error: 'Invalid webhook signature' });
      }

      try {
        const payload = request.body as any;

        // Validate it's a form_response event
        if (!payload || payload.event_type !== 'form_response' || !payload.form_response) {
          return reply.code(400).send({ error: 'Invalid webhook payload' });
        }

        const answers = payload.form_response.answers || [];
        const responseToken = payload.form_response.token;

        // Extract fields from Typeform answers
        // These field refs must match the Typeform form configuration
        let email = '';
        let name = '';
        let tier = 'VALIDATOR';
        let os = 'linux';
        let walletAddress = '';
        let rpcEndpoint = '';

        for (const answer of answers) {
          const ref = answer.field?.ref?.toLowerCase() || '';

          if (ref.includes('email') || answer.type === 'email') {
            email = answer.email || answer.text || '';
          }
          if (ref.includes('name') || ref.includes('full_name')) {
            name = answer.text || '';
          }
          if (ref.includes('tier') || ref.includes('node_type') || ref.includes('license')) {
            const choice = (answer.choice?.label || answer.text || '').toUpperCase();
            if (choice.includes('ORACLE')) tier = 'ORACLE';
            else if (choice.includes('GUARDIAN')) tier = 'GUARDIAN';
            else tier = 'VALIDATOR';
          }
          if (ref.includes('os') || ref.includes('operating_system') || ref.includes('platform')) {
            const choice = (answer.choice?.label || answer.text || '').toLowerCase();
            os = choice.includes('windows') ? 'windows' : 'linux';
          }
          // Operator's personal wallet address (required for staking/rewards)
          // Use exact ref match to avoid matching 'node_wallet_address' (obsolete hot wallet field)
          if (ref === 'wallet_address' || ref === 'eth_address' || ref === 'ethereum_wallet_address') {
            walletAddress = (answer.text || answer.url || '').trim();
          }
          // Operator's own RPC endpoint (required for decentralization)
          if (ref === 'rpc_endpoint' || ref === 'rpc_url' || ref === 'rpc') {
            rpcEndpoint = (answer.text || answer.url || '').trim();
          }
        }

        if (!email) {
          fastify.log.warn({ responseToken }, 'Typeform webhook missing email — cannot send token');
          return reply.code(200).send({ status: 'skipped', reason: 'no email found' });
        }

        // Validate required decentralization fields
        if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
          fastify.log.warn({ responseToken, walletAddress }, 'Typeform webhook missing or invalid wallet address');
          return reply.code(200).send({ status: 'skipped', reason: 'missing or invalid wallet address' });
        }

        if (!rpcEndpoint || !rpcEndpoint.startsWith('https://')) {
          fastify.log.warn({ responseToken, rpcEndpoint }, 'Typeform webhook missing or invalid RPC endpoint');
          return reply.code(200).send({ status: 'skipped', reason: 'missing or invalid RPC endpoint' });
        }

        // Use the Typeform response token as the application ID for traceability
        const applicationId = `typeform_${responseToken}`;

        // Generate install token (includes operator's wallet and RPC for decentralization)
        const installToken = await tokenService.generateInstallToken(
          applicationId,
          tier as NodeTier,
          os as OperatingSystem,
          walletAddress,
          rpcEndpoint
        );

        // Send email with install token
        const emailSent = await sendInstallTokenEmail(email, name, installToken, tier, os);

        fastify.log.info({
          applicationId,
          email,
          tier,
          os,
          walletAddress,
          rpcEndpoint: rpcEndpoint ? '***' : 'missing',
          emailSent,
        }, 'Typeform webhook processed — install token generated');

        return reply.code(200).send({
          status: 'processed',
          applicationId,
          emailSent,
        });
      } catch (error) {
        fastify.log.error(error, 'Typeform webhook processing failed');
        // Return 200 to prevent Typeform from retrying (we log the error)
        return reply.code(200).send({
          status: 'error',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );
}
