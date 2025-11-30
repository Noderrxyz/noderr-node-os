import { EventEmitter } from 'events';
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
export declare class MultiSig extends EventEmitter {
    private logger;
    private config;
    private signers;
    private proposals;
    private expiryCheckInterval?;
    constructor(config: MultiSigConfig);
    /**
     * Create a new proposal requiring multi-sig approval
     */
    createProposal(type: string, payload: any, description: string, createdBy: string, requiredSignatures?: number): Proposal;
    /**
     * Sign a proposal
     */
    signProposal(proposalId: string, signerId: string, privateKey: string, message?: string): Promise<void>;
    /**
     * Execute an approved proposal
     */
    executeProposal(proposalId: string, executor: (proposal: Proposal) => Promise<any>): Promise<any>;
    /**
     * Reject a proposal
     */
    rejectProposal(proposalId: string, reason: string): void;
    /**
     * Get all proposals
     */
    getProposals(filter?: {
        status?: string;
        type?: string;
    }): Proposal[];
    /**
     * Get proposal by ID
     */
    getProposal(proposalId: string): Proposal | undefined;
    /**
     * Add a new signer
     */
    addSigner(signer: Signer): void;
    /**
     * Remove a signer
     */
    removeSigner(signerId: string): void;
    /**
     * Update required signatures
     */
    updateRequiredSignatures(newRequired: number): void;
    private generateProposalId;
    private getProposalSignatureData;
    private generateSignature;
    private verifySignature;
    private startExpiryChecker;
    /**
     * Cleanup
     */
    destroy(): void;
}
//# sourceMappingURL=MultiSig.d.ts.map