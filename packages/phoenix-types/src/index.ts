/**
 * Project Phoenix: Core Types and Interfaces
 */

// ============ Time Series & Data ============

export interface ITimeSeries<T> {
  timestamps: number[];
  values: T[];
}

export interface IDataPoint {
  timestamp: number;
  value: number;
}

// ============ Features ============

export interface IFeature {
  name: string;
  value: number | number[];
}

export interface IFeatureSet {
  timestamp: number;
  features: Record<string, IFeature>;
}

// ============ Models ============

export interface IModel<TInput, TOutput> {
  train(data: TInput[]): Promise<void>;
  predict(data: TInput): Promise<TOutput>;
  evaluate(data: TInput[], labels: TOutput[]): Promise<Record<string, number>>;
}

// ============ Strategy ============

export type TradingAction = 'buy' | 'sell' | 'hold';

export interface ITradingSignal {
  action: TradingAction;
  symbol: string;
  confidence: number;
  source: string;
}

export interface IStrategy {
  generateSignal(features: IFeatureSet): Promise<ITradingSignal>;
}

// ============ Execution ============

export interface IExecutionClient {
  executeOrder(signal: ITradingSignal): Promise<void>;
}

export * from './execution';
