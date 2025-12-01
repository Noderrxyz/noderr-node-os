/**
 * Type definitions for ML Client
 */

export enum MarketRegime {
  BULL = 'BULL',
  BEAR = 'BEAR',
  SIDEWAYS = 'SIDEWAYS',
  VOLATILE = 'VOLATILE'
}

export interface MLPrediction {
  symbol: string;
  expectedReturn: number;
  volatility: number;
  confidence: number;
  regime?: MarketRegime;
  timestamp: number;
}

export interface MLFeatures {
  symbol: string;
  features: number[];
  featureNames?: string[];
  timestamp: number;
}

export interface MLServiceStatus {
  connected: boolean;
  healthy: boolean;
  uptime: number;
  requestCount: number;
  avgLatency: number;
  version: string;
}

export interface MLError extends Error {
  code: string;
  details?: any;
}
