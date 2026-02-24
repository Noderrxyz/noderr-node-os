import { ethers } from 'ethers';
import { Logger } from '@noderr/utils';
import { EventLog } from 'ethers';
import { EventEmitter } from 'events';

/**
 * ProfitDistributionServiceV2
 * 
 * Calculates and distributes performance fees based on stake-based reward tiers.
 * 
 * Fee Structure:
 * 1. Vault collects performance fee from LPs (0.5-25% depending on vault type)
 * 2. Strategy submitter earns 2-20% of strategy profits based on NODR stake:
 *    - 100 NODR → 2%
 *    - 1K NODR → 5%
 *    - 10K NODR → 10%
 *    - 50K NODR → 15%
 *    - 100K+ NODR → 20%
 * 3. Protocol receives remaining (80-98%)
 * 
 * Production-ready with error handling, logging, and event tracking.
 */

interface StakeTier {
  minStake: bigint;
  profitShareBps: number; // Basis points (100 = 1%)
}

interface StrategyStake {
  strategyId: string;
  submitter: string;
  stakeAmount: bigint;
  profitShareBps: number;
}

interface ProfitDistribution {
  strategyId: string;
  totalProfit: bigint;
  submitterShare: bigint;
  protocolShare: bigint;
  submitterAddress: string;
  timestamp: number;
}

export class ProfitDistributionServiceV2 extends EventEmitter {
  private logger: Logger;
  private provider: ethers.Provider;
  private vaultManagerContract: ethers.Contract;
  private feeCollectorContract: ethers.Contract;
  private strategyRegistryContract: ethers.Contract;
  private stakingManagerContract: ethers.Contract;
  
  // Stake tiers (from dApp SubmitStrategy.tsx)
  private readonly STAKE_TIERS: StakeTier[] = [
    { minStake: ethers.parseUnits('100', 18), profitShareBps: 200 },      // 2%
    { minStake: ethers.parseUnits('1000', 18), profitShareBps: 500 },     // 5%
    { minStake: ethers.parseUnits('10000', 18), profitShareBps: 1000 },   // 10%
    { minStake: ethers.parseUnits('50000', 18), profitShareBps: 1500 },   // 15%
    { minStake: ethers.parseUnits('100000', 18), profitShareBps: 2000 },  // 20%
  ];
  
  private strategyStakes: Map<string, StrategyStake> = new Map();
  private distributionHistory: ProfitDistribution[] = [];
  
  constructor(
    provider: ethers.Provider,
    vaultManagerAddress: string,
    feeCollectorAddress: string,
    strategyRegistryAddress: string,
    stakingManagerAddress: string,
    vaultManagerABI: any[],
    feeCollectorABI: any[],
    strategyRegistryABI: any[],
    stakingManagerABI: any[]
  ) {
    super();
    this.logger = new Logger('ProfitDistributionServiceV2');
    this.provider = provider;
    
    this.vaultManagerContract = new ethers.Contract(
      vaultManagerAddress,
      vaultManagerABI,
      provider
    );
    
    this.feeCollectorContract = new ethers.Contract(
      feeCollectorAddress,
      feeCollectorABI,
      provider
    );
    
    this.strategyRegistryContract = new ethers.Contract(
      strategyRegistryAddress,
      strategyRegistryABI,
      provider
    );
    
    this.stakingManagerContract = new ethers.Contract(
      stakingManagerAddress,
      stakingManagerABI,
      provider
    );
  }
  
  /**
   * Start listening for profit events
   */
  async start(): Promise<void> {
    try {
      this.logger.info('Starting ProfitDistributionServiceV2...');
      
      // Listen for strategy proceeds returned to VaultManager
      this.vaultManagerContract.on(
        'StrategyProceedsReceived',
        this.handleStrategyProceeds.bind(this)
      );
      
      // Listen for strategy stake updates
      this.stakingManagerContract.on(
        'StrategyStakeUpdated',
        this.handleStakeUpdate.bind(this)
      );
      
      // Load existing strategy stakes
      await this.loadStrategyStakes();
      
      this.logger.info('ProfitDistributionServiceV2 started successfully');
    } catch (error) {
      this.logger.error('Failed to start ProfitDistributionServiceV2:', error);
      throw error;
    }
  }
  
