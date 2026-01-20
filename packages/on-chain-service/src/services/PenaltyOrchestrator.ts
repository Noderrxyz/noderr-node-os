import { ethers } from 'ethers';
import { createLogger } from '../utils/logger';
import { OnChainServiceConfig } from '@noderr/types';

/**
 * Penalty tier enumeration (matches smart contract)
 */
export enum PenaltyTier {
  GOOD_STANDING = 0,
  WARNING = 1,
  PROBATION = 2,
  CRITICAL = 3,
  SLASHED = 4,
}

/**
 * Operator penalty status
 */
export interface PenaltyStatus {
  currentTier: PenaltyTier;
  tierEnteredAt: number;
  gracePeriodEnd: number;
  previousTrustScore: number;
  consecutiveDaysAboveThreshold: number;
  isPaused: boolean;
  pauseReason: string;
  pausedBy: string;
  pausedAt: number;
}

/**
 * Penalty notification data
 */
export interface PenaltyNotification {
  operatorAddress: string;
  operatorEmail?: string;
  operatorPhone?: string;
  tier: PenaltyTier;
  trustScore: number;
  gracePeriodEnd: number;
  issues: string[];
  recoveryPath: string;
}

/**
 * PenaltyOrchestrator Service
 * 
 * Monitors operator trust scores and manages the progressive penalty system.
 * Integrates with PenaltyManager smart contract for on-chain enforcement.
 */
export class PenaltyOrchestrator {
  private provider: ethers.JsonRpcProvider;
  private signer: ethers.Wallet;
  private penaltyManagerContract: ethers.Contract;
  private trustFingerprintContract: ethers.Contract;
  private stakingManagerContract: ethers.Contract;
  private config: OnChainServiceConfig;
  private logger: any;

  // Penalty Manager ABI (key functions only)
  private readonly PENALTY_MANAGER_ABI = [
    'function checkAndUpdatePenaltyTier(address operator) external returns (uint8)',
    'function getPenaltyMultiplier(address operator) external view returns (uint256)',
    'function getGracePeriodRemaining(address operator) external view returns (uint256)',
    'function getOperatorStatus(address operator) external view returns (tuple(uint8 currentTier, uint256 tierEnteredAt, uint256 gracePeriodEnd, uint256 previousTrustScore, uint256 consecutiveDaysAboveThreshold, bool isPaused, string pauseReason, address pausedBy, uint256 pausedAt))',
    'function pausePenalty(address operator, string reason) external',
    'function resumePenalty(address operator) external',
    'function extendGracePeriod(address operator, uint256 extension, string reason) external',
    'function pauseEscalations(string reason) external',
    'function resumeEscalations() external',
    'event PenaltyTierChanged(address indexed operator, uint8 previousTier, uint8 newTier, uint256 trustScore, uint256 gracePeriodEnd)',
    'event OperatorSlashed(address indexed operator, uint256 amount, uint256 percentage, uint256 trustScore, string reason)',
    'event NetworkHealthCritical(uint256 totalOperators, uint256 penalizedOperators, uint256 penaltyRate)',
  ];

  // Trust Fingerprint ABI (key functions only)
  private readonly TRUST_FINGERPRINT_ABI = [
    'function getTrustScore(address account) external view returns (uint256)',
    'function getComponents(address account) external view returns (tuple(uint16 uptime, uint16 quality, uint16 governance, uint16 history, uint16 peer, uint16 stake))',
  ];

  // Staking Manager ABI (key functions only)
  private readonly STAKING_MANAGER_ABI = [
    'function getStakeInfo(address account) external view returns (uint256 amount, uint256 tier, uint256 stakedAt, uint256 unbondingEnd)',
    'function getAllStakers() external view returns (address[])',
  ];

  constructor(config: OnChainServiceConfig) {
    this.config = config;
    this.logger = createLogger(config);
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.signer = new ethers.Wallet(config.privateKey, this.provider);

    this.penaltyManagerContract = new ethers.Contract(
      config.penaltyManagerAddress!,
      this.PENALTY_MANAGER_ABI,
      this.signer
    );

    this.trustFingerprintContract = new ethers.Contract(
      config.trustFingerprintAddress,
      this.TRUST_FINGERPRINT_ABI,
      this.provider
    );

    this.stakingManagerContract = new ethers.Contract(
      config.stakingManagerAddress!,
      this.STAKING_MANAGER_ABI,
      this.provider
    );

    this.logger.info('PenaltyOrchestrator initialized', {
      penaltyManager: config.penaltyManagerAddress,
      trustFingerprint: config.trustFingerprintAddress,
      stakingManager: config.stakingManagerAddress,
    });
  }

