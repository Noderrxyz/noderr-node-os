import { Pool } from 'pg';
import { UserApplication, NodeType } from '@noderr/types';

/**
 * Service for managing user applications in the database
 */
export class ApplicationService {
  constructor(private db: Pool) {}

  /**
   * Create a new application
   */
  async createApplication(application: UserApplication): Promise<UserApplication> {
    const query = `
      INSERT INTO users.applications (
        typeform_response_id,
        email,
        wallet_address,
        requested_node_type,
        stake_amount,
        experience,
        motivation,
        status,
        submitted_at,
        metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, to_timestamp($9 / 1000.0), $10)
      RETURNING 
        id,
        typeform_response_id as "typeformResponseId",
        email,
        wallet_address as "walletAddress",
        requested_node_type as "requestedNodeType",
        stake_amount as "stakeAmount",
        experience,
        motivation,
        status,
        EXTRACT(EPOCH FROM submitted_at) * 1000 as "submittedAt",
        EXTRACT(EPOCH FROM reviewed_at) * 1000 as "reviewedAt",
        reviewed_by as "reviewedBy",
        rejection_reason as "rejectionReason",
        metadata
    `;

    try {
      const result = await this.db.query(query, [
        application.typeformResponseId,
        application.email,
        application.walletAddress,
        application.requestedNodeType,
        application.stakeAmount,
        application.experience,
        application.motivation,
        application.status,
        application.submittedAt,
        JSON.stringify(application.metadata || {})
      ]);

      return result.rows[0];
    } catch (error: any) {
      // Check for duplicate
      if (error.code === '23505') {
        throw new Error('Application already exists for this Typeform response');
      }
      throw error;
    }
  }

  /**
   * Get application by ID
   */
  async getApplication(id: string): Promise<UserApplication | null> {
    const query = `
      SELECT 
        id,
        typeform_response_id as "typeformResponseId",
        email,
        wallet_address as "walletAddress",
        requested_node_type as "requestedNodeType",
        stake_amount as "stakeAmount",
        experience,
        motivation,
        status,
        EXTRACT(EPOCH FROM submitted_at) * 1000 as "submittedAt",
        EXTRACT(EPOCH FROM reviewed_at) * 1000 as "reviewedAt",
        reviewed_by as "reviewedBy",
        rejection_reason as "rejectionReason",
        metadata
      FROM users.applications
      WHERE id = $1
    `;

    const result = await this.db.query(query, [id]);
    return result.rows[0] || null;
  }

  /**
   * Get application by Typeform response ID
   */
  async getApplicationByTypeformId(typeformResponseId: string): Promise<UserApplication | null> {
    const query = `
      SELECT 
        id,
        typeform_response_id as "typeformResponseId",
        email,
        wallet_address as "walletAddress",
        requested_node_type as "requestedNodeType",
        stake_amount as "stakeAmount",
        experience,
        motivation,
        status,
        EXTRACT(EPOCH FROM submitted_at) * 1000 as "submittedAt",
        EXTRACT(EPOCH FROM reviewed_at) * 1000 as "reviewedAt",
        reviewed_by as "reviewedBy",
        rejection_reason as "rejectionReason",
        metadata
      FROM users.applications
      WHERE typeform_response_id = $1
    `;

    const result = await this.db.query(query, [typeformResponseId]);
    return result.rows[0] || null;
  }

