import { Order, AlgorithmConfig, ExecutionStatus, Fill } from '@noderr/types';
import { Logger } from 'winston';
import EventEmitter from 'events';
interface VWAPState {
    orderId: string;
    totalQuantity: number;
    executedQuantity: number;
    remainingQuantity: number;
    slices: VWAPSlice[];
    volumeProfile: VolumeProfile;
    targetVWAP: number;
    actualVWAP: number;
    startTime: number;
    endTime: number;
    fills: Fill[];
    status: ExecutionStatus;
    adaptiveMode: boolean;
    participationRate: number;
}
interface VWAPSlice {
    index: number;
    startTime: number;
    endTime: number;
    targetVolume: number;
    targetQuantity: number;
    executedQuantity: number;
    expectedPrice: number;
    status: 'pending' | 'executing' | 'completed' | 'failed';
    fills: Fill[];
    volumeDeviation: number;
}
interface VolumeProfile {
    historicalPattern: HourlyVolume[];
    intraday: IntradayVolume[];
    currentVolume: number;
    projectedVolume: number;
    confidence: number;
}
interface HourlyVolume {
    hour: number;
    averageVolume: number;
    volumePercentage: number;
    volatility: number;
    spread: number;
}
interface IntradayVolume {
    timestamp: number;
    volume: number;
    vwap: number;
    trades: number;
}
interface VWAPMetrics {
    targetVWAP: number;
    actualVWAP: number;
    trackingError: number;
    participationRate: number;
    volumeParticipation: number;
    completionPercentage: number;
    slippageBps: number;
    marketImpact: number;
}
export declare class VWAPAlgorithm extends EventEmitter {
    private logger;
    private activeOrders;
    private volumeProfiles;
    private executionTimer?;
    private volumeUpdateTimer?;
    private adaptiveAdjustmentTimer?;
    constructor(logger: Logger);
    /**
     * Execute order using VWAP algorithm
     */
    execute(order: Order, config: AlgorithmConfig, router: any): Promise<void>;
    /**
     * Get current execution status
     */
    getExecutionStatus(orderId: string): VWAPState | null;
    /**
     * Get execution metrics
     */
    getMetrics(orderId: string): VWAPMetrics | null;
    /**
     * Update volume profile in real-time
     */
    updateVolumeProfile(symbol: string, volumeData: any): void;
    private validateParameters;
    private analyzeVolumeProfile;
    private generateHistoricalPattern;
    private calculateVolumeConfidence;
    private projectDailyVolume;
    private initializeVWAPState;
    private calculateTargetVWAP;
    private createVolumeWeightedSlices;
    private startExecutionLoop;
    private startVolumeUpdateLoop;
    private startAdaptiveAdjustmentLoop;
    private processActiveOrders;
    private executeSlice;
    private calculateAdjustedQuantity;
    private getRecentVolume;
    private createChildOrder;
    private executeChildOrder;
    private calculateActualVWAP;
    private updateVolumeTracking;
    private performAdaptiveAdjustments;
    private adjustFutureSlices;
    private recalculateProjections;
    private calculateMetrics;
    private executeNextSlice;
    private completeExecution;
    private handleTimeout;
    private createExecutionResult;
    private aggregateRoutes;
    /**
     * Cancel VWAP execution
     */
    cancelExecution(orderId: string): boolean;
    /**
     * Get all active VWAP executions
     */
    getActiveExecutions(): Map<string, VWAPState>;
    /**
     * Clean up resources
     */
    destroy(): void;
}
export {};
//# sourceMappingURL=VWAPAlgorithm.d.ts.map