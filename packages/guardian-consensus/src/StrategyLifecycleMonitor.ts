/**
 * Strategy Lifecycle Monitor
 * 
 * Monitors strategy performance in real-time and manages lifecycle transitions:
 * 1. Tracks live strategy performance
 * 2. Calculates performance metrics (Sharpe, drawdown, P&L, win rate)
 * 3. Triggers automatic demotion on poor performance
 * 4. Initiates Guardian approval for promotions
 * 5. Manages capital allocation based on stage
 * 
 * This service integrates with:
 * - StrategyLifecycleManager.sol (updates performance, manages transitions)
 * - GuardianLotterySelector.sol (selects Guardians for approval)
 * - BacktestConsensus.sol (verifies strategy robustness)
 * - Validator nodes (receives trade execution data)
 */

import { ethers } from 'ethers';
import { EventEmitter } from 'events';
import { Logger } from '@noderr/utils';
import { Strategy, PerformanceMetrics, MonitorConfig } from '@noderr/types';

export interface StrategyPerformance {
  strategyId: string;
  totalPnL: bigint;
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
  tradesExecuted: number;
  lastUpdate: number;
}

export interface TransitionRequest {
  strategyId: string;
  currentStage: number;
  targetStage: number;
  reason: string;
  timestamp: number;
  status: 'pending' | 'approved' | 'rejected';
}

export class StrategyLifecycleMonitor extends EventEmitter {
  private logger: Logger;
  private provider: ethers.Provider;
  private wallet: ethers.Wallet;
  private lifecycleContract: ethers.Contract;
  private lotteryContract: ethers.Contract;
  private config: MonitorConfig;
  private performanceCache: Map<string, StrategyPerformance>;
  private transitionRequests: Map<string, TransitionRequest>;
  private isRunning: boolean;
  private monitorInterval: NodeJS.Timeout | null;

  constructor(
    provider: ethers.Provider,
    wallet: ethers.Wallet,
    lifecycleContractAddress: string,
    lotteryContractAddress: string,
    config: MonitorConfig
  ) {
    super();
    this.logger = new Logger('StrategyLifecycleMonitor');
    this.provider = provider;
    this.wallet = wallet;
    this.config = config;
    this.performanceCache = new Map();
    this.transitionRequests = new Map();
    this.isRunning = false;
    this.monitorInterval = null;

    // Initialize contracts
    this.lifecycleContract = new ethers.Contract(
      lifecycleContractAddress,
      [], // StrategyLifecycleManager ABI
      wallet
    );

    this.lotteryContract = new ethers.Contract(
      lotteryContractAddress,
      [], // GuardianLotterySelector ABI
      wallet
    );
  }

  /**
   * Start the Strategy Lifecycle Monitor
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Monitor already running');
      return;
    }

    this.logger.info('Starting Strategy Lifecycle Monitor...');
    this.isRunning = true;

    // Listen for strategy submission events
    this.lifecycleContract.on('StrategySubmitted', this.handleStrategySubmitted.bind(this));

    // Listen for transition events
    this.lifecycleContract.on('TransitionApprovalCreated', this.handleTransitionCreated.bind(this));
    this.lifecycleContract.on('TransitionExecuted', this.handleTransitionExecuted.bind(this));
    this.lifecycleContract.on('StrategyRetired', this.handleStrategyRetired.bind(this));

    // Listen for performance updates
    this.lifecycleContract.on('PerformanceUpdated', this.handlePerformanceUpdated.bind(this));

    // Start periodic monitoring
    this.monitorInterval = setInterval(
      () => this.monitorAllStrategies(),
      this.config.monitorIntervalMs || 60000 // Default: 1 minute
    );

    this.logger.info('Strategy Lifecycle Monitor started successfully');
    this.emit('started');
  }

  /**
   * Stop the Strategy Lifecycle Monitor
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.logger.info('Stopping Strategy Lifecycle Monitor...');
    this.isRunning = false;

    // Remove all event listeners
    this.lifecycleContract.removeAllListeners();

    // Stop periodic monitoring
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }

    this.logger.info('Strategy Lifecycle Monitor stopped');
    this.emit('stopped');
  }

  /**
   * Handle strategy submission event
   */
  private async handleStrategySubmitted(
    strategyId: string,
    developer: string,
    name: string
  ): Promise<void> {
    try {
      this.logger.info(`New strategy submitted: ${name} (${strategyId})`);

      // Initialize performance tracking
      const performance: StrategyPerformance = {
        strategyId,
        totalPnL: 0n,
        sharpeRatio: 0,
        maxDrawdown: 0,
        winRate: 0,
        tradesExecuted: 0,
        lastUpdate: Date.now()
      };

      this.performanceCache.set(strategyId, performance);
      this.emit('strategyAdded', strategyId);

    } catch (error) {
      this.logger.error('Error handling strategy submission:', error);
    }
  }

