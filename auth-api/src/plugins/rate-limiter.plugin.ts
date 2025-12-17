import { FastifyInstance, FastifyRequest, FastifyReply, HookHandlerDoneFunction } from 'fastify';
import fp from 'fastify-plugin';
import { Redis } from 'ioredis';

/**
 * Production-Grade Rate Limiting Plugin for Fastify
 * 
 * Implements multiple rate limiting strategies to prevent abuse:
 * 1. Global rate limit (requests per second across all IPs)
 * 2. Per-IP rate limit (requests per minute per IP)
 * 3. Per-wallet rate limit (registrations per hour per wallet)
 * 4. Sliding window algorithm for accurate rate limiting
 * 5. Distributed rate limiting via Redis
 * 
 * Attack Mitigations:
 * - DDoS attacks: Global + per-IP limits
 * - Brute force: Per-wallet limits
 * - Resource exhaustion: Sliding window prevents bursts
 * - Distributed attacks: Redis-backed coordination
 */

export interface RateLimitConfig {
  // Global limits
  globalRequestsPerSecond: number;
  
  // Per-IP limits
  ipRequestsPerMinute: number;
  ipBanDuration: number; // seconds
  
  // Per-wallet limits (for registration)
  walletRegistrationsPerHour: number;
  
  // Redis configuration
  redisUrl: string;
  
  // Whitelist/blacklist
  whitelistedIPs?: string[];
  blacklistedIPs?: string[];
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfter?: number; // seconds
  reason?: string;
  remaining?: number;
  limit?: number;
}

class RateLimiter {
  private redis: Redis;
  private config: RateLimitConfig;
  
  private readonly GLOBAL_KEY = 'ratelimit:global';
  private readonly IP_PREFIX = 'ratelimit:ip:';
  private readonly WALLET_PREFIX = 'ratelimit:wallet:';
  private readonly BAN_PREFIX = 'ratelimit:ban:';

  constructor(config: RateLimitConfig) {
    this.config = config;
    this.redis = new Redis(config.redisUrl);
  }

  /**
   * Checks global rate limit (requests per second)
   */
  async checkGlobalLimit(): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = now - 1000; // 1 second window

    // Add current request to sorted set
    await this.redis.zadd(this.GLOBAL_KEY, now, `${now}-${Math.random()}`);

    // Remove old entries
    await this.redis.zremrangebyscore(this.GLOBAL_KEY, '-inf', windowStart);

    // Count requests in window
    const count = await this.redis.zcard(this.GLOBAL_KEY);

    // Set expiry on key
    await this.redis.expire(this.GLOBAL_KEY, 2);

    const limit = this.config.globalRequestsPerSecond;

    if (count > limit) {
      return {
        allowed: false,
        retryAfter: 1,
        reason: 'Global rate limit exceeded',
        limit,
        remaining: 0,
      };
    }

