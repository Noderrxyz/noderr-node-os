import { Logger } from './Logger';
import { EventEmitter } from 'events';
import * as crypto from 'crypto';

const logger = new Logger('MultiSig');
const createLogger = (name: string) => ({
  info: (message: string, meta?: any) => logger.info(`[${name}] INFO:`, message, meta || ''),
  error: (message: string, error?: any) => logger.error(`[${name}] ERROR:`, message, error || ''),
  debug: (message: string, meta?: any) => logger.debug(`[${name}] DEBUG:`, message, meta || ''),
  warn: (message: string, meta?: any) => logger.warn(`[${name}] WARN:`, message, meta || '')
});

export interface Signer {
  id: string;
  name: string;
  publicKey: string;
  permissions: string[];
  active: boolean;
}

export interface Proposal {
  id: string;
  type: string;
  payload: any;
  description: string;
  createdBy: string;
  createdAt: Date;
  expiresAt: Date;
  requiredSignatures: number;
  signatures: Map<string, Signature>;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'EXECUTED';
  executedAt?: Date;
  executionResult?: any;
}

export interface Signature {
  signerId: string;
  signature: string;
  timestamp: Date;
  message?: string;
}

export interface MultiSigConfig {
  requiredSignatures: number;
  proposalExpiryMs: number;
  signers: Signer[];
}

export class MultiSig extends EventEmitter {
  private logger: ReturnType<typeof createLogger>;
  private config: MultiSigConfig;
  private signers: Map<string, Signer> = new Map();
  private proposals: Map<string, Proposal> = new Map();
  private expiryCheckInterval?: NodeJS.Timeout;
  
  constructor(config: MultiSigConfig) {
    super();
    this.logger = createLogger('MultiSig');
    this.config = config;
    
    // Initialize signers
    config.signers.forEach(signer => {
      this.signers.set(signer.id, signer);
    });
    
    // Start expiry checker
    this.startExpiryChecker();
    
    this.logger.info('MultiSig initialized', {
      requiredSignatures: config.requiredSignatures,
      totalSigners: this.signers.size
    });
  }
  
  /**
   * Create a new proposal requiring multi-sig approval
   */
  public createProposal(
    type: string,
    payload: any,
    description: string,
    createdBy: string,
    requiredSignatures?: number
  ): Proposal {
    const proposalId = this.generateProposalId();
    
    const proposal: Proposal = {
      id: proposalId,
      type,
      payload,
      description,
      createdBy,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + this.config.proposalExpiryMs),
      requiredSignatures: requiredSignatures || this.config.requiredSignatures,
      signatures: new Map(),
      status: 'PENDING'
    };
    
    this.proposals.set(proposalId, proposal);
    
    this.logger.info('Proposal created', {
      proposalId,
      type,
      description,
      requiredSignatures: proposal.requiredSignatures
    });
    
    this.emit('proposal-created', proposal);
    
