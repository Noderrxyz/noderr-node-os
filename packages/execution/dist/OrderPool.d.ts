import * as winston from 'winston';
import { Order } from '@noderr/types';
export interface OrderPoolConfig {
    poolSize: number;
    maxPoolSize: number;
    preAllocate: boolean;
    gcWarningThreshold: number;
}
export interface PoolMetrics {
    created: number;
    acquired: number;
    released: number;
    inUse: number;
    available: number;
    gcPressureWarnings: number;
}
/**
 * High-performance object pool for Order instances
 * Prevents GC pressure by reusing objects
 * Target: -2ms P99 latency improvement
 */
export declare class OrderPool {
    private static readonly DEFAULT_POOL_SIZE;
    private static readonly DEFAULT_MAX_POOL_SIZE;
    private pool;
    private config;
    private logger;
    private metrics;
    private orderTemplate;
    constructor(logger: winston.Logger, config?: Partial<OrderPoolConfig>);
    /**
     * Acquire an order from the pool
     * O(1) operation
     */
    acquire(): Order;
    /**
     * Release an order back to the pool
     * O(1) operation
     */
    release(order: Order): void;
    /**
     * Pre-allocate orders to avoid allocation during hot path
     */
    private preAllocatePool;
    /**
     * Create a new order instance
     * Uses template for faster initialization
     */
    private createOrder;
    /**
     * Reset order to initial state for reuse
     * Critical for preventing data leaks between uses
     */
    private resetOrder;
    /**
     * Create order template for fast cloning
     */
    private createOrderTemplate;
    /**
     * Monitor pool health and log metrics
     */
    private startHealthMonitoring;
    /**
     * Get pool metrics
     */
    getMetrics(): PoolMetrics;
    /**
     * Drain the pool (for shutdown)
     */
    drain(): void;
}
export declare function getGlobalOrderPool(logger: winston.Logger): OrderPool;
/**
 * Benchmark utility for order pool performance
 */
export declare class OrderPoolBenchmark {
    static runBenchmark(logger: winston.Logger, iterations?: number): Promise<void>;
}
//# sourceMappingURL=OrderPool.d.ts.map