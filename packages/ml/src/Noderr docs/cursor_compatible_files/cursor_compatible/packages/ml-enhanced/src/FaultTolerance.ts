import * as winston from 'winston';
import { EventEmitter } from 'events';

export interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeout: number;
  monitoringPeriod: number;
  halfOpenRequests: number;
}

export interface FallbackConfig {
  maxRetries: number;
  retryDelay: number;
  timeoutMs: number;
  fallbackValue?: any;
}

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN'
}

export class CircuitBreaker extends EventEmitter {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount: number = 0;
  private successCount: number = 0;
  private lastFailureTime: number = 0;
  private halfOpenRequests: number = 0;
  
  constructor(
    private name: string,
    private config: CircuitBreakerConfig,
    private logger: winston.Logger
  ) {
    super();
  }
  
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() - this.lastFailureTime > this.config.resetTimeout) {
        this.transitionTo(CircuitState.HALF_OPEN);
      } else {
        throw new Error(`Circuit breaker ${this.name} is OPEN`);
      }
    }
    
    if (this.state === CircuitState.HALF_OPEN) {
      if (this.halfOpenRequests >= this.config.halfOpenRequests) {
        throw new Error(`Circuit breaker ${this.name} is testing in HALF_OPEN state`);
      }
      this.halfOpenRequests++;
    }
    
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
  
  private onSuccess(): void {
    this.failureCount = 0;
    
    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= this.config.halfOpenRequests) {
        this.transitionTo(CircuitState.CLOSED);
      }
    }
  }
  
  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    if (this.state === CircuitState.HALF_OPEN) {
      this.transitionTo(CircuitState.OPEN);
    } else if (this.failureCount >= this.config.failureThreshold) {
      this.transitionTo(CircuitState.OPEN);
    }
  }
  
  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;
    this.state = newState;
    
    if (newState === CircuitState.HALF_OPEN) {
      this.halfOpenRequests = 0;
      this.successCount = 0;
    }
    
    this.logger.info(`Circuit breaker ${this.name} transitioned from ${oldState} to ${newState}`);
    this.emit('stateChange', { name: this.name, oldState, newState });
  }
  
  getState(): CircuitState {
    return this.state;
  }
  
  reset(): void {
    this.transitionTo(CircuitState.CLOSED);
    this.failureCount = 0;
    this.successCount = 0;
    this.halfOpenRequests = 0;
  }
}

export class FaultToleranceSystem {
  protected circuitBreakers: Map<string, CircuitBreaker> = new Map();
  protected logger: winston.Logger;
  
  constructor(logger: winston.Logger) {
    this.logger = logger;
  }
  
  createCircuitBreaker(name: string, config?: Partial<CircuitBreakerConfig>): CircuitBreaker {
    const defaultConfig: CircuitBreakerConfig = {
      failureThreshold: 5,
      resetTimeout: 60000, // 1 minute
      monitoringPeriod: 10000, // 10 seconds
      halfOpenRequests: 3
    };
    
    const breaker = new CircuitBreaker(
      name,
      { ...defaultConfig, ...config },
      this.logger
    );
    
    this.circuitBreakers.set(name, breaker);
    return breaker;
  }
  
  async executeWithFallback<T>(
    name: string,
    fn: () => Promise<T>,
    fallbackFn: () => Promise<T>,
    config?: Partial<FallbackConfig>
  ): Promise<T> {
    const defaultConfig: FallbackConfig = {
      maxRetries: 3,
      retryDelay: 1000,
      timeoutMs: 5000
    };
    
    const finalConfig = { ...defaultConfig, ...config };
    
    // Get or create circuit breaker
    let breaker = this.circuitBreakers.get(name);
    if (!breaker) {
      breaker = this.createCircuitBreaker(name);
    }
    
    // Try with circuit breaker
    try {
      return await this.executeWithRetry(
        () => breaker!.execute(() => this.executeWithTimeout(fn, finalConfig.timeoutMs)),
        finalConfig
      );
    } catch (error) {
      this.logger.warn(`Primary execution failed for ${name}, using fallback`, error);
      
      // Execute fallback
      try {
        return await this.executeWithTimeout(fallbackFn, finalConfig.timeoutMs);
      } catch (fallbackError) {
        this.logger.error(`Fallback also failed for ${name}`, fallbackError);
        
        // Return configured fallback value if available
        if (finalConfig.fallbackValue !== undefined) {
          return finalConfig.fallbackValue;
        }
        
        throw fallbackError;
      }
    }
  }
  
  private async executeWithRetry<T>(
    fn: () => Promise<T>,
    config: FallbackConfig
  ): Promise<T> {
    let lastError: any;
    
    for (let attempt = 0; attempt < config.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        
        if (attempt < config.maxRetries - 1) {
          await this.delay(config.retryDelay * Math.pow(2, attempt)); // Exponential backoff
        }
      }
    }
    
