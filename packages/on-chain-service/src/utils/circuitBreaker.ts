import { CircuitBreakerStatus } from '@noderr/types/src';

/**
 * Circuit breaker to halt operations on suspicious activity
 */
export class CircuitBreaker {
  private isTripped: boolean = false;
  private tripReason?: string;
  private tripTimestamp?: number;
  private failureCount: number = 0;
  private readonly failureThreshold: number = 5;
  private readonly resetTimeMs: number = 60 * 60 * 1000; // 1 hour

  /**
   * Check if circuit breaker is tripped
   */
  isOpen(): boolean {
    // Auto-reset after reset time
    if (this.isTripped && this.tripTimestamp) {
      const elapsed = Date.now() - this.tripTimestamp;
      if (elapsed > this.resetTimeMs) {
        this.reset();
      }
    }
    return this.isTripped;
  }

  /**
   * Trip the circuit breaker
   */
  trip(reason: string): void {
    this.isTripped = true;
    this.tripReason = reason;
    this.tripTimestamp = Date.now();
  }

  /**
   * Reset the circuit breaker
   */
  reset(): void {
    this.isTripped = false;
    this.tripReason = undefined;
    this.tripTimestamp = undefined;
    this.failureCount = 0;
  }

  /**
   * Record a failure (trips after threshold)
   */
  recordFailure(reason: string): void {
    this.failureCount++;
    if (this.failureCount >= this.failureThreshold) {
      this.trip(`Failure threshold exceeded: ${reason}`);
    }
  }

  /**
   * Record a success (resets failure count)
   */
  recordSuccess(): void {
    this.failureCount = 0;
  }

  /**
   * Get current circuit breaker status
   */
  getStatus(): CircuitBreakerStatus {
    return {
      isOpen: this.isTripped,
      failures: this.failureCount,
      lastFailure: this.tripTimestamp,
      reason: this.tripReason,
      isTripped: this.isTripped,
      timestamp: this.tripTimestamp,
    };
  }
}
