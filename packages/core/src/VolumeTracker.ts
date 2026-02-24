import { Logger } from '@noderr/utils';
import Redis from 'ioredis';
import * as winston from 'winston';

const logger = new Logger('VolumeTracker');
export interface VolumeTrackerConfig {
  redis: Redis;
  ttl: number; // TTL for daily volume keys in seconds
  namespace: string;
}

export class VolumeTracker {
  private redis: Redis;
  private logger: winston.Logger;
  private ttl: number;
  private namespace: string;
  
  // Performance metrics
  private metrics = {
    hits: 0,
    misses: 0,
    updates: 0,
    errors: 0
  };
  
  constructor(logger: winston.Logger, config: VolumeTrackerConfig) {
    this.logger = logger;
    this.redis = config.redis;
    this.ttl = config.ttl || 86400; // 24 hours default
    this.namespace = config.namespace || 'volume';
  }
  
  /**
   * Atomically increment user's daily volume and return new total
   * P99 latency target: <1ms
   */
  async incrementDailyVolume(userId: string, amount: number): Promise<number> {
    const startTime = process.hrtime.bigint();
    const key = this.getDailyVolumeKey(userId);
    
    try {
      // Use Redis pipeline for atomic operation with TTL
      const pipeline = this.redis.pipeline();
      pipeline.incrbyfloat(key, amount);
      pipeline.expire(key, this.ttl);
      
      const results = await pipeline.exec();
      
      if (!results || results[0][0]) {
        throw new Error(`Redis pipeline error: ${results?.[0][0]}`);
      }
      
      const newVolume = parseFloat(results[0][1] as string);
      
      // Track metrics
      this.metrics.updates++;
      const latency = Number(process.hrtime.bigint() - startTime) / 1_000_000; // Convert to ms
      
      if (latency > 1) {
        this.logger.warn('Volume increment exceeded target latency', {
          userId,
          latency,
          key
        });
      }
      
      return newVolume;
      
    } catch (error) {
      this.metrics.errors++;
      this.logger.error('Failed to increment daily volume', {
        userId,
        amount,
        error
      });
      throw error;
    }
  }
  
  /**
   * Get current daily volume for user
   * Uses Redis GET - O(1) operation
   */
  async getDailyVolume(userId: string): Promise<number> {
    const key = this.getDailyVolumeKey(userId);
    
    try {
      const volume = await this.redis.get(key);
      
      if (volume === null) {
        this.metrics.misses++;
        return 0;
      }
      
      this.metrics.hits++;
      return parseFloat(volume);
      
    } catch (error) {
      this.metrics.errors++;
      this.logger.error('Failed to get daily volume', {
        userId,
        error
      });
      return 0; // Fail open for reads
    }
  }
  
  /**
   * Atomically increment and check against limit
   * Returns true if trade is allowed, false if limit exceeded
   */
  async checkAndIncrementVolume(
    userId: string, 
    amount: number, 
    dailyLimit: number
  ): Promise<{ allowed: boolean; currentVolume: number }> {
    const key = this.getDailyVolumeKey(userId);
    
    // Lua script for atomic check-and-increment
    const luaScript = `
      local key = KEYS[1]
      local increment = tonumber(ARGV[1])
      local limit = tonumber(ARGV[2])
      local ttl = tonumber(ARGV[3])
      
      local current = redis.call('get', key)
      if current == false then
        current = 0
      else
        current = tonumber(current)
      end
      
      local new_total = current + increment
      
      if new_total > limit then
        return {0, current}
      else
        redis.call('incrbyfloat', key, increment)
        redis.call('expire', key, ttl)
        return {1, new_total}
      end
    `;
    
    try {
      const result = await this.redis.eval(
        luaScript,
        1,
        key,
        amount.toString(),
        dailyLimit.toString(),
        this.ttl.toString()
      ) as [number, number];
      
      return {
        allowed: result[0] === 1,
        currentVolume: result[1]
      };
      
    } catch (error) {
      this.logger.error('Failed to check and increment volume', {
        userId,
        amount,
        error
      });
      throw error;
    }
  }
  
  /**
   * Reset daily volume for user (admin operation)
   */
  async resetDailyVolume(userId: string): Promise<void> {
    const key = this.getDailyVolumeKey(userId);
    await this.redis.del(key);
    
    this.logger.info('Reset daily volume', { userId });
  }
  
  /**
   * Get volume metrics
   */
  getMetrics(): typeof this.metrics {
    return { ...this.metrics };
  }
  
  /**
   * Generate daily volume key with date
   */
  private getDailyVolumeKey(userId: string): string {
    const date = new Date().toISOString().split('T')[0];
    return `${this.namespace}:daily:${userId}:${date}`;
  }
  
  /**
   * Bulk get volumes for multiple users (for reporting)
   */
  async getBulkDailyVolumes(userIds: string[]): Promise<Map<string, number>> {
    if (userIds.length === 0) return new Map();
    
    const pipeline = this.redis.pipeline();
    const keys = userIds.map(userId => this.getDailyVolumeKey(userId));
    
    keys.forEach(key => pipeline.get(key));
    
    const results = await pipeline.exec();
    const volumes = new Map<string, number>();
    
    userIds.forEach((userId, index) => {
      const result = results?.[index];
      if (result && !result[0] && result[1] !== null) {
        volumes.set(userId, parseFloat(result[1] as string));
      } else {
        volumes.set(userId, 0);
      }
    });
    
    return volumes;
  }
}

// Performance benchmark utility
export class VolumeTrackerBenchmark {
  static async runBenchmark(tracker: VolumeTracker, iterations: number = 10000): Promise<void> {
    logger.info(`Running VolumeTracker benchmark with ${iterations} iterations...`);
    
    const userIds = Array.from({ length: 100 }, (_, i) => `user-${i}`);
    const amounts = Array.from({ length: iterations }, () => Math.random() * 10000);
    
    // Benchmark increments
    const incrementStart = process.hrtime.bigint();
    const incrementPromises = [];
    
    for (let i = 0; i < iterations; i++) {
      const userId = userIds[i % userIds.length];
      incrementPromises.push(tracker.incrementDailyVolume(userId, amounts[i]));
    }
    
    await Promise.all(incrementPromises);
    const incrementTime = Number(process.hrtime.bigint() - incrementStart) / 1_000_000;
    
    // Benchmark reads
    const readStart = process.hrtime.bigint();
    const readPromises = [];
    
    for (let i = 0; i < iterations; i++) {
      const userId = userIds[i % userIds.length];
      readPromises.push(tracker.getDailyVolume(userId));
    }
    
    await Promise.all(readPromises);
    const readTime = Number(process.hrtime.bigint() - readStart) / 1_000_000;
    
    // Calculate metrics
    const incrementLatency = incrementTime / iterations;
    const readLatency = readTime / iterations;
    const incrementThroughput = iterations / (incrementTime / 1000);
    const readThroughput = iterations / (readTime / 1000);
    
    logger.info('Benchmark Results:');
    logger.info(`  Increment Latency: ${incrementLatency.toFixed(3)}ms (P99 target: <1ms)`);
    logger.info(`  Read Latency: ${readLatency.toFixed(3)}ms`);
    logger.info(`  Increment Throughput: ${incrementThroughput.toFixed(0)} ops/sec`);
    logger.info(`  Read Throughput: ${readThroughput.toFixed(0)} ops/sec`);
    logger.info(`  Metrics:`, tracker.getMetrics());
  }
} 