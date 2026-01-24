/**
 * Strategy and Monitoring Types
 */
export interface Strategy {
    id: string;
    name: string;
    type: 'MOMENTUM' | 'MEAN_REVERSION' | 'ARBITRAGE' | 'MARKET_MAKING' | 'FUNDAMENTAL';
    currentWeight?: number;
    targetWeight?: number;
    stage?: number;
    status?: 'active' | 'paused' | 'deprecated';
    parameters?: StrategyParameters;
    developer?: string;
    ipfsHash?: string;
    maxCapital?: number;
    sampleSize?: number;
    isActive?: boolean;
    code?: string;
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
//# sourceMappingURL=strategy-types.d.ts.map