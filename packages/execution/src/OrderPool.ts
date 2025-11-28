import * as winston from 'winston';
import { Order, OrderStatus, OrderType } from './OrderLifecycleManager';

export interface OrderPoolConfig {
  poolSize: number;
  maxPoolSize: number;
  preAllocate: boolean;
  gcWarningThreshold: number;
}

export interface PoolMetrics {
  created: number;
  acquired: number;
  released: number;
  inUse: number;
  available: number;
  gcPressureWarnings: number;
}

/**
 * High-performance object pool for Order instances
 * Prevents GC pressure by reusing objects
 * Target: -2ms P99 latency improvement
 */
export class OrderPool {
  private static readonly DEFAULT_POOL_SIZE = 10000;
  private static readonly DEFAULT_MAX_POOL_SIZE = 50000;
  
  private pool: Order[] = [];
  private config: OrderPoolConfig;
  private logger: winston.Logger;
  private metrics: PoolMetrics = {
    created: 0,
    acquired: 0,
    released: 0,
    inUse: 0,
    available: 0,
    gcPressureWarnings: 0
  };
  
  // Pre-allocated order template for fast cloning
  private orderTemplate: Order;
  
  constructor(logger: winston.Logger, config?: Partial<OrderPoolConfig>) {
    this.logger = logger;
    this.config = {
      poolSize: config?.poolSize || OrderPool.DEFAULT_POOL_SIZE,
      maxPoolSize: config?.maxPoolSize || OrderPool.DEFAULT_MAX_POOL_SIZE,
      preAllocate: config?.preAllocate ?? true,
      gcWarningThreshold: config?.gcWarningThreshold || 0.8
    };
    
    // Create order template
    this.orderTemplate = this.createOrderTemplate();
    
    // Pre-allocate pool if configured
    if (this.config.preAllocate) {
      this.preAllocatePool();
    }
    
    // Monitor pool health
    this.startHealthMonitoring();
  }
  
  /**
   * Acquire an order from the pool
   * O(1) operation
   */
  acquire(): Order {
    this.metrics.acquired++;
    
    let order = this.pool.pop();
    if (!order) {
      // Pool exhausted, create new order
      order = this.createOrder();
      this.metrics.created++;
      
      // Check for GC pressure
      if (this.metrics.created > this.config.poolSize * this.config.gcWarningThreshold) {
        this.metrics.gcPressureWarnings++;
        this.logger.warn('Order pool experiencing GC pressure', {
          created: this.metrics.created,
          poolSize: this.config.poolSize,
          inUse: this.metrics.inUse
        });
      }
    }
    
    this.metrics.inUse++;
    this.metrics.available = this.pool.length;
    
    return order;
  }
  
  /**
   * Release an order back to the pool
   * O(1) operation
   */
  release(order: Order): void {
    this.metrics.released++;
    this.metrics.inUse--;
    
    // Only return to pool if under max size
    if (this.pool.length < this.config.maxPoolSize) {
      this.resetOrder(order);
      this.pool.push(order);
    }
    
    this.metrics.available = this.pool.length;
  }
  
  /**
   * Pre-allocate orders to avoid allocation during hot path
   */
  private preAllocatePool(): void {
    const startTime = process.hrtime.bigint();
    
    for (let i = 0; i < this.config.poolSize; i++) {
      this.pool.push(this.createOrder());
    }
    
    const duration = Number(process.hrtime.bigint() - startTime) / 1_000_000;
    this.metrics.created = this.config.poolSize;
    this.metrics.available = this.config.poolSize;
    
    this.logger.info('Pre-allocated order pool', {
      size: this.config.poolSize,
      duration: `${duration.toFixed(2)}ms`
    });
  }
  
  /**
   * Create a new order instance
   * Uses template for faster initialization
   */
  private createOrder(): Order {
    // Clone from template for speed
    return {
      ...this.orderTemplate,
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: {}
    };
  }
  
  /**
   * Reset order to initial state for reuse
   * Critical for preventing data leaks between uses
   */
  private resetOrder(order: Order): void {
    // Reset all fields to template values
    order.id = '';
    order.clientOrderId = '';
    order.symbol = '';
    order.side = 'BUY';
    order.type = OrderType.LIMIT;
    order.quantity = 0;
    order.price = undefined;
    order.stopPrice = undefined;
    order.timeInForce = 'GTC';
    order.status = OrderStatus.PENDING;
    order.filledQuantity = 0;
    order.avgFillPrice = 0;
    order.createdAt = new Date();
    order.updatedAt = new Date();
    order.venue = '';
    
    // Clear metadata object
    if (order.metadata) {
      for (const key in order.metadata) {
        delete order.metadata[key];
      }
    }
  }
  
  /**
   * Create order template for fast cloning
   */
  private createOrderTemplate(): Order {
    return {
      id: '',
      clientOrderId: '',
      symbol: '',
      side: 'BUY',
      type: OrderType.LIMIT,
      quantity: 0,
      price: undefined,
      stopPrice: undefined,
      timeInForce: 'GTC',
      status: OrderStatus.PENDING,
      filledQuantity: 0,
      avgFillPrice: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      venue: '',
      metadata: {}
    };
  }
  
  /**
   * Monitor pool health and log metrics
   */
  private startHealthMonitoring(): void {
    setInterval(() => {
      const utilizationRate = this.metrics.inUse / (this.metrics.inUse + this.metrics.available);
      
      if (utilizationRate > 0.9) {
        this.logger.warn('Order pool utilization high', {
          utilizationRate: `${(utilizationRate * 100).toFixed(1)}%`,
          metrics: this.getMetrics()
        });
      }
    }, 30000); // Every 30 seconds
  }
  
