/**
 * @noderr/types - Shared TypeScript type definitions
 */

// Core Trading Types
export interface Order {
  id: string;
  clientOrderId?: string;
  symbol: string;
  side: OrderSide | 'buy' | 'sell';
  type: OrderType | 'market' | 'limit' | 'stop';
  price?: number;
  amount: number;
  quantity?: number; // Alias for amount
  status: OrderStatus;
  timestamp: number;
  timeInForce?: TimeInForce;
  exchange?: string;
  createdAt?: number;
  updatedAt?: number;
  metadata?: Record<string, any>;
}

export enum OrderStatus {
  PENDING = 'pending',
  NEW = 'new',
  OPEN = 'open',
  PARTIALLY_FILLED = 'partially_filled',
  FILLED = 'filled',
  CANCELLED = 'cancelled',
  REJECTED = 'rejected',
  EXPIRED = 'expired'
}

export enum OrderSide {
  BUY = 'buy',
  SELL = 'sell'
}

export enum OrderType {
  MARKET = 'market',
  LIMIT = 'limit',
  STOP = 'stop',
  STOP_LIMIT = 'stop_limit'
}

export enum TimeInForce {
  GTC = 'gtc', // Good Till Cancel
  IOC = 'ioc', // Immediate Or Cancel
  FOK = 'fok', // Fill Or Kill
  DAY = 'day', // Day Order
  POST_ONLY = 'post_only' // Post Only (maker only)
}

export interface Trade {
  id: string;
  orderId: string;
  symbol: string;
  side: 'buy' | 'sell';
  price: number;
  amount: number;
  fee: number;
  timestamp: number;
  venue: string;
}

export interface Position {
  symbol: string;
  amount: number;
  averagePrice: number;
  unrealizedPnl: number;
  realizedPnl: number;
  lastUpdate: number;
}

// Execution Types
export interface ExecutionResult {
  success?: boolean;
  orderId?: string;
  status?: OrderStatus;
  trades?: Trade[];
  fills?: Fill[];
  error?: string;
  metadata?: Record<string, any>;
  averagePrice?: number;
  totalQuantity?: number;
  totalFees?: number;
  slippage?: number;
  marketImpact?: number;
  executionTime?: number;
  routes?: ExecutedRoute[];
  performance?: any;
}

export enum ExecutionErrorCode {
  INVALID_ORDER = 'INVALID_ORDER',
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  VENUE_ERROR = 'VENUE_ERROR',
  TIMEOUT = 'TIMEOUT',
  RATE_LIMIT = 'RATE_LIMIT',
  NETWORK_ERROR = 'NETWORK_ERROR',
  UNKNOWN = 'UNKNOWN'
}

export class ExecutionError extends Error {
  constructor(
    message: string,
    public code: ExecutionErrorCode,
    public details?: any
  ) {
    super(message);
    this.name = 'ExecutionError';
  }
}

export enum ExecutionStatus {
  PENDING = 'pending',
  PARTIAL = 'partial',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired'
}

export interface Fill {
  id: string;
  orderId: string;
  symbol: string;
  side: OrderSide | 'buy' | 'sell';
  price: number;
  quantity: number;
  fee: number;
  fees?: number; // Alias for fee
  timestamp: number;
  venue?: string;
  exchange?: string;
  liquidity?: 'maker' | 'taker';
  tradeId?: string;
}

export interface AlgorithmParameters {
  [key: string]: any;
}

export interface ExecutionConstraints {
  maxSlippage?: number;
  maxLatency?: number;
  minFillRate?: number;
  venues?: string[];
}

export interface ExecutionRoute {
  venue: string;
  exchange?: string;
  quantity: number;
  priority: number;
  price?: number;
  fees?: number;
  slippage?: number;
  latency?: number;
  orderType?: OrderType | string;
}

export interface Exchange {
  id: string;
  name: string;
  enabled: boolean;
  fees: TradingFees;
}

export interface TradingFees {
  maker: number;
  taker: number;
  withdrawal?: number;
  rebate?: number;
}

export interface PriceLevel {
  price: number;
  quantity: number;
}

export interface ExecutionObjectives {
  primary?: 'cost' | 'speed' | 'stealth' | 'impact';
  minimizeCost?: boolean;
  minimizeSlippage?: boolean;
  minimizeLatency?: boolean;
  maximizeFillRate?: boolean;
}

export interface CostAnalysis {
  totalCost: number;
  fees: number;
  slippage: number;
  priceImpact: number;
}

