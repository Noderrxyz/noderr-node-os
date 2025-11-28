import { EventEmitter } from 'events';
import * as winston from 'winston';

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN'
}

export interface CircuitBreakerConfig {
  name: string;
  timeout: number;
  errorThresholdPercentage: number;
  errorThresholdCount: number;
  successThresholdCount: number;
  resetTimeout: number;
  volumeThreshold: number;
  rollingWindowSize: number;
  fallbackFunction?: () => Promise<any>;
}

export interface CircuitBreakerMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  timeouts: number;
  shortCircuited: number;
  fallbackSuccess: number;
  fallbackFailure: number;
  latencyPercentiles: {
    p50: number;
    p75: number;
    p90: number;
    p95: number;
    p99: number;
  };
  errorRate: number;
  state: CircuitState;
  lastStateChange: Date;
}

interface RequestMetrics {
  timestamp: number;
  success: boolean;
  latency: number;
  error?: Error;
}

export class CircuitBreaker extends EventEmitter {
  private config: CircuitBreakerConfig;
  private state: CircuitState = CircuitState.CLOSED;
  private logger: winston.Logger;
  private metrics: CircuitBreakerMetrics;
  private requestWindow: RequestMetrics[] = [];
  private halfOpenSuccesses: number = 0;
  private lastStateChange: Date = new Date();
  private nextAttempt: number = 0;
  private stateChangeTimer?: NodeJS.Timeout;

  constructor(config: CircuitBreakerConfig, logger: winston.Logger) {
    super();
    this.config = config;
    this.logger = logger;
    this.metrics = this.initializeMetrics();
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if circuit is open
    if (this.state === CircuitState.OPEN) {
      if (Date.now() < this.nextAttempt) {
        this.metrics.shortCircuited++;
        this.emit('short-circuit', { name: this.config.name });
        
        if (this.config.fallbackFunction) {
          return this.executeFallback();
        }
        
        throw new Error(`Circuit breaker ${this.config.name} is OPEN`);
      } else {
        // Transition to half-open
        this.transitionTo(CircuitState.HALF_OPEN);
      }
    }

    const startTime = Date.now();
    
    try {
      // Set timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Request timeout')), this.config.timeout);
      });
      
      const result = await Promise.race([fn(), timeoutPromise]);
      
      // Record success
      this.recordSuccess(Date.now() - startTime);
      
      // Handle half-open state
      if (this.state === CircuitState.HALF_OPEN) {
        this.halfOpenSuccesses++;
        if (this.halfOpenSuccesses >= this.config.successThresholdCount) {
          this.transitionTo(CircuitState.CLOSED);
        }
      }
      