  /**
   * Handle transition approval creation event
   */
  private async handleTransitionCreated(
    transitionId: string,
    strategyId: string,
    targetStage: number
  ): Promise<void> {
    this.logger.info(`Transition approval created: ${transitionId} for strategy ${strategyId} to stage ${targetStage}`);
    this.emit('transitionCreated', transitionId, strategyId, targetStage);
  }

  /**
   * Handle transition execution event
   */
  private async handleTransitionExecuted(transitionId: string): Promise<void> {
    this.logger.info(`Transition executed: ${transitionId}`);
    this.emit('transitionExecuted', transitionId);
  }

  /**
   * Handle strategy retirement event
   */
  private async handleStrategyRetired(
    strategyId: string,
    reason: string
  ): Promise<void> {
    this.logger.info(`Strategy retired: ${strategyId} - ${reason}`);
    this.performanceCache.delete(strategyId);
    this.emit('strategyRetired', strategyId, reason);
  }

  /**
   * Handle performance update event
   */
  private async handlePerformanceUpdated(
    strategyId: string,
    totalPnL: bigint,
    sharpeRatio: number,
    maxDrawdown: number
  ): Promise<void> {
    this.logger.debug(`Performance updated for ${strategyId}`);
    
    const performance = this.performanceCache.get(strategyId);
    if (performance) {
      performance.totalPnL = totalPnL;
      performance.sharpeRatio = sharpeRatio;
      performance.maxDrawdown = maxDrawdown;
      performance.lastUpdate = Date.now();
    }
  }

  /**
   * Monitor all active strategies
   */
  private async monitorAllStrategies(): Promise<void> {
    try {
      // Get all active strategies from contract
      const strategies = await this.lifecycleContract.getAllStrategies();

      for (const strategyId of strategies) {
        await this.monitorStrategy(strategyId);
      }

    } catch (error) {
      this.logger.error('Error monitoring strategies:', error);
    }
  }

  /**
   * Monitor a single strategy
   */
  private async monitorStrategy(strategyId: string): Promise<void> {
    try {
      // Get strategy details
      const strategy = await this.lifecycleContract.getStrategy(strategyId);
      
      if (!strategy.isActive) {
        return; // Skip inactive strategies
      }

      // Get current performance
      const performance = await this.lifecycleContract.getPerformance(strategyId);

      // Update cache
      const cachedPerformance: StrategyPerformance = {
        strategyId,
        totalPnL: performance.totalPnL,
        sharpeRatio: performance.sharpeRatio,
        maxDrawdown: performance.maxDrawdown,
        winRate: performance.winRate,
        tradesExecuted: performance.tradesExecuted,
        lastUpdate: Date.now()
      };
      this.performanceCache.set(strategyId, cachedPerformance);

      // Check if promotion is warranted
      await this.checkForPromotion(strategyId, strategy, performance);

      // Check if demotion is needed (handled automatically by contract)
      // But we can log warnings
      await this.checkForDemotionWarnings(strategyId, strategy, performance);

    } catch (error) {
      this.logger.error(`Error monitoring strategy ${strategyId}:`, error);
    }
  }

  /**
   * Check if strategy is ready for promotion
   */
  private async checkForPromotion(
    strategyId: string,
    strategy: any,
    performance: any
  ): Promise<void> {
    // Get promotion thresholds from contract
    const minSharpe = await this.lifecycleContract.minSharpeForPromotion();
    const maxDrawdown = await this.lifecycleContract.maxDrawdownForPromotion();
    const minTrades = await this.lifecycleContract.minTradesForPromotion();

    // Check if strategy meets promotion criteria
    const meetsSharpeCriteria = performance.sharpeRatio >= minSharpe;
    const meetsDrawdownCriteria = performance.maxDrawdown <= maxDrawdown;
    const meetsTradeCriteria = performance.tradesExecuted >= minTrades;

    if (meetsSharpeCriteria && meetsDrawdownCriteria && meetsTradeCriteria) {
      // Check current stage
      if (strategy.stage === 0) {
        // Shadow → LimitedLive
        await this.initiatePromotion(strategyId, 1, 'Performance meets criteria for Limited Live');
      } else if (strategy.stage === 1) {
        // LimitedLive → FullLive
        await this.initiatePromotion(strategyId, 2, 'Performance meets criteria for Full Live');
      }
    }
  }

  /**
   * Check for demotion warnings
   */
  private async checkForDemotionWarnings(
    strategyId: string,
    strategy: any,
    performance: any
  ): Promise<void> {
    // Get demotion thresholds
    const maxDrawdownDemotion = await this.lifecycleContract.maxDrawdownForDemotion();
    const minPnLDemotion = await this.lifecycleContract.minPnLForDemotion();

    // Check if strategy is approaching demotion thresholds
    const drawdownWarning = performance.maxDrawdown > (maxDrawdownDemotion * 0.8); // 80% of threshold
    const pnlWarning = performance.totalPnL < (minPnLDemotion * 0.8);

    if (drawdownWarning) {
      this.logger.warn(`Strategy ${strategyId} approaching drawdown limit: ${performance.maxDrawdown / 100}%`);
      this.emit('demotionWarning', strategyId, 'drawdown', performance.maxDrawdown);
    }

    if (pnlWarning) {
      this.logger.warn(`Strategy ${strategyId} approaching P&L limit: ${ethers.formatEther(performance.totalPnL)} ETH`);
      this.emit('demotionWarning', strategyId, 'pnl', performance.totalPnL);
    }
  }

