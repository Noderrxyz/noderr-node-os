import { Logger } from '@noderr/utils/src';
import { createHash } from 'crypto';
import { Redis } from 'ioredis';

/**
 * PCR Baseline Service
 * 
 * Manages known-good PCR (Platform Configuration Register) values for TPM attestation.
 * This service is critical for preventing attestation spoofing attacks.
 * 
 * Architecture:
 * - Redis-backed storage for distributed baseline management
 * - Support for multiple hardware configurations
 * - Automatic baseline learning from trusted nodes
 * - Deviation detection and alerting
 * - Periodic baseline updates via governance
 * 
 * Security Model:
 * - PCR values are cryptographic measurements of system state
 * - Each hardware/software configuration has a unique PCR fingerprint
 * - Deviations from baseline indicate tampering or configuration drift
 * - Baseline updates require multi-sig governance approval
 */

const logger = new Logger('pcr-baseline.service');
export interface PCRValues {
  pcr0: string;  // BIOS/UEFI firmware
  pcr1: string;  // BIOS/UEFI configuration
  pcr2: string;  // Option ROM code
  pcr3: string;  // Option ROM configuration
  pcr4: string;  // Boot loader
  pcr5: string;  // Boot loader configuration
  pcr6: string;  // Resume from S4/S5 events
  pcr7: string;  // Secure Boot state
  pcr8: string;  // OS kernel
  pcr9: string;  // OS configuration
  pcr10: string; // Application code
}

export interface HardwareProfile {
  cpuModel: string;
  biosVendor: string;
  biosVersion: string;
  osName: string;
  osVersion: string;
  kernelVersion: string;
  tpmVersion: string;
}

export interface PCRBaseline {
  profileId: string;
  profile: HardwareProfile;
  pcrValues: PCRValues;
  createdAt: Date;
  updatedAt: Date;
  trustScore: number; // 0.0 to 1.0, based on number of trusted nodes with this baseline
  nodeCount: number;  // Number of nodes using this baseline
}

export interface AttestationVerificationResult {
  isValid: boolean;
  matchedBaseline?: PCRBaseline;
  deviations: string[]; // List of PCR registers that deviated
  riskScore: number;    // 0.0 (no risk) to 1.0 (high risk)
  recommendation: 'ACCEPT' | 'REVIEW' | 'REJECT';
}

