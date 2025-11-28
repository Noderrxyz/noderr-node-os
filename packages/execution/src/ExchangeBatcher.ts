import * as winston from 'winston';
import { CircuitBreaker } from '../../core/src/CircuitBreaker';

export interface BatchConfig {
  minBatchSize: number;
  maxBatchSize: number;
  maxWaitTime: number; // milliseconds
  adaptiveEnabled: boolean;
  targetP99Latency: number; // milliseconds
}

export interface BatchRequest<T> {
  id: string;
  request: T;
  resolve: (result: any) => void;
  reject: (error: any) => void;
  timestamp: number;
}

export interface BatchMetrics {
  totalBatches: number;
  totalRequests: number;
  avgBatchSize: number;
  p99Latency: number;
  successRate: number;
  currentBatchSize: number;
}

/**
 * Adaptive batching system for exchange API calls
 * Dynamically adjusts batch size based on P99 latency
 * Target: -50ms reconciliation time
 */
export class ExchangeBatcher<TRequest, TResponse> {
  private logger: winston.Logger;
  private config: BatchConfig;
  private pendingRequests: BatchRequest<TRequest>[] = [];
  private batchTimer: NodeJS.Timeout | null = null;
  private metrics: BatchMetrics = {
    totalBatches: 0,
    totalRequests: 0,
    avgBatchSize: 0,
    p99Latency: 0,
    successRate: 1,
    currentBatchSize: 10
  };
  
  // Adaptive batching state
  private latencyHistory: number[] = [];
  private readonly HISTORY_SIZE = 100;
  private adaptiveBatchSize: number;
  
  constructor(
    private name: string,
    logger: winston.Logger,
    private batchProcessor: (requests: TRequest[]) => Promise<TResponse[]>,
    config?: Partial<BatchConfig>
  ) {
    this.logger = logger;
    this.config = {
      minBatchSize: config?.minBatchSize || 1,
      maxBatchSize: config?.maxBatchSize || 50,
      maxWaitTime: config?.maxWaitTime || 10,
      adaptiveEnabled: config?.adaptiveEnabled ?? true,
      targetP99Latency: config?.targetP99Latency || 50
    };
    
    this.adaptiveBatchSize = Math.floor(
      (this.config.minBatchSize + this.config.maxBatchSize) / 2
    );
  }
  
  /**
   * Add a request to the batch queue
   */
  async addRequest(request: TRequest): Promise<TResponse> {
    return new Promise((resolve, reject) => {
      const batchRequest: BatchRequest<TRequest> = {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        request,
        resolve,
        reject,
        timestamp: Date.now()
      };
      
      this.pendingRequests.push(batchRequest);
      this.metrics.totalRequests++;
      
      // Check if we should process immediately
      if (this.shouldProcessBatch()) {
        this.processBatch();
      } else if (!this.batchTimer) {
        // Set timer for max wait time
        this.batchTimer = setTimeout(() => {
          this.processBatch();
        }, this.config.maxWaitTime);
      }
    });
  }
  
  /**
   * Determine if batch should be processed now
   */
  private shouldProcessBatch(): boolean {
    const batchSize = this.config.adaptiveEnabled 
      ? this.adaptiveBatchSize 
      : this.config.maxBatchSize;
      
    return this.pendingRequests.length >= batchSize;
  }
  
  /**
   * Process the current batch
   */
  private async processBatch(): Promise<void> {
    // Clear timer
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    
    // Get requests to process
    const batch = this.pendingRequests.splice(0, this.adaptiveBatchSize);
    if (batch.length === 0) return;
    
    const startTime = Date.now();
    this.metrics.totalBatches++;
    
    try {
      // Process batch
      const requests = batch.map(b => b.request);
      const responses = await this.batchProcessor(requests);
      
      // Match responses to requests
      if (responses.length !== batch.length) {
        throw new Error(`Response count mismatch: expected ${batch.length}, got ${responses.length}`);
      }
      
      // Resolve promises
      batch.forEach((batchRequest, index) => {
        batchRequest.resolve(responses[index]);
      });
      
      // Update metrics
      const latency = Date.now() - startTime;
      this.updateMetrics(batch.length, latency, true);
      
    } catch (error) {
      // Reject all promises in batch
      batch.forEach(batchRequest => {
        batchRequest.reject(error);
      });
      
      // Update metrics
      const latency = Date.now() - startTime;
      this.updateMetrics(batch.length, latency, false);
      
      this.logger.error(`Batch processing failed for ${this.name}`, {
        batchSize: batch.length,
        error
      });
    }
    
    // Process next batch if pending
    if (this.pendingRequests.length > 0) {
      setImmediate(() => this.processBatch());
    }
  }
  