  /**
   * Stop the service
   */
  async stop(): Promise<void> {
    this.vaultManagerContract.removeAllListeners();
    this.stakingManagerContract.removeAllListeners();
    this.logger.info('ProfitDistributionServiceV2 stopped');
  }
  
  /**
   * Load strategy stakes from StakingManager
   */
  private async loadStrategyStakes(): Promise<void> {
    try {
      this.logger.info('Loading strategy stakes...');
      
      // Get all LIVE strategies from StrategyRegistry
      const filter = this.strategyRegistryContract.filters.StrategyStatusChanged(
        null,
        null,
        5 // LIVE status
      );
      
      const events = await this.strategyRegistryContract.queryFilter(filter);
      
      for (const event of events) {
        const strategyId = (event as EventLog).args?.strategyId;
        if (strategyId) {
          await this.loadStrategyStake(strategyId);
        }
      }
      
      this.logger.info(`Loaded ${this.strategyStakes.size} strategy stakes`);
    } catch (error) {
      this.logger.error('Failed to load strategy stakes:', error);
    }
  }
  
  /**
   * Load stake information for a specific strategy
   */
  private async loadStrategyStake(strategyId: string): Promise<void> {
    try {
      // Get strategy details from StrategyRegistry
      const strategy = await this.strategyRegistryContract.getStrategy(strategyId);
      const submitter = strategy.submitter;
      
      // Get stake amount from StakingManager
      const stakeAmount = await this.stakingManagerContract.getStrategyStake(strategyId);
      
      // Calculate profit share based on stake tier
      const profitShareBps = this.calculateProfitShare(stakeAmount);
      
      this.strategyStakes.set(strategyId, {
        strategyId,
        submitter,
        stakeAmount,
        profitShareBps,
      });
      
      this.logger.debug(`Loaded stake for strategy ${strategyId}: ${ethers.formatUnits(stakeAmount, 18)} NODR → ${profitShareBps / 100}%`);
    } catch (error) {
      this.logger.error(`Failed to load stake for strategy ${strategyId}:`, error);
    }
  }
  
  /**
   * Calculate profit share percentage based on stake amount
   */
  private calculateProfitShare(stakeAmount: bigint): number {
    // Find the appropriate tier
    for (let i = this.STAKE_TIERS.length - 1; i >= 0; i--) {
      if (stakeAmount >= this.STAKE_TIERS[i].minStake) {
        return this.STAKE_TIERS[i].profitShareBps;
      }
    }
    
    // Below minimum stake
    return 0;
  }
  
  /**
   * Handle strategy proceeds received event
   */
  private async handleStrategyProceeds(
    strategyId: string,
    amount: bigint,
    profitLoss: bigint,
    event: any
  ): Promise<void> {
    try {
      this.logger.info(`Strategy proceeds received: ${strategyId}, P&L: ${ethers.formatUnits(profitLoss, 6)} USDC`);
      
      // Only distribute if there's profit
      if (profitLoss <= 0n) {
        this.logger.debug(`No profit to distribute for strategy ${strategyId}`);
        return;
      }
      
      // Get strategy stake info
      let stakeInfo = this.strategyStakes.get(strategyId);
      if (!stakeInfo) {
        // Load it if not cached
        await this.loadStrategyStake(strategyId);
        stakeInfo = this.strategyStakes.get(strategyId);
      }
      
      if (!stakeInfo) {
        this.logger.error(`No stake info found for strategy ${strategyId}`);
        return;
      }
      
      // Calculate distribution
      const submitterShareBps = stakeInfo.profitShareBps;
      const protocolShareBps = 10000 - submitterShareBps; // Remaining goes to protocol
      
      const submitterShare = (profitLoss * BigInt(submitterShareBps)) / 10000n;
      const protocolShare = profitLoss - submitterShare;
      
      this.logger.info(`Profit distribution for ${strategyId}:`, {
        totalProfit: ethers.formatUnits(profitLoss, 6),
        submitterShare: ethers.formatUnits(submitterShare, 6),
        submitterPercent: submitterShareBps / 100,
        protocolShare: ethers.formatUnits(protocolShare, 6),
        protocolPercent: protocolShareBps / 100,
      });
      
      // Distribute to submitter
      if (submitterShare > 0n) {
        await this.distributeToSubmitter(
          strategyId,
          stakeInfo.submitter,
          submitterShare
        );
      }
      
      // Distribute to protocol via FeeCollector
      if (protocolShare > 0n) {
        await this.distributeToProtocol(strategyId, protocolShare);
      }
      
      // Record distribution
      const distribution: ProfitDistribution = {
        strategyId,
        totalProfit: profitLoss,
        submitterShare,
        protocolShare,
        submitterAddress: stakeInfo.submitter,
        timestamp: Date.now(),
      };
      
      this.distributionHistory.push(distribution);
      this.emit('profitDistributed', distribution);
      
    } catch (error) {
      this.logger.error(`Failed to handle strategy proceeds for ${strategyId}:`, error);
    }
  }
  
