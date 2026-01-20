import { ethers } from 'ethers';
import { Logger } from 'winston';
import { OnChainServiceConfig, RewardEntry } from '@noderr/types';
import { RateLimiter } from '../utils/rateLimiter';
import { CircuitBreaker } from '../utils/circuitBreaker';
import { TrustUpdater } from './TrustUpdater';
import { RewardDistributor } from './RewardDistributor';

/**
 * Performance data collected from telemetry
 */
export interface OperatorPerformanceData {
  address: string;
  uptime: number; // 0-100 (percentage)
  successRate: number; // 0-100 (percentage)
  responseTime: number; // milliseconds
  signalQuality: number; // 0-100 (percentage)
  governanceParticipation: number; // 0-100 (percentage)
  peerReputation: number; // 0-100 (percentage)
  epochStartTime: number; // timestamp
  epochEndTime: number; // timestamp
}

/**
 * TrustFingerprint component scores (0-10000 scale)
 */
export interface TrustComponents {
  uptime: number;
  quality: number;
  governance: number;
  history: number;
  peer: number;
  stake: number;
}

/**
 * Epoch configuration
 */
export interface EpochConfig {
  epochId: number;
  startTime: number;
  endTime: number;
  baseRewardRate: bigint; // Base reward in NODR tokens (with 18 decimals)
  vestingDuration: number; // Vesting duration in seconds (default 90 days)
}

/**
 * RewardOrchestrator
 * 
 * The missing piece that connects telemetry → TrustFingerprint → Rewards
 * 
 * Responsibilities:
 * 1. Collect performance data from telemetry service
 * 2. Calculate TrustFingerprint component scores
 * 3. Submit scores to TrustFingerprint contract
 * 4. Calculate rewards based on stake, trust, and performance
 * 5. Create Merkle epochs and distribute rewards
 * 6. Monitor treasury balance and adjust reward rates
 * 
 * Architecture:
 * - Runs as a periodic job (cron or scheduled task)
 * - Fetches data from multiple sources
 * - Submits transactions to blockchain
 * - Generates Merkle proofs for operators
 * - Logs all actions for auditability
 */
export class RewardOrchestrator {
  private config: OnChainServiceConfig;
  private logger: Logger;
  private rateLimiter: RateLimiter;
  private circuitBreaker: CircuitBreaker;
  private trustUpdater: TrustUpdater;
  private rewardDistributor: RewardDistributor;
  private provider: ethers.Provider;
  private wallet: ethers.Wallet;

  // Contract instances
  private stakingManagerContract: ethers.Contract;
  private trustFingerprintContract: ethers.Contract;
  private rewardCalculatorContract: ethers.Contract;
  private treasuryManagerContract: ethers.Contract;

  // Historical scores for decay calculation
  private historicalScores: Map<string, number[]> = new Map();

  // Constants
  private readonly SCALE_10000 = 10000;
  private readonly SCALE_1E18 = ethers.parseEther('1');
  private readonly SECONDS_PER_DAY = 86400;
  private readonly DEFAULT_VESTING_DURATION = 90 * this.SECONDS_PER_DAY; // 90 days

  constructor(
    config: OnChainServiceConfig,
    logger: Logger,
    rateLimiter: RateLimiter,
    circuitBreaker: CircuitBreaker,
    trustUpdater: TrustUpdater,
    rewardDistributor: RewardDistributor
  ) {
    this.config = config;
    this.logger = logger;
    this.rateLimiter = rateLimiter;
    this.circuitBreaker = circuitBreaker;
    this.trustUpdater = trustUpdater;
    this.rewardDistributor = rewardDistributor;

    // Initialize provider and wallet
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.wallet = new ethers.Wallet(config.privateKey, this.provider);

    // Initialize contract instances
    this.stakingManagerContract = new ethers.Contract(
      config.stakingManagerAddress!,
      this.getStakingManagerABI(),
      this.wallet
    );

    this.trustFingerprintContract = new ethers.Contract(
      config.trustFingerprintAddress,
      this.getTrustFingerprintABI(),
      this.wallet
    );

    this.rewardCalculatorContract = new ethers.Contract(
      config.rewardCalculatorAddress!,
      this.getRewardCalculatorABI(),
      this.wallet
    );

    this.treasuryManagerContract = new ethers.Contract(
      config.treasuryManagerAddress,
      this.getTreasuryManagerABI(),
      this.wallet
    );

    this.logger.info('RewardOrchestrator initialized', {
      stakingManager: config.stakingManagerAddress,
      trustFingerprint: config.trustFingerprintAddress,
      rewardCalculator: config.rewardCalculatorAddress,
      treasuryManager: config.treasuryManagerAddress,
    });
  }