  /**
   * Update metrics and adapt batch size
   */
  private updateMetrics(batchSize: number, latency: number, success: boolean): void {
    // Update latency history
    this.latencyHistory.push(latency);
    if (this.latencyHistory.length > this.HISTORY_SIZE) {
      this.latencyHistory.shift();
    }
    
    // Calculate metrics
    const totalBatchSizes = this.metrics.avgBatchSize * (this.metrics.totalBatches - 1) + batchSize;
    this.metrics.avgBatchSize = totalBatchSizes / this.metrics.totalBatches;
    
    if (success) {
      this.metrics.successRate = (this.metrics.successRate * (this.metrics.totalBatches - 1) + 1) / 
                                 this.metrics.totalBatches;
    } else {
      this.metrics.successRate = (this.metrics.successRate * (this.metrics.totalBatches - 1)) / 
                                 this.metrics.totalBatches;
    }
    
    // Calculate P99 latency
    if (this.latencyHistory.length >= 10) {
      const sorted = [...this.latencyHistory].sort((a, b) => a - b);
      this.metrics.p99Latency = sorted[Math.floor(sorted.length * 0.99)];
    }
    
    // Adaptive batch size adjustment
    if (this.config.adaptiveEnabled && this.latencyHistory.length >= 20) {
      this.adaptBatchSize();
    }
  }
  
  /**
   * Adapt batch size based on P99 latency
   */
  private adaptBatchSize(): void {
    const currentP99 = this.metrics.p99Latency;
    const target = this.config.targetP99Latency;
    
    if (currentP99 > target * 1.2) {
      // Latency too high, reduce batch size
      this.adaptiveBatchSize = Math.max(
        this.config.minBatchSize,
        Math.floor(this.adaptiveBatchSize * 0.8)
      );
      
      this.logger.info(`Reduced batch size for ${this.name}`, {
        newSize: this.adaptiveBatchSize,
        p99Latency: currentP99
      });
      
    } else if (currentP99 < target * 0.8 && this.metrics.successRate > 0.95) {
      // Latency low and success rate high, increase batch size
      this.adaptiveBatchSize = Math.min(
        this.config.maxBatchSize,
        Math.floor(this.adaptiveBatchSize * 1.2)
      );
      
      this.logger.info(`Increased batch size for ${this.name}`, {
        newSize: this.adaptiveBatchSize,
        p99Latency: currentP99
      });
    }
    
    this.metrics.currentBatchSize = this.adaptiveBatchSize;
  }
  
  /**
   * Get current metrics
   */
  getMetrics(): BatchMetrics {
    return { ...this.metrics };
  }
  
  /**
   * Flush all pending requests
   */
  async flush(): Promise<void> {
    while (this.pendingRequests.length > 0) {
      await this.processBatch();
    }
  }
}

/**
 * Factory for creating exchange-specific batchers
 */
export class ExchangeBatcherFactory {
  private batchers: Map<string, ExchangeBatcher<any, any>> = new Map();
  private logger: winston.Logger;
  
  constructor(logger: winston.Logger) {
    this.logger = logger;
  }
  
