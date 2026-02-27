/**
 * Type definitions for Authentication API
 */

export enum NodeTier {
  ALL = 'ALL',
  ORACLE = 'ORACLE',
  GUARDIAN = 'GUARDIAN',
  VALIDATOR = 'VALIDATOR',
}

export enum OperatingSystem {
  LINUX = 'linux',
  WINDOWS = 'windows',
}

export enum NodeStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  REVOKED = 'revoked',
}

export interface InstallToken {
  id: string;
  token: string;
  applicationId: string;
  tier: NodeTier;
  os: OperatingSystem;
  isUsed: boolean;
  createdAt: Date;
  expiresAt: Date;
}

export interface NodeIdentity {
  id: string;
  nodeId: string;
  publicKey: string;
  attestationData: AttestationData;
  tier: NodeTier;
  os: OperatingSystem;
  installTokenId: string;
  status: NodeStatus;
  lastSeen?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface NodeCredentials {
  id: string;
  nodeId: string;
  apiKeyHash: string;
  jwtSecret: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface AttestationData {
  quote: string;
  signature: string;
  pcrValues: Record<string, string>;
  timestamp: string;
}

export interface SystemInfo {
  hostname: string;
  cpuCores: number;
  memoryGB: number;
  diskGB: number;
  osVersion?: string;
  kernelVersion?: string;
  gpuHardwareId?: string; // SHA-256 hash of GPU identifier (for Oracle nodes)
}

export interface InstallConfigRequest {
  installToken: string;
}

export interface InstallConfigResponse {
  nodeId: string;
  tier: NodeTier;
  os: OperatingSystem;
  hardwareRequirements?: {
    minCpuCores: number;
    minRamGb: number;
    minDiskGb: number;
  };
  config: {
    deploymentEngineUrl: string;
    authApiUrl: string;
    dockerRegistry: string;
    telemetryEndpoint: string;
    /** Current latest version string — used by heartbeat-client to detect if an update is needed */
    latestVersion?: string;
    /** Oracle tier only: OracleVerifier contract address on Base Sepolia */
    oracleVerifierAddress?: string;
    /** Oracle tier only: Base Sepolia RPC endpoint for on-chain submissions */
    rpcUrl?: string;
  };
}

export interface RegisterNodeRequest {
  installToken: string;
  publicKey: string;
  attestation: AttestationData;
  systemInfo: SystemInfo;
  walletAddress: string;
  nodeTier: 'micro' | 'validator' | 'guardian' | 'oracle';
}

export interface RegisterNodeResponse {
  nodeId: string;
  apiKey: string;
  jwtToken: string;
  status: string;
}

export interface VerifyNodeRequest {
  nodeId: string;
  apiKey: string;
  challenge: string;
}

export interface VerifyNodeResponse {
  jwtToken: string;
  expiresAt: string;
  status: string;
}

export interface HeartbeatRequest {
  nodeId: string;
  jwtToken: string;
  metrics: {
    uptime: number;
    cpu: number;
    memory: number;
    version: string;
  };
}

export interface HeartbeatResponse {
  acknowledged: boolean;
  shouldUpdate: boolean;
  targetVersion: string;
}
