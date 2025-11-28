import { EventEmitter } from 'events';
import { Logger } from 'winston';
export interface StateManagerConfig {
    redis: {
        host: string;
        port: number;
        password?: string;
        db?: number;
        keyPrefix?: string;
        cluster?: boolean;
        sentinels?: Array<{
            host: string;
            port: number;
        }>;
    };
    circuitBreaker: {
        timeout: number;
        errorThresholdPercentage: number;
        resetTimeout: number;
    };
    encryption?: {
        enabled: boolean;
        algorithm: string;
        key: string;
    };
}
export interface StateOptions {
    ttl?: number;
    namespace?: string;
    encrypted?: boolean;
    compressed?: boolean;
}
export declare class DistributedStateManager extends EventEmitter {
    private redis;
    private breaker;
    private logger;
    private config;
    private localCache;
    private compressionThreshold;
    constructor(logger: Logger, config: StateManagerConfig);
    getState<T>(key: string, options?: StateOptions): Promise<T | null>;
    setState<T>(key: string, value: T, options?: StateOptions): Promise<boolean>;
    deleteState(key: string, namespace?: string): Promise<boolean>;
    exists(key: string, namespace?: string): Promise<boolean>;
    increment(key: string, amount?: number, options?: StateOptions): Promise<number>;
    getMultiple<T>(keys: string[], namespace?: string): Promise<Map<string, T>>;
    setMultiple(entries: Map<string, any>, options?: StateOptions): Promise<boolean>;
    lock(key: string, ttl?: number): Promise<string | null>;
    unlock(key: string, lockValue: string): Promise<boolean>;
    withLock<T>(key: string, fn: () => Promise<T>, ttl?: number): Promise<T>;
    private executeRedisCommand;
    private buildKey;
    private encrypt;
    private decrypt;
    private compress;
    private decompress;
    private isCompressed;
    private cleanupLocalCache;
    healthCheck(): Promise<boolean>;
    close(): Promise<void>;
}
//# sourceMappingURL=DistributedStateManager.d.ts.map