  /**
   * Get or create a batcher for an exchange
   */
  getBatcher<TRequest, TResponse>(
    exchange: string,
    processor: (requests: TRequest[]) => Promise<TResponse[]>,
    config?: Partial<BatchConfig>
  ): ExchangeBatcher<TRequest, TResponse> {
    const key = `${exchange}`;
    
    if (!this.batchers.has(key)) {
      const batcher = new ExchangeBatcher(
        exchange,
        this.logger,
        processor,
        config
      );
      this.batchers.set(key, batcher);
    }
    
    return this.batchers.get(key)!;
  }
  
  /**
   * Get metrics for all batchers
   */
  getAllMetrics(): Map<string, BatchMetrics> {
    const metrics = new Map<string, BatchMetrics>();
    
    for (const [name, batcher] of this.batchers) {
      metrics.set(name, batcher.getMetrics());
    }
    
    return metrics;
  }
  
  /**
   * Flush all batchers
   */
  async flushAll(): Promise<void> {
    const flushPromises = Array.from(this.batchers.values()).map(b => b.flush());
    await Promise.all(flushPromises);
  }
}

/**
 * Benchmark for exchange batching
 */
export class ExchangeBatcherBenchmark {
  static async runBenchmark(logger: winston.Logger): Promise<void> {
    console.log('\n🎯 Exchange Batcher Performance Benchmark');
    console.log('Target: -50ms reconciliation time\n');
    
    // Simulate exchange API with variable latency
    const simulateExchangeAPI = async (requests: any[]): Promise<any[]> => {
      const baseLatency = 20; // 20ms base latency
      const perRequestLatency = 2; // 2ms per request
      const totalLatency = baseLatency + (requests.length * perRequestLatency);
      
      await new Promise(resolve => setTimeout(resolve, totalLatency));
      
      return requests.map(req => ({
        ...req,
        response: `processed-${req.id}`
      }));
    };
    
    // Test without batching
    console.log('📊 Without batching (sequential calls):');
    const withoutBatchingStart = Date.now();
    const sequentialPromises = [];
    
    for (let i = 0; i < 100; i++) {
      sequentialPromises.push(simulateExchangeAPI([{ id: i }]));
    }
    
    await Promise.all(sequentialPromises);
    const withoutBatchingTime = Date.now() - withoutBatchingStart;
    
    // Test with batching
    console.log('\n📊 With adaptive batching:');
    const batcher = new ExchangeBatcher(
      'benchmark',
      logger,
      simulateExchangeAPI,
      {
        minBatchSize: 5,
        maxBatchSize: 20,
        maxWaitTime: 10,
        targetP99Latency: 50
      }
    );
    
    const withBatchingStart = Date.now();
    const batchedPromises = [];
    
    for (let i = 0; i < 100; i++) {
      batchedPromises.push(batcher.addRequest({ id: i }));
    }
    
    await Promise.all(batchedPromises);
    const withBatchingTime = Date.now() - withBatchingStart;
    
    // Results
    console.log('\nResults:');
    console.log(`  Without batching: ${withoutBatchingTime}ms`);
    console.log(`  With batching: ${withBatchingTime}ms`);
    console.log(`  Improvement: ${withoutBatchingTime - withBatchingTime}ms (${((withoutBatchingTime - withBatchingTime) / withoutBatchingTime * 100).toFixed(1)}%)`);
    
    console.log('\nBatcher metrics:');
    const metrics = batcher.getMetrics();
    console.log(`  Total batches: ${metrics.totalBatches}`);
    console.log(`  Avg batch size: ${metrics.avgBatchSize.toFixed(1)}`);
    console.log(`  P99 latency: ${metrics.p99Latency.toFixed(1)}ms`);
    console.log(`  Final batch size: ${metrics.currentBatchSize}`);
    
    if (withoutBatchingTime - withBatchingTime >= 50) {
      console.log('\n✅ SUCCESS: Achieved target -50ms improvement!');
    } else {
      console.log('\n⚠️  WARNING: Improvement below target');
    }
  }
}

// Run benchmark if executed directly
if (require.main === module) {
  const logger = winston.createLogger({
    level: 'info',
    format: winston.format.simple(),
    transports: [new winston.transports.Console()]
  });
  
  ExchangeBatcherBenchmark.runBenchmark(logger).catch(console.error);
} 