export class PCRBaselineService {
  private redis: Redis;
  private readonly BASELINE_PREFIX = 'pcr:baseline:';
  private readonly PROFILE_PREFIX = 'pcr:profile:';
  private readonly DEVIATION_THRESHOLD = 0.1; // 10% deviation triggers review
  private readonly CRITICAL_PCRS = [0, 1, 4, 7, 8]; // PCRs that must match exactly

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl);
  }

  /**
   * Generates a unique profile ID from hardware profile
   */
  private generateProfileId(profile: HardwareProfile): string {
    const profileString = JSON.stringify({
      cpu: profile.cpuModel,
      bios: `${profile.biosVendor}:${profile.biosVersion}`,
      os: `${profile.osName}:${profile.osVersion}`,
      kernel: profile.kernelVersion,
      tpm: profile.tpmVersion,
    });

    return createHash('sha256').update(profileString).digest('hex').substring(0, 16);
  }

  /**
   * Registers a new PCR baseline from a trusted node
   */
  async registerBaseline(
    profile: HardwareProfile,
    pcrValues: PCRValues,
    isTrusted: boolean = false
  ): Promise<PCRBaseline> {
    const profileId = this.generateProfileId(profile);
    const baselineKey = `${this.BASELINE_PREFIX}${profileId}`;

    // Check if baseline already exists
    const existingBaseline = await this.redis.get(baselineKey);

    if (existingBaseline) {
      const baseline: PCRBaseline = JSON.parse(existingBaseline);

      // Increment node count
      baseline.nodeCount++;

      // Update trust score (weighted average)
      if (isTrusted) {
        baseline.trustScore = Math.min(1.0, baseline.trustScore + 0.1);
      }

      baseline.updatedAt = new Date();

      await this.redis.set(baselineKey, JSON.stringify(baseline));
      await this.redis.expire(baselineKey, 90 * 24 * 60 * 60); // 90 days TTL

      return baseline;
    }

    // Create new baseline
    const baseline: PCRBaseline = {
      profileId,
      profile,
      pcrValues,
      createdAt: new Date(),
      updatedAt: new Date(),
      trustScore: isTrusted ? 0.8 : 0.3, // Trusted nodes start with higher score
      nodeCount: 1,
    };

    await this.redis.set(baselineKey, JSON.stringify(baseline));
    await this.redis.expire(baselineKey, 90 * 24 * 60 * 60); // 90 days TTL

    // Index by profile for quick lookup
    await this.redis.sadd(`${this.PROFILE_PREFIX}${profileId}`, baselineKey);

    return baseline;
  }

  /**
   * Verifies PCR values against known baselines
   */
  async verifyAttestation(
    profile: HardwareProfile,
    pcrValues: PCRValues
  ): Promise<AttestationVerificationResult> {
    const profileId = this.generateProfileId(profile);
    const baselineKey = `${this.BASELINE_PREFIX}${profileId}`;

    // Get baseline for this hardware profile
    const baselineData = await this.redis.get(baselineKey);

    if (!baselineData) {
      // No baseline exists for this hardware configuration
      return {
        isValid: false,
        deviations: ['NO_BASELINE_FOUND'],
        riskScore: 0.5, // Medium risk - unknown configuration
        recommendation: 'REVIEW',
      };
    }

    const baseline: PCRBaseline = JSON.parse(baselineData);

    // Compare PCR values
    const deviations: string[] = [];
    let criticalDeviations = 0;
    let totalDeviations = 0;

    for (const [key, expectedValue] of Object.entries(baseline.pcrValues)) {
      const actualValue = pcrValues[key as keyof PCRValues];

      if (expectedValue !== actualValue) {
        deviations.push(key);
        totalDeviations++;

        const pcrNumber = parseInt(key.replace('pcr', ''));
        if (this.CRITICAL_PCRS.includes(pcrNumber)) {
          criticalDeviations++;
        }
      }
    }

    // Calculate risk score
    const deviationRate = totalDeviations / Object.keys(baseline.pcrValues).length;
    const criticalDeviationRate = criticalDeviations / this.CRITICAL_PCRS.length;

    let riskScore = deviationRate * 0.5 + criticalDeviationRate * 0.5;

    // Adjust risk based on baseline trust score
    riskScore = riskScore * (1.0 - baseline.trustScore * 0.3);

    // Determine recommendation
    let recommendation: 'ACCEPT' | 'REVIEW' | 'REJECT';

    if (criticalDeviations > 0) {
      recommendation = 'REJECT'; // Any critical PCR deviation is immediate rejection
    } else if (riskScore > this.DEVIATION_THRESHOLD) {
      recommendation = 'REVIEW'; // Non-critical deviations require manual review
    } else {
      recommendation = 'ACCEPT'; // Minor or no deviations
    }

    return {
      isValid: recommendation === 'ACCEPT',
      matchedBaseline: baseline,
      deviations,
      riskScore,
      recommendation,
    };
  }

  /**
   * Gets all baselines for a hardware profile
   */
  async getBaselinesForProfile(profile: HardwareProfile): Promise<PCRBaseline[]> {
    const profileId = this.generateProfileId(profile);
    const baselineKeys = await this.redis.smembers(`${this.PROFILE_PREFIX}${profileId}`);

    const baselines: PCRBaseline[] = [];

    for (const key of baselineKeys) {
      const data = await this.redis.get(key);
      if (data) {
        baselines.push(JSON.parse(data));
      }
    }

    return baselines.sort((a, b) => b.trustScore - a.trustScore);
  }

  /**
   * Updates baseline trust score (governance function)
   */
  async updateBaselineTrust(profileId: string, newTrustScore: number): Promise<void> {
    if (newTrustScore < 0 || newTrustScore > 1) {
      throw new Error('Trust score must be between 0 and 1');
    }

    const baselineKey = `${this.BASELINE_PREFIX}${profileId}`;
    const data = await this.redis.get(baselineKey);

    if (!data) {
      throw new Error(`Baseline ${profileId} not found`);
    }

    const baseline: PCRBaseline = JSON.parse(data);
    baseline.trustScore = newTrustScore;
    baseline.updatedAt = new Date();

    await this.redis.set(baselineKey, JSON.stringify(baseline));
  }

  /**
   * Removes a baseline (governance function)
   */
  async removeBaseline(profileId: string): Promise<void> {
    const baselineKey = `${this.BASELINE_PREFIX}${profileId}`;
    await this.redis.del(baselineKey);
    await this.redis.del(`${this.PROFILE_PREFIX}${profileId}`);
  }

  /**
   * Gets statistics about baseline database
   */
  async getStatistics(): Promise<{
    totalBaselines: number;
    totalNodes: number;
    averageTrustScore: number;
    topProfiles: Array<{ profileId: string; nodeCount: number; trustScore: number }>;
  }> {
    const baselineKeys = await this.redis.keys(`${this.BASELINE_PREFIX}*`);

    let totalNodes = 0;
    let totalTrustScore = 0;
    const profiles: Array<{ profileId: string; nodeCount: number; trustScore: number }> = [];

    for (const key of baselineKeys) {
      const data = await this.redis.get(key);
      if (data) {
        const baseline: PCRBaseline = JSON.parse(data);
        totalNodes += baseline.nodeCount;
        totalTrustScore += baseline.trustScore;
        profiles.push({
          profileId: baseline.profileId,
          nodeCount: baseline.nodeCount,
          trustScore: baseline.trustScore,
        });
      }
    }

    const averageTrustScore = baselineKeys.length > 0 ? totalTrustScore / baselineKeys.length : 0;

    // Sort by node count descending
    profiles.sort((a, b) => b.nodeCount - a.nodeCount);

    return {
      totalBaselines: baselineKeys.length,
      totalNodes,
      averageTrustScore,
      topProfiles: profiles.slice(0, 10),
    };
  }

  /**
   * Closes Redis connection
   */
  async close(): Promise<void> {
    await this.redis.quit();
  }
}

/**
 * Example usage:
 * 
 * ```typescript
 * const pcrService = new PCRBaselineService('redis://localhost:6379');
 * 
 * // Register baseline from trusted node
 * const profile: HardwareProfile = {
 *   cpuModel: 'Intel Core i7-12700K',
 *   biosVendor: 'American Megatrends',
 *   biosVersion: '2.14',
 *   osName: 'Ubuntu',
 *   osVersion: '22.04',
 *   kernelVersion: '5.15.0-76-generic',
 *   tpmVersion: '2.0',
 * };
 * 
 * const pcrValues: PCRValues = {
 *   pcr0: 'a1b2c3d4...',
 *   pcr1: 'e5f6g7h8...',
 *   // ... other PCRs
 * };
 * 
 * await pcrService.registerBaseline(profile, pcrValues, true);
 * 
 * // Verify attestation from new node
 * const result = await pcrService.verifyAttestation(profile, pcrValues);
 * 
 * if (result.recommendation === 'ACCEPT') {
 *   logger.info('Attestation verified successfully');
 * } else if (result.recommendation === 'REVIEW') {
 *   logger.info('Attestation requires manual review:', result.deviations);
 * } else {
 *   logger.info('Attestation rejected:', result.deviations);
 * }
 * ```
 */