      return result;
      
    } catch (error) {
      // Record failure
      this.recordFailure(Date.now() - startTime, error as Error);
      
      // Handle state transitions
      if (this.state === CircuitState.HALF_OPEN) {
        this.transitionTo(CircuitState.OPEN);
      } else if (this.state === CircuitState.CLOSED) {
        if (this.shouldOpen()) {
          this.transitionTo(CircuitState.OPEN);
        }
      }
      
      // Try fallback
      if (this.config.fallbackFunction) {
        return this.executeFallback();
      }
      
      throw error;
    }
  }

  private async executeFallback<T>(): Promise<T> {
    try {
      const result = await this.config.fallbackFunction!();
      this.metrics.fallbackSuccess++;
      this.emit('fallback-success', { name: this.config.name });
      return result;
    } catch (error) {
      this.metrics.fallbackFailure++;
      this.emit('fallback-failure', { name: this.config.name, error });
      throw error;
    }
  }

  private recordSuccess(latency: number): void {
    this.metrics.totalRequests++;
    this.metrics.successfulRequests++;
    
    this.requestWindow.push({
      timestamp: Date.now(),
      success: true,
      latency
    });
    
    this.cleanupWindow();
    this.updateMetrics();
    
    this.emit('success', {
      name: this.config.name,
      latency,
      state: this.state
    });
  }

  private recordFailure(latency: number, error: Error): void {
    this.metrics.totalRequests++;
    this.metrics.failedRequests++;
    
    if (error.message === 'Request timeout') {
      this.metrics.timeouts++;
    }
    
    this.requestWindow.push({
      timestamp: Date.now(),
      success: false,
      latency,
      error
    });
    
    this.cleanupWindow();
    this.updateMetrics();
    
    this.emit('failure', {
      name: this.config.name,
      latency,
      error,
      state: this.state
    });
  }

  private shouldOpen(): boolean {
    const recentRequests = this.getRecentRequests();
    
    // Check volume threshold
    if (recentRequests.length < this.config.volumeThreshold) {
      return false;
    }
    
    // Check error count threshold
    const failures = recentRequests.filter(r => !r.success).length;
    if (failures >= this.config.errorThresholdCount) {
      return true;
    }
    
    // Check error percentage threshold
    const errorRate = failures / recentRequests.length;
    return errorRate >= this.config.errorThresholdPercentage / 100;
  }

  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;
    this.state = newState;
    this.lastStateChange = new Date();
    this.metrics.lastStateChange = this.lastStateChange;
    this.metrics.state = newState;
    
    // Clear any existing timer
    if (this.stateChangeTimer) {
      clearTimeout(this.stateChangeTimer);
      this.stateChangeTimer = undefined;
    }
    
    switch (newState) {
      case CircuitState.OPEN:
        this.nextAttempt = Date.now() + this.config.resetTimeout;
        this.halfOpenSuccesses = 0;
        
        // Set timer to transition to half-open
        this.stateChangeTimer = setTimeout(() => {
          if (this.state === CircuitState.OPEN) {
            this.transitionTo(CircuitState.HALF_OPEN);
          }
        }, this.config.resetTimeout);
        
        this.logger.warn(`Circuit breaker ${this.config.name} opened`, {
          errorRate: this.metrics.errorRate,
          failures: this.metrics.failedRequests
        });
        break;
        
      case CircuitState.HALF_OPEN:
        this.halfOpenSuccesses = 0;
        this.logger.info(`Circuit breaker ${this.config.name} half-open`);
        break;
        
      case CircuitState.CLOSED:
        this.halfOpenSuccesses = 0;
        this.logger.info(`Circuit breaker ${this.config.name} closed`);
        break;
    }
    
    this.emit('state-change', {
      name: this.config.name,
      oldState,
      newState,
      metrics: this.getMetrics()
    });
  }

  private getRecentRequests(): RequestMetrics[] {
    const cutoff = Date.now() - this.config.rollingWindowSize;
    return this.requestWindow.filter(r => r.timestamp >= cutoff);
  }

  private cleanupWindow(): void {
    const cutoff = Date.now() - this.config.rollingWindowSize * 2;
    this.requestWindow = this.requestWindow.filter(r => r.timestamp >= cutoff);
  }

  private updateMetrics(): void {
    const recentRequests = this.getRecentRequests();
    
    if (recentRequests.length === 0) {
      this.metrics.errorRate = 0;
      return;
    }
    
    // Calculate error rate
    const failures = recentRequests.filter(r => !r.success).length;
    this.metrics.errorRate = failures / recentRequests.length;
    
    // Calculate latency percentiles
    const latencies = recentRequests.map(r => r.latency).sort((a, b) => a - b);
    
    this.metrics.latencyPercentiles = {
      p50: this.percentile(latencies, 0.5),
      p75: this.percentile(latencies, 0.75),
      p90: this.percentile(latencies, 0.9),
      p95: this.percentile(latencies, 0.95),
      p99: this.percentile(latencies, 0.99)
    };
  }

  private percentile(sortedArray: number[], p: number): number {
    if (sortedArray.length === 0) return 0;
    
    const index = Math.ceil(sortedArray.length * p) - 1;
    return sortedArray[Math.max(0, Math.min(index, sortedArray.length - 1))];
  }

  private initializeMetrics(): CircuitBreakerMetrics {
    return {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      timeouts: 0,
      shortCircuited: 0,
      fallbackSuccess: 0,
      fallbackFailure: 0,
      latencyPercentiles: {
        p50: 0,
        p75: 0,
        p90: 0,
        p95: 0,
        p99: 0
      },
      errorRate: 0,
      state: CircuitState.CLOSED,
      lastStateChange: new Date()
    };
  }

  // Public methods
  getState(): CircuitState {
    return this.state;
  }

  getMetrics(): CircuitBreakerMetrics {
    return { ...this.metrics };
  }

  reset(): void {
    this.transitionTo(CircuitState.CLOSED);
    this.requestWindow = [];
    this.metrics = this.initializeMetrics();
    this.emit('reset', { name: this.config.name });
  }

  forceOpen(): void {
    this.transitionTo(CircuitState.OPEN);
  }

  forceClosed(): void {
    this.transitionTo(CircuitState.CLOSED);
  }

  isOpen(): boolean {
    return this.state === CircuitState.OPEN;
  }

  isClosed(): boolean {
    return this.state === CircuitState.CLOSED;
  }

  isHalfOpen(): boolean {
    return this.state === CircuitState.HALF_OPEN;
  }

  destroy(): void {
    if (this.stateChangeTimer) {
      clearTimeout(this.stateChangeTimer);
    }
    this.removeAllListeners();
  }
}

// Factory for creating circuit breakers
export class CircuitBreakerFactory {
  private breakers: Map<string, CircuitBreaker> = new Map();
  private logger: winston.Logger;
  private defaultConfig: Partial<CircuitBreakerConfig>;

  constructor(logger: winston.Logger, defaultConfig?: Partial<CircuitBreakerConfig>) {
    this.logger = logger;
    this.defaultConfig = defaultConfig || {
      timeout: 3000,
      errorThresholdPercentage: 50,
      errorThresholdCount: 5,
      successThresholdCount: 3,
      resetTimeout: 30000,
      volumeThreshold: 10,
      rollingWindowSize: 60000
    };
  }

  create(config: Partial<CircuitBreakerConfig> & { name: string }): CircuitBreaker {
    if (this.breakers.has(config.name)) {
      return this.breakers.get(config.name)!;
    }

    const fullConfig: CircuitBreakerConfig = {
      ...this.defaultConfig,
      ...config
    } as CircuitBreakerConfig;

    const breaker = new CircuitBreaker(fullConfig, this.logger);
    this.breakers.set(config.name, breaker);

    // Set up monitoring
    breaker.on('state-change', (event) => {
      this.logger.info('Circuit breaker state change', event);
    });

    breaker.on('failure', (event) => {
      if (event.error?.message !== 'Request timeout') {
        this.logger.error('Circuit breaker request failed', event);
      }
    });

    return breaker;
  }

  get(name: string): CircuitBreaker | undefined {
    return this.breakers.get(name);
  }

  getAll(): Map<string, CircuitBreaker> {
    return new Map(this.breakers);
  }

  getMetrics(): Map<string, CircuitBreakerMetrics> {
    const metrics = new Map<string, CircuitBreakerMetrics>();
    
    for (const [name, breaker] of this.breakers) {
      metrics.set(name, breaker.getMetrics());
    }
    
    return metrics;
  }

  resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
  }

  destroy(): void {
    for (const breaker of this.breakers.values()) {
      breaker.destroy();
    }
    this.breakers.clear();
  }
} 