    return {
      allowed: true,
      limit,
      remaining: limit - count,
    };
  }

  /**
   * Checks per-IP rate limit (requests per minute)
   */
  async checkIPLimit(ip: string): Promise<RateLimitResult> {
    // Check if IP is whitelisted
    if (this.config.whitelistedIPs?.includes(ip)) {
      return { allowed: true };
    }

    // Check if IP is blacklisted
    if (this.config.blacklistedIPs?.includes(ip)) {
      return {
        allowed: false,
        retryAfter: 3600,
        reason: 'IP is blacklisted',
      };
    }

    // Check if IP is banned
    const banKey = `${this.BAN_PREFIX}${ip}`;
    const isBanned = await this.redis.exists(banKey);

    if (isBanned) {
      const ttl = await this.redis.ttl(banKey);
      return {
        allowed: false,
        retryAfter: ttl,
        reason: 'IP is temporarily banned',
      };
    }

    const key = `${this.IP_PREFIX}${ip}`;
    const now = Date.now();
    const windowStart = now - 60000; // 1 minute window

    // Add current request
    await this.redis.zadd(key, now, `${now}-${Math.random()}`);

    // Remove old entries
    await this.redis.zremrangebyscore(key, '-inf', windowStart);

    // Count requests in window
    const count = await this.redis.zcard(key);

    // Set expiry
    await this.redis.expire(key, 120);

    const limit = this.config.ipRequestsPerMinute;

    if (count > limit) {
      // Ban IP if significantly over limit (2x)
      if (count > limit * 2) {
        await this.banIP(ip, this.config.ipBanDuration);
      }

      return {
        allowed: false,
        retryAfter: 60,
        reason: 'IP rate limit exceeded',
        limit,
        remaining: 0,
      };
    }

    return {
      allowed: true,
      limit,
      remaining: limit - count,
    };
  }

  /**
   * Checks per-wallet rate limit (registrations per hour)
   */
  async checkWalletLimit(walletAddress: string): Promise<RateLimitResult> {
    const key = `${this.WALLET_PREFIX}${walletAddress.toLowerCase()}`;
    const now = Date.now();
    const windowStart = now - 3600000; // 1 hour window

    // Add current request
    await this.redis.zadd(key, now, `${now}-${Math.random()}`);

    // Remove old entries
    await this.redis.zremrangebyscore(key, '-inf', windowStart);

    // Count requests in window
    const count = await this.redis.zcard(key);

    // Set expiry
    await this.redis.expire(key, 7200);

    const limit = this.config.walletRegistrationsPerHour;

    if (count > limit) {
      return {
        allowed: false,
        retryAfter: 3600,
        reason: 'Wallet rate limit exceeded',
        limit,
        remaining: 0,
      };
    }

    return {
      allowed: true,
      limit,
      remaining: limit - count,
    };
  }

  /**
   * Bans an IP address for a specified duration
   */
  async banIP(ip: string, durationSeconds: number): Promise<void> {
    const banKey = `${this.BAN_PREFIX}${ip}`;
    await this.redis.setex(banKey, durationSeconds, '1');
    console.warn(`IP ${ip} has been banned for ${durationSeconds} seconds`);
  }

  /**
   * Unbans an IP address
   */
  async unbanIP(ip: string): Promise<void> {
    const banKey = `${this.BAN_PREFIX}${ip}`;
    await this.redis.del(banKey);
    console.info(`IP ${ip} has been unbanned`);
  }

  /**
   * Gets client IP from request (handles proxies)
   */
  getClientIP(request: FastifyRequest): string {
    // Check X-Forwarded-For header (from load balancer/proxy)
    const forwardedFor = request.headers['x-forwarded-for'];
    if (forwardedFor) {
      const ips = (forwardedFor as string).split(',');
      return ips[0].trim();
    }

    // Check X-Real-IP header
    const realIP = request.headers['x-real-ip'];
    if (realIP) {
      return realIP as string;
    }

    // Fall back to socket IP
    return request.socket.remoteAddress || 'unknown';
  }

  /**
   * Gets rate limit statistics
   */
  async getStatistics(): Promise<{
    globalRequestsLastSecond: number;
    topIPs: Array<{ ip: string; requests: number }>;
    bannedIPs: number;
  }> {
    // Global requests
    const globalCount = await this.redis.zcard(this.GLOBAL_KEY);

    // Top IPs
    const ipKeys = await this.redis.keys(`${this.IP_PREFIX}*`);
    const ipCounts: Array<{ ip: string; requests: number }> = [];

    for (const key of ipKeys.slice(0, 100)) { // Limit to 100 IPs for performance
      const ip = key.replace(this.IP_PREFIX, '');
      const count = await this.redis.zcard(key);
      ipCounts.push({ ip, requests: count });
    }

    ipCounts.sort((a, b) => b.requests - a.requests);

    // Banned IPs
    const banKeys = await this.redis.keys(`${this.BAN_PREFIX}*`);

    return {
      globalRequestsLastSecond: globalCount,
      topIPs: ipCounts.slice(0, 10),
      bannedIPs: banKeys.length,
    };
  }

  /**
   * Closes Redis connection
   */
  async close(): Promise<void> {
    await this.redis.quit();
  }
}

/**
 * Default configuration for production
 */
export const PRODUCTION_RATE_LIMIT_CONFIG: RateLimitConfig = {
  globalRequestsPerSecond: 1000,      // 1000 req/s globally
  ipRequestsPerMinute: 60,             // 60 req/min per IP
  ipBanDuration: 3600,                 // 1 hour ban
  walletRegistrationsPerHour: 5,       // 5 registrations per hour per wallet
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
};

/**
 * Fastify plugin for rate limiting
 */