  /**
   * Main orchestration function - runs once per epoch
   */
  async processEpoch(
    performanceData: OperatorPerformanceData[],
    epochConfig: EpochConfig
  ): Promise<void> {
    this.logger.info('Starting epoch processing', {
      epochId: epochConfig.epochId,
      operatorCount: performanceData.length,
      baseRewardRate: epochConfig.baseRewardRate.toString(),
    });

    try {
      // Step 1: Check treasury balance
      await this.checkTreasuryBalance(epochConfig);

      // Step 2: Calculate TrustFingerprint components
      const trustComponentsMap = await this.calculateTrustComponents(performanceData);

      // Step 3: Submit TrustFingerprint scores to blockchain
      await this.submitTrustScores(trustComponentsMap);

      // Step 4: Calculate rewards for each operator
      const rewardEntries = await this.calculateRewards(performanceData, epochConfig);

      // Step 5: Create Merkle epoch and distribute rewards
      await this.distributeRewards(rewardEntries, epochConfig);

      this.logger.info('Epoch processing completed successfully', {
        epochId: epochConfig.epochId,
        totalRewards: rewardEntries.reduce((sum, entry) => sum + entry.amount, 0n).toString(),
      });
    } catch (error: any) {
      this.logger.error('Epoch processing failed', {
        epochId: epochConfig.epochId,
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Step 1: Check treasury balance and ensure sustainability
   */
  private async checkTreasuryBalance(epochConfig: EpochConfig): Promise<void> {
    this.logger.info('Checking treasury balance');

    try {
      // Get treasury balance
      const balance = await this.treasuryManagerContract.getBalance();
      this.logger.info('Treasury balance', { balance: ethers.formatEther(balance) });

      // Calculate estimated epoch cost (rough estimate)
      // Assume average 200 NODR per operator per epoch
      const estimatedCost = epochConfig.baseRewardRate * BigInt(100); // Rough multiplier

      // Check if balance is sufficient for at least 6 months (180 epochs if daily)
      const minimumReserve = estimatedCost * BigInt(180);

      if (balance < minimumReserve) {
        this.logger.warn('Treasury balance below minimum reserve', {
          balance: ethers.formatEther(balance),
          minimumReserve: ethers.formatEther(minimumReserve),
          epochsRemaining: Number(balance / estimatedCost),
        });

        // TODO: Implement automatic reward rate adjustment
        // For now, just log a warning
      }

      if (balance < estimatedCost) {
        throw new Error('Insufficient treasury balance for epoch rewards');
      }
    } catch (error: any) {
      this.logger.error('Treasury balance check failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Step 2: Calculate TrustFingerprint component scores from performance data
   */
  private async calculateTrustComponents(
    performanceData: OperatorPerformanceData[]
  ): Promise<Map<string, TrustComponents>> {
    this.logger.info('Calculating TrustFingerprint components', {
      operatorCount: performanceData.length,
    });

    const componentsMap = new Map<string, TrustComponents>();

    for (const data of performanceData) {
      try {
        // Get stake info from StakingManager
        const stakeInfo = await this.stakingManagerContract.getStakeInfo(data.address);
        const stakedAmount = stakeInfo.stakedAmount;

        // Get tier requirements
        const tier = await this.getTierForStake(stakedAmount);
        const tierRequirement = this.getStakeRequirementForTier(tier);

        // Calculate each component (0-10000 scale)

        // 1. Uptime (35% weight): Direct conversion from percentage
        const uptime = Math.min(this.SCALE_10000, Math.round(data.uptime * 100));

        // 2. Quality (20% weight): Based on success rate and signal quality
        const quality = Math.min(
          this.SCALE_10000,
          Math.round(((data.successRate + data.signalQuality) / 2) * 100)
        );

        // 3. Governance (15% weight): Participation in governance votes
        const governance = Math.min(
          this.SCALE_10000,
          Math.round(data.governanceParticipation * 100)
        );

        // 4. History (10% weight): Decay previous scores by 5% per epoch
        const history = this.calculateHistoryScore(data.address, uptime, quality);

        // 5. Peer (10% weight): Peer reputation from P2P layer
        const peer = Math.min(this.SCALE_10000, Math.round(data.peerReputation * 100));

        // 6. Stake (10% weight): Stake amount relative to tier requirement
        const stakeRatio = Number(stakedAmount * BigInt(100) / tierRequirement) / 100;
        const stake = Math.min(this.SCALE_10000, Math.round(stakeRatio * this.SCALE_10000));

        const components: TrustComponents = {
          uptime,
          quality,
          governance,
          history,
          peer,
          stake,
        };

        componentsMap.set(data.address, components);

        this.logger.debug('Calculated TrustFingerprint components', {
          address: data.address,
          components,
        });
      } catch (error: any) {
        this.logger.error('Failed to calculate components for operator', {
          address: data.address,
          error: error.message,
        });
        // Continue with other operators
      }
    }

    return componentsMap;
  }

  /**
   * Calculate history score with 5% decay per epoch
   */
  private calculateHistoryScore(
    address: string,
    currentUptime: number,
    currentQuality: number
  ): number {
    // Get historical scores
    let history = this.historicalScores.get(address) || [];

    // Add current performance
    const currentScore = Math.round((currentUptime + currentQuality) / 2);
    history.push(currentScore);

    // Keep only last 10 epochs
    if (history.length > 10) {
      history = history.slice(-10);
    }

    // Update stored history
    this.historicalScores.set(address, history);

    // Calculate weighted average with 5% decay per epoch
    let weightedSum = 0;
    let weightSum = 0;

    for (let i = 0; i < history.length; i++) {
      const age = history.length - i - 1; // 0 for most recent
      const weight = Math.pow(0.95, age); // 5% decay per epoch
      weightedSum += history[i] * weight;
      weightSum += weight;
    }

    return Math.round(weightedSum / weightSum);
  }

  /**
   * Step 3: Submit TrustFingerprint scores to blockchain
   */
  private async submitTrustScores(
    componentsMap: Map<string, TrustComponents>
  ): Promise<void> {
    this.logger.info('Submitting TrustFingerprint scores', {
      operatorCount: componentsMap.size,
    });

    // Convert to batch format
    const updates = Array.from(componentsMap.entries()).map(([operator, components]) => ({
      operator,
      components
    }));

    try {
      // Use TrustUpdater service to submit scores
      await this.trustUpdater.batchUpdateScores(updates);

      this.logger.info('TrustFingerprint scores submitted successfully');
    } catch (error: any) {
      this.logger.error('Failed to submit TrustFingerprint scores', {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Step 4: Calculate rewards for each operator
   */
  private async calculateRewards(
    performanceData: OperatorPerformanceData[],
    epochConfig: EpochConfig
  ): Promise<RewardEntry[]> {
    this.logger.info('Calculating rewards', { operatorCount: performanceData.length });

    const rewardEntries: RewardEntry[] = [];

    for (const data of performanceData) {
      try {
        // Get stake info
        const stakeInfo = await this.stakingManagerContract.getStakeInfo(data.address);
        const stakedAmount = stakeInfo.stakedAmount;

        // Get TrustFingerprint score (0-10000 scale from contract)
        const trustScore = await this.trustFingerprintContract.getScore(data.address);

        // CRITICAL: Convert from 0-10000 to 0-1000 scale for RewardCalculator
        const trustScoreScaled = Math.floor(Number(trustScore) / 10);

        // Calculate performance multiplier (0-200, where 100 = 1.0x)
        const performanceMultiplier = this.calculatePerformanceMultiplier(data);

        // Get days staked
        const daysStaked = await this.calculateDaysStaked(data.address);

        // Call RewardCalculator contract
        const performanceDataStruct = {
          stakedAmount,
          trustScore: trustScoreScaled, // Use scaled score
          uptime: Math.round(data.uptime * 100), // 0-10000
          successRate: Math.round(data.successRate * 100), // 0-10000
          responseTime: data.responseTime,
          daysStaked,
        };

        let rewardAmount = await this.rewardCalculatorContract.calculateReward(
          epochConfig.baseRewardRate,
          performanceDataStruct
        );

        // Apply penalty multiplier if PenaltyManager is configured
        if (this.config.penaltyManagerAddress && this.config.penaltyManagerAddress !== '0x0000000000000000000000000000000000000000') {
          try {
            const penaltyManagerContract = new ethers.Contract(
              this.config.penaltyManagerAddress,
              ['function getPenaltyMultiplier(address operator) external view returns (uint256)'],
              this.provider
            );
            
            const penaltyMultiplier = await penaltyManagerContract.getPenaltyMultiplier(data.address);
            const multiplierDecimal = Number(penaltyMultiplier) / 10000; // Convert from basis points
            
            // Apply penalty multiplier to reward
            rewardAmount = (rewardAmount * BigInt(Math.floor(multiplierDecimal * 10000))) / 10000n;
            
            this.logger.debug('Applied penalty multiplier', {
              address: data.address,
              penaltyMultiplier: multiplierDecimal,
              originalReward: ethers.formatEther(rewardAmount),
              adjustedReward: ethers.formatEther(rewardAmount),
            });
          } catch (error: any) {
            this.logger.warn('Failed to apply penalty multiplier, using full reward', {
              address: data.address,
              error: error.message,
            });
          }
        }

        rewardEntries.push({
          address: data.address,
          amount: rewardAmount,
        });

        this.logger.debug('Calculated reward for operator', {
          address: data.address,
          rewardAmount: ethers.formatEther(rewardAmount),
          trustScore: Number(trustScore),
          trustScoreScaled,
          stakedAmount: ethers.formatEther(stakedAmount),
        });
      } catch (error: any) {
        this.logger.error('Failed to calculate reward for operator', {
          address: data.address,
          error: error.message,
        });
        // Continue with other operators
      }
    }

    return rewardEntries;
  }

  /**
   * Calculate performance multiplier from telemetry data
   */
  private calculatePerformanceMultiplier(data: OperatorPerformanceData): number {
    // Performance multiplier: 0.5x to 2.0x (50 to 200)
    // Based on uptime, success rate, and response time

    // Uptime contribution (0-50)
    const uptimeScore = (data.uptime / 100) * 50;

    // Success rate contribution (0-50)
    const successScore = (data.successRate / 100) * 50;

    // Response time contribution (0-50)
    // Assume 100ms is excellent, 1000ms is poor
    const responseScore = Math.max(0, 50 - (data.responseTime / 1000) * 50);

    // Signal quality contribution (0-50)
    const qualityScore = (data.signalQuality / 100) * 50;

    // Total: 0-200
    const total = uptimeScore + successScore + responseScore + qualityScore;

    return Math.max(50, Math.min(200, Math.round(total)));
  }

  /**
   * Calculate days staked for an operator
   */
  private async calculateDaysStaked(address: string): Promise<number> {
    try {
      const stakeInfo = await this.stakingManagerContract.getStakeInfo(address);
      
      // Assuming there's a stakedAt timestamp in the contract
      // If not available, we'll need to track this off-chain
      // For now, return a default value
      // TODO: Implement proper staking timestamp tracking
      
      return 30; // Default to 30 days for now
    } catch (error: any) {
      this.logger.warn('Failed to get days staked, using default', {
        address,
        error: error.message,
      });
      return 30;
    }
  }

  /**
   * Step 5: Create Merkle epoch and distribute rewards
   * WITH TREASURY SUSTAINABILITY CHECKS
   */
  private async distributeRewards(
    rewardEntries: RewardEntry[],
    epochConfig: EpochConfig
  ): Promise<void> {
    this.logger.info('Distributing rewards', { rewardCount: rewardEntries.length });

    try {
      // Calculate total rewards to be distributed
      const totalRewards = rewardEntries.reduce((sum, entry) => sum + entry.amount, 0n);

      // CRITICAL: Check treasury balance before distribution
      const treasuryBalance = await this.getTreasuryBalance();
      const safetyBuffer = treasuryBalance / 10n; // Keep 10% buffer
      const availableForDistribution = treasuryBalance - safetyBuffer;

      this.logger.info('Treasury sustainability check', {
        treasuryBalance: ethers.formatEther(treasuryBalance),
        safetyBuffer: ethers.formatEther(safetyBuffer),
        availableForDistribution: ethers.formatEther(availableForDistribution),
        requestedDistribution: ethers.formatEther(totalRewards),
      });

      // If requested rewards exceed available balance, scale down proportionally
      let adjustedRewards = rewardEntries;
      if (totalRewards > availableForDistribution) {
        const scaleFactor = Number(availableForDistribution) / Number(totalRewards);
        
        this.logger.warn('⚠️ Treasury insufficient for full rewards, scaling down', {
          scaleFactor: scaleFactor.toFixed(4),
          originalTotal: ethers.formatEther(totalRewards),
          adjustedTotal: ethers.formatEther(availableForDistribution),
        });

        adjustedRewards = rewardEntries.map((entry) => ({
          ...entry,
          amount: BigInt(Math.floor(Number(entry.amount) * scaleFactor)),
        }));
      }

      // Additional check: If treasury is critically low, skip distribution entirely
      const CRITICAL_THRESHOLD = ethers.parseEther('100000'); // 100K NODR minimum
      if (treasuryBalance < CRITICAL_THRESHOLD) {
        this.logger.error('🚨 CRITICAL: Treasury balance below minimum threshold', {
          balance: ethers.formatEther(treasuryBalance),
          threshold: ethers.formatEther(CRITICAL_THRESHOLD),
        });
        throw new Error('Treasury balance critically low, skipping reward distribution');
      }

      // Convert to format expected by RewardDistributor
      const rewards = adjustedRewards.map((entry) => ({
        address: entry.address,
        amount: entry.amount,
      }));

      // Create Merkle epoch
      const description = `Epoch ${epochConfig.epochId} Rewards (${new Date(
        epochConfig.startTime * 1000
      ).toISOString()} - ${new Date(epochConfig.endTime * 1000).toISOString()})`;

      await this.rewardDistributor.createEpoch(
        rewards,
        description,
        epochConfig.vestingDuration
      );

      const finalTotal = adjustedRewards.reduce((sum, entry) => sum + entry.amount, 0n);
      this.logger.info('✅ Rewards distributed successfully', {
        epochId: epochConfig.epochId,
        operatorCount: adjustedRewards.length,
        totalRewards: ethers.formatEther(finalTotal),
        treasuryRemaining: ethers.formatEther(treasuryBalance - finalTotal),
      });
    } catch (error: any) {
      this.logger.error('❌ Failed to distribute rewards', { error: error.message });
      throw error;
    }
  }

  /**
   * Get current treasury balance
   */
  private async getTreasuryBalance(): Promise<bigint> {
    try {
      const balance = await this.treasuryManagerContract.getBalance();
      return balance as bigint;
    } catch (error: any) {
      this.logger.error('Failed to get treasury balance', { error: error.message });
      // Return 0 to prevent distribution if we can't check balance
      return 0n;
    }
  }

  /**
   * Helper: Get tier for stake amount
   */
  private async getTierForStake(stakedAmount: bigint): Promise<number> {
    // Tier thresholds (in NODR with 18 decimals)
    const VALIDATOR_STAKE = ethers.parseEther('50000');
    const GUARDIAN_STAKE = ethers.parseEther('100000');
    const ORACLE_STAKE = ethers.parseEther('500000');

    if (stakedAmount >= ORACLE_STAKE) return 4; // Oracle
    if (stakedAmount >= GUARDIAN_STAKE) return 3; // Guardian
    if (stakedAmount >= VALIDATOR_STAKE) return 2; // Validator
    return 1; // Below minimum
  }

  /**
   * Helper: Get stake requirement for tier
   */
  private getStakeRequirementForTier(tier: number): bigint {
    switch (tier) {
      case 4:
        return ethers.parseEther('500000'); // Oracle
      case 3:
        return ethers.parseEther('100000'); // Guardian
      case 2:
        return ethers.parseEther('50000'); // Validator
      default:
        return ethers.parseEther('50000'); // Default to Validator
    }
  }

  /**
   * Get StakingManager ABI
   */
  private getStakingManagerABI(): any[] {
    return [
      'function getStakeInfo(address operator) external view returns (uint256 stakedAmount, uint256 unbondingAmount, uint256 unbondingEnd, bool isActive)',
    ];
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
   * Get RewardCalculator ABI
   */
  private getRewardCalculatorABI(): any[] {
    return [
      'function calculateReward(uint256 baseRewardRate, tuple(uint256 stakedAmount, uint256 trustScore, uint256 uptime, uint256 successRate, uint256 responseTime, uint256 daysStaked) performanceData) external view returns (uint256 rewardAmount)',
    ];
  }

  /**
   * Get TreasuryManager ABI
   */
  private getTreasuryManagerABI(): any[] {
    return [
      'function getBalance() external view returns (uint256)',
    ];
  }
}
