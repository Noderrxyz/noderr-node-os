/**
 * VersionBeacon Contract Integration Service
 * Queries the VersionBeacon smart contract for version information
 */

import { Contract, JsonRpcProvider } from 'ethers';
import { NodeTier, Version, RolloutConfig } from '../models/types';

/**
 * ABI matching the deployed VersionBeacon proxy at:
 *   0xA5Be5522bb3C748ea262a2A7d877d00AE387FDa6 (Base Sepolia)
 *
 * Source of truth: noderr-protocol/contracts/contracts/core/VersionBeacon.sol
 */
const VERSION_BEACON_ABI = [
  // Auto-generated getter for mapping(NodeTier => uint256) — returns 0 if unset
  'function currentVersionId(uint8 tier) view returns (uint256)',
  // Auto-generated getter for mapping(uint256 => Version) — flattened struct
  'function versions(uint256 versionId) view returns (string versionString, string dockerImageTag, bytes32 configHash, uint256 timestamp, address publisher, bool isActive, bool isEmergencyRollback)',
  // Auto-generated getter for RolloutConfig struct
  'function rolloutConfig() view returns (uint8 canaryPercentage, uint8 cohortPercentage, uint256 cohortDelayHours, bool isActive)',
  // State variable
  'function nextVersionId() view returns (uint256)',
  // Explicit view — reverts if no version set for tier
  'function getCurrentVersion(uint8 tier) view returns (tuple(string versionString, string dockerImageTag, bytes32 configHash, uint256 timestamp, address publisher, bool isActive, bool isEmergencyRollback))',
  // Explicit view — reverts if invalid ID
  'function getVersion(uint256 versionId) view returns (tuple(string versionString, string dockerImageTag, bytes32 configHash, uint256 timestamp, address publisher, bool isActive, bool isEmergencyRollback))',
  // Explicit view
  'function getRolloutConfig() view returns (tuple(uint8 canaryPercentage, uint8 cohortPercentage, uint256 cohortDelayHours, bool isActive))',
];

export class VersionBeaconService {
  private contract: Contract;
  private provider: JsonRpcProvider;

  constructor(
    contractAddress: string,
    rpcUrl: string
  ) {
    this.provider = new JsonRpcProvider(rpcUrl);
    this.contract = new Contract(contractAddress, VERSION_BEACON_ABI, this.provider);
  }

  /**
   * Get current version ID for a specific tier
   * @param tier Node tier
   * @returns Version ID
   */
  async getCurrentVersionId(tier: NodeTier): Promise<number> {
    const tierIndex = this.getTierIndex(tier);
    // Use currentVersionId (returns 0 if unset) instead of getCurrentVersion
    // (which reverts if no version is set for the tier)
    const versionId = await this.contract.currentVersionId(tierIndex);
    return Number(versionId);
  }

  /**
   * Get version details by ID
   * @param versionId Version ID
   * @returns Version details
   */
  async getVersion(versionId: number): Promise<Version> {
    const versionData = await this.contract.getVersion(versionId);
    
    return {
      versionId,
      versionString: versionData.versionString,
      dockerImageTag: versionData.dockerImageTag,
      configHash: versionData.configHash,
      timestamp: Number(versionData.timestamp),
      publisher: versionData.publisher,
      isActive: versionData.isActive,
      isEmergencyRollback: versionData.isEmergencyRollback,
    };
  }

  /**
   * Get current version details for a tier
   * @param tier Node tier
   * @returns Version details
   */
  async getCurrentVersion(tier: NodeTier): Promise<Version | null> {
    const versionId = await this.getCurrentVersionId(tier);
    if (versionId === 0) {
      return null;
    }
    return this.getVersion(versionId);
  }

  /**
   * Get rollout configuration
   * @returns Rollout configuration
   */
  async getRolloutConfig(): Promise<RolloutConfig> {
    const config = await this.contract.getRolloutConfig();
    
    return {
      canaryPercentage: Number(config.canaryPercentage),
      cohortPercentage: Number(config.cohortPercentage),
      cohortDelayHours: Number(config.cohortDelayHours),
      isActive: config.isActive,
    };
  }

  /**
   * Get next version ID (for tracking)
   * @returns Next version ID
   */
  async getNextVersionId(): Promise<number> {
    const nextId = await this.contract.nextVersionId();
    return Number(nextId);
  }

  /**
   * Convert NodeTier enum to the on-chain uint8 index.
   *
   * Contract enum: VALIDATOR = 0, GUARDIAN = 1, ORACLE = 2
   */
  private getTierIndex(tier: NodeTier): number {
    switch (tier) {
      case NodeTier.VALIDATOR:
        return 0;
      case NodeTier.GUARDIAN:
        return 1;
      case NodeTier.ORACLE:
        return 2;
      case NodeTier.ALL:
        return 0; // Default; caller should iterate for broadcast
      default:
        throw new Error(`Invalid tier: ${tier}`);
    }
  }
}

// Singleton instance (will be initialized with config)
let versionBeaconService: VersionBeaconService | null = null;

export function initializeVersionBeaconService(
  contractAddress: string,
  rpcUrl: string
): VersionBeaconService {
  versionBeaconService = new VersionBeaconService(contractAddress, rpcUrl);
  return versionBeaconService;
}

export function getVersionBeaconService(): VersionBeaconService {
  if (!versionBeaconService) {
    throw new Error('VersionBeaconService not initialized');
  }
  return versionBeaconService;
}