export interface ExecutedRoute extends ExecutionRoute {
  fills: Fill[];
  avgPrice: number;
  averagePrice?: number; // Alias for avgPrice
  totalFee: number;
}

export interface ExecutionPerformance {
  avgPrice: number;
  totalFee: number;
  slippage: number;
  latency: number;
  fillRate: number;
}

export interface ExecutionStrategy {
  type: 'market' | 'limit' | 'twap' | 'vwap' | 'iceberg';
  params: Record<string, any>;
}

export interface VenueConfig {
  name: string;
  enabled: boolean;
  priority: number;
  rateLimit?: number;
  credentials?: Record<string, string>;
}

// Risk Types
export interface RiskMetrics {
  var95: number;
  var99: number;
  sharpe: number;
  sortino: number;
  maxDrawdown: number;
  currentExposure: number;
  leverage: number;
}

export interface RiskLimits {
  maxPositionSize: number;
  maxLeverage: number;
  maxDrawdown: number;
  dailyLossLimit: number;
  positionLimits: Record<string, number>;
}

// ML Types
export interface ModelConfig {
  name: string;
  type: 'transformer' | 'lstm' | 'rl' | 'ensemble';
  version: string;
  parameters: Record<string, any>;
}

export interface Prediction {
  symbol: string;
  timestamp: number;
  horizon: number;
  value: number;
  confidence: number;
  metadata?: Record<string, any>;
}

// Algorithm Types
export interface AlgorithmConfig {
  type: string;
  params: Record<string, any>;
  parameters?: Record<string, any>; // Alias for params
}

export interface TWAPConfig extends AlgorithmConfig {
  type: 'twap';
  params: {
    duration: number;
    slices: number;
    randomize?: boolean;
  };
}

export interface VWAPConfig extends AlgorithmConfig {
  type: 'vwap';
  params: {
    lookbackPeriod: number;
    volumeProfile: 'historical' | 'realtime';
  };
}

// MEV Types
export interface MEVConfig {
  useFlashbots: boolean;
  privateMempools: string[];
  bundleTimeout: number;
  maxPriorityFee?: number;
}

// Safety Types
export interface SafetyConfig {
  maxSlippage: number;
  circuitBreaker: {
    enabled: boolean;
    lossThreshold: number;
    cooldownPeriod: number;
  };
  failover: {
    enabled: boolean;
    retryAttempts: number;
    backoffMultiplier: number;
  };
}

// Event Types
export interface SystemEvent {
  id: string;
  type: string;
  timestamp: number;
  data: any;
  source: string;
}

export interface TradingEvent extends SystemEvent {
  type: 'order' | 'trade' | 'position' | 'risk';
  symbol?: string;
  venue?: string;
}

// On-Chain Service Types
export interface OnChainServiceConfig {
  rpcUrl: string;
  privateKey: string;
  treasuryManagerAddress: string;
  merkleRewardDistributorAddress: string;
  trustFingerprintAddress: string;
  chainId: number;
}

export interface CapitalRequest {
  amount: bigint;
  strategyId: string;
  token: string;
}

export interface PerformanceMetrics {
  pnl: bigint;
  sharpeRatio: number;
  strategyId: string;
}

export interface TransactionResult {
  success: boolean;
  transactionHash?: string;
  blockNumber?: number;
  gasUsed?: bigint;
  error?: string;
}

export interface RewardEntry {
  address: string;
  amount: bigint;
}

export interface MerkleProof {
  proof: string[];
  leaf: string;
}

export interface TrustScoreUpdate {
  operator: string;
  uptime: number;
  quality: number;
  governance: number;
  history: number;
  peer: number;
  stake: number;
}

export interface CircuitBreakerStatus {
  isOpen: boolean;
  failures: number;
  lastFailure?: number;
  reason?: string;
}

export interface RateLimiterStatus {
  requestCount: number;
  windowStart: number;
  limit: number;
}

export enum MarketCondition {
  NORMAL = 'normal',
  VOLATILE = 'volatile',
  TRENDING = 'trending',
  RANGING = 'ranging'
}

export enum AlgorithmType {
  TWAP = 'twap',
  VWAP = 'vwap',
  POV = 'pov',
  ICEBERG = 'iceberg',
  ADAPTIVE = 'adaptive'
}

export interface RateLimit {
  maxRequests: number;
  windowMs: number;
  requests?: number;
  remaining?: number;
  reset?: number;
  period?: number;
}

export enum ExecutionUrgency {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

// Re-export common types for convenience
export type OrderId = string;
export type TradeId = string;
export type Symbol = string;
export type Venue = string;
export type Timestamp = number; 