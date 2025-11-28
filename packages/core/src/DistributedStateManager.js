"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DistributedStateManager = void 0;
const events_1 = require("events");
const Redis = __importStar(require("ioredis"));
const opossum_1 = __importDefault(require("opossum"));
const crypto_1 = require("crypto");
class DistributedStateManager extends events_1.EventEmitter {
    redis;
    breaker;
    logger;
    config;
    localCache = new Map();
    compressionThreshold = 1024; // Compress values larger than 1KB
    constructor(logger, config) {
        super();
        this.logger = logger;
        this.config = config;
        // Initialize Redis connection
        if (config.redis.cluster) {
            this.redis = new Redis.Cluster(config.redis.sentinels || [{ host: config.redis.host, port: config.redis.port }], {
                redisOptions: {
                    password: config.redis.password,
                    db: config.redis.db
                }
            });
        }
        else {
            this.redis = new Redis({
                host: config.redis.host,
                port: config.redis.port,
                password: config.redis.password,
                db: config.redis.db,
                keyPrefix: config.redis.keyPrefix,
                retryStrategy: (times) => {
                    const delay = Math.min(times * 50, 2000);
                    return delay;
                }
            });
        }
        // Set up circuit breaker
        this.breaker = new opossum_1.default(this.executeRedisCommand.bind(this), {
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
        this.redis.on('error', (err) => {
            this.logger.error('Redis error', err);
            this.emit('error', err);
        });
        // Start cache cleanup interval
        setInterval(() => this.cleanupLocalCache(), 60000); // Every minute
    }
    async getState(key, options) {
        const fullKey = this.buildKey(key, options?.namespace);
        // Check local cache first
        const cached = this.localCache.get(fullKey);
        if (cached && cached.expiry > Date.now()) {
            return cached.value;
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
            return parsed;
        }
        catch (error) {
            this.logger.error('Failed to get state', { key: fullKey, error });
            return null;
        }
    }
    async setState(key, value, options) {
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
        }
        catch (error) {
            this.logger.error('Failed to set state', { key: fullKey, error });
            return false;
        }
    }
    async deleteState(key, namespace) {
        const fullKey = this.buildKey(key, namespace);
        try {
            const result = await this.breaker.fire('del', fullKey);
            this.localCache.delete(fullKey);
            return result === 1;
        }
        catch (error) {
            this.logger.error('Failed to delete state', { key: fullKey, error });
            return false;
        }
    }
    async exists(key, namespace) {
        const fullKey = this.buildKey(key, namespace);
        try {
            const result = await this.breaker.fire('exists', fullKey);
            return result === 1;
        }
        catch (error) {
            this.logger.error('Failed to check existence', { key: fullKey, error });
            return false;
        }
    }
    async increment(key, amount = 1, options) {
        const fullKey = this.buildKey(key, options?.namespace);
        try {
            const result = await this.breaker.fire('incrby', fullKey, amount);
            if (options?.ttl) {
                await this.breaker.fire('expire', fullKey, options.ttl);
            }
            return result;
        }
        catch (error) {
            this.logger.error('Failed to increment', { key: fullKey, error });
            throw error;
        }
    }
    async getMultiple(keys, namespace) {
        const fullKeys = keys.map(k => this.buildKey(k, namespace));
        const results = new Map();
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
        }
        catch (error) {
            this.logger.error('Failed to get multiple states', { error });
            return results;
        }
    }
    async setMultiple(entries, options) {
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
            return results?.every(([err, result]) => !err && result === 'OK') || false;
        }
        catch (error) {
            this.logger.error('Failed to set multiple states', { error });
            return false;
        }
    }
    async lock(key, ttl = 30) {
        const lockKey = `lock:${key}`;
        const lockValue = `${Date.now()}-${Math.random()}`;
        try {
            const result = await this.breaker.fire('set', lockKey, lockValue, 'NX', 'EX', ttl);
            return result === 'OK' ? lockValue : null;
        }
        catch (error) {
            this.logger.error('Failed to acquire lock', { key: lockKey, error });
            return null;
        }
    }
    async unlock(key, lockValue) {
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
        }
        catch (error) {
            this.logger.error('Failed to release lock', { key: lockKey, error });
            return false;
        }
    }
    async withLock(key, fn, ttl = 30) {
        const lockValue = await this.lock(key, ttl);
        if (!lockValue) {
            throw new Error(`Failed to acquire lock for ${key}`);
        }
        try {
            return await fn();
        }
        finally {
            await this.unlock(key, lockValue);
        }
    }
    async executeRedisCommand(command, ...args) {
        return this.redis[command](...args);
    }
    buildKey(key, namespace) {
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
    encrypt(data) {
        if (!this.config.encryption?.enabled) {
            return data;
        }
        const cipher = (0, crypto_1.createHash)('aes-256-gcm');
        // Implementation would use proper encryption
        return Buffer.from(data).toString('base64');
    }
    decrypt(data) {
        if (!this.config.encryption?.enabled) {
            return data;
        }
        // Implementation would use proper decryption
        return Buffer.from(data, 'base64').toString();
    }
    async compress(data) {
        // In production, use zlib or similar
        return `compressed:${data}`;
    }
    async decompress(data) {
        if (data.startsWith('compressed:')) {
            return data.substring(11);
        }
        return data;
    }
    isCompressed(data) {
        return data.startsWith('compressed:');
    }
    cleanupLocalCache() {
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
    async healthCheck() {
        try {
            const result = await this.breaker.fire('ping');
            return result === 'PONG';
        }
        catch (error) {
            return false;
        }
    }
    async close() {
        await this.redis.quit();
        this.breaker.shutdown();
        this.removeAllListeners();
    }
}
exports.DistributedStateManager = DistributedStateManager;
//# sourceMappingURL=DistributedStateManager.js.map