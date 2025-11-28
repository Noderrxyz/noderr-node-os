/**
 * Multi-Signature Wallet Client Types
 * 
 * Type definitions for interacting with multi-sig wallets
 */

export interface MultiSigConfig {
  /** Multi-sig wallet contract address */
  walletAddress: string;
  
  /** RPC URL for blockchain connection */
  rpcUrl: string;
  
  /** Chain ID */
  chainId: number;
  
  /** Signer private key (optional, for signing transactions) */
  signerPrivateKey?: string;
}

export interface Transaction {
  /** Transaction ID in the multi-sig wallet */
  id: number;
  
  /** Destination address */
  to: string;
  
  /** Transaction value in wei */
  value: string;
  
  /** Transaction data (encoded function call) */
  data: string;
  
  /** Whether transaction has been executed */
  executed: boolean;
  
  /** Number of confirmations received */
  confirmations: number;
  
  /** Required number of confirmations */
  required: number;
  
  /** List of signers who have confirmed */
  signers: string[];
  
  /** Transaction creation timestamp */
  createdAt?: number;
  
  /** Transaction execution timestamp */
  executedAt?: number;
}

export interface Signer {
  /** Signer ethereum address */
  address: string;
  
  /** Signer name/label */
  name?: string;
  
  /** Whether signer is active */
  active: boolean;
}

export interface MultiSigInfo {
  /** Multi-sig wallet address */
  address: string;
  
  /** List of authorized signers */
  signers: Signer[];
  
  /** Number of required confirmations */
  required: number;
  
  /** Total number of signers */
  total: number;
  
  /** Current nonce */
  nonce: number;
}

export interface TransactionReceipt {
  /** Transaction hash */
  hash: string;
  
  /** Block number */
  blockNumber: number;
  
  /** Gas used */
  gasUsed: string;
  
  /** Transaction status (1 = success, 0 = failure) */
  status: number;
  
  /** Transaction logs */
  logs: any[];
}

export interface VersionUpdateParams {
  /** Version ID to publish */
  versionId: number;
  
  /** Semantic version string */
  semver: string;
  
  /** Node tier (ALL, ORACLE, GUARDIAN) */
  tier: string;
  
  /** IPFS hash of version metadata */
  ipfsHash: string;
  
  /** Rollout configuration */
  rolloutConfig?: {
    canaryPercentage: number;
    cohortPercentage: number;
    delayBetweenCohorts: number;
  };
}

export interface EmergencyRollbackParams {
  /** Tier to rollback */
  tier: string;
  
  /** Reason for rollback */
  reason: string;
}

export enum ProposalType {
  VERSION_UPDATE = 'version_update',
  EMERGENCY_ROLLBACK = 'emergency_rollback',
  PARAMETER_CHANGE = 'parameter_change',
  CUSTOM = 'custom'
}

export interface Proposal {
  /** Proposal type */
  type: ProposalType;
  
  /** Proposal description */
  description: string;
  
  /** Target contract address */
  target: string;
  
  /** Encoded function call data */
  data: string;
  
  /** Transaction value (usually 0) */
  value?: string;
  
  /** Proposal metadata */
  metadata?: Record<string, any>;
}
