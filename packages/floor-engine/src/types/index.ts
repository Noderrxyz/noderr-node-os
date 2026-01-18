/**
 * Floor Engine Type Definitions
 * 
 * Comprehensive type system for the low-risk yield generation engine
 */

import { BigNumberish } from 'ethers';

// ============================================================================
// ADAPTER TYPES
// ============================================================================

/**
 * Adapter category classification
 */
export enum AdapterCategory {
  LENDING = 'lending',
  STAKING = 'staking',
  YIELD = 'yield',
  RESTAKING = 'restaking',
  LIQUIDITY = 'liquidity'
}

/**
 * Risk level classification
 */
export type RiskLevel = 'low' | 'medium' | 'high';

/**
 * Adapter metadata for registration
 */
export interface AdapterMetadata {
  id: string;
  name: string;
  version: string;
  protocol: string;
  chain: string;
  category: AdapterCategory;
  riskLevel: RiskLevel;
  enabled: boolean;
  maxAllocation: bigint; // Maximum capital per adapter
  description?: string;
  historicalAPY?: number;
}

/**
 * Transaction result from adapter operations
 */
export interface TransactionResult {
  success: boolean;
  transactionHash?: string;
  blockNumber?: number;
  gasUsed?: bigint;
  error?: string;
}

// ============================================================================
// LENDING ADAPTER TYPES
// ============================================================================

/**
 * Lending position details
 */
export interface LendingPosition {
  supplied: bigint;
  borrowed: bigint;
  collateralValue: bigint;
  healthFactor: number;
  supplyAPY: number;
  borrowAPY: number;
}

/**
 * Lending adapter interface
 */
export interface ILendingAdapter {
  supply(asset: string, amount: BigNumberish): Promise<TransactionResult>;
  withdraw(asset: string, shares: BigNumberish): Promise<TransactionResult>;
  borrow(asset: string, amount: BigNumberish, maxRateBps: number): Promise<TransactionResult>;
  repay(asset: string, amount: BigNumberish): Promise<TransactionResult>;
  getSupplyAPY(asset: string): Promise<number>;
  getPosition(asset: string): Promise<LendingPosition>;
}

// ============================================================================
// STAKING ADAPTER TYPES
// ============================================================================

/**
 * Staking position details
 */
export interface StakingPosition {
  staked: bigint;
  rewards: bigint;
  exchangeRate: bigint; // e.g., stETH/ETH rate
  apy: number;
  unbondingPeriod: number; // seconds
}

/**
 * Staking adapter interface
 */
export interface IStakingAdapter {
  stake(amount: BigNumberish): Promise<TransactionResult>;
  unstake(shares: BigNumberish): Promise<TransactionResult>;
  claimRewards(): Promise<TransactionResult>;
  getAPY(): Promise<number>;
  getPosition(): Promise<StakingPosition>;
}

// ============================================================================
// YIELD ADAPTER TYPES
// ============================================================================

/**
 * Yield farming position details
 */
export interface YieldPosition {
  deposited: bigint;
  rewards: bigint;
  apy: number;
  rewardTokens: string[];
}

/**
 * Yield farming adapter interface
 */
export interface IYieldAdapter {
  deposit(lpToken: string, amount: BigNumberish): Promise<TransactionResult>;
  withdraw(lpToken: string, shares: BigNumberish): Promise<TransactionResult>;
  harvest(): Promise<TransactionResult>;
  compound(): Promise<TransactionResult>;
  getAPY(lpToken: string): Promise<number>;
  getPosition(lpToken: string): Promise<YieldPosition>;
}

// ============================================================================
// RESTAKING ADAPTER TYPES
// ============================================================================

/**
 * Restaking position details
 */
export interface RestakingPosition {
  staked: bigint;
  rewards: bigint;
  shares: bigint; // Protocol-specific shares (e.g., EigenLayer shares)
  liquidTokenBalance: bigint; // Liquid restaking token balance (e.g., eETH, weETH)
  apy: number;
  unbondingPeriod: number; // seconds
  delegatedTo?: string; // Operator address (if applicable)
}

/**
 * Restaking adapter interface
 */
export interface IRestakingAdapter {
  stake(amount: BigNumberish): Promise<TransactionResult>;
  unstake(shares: BigNumberish): Promise<TransactionResult>;
  claimRewards(): Promise<TransactionResult>;
  delegate?(operator: string): Promise<TransactionResult>; // Optional delegation
  undelegate?(): Promise<TransactionResult>; // Optional undelegation
  getAPY(): Promise<number>;
  getPosition(): Promise<RestakingPosition>;
  getShares(): Promise<bigint>;
  getLiquidTokenBalance(): Promise<bigint>;
}

// ============================================================================
// POSITION TYPES
// ============================================================================

/**
 * Generic position across all adapter types
 */
export interface FloorPosition {
  adapterId: string;
  protocol: string;
  category: AdapterCategory;
  value: bigint;
  apy: number;
  lastUpdate: number; // timestamp
  metadata: Record<string, any>;
}

// ============================================================================
// ALLOCATION TYPES
// ============================================================================

