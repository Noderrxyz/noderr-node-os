import { Logger } from 'winston';
import { RewardOrchestrator, OperatorPerformanceData, EpochConfig } from './RewardOrchestrator';
import { ethers } from 'ethers';

/**
 * Telemetry API client
 */
export interface TelemetryClient {
  getOperatorPerformance(startTime: number, endTime: number): Promise<OperatorPerformanceData[]>;
}

/**
 * HTTP Telemetry Client implementation
 */
export class HttpTelemetryClient implements TelemetryClient {
  private baseUrl: string;
  private logger: Logger;

  constructor(baseUrl: string, logger: Logger) {
    this.baseUrl = baseUrl;
    this.logger = logger;
  }

  async getOperatorPerformance(
    startTime: number,
    endTime: number
  ): Promise<OperatorPerformanceData[]> {
    try {
      const response = await fetch(
        `${this.baseUrl}/api/performance?start=${startTime}&end=${endTime}`
      );

      if (!response.ok) {
        throw new Error(`Telemetry API returned ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return data.operators || [];
    } catch (error: any) {
      this.logger.error('Failed to fetch operator performance from telemetry', {
        error: error.message,
      });
      throw error;
    }
  }
}

/**
 * RewardEpochScheduler
 * 
 * Runs the reward orchestrator on a schedule (e.g., daily, weekly)
 * 
 * Responsibilities:
 * - Fetch performance data from telemetry service
 * - Trigger reward orchestrator
 * - Handle errors and retries
 * - Log all actions
 */
export class RewardEpochScheduler {
  private orchestrator: RewardOrchestrator;
  private telemetryClient: TelemetryClient;
  private logger: Logger;
  private isRunning: boolean = false;
  private currentEpochId: number = 0;

  // Configuration
  private epochDurationSeconds: number;
  private baseRewardRate: bigint;
  private vestingDuration: number;

  constructor(
    orchestrator: RewardOrchestrator,
    telemetryClient: TelemetryClient,
    logger: Logger,
    config: {
      epochDurationSeconds?: number;
      baseRewardRate?: bigint;
      vestingDuration?: number;
    } = {}
  ) {
    this.orchestrator = orchestrator;
    this.telemetryClient = telemetryClient;
    this.logger = logger;

    // Default configuration
    this.epochDurationSeconds = config.epochDurationSeconds || 86400; // 24 hours
    this.baseRewardRate = config.baseRewardRate || ethers.parseEther('100'); // 100 NODR
    this.vestingDuration = config.vestingDuration || 90 * 86400; // 90 days

    this.logger.info('RewardEpochScheduler initialized', {
      epochDurationSeconds: this.epochDurationSeconds,
      baseRewardRate: ethers.formatEther(this.baseRewardRate),
      vestingDuration: this.vestingDuration,
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
    this.logger.info('Starting reward epoch scheduler');

    // Run immediately on start
    this.runEpoch().catch((error) => {
      this.logger.error('Initial epoch run failed', { error: error.message });
    });

    // Schedule periodic runs
    setInterval(() => {
      if (this.isRunning) {
        this.runEpoch().catch((error) => {
          this.logger.error('Scheduled epoch run failed', { error: error.message });
        });
      }
    }, this.epochDurationSeconds * 1000);

    this.logger.info('Reward epoch scheduler started', {
      intervalSeconds: this.epochDurationSeconds,
    });
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    this.isRunning = false;
    this.logger.info('Reward epoch scheduler stopped');
  }

  /**
   * Run a single epoch
   */
  private async runEpoch(): Promise<void> {
    const epochStartTime = Date.now();
    this.currentEpochId++;

    this.logger.info('Starting reward epoch', {
      epochId: this.currentEpochId,
      timestamp: new Date(epochStartTime).toISOString(),
    });

    try {
      // Calculate epoch time range
      const endTime = Math.floor(epochStartTime / 1000);
      const startTime = endTime - this.epochDurationSeconds;

      // Fetch performance data from telemetry
      this.logger.info('Fetching operator performance data', { startTime, endTime });
      const performanceData = await this.telemetryClient.getOperatorPerformance(
        startTime,
        endTime
      );

      this.logger.info('Fetched operator performance data', {
        operatorCount: performanceData.length,
      });

      if (performanceData.length === 0) {
        this.logger.warn('No operator performance data available, skipping epoch');
        return;
      }

      // Create epoch configuration
      const epochConfig: EpochConfig = {
        epochId: this.currentEpochId,
        startTime,
        endTime,
        baseRewardRate: this.baseRewardRate,
        vestingDuration: this.vestingDuration,
      };

      // Process the epoch
      await this.orchestrator.processEpoch(performanceData, epochConfig);

      const epochDuration = Date.now() - epochStartTime;
      this.logger.info('Reward epoch completed successfully', {
        epochId: this.currentEpochId,
        durationMs: epochDuration,
      });
    } catch (error: any) {
      this.logger.error('Reward epoch failed', {
        epochId: this.currentEpochId,
        error: error.message,
        stack: error.stack,
      });

      // TODO: Implement retry logic
      // TODO: Send alerts to operators
    }
  }

  /**
   * Manually trigger an epoch (for testing or emergency)
   */
  async triggerEpoch(): Promise<void> {
    this.logger.info('Manually triggering reward epoch');
    await this.runEpoch();
  }

  /**
   * Get current epoch ID
   */
  getCurrentEpochId(): number {
    return this.currentEpochId;
  }

  /**
   * Update configuration
   */
  updateConfig(config: {
    epochDurationSeconds?: number;
    baseRewardRate?: bigint;
    vestingDuration?: number;
  }): void {
    if (config.epochDurationSeconds !== undefined) {
      this.epochDurationSeconds = config.epochDurationSeconds;
    }
    if (config.baseRewardRate !== undefined) {
      this.baseRewardRate = config.baseRewardRate;
    }
    if (config.vestingDuration !== undefined) {
      this.vestingDuration = config.vestingDuration;
    }

    this.logger.info('Scheduler configuration updated', {
      epochDurationSeconds: this.epochDurationSeconds,
      baseRewardRate: ethers.formatEther(this.baseRewardRate),
      vestingDuration: this.vestingDuration,
    });
  }
}
