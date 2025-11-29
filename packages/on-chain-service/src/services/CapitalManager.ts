import { ethers, Contract, Wallet, Provider } from 'ethers';
import { Logger } from 'winston';
import {
  OnChainServiceConfig,
  CapitalRequest,
  PerformanceMetrics,
  TransactionResult,
} from '@noderr/types';
import { RateLimiter } from '../utils/rateLimiter';
import { CircuitBreaker } from '../utils/circuitBreaker';

// TreasuryManager ABI (minimal interface for capital management)
const TREASURY_MANAGER_ABI = [
  'function requestCapital(uint256 amount, bytes32 strategyId, address token) external returns (bool)',
  'function depositProfit(uint256 amount, bytes32 strategyId, address token, int256 pnl) external payable',
  'function reportPerformance(bytes32 strategyId, int256 pnl, uint256 sharpeRatio) external',
  'function getStrategyCapital(bytes32 strategyId) external view returns (uint256)',
  'function getDailyWithdrawn() external view returns (uint256)',
  'function getOutstandingCapital() external view returns (uint256)',
];

/**
 * Capital Manager Service
 * 
 * Handles all capital management operations between the ATE and TreasuryManager:
 * - Request capital for trading strategies
 * - Deposit trading profits
 * - Report strategy performance metrics
 */
export class CapitalManager {
  private contract: Contract;
  private wallet: Wallet;
  private provider: Provider;
  private logger: Logger;
  private rateLimiter: RateLimiter;
  private circuitBreaker: CircuitBreaker;
  private config: OnChainServiceConfig;

  constructor(
    config: OnChainServiceConfig,
    logger: Logger,
    rateLimiter: RateLimiter,
    circuitBreaker: CircuitBreaker
  ) {
    this.config = config;
    this.logger = logger;
    this.rateLimiter = rateLimiter;
    this.circuitBreaker = circuitBreaker;

    // Initialize provider and wallet
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.wallet = new Wallet(config.privateKey, this.provider);

    // Initialize contract
    this.contract = new Contract(
      config.treasuryManagerAddress,
      TREASURY_MANAGER_ABI,
      this.wallet
    );

    this.logger.info('CapitalManager initialized', {
      treasuryManager: config.treasuryManagerAddress,
      wallet: this.wallet.address,
    });
  }

