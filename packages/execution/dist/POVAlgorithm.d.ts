import { Order, AlgorithmConfig, ExecutionStatus, Fill } from '@noderr/types';
import { Logger } from 'winston';
import EventEmitter from 'events';
interface POVState {
    orderId: string;
    totalQuantity: number;
    executedQuantity: number;
    remainingQuantity: number;
    targetPercentage: number;
    maxPercentage: number;
    adaptiveMode: boolean;
    volumeTracking: VolumeTracking;
    fills: Fill[];
    status: ExecutionStatus;
    startTime: number;
    endTime?: number;
    currentParticipation: number;
    executionHistory: ExecutionSnapshot[];
}
interface VolumeTracking {
    marketVolume: number;
    ourVolume: number;
    participationRate: number;
    volumeHistory: VolumePoint[];
    movingAverage: number;
    volatility: number;
}
interface VolumePoint {
    timestamp: number;
    marketVolume: number;
    ourVolume: number;
    price: number;
}
interface ExecutionSnapshot {
    timestamp: number;
    quantity: number;
    participationRate: number;
    marketVolume: number;
    price: number;
    impact: number;
}
interface POVMetrics {
    targetParticipation: number;
    actualParticipation: number;
    volumeExecuted: number;
    marketVolumeTracked: number;
    completionPercentage: number;
    averageParticipation: number;
    maxParticipation: number;
    minParticipation: number;
    impactCost: number;
}
export declare class POVAlgorithm extends EventEmitter {
    private logger;
    private activeOrders;
    private volumeMonitor?;
    private executionLoop?;
    private adaptiveAdjuster?;
    private volumeBuffer;
    constructor(logger: Logger);
    /**
     * Execute order using POV algorithm
     */
    execute(order: Order, config: AlgorithmConfig, router: any): Promise<void>;
    /**
     * Get current execution status
     */
    getExecutionStatus(orderId: string): POVState | null;
    /**
     * Get execution metrics
     */
    getMetrics(orderId: string): POVMetrics | null;
    /**
     * Update market volume data
     */
    updateMarketVolume(symbol: string, volume: number, price: number): void;
    private validateParameters;
    private initializePOVState;
    private startVolumeMonitoring;
    private startExecutionLoop;
    private startAdaptiveAdjustment;
    private updateVolumeTracking;
    private calculateRecentVolume;
    private updateActiveOrdersVolume;
    private updateVolumeStatistics;
    private processActiveOrders;
    private shouldExecute;
    private getRecentMarketVolume;
    private getOurRecentVolume;
    private executeSlice;
    private calculateExecutionSize;
    private applyAdaptiveAdjustments;
    private getRecentMarketImpact;
    private estimateMarketImpact;
    private calculateCurrentParticipation;
    private createChildOrder;
    private executeChildOrder;
    private performAdaptiveAdjustments;
    private estimateTimeRemaining;
    private calculateMetrics;
    private completeExecution;
    private createExecutionResult;
    private aggregateRoutes;
    /**
     * Cancel POV execution
     */
    cancelExecution(orderId: string): boolean;
    /**
     * Get all active POV executions
     */
    getActiveExecutions(): Map<string, POVState>;
    /**
     * Clean up resources
     */
    destroy(): void;
}
export {};
//# sourceMappingURL=POVAlgorithm.d.ts.map