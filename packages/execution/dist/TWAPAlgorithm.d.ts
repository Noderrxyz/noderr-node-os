import { Order, AlgorithmConfig, ExecutionStatus, Fill } from '@noderr/types';
import { Logger } from 'winston';
import EventEmitter from 'events';
interface TWAPState {
    orderId: string;
    totalQuantity: number;
    executedQuantity: number;
    remainingQuantity: number;
    slices: TWAPSlice[];
    currentSlice: number;
    startTime: number;
    endTime: number;
    fills: Fill[];
    status: ExecutionStatus;
    paused: boolean;
}
interface TWAPSlice {
    index: number;
    quantity: number;
    targetTime: number;
    executedQuantity: number;
    status: 'pending' | 'executing' | 'completed' | 'failed';
    attempts: number;
    fills: Fill[];
}
interface TWAPMetrics {
    actualVWAP: number;
    targetVWAP: number;
    slippage: number;
    executionRate: number;
    deviation: number;
    completionPercentage: number;
}
export declare class TWAPAlgorithm extends EventEmitter {
    private logger;
    private activeOrders;
    private executionTimer?;
    private metricsInterval?;
    constructor(logger: Logger);
    /**
     * Execute order using TWAP algorithm
     */
    execute(order: Order, config: AlgorithmConfig, router: any): Promise<void>;
    /**
     * Get current execution status
     */
    getExecutionStatus(orderId: string): TWAPState | null;
    /**
     * Get execution metrics
     */
    getMetrics(orderId: string): TWAPMetrics | null;
    /**
     * Pause execution
     */
    pauseExecution(orderId: string): boolean;
    /**
     * Resume execution
     */
    resumeExecution(orderId: string): boolean;
    /**
     * Cancel execution
     */
    cancelExecution(orderId: string): boolean;
    private validateParameters;
    private initializeTWAPState;
    private startExecutionLoop;
    private startMetricsCollection;
    private processActiveOrders;
    private executeSlice;
    private calculateSlicePrice;
    private executeChildOrder;
    private executeNextSlice;
    private completeExecution;
    private handleTimeout;
    private createExecutionResult;
    private calculateMetrics;
    private aggregateRoutes;
    private collectAndEmitMetrics;
    /**
     * Get all active TWAP executions
     */
    getActiveExecutions(): Map<string, TWAPState>;
    /**
     * Clean up resources
     */
    destroy(): void;
}
export {};
//# sourceMappingURL=TWAPAlgorithm.d.ts.map