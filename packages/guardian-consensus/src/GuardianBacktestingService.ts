/**
 * Guardian Backtesting Service
 * 
 * Handles the complete Guardian backtesting workflow:
 * 1. Receives strategy submission from smart contract
 * 2. Runs backtest with parameter variations
 * 3. Calculates performance metrics
 * 4. Submits results to BacktestConsensus contract
 * 5. Participates in BFT consensus
 * 
 * This service integrates with:
 * - GuardianLotterySelector.sol (receives committee selection)
 * - BacktestConsensus.sol (submits results and participates in consensus)
 * - StrategyLifecycleManager.sol (monitors strategy transitions)
 * - BacktestingFramework (executes backtests)
 */

import { ethers } from 'ethers';
import { EventEmitter } from 'events';
import { Logger } from '@noderr/utils';
import { BacktestingFramework } from '@noderr/backtesting';
import { Strategy, BacktestResult, GuardianNodeConfig } from '@noderr/types';

export interface BacktestMetrics {
  sharpeRatio: number;      // Scaled by 10000 (e.g., 20000 = 2.0)
  maxDrawdown: number;       // Scaled by 10000 (e.g., 1500 = 15%)
  winRate: number;           // Scaled by 10000 (e.g., 6500 = 65%)
  totalReturn: number;       // Scaled by 10000 (e.g., 50000 = 5.0x)
  tradesExecuted: number;
  avgTradeReturn: number;
  volatility: number;
  calmarRatio: number;
}

export interface ParameterVariation {
  name: string;
  originalValue: any;
  testValue: any;
}

export interface BacktestRound {
  roundId: string;
  strategyId: string;
  strategy: Strategy;
  selectedGuardians: string[];
  weights: bigint[];
  deadline: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
}

export class GuardianBacktestingService extends EventEmitter {
  private logger: Logger;
  private provider: ethers.Provider;
  private wallet: ethers.Wallet;
  private lotteryContract: ethers.Contract;
  private consensusContract: ethers.Contract;
  private lifecycleContract: ethers.Contract;
  private backtestingFramework: BacktestingFramework;
  private config: GuardianNodeConfig;
  private activeRounds: Map<string, BacktestRound>;
  private isRunning: boolean;

  constructor(
    provider: ethers.Provider,
    wallet: ethers.Wallet,
    lotteryContractAddress: string,
    consensusContractAddress: string,
    lifecycleContractAddress: string,
    config: GuardianNodeConfig
  ) {
    super();
    this.logger = new Logger('GuardianBacktestingService');
    this.provider = provider;
    this.wallet = wallet;
    this.config = config;
    this.activeRounds = new Map();
    this.isRunning = false;

    // Initialize contracts (ABIs would be imported from compiled contracts)
    this.lotteryContract = new ethers.Contract(
      lotteryContractAddress,
      [], // GuardianLotterySelector ABI
      wallet
    );

    this.consensusContract = new ethers.Contract(
      consensusContractAddress,
      [], // BacktestConsensus ABI
      wallet
    );

    this.lifecycleContract = new ethers.Contract(
      lifecycleContractAddress,
      [], // StrategyLifecycleManager ABI
      wallet
    );

    this.backtestingFramework = new BacktestingFramework(config.backtestConfig);
  }

  /**
   * Start the Guardian Backtesting Service
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Service already running');
      return;
    }

    this.logger.info('Starting Guardian Backtesting Service...');
    this.isRunning = true;

    // Listen for committee selection events
    this.lotteryContract.on('CommitteeSelected', this.handleCommitteeSelection.bind(this));

    // Listen for consensus round creation events
    this.consensusContract.on('ConsensusRoundCreated', this.handleConsensusRoundCreated.bind(this));

    // Listen for consensus finalization events
    this.consensusContract.on('ConsensusFinalized', this.handleConsensusFinalized.bind(this));

    this.logger.info('Guardian Backtesting Service started successfully');
    this.emit('started');
  }

  /**
   * Stop the Guardian Backtesting Service
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.logger.info('Stopping Guardian Backtesting Service...');
    this.isRunning = false;

    // Remove all event listeners
    this.lotteryContract.removeAllListeners();
    this.consensusContract.removeAllListeners();

    // Wait for active rounds to complete
    const activeRoundIds = Array.from(this.activeRounds.keys());
    if (activeRoundIds.length > 0) {
      this.logger.info(`Waiting for ${activeRoundIds.length} active rounds to complete...`);
      await Promise.all(
        activeRoundIds.map(roundId => this.waitForRoundCompletion(roundId))
      );
    }

    this.logger.info('Guardian Backtesting Service stopped');
    this.emit('stopped');
  }

  /**
   * Handle committee selection event from GuardianLotterySelector
   */
  private async handleCommitteeSelection(
    roundId: string,
    strategyId: string,
    selectedGuardians: string[],
    weights: bigint[],
    deadline: number
  ): Promise<void> {
    try {
      // Check if this Guardian was selected
      const myAddress = await this.wallet.getAddress();
      if (!selectedGuardians.includes(myAddress)) {
        this.logger.debug(`Not selected for round ${roundId}`);
        return;
      }

      this.logger.info(`Selected for backtesting round ${roundId} for strategy ${strategyId}`);

      // Get my weight
      const myIndex = selectedGuardians.indexOf(myAddress);
      const myWeight = weights[myIndex];

      // Fetch strategy details from StrategyLifecycleManager
      const strategy = await this.fetchStrategy(strategyId);

      // Create round tracking
      const round: BacktestRound = {
        roundId,
        strategyId,
        strategy,
        selectedGuardians,
        weights,
        deadline,
        status: 'pending'
      };

      this.activeRounds.set(roundId, round);
      this.emit('roundAssigned', round);

      // Start backtesting in background
      this.runBacktest(roundId, myWeight).catch(error => {
        this.logger.error(`Backtest failed for round ${roundId}:`, error);
        round.status = 'failed';
        this.emit('roundFailed', roundId, error);
      });

    } catch (error) {
      this.logger.error('Error handling committee selection:', error);
    }
  }

