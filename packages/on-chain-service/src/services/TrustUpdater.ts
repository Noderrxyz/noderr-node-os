import { ethers, Contract, Wallet, Provider } from 'ethers';
import { Logger } from 'winston';
import {
  OnChainServiceConfig,
  TrustScoreUpdate,
  TransactionResult,
} from '@noderr/types';
import { RateLimiter } from '../utils/rateLimiter';
import { CircuitBreaker } from '../utils/circuitBreaker';

// TrustFingerprint ABI (minimal interface)
const TRUST_FINGERPRINT_ABI = [
  'function updateScore(address operator, uint16 uptime, uint16 quality, uint16 governance, uint16 history, uint16 peer, uint16 stake) external',
  'function batchUpdateScores(address[] calldata operators, uint16[] calldata uptime, uint16[] calldata quality, uint16[] calldata governance, uint16[] calldata history, uint16[] calldata peer, uint16[] calldata stake) external',
  'function getScore(address operator) external view returns (uint16)',
  'function getScoreComponents(address operator) external view returns (uint16 uptime, uint16 quality, uint16 governance, uint16 history, uint16 peer, uint16 stake)',
];

/**
 * Score components for TrustFingerprint calculation
 */
export interface ScoreComponents {
  uptime: number;      // 0-10000 (0-100%)
  quality: number;     // 0-10000
  governance: number;  // 0-10000
  history: number;     // 0-10000
  peer: number;        // 0-10000
  stake: number;       // 0-10000
}

/**
 * Trust Updater Service
 * 
 * Handles TrustFingerprint™ score updates:
 * - Submit individual score updates
 * - Batch update multiple scores
 * - Query current scores
 */
export class TrustUpdater {
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
      config.trustFingerprintAddress,
      TRUST_FINGERPRINT_ABI,
      this.wallet
    );

    this.logger.info('TrustUpdater initialized', {
      trustFingerprint: config.trustFingerprintAddress,
      wallet: this.wallet.address,
    });
  }

  /**
   * Update TrustFingerprint score for a single operator
   * 
   * @param operator Operator address
   * @param components Score components
   * @returns Transaction result
   */
  async updateScore(
    operator: string,
    components: ScoreComponents
  ): Promise<TransactionResult> {
    try {
      // Check circuit breaker
      if (this.circuitBreaker.isOpen()) {
        throw new Error(`Circuit breaker is open: ${this.circuitBreaker.getStatus().reason}`);
      }

      // Check rate limiter
      if (!this.rateLimiter.canMakeRequest()) {
        throw new Error('Rate limit exceeded');
      }

      // Validate components (all must be 0-10000)
      this.validateComponents(components);

      this.logger.info('Updating TrustFingerprint score', {
        operator,
        components,
      });

      // Record rate limit
      this.rateLimiter.recordRequest();

      // Execute transaction
      const tx = await this.contract.updateScore(
        operator,
        components.uptime,
        components.quality,
        components.governance,
        components.history,
        components.peer,
        components.stake
      );
      const receipt = await tx.wait();

      // Record success
      this.circuitBreaker.recordSuccess();

      this.logger.info('TrustFingerprint score updated', {
        operator,
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
    } catch (error: unknown) {
      this.logger.error('TrustFingerprint score update failed', {
        error: error.message,
        operator,
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
   * Batch update TrustFingerprint scores for multiple operators
   * 
   * @param updates Array of operator addresses and their score components
   * @returns Transaction result
   */
  async batchUpdateScores(
    updates: Array<{ operator: string; components: ScoreComponents }>
  ): Promise<TransactionResult> {
    try {
      // Check circuit breaker
      if (this.circuitBreaker.isOpen()) {
        throw new Error(`Circuit breaker is open: ${this.circuitBreaker.getStatus().reason}`);
      }

      // Check rate limiter
      if (!this.rateLimiter.canMakeRequest()) {
        throw new Error('Rate limit exceeded');
      }

      // Limit batch size
      if (updates.length > 100) {
        throw new Error(`Batch size too large: ${updates.length} > 100`);
      }

      // Validate all components
      for (const update of updates) {
        this.validateComponents(update.components);
      }

      this.logger.info('Batch updating TrustFingerprint scores', {
        updateCount: updates.length,
      });

      // Prepare arrays
      const operators = updates.map(u => u.operator);
      const uptime = updates.map(u => u.components.uptime);
      const quality = updates.map(u => u.components.quality);
      const governance = updates.map(u => u.components.governance);
      const history = updates.map(u => u.components.history);
      const peer = updates.map(u => u.components.peer);
      const stake = updates.map(u => u.components.stake);

      // Record rate limit
      this.rateLimiter.recordRequest();

      // Execute transaction
      const tx = await this.contract.batchUpdateScores(
        operators,
        uptime,
        quality,
        governance,
        history,
        peer,
        stake
      );
      const receipt = await tx.wait();

      // Record success
      this.circuitBreaker.recordSuccess();

      this.logger.info('Batch TrustFingerprint score update successful', {
        updateCount: updates.length,
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
    } catch (error: unknown) {
      this.logger.error('Batch TrustFingerprint score update failed', {
        error: error.message,
        updateCount: updates.length,
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
   * Get current TrustFingerprint score for an operator
   * 
   * @param operator Operator address
   * @returns Current score (0-10000)
   */
  async getScore(operator: string): Promise<number> {
    try {
      const score = await this.contract.getScore(operator);
      return Number(score);
    } catch (error: unknown) {
      this.logger.error('Failed to get TrustFingerprint score', {
        error: error.message,
        operator,
      });
      throw error;
    }
  }

  /**
   * Get score components for an operator
   * 
   * @param operator Operator address
   * @returns Score components
   */
  async getScoreComponents(operator: string): Promise<ScoreComponents> {
    try {
      const components = await this.contract.getScoreComponents(operator);
      return {
        uptime: Number(components[0]),
        quality: Number(components[1]),
        governance: Number(components[2]),
        history: Number(components[3]),
        peer: Number(components[4]),
        stake: Number(components[5]),
      };
    } catch (error: unknown) {
      this.logger.error('Failed to get score components', {
        error: error.message,
        operator,
      });
      throw error;
    }
  }

  /**
   * Validate score components
   * 
   * @param components Score components to validate
   */
  private validateComponents(components: ScoreComponents): void {
    const fields: (keyof ScoreComponents)[] = [
      'uptime',
      'quality',
      'governance',
      'history',
      'peer',
      'stake',
    ];

    for (const field of fields) {
      const value = components[field];
      if (value < 0 || value > 10000) {
        throw new Error(`Invalid ${field} component: ${value} (must be 0-10000)`);
      }
    }
  }
}
