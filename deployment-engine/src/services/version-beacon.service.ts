/**
 * VersionBeacon Contract Integration Service
 * Queries the VersionBeacon smart contract for version information
 */

import { Contract, JsonRpcProvider } from 'ethers';
import { NodeTier, Version, RolloutConfig } from '../models/types';

const VERSION_BEACON_ABI = [
  'function getCurrentVersion(uint8 tier) external view returns (uint256)',
  'function getVersion(uint256 versionId) external view returns (tuple(string versionString, string dockerImageTag, bytes32 configHash, uint256 timestamp, address publisher, bool isActive, bool isEmergencyRollback))',
  'function getRolloutConfig() external view returns (tuple(uint8 canaryPercentage, uint8 cohortPercentage, uint256 cohortDelayHours, bool isActive))',
  'function nextVersionId() external view returns (uint256)',
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
    const versionId = await this.contract.getCurrentVersion(tierIndex);
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
  async getCurrentVersion(tier: NodeTier): Promise<Version> {
    const versionId = await this.getCurrentVersionId(tier);
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
   * Convert NodeTier enum to contract tier index
   * @param tier Node tier
   * @returns Tier index for contract
   */
  private getTierIndex(tier: NodeTier): number {
    switch (tier) {
      case NodeTier.ALL:
        return 0;
      case NodeTier.ORACLE:
        return 1;
      case NodeTier.GUARDIAN:
        return 2;
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