    return proposal;
  }
  
  /**
   * Sign a proposal
   */
  public async signProposal(
    proposalId: string,
    signerId: string,
    privateKey: string,
    message?: string
  ): Promise<void> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new Error(`Proposal ${proposalId} not found`);
    }
    
    if (proposal.status !== 'PENDING') {
      throw new Error(`Proposal ${proposalId} is not pending (status: ${proposal.status})`);
    }
    
    const signer = this.signers.get(signerId);
    if (!signer || !signer.active) {
      throw new Error(`Signer ${signerId} not found or inactive`);
    }
    
    // Check if already signed
    if (proposal.signatures.has(signerId)) {
      throw new Error(`Signer ${signerId} has already signed proposal ${proposalId}`);
    }
    
    // Generate signature
    const dataToSign = this.getProposalSignatureData(proposal);
    const signature = this.generateSignature(dataToSign, privateKey);
    
    // Verify signature matches public key
    if (!this.verifySignature(dataToSign, signature, signer.publicKey)) {
      throw new Error('Invalid signature - does not match public key');
    }
    
    // Add signature
    proposal.signatures.set(signerId, {
      signerId,
      signature,
      timestamp: new Date(),
      message
    });
    
    this.logger.info('Proposal signed', {
      proposalId,
      signerId,
      signaturesCount: proposal.signatures.size,
      requiredSignatures: proposal.requiredSignatures
    });
    
    // Check if we have enough signatures
    if (proposal.signatures.size >= proposal.requiredSignatures) {
      proposal.status = 'APPROVED';
      this.logger.info('Proposal approved', { proposalId });
      this.emit('proposal-approved', proposal);
    }
    
    this.emit('proposal-signed', {
      proposal,
      signature: proposal.signatures.get(signerId)
    });
  }
  
  /**
   * Execute an approved proposal
   */
  public async executeProposal(
    proposalId: string,
    executor: (proposal: Proposal) => Promise<any>
  ): Promise<any> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new Error(`Proposal ${proposalId} not found`);
    }
    
    if (proposal.status !== 'APPROVED') {
      throw new Error(`Proposal ${proposalId} is not approved (status: ${proposal.status})`);
    }
    
    try {
      this.logger.info('Executing proposal', { proposalId, type: proposal.type });
      
      const result = await executor(proposal);
      
      proposal.status = 'EXECUTED';
      proposal.executedAt = new Date();
      proposal.executionResult = result;
      
      this.logger.info('Proposal executed successfully', { proposalId });
      this.emit('proposal-executed', { proposal, result });
      
      return result;
      
    } catch (error: any) {
      this.logger.error(`Failed to execute proposal ${proposalId}`, error);
      proposal.status = 'REJECTED';
      throw error;
    }
  }
  
  /**
   * Reject a proposal
   */
  public rejectProposal(proposalId: string, reason: string): void {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new Error(`Proposal ${proposalId} not found`);
    }
    
    if (proposal.status !== 'PENDING') {
      throw new Error(`Can only reject pending proposals`);
    }
    
    proposal.status = 'REJECTED';
    
    this.logger.info('Proposal rejected', { proposalId, reason });
    this.emit('proposal-rejected', { proposal, reason });
  }
  
  /**
   * Get all proposals
   */
  public getProposals(filter?: { status?: string; type?: string }): Proposal[] {
    let proposals = Array.from(this.proposals.values());
    
    if (filter?.status) {
      proposals = proposals.filter(p => p.status === filter.status);
    }
    
    if (filter?.type) {
      proposals = proposals.filter(p => p.type === filter.type);
    }
    
    return proposals;
  }
  
  /**
   * Get proposal by ID
   */
  public getProposal(proposalId: string): Proposal | undefined {
    return this.proposals.get(proposalId);
  }
  
  /**
   * Add a new signer
   */
  public addSigner(signer: Signer): void {
    if (this.signers.has(signer.id)) {
      throw new Error(`Signer ${signer.id} already exists`);
    }
    
    this.signers.set(signer.id, signer);
    this.logger.info('Signer added', { signerId: signer.id, name: signer.name });
    this.emit('signer-added', signer);
  }
  
  /**
   * Remove a signer
   */
  public removeSigner(signerId: string): void {
    const signer = this.signers.get(signerId);
    if (!signer) {
      throw new Error(`Signer ${signerId} not found`);
    }
    
    signer.active = false;
    this.logger.info('Signer deactivated', { signerId });
    this.emit('signer-removed', signer);
  }
  
  /**
   * Update required signatures
   */
  public updateRequiredSignatures(newRequired: number): void {
    const oldRequired = this.config.requiredSignatures;
    this.config.requiredSignatures = newRequired;
    
    this.logger.info('Required signatures updated', {
      oldRequired,
      newRequired
    });
    
    this.emit('config-updated', {
      requiredSignatures: newRequired
    });
  }
  
  // Private methods
  
  private generateProposalId(): string {
    return `proposal-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
  }
  
  private getProposalSignatureData(proposal: Proposal): string {
    return JSON.stringify({
      id: proposal.id,
      type: proposal.type,
      payload: proposal.payload,
      createdAt: proposal.createdAt.toISOString()
    });
  }
  
  private generateSignature(data: string, privateKey: string): string {
    const sign = crypto.createSign('SHA256');
    sign.update(data);
    sign.end();
    return sign.sign(privateKey, 'hex');
  }
  
  private verifySignature(data: string, signature: string, publicKey: string): boolean {
    try {
      const verify = crypto.createVerify('SHA256');
      verify.update(data);
      verify.end();
      return verify.verify(publicKey, signature, 'hex');
    } catch (error) {
      this.logger.error('Signature verification failed', error);
      return false;
    }
  }
  
  private startExpiryChecker(): void {
    this.expiryCheckInterval = setInterval(() => {
      const now = Date.now();
      
      for (const [proposalId, proposal] of this.proposals) {
        if (proposal.status === 'PENDING' && proposal.expiresAt.getTime() < now) {
          proposal.status = 'EXPIRED';
          this.logger.info('Proposal expired', { proposalId });
          this.emit('proposal-expired', proposal);
        }
      }
    }, 60000); // Check every minute
  }
  
  /**
   * Cleanup
   */
  public destroy(): void {
    if (this.expiryCheckInterval) {
      clearInterval(this.expiryCheckInterval);
    }
    this.removeAllListeners();
    this.logger.info('MultiSig destroyed');
  }
} 