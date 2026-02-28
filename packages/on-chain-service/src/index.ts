import { loadConfig, validateConfig } from './config';
import { createLogger } from './utils/logger';
import { RateLimiter } from './utils/rateLimiter';
import { CircuitBreaker } from './utils/circuitBreaker';
import { CapitalManager } from './services/CapitalManager';
import { RewardDistributor } from './services/RewardDistributor';
import { TrustUpdater } from './services/TrustUpdater';
import { RewardOrchestrator } from './services/RewardOrchestrator';
import { RewardEpochScheduler, HttpTelemetryClient } from './services/RewardEpochScheduler';
import { TrustFingerprintSync, TrustFingerprintSyncScheduler } from './services/TrustFingerprintSync';

import { OnChainServiceConfig, ServiceHealthStatus } from '@noderr/types';
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
  public readonly rewardOrchestrator: RewardOrchestrator;
  public readonly rewardEpochScheduler: RewardEpochScheduler;
  public readonly trustFingerprintSync: TrustFingerprintSync;
  public readonly trustFingerprintSyncScheduler: TrustFingerprintSyncScheduler;


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

    this.rewardOrchestrator = new RewardOrchestrator(
      this.config,
      this.logger,
      this.rateLimiter,
      this.circuitBreaker,
      this.trustUpdater,
      this.rewardDistributor
    );

    // Initialize telemetry client
    const telemetryClient = new HttpTelemetryClient(
      this.config.telemetryServiceUrl || 'http://localhost:8080',
      this.logger
    );

    this.rewardEpochScheduler = new RewardEpochScheduler(
      this.rewardOrchestrator,
      telemetryClient,
      this.logger,
      {
        epochDurationSeconds: this.config.epochDurationSeconds,
        baseRewardRate: this.config.baseRewardRate ? BigInt(this.config.baseRewardRate) : undefined,
        vestingDuration: this.config.vestingDuration,
      }
    );

    this.trustFingerprintSync = new TrustFingerprintSync(
      this.config,
      this.logger,
      this.rateLimiter,
      this.circuitBreaker
    );

    this.trustFingerprintSyncScheduler = new TrustFingerprintSyncScheduler(
      this.trustFingerprintSync,
      this.logger,
      this.config.trustSyncIntervalSeconds || 3600
    );



    this.logger.info('OnChainService initialized', {
      network: this.config.networkName,
      chainId: this.config.chainId,
    });
  }

  /**
   * Get service health status
   */
  async getHealth(): Promise<ServiceHealthStatus> {
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
        healthy: rpcConnected && walletConnected && contractsDeployed && !this.circuitBreaker.isOpen(),
        timestamp: Date.now(),
        services: {
          rpc: rpcConnected,
          wallet: walletConnected,
          contracts: contractsDeployed,
          circuitBreaker: !this.circuitBreaker.isOpen(),
        },
      };
    } catch (error: any) {
      this.logger.error('Health check failed', { error: error.message });
      return {
        healthy: false,
        timestamp: Date.now(),
        services: {
          rpc: false,
          wallet: false,
          contracts: false,
          circuitBreaker: false,
        },
        errors: [error.message],
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
export * from '@noderr/types';
export * from './config';
export * from './utils/logger';
export * from './utils/rateLimiter';
export * from './utils/circuitBreaker';
export * from './utils/merkle';
export * from './services/CapitalManager';
export * from './services/RewardDistributor';
export * from './services/TrustUpdater';
export * from './services/RewardOrchestrator';
export * from './services/RewardEpochScheduler';
export * from './services/TrustFingerprintSync';

// Export default instance creator
export function createOnChainService(config?: OnChainServiceConfig): OnChainService {
  return new OnChainService(config);
}

// ============================================================================
// Main Entry Point
// ============================================================================

import { getShutdownHandler, onShutdown } from '@noderr/utils';

let onChainService: OnChainService | null = null;

/**
 * Start the on-chain service
 */
export async function startOnChainService(): Promise<void> {
  try {
    console.log('Starting On-Chain Service...');
    
    // Create service instance
    onChainService = createOnChainService();
    
    // Check health
    const health = await onChainService.getHealth();
    console.log('On-Chain Service health check:', health);
    
    if (!health.healthy) {
      console.error('On-Chain Service health check failed:', health.errors);
      throw new Error('Service health check failed');
    }
    

    // Register graceful shutdown
    onShutdown('on-chain-service', async () => {
      console.log('Shutting down on-chain service...');
      
      // Flush any pending operations
      // TODO: Implement graceful shutdown logic
      
      console.log('On-chain service shut down complete');
    }, 10000);
    
    // Start schedulers so they keep the event loop alive with their setIntervals
    onChainService.rewardEpochScheduler.start();
    onChainService.trustFingerprintSyncScheduler.start();
    
    console.log('On-Chain Service started successfully');
    
    // Keepalive: prevents the event loop from draining if all other handles
    // are cleared (e.g. ethers provider polling is paused). The schedulers
    // above also keep the loop alive, but this is a belt-and-suspenders guard.
    const _keepAlive = setInterval(() => { /* no-op */ }, 30_000);
    
    // Wait forever (resolved only by graceful shutdown)
    await new Promise<void>((resolve) => {
      onShutdown('on-chain-service-main', async () => {
        clearInterval(_keepAlive);
        resolve();
      }, 5000);
    });
  } catch (error) {
    console.error('Failed to start On-Chain Service:', error);
    throw error;
  }
}

/**
 * If run directly, start the service
 */
if (require.main === module) {
  getShutdownHandler(30000);
  
  startOnChainService().catch((error) => {
    console.error('Fatal error starting On-Chain Service:', error);
    process.exit(1);
  });
}
