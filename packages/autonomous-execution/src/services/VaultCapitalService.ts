/**
 * Vault Capital Service
 * 
 * Manages capital allocation from VaultManager for strategy execution.
 * 
 * This service acts as the bridge between Validator nodes and VaultManager contract:
 * 1. Requests capital from VaultManager before executing trades
 * 2. Executes trades using allocated capital
 * 3. Returns proceeds to VaultManager after execution
 * 4. Tracks P&L for each strategy
 * 
 * Security:
 * - Only Validators with EXECUTION_ROUTER_ROLE can request capital
 * - Capital is tracked per strategy to prevent misuse
 * - All transactions are logged and auditable
 * 
 * @module VaultCapitalService
 */

import { ethers } from 'ethers';
import { EventEmitter } from 'events';
import { Logger } from '@noderr/utils';

export interface CapitalRequest {
  strategyId: string;
  token: string;
  amount: bigint;
  requestTime: number;
}

export interface CapitalAllocation {
  strategyId: string;
  token: string;
  amount: bigint;
  allocatedAt: number;
  returnedAt?: number;
  returnAmount?: bigint;
  returnToken?: string;
  profitLoss?: bigint;
  status: 'allocated' | 'returned' | 'failed';
}

export interface StrategyPerformance {
  strategyId: string;
  totalTrades: number;
  successfulTrades: number;
  failedTrades: number;
  totalCapitalAllocated: bigint;
  totalProfitLoss: bigint;
  averageReturn: number; // Percentage
  sharpeRatio: number;
  maxDrawdown: number;
}

export class VaultCapitalService extends EventEmitter {
  private logger: Logger;
  private provider: ethers.Provider;
  private wallet: ethers.Wallet;
  private vaultManager: ethers.Contract;
  private activeAllocations: Map<string, CapitalAllocation>;
  private strategyPerformance: Map<string, StrategyPerformance>;
  private isInitialized: boolean;

  constructor(
    provider: ethers.Provider,
    wallet: ethers.Wallet,
    vaultManagerAddress: string
  ) {
    super();
    this.logger = new Logger('VaultCapitalService');
    this.provider = provider;
    this.wallet = wallet;
    this.activeAllocations = new Map();
    this.strategyPerformance = new Map();
    this.isInitialized = false;

    // Initialize VaultManager contract
    this.vaultManager = new ethers.Contract(
      vaultManagerAddress,
      this.getVaultManagerABI(),
      wallet
    );

    this.logger.info('VaultCapitalService initialized', {
      validator: wallet.address,
      vaultManager: vaultManagerAddress
    });
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      this.logger.warn('Service already initialized');
      return;
    }

    this.logger.info('Initializing VaultCapitalService...');