  /**
   * Start monitoring penalties
   * Runs continuously, checking all operators every hour
   */
  async startMonitoring(): Promise<void> {
    this.logger.info('Starting penalty monitoring');

    // Listen for penalty events
    this.setupEventListeners();

    // Run initial check
    await this.monitorAllOperators();

    // Schedule hourly checks
    setInterval(async () => {
      try {
        await this.monitorAllOperators();
      } catch (error) {
        this.logger.error('Error in penalty monitoring loop', { error });
      }
    }, 60 * 60 * 1000); // Every hour
  }

  /**
   * Monitor all active operators
   */
  async monitorAllOperators(): Promise<void> {
    try {
      this.logger.info('Monitoring all operators for penalty updates');

      // Get all stakers from StakingManager
      const operators = await this.stakingManagerContract.getAllStakers();

      this.logger.info(`Found ${operators.length} active operators`);

      // Check each operator
      for (const operator of operators) {
        try {
          await this.checkOperatorPenalty(operator);
          // Add delay to avoid rate limiting
          await this.sleep(1000);
        } catch (error) {
          this.logger.error('Error checking operator penalty', { operator, error });
        }
      }

      this.logger.info('Completed penalty monitoring cycle');
    } catch (error) {
      this.logger.error('Error monitoring all operators', { error });
      throw error;
    }
  }

  /**
   * Check and update penalty status for a single operator
   */
  async checkOperatorPenalty(operatorAddress: string): Promise<void> {
    try {
      this.logger.debug('Checking operator penalty', { operator: operatorAddress });

      // Get current status
      const currentStatus = await this.getOperatorStatus(operatorAddress);

      // Get current trust score
      const trustScore = await this.trustFingerprintContract.getTrustScore(operatorAddress);
      const trustScoreNumber = Number(trustScore);

      this.logger.debug('Operator trust score', {
        operator: operatorAddress,
        trustScore: trustScoreNumber,
        currentTier: PenaltyTier[currentStatus.currentTier],
      });

      // Check and update penalty tier on-chain
      const tx = await this.penaltyManagerContract.checkAndUpdatePenaltyTier(operatorAddress);
      const receipt = await tx.wait();

      this.logger.info('Penalty tier check completed', {
        operator: operatorAddress,
        txHash: receipt.hash,
        gasUsed: receipt.gasUsed.toString(),
      });

      // Get updated status
      const newStatus = await this.getOperatorStatus(operatorAddress);

      // Check if tier changed
      if (newStatus.currentTier !== currentStatus.currentTier) {
        this.logger.info('Operator penalty tier changed', {
          operator: operatorAddress,
          previousTier: PenaltyTier[currentStatus.currentTier],
          newTier: PenaltyTier[newStatus.currentTier],
          trustScore: trustScoreNumber,
        });

        // Send notification
        await this.sendPenaltyNotification({
          operatorAddress,
          tier: newStatus.currentTier,
          trustScore: trustScoreNumber,
          gracePeriodEnd: newStatus.gracePeriodEnd,
          issues: await this.identifyIssues(operatorAddress, trustScoreNumber),
          recoveryPath: this.getRecoveryPath(newStatus.currentTier),
        });

        // Trigger governance review if needed
        if (
          newStatus.currentTier === PenaltyTier.PROBATION ||
          newStatus.currentTier === PenaltyTier.CRITICAL ||
          newStatus.currentTier === PenaltyTier.SLASHED
        ) {
          await this.triggerGovernanceReview(operatorAddress, newStatus.currentTier, trustScoreNumber);
        }
      }
    } catch (error) {
      this.logger.error('Error checking operator penalty', { operator: operatorAddress, error });
      throw error;
    }
  }

  /**
   * Get operator penalty status
   */
  async getOperatorStatus(operatorAddress: string): Promise<PenaltyStatus> {
    try {
      const status = await this.penaltyManagerContract.getOperatorStatus(operatorAddress);

      return {
        currentTier: Number(status.currentTier),
        tierEnteredAt: Number(status.tierEnteredAt),
        gracePeriodEnd: Number(status.gracePeriodEnd),
        previousTrustScore: Number(status.previousTrustScore),
        consecutiveDaysAboveThreshold: Number(status.consecutiveDaysAboveThreshold),
        isPaused: status.isPaused,
        pauseReason: status.pauseReason,
        pausedBy: status.pausedBy,
        pausedAt: Number(status.pausedAt),
      };
    } catch (error) {
      this.logger.error('Error getting operator status', { operator: operatorAddress, error });
      throw error;
    }
  }

  /**
   * Get penalty multiplier for an operator
   */
  async getPenaltyMultiplier(operatorAddress: string): Promise<number> {
    try {
      const multiplier = await this.penaltyManagerContract.getPenaltyMultiplier(operatorAddress);
      return Number(multiplier) / 10000; // Convert from basis points to decimal
    } catch (error) {
      this.logger.error('Error getting penalty multiplier', { operator: operatorAddress, error });
      throw error;
    }
  }

