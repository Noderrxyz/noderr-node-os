/**
 * Strategy and Monitoring Types
 */

export interface StrategyRiskParams {
  maxPositionSizePercent: bigint;
  maxLeverage: bigint;
  stopLossPercent: bigint;
  slippageToleranceBps: bigint;
  correlationThreshold: bigint;
  velocityLimit: bigint;
  flashLoansEnabled: boolean;
}

export interface Strategy {
  id: string;
  name: string;
  type?: 'MOMENTUM' | 'MEAN_REVERSION' | 'ARBITRAGE' | 'MARKET_MAKING' | 'FUNDAMENTAL';
  currentWeight?: number;
  targetWeight?: number;
  stage?: number;
  status?: 'active' | 'paused' | 'deprecated' | number;
  parameters?: StrategyParameters;
  developer?: string;
  ipfsHash?: string;
  maxCapital?: number;
  sampleSize?: number;
  isActive?: boolean;
  code?: string;
  // On-chain contract fields
  isDNA?: boolean;
  dnaString?: string;
  strategyContract?: string;
  description?: string;
  submitter?: string;
  riskParams?: StrategyRiskParams;
}

export interface MonitorConfig {
  checkInterval: number;
  performanceWindow: number;
  monitorIntervalMs?: number;
  minSharpeRatio?: number;
  maxDrawdown?: number;
  minWinRate?: number;
}

export interface StrategyParameters {
  [key: string]: any;
}
