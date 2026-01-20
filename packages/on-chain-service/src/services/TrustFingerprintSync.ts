import { ethers } from 'ethers';
import { Logger } from 'winston';
import { OnChainServiceConfig } from '@noderr/types/src';
import { RateLimiter } from '../utils/rateLimiter';
import { CircuitBreaker } from '../utils/circuitBreaker';

/**
 * TrustFingerprintSync
 * 
 * Synchronizes TrustFingerprint scores from TrustFingerprint contract to UtilityNFT contract
 * 
 * Problem:
 * - TrustFingerprint stores scores as uint16 (0-10000)
 * - UtilityNFT stores scores as uint256 with 1e18 scale (0-1e18)
 * - StakingManager reads from UtilityNFT to check tier requirements
 * 
 * Solution:
 * - This service reads scores from TrustFingerprint
 * - Converts from 0-10000 to 0-1e18 scale
 * - Updates UtilityNFT with converted scores
 * 
 * Architecture:
 * - Runs periodically (e.g., hourly or after TrustFingerprint updates)
 * - Batch processes multiple operators
 * - Handles errors gracefully
 * - Logs all conversions for auditability
 */
export class TrustFingerprintSync {
  private config: OnChainServiceConfig;
  private logger: Logger;
  private rateLimiter: RateLimiter;
  private circuitBreaker: CircuitBreaker;
  private provider: ethers.Provider;
  private wallet: ethers.Wallet;

  // Contract instances
  private trustFingerprintContract: ethers.Contract;
  private utilityNFTContract: ethers.Contract;

  constructor(
    config: OnChainServiceConfig,
    logger: Logger,
    rateLimiter: RateLimiter,
    circuitBreaker: CircuitBreaker
  ) {
    this.config = config;
    this.logger = logger;
    this.rateLimiter = rateLimiter;
    this.circuitBreaker = circuitBreaker;

    // Initialize provider and wallet
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.wallet = new ethers.Wallet(config.privateKey, this.provider);

    // Initialize contract instances
    this.trustFingerprintContract = new ethers.Contract(
      config.trustFingerprintAddress,
      this.getTrustFingerprintABI(),
      this.wallet
    );

    this.utilityNFTContract = new ethers.Contract(
      config.utilityNFTAddress!,
      this.getUtilityNFTABI(),
      this.wallet
    );

    this.logger.info('TrustFingerprintSync initialized', {
      trustFingerprint: config.trustFingerprintAddress,
      utilityNFT: config.utilityNFTAddress,
    });
  }