  /**
   * Identify specific issues causing low trust score
   */
  async identifyIssues(operatorAddress: string, trustScore: number): Promise<string[]> {
    const issues: string[] = [];

    try {
      // Get trust score components
      const components = await this.trustFingerprintContract.getComponents(operatorAddress);

      // Check each component (components are out of 10000)
      if (Number(components.uptime) < 9500) {
        const uptimePercent = (Number(components.uptime) / 100).toFixed(2);
        issues.push(`Uptime: ${uptimePercent}% (target: 95%+)`);
      }

      if (Number(components.quality) < 9500) {
        const qualityPercent = (Number(components.quality) / 100).toFixed(2);
        issues.push(`Quality: ${qualityPercent}% (target: 95%+)`);
      }

      if (Number(components.governance) < 5000) {
        const govPercent = (Number(components.governance) / 100).toFixed(2);
        issues.push(`Governance participation: ${govPercent}% (target: 50%+)`);
      }

      if (Number(components.peer) < 7000) {
        const peerPercent = (Number(components.peer) / 100).toFixed(2);
        issues.push(`Peer reputation: ${peerPercent}% (target: 70%+)`);
      }

      if (issues.length === 0) {
        issues.push('Overall trust score below threshold');
      }
    } catch (error) {
      this.logger.error('Error identifying issues', { operator: operatorAddress, error });
      issues.push('Unable to determine specific issues');
    }

    return issues;
  }

  /**
   * Get recovery path description for a penalty tier
   */
  getRecoveryPath(tier: PenaltyTier): string {
    switch (tier) {
      case PenaltyTier.WARNING:
        return 'Improve trust score above 75% for 3 consecutive days';
      case PenaltyTier.PROBATION:
        return 'Improve trust score above 75% for 7 consecutive days and pass governance review';
      case PenaltyTier.CRITICAL:
        return 'Improve trust score above 75% for 14 consecutive days, submit incident report, and pass governance review';
      case PenaltyTier.SLASHED:
        return 'Appeal to governance for review. Re-application possible after 90-day cooldown';
      default:
        return 'Maintain trust score above 75%';
    }
  }

  /**
   * Send penalty notification to operator
   */
  async sendPenaltyNotification(notification: PenaltyNotification): Promise<void> {
    try {
      this.logger.info('Sending penalty notification', {
        operator: notification.operatorAddress,
        tier: PenaltyTier[notification.tier],
      });

      // TODO: Integrate with actual notification service (email, SMS, push)
      // For now, just log the notification

      const tierName = PenaltyTier[notification.tier];
      const gracePeriodDays = Math.ceil((notification.gracePeriodEnd - Date.now() / 1000) / 86400);

      this.logger.info('Penalty notification details', {
        operator: notification.operatorAddress,
        tier: tierName,
        trustScore: notification.trustScore,
        gracePeriodDays,
        issues: notification.issues,
        recoveryPath: notification.recoveryPath,
      });

      // In production, send actual email/SMS/push notifications here
      // Example:
      // await this.emailService.sendPenaltyNotification(notification);
      // await this.smsService.sendPenaltyAlert(notification);
      // await this.pushService.sendPenaltyAlert(notification);
    } catch (error) {
      this.logger.error('Error sending penalty notification', {
        operator: notification.operatorAddress,
        error,
      });
    }
  }

  /**
   * Trigger governance review for an operator
   */
  async triggerGovernanceReview(
    operatorAddress: string,
    tier: PenaltyTier,
    trustScore: number
  ): Promise<void> {
    try {
      this.logger.info('Triggering governance review', {
        operator: operatorAddress,
        tier: PenaltyTier[tier],
        trustScore,
      });

      // TODO: Integrate with governance system
      // For now, just log the review trigger

      // In production, create governance proposal or alert governance members
      // Example:
      // await this.governanceService.createReviewProposal({
      //   operatorAddress,
      //   tier,
      //   trustScore,
      //   reason: 'Automatic penalty escalation',
      // });
    } catch (error) {
      this.logger.error('Error triggering governance review', {
        operator: operatorAddress,
        error,
      });
    }
  }

