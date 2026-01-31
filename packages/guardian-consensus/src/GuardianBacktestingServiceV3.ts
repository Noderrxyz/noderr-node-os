/**
 * Guardian Backtesting Service V3.0
 * 
 * Updated for StrategyRegistry v3.0 with GuardianWorkloadManager integration
 * 
 * Key Changes from v2.0:
 * - Listens to StrategyRegistry.GuardiansAssignedToStrategy instead of GuardianLotterySelector.CommitteeSelected
 * - Submits results to StrategyRegistry.submitBacktestResult() instead of BacktestConsensus
 * - Works with committee-based Guardian selection (5 Guardians per strategy)
 * - Integrates with GuardianWorkloadManager for workload tracking
 * 
 * Workflow:
 * 1. Listen for GuardiansAssignedToStrategy event from StrategyRegistry
 * 2. Check if this Guardian is in the assigned list
 * 3. Fetch strategy details from StrategyRegistry
 * 4. Run backtest using BacktestingFramework
 * 5. Calculate performance metrics
 * 6. Submit result to StrategyRegistry.submitBacktestResult()
 * 7. GuardianWorkloadManager automatically updates workload
 */

import { ethers } from 'ethers';
import { EventEmitter } from 'events';
import { Logger } from '@noderr/utils';
import { Strategy, BacktestResult, GuardianNodeConfig } from '@noderr/types';

export interface BacktestMetrics {
  sharpeRatio: number;      // Scaled by 100 (e.g., 150 = 1.5)
  maxDrawdown: number;       // In basis points (e.g., 1500 = 15%)
  winRate: number;           // In basis points (e.g., 6000 = 60%)
  totalReturn: number;       // Scaled by 100 (e.g., 250 = 2.5x)
  tradesExecuted: number;
  avgTradeReturn: number;
  volatility: number;
  calmarRatio: number;
  overfittingScore: number;  // 0-100, higher = more overfitting
}

export interface StrategyAssignment {
  strategyId: string;
  assignedGuardians: string[];
  assignmentTimestamp: number;
  status: 'assigned' | 'backtesting' | 'submitted' | 'failed';
  backtestStartTime?: number;
  backtestEndTime?: number;
}

export class GuardianBacktestingServiceV3 extends EventEmitter {
  private logger: Logger;
  private provider: ethers.Provider;
  private wallet: ethers.Wallet;
  private strategyRegistry: ethers.Contract;
  private guardianWorkloadManager: ethers.Contract;
  private backtestingFramework: any; // BacktestingFramework
  private config: GuardianNodeConfig;
  private activeAssignments: Map<string, StrategyAssignment>;
  private isRunning: boolean;
  private myAddress: string;

  // Performance thresholds (from White Paper)
  private readonly MIN_SHARPE_RATIO = 100;        // 1.0
  private readonly MAX_DRAWDOWN = 2000;            // 20%
  private readonly MIN_WIN_RATE = 5500;            // 55%
  private readonly MIN_TRADES = 50;
  private readonly MAX_OVERFITTING_SCORE = 70;    // 70/100

  constructor(
    provider: ethers.Provider,
    wallet: ethers.Wallet,
    strategyRegistryAddress: string,
    guardianWorkloadManagerAddress: string,
    config: GuardianNodeConfig
  ) {
    super();
    this.logger = new Logger('GuardianBacktestingServiceV3');
    this.provider = provider;
    this.wallet = wallet;
    this.config = config;
    this.activeAssignments = new Map();
    this.isRunning = false;
    this.myAddress = wallet.address;

    // Initialize StrategyRegistry contract
    this.strategyRegistry = new ethers.Contract(
      strategyRegistryAddress,
      this.getStrategyRegistryABI(),
      wallet
    );

    // Initialize GuardianWorkloadManager contract
    this.guardianWorkloadManager = new ethers.Contract(
      guardianWorkloadManagerAddress,
      this.getGuardianWorkloadManagerABI(),
      wallet
    );

    // TODO: Initialize backtesting framework when available
    this.backtestingFramework = null;

    this.logger.info('GuardianBacktestingServiceV3 initialized', {
      guardian: this.myAddress,
      strategyRegistry: strategyRegistryAddress,
      guardianWorkloadManager: guardianWorkloadManagerAddress
    });
  }

