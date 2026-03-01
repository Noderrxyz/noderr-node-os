/**
 * VersionBeacon Client
 *
 * Queries the VersionBeacon smart contract (deployed on Base Sepolia) for
 * version information.  The ABI below matches the actual deployed contract
 * at 0xA5Be5522bb3C748ea262a2A7d877d00AE387FDa6 (UUPS proxy).
 *
 * Source of truth: noderr-protocol/contracts/contracts/core/VersionBeacon.sol
 *
 * @module version-beacon
 */

import { ethers } from 'ethers';
import { AutoUpdaterConfig } from './config';
import { logger } from './logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Version information returned by the VersionBeacon contract.
 */
export interface VersionInfo {
  /** Semantic version string, e.g. "1.0.0" */
  version: string;

  /** Docker image tag, e.g. "v1.0.0" */
  imageTag: string;

  /** Keccak-256 hash of the configuration bundle */
  configHash: string;

  /** Block timestamp when the version was published */
  deployedAt: number;

  /** Address that published this version */
  publisher: string;

  /** Whether this version is currently active */
  isActive: boolean;

  /** Whether this version was created via emergency rollback */
  isEmergencyRollback: boolean;

  /** Rollout configuration */
  rollout: {
    canaryPercentage: number;
    cohortPercentage: number;
    cohortDelayHours: number;
    isActive: boolean;
  };
}

// ---------------------------------------------------------------------------
// ABI — must match the deployed VersionBeacon proxy exactly
// ---------------------------------------------------------------------------

/**
 * Minimal ABI for the VersionBeacon contract.
 *
 * The contract is a UUPS-upgradeable AccessControl contract with:
 *   - currentVersionId(NodeTier) → uint256
 *   - versions(uint256) → Version struct (auto-generated getter)
 *   - rolloutConfig() → RolloutConfig struct (auto-generated getter)
 *   - getCurrentVersion(NodeTier) → Version struct (explicit view)
 *   - nextVersionId() → uint256
 *
 * We use `currentVersionId` + `versions` instead of `getCurrentVersion`
 * because the latter reverts when no version is set (require(versionId > 0)),
 * whereas `currentVersionId` returns 0 gracefully.
 */
const VERSION_BEACON_ABI = [
  // currentVersionId(NodeTier tier) → uint256
  // Auto-generated getter for the mapping(NodeTier => uint256)
  'function currentVersionId(uint8 tier) view returns (uint256)',

  // versions(uint256 versionId) → tuple
  // Auto-generated getter for the mapping(uint256 => Version)
  // Solidity auto-getters flatten structs into positional returns:
  //   (string versionString, string dockerImageTag, bytes32 configHash,
  //    uint256 timestamp, address publisher, bool isActive, bool isEmergencyRollback)
  'function versions(uint256 versionId) view returns (string versionString, string dockerImageTag, bytes32 configHash, uint256 timestamp, address publisher, bool isActive, bool isEmergencyRollback)',

  // rolloutConfig() → tuple
  // Auto-generated getter for the RolloutConfig struct:
  //   (uint8 canaryPercentage, uint8 cohortPercentage, uint256 cohortDelayHours, bool isActive)
  'function rolloutConfig() view returns (uint8 canaryPercentage, uint8 cohortPercentage, uint256 cohortDelayHours, bool isActive)',

  // nextVersionId() → uint256
  'function nextVersionId() view returns (uint256)',
];

// ---------------------------------------------------------------------------
// Tier enum — matches VersionBeacon.sol NodeTier exactly
// ---------------------------------------------------------------------------