/**
 * Capital allocation strategy
 */
export interface AllocationStrategy {
  lending: number; // percentage (0-100)
  staking: number; // percentage (0-100)
  yield: number; // percentage (0-100)
  restaking?: number; // percentage (0-100) - optional for backward compatibility
}

/**
 * Target allocation per adapter
 */
export interface TargetAllocation {
  adapterId: string;
  targetPercentage: number;
  minPercentage: number;
  maxPercentage: number;
}

// ============================================================================
// RISK MANAGEMENT TYPES
// ============================================================================

/**
 * Risk parameters for the Floor Engine
 */
export interface RiskParameters {
  maxAllocationPerAdapter: bigint; // e.g., 20% of total capital
  maxAllocationPerProtocol: bigint; // e.g., 40% of total capital
  maxAllocationPerChain: bigint; // e.g., 60% of total capital
  maxSlippageBps: number; // e.g., 50 bps (0.5%)
  maxDrawdownBps: number; // e.g., 500 bps (5%)
  allowedTokens: string[]; // Whitelist of tokens
  allowedProtocols: string[]; // Whitelist of protocols
  emergencyPauseEnabled: boolean;
  maxMLRiskScore?: number; // Maximum ML-generated risk score (0-100)
}

/**
 * Risk metrics for monitoring
 */
export interface RiskMetrics {
  totalExposure: bigint;
  exposureByProtocol: Record<string, bigint>;
  exposureByChain: Record<string, bigint>;
  currentDrawdown: number;
  maxDrawdown: number;
  sharpeRatio: number;
  volatility: number;
}

// ============================================================================
// PERFORMANCE TYPES
// ============================================================================

/**
 * Performance metrics for the Floor Engine
 */
export interface PerformanceMetrics {
  totalValue: bigint;
  totalDeposited: bigint;
  totalYield: bigint;
  currentAPY: number;
  averageAPY: number; // 30-day rolling average
  sharpeRatio: number;
  maxDrawdown: number;
  positions: FloorPosition[];
  lastRebalance: number; // timestamp
  lastHarvest: number; // timestamp
}

/**
 * Historical performance data point
 */
export interface PerformanceSnapshot {
  timestamp: number;
  totalValue: bigint;
  apy: number;
  positions: FloorPosition[];
}

// ============================================================================
// REBALANCING TYPES
// ============================================================================

/**
 * Rebalancing action
 */
export interface RebalanceAction {
  adapterId: string;
  action: 'deposit' | 'withdraw';
  amount: bigint;
  reason: string;
}

/**
 * Rebalancing result
 */
export interface RebalanceResult {
  success: boolean;
  actions: RebalanceAction[];
  gasUsed: bigint;
  timestamp: number;
  error?: string;
}

// ============================================================================
// CONFIGURATION TYPES
// ============================================================================

/**
 * Floor Engine configuration
 */
export interface FloorEngineConfig {
  // Blockchain configuration
  rpcUrl: string;
  chainId: number;
  networkName: string;

  // Wallet configuration
  privateKey: string;

  // Contract addresses
  treasuryManagerAddress: string;

  // Allocation strategy
  allocationStrategy: AllocationStrategy;
  targetAllocations: TargetAllocation[];

  // Risk parameters
  riskParameters: RiskParameters;

  // Rebalancing configuration
  rebalanceThresholdBps: number; // e.g., 500 bps (5% deviation triggers rebalance)
  minRebalanceInterval: number; // seconds between rebalances
  autoRebalanceEnabled: boolean;

  // Harvesting configuration
  autoHarvestEnabled: boolean;
  minHarvestInterval: number; // seconds between harvests
  minHarvestAmount: bigint; // minimum yield to trigger harvest

  // Logging configuration
  logLevel: string;
  logFile: string;
}

// ============================================================================
// EVENT TYPES
// ============================================================================

/**
 * Floor Engine events
 */
export type FloorEngineEvent =
  | { type: 'capital_allocated'; adapterId: string; amount: bigint }
  | { type: 'capital_withdrawn'; adapterId: string; amount: bigint }
  | { type: 'rebalance_triggered'; reason: string }
  | { type: 'rebalance_completed'; actions: RebalanceAction[] }
  | { type: 'harvest_completed'; totalYield: bigint }
  | { type: 'emergency_pause'; reason: string }
  | { type: 'adapter_enabled'; adapterId: string }
  | { type: 'adapter_disabled'; adapterId: string };

/**
 * Event listener callback
 */
export type EventListener = (event: FloorEngineEvent) => void;

// ============================================================================
// UTILITY TYPES
// ============================================================================

/**
 * Chain information
 */
export interface ChainInfo {
  chainId: number;
  name: string;
  rpcUrl: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
}

/**
 * Token information
 */
export interface TokenInfo {
  address: string;
  symbol: string;
  decimals: number;
  name: string;
}

/**
 * Protocol information
 */
export interface ProtocolInfo {
  name: string;
  category: AdapterCategory;
  chains: number[];
  riskLevel: RiskLevel;
  tvl: bigint;
  apy: number;
}