  /**
   * Handle consensus round creation event
   */
  private async handleConsensusRoundCreated(
    roundId: string,
    strategyId: string,
    guardians: string[],
    deadline: number
  ): Promise<void> {
    this.logger.debug(`Consensus round created: ${roundId}`);
    // Additional handling if needed
  }

  /**
   * Handle consensus finalization event
   */
  private async handleConsensusFinalized(roundId: string): Promise<void> {
    this.logger.info(`Consensus finalized for round ${roundId}`);
    
    const round = this.activeRounds.get(roundId);
    if (round) {
      round.status = 'completed';
      this.activeRounds.delete(roundId);
      this.emit('roundCompleted', roundId);
    }
  }

  /**
   * Fetch strategy details from StrategyLifecycleManager
   */
  private async fetchStrategy(strategyId: string): Promise<Strategy> {
    try {
      const strategyData = await this.lifecycleContract.getStrategy(strategyId);
      
      // Parse strategy data from contract
      const strategy: Strategy = {
        id: strategyId,
        name: strategyData.name,
        type: 'ARBITRAGE', // Default type
        developer: strategyData.developer,
        ipfsHash: strategyData.ipfsHash,
        stage: strategyData.stage,
        maxCapital: strategyData.maxCapital,
        isActive: strategyData.isActive,
        // Fetch actual strategy code from IPFS
        code: await this.fetchStrategyFromIPFS(strategyData.ipfsHash)
      };

      return strategy;
    } catch (error) {
      this.logger.error(`Error fetching strategy ${strategyId}:`, error);
      throw error;
    }
  }

  /**
   * Fetch strategy code from IPFS
   */
  private async fetchStrategyFromIPFS(ipfsHash: string): Promise<string> {
    // Implementation would fetch from IPFS gateway
    // For now, return placeholder
    this.logger.debug(`Fetching strategy from IPFS: ${ipfsHash}`);
    return `// Strategy code from IPFS: ${ipfsHash}`;
  }

  /**
   * Run backtest with parameter variations
   */
  private async runBacktest(roundId: string, weight: bigint): Promise<void> {
    const round = this.activeRounds.get(roundId);
    if (!round) {
      throw new Error(`Round ${roundId} not found`);
    }

    round.status = 'running';
    this.emit('backtestStarted', roundId);

    try {
      // Generate parameter variations for robustness testing
      const variations = this.generateParameterVariations(round.strategy);
      this.logger.info(`Testing ${variations.length} parameter variations for ${round.strategyId}`);

      // Run backtest with each variation
      const results: BacktestResult[] = [];
      for (const variation of variations) {
        const result = await this.backtestingFramework.runBacktest(
          round.strategy,
          variation,
          this.config.backtestConfig
        );
        results.push(result);
      }

      // Calculate aggregate metrics
      const metrics = this.calculateAggregateMetrics(results);
      this.logger.info(`Backtest completed for ${round.strategyId}:`, metrics);

      // Generate result hash (hash of metrics for consensus)
      const resultHash = this.generateResultHash(metrics);

      // Submit result to BacktestConsensus contract
      await this.submitResult(roundId, resultHash, metrics, weight);

      this.emit('backtestCompleted', roundId, metrics);

    } catch (error) {
      this.logger.error(`Backtest failed for round ${roundId}:`, error);
      round.status = 'failed';
      throw error;
    }
  }

