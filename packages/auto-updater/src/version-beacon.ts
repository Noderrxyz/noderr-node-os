/**
 * VersionBeacon Client
 * 
 * Queries the VersionBeacon smart contract for version information
 * 
 * @module version-beacon
 */

import { ethers } from 'ethers';
import { AutoUpdaterConfig } from './config';
import { logger } from './logger';

/**
 * Version information from VersionBeacon contract
 */
export interface VersionInfo {
  /**
   * Version string (semver format)
   */
  version: string;
  
  /**
   * Docker image tag
   */
  imageTag: string;
  
  /**
   * Deployment timestamp
   */
  deployedAt: number;
  
  /**
   * Is this version active?
   */
  isActive: boolean;
  
  /**
   * Rollout configuration
   */
  rollout: {
    canaryPercent: number;
    cohortPercent: number;
    delayBetweenCohorts: number;
  };
}

/**
 * VersionBeacon contract ABI (minimal, only what we need)
 */
const VERSION_BEACON_ABI = [
  // Get current version for a tier
  'function getCurrentVersion(uint8 tier) view returns (uint256)',
  
  // Get version details
  'function versions(uint256 versionId) view returns (string versionString, string imageTag, uint256 deployedAt, bool isActive)',
  
  // Get rollout config
  'function rolloutConfig() view returns (uint8 canaryPercent, uint8 cohortPercent, uint256 delayBetweenCohorts)',
  
  // Get next version ID
  'function nextVersionId() view returns (uint256)',
];

/**
 * Tier enum (matches contract)
 */
export enum Tier {
  ALL = 0,
  ORACLE = 1,
  GUARDIAN = 2,
}

/**
 * VersionBeacon client class
 */
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
      this.provider
    );
    
    logger.info('VersionBeacon client initialized', {
      address: config.versionBeaconAddress,
      rpc: config.rpcEndpoint,
    });
  }
  
  /**
   * Get tier enum value from string
   */
  private getTierValue(tier: 'ALL' | 'ORACLE' | 'GUARDIAN'): Tier {
    return Tier[tier];
  }
  
  /**
   * Get current version for the configured node tier
   * 
   * @returns Version information
   */
  async getCurrentVersion(): Promise<VersionInfo | null> {
    try {
      const tierValue = this.getTierValue(this.config.nodeTier);
      
      logger.debug('Querying current version', {
        tier: this.config.nodeTier,
        tierValue,
      });
      
      // Get current version ID for tier
      const versionId = await this.contract.getCurrentVersion(tierValue);
      
      if (versionId === 0n) {
        logger.info('No version deployed for tier', { tier: this.config.nodeTier });
        return null;
      }
      
      // Get version details
      const [versionString, imageTag, deployedAt, isActive] = await this.contract.versions(versionId);
      
      // Get rollout config
      const [canaryPercent, cohortPercent, delayBetweenCohorts] = await this.contract.rolloutConfig();
      
      const versionInfo: VersionInfo = {
        version: versionString,
        imageTag,
        deployedAt: Number(deployedAt),
        isActive,
        rollout: {
          canaryPercent: Number(canaryPercent),
          cohortPercent: Number(cohortPercent),
          delayBetweenCohorts: Number(delayBetweenCohorts),
        },
      };
      
      logger.info('Retrieved current version', versionInfo);
      
      return versionInfo;
    } catch (error) {
      logger.error('Failed to get current version', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
  
  /**
   * Check if a new version is available
   * 
   * @param currentVersion - Currently running version
   * @returns True if new version available
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
   * Compare semantic versions
   * 
   * @param v1 - First version
   * @param v2 - Second version
   * @returns 1 if v1 > v2, -1 if v1 < v2, 0 if equal
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
   * Get rollout configuration
   * 
   * @returns Rollout config
   */
  async getRolloutConfig(): Promise<VersionInfo['rollout']> {
    try {
      const [canaryPercent, cohortPercent, delayBetweenCohorts] = await this.contract.rolloutConfig();
      
      return {
        canaryPercent: Number(canaryPercent),
        cohortPercent: Number(cohortPercent),
        delayBetweenCohorts: Number(delayBetweenCohorts),
      };
    } catch (error) {
      logger.error('Failed to get rollout config', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
  
  /**
   * Test connection to VersionBeacon contract
   * 
   * @returns True if connection successful
   */
  async testConnection(): Promise<boolean> {
    try {
      // Try to read nextVersionId (simple read-only call)
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
