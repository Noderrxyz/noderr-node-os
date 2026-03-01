/**
 * Installation Token Service
 * Generates and manages installation tokens for node provisioning
 */

import { randomBytes } from 'crypto';
import { getDatabaseService } from './database.service';
import { NodeTier, OperatingSystem } from '../models/types';

const TOKEN_PREFIX = 'ndr_install_';
const TOKEN_LENGTH = 32; // bytes
const TOKEN_EXPIRY_DAYS = 7;

export class TokenService {
  /**
   * Generate a new installation token
   * @param applicationId Application ID from node_applications table
   * @param tier Node tier (ALL/ORACLE/GUARDIAN)
   * @param os Operating system (linux/windows)
   * @param walletAddress Operator's personal wallet address (from Typeform)
   * @param rpcEndpoint Operator's own RPC endpoint (from Typeform, required for decentralization)
   * @returns Installation token string
   */
  async generateInstallToken(
    applicationId: string,
    tier: NodeTier,
    os: OperatingSystem,
    walletAddress: string,
    rpcEndpoint: string
  ): Promise<string> {
    const db = getDatabaseService();

    // Generate cryptographically random token
    const tokenBytes = randomBytes(TOKEN_LENGTH);
    const token = `${TOKEN_PREFIX}${tokenBytes.toString('hex')}`;

    // Calculate expiry date
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + TOKEN_EXPIRY_DAYS);

    // Insert token into database (includes operator wallet + RPC for decentralization)
    const { data, error } = await db['supabase']
      .from('install_tokens')
      .insert({
        token,
        application_id: applicationId,
        tier,
        os,
        wallet_address: walletAddress || null,
        rpc_endpoint: rpcEndpoint || null,
        is_used: false,
        expires_at: expiresAt.toISOString(),
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create installation token: ${error.message}`);
    }

    return token;
  }

  /**
   * Revoke an installation token
   * @param token Token to revoke
   */
  async revokeToken(token: string): Promise<void> {
    const db = getDatabaseService();

    const { error } = await db['supabase']
      .from('install_tokens')
      .update({ is_used: true })
      .eq('token', token);

    if (error) {
      throw new Error(`Failed to revoke token: ${error.message}`);
    }
  }

  /**
   * Get token details
   * @param token Token string
   */
  async getTokenDetails(token: string) {
    const db = getDatabaseService();

    const { data, error } = await db['supabase']
      .from('install_tokens')
      .select('*')
      .eq('token', token)
      .single();

    if (error || !data) {
      return null;
    }

    return {
      id: data.id,
      token: data.token,
      applicationId: data.application_id,
      tier: data.tier as NodeTier,
      os: data.os as OperatingSystem,
      walletAddress: data.wallet_address || '',
      rpcEndpoint: data.rpc_endpoint || '',
      isUsed: data.is_used,
      createdAt: new Date(data.created_at),
      expiresAt: new Date(data.expires_at),
      usedAt: data.used_at ? new Date(data.used_at) : null,
    };
  }

  /**
   * List all tokens for an application
   * @param applicationId Application ID
   */
  async listTokensForApplication(applicationId: string) {
    const db = getDatabaseService();

    const { data, error } = await db['supabase']
      .from('install_tokens')
      .select('*')
      .eq('application_id', applicationId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to list tokens: ${error.message}`);
    }

    return data.map((row) => ({
      id: row.id,
      token: row.token,
      applicationId: row.application_id,
      tier: row.tier as NodeTier,
      os: row.os as OperatingSystem,
      walletAddress: row.wallet_address || '',
      rpcEndpoint: row.rpc_endpoint || '',
      isUsed: row.is_used,
      createdAt: new Date(row.created_at),
      expiresAt: new Date(row.expires_at),
      usedAt: row.used_at ? new Date(row.used_at) : null,
    }));
  }

  /**
   * Clean up expired tokens
   * Should be run periodically (e.g., daily cron job)
   */
  async cleanupExpiredTokens(): Promise<number> {
    const db = getDatabaseService();

    const { data, error } = await db['supabase']
      .from('install_tokens')
      .delete()
      .lt('expires_at', new Date().toISOString())
      .eq('is_used', false)
      .select();

    if (error) {
      throw new Error(`Failed to cleanup expired tokens: ${error.message}`);
    }

    return data?.length || 0;
  }
}

export const tokenService = new TokenService();