export enum Tier {
  VALIDATOR = 0,
  GUARDIAN  = 1,
  ORACLE    = 2,
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class VersionBeaconClient {
  private provider: ethers.JsonRpcProvider;
  private contract: ethers.Contract;
  private config: AutoUpdaterConfig;

  constructor(config: AutoUpdaterConfig) {
    this.config = config;
    this.provider = new ethers.JsonRpcProvider(config.rpcEndpoint);
    this.contract = new ethers.Contract(
      config.versionBeaconAddress,
      VERSION_BEACON_ABI,
      this.provider,
    );

    logger.info('VersionBeacon client initialized', {
      address: config.versionBeaconAddress,
      rpc: config.rpcEndpoint,
    });
  }

  /**
   * Convert tier string to enum value.
   */
  private getTierValue(tier: 'VALIDATOR' | 'GUARDIAN' | 'ORACLE'): Tier {
    return Tier[tier];
  }

  /**
   * Get the current version for the configured node tier.
   *
   * Uses `currentVersionId(tier)` (returns 0 when unset) followed by
   * `versions(id)` to fetch the full struct, avoiding the revert that
   * `getCurrentVersion(tier)` triggers when no version exists.
   */
  async getCurrentVersion(): Promise<VersionInfo | null> {
    try {
      const tierValue = this.getTierValue(this.config.nodeTier);

      logger.debug('Querying current version', {
        tier: this.config.nodeTier,
        tierValue,
      });

      // Step 1: Get the current version ID for this tier (0 = none)
      const versionId: bigint = await this.contract.currentVersionId(tierValue);

      if (versionId === 0n) {
        logger.info('No version deployed for tier', { tier: this.config.nodeTier });
        return null;
      }

      // Step 2: Fetch the full Version struct
      const [
        versionString,
        dockerImageTag,
        configHash,
        timestamp,
        publisher,
        isActive,
        isEmergencyRollback,
      ] = await this.contract.versions(versionId);

      // Step 3: Fetch rollout config
      const [
        canaryPercentage,
        cohortPercentage,
        cohortDelayHours,
        rolloutIsActive,
      ] = await this.contract.rolloutConfig();

      const versionInfo: VersionInfo = {
        version: versionString,
        imageTag: dockerImageTag,
        configHash,
        deployedAt: Number(timestamp),
        publisher,
        isActive,
        isEmergencyRollback,
        rollout: {
          canaryPercentage: Number(canaryPercentage),
          cohortPercentage: Number(cohortPercentage),
          cohortDelayHours: Number(cohortDelayHours),
          isActive: rolloutIsActive,
        },
      };

      logger.info('Retrieved current version', {
        version: versionInfo.version,
        imageTag: versionInfo.imageTag,
        isActive: versionInfo.isActive,
        deployedAt: versionInfo.deployedAt,
      });

      return versionInfo;
    } catch (error) {
      logger.error('Failed to get current version', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Check whether a newer version is available and active.
   */
  async isNewVersionAvailable(currentVersion: string): Promise<boolean> {
    const latestVersion = await this.getCurrentVersion();

    if (!latestVersion) {
      return false;
    }

    if (!latestVersion.isActive) {
      logger.debug('Latest version is not active', { version: latestVersion.version });
      return false;
    }

    const isNewer = this.compareVersions(latestVersion.version, currentVersion) > 0;

    logger.info('Version comparison', {
      current: currentVersion,
      latest: latestVersion.version,
      isNewer,
    });

    return isNewer;
  }

  /**
   * Compare two semantic version strings.
   *
   * @returns  1 if v1 > v2, -1 if v1 < v2, 0 if equal
   */
  private compareVersions(v1: string, v2: string): number {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);

    for (let i = 0; i < 3; i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;
      if (p1 > p2) return 1;
      if (p1 < p2) return -1;
    }

    return 0;
  }

  /**
   * Get the current rollout configuration.
   */
  async getRolloutConfig(): Promise<VersionInfo['rollout']> {
    try {
      const [
        canaryPercentage,
        cohortPercentage,
        cohortDelayHours,
        isActive,
      ] = await this.contract.rolloutConfig();

      return {
        canaryPercentage: Number(canaryPercentage),
        cohortPercentage: Number(cohortPercentage),
        cohortDelayHours: Number(cohortDelayHours),
        isActive,
      };
    } catch (error) {
      logger.error('Failed to get rollout config', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Test connectivity to the VersionBeacon contract.
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.contract.nextVersionId();
      logger.info('VersionBeacon connection test successful');
      return true;
    } catch (error) {
      logger.error('VersionBeacon connection test failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }
}