    throw lastError;
  }
  
  protected async executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    return Promise.race([
      fn(),
      new Promise<T>((_, reject) => 
        setTimeout(() => reject(new Error('Operation timeout')), timeoutMs)
      )
    ]);
  }
  
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  getCircuitBreakerStatus(): Map<string, {
    state: CircuitState;
    failureCount: number;
  }> {
    const status = new Map();
    
    for (const [name, breaker] of this.circuitBreakers) {
      status.set(name, {
        state: breaker.getState(),
        failureCount: (breaker as any).failureCount
      });
    }
    
    return status;
  }
  
  resetCircuitBreaker(name: string): void {
    const breaker = this.circuitBreakers.get(name);
    if (breaker) {
      breaker.reset();
      this.logger.info(`Circuit breaker ${name} has been reset`);
    }
  }
  
  resetAllCircuitBreakers(): void {
    for (const [name, breaker] of this.circuitBreakers) {
      breaker.reset();
    }
    this.logger.info('All circuit breakers have been reset');
  }
}

// Specialized fault tolerance for different components
export class TradingSystemFaultTolerance extends FaultToleranceSystem {
  constructor(logger: winston.Logger) {
    super(logger);
    this.initializeCircuitBreakers();
  }
  
  private initializeCircuitBreakers(): void {
    // ML Model circuit breakers
    this.createCircuitBreaker('ml_ensemble', {
      failureThreshold: 3,
      resetTimeout: 30000,
      halfOpenRequests: 2
    });
    
    this.createCircuitBreaker('lightgbm', {
      failureThreshold: 5,
      resetTimeout: 20000
    });
    
    this.createCircuitBreaker('catboost', {
      failureThreshold: 5,
      resetTimeout: 20000
    });
    
    this.createCircuitBreaker('xgboost', {
      failureThreshold: 5,
      resetTimeout: 20000
    });
    
    this.createCircuitBreaker('tabnet', {
      failureThreshold: 3,
      resetTimeout: 40000
    });
    
    this.createCircuitBreaker('saint', {
      failureThreshold: 3,
      resetTimeout: 40000
    });
    
    // Execution circuit breakers
    this.createCircuitBreaker('order_execution', {
      failureThreshold: 2,
      resetTimeout: 10000,
      halfOpenRequests: 1
    });
    
    this.createCircuitBreaker('venue_binance', {
      failureThreshold: 3,
      resetTimeout: 15000
    });
    
    this.createCircuitBreaker('venue_coinbase', {
      failureThreshold: 3,
      resetTimeout: 15000
    });
    
    // Data feed circuit breakers
    this.createCircuitBreaker('market_data', {
      failureThreshold: 5,
      resetTimeout: 5000
    });
    
    this.createCircuitBreaker('orderbook_feed', {
      failureThreshold: 10,
      resetTimeout: 3000
    });
  }
  
  // ML-specific fallbacks
  async executeMLPrediction(
    modelName: string,
    primaryFn: () => Promise<number>,
    features: number[][]
  ): Promise<number> {
    // Simple linear model as ultimate fallback
    const simpleFallback = async () => {
      const weights = [0.1, -0.05, 0.08, 0.02, -0.03]; // Pre-trained simple weights
      const prediction = features[0].slice(0, 5).reduce((sum, f, i) => 
        sum + f * weights[i], 0
      );
      return Math.tanh(prediction); // Bound to [-1, 1]
    };
    
    return this.executeWithFallback(
      modelName,
      primaryFn,
      simpleFallback,
      {
        maxRetries: 2,
        retryDelay: 100,
        timeoutMs: 1000,
        fallbackValue: 0 // Neutral prediction
      }
    );
  }
  
  // Execution-specific fallbacks
  async executeOrder(
    venue: string,
    primaryFn: () => Promise<any>,
    order: any
  ): Promise<any> {
    const fallbackVenues = ['binance', 'coinbase', 'kraken'];
    const currentIndex = fallbackVenues.indexOf(venue);
    const nextVenue = fallbackVenues[(currentIndex + 1) % fallbackVenues.length];
    
    const fallbackFn = async () => {
      this.logger.info(`Routing order to fallback venue: ${nextVenue}`);
      // In production, this would call the actual venue API
      return { 
        status: 'routed',
        venue: nextVenue,
        orderId: `fallback_${Date.now()}`
      };
    };
    
    return this.executeWithFallback(
      `venue_${venue}`,
      primaryFn,
      fallbackFn,
      {
        maxRetries: 2,
        retryDelay: 500,
        timeoutMs: 3000
      }
    );
  }
  
  // Latency spike protection
  async executeWithLatencyProtection<T>(
    operation: string,
    fn: () => Promise<T>,
    maxLatencyMs: number
  ): Promise<T> {
    const startTime = Date.now();
    
    try {
      const result = await this.executeWithTimeout(fn, maxLatencyMs);
      const latency = Date.now() - startTime;
      
      if (latency > maxLatencyMs * 0.8) {
        this.logger.warn(`Operation ${operation} approaching latency limit: ${latency}ms`);
      }
      
      return result;
    } catch (error) {
      const latency = Date.now() - startTime;
      
      if (latency >= maxLatencyMs) {
        this.logger.error(`Operation ${operation} exceeded latency limit: ${latency}ms`);
        
        // Auto-throttle if consistent latency spikes
        const breaker = this.circuitBreakers.get(operation);
        if (breaker) {
          (breaker as any).onFailure();
        }
      }
      
      throw error;
    }
  }
} 