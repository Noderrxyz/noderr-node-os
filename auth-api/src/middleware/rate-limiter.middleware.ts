import { Request, Response, NextFunction } from 'express';
import { Redis } from 'ioredis';

/**
 * Production-Grade Rate Limiting Middleware
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

export class RateLimiter {
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
   * Express middleware factory
   */
  middleware(limitType: 'global' | 'ip' | 'wallet' = 'ip') {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        let result: RateLimitResult;

        switch (limitType) {
          case 'global':
            result = await this.checkGlobalLimit();
            break;
          case 'ip':
            result = await this.checkIPLimit(this.getClientIP(req));
            break;
          case 'wallet':
            const walletAddress = req.body.walletAddress || req.query.walletAddress;
            if (!walletAddress) {
              return res.status(400).json({ error: 'Wallet address required' });
            }
            result = await this.checkWalletLimit(walletAddress as string);
            break;
          default:
            result = { allowed: true };
        }

        if (!result.allowed) {
          res.set('X-RateLimit-Limit', result.limit?.toString() || '0');
          res.set('X-RateLimit-Remaining', '0');
          res.set('Retry-After', result.retryAfter?.toString() || '60');

          return res.status(429).json({
            error: 'Too many requests',
            reason: result.reason,
            retryAfter: result.retryAfter,
          });
        }

        // Set rate limit headers
        res.set('X-RateLimit-Limit', result.limit?.toString() || '0');
        res.set('X-RateLimit-Remaining', result.remaining?.toString() || '0');

        next();
      } catch (error) {
        console.error('Rate limiter error:', error);
        // Fail open (allow request) to prevent rate limiter from becoming a single point of failure
        next();
      }
    };
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
   * Adds an IP to the whitelist
   */
  addToWhitelist(ip: string): void {
    if (!this.config.whitelistedIPs) {
      this.config.whitelistedIPs = [];
    }
    if (!this.config.whitelistedIPs.includes(ip)) {
      this.config.whitelistedIPs.push(ip);
    }
  }

  /**
   * Adds an IP to the blacklist
   */
  addToBlacklist(ip: string): void {
    if (!this.config.blacklistedIPs) {
      this.config.blacklistedIPs = [];
    }
    if (!this.config.blacklistedIPs.includes(ip)) {
      this.config.blacklistedIPs.push(ip);
    }
  }

  /**
   * Gets client IP from request (handles proxies)
   */
  private getClientIP(req: Request): string {
    // Check X-Forwarded-For header (from load balancer/proxy)
    const forwardedFor = req.headers['x-forwarded-for'];
    if (forwardedFor) {
      const ips = (forwardedFor as string).split(',');
      return ips[0].trim();
    }

    // Check X-Real-IP header
    const realIP = req.headers['x-real-ip'];
    if (realIP) {
      return realIP as string;
    }

    // Fall back to socket IP
    return req.socket.remoteAddress || 'unknown';
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
 * Example usage:
 * 
 * ```typescript
 * import express from 'express';
 * import { RateLimiter, PRODUCTION_RATE_LIMIT_CONFIG } from './rate-limiter.middleware';
 * 
 * const app = express();
 * const rateLimiter = new RateLimiter(PRODUCTION_RATE_LIMIT_CONFIG);
 * 
 * // Apply global rate limit to all routes
 * app.use(rateLimiter.middleware('global'));
 * 
 * // Apply per-IP rate limit to all routes
 * app.use(rateLimiter.middleware('ip'));
 * 
 * // Apply per-wallet rate limit to registration endpoint
 * app.post('/api/v1/auth/register', 
 *   rateLimiter.middleware('wallet'),
 *   async (req, res) => {
 *     // Registration logic
 *   }
 * );
 * 
 * // Admin endpoint to get statistics
 * app.get('/api/v1/admin/rate-limit/stats',
 *   async (req, res) => {
 *     const stats = await rateLimiter.getStatistics();
 *     res.json(stats);
 *   }
 * );
 * 
 * // Admin endpoint to ban/unban IPs
 * app.post('/api/v1/admin/rate-limit/ban',
 *   async (req, res) => {
 *     const { ip, duration } = req.body;
 *     await rateLimiter.banIP(ip, duration);
 *     res.json({ success: true });
 *   }
 * );
 * ```
 */
