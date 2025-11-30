/**
 * @noderr/execution - Unified Execution Engine
 *
 * Consolidates all execution functionality from:
 * - execution-engine
 * - execution-enhanced
 * - execution-optimizer
 */
import { Order, ExecutionResult, MEVConfig } from '@noderr/types';
export declare class SmartExecutionEngine {
    private logger;
    constructor(config: {
        venues: string[];
        mevProtection?: boolean;
        smartRouting?: boolean;
    });
    execute(order: Order): Promise<ExecutionResult>;
}
export declare class OrderLifecycleManager {
    private logger;
    private listeners;
    constructor();
    on(event: string, callback: Function): void;
    emit(event: string, data: any): void;
}
export declare class TWAPExecutor {
    private engine;
    private logger;
    constructor(engine: SmartExecutionEngine);
    execute(config: {
        symbol: string;
        side: 'buy' | 'sell';
        amount: number;
        duration: number;
        slices: number;
    }): Promise<ExecutionResult>;
}
export declare class MEVProtection {
    private logger;
    constructor(config: MEVConfig);
    protectTransaction(tx: any): Promise<any>;
}
export type { Order, OrderStatus, ExecutionResult, ExecutionStrategy, VenueConfig, AlgorithmConfig, MEVConfig, SafetyConfig } from '@noderr/types';
export declare const VERSION = "1.0.0";
//# sourceMappingURL=index.d.ts.map