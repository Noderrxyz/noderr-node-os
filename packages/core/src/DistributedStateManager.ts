import { EventEmitter } from 'events';
import * as Redis from 'ioredis';
import CircuitBreaker from 'opossum';
import { Logger } from 'winston';
import { createHash } from 'crypto';

export interface StateManagerConfig {
  redis: {
    host: string;
    port: number;
    password?: string;
    db?: number;
    keyPrefix?: string;
    cluster?: boolean;
    sentinels?: Array<{ host: string; port: number }>;
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

export class DistributedStateManager extends EventEmitter {
  private redis: Redis.Redis | Redis.Cluster;
  private breaker: CircuitBreaker;
  private logger: Logger;
  private config: StateManagerConfig;
  private localCache: Map<string, { value: any; expiry: number }> = new Map();
  private compressionThreshold = 1024; // Compress values larger than 1KB

  constructor(logger: Logger, config: StateManagerConfig) {
    super();
    this.logger = logger;
    this.config = config;

    // Initialize Redis connection
    if (config.redis.cluster) {
      this.redis = new Redis.Cluster(
        config.redis.sentinels || [{ host: config.redis.host, port: config.redis.port }],
        {
          redisOptions: {
            password: config.redis.password,
            db: config.redis.db
          }
        }
      );
    } else {
      this.redis = new Redis({
        host: config.redis.host,
        port: config.redis.port,
        password: config.redis.password,
        db: config.redis.db,
        keyPrefix: config.redis.keyPrefix,
        retryStrategy: (times: number) => {
          const delay = Math.min(times * 50, 2000);
          return delay;
        }
      });
    }

    // Set up circuit breaker
    this.breaker = new CircuitBreaker(this.executeRedisCommand.bind(this), {
      timeout: config.circuitBreaker.timeout,
      errorThresholdPercentage: config.circuitBreaker.errorThresholdPercentage,
      resetTimeout: config.circuitBreaker.resetTimeout
    });

    this.breaker.on('open', () => {
      this.logger.error('State manager circuit breaker opened');
      this.emit('circuit-open');
    });

    this.breaker.on('halfOpen', () => {
      this.logger.warn('State manager circuit breaker half-open');
    });

    // Set up Redis event handlers
    this.redis.on('connect', () => {
      this.logger.info('Connected to Redis');
      this.emit('connected');
    });

    this.redis.on('error', (err: Error) => {
      this.logger.error('Redis error', err);
      this.emit('error', err);
    });

    // Start cache cleanup interval
    setInterval(() => this.cleanupLocalCache(), 60000); // Every minute
  }

  async getState<T>(key: string, options?: StateOptions): Promise<T | null> {
    const fullKey = this.buildKey(key, options?.namespace);

    // Check local cache first
    const cached = this.localCache.get(fullKey);
    if (cached && cached.expiry > Date.now()) {
      return cached.value as T;
    }

    try {
      const result = await this.breaker.fire('get', fullKey);
      
      if (!result) {
        return null;
      }

      let value = result;

      // Decompress if needed
      if (this.isCompressed(value)) {
        value = await this.decompress(value);
      }

      // Decrypt if needed
      if (options?.encrypted || this.config.encryption?.enabled) {
        value = this.decrypt(value);
      }

      const parsed = JSON.parse(value);

      // Update local cache
      this.localCache.set(fullKey, {
        value: parsed,
        expiry: Date.now() + (options?.ttl || 3600) * 1000
      });

      return parsed as T;
    } catch (error) {
      this.logger.error('Failed to get state', { key: fullKey, error });
      return null;
    }
  }

  async setState<T>(key: string, value: T, options?: StateOptions): Promise<boolean> {
    const fullKey = this.buildKey(key, options?.namespace);
    
    try {
      let serialized = JSON.stringify(value);

      // Encrypt if needed
      if (options?.encrypted || this.config.encryption?.enabled) {
        serialized = this.encrypt(serialized);
      }

      // Compress if needed
      if (options?.compressed || serialized.length > this.compressionThreshold) {
        serialized = await this.compress(serialized);
      }

      const ttl = options?.ttl || 3600; // Default 1 hour
      const result = await this.breaker.fire('setex', fullKey, ttl, serialized);

      // Update local cache
      this.localCache.set(fullKey, {
        value,
        expiry: Date.now() + ttl * 1000
      });

      this.emit('state-set', { key: fullKey, ttl });

      return result === 'OK';
    } catch (error) {
      this.logger.error('Failed to set state', { key: fullKey, error });
      return false;
    }
  }

  async deleteState(key: string, namespace?: string): Promise<boolean> {
    const fullKey = this.buildKey(key, namespace);

    try {
      const result = await this.breaker.fire('del', fullKey);
      this.localCache.delete(fullKey);
      return result === 1;
    } catch (error) {
      this.logger.error('Failed to delete state', { key: fullKey, error });
      return false;
    }
  }

  async exists(key: string, namespace?: string): Promise<boolean> {
    const fullKey = this.buildKey(key, namespace);

    try {
      const result = await this.breaker.fire('exists', fullKey);
      return result === 1;
    } catch (error) {
      this.logger.error('Failed to check existence', { key: fullKey, error });
      return false;
    }
  }

  async increment(key: string, amount: number = 1, options?: StateOptions): Promise<number> {
    const fullKey = this.buildKey(key, options?.namespace);

    try {
      const result = await this.breaker.fire('incrby', fullKey, amount);
      
      if (options?.ttl) {
        await this.breaker.fire('expire', fullKey, options.ttl);
      }

      return result;
    } catch (error) {
      this.logger.error('Failed to increment', { key: fullKey, error });
      throw error;
    }
  }

  async getMultiple<T>(keys: string[], namespace?: string): Promise<Map<string, T>> {
    const fullKeys = keys.map(k => this.buildKey(k, namespace));
    const results = new Map<string, T>();

    try {
      const values = await this.breaker.fire('mget', ...fullKeys);
      
      for (let i = 0; i < keys.length; i++) {
        if (values[i]) {
          let value = values[i];
          
          if (this.isCompressed(value)) {
            value = await this.decompress(value);
          }
          
          if (this.config.encryption?.enabled) {
            value = this.decrypt(value);
          }
          
          results.set(keys[i], JSON.parse(value));
        }
      }

      return results;
    } catch (error) {
      this.logger.error('Failed to get multiple states', { error });
      return results;
    }
  }

  async setMultiple(entries: Map<string, any>, options?: StateOptions): Promise<boolean> {
    const pipeline = this.redis.pipeline();
    
    for (const [key, value] of entries) {
      const fullKey = this.buildKey(key, options?.namespace);
      let serialized = JSON.stringify(value);
      
      if (options?.encrypted || this.config.encryption?.enabled) {
        serialized = this.encrypt(serialized);
      }
      
      if (options?.compressed || serialized.length > this.compressionThreshold) {
        serialized = await this.compress(serialized);
      }
      
      const ttl = options?.ttl || 3600;
      pipeline.setex(fullKey, ttl, serialized);
    }

    try {
      const results = await pipeline.exec();
      return results?.every(([err, result]: [Error | null, any]) => !err && result === 'OK') || false;
    } catch (error) {
      this.logger.error('Failed to set multiple states', { error });
      return false;
    }
  }

  async lock(key: string, ttl: number = 30): Promise<string | null> {
    const lockKey = `lock:${key}`;
    const lockValue = `${Date.now()}-${Math.random()}`;

    try {
      const result = await this.breaker.fire('set', lockKey, lockValue, 'NX', 'EX', ttl);
      return result === 'OK' ? lockValue : null;
    } catch (error) {
      this.logger.error('Failed to acquire lock', { key: lockKey, error });
      return null;
    }
  }

  async unlock(key: string, lockValue: string): Promise<boolean> {
    const lockKey = `lock:${key}`;
    
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;

    try {
      const result = await this.breaker.fire('eval', script, 1, lockKey, lockValue);
      return result === 1;
    } catch (error) {
      this.logger.error('Failed to release lock', { key: lockKey, error });
      return false;
    }
  }

  async withLock<T>(key: string, fn: () => Promise<T>, ttl: number = 30): Promise<T> {
    const lockValue = await this.lock(key, ttl);
    
    if (!lockValue) {
      throw new Error(`Failed to acquire lock for ${key}`);
    }

    try {
      return await fn();
    } finally {
      await this.unlock(key, lockValue);
    }
  }

  private async executeRedisCommand(command: string, ...args: any[]): Promise<any> {
    return (this.redis as any)[command](...args);
  }

  private buildKey(key: string, namespace?: string): string {
    const parts = [];
    
    if (this.config.redis.keyPrefix) {
      parts.push(this.config.redis.keyPrefix);
    }
    
    if (namespace) {
      parts.push(namespace);
    }
    
    parts.push(key);
    
    return parts.join(':');
  }

  private encrypt(data: string): string {
    if (!this.config.encryption?.enabled) {
      return data;
    }

    const cipher = createHash('aes-256-gcm');
    // Implementation would use proper encryption
    return Buffer.from(data).toString('base64');
  }

  private decrypt(data: string): string {
    if (!this.config.encryption?.enabled) {
      return data;
    }

    // Implementation would use proper decryption
    return Buffer.from(data, 'base64').toString();
  }

  private async compress(data: string): Promise<string> {
    // In production, use zlib or similar
    return `compressed:${data}`;
  }

  private async decompress(data: string): Promise<string> {
    if (data.startsWith('compressed:')) {
      return data.substring(11);
    }
    return data;
  }

  private isCompressed(data: string): boolean {
    return data.startsWith('compressed:');
  }

  private cleanupLocalCache(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.localCache) {
      if (entry.expiry < now) {
        this.localCache.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.debug(`Cleaned ${cleaned} expired cache entries`);
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const result = await this.breaker.fire('ping');
      return result === 'PONG';
    } catch (error) {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.redis.quit();
    this.breaker.shutdown();
    this.removeAllListeners();
  }
} 