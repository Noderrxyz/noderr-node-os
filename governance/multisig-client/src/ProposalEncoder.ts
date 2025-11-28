/**
 * Proposal Encoder
 * 
 * Encodes function calls for VersionBeacon contract proposals
 */

import { ethers } from 'ethers';
import {
  Proposal,
  ProposalType,
  VersionUpdateParams,
  EmergencyRollbackParams
} from './types';

/**
 * VersionBeacon contract ABI (minimal interface)
 */
const VERSION_BEACON_ABI = [
  'function publishVersion(uint256 versionId, string semver, string tier, string ipfsHash, tuple(uint8 canaryPercentage, uint8 cohortPercentage, uint32 delayBetweenCohorts) rolloutConfig)',
  'function emergencyRollback(string tier, string reason)',
  'function setDefaultRolloutConfig(tuple(uint8 canaryPercentage, uint8 cohortPercentage, uint32 delayBetweenCohorts) config)',
  'function pauseRollout(uint256 versionId)',
  'function resumeRollout(uint256 versionId)'
];

export class ProposalEncoder {
  private versionBeaconAddress: string;
  private interface: ethers.Interface;

  constructor(versionBeaconAddress: string) {
    this.versionBeaconAddress = versionBeaconAddress;
    this.interface = new ethers.Interface(VERSION_BEACON_ABI);
  }

  /**
   * Encode a version update proposal
   */
  encodeVersionUpdate(params: VersionUpdateParams): Proposal {
    const rolloutConfig = params.rolloutConfig || {
      canaryPercentage: 5,
      cohortPercentage: 25,
      delayBetweenCohorts: 86400 // 24 hours
    };

    const data = this.interface.encodeFunctionData('publishVersion', [
      params.versionId,
      params.semver,
      params.tier,
      params.ipfsHash,
      rolloutConfig
    ]);

    return {
      type: ProposalType.VERSION_UPDATE,
      description: `Publish version ${params.semver} for ${params.tier} tier`,
      target: this.versionBeaconAddress,
      data,
      value: '0',
      metadata: {
        versionId: params.versionId,
        semver: params.semver,
        tier: params.tier,
        ipfsHash: params.ipfsHash,
        rolloutConfig
      }
    };
  }

  /**
   * Encode an emergency rollback proposal
   */
  encodeEmergencyRollback(params: EmergencyRollbackParams): Proposal {
    const data = this.interface.encodeFunctionData('emergencyRollback', [
      params.tier,
      params.reason
    ]);

    return {
      type: ProposalType.EMERGENCY_ROLLBACK,
      description: `Emergency rollback for ${params.tier} tier: ${params.reason}`,
      target: this.versionBeaconAddress,
      data,
      value: '0',
      metadata: {
        tier: params.tier,
        reason: params.reason
      }
    };
  }

  /**
   * Encode a rollout config change proposal
   */
  encodeRolloutConfigChange(config: {
    canaryPercentage: number;
    cohortPercentage: number;
    delayBetweenCohorts: number;
  }): Proposal {
    const data = this.interface.encodeFunctionData('setDefaultRolloutConfig', [
      config
    ]);

    return {
      type: ProposalType.PARAMETER_CHANGE,
      description: `Update default rollout config: ${config.canaryPercentage}% canary, ${config.cohortPercentage}% cohort, ${config.delayBetweenCohorts}s delay`,
      target: this.versionBeaconAddress,
      data,
      value: '0',
      metadata: {
        config
      }
    };
  }

  /**
   * Encode a pause rollout proposal
   */
  encodePauseRollout(versionId: number, reason: string): Proposal {
    const data = this.interface.encodeFunctionData('pauseRollout', [versionId]);

    return {
      type: ProposalType.CUSTOM,
      description: `Pause rollout for version ${versionId}: ${reason}`,
      target: this.versionBeaconAddress,
      data,
      value: '0',
      metadata: {
        versionId,
        reason
      }
    };
  }

  /**
   * Encode a resume rollout proposal
   */
  encodeResumeRollout(versionId: number): Proposal {
    const data = this.interface.encodeFunctionData('resumeRollout', [versionId]);

    return {
      type: ProposalType.CUSTOM,
      description: `Resume rollout for version ${versionId}`,
      target: this.versionBeaconAddress,
      data,
      value: '0',
      metadata: {
        versionId
      }
    };
  }

  /**
   * Decode proposal data
   */
  decodeProposal(data: string): { functionName: string; args: any[] } {
    try {
      const decoded = this.interface.parseTransaction({ data });
      if (!decoded) {
        throw new Error('Failed to decode proposal data');
      }

      return {
        functionName: decoded.name,
        args: decoded.args.toArray()
      };
    } catch (error) {
      throw new Error(`Failed to decode proposal: ${error}`);
    }
  }
}
