import { EventEmitter } from 'events';
interface FlowRequest {
    id: string;
    type: 'REBALANCE' | 'ENTRY' | 'EXIT' | 'HEDGE';
    fromStrategy: string;
    toStrategy?: string;
    symbol: string;
    targetAmount: number;
    urgency: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    constraints: FlowConstraints;
}
interface FlowConstraints {
    maxSlippage: number;
    maxFees: number;
    timeLimit: number;
    minLiquidity: number;
    avoidMEV: boolean;
    preferredVenues?: string[];
}
interface FlowRoute {
    id: string;
    request: FlowRequest;
    segments: RouteSegment[];
    totalCost: number;
    estimatedSlippage: number;
    estimatedTime: number;
    mevProtection: MEVProtection;
    status: 'PLANNED' | 'EXECUTING' | 'COMPLETED' | 'FAILED';
}
interface RouteSegment {
    venue: string;
    symbol: string;
    size: number;
    estimatedPrice: number;
    maxPrice: number;
    minPrice: number;
    executionTime: number;
    fees: number;
}
interface MEVProtection {
    enabled: boolean;
    strategy: 'TIME_WEIGHTED' | 'RANDOMIZED' | 'PRIVATE_POOL' | 'FLASHBOT';
    parameters: {
        minDelay?: number;
        maxDelay?: number;
        randomizationFactor?: number;
        privatePoolId?: string;
    };
}
interface FlowMetrics {
    totalVolume24h: number;
    avgSlippage: number;
    avgFees: number;
    mevLosses: number;
    successRate: number;
    venueDistribution: Map<string, number>;
}
export declare class CapitalFlowOptimizer extends EventEmitter {
    private logger;
    private venues;
    private activeFlows;
    private flowHistory;
    private flowMetrics;
    private liquidityUpdateInterval;
    private mevDetector;
    constructor();
    private initialize;
    private initializeVenues;
    private registerVenue;
    private startLiquidityMonitoring;
    private updateLiquidityProfiles;
    private generateMockOrderBook;
    optimizeFlow(request: FlowRequest): Promise<FlowRoute>;
    private analyzeLiquidity;
    private calculateAvailableLiquidity;
    private calculatePriceImpact;
    private planOptimalRoute;
    private estimateExecutionTime;
    private planMEVProtection;
    executeFlow(routeId: string): Promise<void>;
    private applyMEVProtection;
    private executeSegments;
    private simulateExecution;
    private updateFlowMetrics;
    getFlowMetrics(): FlowMetrics;
    getActiveFlows(): FlowRoute[];
    getFlowHistory(limit?: number): FlowRoute[];
    cancelFlow(routeId: string): Promise<void>;
    destroy(): void;
}
export {};
//# sourceMappingURL=CapitalFlowOptimizer.d.ts.map