  /**
   * Sync a single operator's TrustFingerprint score
   */
  async syncOperator(operatorAddress: string): Promise<void> {
    try {
      // Get token ID from UtilityNFT
      const tokenId = await this.utilityNFTContract.walletToTokenId(operatorAddress);

      if (tokenId === 0n) {
        this.logger.warn('Operator does not have a UtilityNFT', { operatorAddress });
        return;
      }

      // Get score from TrustFingerprint (0-10000 scale)
      const trustScore = await this.trustFingerprintContract.getScore(operatorAddress);

      // Convert to 1e18 scale
      // Formula: (trustScore / 10000) * 1e18
      // Simplified: (trustScore * 1e18) / 10000
      const convertedScore = (BigInt(trustScore) * ethers.parseEther('1')) / BigInt(10000);

      // Get current score from UtilityNFT
      const metadata = await this.utilityNFTContract.nodeMetadata(tokenId);
      const currentScore = metadata.trustFingerprint;

      // Only update if score has changed
      if (convertedScore !== currentScore) {
        this.logger.info('Syncing TrustFingerprint score', {
          operatorAddress,
          tokenId: tokenId.toString(),
          trustScoreRaw: trustScore.toString(),
          trustScoreConverted: ethers.formatEther(convertedScore),
          currentScore: ethers.formatEther(currentScore),
        });

        // Update UtilityNFT
        const tx = await this.utilityNFTContract.updateTrustFingerprint(tokenId, convertedScore);
        await tx.wait();

        this.logger.info('TrustFingerprint score synced successfully', {
          operatorAddress,
          txHash: tx.hash,
        });
      } else {
        this.logger.debug('TrustFingerprint score unchanged, skipping update', {
          operatorAddress,
          score: ethers.formatEther(convertedScore),
        });
      }
    } catch (error: any) {
      this.logger.error('Failed to sync TrustFingerprint for operator', {
        operatorAddress,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Sync multiple operators in batch
   */
  async syncOperators(operatorAddresses: string[]): Promise<void> {
    this.logger.info('Starting batch TrustFingerprint sync', {
      operatorCount: operatorAddresses.length,
    });

    let successCount = 0;
    let failureCount = 0;

    for (const address of operatorAddresses) {
      try {
        await this.syncOperator(address);
        successCount++;
      } catch (error: any) {
        this.logger.error('Failed to sync operator', {
          address,
          error: error.message,
        });
        failureCount++;
        // Continue with other operators
      }
    }

    this.logger.info('Batch TrustFingerprint sync completed', {
      successCount,
      failureCount,
      totalCount: operatorAddresses.length,
    });
  }

  /**
   * Sync all operators who have a UtilityNFT
   */
  async syncAllOperators(): Promise<void> {
    this.logger.info('Starting full TrustFingerprint sync');

    try {
      // Get total supply of UtilityNFTs
      const totalSupply = await this.utilityNFTContract.totalSupply();
      this.logger.info('Found UtilityNFTs to sync', { count: totalSupply.toString() });

      const addresses: string[] = [];

      // Get owner of each token
      for (let i = 1; i <= Number(totalSupply); i++) {
        try {
          const owner = await this.utilityNFTContract.ownerOf(i);
          addresses.push(owner);
        } catch (error: any) {
          this.logger.warn('Failed to get owner of token', { tokenId: i, error: error.message });
        }
      }

      // Sync all operators
      await this.syncOperators(addresses);
    } catch (error: any) {
      this.logger.error('Failed to sync all operators', { error: error.message });
      throw error;
    }
  }

  /**
   * Convert TrustFingerprint score from 0-10000 to 0-1e18 scale
   */
  static convertScore(trustScore: number): bigint {
    return (BigInt(trustScore) * ethers.parseEther('1')) / BigInt(10000);
  }

  /**
   * Convert TrustFingerprint score from 0-1e18 to 0-10000 scale
   */
  static revertScore(convertedScore: bigint): number {
    return Number((convertedScore * BigInt(10000)) / ethers.parseEther('1'));
  }

  /**
   * Get TrustFingerprint ABI
   */
  private getTrustFingerprintABI(): any[] {
    return [
      'function getScore(address operator) external view returns (uint16)',
    ];
  }

  /**
   * Get UtilityNFT ABI
   */
  private getUtilityNFTABI(): any[] {
    return [
      'function walletToTokenId(address wallet) external view returns (uint256)',
      'function nodeMetadata(uint256 tokenId) external view returns (uint256 trustFingerprint, uint8 tier, uint256 joinDate, uint256 lastUpdate, uint256 stakeAmount, bool isActive)',
      'function updateTrustFingerprint(uint256 tokenId, uint256 newScore) external',
      'function totalSupply() external view returns (uint256)',
      'function ownerOf(uint256 tokenId) external view returns (address)',
    ];
  }
}

/**
 * TrustFingerprintSyncScheduler
 * 
 * Runs the TrustFingerprintSync service on a schedule
 */
export class TrustFingerprintSyncScheduler {
  private sync: TrustFingerprintSync;
  private logger: Logger;
  private isRunning: boolean = false;
  private intervalSeconds: number;

  constructor(
    sync: TrustFingerprintSync,
    logger: Logger,
    intervalSeconds: number = 3600 // Default: 1 hour
  ) {
    this.sync = sync;
    this.logger = logger;
    this.intervalSeconds = intervalSeconds;

    this.logger.info('TrustFingerprintSyncScheduler initialized', {
      intervalSeconds,
    });
  }

  /**
   * Start the scheduler
   */
  start(): void {
    if (this.isRunning) {
      this.logger.warn('Scheduler is already running');
      return;
    }

    this.isRunning = true;
    this.logger.info('Starting TrustFingerprint sync scheduler');

    // Run immediately on start
    this.runSync().catch((error) => {
      this.logger.error('Initial sync failed', { error: error.message });
    });

    // Schedule periodic runs
    setInterval(() => {
      if (this.isRunning) {
        this.runSync().catch((error) => {
          this.logger.error('Scheduled sync failed', { error: error.message });
        });
      }
    }, this.intervalSeconds * 1000);

    this.logger.info('TrustFingerprint sync scheduler started');
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    this.isRunning = false;
    this.logger.info('TrustFingerprint sync scheduler stopped');
  }

  /**
   * Run a single sync
   */
  private async runSync(): Promise<void> {
    const startTime = Date.now();

    this.logger.info('Starting TrustFingerprint sync');

    try {
      await this.sync.syncAllOperators();

      const duration = Date.now() - startTime;
      this.logger.info('TrustFingerprint sync completed successfully', {
        durationMs: duration,
      });
    } catch (error: any) {
      this.logger.error('TrustFingerprint sync failed', {
        error: error.message,
        stack: error.stack,
      });
    }
  }

  /**
   * Manually trigger a sync (for testing or emergency)
   */
  async triggerSync(): Promise<void> {
    this.logger.info('Manually triggering TrustFingerprint sync');
    await this.runSync();
  }
}