  /**
   * Start the Guardian Backtesting Service
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Service already running');
      return;
    }

    this.logger.info('Starting Guardian Backtesting Service V3...');
    this.isRunning = true;

    // Listen for Guardian assignment events from StrategyRegistry
    this.strategyRegistry.on(
      'GuardiansAssignedToStrategy',
      this.handleGuardiansAssigned.bind(this)
    );

    // Listen for strategy status changes
    this.strategyRegistry.on(
      'StrategyStatusChanged',
      this.handleStrategyStatusChanged.bind(this)
    );

    this.logger.info('Guardian Backtesting Service V3 started successfully');
    this.emit('started');
  }

  /**
   * Stop the Guardian Backtesting Service
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.logger.info('Stopping Guardian Backtesting Service V3...');
    this.isRunning = false;

    // Remove all event listeners
    this.strategyRegistry.removeAllListeners();

    // Wait for active assignments to complete
    const activeStrategyIds = Array.from(this.activeAssignments.keys());
    if (activeStrategyIds.length > 0) {
      this.logger.info(`Waiting for ${activeStrategyIds.length} active assignments to complete...`);
      // Give them 30 seconds to complete
      await new Promise(resolve => setTimeout(resolve, 30000));
    }

    this.logger.info('Guardian Backtesting Service V3 stopped');
    this.emit('stopped');
  }

  /**
   * Handle GuardiansAssignedToStrategy event from StrategyRegistry
   */
  private async handleGuardiansAssigned(
    strategyId: string,
    assignedGuardians: string[]
  ): Promise<void> {
    try {
      // Check if this Guardian was assigned
      if (!assignedGuardians.includes(this.myAddress)) {
        this.logger.debug(`Not assigned to strategy ${strategyId}`);
        return;
      }

      this.logger.info(`Assigned to backtest strategy ${strategyId}`, {
        assignedGuardians: assignedGuardians.length,
        myIndex: assignedGuardians.indexOf(this.myAddress)
      });

      // Create assignment tracking
      const assignment: StrategyAssignment = {
        strategyId,
        assignedGuardians,
        assignmentTimestamp: Date.now(),
        status: 'assigned'
      };

      this.activeAssignments.set(strategyId, assignment);
      this.emit('assignmentReceived', assignment);

      // Start backtesting in background
      this.runBacktest(strategyId).catch(error => {
        this.logger.error(`Backtest failed for strategy ${strategyId}:`, error);
        assignment.status = 'failed';
        this.emit('backtestFailed', strategyId, error);
      });

    } catch (error) {
      this.logger.error('Error handling GuardiansAssigned event:', error);
    }
  }

  /**
   * Handle strategy status changes
   */
  private async handleStrategyStatusChanged(
    strategyId: string,
    oldStatus: number,
    newStatus: number,
    timestamp: number
  ): Promise<void> {
    // If strategy moved out of GUARDIAN_REVIEW (status 2), clean up
    if (oldStatus === 2 && newStatus !== 2) {
      const assignment = this.activeAssignments.get(strategyId);
      if (assignment) {
        this.logger.info(`Strategy ${strategyId} moved to status ${newStatus}, cleaning up assignment`);
        this.activeAssignments.delete(strategyId);
      }
    }
  }

  /**
   * Run backtest for assigned strategy
   */
  private async runBacktest(strategyId: string): Promise<void> {
    const assignment = this.activeAssignments.get(strategyId);
    if (!assignment) {
      throw new Error(`No assignment found for strategy ${strategyId}`);
    }

    assignment.status = 'backtesting';
    assignment.backtestStartTime = Date.now();

    this.logger.info(`Starting backtest for strategy ${strategyId}...`);

    try {
      // Step 1: Fetch strategy details from StrategyRegistry
      const strategy = await this.fetchStrategy(strategyId);
      
      // Step 2: Run backtest
      const metrics = await this.executeBacktest(strategy);
      
      // Step 3: Evaluate results
      const evaluation = this.evaluateBacktest(metrics);
      
      // Step 4: Submit result to StrategyRegistry
      await this.submitResult(strategyId, metrics, evaluation);

      assignment.status = 'submitted';
      assignment.backtestEndTime = Date.now();

      const duration = (assignment.backtestEndTime - assignment.backtestStartTime!) / 1000;
      this.logger.info(`Backtest completed for strategy ${strategyId}`, {
        duration: `${duration}s`,
        passed: evaluation.passed,
        finalScore: evaluation.finalScore
      });

      this.emit('backtestCompleted', strategyId, metrics, evaluation);

    } catch (error) {
      assignment.status = 'failed';
      this.logger.error(`Backtest failed for strategy ${strategyId}:`, error);
      throw error;
    }
  }