  /**
   * Distribute profit to strategy submitter
   */
  private async distributeToSubmitter(
    strategyId: string,
    submitter: string,
    amount: bigint
  ): Promise<void> {
    try {
      this.logger.info(`Distributing ${ethers.formatUnits(amount, 6)} USDC to submitter ${submitter}`);
      
      // Call FeeCollector to distribute to submitter
      // Note: This requires FEE_COLLECTOR_ROLE
      const tx = await this.feeCollectorContract.distributeToSubmitter(
        strategyId,
        submitter,
        amount
      );
      
      await tx.wait();
      
      this.logger.info(`Successfully distributed to submitter. Tx: ${tx.hash}`);
    } catch (error) {
      this.logger.error(`Failed to distribute to submitter:`, error);
      throw error;
    }
  }
  
  /**
   * Distribute profit to protocol treasury
   */
  private async distributeToProtocol(
    strategyId: string,
    amount: bigint
  ): Promise<void> {
    try {
      this.logger.info(`Distributing ${ethers.formatUnits(amount, 6)} USDC to protocol`);
      
      // Call FeeCollector to collect protocol fees
      const tx = await this.feeCollectorContract.collectProtocolFees(
        strategyId,
        amount
      );
      
      await tx.wait();
      
      this.logger.info(`Successfully distributed to protocol. Tx: ${tx.hash}`);
    } catch (error) {
      this.logger.error(`Failed to distribute to protocol:`, error);
      throw error;
    }
  }
  
  /**
   * Handle stake update event
   */
  private async handleStakeUpdate(
    strategyId: string,
    submitter: string,
    newStake: bigint,
    event: any
  ): Promise<void> {
    try {
      this.logger.info(`Stake updated for strategy ${strategyId}: ${ethers.formatUnits(newStake, 18)} NODR`);
      
      const profitShareBps = this.calculateProfitShare(newStake);
      
      this.strategyStakes.set(strategyId, {
        strategyId,
        submitter,
        stakeAmount: newStake,
        profitShareBps,
      });
      
      this.logger.info(`Updated profit share for ${strategyId}: ${profitShareBps / 100}%`);
    } catch (error) {
      this.logger.error(`Failed to handle stake update for ${strategyId}:`, error);
    }
  }
  
  /**
   * Get distribution history for a strategy
   */
  getStrategyDistributions(strategyId: string): ProfitDistribution[] {
    return this.distributionHistory.filter(d => d.strategyId === strategyId);
  }
  
  /**
   * Get total earnings for a submitter
   */
  getSubmitterEarnings(submitter: string): bigint {
    return this.distributionHistory
      .filter(d => d.submitterAddress.toLowerCase() === submitter.toLowerCase())
      .reduce((total, d) => total + d.submitterShare, 0n);
  }
  
  /**
   * Get current stake info for a strategy
   */
  getStrategyStake(strategyId: string): StrategyStake | undefined {
    return this.strategyStakes.get(strategyId);
  }
}
