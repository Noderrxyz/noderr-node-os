import Redis from 'ioredis';
import * as winston from 'winston';
export interface VolumeTrackerConfig {
    redis: Redis;
    ttl: number;
    namespace: string;
}
export declare class VolumeTracker {
    private redis;
    private logger;
    private ttl;
    private namespace;
    private metrics;
    constructor(logger: winston.Logger, config: VolumeTrackerConfig);
    /**
     * Atomically increment user's daily volume and return new total
     * P99 latency target: <1ms
     */
    incrementDailyVolume(userId: string, amount: number): Promise<number>;
    /**
     * Get current daily volume for user
     * Uses Redis GET - O(1) operation
     */
    getDailyVolume(userId: string): Promise<number>;
    /**
     * Atomically increment and check against limit
     * Returns true if trade is allowed, false if limit exceeded
     */
    checkAndIncrementVolume(userId: string, amount: number, dailyLimit: number): Promise<{
        allowed: boolean;
        currentVolume: number;
    }>;
    /**
     * Reset daily volume for user (admin operation)
     */
    resetDailyVolume(userId: string): Promise<void>;
    /**
     * Get volume metrics
     */
    getMetrics(): typeof this.metrics;
    /**
     * Generate daily volume key with date
     */
    private getDailyVolumeKey;
    /**
     * Bulk get volumes for multiple users (for reporting)
     */
    getBulkDailyVolumes(userIds: string[]): Promise<Map<string, number>>;
}
export declare class VolumeTrackerBenchmark {
    static runBenchmark(tracker: VolumeTracker, iterations?: number): Promise<void>;
}
//# sourceMappingURL=VolumeTracker.d.ts.map