  /**
   * Fetch strategy details from StrategyRegistry
   */
  private async fetchStrategy(strategyId: string): Promise<Strategy> {
    this.logger.debug(`Fetching strategy ${strategyId} from StrategyRegistry...`);

    try {
      const strategyData = await this.strategyRegistry.strategies(strategyId);

      const strategy: Strategy = {
        id: strategyId,
        isDNA: strategyData.isDNA,
        dnaString: strategyData.dnaString,
        strategyContract: strategyData.strategyContract,
        name: strategyData.name,
        description: strategyData.description,
        status: strategyData.status,
        submitter: strategyData.submitter,
        riskParams: {
          maxPositionSizePercent: strategyData.riskParams.maxPositionSizePercent,
          maxLeverage: strategyData.riskParams.maxLeverage,
          stopLossPercent: strategyData.riskParams.stopLossPercent,
          slippageToleranceBps: strategyData.riskParams.slippageToleranceBps,
          correlationThreshold: strategyData.riskParams.correlationThreshold,
          velocityLimit: strategyData.riskParams.velocityLimit,
          flashLoansEnabled: strategyData.riskParams.flashLoansEnabled
        }
      };

      this.logger.debug(`Strategy ${strategyId} fetched successfully`, {
        name: strategy.name,
        isDNA: strategy.isDNA
      });

      return strategy;

    } catch (error) {
      this.logger.error(`Failed to fetch strategy ${strategyId}:`, error);
      throw new Error(`Failed to fetch strategy: ${error}`);
    }
  }

  /**
   * Execute backtest using BacktestingFramework
   */
  private async executeBacktest(strategy: Strategy): Promise<BacktestMetrics> {
    this.logger.info(`Executing backtest for strategy ${strategy.name}...`);

    // TODO: Use actual BacktestingFramework when available
    if (this.backtestingFramework) {
      return await this.backtestingFramework.runBacktest(strategy);
    }

    // Mock implementation for now
    this.logger.warn('BacktestingFramework not available, using mock metrics');
    
    // Simulate backtest delay
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Return mock metrics (for testing)
    const mockMetrics: BacktestMetrics = {
      sharpeRatio: 150,           // 1.5
      maxDrawdown: 1200,          // 12%
      winRate: 6200,              // 62%
      totalReturn: 180,           // 1.8x
      tradesExecuted: 120,
      avgTradeReturn: 150,        // 1.5%
      volatility: 800,            // 8%
      calmarRatio: 125,           // 1.25
      overfittingScore: 35        // 35/100
    };

    return mockMetrics;
  }

  /**
   * Evaluate backtest results against thresholds
   */
  private evaluateBacktest(metrics: BacktestMetrics): {
    passed: boolean;
    finalScore: number;
    reason: string;
    overfittingDetected: boolean;
  } {
    this.logger.info('Evaluating backtest results...', metrics);

    const checks = {
      sharpeRatio: metrics.sharpeRatio >= this.MIN_SHARPE_RATIO,
      maxDrawdown: metrics.maxDrawdown <= this.MAX_DRAWDOWN,
      winRate: metrics.winRate >= this.MIN_WIN_RATE,
      minTrades: metrics.tradesExecuted >= this.MIN_TRADES,
      overfitting: metrics.overfittingScore <= this.MAX_OVERFITTING_SCORE
    };

    const passedChecks = Object.values(checks).filter(v => v).length;
    const totalChecks = Object.values(checks).length;
    
    // Calculate final score (0-10000)
    const finalScore = Math.floor((passedChecks / totalChecks) * 10000);

    // Strategy passes if all checks pass
    const passed = Object.values(checks).every(v => v);

    // Build reason string
    const failedChecks: string[] = [];
    if (!checks.sharpeRatio) failedChecks.push(`Sharpe ratio too low (${metrics.sharpeRatio / 100})`);
    if (!checks.maxDrawdown) failedChecks.push(`Max drawdown too high (${metrics.maxDrawdown / 100}%)`);
    if (!checks.winRate) failedChecks.push(`Win rate too low (${metrics.winRate / 100}%)`);
    if (!checks.minTrades) failedChecks.push(`Not enough trades (${metrics.tradesExecuted})`);
    if (!checks.overfitting) failedChecks.push(`Overfitting detected (${metrics.overfittingScore}/100)`);

    const reason = passed
      ? 'All thresholds met'
      : `Failed checks: ${failedChecks.join(', ')}`;

    const overfittingDetected = !checks.overfitting;

    this.logger.info('Backtest evaluation complete', {
      passed,
      finalScore,
      passedChecks,
      totalChecks,
      overfittingDetected
    });

    return { passed, finalScore, reason, overfittingDetected };
  }

