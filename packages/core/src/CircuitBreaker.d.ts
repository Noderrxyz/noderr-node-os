import { EventEmitter } from 'events';
import * as winston from 'winston';
export declare enum CircuitState {
    CLOSED = "CLOSED",
    OPEN = "OPEN",
    HALF_OPEN = "HALF_OPEN"
}
export interface CircuitBreakerConfig {
    name: string;
    timeout: number;
    errorThresholdPercentage: number;
    errorThresholdCount: number;
    successThresholdCount: number;
    resetTimeout: number;
    volumeThreshold: number;
    rollingWindowSize: number;
    fallbackFunction?: () => Promise<any>;
}
export interface CircuitBreakerMetrics {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    timeouts: number;
    shortCircuited: number;
    fallbackSuccess: number;
    fallbackFailure: number;
    latencyPercentiles: {
        p50: number;
        p75: number;
        p90: number;
        p95: number;
        p99: number;
    };
    errorRate: number;
    state: CircuitState;
    lastStateChange: Date;
}
export declare class CircuitBreaker extends EventEmitter {
    private config;
    private state;
    private logger;
    private metrics;
    private requestWindow;
    private halfOpenSuccesses;
    private lastStateChange;
    private nextAttempt;
    private stateChangeTimer?;
    constructor(config: CircuitBreakerConfig, logger: winston.Logger);
    execute<T>(fn: () => Promise<T>): Promise<T>;
    private executeFallback;
    private recordSuccess;
    private recordFailure;
    private shouldOpen;
    private transitionTo;
    private getRecentRequests;
    private cleanupWindow;
    private updateMetrics;
    private percentile;
    private initializeMetrics;
    getState(): CircuitState;
    getMetrics(): CircuitBreakerMetrics;
    reset(): void;
    forceOpen(): void;
    forceClosed(): void;
    isOpen(): boolean;
    isClosed(): boolean;
    isHalfOpen(): boolean;
    destroy(): void;
}
export declare class CircuitBreakerFactory {
    private breakers;
    private logger;
    private defaultConfig;
    constructor(logger: winston.Logger, defaultConfig?: Partial<CircuitBreakerConfig>);
    create(config: Partial<CircuitBreakerConfig> & {
        name: string;
    }): CircuitBreaker;
    get(name: string): CircuitBreaker | undefined;
    getAll(): Map<string, CircuitBreaker>;
    getMetrics(): Map<string, CircuitBreakerMetrics>;
    resetAll(): void;
    destroy(): void;
}
//# sourceMappingURL=CircuitBreaker.d.ts.map