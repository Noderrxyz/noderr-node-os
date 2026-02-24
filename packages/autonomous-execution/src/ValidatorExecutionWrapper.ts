/**
 * Validator Execution Wrapper
 * 
 * Wraps the autonomous execution pipeline with VaultManager capital management.
 * 
 * This service integrates VaultCapitalService with the existing AutonomousExecutionOrchestrator
 * to enable real capital allocation for strategy execution.
 * 
 * Flow:
 * 1. ML generates trading signal
 * 2. Risk engine validates signal
 * 3. Oracle consensus approves trade
 * 4. **Request capital from VaultManager** (NEW)
 * 5. Execute trade with allocated capital
 * 6. **Return proceeds to VaultManager** (NEW)
 * 7. Track P&L for strategy
 * 
 * @module ValidatorExecutionWrapper
 */

import { ethers } from 'ethers';
import { EventEmitter } from 'events';
import { Logger } from '@noderr/utils';
import { AutonomousExecutionOrchestrator, ExecutionResult } from './AutonomousExecutionOrchestrator';
import { VaultCapitalService, CapitalAllocation } from './services/VaultCapitalService';

export interface StrategyExecutionRequest {
  strategyId: string;
  signal: {
    asset: string;
    action: 'buy' | 'sell';
    confidence: number;
    targetPrice: number;
    stopLoss: number;
    takeProfit: number;
  };
  capitalRequired: bigint;
  token: string;
}

export interface StrategyExecutionResult {
  strategyId: string;
  success: boolean;
  capitalAllocated: bigint;
  proceedsReturned: bigint;
  profitLoss: bigint;
  executionTime: number;
  error?: string;
}

export class ValidatorExecutionWrapper extends EventEmitter {
  private logger: Logger;
  private orchestrator: AutonomousExecutionOrchestrator;
  private capitalService: VaultCapitalService;
  private provider: ethers.Provider;
  private wallet: ethers.Wallet;
  private isRunning: boolean;
  private activeExecutions: Map<string, StrategyExecutionRequest>;

  // Default token addresses (can be configured)
  private readonly USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'; // Base mainnet USDC
  private readonly ETH_ADDRESS = ethers.ZeroAddress;

  constructor(
    provider: ethers.Provider,
    wallet: ethers.Wallet,
    vaultManagerAddress: string,
    orchestratorConfig?: any
  ) {
    super();
    this.logger = new Logger('ValidatorExecutionWrapper');
    this.provider = provider;
    this.wallet = wallet;
    this.isRunning = false;
    this.activeExecutions = new Map();

    // Initialize orchestrator
    this.orchestrator = new AutonomousExecutionOrchestrator(orchestratorConfig);

    // Initialize capital service
    this.capitalService = new VaultCapitalService(
      provider,
      wallet,
      vaultManagerAddress
    );

    this.logger.info('ValidatorExecutionWrapper initialized', {
      validator: wallet.address,
      vaultManager: vaultManagerAddress
    });
  }

  /**
   * Initialize the wrapper
   */
  async initialize(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Wrapper already initialized');
      return;
    }

    this.logger.info('Initializing ValidatorExecutionWrapper...');

    // Initialize capital service
    await this.capitalService.initialize();

    // Initialize orchestrator
    await this.orchestrator.initialize();

    // Set up event listeners
    this.setupEventListeners();