  /**
   * Setup event listeners for penalty events
   */
  setupEventListeners(): void {
    // Listen for PenaltyTierChanged events
    this.penaltyManagerContract.on(
      'PenaltyTierChanged',
      async (operator, previousTier, newTier, trustScore, gracePeriodEnd, event) => {
        this.logger.info('PenaltyTierChanged event received', {
          operator,
          previousTier: PenaltyTier[Number(previousTier)],
          newTier: PenaltyTier[Number(newTier)],
          trustScore: Number(trustScore),
          gracePeriodEnd: Number(gracePeriodEnd),
          txHash: event.log.transactionHash,
        });

        // Send notification
        await this.sendPenaltyNotification({
          operatorAddress: operator,
          tier: Number(newTier),
          trustScore: Number(trustScore),
          gracePeriodEnd: Number(gracePeriodEnd),
          issues: await this.identifyIssues(operator, Number(trustScore)),
          recoveryPath: this.getRecoveryPath(Number(newTier)),
        });
      }
    );

    // Listen for OperatorSlashed events
    this.penaltyManagerContract.on(
      'OperatorSlashed',
      async (operator, amount, percentage, trustScore, reason, event) => {
        this.logger.warn('OperatorSlashed event received', {
          operator,
          amount: ethers.formatEther(amount),
          percentage: Number(percentage) / 100,
          trustScore: Number(trustScore),
          reason,
          txHash: event.log.transactionHash,
        });

        // Send critical notification
        await this.sendPenaltyNotification({
          operatorAddress: operator,
          tier: PenaltyTier.SLASHED,
          trustScore: Number(trustScore),
          gracePeriodEnd: 0,
          issues: [reason],
          recoveryPath: this.getRecoveryPath(PenaltyTier.SLASHED),
        });
      }
    );

    // Listen for NetworkHealthCritical events
    this.penaltyManagerContract.on(
      'NetworkHealthCritical',
      async (totalOperators, penalizedOperators, penaltyRate, event) => {
        this.logger.error('NetworkHealthCritical event received', {
          totalOperators: Number(totalOperators),
          penalizedOperators: Number(penalizedOperators),
          penaltyRate: Number(penaltyRate) / 100,
          txHash: event.log.transactionHash,
        });

        // Trigger emergency governance review
        // TODO: Implement emergency notification system
      }
    );

    this.logger.info('Penalty event listeners setup complete');
  }

  /**
   * Pause penalty for an operator (Guardian action)
   */
  async pausePenalty(operatorAddress: string, reason: string): Promise<void> {
    try {
      this.logger.info('Pausing penalty for operator', { operator: operatorAddress, reason });

      const tx = await this.penaltyManagerContract.pausePenalty(operatorAddress, reason);
      const receipt = await tx.wait();

      this.logger.info('Penalty paused successfully', {
        operator: operatorAddress,
        txHash: receipt.hash,
      });
    } catch (error) {
      this.logger.error('Error pausing penalty', { operator: operatorAddress, error });
      throw error;
    }
  }

  /**
   * Resume penalty for an operator (Governance action)
   */
  async resumePenalty(operatorAddress: string): Promise<void> {
    try {
      this.logger.info('Resuming penalty for operator', { operator: operatorAddress });

      const tx = await this.penaltyManagerContract.resumePenalty(operatorAddress);
      const receipt = await tx.wait();

      this.logger.info('Penalty resumed successfully', {
        operator: operatorAddress,
        txHash: receipt.hash,
      });
    } catch (error) {
      this.logger.error('Error resuming penalty', { operator: operatorAddress, error });
      throw error;
    }
  }

  /**
   * Extend grace period for an operator (Guardian action)
   */
  async extendGracePeriod(
    operatorAddress: string,
    extensionSeconds: number,
    reason: string
  ): Promise<void> {
    try {
      this.logger.info('Extending grace period for operator', {
        operator: operatorAddress,
        extensionDays: extensionSeconds / 86400,
        reason,
      });

      const tx = await this.penaltyManagerContract.extendGracePeriod(
        operatorAddress,
        extensionSeconds,
        reason
      );
      const receipt = await tx.wait();

      this.logger.info('Grace period extended successfully', {
        operator: operatorAddress,
        txHash: receipt.hash,
      });
    } catch (error) {
      this.logger.error('Error extending grace period', { operator: operatorAddress, error });
      throw error;
    }
  }

  /**
   * Pause all penalty escalations (Emergency action)
   */
  async pauseEscalations(reason: string): Promise<void> {
    try {
      this.logger.warn('Pausing all penalty escalations', { reason });

      const tx = await this.penaltyManagerContract.pauseEscalations(reason);
      const receipt = await tx.wait();

      this.logger.warn('All penalty escalations paused', {
        txHash: receipt.hash,
      });
    } catch (error) {
      this.logger.error('Error pausing escalations', { error });
      throw error;
    }
  }

  /**
   * Resume all penalty escalations (Governance action)
   */
  async resumeEscalations(): Promise<void> {
    try {
      this.logger.info('Resuming all penalty escalations');

      const tx = await this.penaltyManagerContract.resumeEscalations();
      const receipt = await tx.wait();

      this.logger.info('All penalty escalations resumed', {
        txHash: receipt.hash,
      });
    } catch (error) {
      this.logger.error('Error resuming escalations', { error });
      throw error;
    }
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default PenaltyOrchestrator;
