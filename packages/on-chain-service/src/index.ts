import { loadConfig, validateConfig } from './config';
import { createLogger } from './utils/logger';
import { RateLimiter } from './utils/rateLimiter';
import { CircuitBreaker } from './utils/circuitBreaker';
import { CapitalManager } from './services/CapitalManager';
import { RewardDistributor } from './services/RewardDistributor';
import { TrustUpdater } from './services/TrustUpdater';
import { OnChainServiceConfig, HealthStatus } from './types';
import { Logger } from 'winston';

/**
 * On-Chain Interaction Service
 * 
 * Main orchestrator for all on-chain operations between the ATE and smart contracts
 */
export class OnChainService {
  private config: OnChainServiceConfig;
  private logger: Logger;
  private rateLimiter: RateLimiter;
  private circuitBreaker: CircuitBreaker;

  // Core services
  public readonly capitalManager: CapitalManager;
  public readonly rewardDistributor: RewardDistributor;
  public readonly trustUpdater: TrustUpdater;

  constructor(config?: OnChainServiceConfig) {
    // Load and validate configuration
    this.config = config || loadConfig();
    validateConfig(this.config);

    // Initialize utilities
    this.logger = createLogger(this.config);
    this.rateLimiter = new RateLimiter(this.config.rateLimitRequestsPerHour);
    this.circuitBreaker = new CircuitBreaker();

    // Initialize services
    this.capitalManager = new CapitalManager(
      this.config,
      this.logger,
      this.rateLimiter,
      this.circuitBreaker
    );

    this.rewardDistributor = new RewardDistributor(
      this.config,
      this.logger,
      this.rateLimiter,
      this.circuitBreaker
    );

    this.trustUpdater = new TrustUpdater(
      this.config,
      this.logger,
      this.rateLimiter,
      this.circuitBreaker
    );

    this.logger.info('OnChainService initialized', {
      network: this.config.networkName,
      chainId: this.config.chainId,
    });
  }

  /**
   * Get service health status
   */
  async getHealth(): Promise<HealthStatus> {
    try {
      // Check RPC connection
      const provider = this.capitalManager['provider'];
      const network = await provider.getNetwork();
      const rpcConnected = network.chainId === BigInt(this.config.chainId);

      // Check wallet connection
      const wallet = this.capitalManager['wallet'];
      const balance = await provider.getBalance(wallet.address);
      const walletConnected = balance >= 0n;

      // Check if contracts are deployed
      const treasuryCode = await provider.getCode(this.config.treasuryManagerAddress);
      const rewardCode = await provider.getCode(this.config.merkleRewardDistributorAddress);
      const trustCode = await provider.getCode(this.config.trustFingerprintAddress);
      const contractsDeployed = 
        treasuryCode !== '0x' && 
        rewardCode !== '0x' && 
        trustCode !== '0x';

      return {
        isHealthy: rpcConnected && walletConnected && contractsDeployed && !this.circuitBreaker.isOpen(),
        rpcConnected,
        walletConnected,
        contractsDeployed,
        circuitBreaker: this.circuitBreaker.getStatus(),
        rateLimiter: this.rateLimiter.getStatus(),
      };
    } catch (error: any) {
      this.logger.error('Health check failed', { error: error.message });
      return {
        isHealthy: false,
        rpcConnected: false,
        walletConnected: false,
        contractsDeployed: false,
        circuitBreaker: this.circuitBreaker.getStatus(),
        rateLimiter: this.rateLimiter.getStatus(),
      };
    }
  }

  /**
   * Reset rate limiter (admin function)
   */
  resetRateLimiter(): void {
    this.rateLimiter.reset();
    this.logger.info('Rate limiter reset');
  }

  /**
   * Reset circuit breaker (admin function)
   */
  resetCircuitBreaker(): void {
    this.circuitBreaker.reset();
    this.logger.info('Circuit breaker reset');
  }

  /**
   * Trip circuit breaker manually (admin function)
   */
  tripCircuitBreaker(reason: string): void {
    this.circuitBreaker.trip(reason);
    this.logger.warn('Circuit breaker manually tripped', { reason });
  }

  /**
   * Get logger instance
   */
  getLogger(): Logger {
    return this.logger;
  }

  /**
   * Get configuration
   */
  getConfig(): OnChainServiceConfig {
    return { ...this.config };
  }
}

// Export all types and utilities
export * from './types';
export * from './config';
export * from './utils/logger';
export * from './utils/rateLimiter';
export * from './utils/circuitBreaker';
export * from './utils/merkle';
export * from './services/CapitalManager';
export * from './services/RewardDistributor';
export * from './services/TrustUpdater';

// Export default instance creator
export function createOnChainService(config?: OnChainServiceConfig): OnChainService {
  return new OnChainService(config);
}
