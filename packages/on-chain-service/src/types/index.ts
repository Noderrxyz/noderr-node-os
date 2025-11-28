import { BigNumberish } from 'ethers';

/**
 * Configuration for the On-Chain Interaction Service
 */
export interface OnChainServiceConfig {
  // Blockchain Configuration
  rpcUrl: string;
  chainId: number;
  networkName: string;

  // Wallet Configuration
  privateKey: string;

  // Contract Addresses
  treasuryManagerAddress: string;
  merkleRewardDistributorAddress: string;
  trustFingerprintAddress: string;
  nodeRegistryAddress?: string;
  governanceManagerAddress?: string;

  // Security Configuration
  maxCapitalRequest: BigNumberish;  // Maximum capital per request (5% of treasury)
  dailyCapitalLimit: BigNumberish;  // Maximum capital per day (15% of treasury)
  rateLimitRequestsPerHour: number; // Maximum on-chain transactions per hour

  // Logging Configuration
  logLevel: 'error' | 'warn' | 'info' | 'debug';
  logFile?: string;
}

/**
 * Reward entry for Merkle tree generation
 */
export interface RewardEntry {
  address: string;
  amount: BigNumberish;
}

/**
 * Merkle proof for claiming rewards
 */
export interface MerkleProof {
  leaf: string;
  proof: string[];
}

/**
 * Performance metrics for strategy reporting
 */
export interface PerformanceMetrics {
  strategyId: string;
  pnl: BigNumberish;           // Profit and loss
  sharpeRatio: number;          // Sharpe ratio * 100 (e.g., 2.50 = 250)
  maxDrawdown?: number;         // Max drawdown percentage * 100
  winRate?: number;             // Win rate percentage * 100
  totalTrades?: number;         // Total number of trades
}

/**
 * Trust score update entry
 */
export interface TrustScoreUpdate {
  address: string;
  score: number;  // Score in basis points (0-10000)
}

/**
 * Capital request parameters
 */
export interface CapitalRequest {
  amount: BigNumberish;
  strategyId: string;
  token: string;  // Token address (address(0) for ETH)
  reason?: string;
}

/**
 * Transaction result
 */
export interface TransactionResult {
  success: boolean;
  transactionHash?: string;
  blockNumber?: number;
  gasUsed?: bigint;
  error?: string;
}

/**
 * Circuit breaker status
 */
export interface CircuitBreakerStatus {
  isTripped: boolean;
  reason?: string;
  timestamp?: number;
}

/**
 * Rate limiter status
 */
export interface RateLimiterStatus {
  requestsInLastHour: number;
  limit: number;
  canMakeRequest: boolean;
  resetTime: number;
}

/**
 * Service health status
 */
export interface HealthStatus {
  isHealthy: boolean;
  rpcConnected: boolean;
  walletConnected: boolean;
  contractsDeployed: boolean;
  circuitBreaker: CircuitBreakerStatus;
  rateLimiter: RateLimiterStatus;
  lastTransaction?: {
    hash: string;
    timestamp: number;
    status: 'pending' | 'confirmed' | 'failed';
  };
}
