/**
 * Database Client
 * 
 * Supabase client for proposal storage
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface GovernanceProposal {
  id: number;
  proposal_id: string;
  proposal_type: string;
  version_id?: number;
  tier?: string;
  ipfs_hash?: string;
  created_by: string;
  created_at: string;
  executed_at?: string;
  cancelled_at?: string;
  status: string;
  signatures: any[];
  metadata: any;
}

export class Database {
  private client: SupabaseClient;

  constructor() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be set');
    }

    this.client = createClient(supabaseUrl, supabaseKey);
  }

  /**
   * Create a new proposal
   */
  async createProposal(proposal: Omit<GovernanceProposal, 'id' | 'created_at'>): Promise<GovernanceProposal> {
    const { data, error } = await this.client
      .from('governance_proposals')
      .insert(proposal)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create proposal: ${error.message}`);
    }

    return data;
  }

  /**
   * Get proposal by ID
   */
  async getProposal(proposalId: string): Promise<GovernanceProposal | null> {
    const { data, error } = await this.client
      .from('governance_proposals')
      .select('*')
      .eq('proposal_id', proposalId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null; // Not found
      }
      throw new Error(`Failed to get proposal: ${error.message}`);
    }

    return data;
  }

  /**
   * Get all pending proposals
   */
  async getPendingProposals(): Promise<GovernanceProposal[]> {
    const { data, error } = await this.client
      .from('governance_proposals')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to get pending proposals: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Get all proposals
   */
  async getAllProposals(limit: number = 50): Promise<GovernanceProposal[]> {
    const { data, error } = await this.client
      .from('governance_proposals')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`Failed to get proposals: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Add signature to proposal
   */
  async addSignature(proposalId: string, signer: string): Promise<void> {
    // Get current proposal
    const proposal = await this.getProposal(proposalId);
    if (!proposal) {
      throw new Error(`Proposal ${proposalId} not found`);
    }

    // Add signature
    const signatures = proposal.signatures || [];
    if (!signatures.some((sig: any) => sig.signer === signer)) {
      signatures.push({
        signer,
        signedAt: new Date().toISOString()
      });
    }

    // Update proposal
    const { error } = await this.client
      .from('governance_proposals')
      .update({ signatures })
      .eq('proposal_id', proposalId);

    if (error) {
      throw new Error(`Failed to add signature: ${error.message}`);
    }
  }

  /**
   * Mark proposal as executed
   */
  async markExecuted(proposalId: string, txHash: string): Promise<void> {
    const { error } = await this.client
      .from('governance_proposals')
      .update({
        status: 'executed',
        executed_at: new Date().toISOString(),
        metadata: { txHash }
      })
      .eq('proposal_id', proposalId);

    if (error) {
      throw new Error(`Failed to mark proposal as executed: ${error.message}`);
    }
  }

  /**
   * Mark proposal as cancelled
   */
  async markCancelled(proposalId: string): Promise<void> {
    const { error } = await this.client
      .from('governance_proposals')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString()
      })
      .eq('proposal_id', proposalId);

    if (error) {
      throw new Error(`Failed to mark proposal as cancelled: ${error.message}`);
    }
  }

  /**
   * Update proposal status
   */
  async updateStatus(proposalId: string, status: string): Promise<void> {
    const { error } = await this.client
      .from('governance_proposals')
      .update({ status })
      .eq('proposal_id', proposalId);

    if (error) {
      throw new Error(`Failed to update proposal status: ${error.message}`);
    }
  }
}
