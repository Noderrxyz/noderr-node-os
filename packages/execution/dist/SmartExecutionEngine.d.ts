import { EventEmitter } from 'events';
import * as winston from 'winston';
/**
 * Execution configuration
 */
export interface ExecutionConfig {
    maxOrderSize: number;
    minOrderSize: number;
    maxSlippageBps: number;
    orderTimeout: number;
    enableSmartRouting: boolean;
    enableOrderSlicing: boolean;
    venuePriorities: Record<string, number>;
}
/**
 * Order request
 */
export interface OrderRequest {
    id: string;
    symbol: string;
    side: 'buy' | 'sell';
    quantity: number;
    orderType: 'market' | 'limit' | 'iceberg';
    limitPrice?: number;
    timeInForce: 'IOC' | 'FOK' | 'GTC';
    urgency: number;
    metadata?: Record<string, any>;
}
/**
 * Execution plan
 */
export interface ExecutionPlan {
    orderId: string;
    slices: OrderSlice[];
    estimatedCost: number;
    estimatedSlippage: number;
    estimatedDuration: number;
    routingStrategy: string;
}
/**
 * Order slice
 */
export interface OrderSlice {
    id: string;
    parentOrderId: string;
    venue: string;
    quantity: number;
    orderType: string;
    scheduledTime: number;
    priority: number;
}
/**
 * Execution result
 */
export interface ExecutionResult {
    orderId: string;
    status: 'completed' | 'partial' | 'failed' | 'cancelled';
    executedQuantity: number;
    remainingQuantity: number;
    avgExecutionPrice: number;
    totalCost: number;
    slippageBps: number;
    executionTimeMs: number;
    sliceResults: SliceResult[];
    errors: string[];
}
/**
 * Slice execution result
 */
export interface SliceResult {
    sliceId: string;
    venue: string;
    status: 'success' | 'failed' | 'timeout';
    executedQuantity: number;
    executionPrice: number;
    fees: number;
    latencyMs: number;
    error?: string;
}
/**
 * Smart execution engine
 */
export declare class SmartExecutionEngine extends EventEmitter {
    private config;
    private logger;
    private rlRouter;
    private activeOrders;
    private executionPlans;
    private venueConnections;
    constructor(config: ExecutionConfig, logger: winston.Logger);
    /**
     * Initialize the execution engine
     */
    initialize(rlRouter?: any): Promise<void>;
    /**
     * Execute an order
     */
    executeOrder(order: OrderRequest): Promise<ExecutionResult>;
    /**
     * Create execution plan
     */
    private createExecutionPlan;
    /**
     * Select venue for a slice
     */
    private selectVenue;
    /**
     * Execute the plan
     */
    private executePlan;
    /**
     * Execute a single slice
     */
    private executeSlice;
    /**
     * Get market state for RL
     */
    private getMarketState;
    /**
     * Estimate execution costs
     */
    private estimateExecutionCosts;
    /**
     * Get current market price
     */
    private getMarketPrice;
    /**
     * Initialize venue connections
     */
    private initializeVenueConnections;
    /**
     * Wait for specified milliseconds
     */
    private wait;
    /**
     * Cancel an active order
     */
    cancelOrder(orderId: string): Promise<boolean>;
    /**
     * Get active orders
     */
    getActiveOrders(): OrderRequest[];
}
//# sourceMappingURL=SmartExecutionEngine.d.ts.map