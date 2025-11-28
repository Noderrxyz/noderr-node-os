/**
 * @noderr/types - Shared TypeScript type definitions
 */

// Core Trading Types
export interface Order {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit' | 'stop';
  price?: number;
  amount: number;
  status: OrderStatus;
  timestamp: number;
  metadata?: Record<string, any>;
}

export enum OrderStatus {
  PENDING = 'pending',
  OPEN = 'open',
  PARTIALLY_FILLED = 'partially_filled',
  FILLED = 'filled',
  CANCELLED = 'cancelled',
  REJECTED = 'rejected',
  EXPIRED = 'expired'
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
  success: boolean;
  orderId?: string;
  trades?: Trade[];
  error?: string;
  metadata?: Record<string, any>;
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

// Re-export common types for convenience
export type OrderId = string;
export type TradeId = string;
export type Symbol = string;
export type Venue = string;
export type Timestamp = number; 