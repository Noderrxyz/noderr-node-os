import { RateLimiterStatus } from '@noderr/types';

/**
 * Rate limiter to prevent excessive on-chain transactions
 */
export class RateLimiter {
  private requestTimestamps: number[] = [];
  private readonly limit: number;
  private readonly windowMs: number = 60 * 60 * 1000; // 1 hour in milliseconds

  constructor(requestsPerHour: number) {
    this.limit = requestsPerHour;
  }

  /**
   * Check if a request can be made
   */
  canMakeRequest(): boolean {
    this.cleanupOldRequests();
    return this.requestTimestamps.length < this.limit;
  }

  /**
   * Record a new request
   */
  recordRequest(): void {
    if (!this.canMakeRequest()) {
      throw new Error('Rate limit exceeded');
    }
    this.requestTimestamps.push(Date.now());
  }

  /**
   * Get current rate limiter status
   */
  getStatus(): RateLimiterStatus {
    this.cleanupOldRequests();
    const oldestRequest = this.requestTimestamps[0];
    const windowStart = oldestRequest || Date.now();

    return {
      requestCount: this.requestTimestamps.length,
      windowStart,
      limit: this.limit,
      requestsInLastHour: this.requestTimestamps.length,
      canMakeRequest: this.canMakeRequest(),
    };
  }

  /**
   * Reset the rate limiter
   */
  reset(): void {
    this.requestTimestamps = [];
  }

  /**
   * Remove requests older than the time window
   */
  private cleanupOldRequests(): void {
    const cutoffTime = Date.now() - this.windowMs;
    this.requestTimestamps = this.requestTimestamps.filter(ts => ts > cutoffTime);
  }
}