    // Verify we have EXECUTION_ROUTER_ROLE
    const EXECUTION_ROUTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes('EXECUTION_ROUTER_ROLE'));
    const hasRole = await this.vaultManager.hasRole(EXECUTION_ROUTER_ROLE, this.wallet.address);

    if (!hasRole) {
      throw new Error('Wallet does not have EXECUTION_ROUTER_ROLE');
    }

    this.logger.info('✅ EXECUTION_ROUTER_ROLE verified');

    // Listen to VaultManager events
    this.vaultManager.on(
      'StrategyCapitalAllocated',
      this.handleCapitalAllocated.bind(this)
    );

    this.vaultManager.on(
      'StrategyProceedsReceived',
      this.handleProceedsReceived.bind(this)
    );

    this.isInitialized = true;
    this.logger.info('VaultCapitalService initialized successfully');
  }

  /**
   * Request capital from VaultManager for strategy execution
   * 
   * @param strategyId Strategy identifier
   * @param token Token address (use address(0) for ETH)
   * @param amount Amount to request (in wei)
   * @returns Transaction receipt
   */
  async requestCapital(
    strategyId: string,
    token: string,
    amount: bigint
  ): Promise<ethers.ContractTransactionReceipt> {
    if (!this.isInitialized) {
      throw new Error('Service not initialized');
    }

    this.logger.info(`Requesting capital for strategy ${strategyId}`, {
      token,
      amount: ethers.formatUnits(amount, 18)
    });

    try {
      // Check if strategy already has active allocation
      const existingAllocation = this.activeAllocations.get(strategyId);
      if (existingAllocation && existingAllocation.status === 'allocated') {
        throw new Error(`Strategy ${strategyId} already has active allocation`);
      }

      // Call VaultManager.allocateToStrategy()
      const tx = await this.vaultManager.allocateToStrategy(
        strategyId,
        token,
        amount
      );

      this.logger.info(`Capital request submitted, tx: ${tx.hash}`);

      // Wait for confirmation
      const receipt = await tx.wait();

      if (receipt.status === 1) {
        // Track allocation
        const allocation: CapitalAllocation = {
          strategyId,
          token,
          amount,
          allocatedAt: Date.now(),
          status: 'allocated'
        };

        this.activeAllocations.set(strategyId, allocation);

        this.logger.info(`Capital allocated successfully for strategy ${strategyId}`);
        this.emit('capitalAllocated', allocation);

        return receipt;
      } else {
        throw new Error('Transaction failed');
      }

    } catch (error) {
      this.logger.error(`Failed to request capital for strategy ${strategyId}:`, error);
      throw error;
    }
  }

  /**
   * Return proceeds to VaultManager after trade execution
   * 
   * @param strategyId Strategy identifier
   * @param tokenIn Token that was allocated
   * @param amountIn Amount that was allocated
   * @param tokenOut Token received from trade
   * @param amountOut Amount received from trade
   * @returns Transaction receipt
   */
  async returnProceeds(
    strategyId: string,
    tokenIn: string,
    amountIn: bigint,
    tokenOut: string,
    amountOut: bigint
  ): Promise<ethers.ContractTransactionReceipt> {
    if (!this.isInitialized) {
      throw new Error('Service not initialized');
    }

    this.logger.info(`Returning proceeds for strategy ${strategyId}`, {
      tokenIn,
      amountIn: ethers.formatUnits(amountIn, 18),
      tokenOut,
      amountOut: ethers.formatUnits(amountOut, 18)
    });

    try {
      // Check if strategy has active allocation
      const allocation = this.activeAllocations.get(strategyId);
      if (!allocation || allocation.status !== 'allocated') {
        throw new Error(`No active allocation found for strategy ${strategyId}`);
      }

      // Transfer proceeds to VaultManager first
      if (tokenOut === ethers.ZeroAddress) {
        // Transfer ETH
        const tx = await this.wallet.sendTransaction({
          to: await this.vaultManager.getAddress(),
          value: amountOut
        });
        await tx.wait();
      } else {
        // Transfer ERC20
        const tokenContract = new ethers.Contract(
          tokenOut,
          ['function transfer(address to, uint256 amount) returns (bool)'],
          this.wallet
        );
        const tx = await tokenContract.transfer(
          await this.vaultManager.getAddress(),
          amountOut
        );
        await tx.wait();
      }

      // Call VaultManager.receiveStrategyProceeds()
      const tx = await this.vaultManager.receiveStrategyProceeds(
        strategyId,
        tokenIn,
        amountIn,
        tokenOut,
        amountOut
      );

      this.logger.info(`Proceeds return submitted, tx: ${tx.hash}`);

      // Wait for confirmation
      const receipt = await tx.wait();

      if (receipt.status === 1) {
        // Update allocation tracking
        allocation.returnedAt = Date.now();
        allocation.returnAmount = amountOut;
        allocation.returnToken = tokenOut;
        allocation.profitLoss = BigInt(amountOut) - BigInt(amountIn);
        allocation.status = 'returned';

        // Update strategy performance
        this.updateStrategyPerformance(strategyId, allocation);

        this.logger.info(`Proceeds returned successfully for strategy ${strategyId}`, {
          profitLoss: ethers.formatUnits(allocation.profitLoss, 18)
        });

        this.emit('proceedsReturned', allocation);

        // Remove from active allocations
        this.activeAllocations.delete(strategyId);

        return receipt;
      } else {
        throw new Error('Transaction failed');
      }

    } catch (error) {
      this.logger.error(`Failed to return proceeds for strategy ${strategyId}:`, error);
      
      // Mark allocation as failed
      const allocation = this.activeAllocations.get(strategyId);
      if (allocation) {
        allocation.status = 'failed';
      }

      throw error;
    }
  }

  /**
   * Get balance available in VaultManager
   * 
   * @param token Token address
   * @returns Available balance
   */
  async getAvailableBalance(token: string): Promise<bigint> {
    if (!this.isInitialized) {
      throw new Error('Service not initialized');
    }

    try {
      if (token === ethers.ZeroAddress) {
        // Get ETH balance
        return await this.provider.getBalance(await this.vaultManager.getAddress());
      } else {
        // Get ERC20 balance
        const tokenContract = new ethers.Contract(
          token,
          ['function balanceOf(address) view returns (uint256)'],
          this.provider
        );
        return await tokenContract.balanceOf(await this.vaultManager.getAddress());
      }
    } catch (error) {
      this.logger.error(`Failed to get available balance for token ${token}:`, error);
      throw error;
    }
  }

  /**
   * Get active allocation for strategy
   * 
   * @param strategyId Strategy identifier
   * @returns Active allocation or undefined
   */
  getActiveAllocation(strategyId: string): CapitalAllocation | undefined {
    return this.activeAllocations.get(strategyId);
  }

  /**
   * Get all active allocations
   * 
   * @returns Array of active allocations
   */
  getAllActiveAllocations(): CapitalAllocation[] {
    return Array.from(this.activeAllocations.values());
  }

  /**
   * Get strategy performance
   * 
   * @param strategyId Strategy identifier
   * @returns Strategy performance or undefined
   */
  getStrategyPerformance(strategyId: string): StrategyPerformance | undefined {
    return this.strategyPerformance.get(strategyId);
  }

  /**
   * Get all strategy performances
   * 
   * @returns Array of strategy performances
   */
  getAllStrategyPerformances(): StrategyPerformance[] {
    return Array.from(this.strategyPerformance.values());
  }

  /**
   * Handle StrategyCapitalAllocated event
   */
  private handleCapitalAllocated(
    strategyId: string,
    token: string,
    amount: bigint,
    executionRouter: string
  ): void {
    this.logger.info(`Capital allocated event received`, {
      strategyId,
      token,
      amount: ethers.formatUnits(amount, 18),
      executionRouter
    });
  }

  /**
   * Handle StrategyProceedsReceived event
   */
  private handleProceedsReceived(
    strategyId: string,
    token: string,
    amount: bigint,
    profitLoss: bigint
  ): void {
    this.logger.info(`Proceeds received event`, {
      strategyId,
      token,
      amount: ethers.formatUnits(amount, 18),
      profitLoss: ethers.formatUnits(profitLoss, 18)
    });
  }

  /**
   * Update strategy performance tracking
   */
  private updateStrategyPerformance(
    strategyId: string,
    allocation: CapitalAllocation
  ): void {
    let performance = this.strategyPerformance.get(strategyId);

    if (!performance) {
      performance = {
        strategyId,
        totalTrades: 0,
        successfulTrades: 0,
        failedTrades: 0,
        totalCapitalAllocated: BigInt(0),
        totalProfitLoss: BigInt(0),
        averageReturn: 0,
        sharpeRatio: 0,
        maxDrawdown: 0
      };
      this.strategyPerformance.set(strategyId, performance);
    }

    // Update metrics
    performance.totalTrades++;
    performance.totalCapitalAllocated += allocation.amount;

    if (allocation.profitLoss !== undefined) {
      performance.totalProfitLoss += allocation.profitLoss;

      if (allocation.profitLoss > 0) {
        performance.successfulTrades++;
      } else {
        performance.failedTrades++;
      }

      // Calculate average return
      const returnPct = Number(allocation.profitLoss * BigInt(10000) / allocation.amount) / 100;
      performance.averageReturn = 
        (performance.averageReturn * (performance.totalTrades - 1) + returnPct) / performance.totalTrades;
    }

    this.logger.debug(`Strategy performance updated`, {
      strategyId,
      totalTrades: performance.totalTrades,
      successfulTrades: performance.successfulTrades,
      averageReturn: performance.averageReturn.toFixed(2) + '%'
    });
  }

  /**
   * Get VaultManager ABI (minimal for functions we need)
   */
  private getVaultManagerABI(): any[] {
    return [
      // Events
      'event StrategyCapitalAllocated(bytes32 indexed strategyId, address indexed token, uint256 amount, address indexed executionRouter)',
      'event StrategyProceedsReceived(bytes32 indexed strategyId, address indexed token, uint256 amount, int256 profitLoss)',
      
      // Functions
      'function allocateToStrategy(bytes32 strategyId, address token, uint256 amount) external',
      'function receiveStrategyProceeds(bytes32 strategyId, address tokenIn, uint256 amountIn, address tokenOut, uint256 amountOut) external',
      'function hasRole(bytes32 role, address account) view returns (bool)',
      'function supportedTokens(address token) view returns (bool)'
    ];
  }

  /**
   * Stop the service
   */
  async stop(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    this.logger.info('Stopping VaultCapitalService...');

    // Remove event listeners
    this.vaultManager.removeAllListeners();

    // Wait for active allocations to complete
    if (this.activeAllocations.size > 0) {
      this.logger.warn(`${this.activeAllocations.size} active allocations still pending`);
    }

    this.isInitialized = false;
    this.logger.info('VaultCapitalService stopped');
  }
}

export default VaultCapitalService;
