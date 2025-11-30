import { Order, AlgorithmConfig, ExecutionStatus, Fill, OrderSide } from '@noderr/types';
import { Logger } from 'winston';
import EventEmitter from 'events';
interface IcebergState {
    orderId: string;
    symbol: string;
    totalQuantity: number;
    executedQuantity: number;
    remainingQuantity: number;
    visibleQuantity: number;
    variance: number;
    currentClip: IcebergClip | null;
    clipHistory: IcebergClip[];
    fills: Fill[];
    status: ExecutionStatus;
    startTime: number;
    endTime?: number;
    priceLevel: number;
    side: OrderSide;
    marketMicrostructure: MarketMicrostructure;
    detectionRisk: number;
}
interface IcebergClip {
    id: string;
    quantity: number;
    visibleQuantity: number;
    executedQuantity: number;
    price: number;
    status: 'pending' | 'active' | 'filled' | 'cancelled';
    orderId?: string;
    placedAt: number;
    filledAt?: number;
    fills: Fill[];
    detectionScore: number;
}
interface MarketMicrostructure {
    avgOrderSize: number;
    orderSizeDistribution: SizeDistribution;
    participantProfile: ParticipantProfile;
    liquidityDepth: number;
    tickSize: number;
    lastUpdate: number;
}
interface SizeDistribution {
    p25: number;
    p50: number;
    p75: number;
    p90: number;
    p95: number;
    max: number;
}
interface ParticipantProfile {
    retailPercentage: number;
    institutionalPercentage: number;
    algoPercentage: number;
    avgClipSize: number;
}
interface IcebergMetrics {
    totalClips: number;
    activeClips: number;
    averageClipSize: number;
    fillRate: number;
    detectionRisk: number;
    hiddenRatio: number;
    completionPercentage: number;
    effectiveSpread: number;
    priceImprovement: number;
}
export declare class IcebergAlgorithm extends EventEmitter {
    private logger;
    private activeOrders;
    private executionLoop?;
    private microstructureAnalyzer?;
    private detectionMonitor?;
    private marketMicrostructure;
    constructor(logger: Logger);
    /**
     * Execute order using Iceberg algorithm
     */
    execute(order: Order, config: AlgorithmConfig, router: any): Promise<void>;
    /**
     * Get current execution status
     */
    getExecutionStatus(orderId: string): IcebergState | null;
    /**
     * Get execution metrics
     */
    getMetrics(orderId: string): IcebergMetrics | null;
    /**
     * Update price level for limit orders
     */
    updatePriceLevel(orderId: string, newPrice: number): boolean;
    private validateParameters;
    private analyzeMarketMicrostructure;
    private initializeIcebergState;
    private startExecutionLoop;
    private startMicrostructureAnalysis;
    private startDetectionMonitoring;
    private processActiveOrders;
    private placeNextClip;
    private calculateClipSize;
    private placeFinalClip;
    private placeClipOrder;
    private simulateClipExecution;
    private handleClipFilled;
    private cancelClip;
    private calculateDetectionScore;
    private analyzeTimingPattern;
    private getOrderSizePercentile;
    private updateDetectionRisk;
    private adjustStrategyForDetection;
    private updateMicrostructure;
    private monitorDetectionRisk;
    private calculateMetrics;
    private completeExecution;
    private createExecutionResult;
    private aggregateRoutes;
    /**
     * Cancel Iceberg execution
     */
    cancelExecution(orderId: string): boolean;
    /**
     * Get all active Iceberg executions
     */
    getActiveExecutions(): Map<string, IcebergState>;
    /**
     * Clean up resources
     */
    destroy(): void;
}
export {};
//# sourceMappingURL=IcebergAlgorithm.d.ts.map