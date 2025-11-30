import { EventEmitter } from 'events';
interface Strategy {
    id: string;
    name: string;
    type: 'MOMENTUM' | 'MEAN_REVERSION' | 'ARBITRAGE' | 'MARKET_MAKING' | 'FUNDAMENTAL';
    currentWeight: number;
    targetWeight: number;
    performance: StrategyPerformance;
    positions: Position[];
    constraints: WeightConstraints;
}
interface StrategyPerformance {
    sharpeRatio: number;
    sortinoRatio: number;
    maxDrawdown: number;
    returns: number[];
    volatility: number;
    downwardDeviation: number;
    winRate: number;
    profitFactor: number;
    lastUpdated: Date;
}
interface Position {
    symbol: string;
    size: number;
    value: number;
    sector?: string;
    beta?: number;
}
interface WeightConstraints {
    minWeight: number;
    maxWeight: number;
    maxDrawdown: number;
    minSharpe: number;
    maxCorrelation: number;
}
interface MarketRegime {
    type: 'BULL' | 'BEAR' | 'SIDEWAYS' | 'HIGH_VOL' | 'LOW_VOL';
    confidence: number;
    characteristics: {
        volatility: number;
        trend: number;
        momentum: number;
        correlation: number;
    };
    detectedAt: Date;
}
interface AllocationResult {
    id: string;
    timestamp: Date;
    strategies: Map<string, number>;
    regime: MarketRegime;
    metrics: {
        expectedSharpe: number;
        expectedVolatility: number;
        diversificationRatio: number;
        maxPositionOverlap: number;
    };
    rebalanceRequired: boolean;
}
interface OptimizationConstraints {
    targetVolatility: number;
    maxLeverage: number;
    minDiversification: number;
    maxSectorConcentration: number;
    rebalanceThreshold: number;
    transactionCostBudget: number;
}
export declare class DynamicWeightAllocator extends EventEmitter {
    private logger;
    private strategies;
    private currentAllocation;
    private marketRegime;
    private optimizationConstraints;
    private correlationMatrix;
    private rebalanceInterval;
    private performanceWindow;
    constructor();
    private initialize;
    registerStrategy(strategy: Omit<Strategy, 'currentWeight' | 'targetWeight'>): Promise<void>;
    updatePerformance(strategyId: string, performance: Partial<StrategyPerformance>): Promise<void>;
    updateMarketRegime(regime: MarketRegime): Promise<void>;
    private optimizeAllocation;
    private updateCorrelationMatrix;
    private calculateCorrelation;
    private getRegimeAdjustedWeights;
    private meanVarianceOptimization;
    private minimizePositionOverlap;
    private calculatePositionOverlap;
    private applyConstraints;
    private calculateAllocationMetrics;
    private shouldTriggerRebalance;
    private isRebalanceRequired;
    private evaluateRebalance;
    getCurrentAllocation(): AllocationResult | null;
    getStrategyWeight(strategyId: string): number;
    executeRebalance(allocation: AllocationResult): Promise<void>;
    updateConstraints(constraints: Partial<OptimizationConstraints>): void;
    destroy(): void;
}
export {};
//# sourceMappingURL=DynamicWeightAllocator.d.ts.map