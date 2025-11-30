/**
 * @noderr/utils - Shared utilities for Noderr Protocol
 */
import winston from 'winston';
export declare class Logger {
    private logger;
    constructor(name: string, options?: winston.LoggerOptions);
    debug(message: string, meta?: any): void;
    info(message: string, meta?: any): void;
    warn(message: string, meta?: any): void;
    error(message: string, error?: Error | any, meta?: any): void;
    child(name: string): Logger;
}
export interface RetryOptions {
    maxAttempts: number;
    backoff: 'linear' | 'exponential';
    initialDelay: number;
    maxDelay?: number;
    factor?: number;
    jitter?: boolean;
}
export declare class RetryManager {
    private options;
    constructor(options: RetryOptions);
    execute<T>(operation: () => Promise<T>, shouldRetry?: (error: Error) => boolean): Promise<T>;
    private calculateDelay;
    private sleep;
}
export declare class CircularBuffer<T> {
    private capacity;
    private buffer;
    private head;
    private tail;
    private count;
    constructor(capacity: number);
    push(item: T): void;
    pop(): T | undefined;
    peek(): T | undefined;
    toArray(): T[];
    clear(): void;
    get size(): number;
    get isFull(): boolean;
    get isEmpty(): boolean;
}
export declare function generateId(prefix?: string): string;
export declare function sleep(ms: number): Promise<void>;
export declare function deepClone<T>(obj: T): T;
export declare const logger: Logger;
//# sourceMappingURL=index.d.ts.map