  /**
   * List applications with filters
   */
  async listApplications(filters?: {
    status?: 'PENDING' | 'APPROVED' | 'REJECTED';
    nodeType?: NodeType;
    limit?: number;
    offset?: number;
  }): Promise<UserApplication[]> {
    let query = `
      SELECT 
        id,
        typeform_response_id as "typeformResponseId",
        email,
        wallet_address as "walletAddress",
        requested_node_type as "requestedNodeType",
        stake_amount as "stakeAmount",
        experience,
        motivation,
        status,
        EXTRACT(EPOCH FROM submitted_at) * 1000 as "submittedAt",
        EXTRACT(EPOCH FROM reviewed_at) * 1000 as "reviewedAt",
        reviewed_by as "reviewedBy",
        rejection_reason as "rejectionReason",
        metadata
      FROM users.applications
      WHERE 1=1
    `;

    const params: any[] = [];
    let paramIndex = 1;

    if (filters?.status) {
      query += ` AND status = $${paramIndex++}`;
      params.push(filters.status);
    }

    if (filters?.nodeType) {
      query += ` AND requested_node_type = $${paramIndex++}`;
      params.push(filters.nodeType);
    }

    query += ` ORDER BY submitted_at DESC`;

    if (filters?.limit) {
      query += ` LIMIT $${paramIndex++}`;
      params.push(filters.limit);
    }

    if (filters?.offset) {
      query += ` OFFSET $${paramIndex++}`;
      params.push(filters.offset);
    }

    const result = await this.db.query(query, params);
    return result.rows;
  }

  /**
   * Approve application
   */
  async approveApplication(
    id: string,
    reviewedBy: string
  ): Promise<UserApplication> {
    const query = `
      UPDATE users.applications
      SET 
        status = 'APPROVED',
        reviewed_at = NOW(),
        reviewed_by = $2
      WHERE id = $1
      RETURNING 
        id,
        typeform_response_id as "typeformResponseId",
        email,
        wallet_address as "walletAddress",
        requested_node_type as "requestedNodeType",
        stake_amount as "stakeAmount",
        experience,
        motivation,
        status,
        EXTRACT(EPOCH FROM submitted_at) * 1000 as "submittedAt",
        EXTRACT(EPOCH FROM reviewed_at) * 1000 as "reviewedAt",
        reviewed_by as "reviewedBy",
        rejection_reason as "rejectionReason",
        metadata
    `;

    const result = await this.db.query(query, [id, reviewedBy]);
    
    if (result.rows.length === 0) {
      throw new Error('Application not found');
    }

    return result.rows[0];
  }

  /**
   * Reject application
   */
  async rejectApplication(
    id: string,
    reviewedBy: string,
    reason: string
  ): Promise<UserApplication> {
    const query = `
      UPDATE users.applications
      SET 
        status = 'REJECTED',
        reviewed_at = NOW(),
        reviewed_by = $2,
        rejection_reason = $3
      WHERE id = $1
      RETURNING 
        id,
        typeform_response_id as "typeformResponseId",
        email,
        wallet_address as "walletAddress",
        requested_node_type as "requestedNodeType",
        stake_amount as "stakeAmount",
        experience,
        motivation,
        status,
        EXTRACT(EPOCH FROM submitted_at) * 1000 as "submittedAt",
        EXTRACT(EPOCH FROM reviewed_at) * 1000 as "reviewedAt",
        reviewed_by as "reviewedBy",
        rejection_reason as "rejectionReason",
        metadata
    `;

    const result = await this.db.query(query, [id, reviewedBy, reason]);
    
    if (result.rows.length === 0) {
      throw new Error('Application not found');
    }

    return result.rows[0];
  }

  /**
   * Get application statistics
   */
  async getStatistics(): Promise<ApplicationStatistics> {
    const query = `
      SELECT 
        COUNT(*) FILTER (WHERE status = 'PENDING') as pending,
        COUNT(*) FILTER (WHERE status = 'APPROVED') as approved,
        COUNT(*) FILTER (WHERE status = 'REJECTED') as rejected,
        COUNT(*) FILTER (WHERE requested_node_type = 'ORACLE') as oracle_requests,
        COUNT(*) FILTER (WHERE requested_node_type = 'GUARDIAN') as guardian_requests,
        COUNT(*) FILTER (WHERE requested_node_type = 'VALIDATOR') as validator_requests,
        COUNT(*) as total
      FROM users.applications
    `;

    const result = await this.db.query(query);
    return result.rows[0];
  }
}

export interface ApplicationStatistics {
  pending: number;
  approved: number;
  rejected: number;
  oracle_requests: number;
  guardian_requests: number;
  validator_requests: number;
  total: number;
}
