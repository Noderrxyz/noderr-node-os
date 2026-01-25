/**
 * Database Service - Supabase Integration
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  InstallToken,
  NodeIdentity,
  NodeCredentials,
  NodeStatus,
} from '../models/types';

export class DatabaseService {
  private supabase: SupabaseClient;

  constructor(supabaseUrl: string, supabaseKey: string) {
    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  /**
   * Get install token by token string
   */
  async getInstallToken(token: string): Promise<InstallToken | null> {
    const { data, error } = await this.supabase
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
      tier: data.tier,
      os: data.os,
      isUsed: data.is_used,
      createdAt: new Date(data.created_at),
      expiresAt: new Date(data.expires_at),
    };
  }

  /**
   * Mark install token as used
   */
  async markTokenAsUsed(tokenId: string): Promise<void> {
    await this.supabase
      .from('install_tokens')
      .update({ is_used: true })
      .eq('id', tokenId);
  }

  /**
   * Create node identity
   */
  async createNodeIdentity(identity: Omit<NodeIdentity, 'id' | 'createdAt' | 'updatedAt'>): Promise<NodeIdentity> {
    const { data, error } = await this.supabase
      .from('node_identities')
      .insert({
        node_id: identity.nodeId,
        public_key: identity.publicKey,
        attestation_data: identity.attestationData,
        tier: identity.tier,
        os: identity.os,
        install_token_id: identity.installTokenId,
        status: identity.status,
        last_seen: identity.lastSeen,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create node identity: ${error.message}`);
    }

    return {
      id: data.id,
      nodeId: data.node_id,
      publicKey: data.public_key,
      attestationData: data.attestation_data,
      tier: data.tier,
      os: data.os,
      installTokenId: data.install_token_id,
      status: data.status,
      lastSeen: data.last_seen ? new Date(data.last_seen) : undefined,
      createdAt: new Date(data.created_at),
      updatedAt: new Date(data.updated_at),
    };
  }

  /**
   * Get node identity by node ID
   */
  async getNodeIdentity(nodeId: string): Promise<NodeIdentity | null> {
    const { data, error } = await this.supabase
      .from('node_identities')
      .select('*')
      .eq('node_id', nodeId)
      .single();

    if (error || !data) {
      return null;
    }

    return {
      id: data.id,
      nodeId: data.node_id,
      publicKey: data.public_key,
      attestationData: data.attestation_data,
      tier: data.tier,
      os: data.os,
      installTokenId: data.install_token_id,
      status: data.status,
      lastSeen: data.last_seen ? new Date(data.last_seen) : undefined,
      createdAt: new Date(data.created_at),
      updatedAt: new Date(data.updated_at),
    };
  }

  /**
   * Update node last seen timestamp
   */
  async updateNodeLastSeen(nodeId: string): Promise<void> {
    await this.supabase
      .from('node_identities')
      .update({ last_seen: new Date().toISOString() })
      .eq('node_id', nodeId);
  }

  /**
   * Update node status
   */
  async updateNodeStatus(nodeId: string, status: NodeStatus): Promise<void> {
    await this.supabase
      .from('node_identities')
      .update({ status })
      .eq('node_id', nodeId);
  }

  /**
   * Create node credentials
   */
  async createNodeCredentials(
    credentials: Omit<NodeCredentials, 'id' | 'createdAt'>
  ): Promise<NodeCredentials> {
    const { data, error } = await this.supabase
      .from('node_credentials')
      .insert({
        node_id: credentials.nodeId,
        api_key_hash: credentials.apiKeyHash,
        jwt_secret: credentials.jwtSecret,
        expires_at: credentials.expiresAt.toISOString(),
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create node credentials: ${error.message}`);
    }

    return {
      id: data.id,
      nodeId: data.node_id,
      apiKeyHash: data.api_key_hash,
      jwtSecret: data.jwt_secret,
      createdAt: new Date(data.created_at),
      expiresAt: new Date(data.expires_at),
    };
  }

  /**
   * Store node metrics from heartbeat
   */
  async storeNodeMetrics(nodeId: string, metrics: {
    uptime?: number;
    cpu?: number;
    memory?: number;
    disk?: number;
    network?: { rx?: number; tx?: number };
    version?: string;
  }): Promise<void> {
    await this.supabase
      .from('node_telemetry')
      .insert({
        node_id: nodeId,
        uptime: metrics.uptime,
        cpu_usage: metrics.cpu,
        memory_usage: metrics.memory,
        disk_usage: metrics.disk || 0,
        network_rx: metrics.network?.rx || 0,
        network_tx: metrics.network?.tx || 0,
        version: metrics.version,
        timestamp: new Date().toISOString(),
      });
  }

  /**
   * Get node credentials by node ID
   */
  async getNodeCredentials(nodeId: string): Promise<NodeCredentials | null> {
    const { data, error } = await this.supabase
      .from('node_credentials')
      .select('*')
      .eq('node_id', nodeId)
      .single();

    if (error || !data) {
      return null;
    }

    return {
      id: data.id,
      nodeId: data.node_id,
      apiKeyHash: data.api_key_hash,
      jwtSecret: data.jwt_secret,
      createdAt: new Date(data.created_at),
      expiresAt: new Date(data.expires_at),
    };
  }

  /**
   * Update node with NFT token ID
   * Called after NFT is minted for the node
   */
  async updateNodeTokenId(nodeId: string, tokenId: number): Promise<void> {
    const { error } = await this.supabase
      .from('node_identities')
      .update({ nft_token_id: tokenId })
      .eq('node_id', nodeId);

    if (error) {
      throw new Error(`Failed to update node token ID: ${error.message}`);
    }
  }

  /**
   * Get node by NFT token ID
   */
  async getNodeByTokenId(tokenId: number): Promise<NodeIdentity | null> {
    const { data, error } = await this.supabase
      .from('node_identities')
      .select('*')
      .eq('nft_token_id', tokenId)
      .single();

    if (error || !data) {
      return null;
    }

    return {
      id: data.id,
      nodeId: data.node_id,
      publicKey: data.public_key,
      attestationData: data.attestation_data,
      tier: data.tier,
      os: data.os,
      installTokenId: data.install_token_id,
      status: data.status,
      lastSeen: data.last_seen ? new Date(data.last_seen) : undefined,
      createdAt: new Date(data.created_at),
      updatedAt: new Date(data.updated_at),
    };
  }
}

// Singleton instance
let databaseService: DatabaseService | null = null;

export function initializeDatabaseService(
  supabaseUrl: string,
  supabaseKey: string
): DatabaseService {
  databaseService = new DatabaseService(supabaseUrl, supabaseKey);
  return databaseService;
}

export function getDatabaseService(): DatabaseService {
  if (!databaseService) {
    throw new Error('DatabaseService not initialized');
  }
  return databaseService;
}
