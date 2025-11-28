/**
 * Proposal Service
 * 
 * Service for creating and managing governance proposals
 */

import {
  MultiSigClient,
  ProposalEncoder,
  VersionUpdateParams,
  EmergencyRollbackParams,
  Proposal,
  ProposalType
} from '@noderr/multisig-client';
import { Database, GovernanceProposal } from './database';
import pino from 'pino';

const logger = pino({ name: 'proposal-service' });

export interface ProposalServiceConfig {
  multiSigAddress: string;
  versionBeaconAddress: string;
  rpcUrl: string;
  chainId: number;
  signerPrivateKey?: string;
}

export class ProposalService {
  private multiSigClient: MultiSigClient;
  private proposalEncoder: ProposalEncoder;
  private database: Database;
  private config: ProposalServiceConfig;

  constructor(config: ProposalServiceConfig) {
    this.config = config;
    
    this.multiSigClient = new MultiSigClient({
      walletAddress: config.multiSigAddress,
      rpcUrl: config.rpcUrl,
      chainId: config.chainId,
      signerPrivateKey: config.signerPrivateKey
    });

    this.proposalEncoder = new ProposalEncoder(config.versionBeaconAddress);
    this.database = new Database();
  }

  /**
   * Create a version update proposal
   */
  async createVersionUpdateProposal(
    params: VersionUpdateParams,
    createdBy: string
  ): Promise<{ proposalId: string; transactionId: number }> {
    logger.info({ params }, 'Creating version update proposal');

    // Encode proposal
    const proposal = this.proposalEncoder.encodeVersionUpdate(params);

    // Submit to multi-sig
    const { transactionId, txHash } = await this.multiSigClient.submitTransaction(proposal);

    // Store in database
    await this.database.createProposal({
      proposal_id: txHash,
      proposal_type: ProposalType.VERSION_UPDATE,
      version_id: params.versionId,
      tier: params.tier,
      ipfs_hash: params.ipfsHash,
      created_by: createdBy,
      status: 'pending',
      signatures: [],
      metadata: {
        transactionId,
        semver: params.semver,
        rolloutConfig: params.rolloutConfig
      }
    });

    logger.info({ proposalId: txHash, transactionId }, 'Version update proposal created');

    return { proposalId: txHash, transactionId };
  }

  /**
   * Create an emergency rollback proposal
   */
  async createEmergencyRollbackProposal(
    params: EmergencyRollbackParams,
    createdBy: string
  ): Promise<{ proposalId: string; transactionId: number }> {
    logger.info({ params }, 'Creating emergency rollback proposal');

    // Encode proposal
    const proposal = this.proposalEncoder.encodeEmergencyRollback(params);

    // Submit to multi-sig
    const { transactionId, txHash } = await this.multiSigClient.submitTransaction(proposal);

    // Store in database
    await this.database.createProposal({
      proposal_id: txHash,
      proposal_type: ProposalType.EMERGENCY_ROLLBACK,
      tier: params.tier,
      created_by: createdBy,
      status: 'pending',
      signatures: [],
      metadata: {
        transactionId,
        reason: params.reason
      }
    });

    logger.info({ proposalId: txHash, transactionId }, 'Emergency rollback proposal created');

    return { proposalId: txHash, transactionId };
  }

  /**
   * Sign a proposal
   */
  async signProposal(proposalId: string): Promise<{ success: boolean; canExecute: boolean }> {
    logger.info({ proposalId }, 'Signing proposal');

    // Get proposal from database
    const dbProposal = await this.database.getProposal(proposalId);
    if (!dbProposal) {
      throw new Error(`Proposal ${proposalId} not found`);
    }

    const transactionId = dbProposal.metadata.transactionId;

    // Check if already signed
    const hasConfirmed = await this.multiSigClient.hasConfirmed(transactionId);
    if (hasConfirmed) {
      logger.warn({ proposalId, transactionId }, 'Already signed this proposal');
      return { success: false, canExecute: false };
    }

    // Sign transaction
    await this.multiSigClient.confirmTransaction(transactionId);

    // Update database
    const signerAddress = this.multiSigClient.getSignerAddress();
    if (signerAddress) {
      await this.database.addSignature(proposalId, signerAddress);
    }

    // Check if can execute
    const canExecute = await this.multiSigClient.canExecute(transactionId);

    logger.info({ proposalId, transactionId, canExecute }, 'Proposal signed');

    return { success: true, canExecute };
  }

  /**
   * Execute a proposal
   */
  async executeProposal(proposalId: string): Promise<{ txHash: string }> {
    logger.info({ proposalId }, 'Executing proposal');

    // Get proposal from database
    const dbProposal = await this.database.getProposal(proposalId);
    if (!dbProposal) {
      throw new Error(`Proposal ${proposalId} not found`);
    }

    const transactionId = dbProposal.metadata.transactionId;

    // Execute transaction
    const receipt = await this.multiSigClient.executeTransaction(transactionId);

    // Update database
    await this.database.markExecuted(proposalId, receipt.hash);

    logger.info({ proposalId, txHash: receipt.hash }, 'Proposal executed');

    return { txHash: receipt.hash };
  }

  /**
   * Cancel a proposal
   */
  async cancelProposal(proposalId: string): Promise<void> {
    logger.info({ proposalId }, 'Cancelling proposal');

    // Get proposal from database
    const dbProposal = await this.database.getProposal(proposalId);
    if (!dbProposal) {
      throw new Error(`Proposal ${proposalId} not found`);
    }

    const transactionId = dbProposal.metadata.transactionId;

    // Revoke confirmation
    await this.multiSigClient.revokeConfirmation(transactionId);

    // Update database
    await this.database.markCancelled(proposalId);

    logger.info({ proposalId }, 'Proposal cancelled');
  }

  /**
   * Get proposal details
   */
  async getProposal(proposalId: string): Promise<any> {
    // Get from database
    const dbProposal = await this.database.getProposal(proposalId);
    if (!dbProposal) {
      return null;
    }

    // Get from multi-sig
    const transactionId = dbProposal.metadata.transactionId;
    const multiSigTx = await this.multiSigClient.getTransaction(transactionId);

    return {
      ...dbProposal,
      confirmations: multiSigTx.confirmations,
      required: multiSigTx.required,
      signers: multiSigTx.signers,
      canExecute: multiSigTx.confirmations >= multiSigTx.required && !multiSigTx.executed
    };
  }

  /**
   * Get all pending proposals
   */
  async getPendingProposals(): Promise<any[]> {
    const proposals = await this.database.getPendingProposals();

    return Promise.all(
      proposals.map(async (proposal) => {
        const transactionId = proposal.metadata.transactionId;
        const multiSigTx = await this.multiSigClient.getTransaction(transactionId);

        return {
          ...proposal,
          confirmations: multiSigTx.confirmations,
          required: multiSigTx.required,
          signers: multiSigTx.signers,
          canExecute: multiSigTx.confirmations >= multiSigTx.required && !multiSigTx.executed
        };
      })
    );
  }

  /**
   * Get all proposals
   */
  async getAllProposals(limit: number = 50): Promise<GovernanceProposal[]> {
    return await this.database.getAllProposals(limit);
  }

  /**
   * Get multi-sig wallet info
   */
  async getWalletInfo() {
    return await this.multiSigClient.getWalletInfo();
  }
}