  /**
   * Submit backtest result to StrategyRegistry
   */
  private async submitResult(
    strategyId: string,
    metrics: BacktestMetrics,
    evaluation: { passed: boolean; finalScore: number; reason: string; overfittingDetected: boolean }
  ): Promise<void> {
    this.logger.info(`Submitting backtest result for strategy ${strategyId}...`, {
      passed: evaluation.passed,
      finalScore: evaluation.finalScore
    });

    try {
      // Call StrategyRegistry.submitBacktestResult()
      const tx = await this.strategyRegistry.submitBacktestResult(
        strategyId,
        evaluation.passed,
        metrics.sharpeRatio,
        metrics.maxDrawdown,
        metrics.winRate,
        metrics.tradesExecuted,
        evaluation.overfittingDetected,
        evaluation.finalScore,
        evaluation.reason
      );

      this.logger.info(`Backtest result submitted, tx: ${tx.hash}`);

      // Wait for confirmation
      const receipt = await tx.wait();
      
      if (receipt.status === 1) {
        this.logger.info(`Backtest result confirmed for strategy ${strategyId}`);
        this.emit('resultSubmitted', strategyId, evaluation.passed);
      } else {
        throw new Error('Transaction failed');
      }

    } catch (error) {
      this.logger.error(`Failed to submit backtest result for strategy ${strategyId}:`, error);
      throw error;
    }
  }

  /**
   * Get active assignments
   */
  getActiveAssignments(): StrategyAssignment[] {
    return Array.from(this.activeAssignments.values());
  }

  /**
   * Get assignment status
   */
  getAssignmentStatus(strategyId: string): StrategyAssignment | undefined {
    return this.activeAssignments.get(strategyId);
  }

  /**
   * Get StrategyRegistry ABI (minimal for events and functions we need)
   */
  private getStrategyRegistryABI(): any[] {
    return [
      // Events
      'event GuardiansAssignedToStrategy(bytes32 indexed strategyId, address[] guardians)',
      'event StrategyStatusChanged(bytes32 indexed strategyId, uint8 oldStatus, uint8 newStatus, uint256 timestamp)',
      'event BacktestResultSubmitted(bytes32 indexed strategyId, address indexed guardian, bool passed, uint256 sharpeRatio, uint256 maxDrawdown, uint256 finalScore)',
      
      // Functions
      'function strategies(bytes32) view returns (bool isDNA, bytes32 dnaString, address strategyContract, string name, string description, uint8 status, uint256 createdAt, uint256 lastStatusChange, address submitter, tuple(uint256 maxPositionSizePercent, uint256 maxLeverage, uint256 stopLossPercent, uint256 slippageToleranceBps, uint256 correlationThreshold, uint256 velocityLimit, bool flashLoansEnabled) riskParams, tuple(int256 totalPnL, uint256 sharpeRatio, uint256 maxDrawdown, uint256 winRate, uint256 totalTrades, uint256 paperTradingStart, uint256 paperTradingEnd) performance, uint256 initialAllocation, bool requiresOracleApproval)',
      'function submitBacktestResult(bytes32 strategyId, bool passed, uint256 sharpeRatio, uint256 maxDrawdown, uint256 winRate, uint256 totalTrades, bool overfittingDetected, uint256 finalScore, string reason) external'
    ];
  }

  /**
   * Get GuardianWorkloadManager ABI (minimal for monitoring)
   */
  private getGuardianWorkloadManagerABI(): any[] {
    return [
      // Events
      'event GuardiansAssigned(bytes32 indexed strategyId, address[] guardians, uint256 timestamp)',
      'event GuardianCompletedEvaluation(bytes32 indexed strategyId, address indexed guardian, uint256 timestamp)',
      
      // Functions
      'function isGuardianAssigned(bytes32 strategyId, address guardian) view returns (bool)',
      'function guardianProfiles(address) view returns (address guardian, uint256 reputationScore, uint256 activeEvaluations, uint256 maxConcurrentEvaluations, uint256 totalEvaluationsCompleted, uint256 totalApprovals, uint256 totalRejections, uint256 averageEvaluationTime, bool isActive, uint256 registeredAt, uint256 lastActivityAt)'
    ];
  }
}

export default GuardianBacktestingServiceV3;