  /**
   * Request capital from the treasury for a trading strategy
   * 
   * @param request Capital request parameters
   * @returns Transaction result
   */
  async requestCapital(request: CapitalRequest): Promise<TransactionResult> {
    try {
      // Check circuit breaker
      if (this.circuitBreaker.isOpen()) {
        throw new Error(`Circuit breaker is open: ${this.circuitBreaker.getStatus().reason}`);
      }

      // Check rate limiter
      if (!this.rateLimiter.canMakeRequest()) {
        throw new Error('Rate limit exceeded');
      }

      // Validate request amount
      if (BigInt(request.amount) > BigInt(this.config.maxCapitalRequest)) {
        throw new Error(
          `Request amount exceeds maximum: ${request.amount} > ${this.config.maxCapitalRequest}`
        );
      }

      // Check daily limit
      const dailyWithdrawn = await this.contract.getDailyWithdrawn();
      const newTotal = BigInt(dailyWithdrawn) + BigInt(request.amount);
      if (newTotal > BigInt(this.config.dailyCapitalLimit)) {
        throw new Error(
          `Request would exceed daily limit: ${newTotal} > ${this.config.dailyCapitalLimit}`
        );
      }

      this.logger.info('Requesting capital', {
        amount: request.amount.toString(),
        strategyId: request.strategyId,
        reason: request.reason,
      });

      // Convert strategy ID to bytes32
      const strategyIdBytes32 = ethers.id(request.strategyId);

      // Record rate limit
      this.rateLimiter.recordRequest();

      // Execute transaction
      const tx = await this.contract.requestCapital(request.amount, strategyIdBytes32, request.token);
      const receipt = await tx.wait();

      // Record success
      this.circuitBreaker.recordSuccess();

      this.logger.info('Capital request successful', {
        transactionHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
      });

      return {
        success: true,
        transactionHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed,
      };
    } catch (error: any) {
      this.logger.error('Capital request failed', {
        error: error.message,
        amount: request.amount.toString(),
        strategyId: request.strategyId,
      });

      // Record failure
      this.circuitBreaker.recordFailure(error.message);

      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Deposit trading profits back to the treasury
   * 
   * @param amount Total amount to deposit (principal + profit)
   * @param strategyId Strategy identifier
   * @param token Token address (address(0) for ETH)
   * @param pnl Profit/loss amount (can be negative for losses)
   * @returns Transaction result
   */
  async depositProfit(amount: bigint, strategyId: string, token: string, pnl: bigint): Promise<TransactionResult> {
    try {
      // Check circuit breaker
      if (this.circuitBreaker.isOpen()) {
        throw new Error(`Circuit breaker is open: ${this.circuitBreaker.getStatus().reason}`);
      }

      // Check rate limiter
      if (!this.rateLimiter.canMakeRequest()) {
        throw new Error('Rate limit exceeded');
      }

      this.logger.info('Depositing profit', {
        amount: amount.toString(),
        strategyId,
        token,
        pnl: pnl.toString(),
      });

      // Convert strategy ID to bytes32
      const strategyIdBytes32 = ethers.id(strategyId);

      // Record rate limit
      this.rateLimiter.recordRequest();

      // Execute transaction
      // Handle ETH vs ERC20
      const tx = token === ethers.ZeroAddress
        ? await this.contract.depositProfit(amount, strategyIdBytes32, token, pnl, { value: amount })
        : await this.contract.depositProfit(amount, strategyIdBytes32, token, pnl);
      const receipt = await tx.wait();

      // Record success
      this.circuitBreaker.recordSuccess();

      this.logger.info('Profit deposit successful', {
        transactionHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
      });

      return {
        success: true,
        transactionHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed,
      };
    } catch (error: any) {
      this.logger.error('Profit deposit failed', {
        error: error.message,
        amount: amount.toString(),
        strategyId,
      });

      // Record failure
      this.circuitBreaker.recordFailure(error.message);

      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Report strategy performance metrics on-chain
   * 
   * @param metrics Performance metrics
   * @returns Transaction result
   */
  async reportPerformance(metrics: PerformanceMetrics): Promise<TransactionResult> {
    try {
      // Check circuit breaker
      if (this.circuitBreaker.isOpen()) {
        throw new Error(`Circuit breaker is open: ${this.circuitBreaker.getStatus().reason}`);
      }

      // Check rate limiter
      if (!this.rateLimiter.canMakeRequest()) {
        throw new Error('Rate limit exceeded');
      }

      this.logger.info('Reporting performance', {
        strategyId: metrics.strategyId,
        pnl: metrics.pnl.toString(),
        sharpeRatio: metrics.sharpeRatio,
      });

      // Convert strategy ID to bytes32
      const strategyIdBytes32 = ethers.id(metrics.strategyId);

      // Record rate limit
      this.rateLimiter.recordRequest();

      // Execute transaction
      const tx = await this.contract.reportPerformance(
        strategyIdBytes32,
        metrics.pnl,
        metrics.sharpeRatio
      );
      const receipt = await tx.wait();

      // Record success
      this.circuitBreaker.recordSuccess();

      this.logger.info('Performance report successful', {
        transactionHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
      });

      return {
        success: true,
        transactionHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed,
      };
    } catch (error: any) {
      this.logger.error('Performance report failed', {
        error: error.message,
        strategyId: metrics.strategyId,
      });

      // Record failure
      this.circuitBreaker.recordFailure(error.message);

      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get outstanding capital for a strategy
   * 
   * @param strategyId Strategy identifier
   * @returns Outstanding capital amount
   */
  async getStrategyCapital(strategyId: string): Promise<bigint> {
    const strategyIdBytes32 = ethers.id(strategyId);
    return await this.contract.getStrategyCapital(strategyIdBytes32);
  }

  /**
   * Get total capital withdrawn today
   * 
   * @returns Daily withdrawn amount
   */
  async getDailyWithdrawn(): Promise<bigint> {
    return await this.contract.getDailyWithdrawn();
  }

  /**
   * Get total outstanding capital across all strategies
   * 
   * @returns Total outstanding capital
   */
  async getOutstandingCapital(): Promise<bigint> {
    return await this.contract.getOutstandingCapital();
  }
}
