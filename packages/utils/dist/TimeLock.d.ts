import { EventEmitter } from 'events';
export interface TimeLockOperation {
    id: string;
    type: string;
    payload: any;
    description: string;
    initiatedBy: string;
    initiatedAt: Date;
    executeAt: Date;
    status: 'PENDING' | 'CANCELLED' | 'EXECUTED' | 'FAILED';
    delayMs: number;
    cancellable: boolean;
    executionResult?: any;
    error?: string;
}
export interface TimeLockConfig {
    defaultDelayMs: number;
    minDelayMs: number;
    maxDelayMs: number;
    allowCancellation: boolean;
}
export declare class TimeLock extends EventEmitter {
    private logger;
    private config;
    private operations;
    private timers;
    private executors;
    constructor(config: TimeLockConfig);
    /**
     * Schedule an operation with a time delay
     */
    scheduleOperation(type: string, payload: any, description: string, initiatedBy: string, delayMs?: number, executor?: (operation: TimeLockOperation) => Promise<any>): TimeLockOperation;
    /**
     * Cancel a pending operation
     */
    cancelOperation(operationId: string, reason: string): void;
    /**
     * Get all operations
     */
    getOperations(filter?: {
        status?: string;
        type?: string;
    }): TimeLockOperation[];
    /**
     * Get operation by ID
     */
    getOperation(operationId: string): TimeLockOperation | undefined;
    /**
     * Get time remaining for an operation
     */
    getTimeRemaining(operationId: string): number;
    /**
     * Register a default executor for a type
     */
    registerExecutor(type: string, executor: (operation: TimeLockOperation) => Promise<any>): void;
    /**
     * Update configuration
     */
    updateConfig(updates: Partial<TimeLockConfig>): void;
    private generateOperationId;
    private validateDelay;
    private executeOperation;
    /**
     * Get statistics
     */
    getStatistics(): {
        total: number;
        pending: number;
        executed: number;
        cancelled: number;
        failed: number;
        averageDelayMs: number;
    };
    /**
     * Clean up old operations
     */
    cleanup(olderThanMs?: number): number;
    /**
     * Destroy and clean up
     */
    destroy(): void;
}
//# sourceMappingURL=TimeLock.d.ts.map