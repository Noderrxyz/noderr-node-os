"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.MultiSig = void 0;
const events_1 = require("events");
const crypto = __importStar(require("crypto"));
const createLogger = (name) => ({
    info: (message, meta) => console.log(`[${name}] INFO:`, message, meta || ''),
    error: (message, error) => console.error(`[${name}] ERROR:`, message, error || ''),
    debug: (message, meta) => console.debug(`[${name}] DEBUG:`, message, meta || ''),
    warn: (message, meta) => console.warn(`[${name}] WARN:`, message, meta || '')
});
class MultiSig extends events_1.EventEmitter {
    logger;
    config;
    signers = new Map();
    proposals = new Map();
    expiryCheckInterval;
    constructor(config) {
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
    createProposal(type, payload, description, createdBy, requiredSignatures) {
        const proposalId = this.generateProposalId();
        const proposal = {
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
    async signProposal(proposalId, signerId, privateKey, message) {
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
    async executeProposal(proposalId, executor) {
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
        }
        catch (error) {
            this.logger.error(`Failed to execute proposal ${proposalId}`, error);
            proposal.status = 'REJECTED';
            throw error;
        }
    }
    /**
     * Reject a proposal
     */
    rejectProposal(proposalId, reason) {
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
    getProposals(filter) {
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
    getProposal(proposalId) {
        return this.proposals.get(proposalId);
    }
    /**
     * Add a new signer
     */
    addSigner(signer) {
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
    removeSigner(signerId) {
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
    updateRequiredSignatures(newRequired) {
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
    generateProposalId() {
        return `proposal-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
    }
    getProposalSignatureData(proposal) {
        return JSON.stringify({
            id: proposal.id,
            type: proposal.type,
            payload: proposal.payload,
            createdAt: proposal.createdAt.toISOString()
        });
    }
    generateSignature(data, privateKey) {
        const sign = crypto.createSign('SHA256');
        sign.update(data);
        sign.end();
        return sign.sign(privateKey, 'hex');
    }
    verifySignature(data, signature, publicKey) {
        try {
            const verify = crypto.createVerify('SHA256');
            verify.update(data);
            verify.end();
            return verify.verify(publicKey, signature, 'hex');
        }
        catch (error) {
            this.logger.error('Signature verification failed', error);
            return false;
        }
    }
    startExpiryChecker() {
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
    destroy() {
        if (this.expiryCheckInterval) {
            clearInterval(this.expiryCheckInterval);
        }
        this.removeAllListeners();
        this.logger.info('MultiSig destroyed');
    }
}
exports.MultiSig = MultiSig;
//# sourceMappingURL=MultiSig.js.map