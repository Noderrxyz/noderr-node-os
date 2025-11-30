import { ExecutionRoute, TradingFees, Order, ExecutionConstraints, ExecutionObjectives, CostAnalysis } from '@noderr/types';
import { Logger } from 'winston';
interface CostModel {
    fees: number;
    slippage: number;
    marketImpact: number;
    opportunityCost: number;
    totalCost: number;
}
interface OptimizationResult {
    routes: ExecutionRoute[];
    costModel: CostModel;
    savings: number;
    confidence: number;
}
export declare class CostOptimizer {
    private logger;
    private feeCache;
    private impactModels;
    constructor(logger: Logger);
    /**
     * Optimize execution routes for minimum cost
     */
    optimizeForCost(routes: ExecutionRoute[], order: Order, constraints: ExecutionConstraints, objectives: ExecutionObjectives): Promise<OptimizationResult>;
    /**
     * Calculate total execution cost for routes
     */
    calculateTotalCost(routes: ExecutionRoute[], order: Order): CostModel;
    /**
     * Analyze cost breakdown and provide insights
     */
    analyzeCostBreakdown(routes: ExecutionRoute[], order: Order): CostAnalysis;
    private optimizeFees;
    private minimizeSlippage;
    private reduceMarketImpact;
    private optimizeTiming;
    private initializeImpactModels;
    private calculateMarketImpact;
    private calculateWeightedAveragePrice;
    private getOptimalFees;
    private calculateMaxSizeForSlippage;
    private calculateOptimalExecutionStrategy;
    private calculateOptimalTiming;
    private estimatePriceDrift;
    private calculateOptimizationConfidence;
    /**
     * Get real-time cost estimates
     */
    estimateCosts(routes: ExecutionRoute[], order: Order): Promise<CostModel>;
    /**
     * Update fee cache with latest data
     */
    updateFeeCache(exchange: string, fees: TradingFees): void;
    /**
     * Update market impact model
     */
    updateImpactModel(exchange: string, model: MarketImpactModel): void;
}
interface MarketImpactModel {
    linear: number;
    sqrt: number;
    exponent: number;
    temporary: number;
    decayRate: number;
}
export {};
//# sourceMappingURL=CostOptimizer.d.ts.map