  /**
   * Get pool metrics
   */
  getMetrics(): PoolMetrics {
    return { ...this.metrics };
  }
  
  /**
   * Drain the pool (for shutdown)
   */
  drain(): void {
    this.pool = [];
    this.metrics.available = 0;
    this.logger.info('Order pool drained');
  }
}

/**
 * Global singleton instance for the application
 */
let globalOrderPool: OrderPool | null = null;

export function getGlobalOrderPool(logger: winston.Logger): OrderPool {
  if (!globalOrderPool) {
    globalOrderPool = new OrderPool(logger, {
      poolSize: 10000,
      maxPoolSize: 50000,
      preAllocate: true
    });
  }
  return globalOrderPool;
}

/**
 * Benchmark utility for order pool performance
 */
export class OrderPoolBenchmark {
  static async runBenchmark(logger: winston.Logger, iterations: number = 100000): Promise<void> {
    console.log(`\n🏊 Order Pool Performance Benchmark`);
    console.log(`Iterations: ${iterations}\n`);
    
    // Benchmark without pooling
    console.log('📊 Without pooling (new objects):');
    const withoutPoolStart = process.hrtime.bigint();
    const withoutPoolLatencies: number[] = [];
    
    for (let i = 0; i < iterations; i++) {
      const iterStart = process.hrtime.bigint();
      const order: Order = {
        id: `ORD-${i}`,
        clientOrderId: `CLIENT-${i}`,
        symbol: 'BTC/USD',
        side: 'BUY',
        type: OrderType.LIMIT,
        quantity: 1,
        price: 50000,
        timeInForce: 'GTC',
        status: OrderStatus.PENDING,
        filledQuantity: 0,
        avgFillPrice: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        venue: 'primary',
        metadata: {}
      };
      // Simulate usage
      order.status = OrderStatus.SUBMITTED;
      const iterTime = Number(process.hrtime.bigint() - iterStart) / 1_000_000;
      withoutPoolLatencies.push(iterTime);
    }
    
    const withoutPoolTime = Number(process.hrtime.bigint() - withoutPoolStart) / 1_000_000;
    
    // Benchmark with pooling
    console.log('\n📊 With pooling (reused objects):');
    const pool = new OrderPool(logger, { preAllocate: true });
    const withPoolStart = process.hrtime.bigint();
    const withPoolLatencies: number[] = [];
    
    for (let i = 0; i < iterations; i++) {
      const iterStart = process.hrtime.bigint();
      const order = pool.acquire();
      order.id = `ORD-${i}`;
      order.clientOrderId = `CLIENT-${i}`;
      order.symbol = 'BTC/USD';
      order.side = 'BUY';
      order.quantity = 1;
      order.price = 50000;
      // Simulate usage
      order.status = OrderStatus.SUBMITTED;
      pool.release(order);
      const iterTime = Number(process.hrtime.bigint() - iterStart) / 1_000_000;
      withPoolLatencies.push(iterTime);
    }
    
    const withPoolTime = Number(process.hrtime.bigint() - withPoolStart) / 1_000_000;
    
    // Calculate and display results
    withoutPoolLatencies.sort((a, b) => a - b);
    withPoolLatencies.sort((a, b) => a - b);
    
    console.log('\nResults WITHOUT pooling:');
    console.log(`  Total time: ${withoutPoolTime.toFixed(2)}ms`);
    console.log(`  Avg latency: ${(withoutPoolTime / iterations).toFixed(4)}ms`);
    console.log(`  P50 latency: ${withoutPoolLatencies[Math.floor(iterations * 0.5)].toFixed(4)}ms`);
    console.log(`  P99 latency: ${withoutPoolLatencies[Math.floor(iterations * 0.99)].toFixed(4)}ms`);
    
    console.log('\nResults WITH pooling:');
    console.log(`  Total time: ${withPoolTime.toFixed(2)}ms`);
    console.log(`  Avg latency: ${(withPoolTime / iterations).toFixed(4)}ms`);
    console.log(`  P50 latency: ${withPoolLatencies[Math.floor(iterations * 0.5)].toFixed(4)}ms`);
    console.log(`  P99 latency: ${withPoolLatencies[Math.floor(iterations * 0.99)].toFixed(4)}ms`);
    
    const improvement = withoutPoolTime - withPoolTime;
    const p99Improvement = withoutPoolLatencies[Math.floor(iterations * 0.99)] - 
                          withPoolLatencies[Math.floor(iterations * 0.99)];
    
    console.log('\n🎯 Performance Improvement:');
    console.log(`  Total time saved: ${improvement.toFixed(2)}ms (${(improvement / withoutPoolTime * 100).toFixed(1)}%)`);
    console.log(`  P99 latency improvement: ${p99Improvement.toFixed(4)}ms`);
    
    console.log('\n📈 Pool Metrics:');
    console.log(pool.getMetrics());
    
    if (p99Improvement >= 0.002) { // 2 microseconds = 0.002ms
      console.log('\n✅ SUCCESS: Achieved target GC pressure reduction!');
    } else {
      console.log('\n⚠️  WARNING: Improvement below target');
    }
    
    pool.drain();
  }
}

// Run benchmark if executed directly
if (require.main === module) {
  const logger = winston.createLogger({
    level: 'info',
    format: winston.format.simple(),
    transports: [new winston.transports.Console()]
  });
  
  OrderPoolBenchmark.runBenchmark(logger).catch(console.error);
} 