  /**
   * Generate parameter variations for robustness testing
   * 
   * This tests the strategy with slight parameter variations to detect overfitting.
   * A robust strategy should perform consistently across variations.
   */
  private generateParameterVariations(strategy: Strategy): ParameterVariation[][] {
    const variations: ParameterVariation[][] = [];

    // Base case (no variations)
    variations.push([]);

    // Generate variations based on strategy parameters
    // This would be customized based on strategy type
    const parameterSets = [
      { name: 'lookback_period', scale: 0.9 },
      { name: 'lookback_period', scale: 1.1 },
      { name: 'threshold', scale: 0.95 },
      { name: 'threshold', scale: 1.05 },
      { name: 'position_size', scale: 0.8 },
      { name: 'position_size', scale: 1.2 }
    ];

    for (const param of parameterSets) {
      variations.push([{
        name: param.name,
        originalValue: strategy.parameters?.[param.name],
        testValue: (strategy.parameters?.[param.name] || 1) * param.scale
      }]);
    }

    return variations;
  }

  /**
   * Calculate aggregate metrics from multiple backtest results
   */
  private calculateAggregateMetrics(results: BacktestResult[]): BacktestMetrics {
    if (results.length === 0) {
      throw new Error('No backtest results to aggregate');
    }

    // Calculate average metrics across all variations
    const avgSharpe = results.reduce((sum, r) => sum + r.sharpeRatio, 0) / results.length;
    const avgDrawdown = results.reduce((sum, r) => sum + r.maxDrawdown, 0) / results.length;
    const avgWinRate = results.reduce((sum, r) => sum + r.winRate, 0) / results.length;
    const avgReturn = results.reduce((sum, r) => sum + r.totalReturn, 0) / results.length;
    const avgTrades = results.reduce((sum, r) => sum + (r.tradesExecuted || 0), 0) / results.length;

    // Calculate variance to measure robustness
    const sharpeVariance = this.calculateVariance(results.map(r => r.sharpeRatio));
    const returnVariance = this.calculateVariance(results.map(r => r.totalReturn));

    // Scale metrics for smart contract (multiply by 10000)
    return {
      sharpeRatio: Math.round(avgSharpe * 10000),
      maxDrawdown: Math.round(avgDrawdown * 10000),
      winRate: Math.round(avgWinRate * 10000),
      totalReturn: Math.round(avgReturn * 10000),
      tradesExecuted: Math.round(avgTrades),
      avgTradeReturn: Math.round((avgReturn / avgTrades) * 10000),
      volatility: Math.round(Math.sqrt(returnVariance) * 10000),
      calmarRatio: Math.round((avgReturn / avgDrawdown) * 10000)
    };
  }

  /**
   * Calculate variance of a dataset
   */
  private calculateVariance(values: number[]): number {
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
    return squaredDiffs.reduce((sum, v) => sum + v, 0) / values.length;
  }

  /**
   * Generate result hash for consensus
   * 
   * This creates a deterministic hash of the metrics that other Guardians
   * can verify. Guardians with similar results will have the same hash.
   */
  private generateResultHash(metrics: BacktestMetrics): string {
    // Round metrics to reduce minor differences
    const roundedMetrics = {
      sharpeRatio: Math.round(metrics.sharpeRatio / 100) * 100,
      maxDrawdown: Math.round(metrics.maxDrawdown / 100) * 100,
      winRate: Math.round(metrics.winRate / 100) * 100,
      totalReturn: Math.round(metrics.totalReturn / 100) * 100
    };

    // Create hash
    const data = ethers.solidityPacked(
      ['uint256', 'uint256', 'uint256', 'uint256'],
      [
        roundedMetrics.sharpeRatio,
        roundedMetrics.maxDrawdown,
        roundedMetrics.winRate,
        roundedMetrics.totalReturn
      ]
    );

    return ethers.keccak256(data);
  }

  /**
   * Submit backtest result to BacktestConsensus contract
   */
  private async submitResult(
    roundId: string,
    resultHash: string,
    metrics: BacktestMetrics,
    weight: bigint
  ): Promise<void> {
    try {
      this.logger.info(`Submitting result for round ${roundId}...`);

      const tx = await this.consensusContract.submitResult(
        roundId,
        resultHash,
        metrics.sharpeRatio,
        metrics.maxDrawdown,
        metrics.winRate,
        metrics.totalReturn,
        weight
      );

      const receipt = await tx.wait();
      this.logger.info(`Result submitted successfully. Tx: ${receipt.hash}`);

      this.emit('resultSubmitted', roundId, resultHash);

    } catch (error) {
      this.logger.error(`Error submitting result for round ${roundId}:`, error);
      throw error;
    }
  }

  /**
   * Wait for round completion
   */
  private async waitForRoundCompletion(roundId: string): Promise<void> {
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        const round = this.activeRounds.get(roundId);
        if (!round || round.status === 'completed' || round.status === 'failed') {
          clearInterval(checkInterval);
          resolve();
        }
      }, 1000);
    });
  }

  /**
   * Get service status
   */
  getStatus(): {
    isRunning: boolean;
    activeRounds: number;
    guardianAddress: string;
  } {
    return {
      isRunning: this.isRunning,
      activeRounds: this.activeRounds.size,
      guardianAddress: this.wallet.address
    };
  }

  /**
   * Get active rounds
   */
  getActiveRounds(): BacktestRound[] {
    return Array.from(this.activeRounds.values());
  }
}