async function rateLimiterPlugin(fastify: FastifyInstance, options: RateLimitConfig) {
  const rateLimiter = new RateLimiter(options);

  // Decorate fastify instance with rate limiter
  fastify.decorate('rateLimiter', rateLimiter);

  // Global rate limit hook (applies to all routes)
  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const globalResult = await rateLimiter.checkGlobalLimit();

      if (!globalResult.allowed) {
        reply.header('X-RateLimit-Limit', globalResult.limit?.toString() || '0');
        reply.header('X-RateLimit-Remaining', '0');
        reply.header('Retry-After', globalResult.retryAfter?.toString() || '1');

        return reply.code(429).send({
          error: 'Too many requests',
          reason: globalResult.reason,
          retryAfter: globalResult.retryAfter,
        });
      }

      // Set rate limit headers
      reply.header('X-RateLimit-Limit', globalResult.limit?.toString() || '0');
      reply.header('X-RateLimit-Remaining', globalResult.remaining?.toString() || '0');
    } catch (error) {
      fastify.log.error({ error }, 'Global rate limiter error');
      // Fail open (allow request) to prevent rate limiter from becoming a single point of failure
    }
  });

  // Per-IP rate limit decorator (can be applied to specific routes)
  fastify.decorate('rateLimitIP', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const ip = rateLimiter.getClientIP(request);
      const ipResult = await rateLimiter.checkIPLimit(ip);

      if (!ipResult.allowed) {
        reply.header('X-RateLimit-Limit', ipResult.limit?.toString() || '0');
        reply.header('X-RateLimit-Remaining', '0');
        reply.header('Retry-After', ipResult.retryAfter?.toString() || '60');

        return reply.code(429).send({
          error: 'Too many requests',
          reason: ipResult.reason,
          retryAfter: ipResult.retryAfter,
        });
      }

      // Set rate limit headers
      reply.header('X-RateLimit-Limit', ipResult.limit?.toString() || '0');
      reply.header('X-RateLimit-Remaining', ipResult.remaining?.toString() || '0');
    } catch (error) {
      fastify.log.error({ error }, 'IP rate limiter error');
      // Fail open
    }
  });

  // Per-wallet rate limit decorator (for registration routes)
  fastify.decorate('rateLimitWallet', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const walletAddress = (request.body as any)?.walletAddress || (request.query as any)?.walletAddress;

      if (!walletAddress) {
        return reply.code(400).send({ error: 'Wallet address required' });
      }

      const walletResult = await rateLimiter.checkWalletLimit(walletAddress as string);

      if (!walletResult.allowed) {
        reply.header('X-RateLimit-Limit', walletResult.limit?.toString() || '0');
        reply.header('X-RateLimit-Remaining', '0');
        reply.header('Retry-After', walletResult.retryAfter?.toString() || '3600');

        return reply.code(429).send({
          error: 'Too many requests',
          reason: walletResult.reason,
          retryAfter: walletResult.retryAfter,
        });
      }

      // Set rate limit headers
      reply.header('X-RateLimit-Limit', walletResult.limit?.toString() || '0');
      reply.header('X-RateLimit-Remaining', walletResult.remaining?.toString() || '0');
    } catch (error) {
      fastify.log.error({ error }, 'Wallet rate limiter error');
      // Fail open
    }
  });

  // Admin routes for rate limit management
  fastify.get('/api/v1/admin/rate-limit/stats', async (request, reply) => {
    const stats = await rateLimiter.getStatistics();
    return reply.send(stats);
  });

  fastify.post('/api/v1/admin/rate-limit/ban', async (request, reply) => {
    const { ip, duration } = request.body as { ip: string; duration: number };
    await rateLimiter.banIP(ip, duration);
    return reply.send({ success: true });
  });

  fastify.post('/api/v1/admin/rate-limit/unban', async (request, reply) => {
    const { ip } = request.body as { ip: string };
    await rateLimiter.unbanIP(ip);
    return reply.send({ success: true });
  });

  // Cleanup on server close
  fastify.addHook('onClose', async () => {
    await rateLimiter.close();
  });
}

// Export as Fastify plugin
export default (fp as any)(rateLimiterPlugin, {
  name: 'rate-limiter',
  fastify: '4.x',
});

// Type augmentation for Fastify
declare module 'fastify' {
  interface FastifyInstance {
    rateLimiter: RateLimiter;
    rateLimitIP: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    rateLimitWallet: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

/**
 * Example usage:
 * 
 * ```typescript
 * import Fastify from 'fastify';
 * import rateLimiterPlugin, { PRODUCTION_RATE_LIMIT_CONFIG } from './plugins/rate-limiter.plugin';
 * 
 * const fastify = Fastify();
 * 
 * // Register plugin (applies global rate limit to all routes)
 * await fastify.register(rateLimiterPlugin, PRODUCTION_RATE_LIMIT_CONFIG);
 * 
 * // Apply per-IP and per-wallet rate limits to registration endpoint
 * fastify.post('/api/v1/auth/register', {
 *   preHandler: [
 *     fastify.rateLimitIP,
 *     fastify.rateLimitWallet,
 *   ],
 * }, async (request, reply) => {
 *   // Registration logic
 * });
 * ```
 */
