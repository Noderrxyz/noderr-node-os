/**
 * Profit Distribution Service
 * 
 * Monitors strategy proceeds and triggers profit distribution via FeeCollector.
 * 
 * The FeeCollector contract handles the stake-based calculation (2-20% based on NODR stake).
 * This service simply listens for proceeds events and calls FeeCollector.distributeStrategyFees().
 * 
 * Production-ready with error handling, logging, and event tracking.
 * 
 * @module ProfitDistributionService
 */

import { ethers } from 'ethers';
import { EventEmitter } from 'events';
import { Logger } from '@noderr/utils';

export interface ProfitDistribution {
  strategyId: string;
  totalProfit: bigint;
  timestamp: number;
  txHash: string;
}

export class ProfitDistributionService extends EventEmitter {
  private logger: Logger;
  private provider: ethers.Provider;
  private signer: ethers.Signer;
  private vaultManagerContract: ethers.Contract;
  private feeCollectorContract: ethers.Contract;
  
  private distributionHistory: ProfitDistribution[] = [];
  private isRunning: boolean = false;
  
  constructor(
    provider: ethers.Provider,
    signer: ethers.Signer,
    vaultManagerAddress: string,
    feeCollectorAddress: string,
    vaultManagerABI: any[],
    feeCollectorABI: any[]
  ) {
    super();
    this.logger = new Logger('ProfitDistributionService');
    this.provider = provider;
    this.signer = signer;
    
    this.vaultManagerContract = new ethers.Contract(
      vaultManagerAddress,
      vaultManagerABI,
      provider
    );
    
    this.feeCollectorContract = new ethers.Contract(
      feeCollectorAddress,
      feeCollectorABI,
      signer // Need signer to call distributeStrategyFees
    );
  }
  
  /**
   * Start listening for profit events
   */
  async start(): Promise<void> {
    try {
      this.logger.info('Starting ProfitDistributionService...');
      
      // Verify we have FEE_COLLECTOR_ROLE
      const FEE_COLLECTOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes('FEE_COLLECTOR_ROLE'));
      const signerAddress = await this.signer.getAddress();
      const hasRole = await this.feeCollectorContract.hasRole(FEE_COLLECTOR_ROLE, signerAddress);
      
      if (!hasRole) {
        throw new Error(`Signer ${signerAddress} does not have FEE_COLLECTOR_ROLE`);
      }
      
      this.logger.info(`Signer ${signerAddress} has FEE_COLLECTOR_ROLE ✓`);
      
      // Listen for strategy proceeds returned to VaultManager
      this.vaultManagerContract.on(
        'StrategyProceedsReceived',
        this.handleStrategyProceeds.bind(this)
      );
      
      this.isRunning = true;
      this.logger.info('ProfitDistributionService started successfully');
    } catch (error) {
      this.logger.error('Failed to start ProfitDistributionService:', error);
      throw error;
    }
  }
  
  /**
   * Stop the service
   */
  async stop(): Promise<void> {
    this.vaultManagerContract.removeAllListeners();
    this.isRunning = false;
    this.logger.info('ProfitDistributionService stopped');
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
      
      // Get the token address (USDC)
      const token = await this.vaultManagerContract.asset();
      
      this.logger.info(`Distributing ${ethers.formatUnits(profitLoss, 6)} USDC for strategy ${strategyId}...`);
      
      // Call FeeCollector.distributeStrategyFees()
      // The FeeCollector will:
      // 1. Query StakingManager for strategy stake
      // 2. Calculate profit share (2-20% based on stake)
      // 3. Distribute to submitter and protocol
      const tx = await this.feeCollectorContract.distributeStrategyFees(
        strategyId,
        profitLoss,
        token
      );
      
      this.logger.info(`Distribution transaction sent: ${tx.hash}`);
      
      const receipt = await tx.wait();
      
      if (receipt.status === 1) {
        this.logger.info(`✅ Profit distributed successfully for strategy ${strategyId}`);
        
        // Parse StrategyFeesDistributed event to get actual amounts
        const distributionEvent = receipt.logs
          .map((log: any) => {
            try {
              return this.feeCollectorContract.interface.parseLog(log);
            } catch {
              return null;
            }
          })
          .find((parsed: any) => parsed && parsed.name === 'StrategyFeesDistributed');
        
        if (distributionEvent) {
          const { nftHolderAmount, protocolAmount } = distributionEvent.args;
          this.logger.info(`Distribution breakdown:`, {
            submitter: ethers.formatUnits(nftHolderAmount, 6),
            protocol: ethers.formatUnits(protocolAmount, 6),
            submitterPercent: Number((nftHolderAmount * 10000n) / profitLoss) / 100,
            protocolPercent: Number((protocolAmount * 10000n) / profitLoss) / 100,
          });
        }
        
        // Record distribution
        const distribution: ProfitDistribution = {
          strategyId,
          totalProfit: profitLoss,
          timestamp: Date.now(),
          txHash: tx.hash,
        };
        
        this.distributionHistory.push(distribution);
        this.emit('profitDistributed', distribution);
        
      } else {
        this.logger.error(`❌ Distribution transaction failed for strategy ${strategyId}`);
      }
      
    } catch (error) {
      this.logger.error(`Failed to handle strategy proceeds for ${strategyId}:`, error);
      
      // Emit error event but don't throw (keep service running)
      this.emit('distributionError', {
        strategyId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  
  /**
   * Get distribution history for a strategy
   */
  getStrategyDistributions(strategyId: string): ProfitDistribution[] {
    return this.distributionHistory.filter(d => d.strategyId === strategyId);
  }
  
  /**
   * Get total distributed profit
   */
  getTotalDistributed(): bigint {
    return this.distributionHistory.reduce((total, d) => total + d.totalProfit, 0n);
  }
  
  /**
   * Check if service is running
   */
  isServiceRunning(): boolean {
    return this.isRunning;
  }
}

export default ProfitDistributionService;