  /**
   * Initiate strategy promotion
   */
  private async initiatePromotion(
    strategyId: string,
    targetStage: number,
    reason: string
  ): Promise<void> {
    try {
      this.logger.info(`Initiating promotion for ${strategyId} to stage ${targetStage}: ${reason}`);

      // Select Guardian committee for approval
      const committeeSize = 3; // Require 3 Guardians
      const approvalsRequired = 2; // Require 2 out of 3 approvals
      const expiresIn = 7 * 24 * 60 * 60; // 7 days

      // Select committee using lottery
      const selectionTx = await this.lotteryContract.selectCommittee(strategyId);
      await selectionTx.wait();

      // Get selected Guardians
      const selection = await this.lotteryContract.getSelectionByStrategy(strategyId);
      const guardians = selection.selectedGuardians.slice(0, committeeSize);

      // Create transition approval request
      const tx = await this.lifecycleContract.createTransitionApproval(
        strategyId,
        targetStage,
        guardians,
        approvalsRequired,
        expiresIn
      );

      const receipt = await tx.wait();
      this.logger.info(`Promotion initiated successfully. Tx: ${receipt.hash}`);

      // Track transition request
      const request: TransitionRequest = {
        strategyId,
        currentStage: targetStage - 1,
        targetStage,
        reason,
        timestamp: Date.now(),
        status: 'pending'
      };
      this.transitionRequests.set(strategyId, request);

      this.emit('promotionInitiated', strategyId, targetStage);

    } catch (error) {
      this.logger.error(`Error initiating promotion for ${strategyId}:`, error);
    }
  }

  /**
   * Update strategy performance manually
   * 
   * This would be called by Validator nodes after trade execution
   */
  async updatePerformance(
    strategyId: string,
    metrics: PerformanceMetrics
  ): Promise<void> {
    try {
      this.logger.info(`Updating performance for ${strategyId}...`);

      // Scale metrics for smart contract (multiply by 10000)
      const totalPnL = ethers.parseEther(metrics.totalPnL.toString());
      const sharpeRatio = Math.round(metrics.sharpeRatio * 10000);
      const maxDrawdown = Math.round(metrics.maxDrawdown * 10000);
      const winRate = Math.round(metrics.winRate * 10000);
      const tradesExecuted = metrics.tradesExecuted;

      const tx = await this.lifecycleContract.updatePerformance(
        strategyId,
        totalPnL,
        sharpeRatio,
        maxDrawdown,
        winRate,
        tradesExecuted
      );

      const receipt = await tx.wait();
      this.logger.info(`Performance updated successfully. Tx: ${receipt.hash}`);

      this.emit('performanceUpdated', strategyId, metrics);

    } catch (error) {
      this.logger.error(`Error updating performance for ${strategyId}:`, error);
      throw error;
    }
  }

  /**
   * Manually retire a strategy
   */
  async retireStrategy(strategyId: string, reason: string): Promise<void> {
    try {
      this.logger.info(`Retiring strategy ${strategyId}: ${reason}`);

      const tx = await this.lifecycleContract.retireStrategy(strategyId, reason);
      const receipt = await tx.wait();

      this.logger.info(`Strategy retired successfully. Tx: ${receipt.hash}`);
      this.performanceCache.delete(strategyId);

      this.emit('strategyRetired', strategyId, reason);

    } catch (error) {
      this.logger.error(`Error retiring strategy ${strategyId}:`, error);
      throw error;
    }
  }

  /**
   * Get monitor status
   */
  getStatus(): {
    isRunning: boolean;
    trackedStrategies: number;
    pendingTransitions: number;
  } {
    return {
      isRunning: this.isRunning,
      trackedStrategies: this.performanceCache.size,
      pendingTransitions: Array.from(this.transitionRequests.values())
        .filter(r => r.status === 'pending').length
    };
  }

  /**
   * Get all tracked strategies
   */
  getTrackedStrategies(): StrategyPerformance[] {
    return Array.from(this.performanceCache.values());
  }

  /**
   * Get strategy performance
   */
  getStrategyPerformance(strategyId: string): StrategyPerformance | undefined {
    return this.performanceCache.get(strategyId);
  }

  /**
   * Get pending transitions
   */
  getPendingTransitions(): TransitionRequest[] {
    return Array.from(this.transitionRequests.values())
      .filter(r => r.status === 'pending');
  }
}