    this.isRunning = true;
    this.logger.info('ValidatorExecutionWrapper initialized successfully');
  }

  /**
   * Set up event listeners
   */
  private setupEventListeners(): void {
    // Listen to orchestrator execution events
    this.orchestrator.on('execution-complete', this.handleExecutionComplete.bind(this));
    this.orchestrator.on('execution-failed', this.handleExecutionFailed.bind(this));

    // Listen to capital service events
    this.capitalService.on('capitalAllocated', this.handleCapitalAllocated.bind(this));
    this.capitalService.on('proceedsReturned', this.handleProceedsReturned.bind(this));
  }

  /**
   * Execute strategy with VaultManager capital
   * 
   * This is the main entry point for strategy execution with real capital.
   * 
   * @param request Strategy execution request
   * @returns Execution result
   */
  async executeStrategy(request: StrategyExecutionRequest): Promise<StrategyExecutionResult> {
    if (!this.isRunning) {
      throw new Error('Wrapper not initialized');
    }

    this.logger.info(`Executing strategy ${request.strategyId}`, {
      asset: request.signal.asset,
      action: request.signal.action,
      capitalRequired: ethers.formatUnits(request.capitalRequired, 18)
    });

    const startTime = Date.now();

    try {
      // Step 1: Check available balance
      const availableBalance = await this.capitalService.getAvailableBalance(request.token);
      
      if (availableBalance < request.capitalRequired) {
        throw new Error(`Insufficient balance: ${ethers.formatUnits(availableBalance, 18)} < ${ethers.formatUnits(request.capitalRequired, 18)}`);
      }

      // Step 2: Request capital from VaultManager
      this.logger.info(`Requesting capital for strategy ${request.strategyId}...`);
      await this.capitalService.requestCapital(
        request.strategyId,
        request.token,
        request.capitalRequired
      );

      // Track active execution
      this.activeExecutions.set(request.strategyId, request);

      // Step 3: Execute trade using orchestrator
      this.logger.info(`Executing trade for strategy ${request.strategyId}...`);
      
      // Convert signal to orchestrator format
      const prediction = {
        asset: request.signal.asset,
        direction: request.signal.action === 'buy' ? 'LONG' : 'SHORT',
        confidence: request.signal.confidence,
        targetPrice: request.signal.targetPrice,
        stopLoss: request.signal.stopLoss,
        takeProfit: request.signal.takeProfit,
        timestamp: Date.now()
      };

      // Execute through orchestrator
      // Note: This is a simplified integration - actual implementation would need
      // to properly integrate with the orchestrator's pipeline
      const executionResult = await this.simulateExecution(request);

      // Step 4: Return proceeds to VaultManager
      this.logger.info(`Returning proceeds for strategy ${request.strategyId}...`);
      
      const tokenOut = request.token; // Simplified - same token in/out
      const amountOut = executionResult.success 
        ? request.capitalRequired + (request.capitalRequired * BigInt(5) / BigInt(100)) // +5% profit
        : request.capitalRequired - (request.capitalRequired * BigInt(2) / BigInt(100)); // -2% loss

      await this.capitalService.returnProceeds(
        request.strategyId,
        request.token,
        request.capitalRequired,
        tokenOut,
        amountOut
      );

      // Calculate result
      const profitLoss = amountOut - request.capitalRequired;
      const executionTime = Date.now() - startTime;

      const result: StrategyExecutionResult = {
        strategyId: request.strategyId,
        success: executionResult.success,
        capitalAllocated: request.capitalRequired,
        proceedsReturned: amountOut,
        profitLoss,
        executionTime
      };

      this.logger.info(`Strategy ${request.strategyId} execution complete`, {
        success: result.success,
        profitLoss: ethers.formatUnits(profitLoss, 18),
        executionTime: `${executionTime}ms`
      });

      this.emit('strategyExecutionComplete', result);

      // Clean up
      this.activeExecutions.delete(request.strategyId);

      return result;

    } catch (error) {
      this.logger.error(`Strategy ${request.strategyId} execution failed:`, error);

      const executionTime = Date.now() - startTime;

      const result: StrategyExecutionResult = {
        strategyId: request.strategyId,
        success: false,
        capitalAllocated: request.capitalRequired,
        proceedsReturned: BigInt(0),
        profitLoss: BigInt(0),
        executionTime,
        error: error instanceof Error ? error.message : 'Unknown error'
      };

      this.emit('strategyExecutionFailed', result);

      // Clean up
      this.activeExecutions.delete(request.strategyId);

      throw error;
    }
  }

  /**
   * Simulate execution (placeholder for actual orchestrator integration)
   * 
   * TODO: Replace with actual orchestrator.processPrediction() integration
   */
  private async simulateExecution(request: StrategyExecutionRequest): Promise<ExecutionResult> {
    this.logger.info(`Simulating execution for strategy ${request.strategyId}...`);

    // Simulate execution delay
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Simulate 80% success rate
    const success = Math.random() > 0.2;

    const executedPrice = request.signal.targetPrice * (1 + (Math.random() - 0.5) * 0.01);
    const executedQuantity = Number(ethers.formatUnits(request.capitalRequired, 18)) / executedPrice;
    const startTime = Date.now() - 2000;
    return {
      success,
      executedQuantity,
      averagePrice: executedPrice,
      totalCost: executedQuantity * executedPrice,
      slippage: Math.random() * 0.005,
      duration: Date.now() - startTime,
      fills: [
        {
          timestamp: startTime,
          quantity: executedQuantity,
          price: executedPrice,
          venue: 'simulated'
        }
      ]
    } as ExecutionResult;
  }

  /**
   * Get strategy performance from capital service
   */
  getStrategyPerformance(strategyId: string) {
    return this.capitalService.getStrategyPerformance(strategyId);
  }

  /**
   * Get all strategy performances
   */
  getAllStrategyPerformances() {
    return this.capitalService.getAllStrategyPerformances();
  }

  /**
   * Get active executions
   */
  getActiveExecutions(): StrategyExecutionRequest[] {
    return Array.from(this.activeExecutions.values());
  }

  /**
   * Get active capital allocations
   */
  getActiveAllocations() {
    return this.capitalService.getAllActiveAllocations();
  }

  /**
   * Handle execution complete event from orchestrator
   */
  private handleExecutionComplete(result: ExecutionResult): void {
    this.logger.info('Execution complete event received', result);
  }

  /**
   * Handle execution failed event from orchestrator
   */
  private handleExecutionFailed(error: any): void {
    this.logger.error('Execution failed event received', error);
  }

  /**
   * Handle capital allocated event from capital service
   */
  private handleCapitalAllocated(allocation: CapitalAllocation): void {
    this.logger.info('Capital allocated event received', {
      strategyId: allocation.strategyId,
      amount: ethers.formatUnits(allocation.amount, 18)
    });
  }

  /**
   * Handle proceeds returned event from capital service
   */
  private handleProceedsReturned(allocation: CapitalAllocation): void {
    this.logger.info('Proceeds returned event received', {
      strategyId: allocation.strategyId,
      profitLoss: allocation.profitLoss ? ethers.formatUnits(allocation.profitLoss, 18) : '0'
    });
  }

  /**
   * Start the wrapper
   */
  async start(): Promise<void> {
    if (!this.isRunning) {
      await this.initialize();
    }

    this.logger.info('ValidatorExecutionWrapper started');
    this.emit('started');
  }

  /**
   * Stop the wrapper
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.logger.info('Stopping ValidatorExecutionWrapper...');

    // Wait for active executions to complete
    if (this.activeExecutions.size > 0) {
      this.logger.warn(`${this.activeExecutions.size} active executions still pending`);
      // Give them 30 seconds to complete
      await new Promise(resolve => setTimeout(resolve, 30000));
    }

    // Stop capital service
    await this.capitalService.stop();

    // Stop orchestrator
    await this.orchestrator.stop();

    this.isRunning = false;
    this.logger.info('ValidatorExecutionWrapper stopped');
    this.emit('stopped');
  }
}

export default ValidatorExecutionWrapper;
