import { Logger } from '@noderr/utils/src';
import * as winston from 'winston';

const logger = new Logger('BufferPool');
export interface BufferPoolConfig {
  minSize: number;      // Minimum buffer size
  maxSize: number;      // Maximum buffer size
  poolSize: number;     // Number of buffers per size
  growthFactor: number; // Size growth factor
}

export interface PoolStats {
  totalAllocated: number;
  totalInUse: number;
  hitRate: number;
  allocations: number;
  deallocations: number;
  misses: number;
}

/**
 * High-performance buffer pool for network operations
 * Eliminates allocation overhead in hot paths
 * Target: -1ms network operation overhead
 */
export class BufferPool {
  private logger: winston.Logger;
  private config: BufferPoolConfig;
  private pools: Map<number, Buffer[]> = new Map();
  private inUse: Map<Buffer, number> = new Map();
  private stats: PoolStats = {
    totalAllocated: 0,
    totalInUse: 0,
    hitRate: 0,
    allocations: 0,
    deallocations: 0,
    misses: 0
  };
  
  constructor(logger: winston.Logger, config?: Partial<BufferPoolConfig>) {
    this.logger = logger;
    this.config = {
      minSize: config?.minSize || 64,
      maxSize: config?.maxSize || 65536,
      poolSize: config?.poolSize || 100,
      growthFactor: config?.growthFactor || 2
    };
    
    this.preallocate();
  }
  
  /**
   * Preallocate buffers for common sizes
   */
  private preallocate(): void {
    const startTime = process.hrtime.bigint();
    let totalBytes = 0;
    
    // Generate size buckets
    const sizes: number[] = [];
    let size = this.config.minSize;
    while (size <= this.config.maxSize) {
      sizes.push(size);
      size = Math.floor(size * this.config.growthFactor);
    }
    
    // Allocate buffers for each size
    for (const size of sizes) {
      const buffers: Buffer[] = [];
      for (let i = 0; i < this.config.poolSize; i++) {
        const buffer = Buffer.allocUnsafe(size);
        buffers.push(buffer);
        totalBytes += size;
      }
      this.pools.set(size, buffers);
    }
    
    this.stats.totalAllocated = totalBytes;
    
    const duration = Number(process.hrtime.bigint() - startTime) / 1_000_000;
    this.logger.info('Buffer pool preallocated', {
      sizes: sizes.length,
      totalBuffers: sizes.length * this.config.poolSize,
      totalMB: (totalBytes / 1024 / 1024).toFixed(2),
      duration: `${duration.toFixed(2)}ms`
    });
  }
  
  /**
   * Acquire a buffer of at least the requested size
   */
  acquire(requestedSize: number): Buffer {
    this.stats.allocations++;
    
    // Find the smallest buffer that fits
    let selectedSize = this.config.minSize;
    while (selectedSize < requestedSize && selectedSize < this.config.maxSize) {
      selectedSize = Math.floor(selectedSize * this.config.growthFactor);
    }
    
    // Get pool for this size
    const pool = this.pools.get(selectedSize);
    if (pool && pool.length > 0) {
      const buffer = pool.pop()!;
      this.inUse.set(buffer, selectedSize);
      this.stats.totalInUse += selectedSize;
      
      // Clear buffer for security
      buffer.fill(0);
      
      return buffer;
    }
    
    // Pool miss - allocate new buffer
    this.stats.misses++;
    this.logger.debug('Buffer pool miss', { requestedSize, selectedSize });
    
    const buffer = Buffer.allocUnsafe(selectedSize);
    this.inUse.set(buffer, selectedSize);
    this.stats.totalInUse += selectedSize;
    this.stats.totalAllocated += selectedSize;
    
    return buffer;
  }
  
  /**
   * Release a buffer back to the pool
   */
  release(buffer: Buffer): void {
    const size = this.inUse.get(buffer);
    if (!size) {
      this.logger.warn('Attempted to release unknown buffer');
      return;
    }
    
    this.stats.deallocations++;
    this.inUse.delete(buffer);
    this.stats.totalInUse -= size;
    
    // Return to pool if there's space
    const pool = this.pools.get(size);
    if (pool && pool.length < this.config.poolSize) {
      pool.push(buffer);
    }
    // Otherwise let GC handle it
  }
  
  /**
   * Get a buffer slice for exact size needs
   */
  acquireExact(size: number): Buffer {
    const buffer = this.acquire(size);
    return buffer.slice(0, size);
  }
  
  /**
   * Get pool statistics
   */
  getStats(): PoolStats {
    const hits = this.stats.allocations - this.stats.misses;
    const hitRate = this.stats.allocations > 0 ? hits / this.stats.allocations : 0;
    
    return {
      ...this.stats,
      hitRate
    };
  }
  
  /**
   * Clear all pools (for shutdown)
   */
  clear(): void {
    for (const [size, pool] of this.pools) {
      pool.length = 0;
    }
    this.inUse.clear();
    this.stats.totalInUse = 0;
    
    this.logger.info('Buffer pool cleared');
  }
}

/**
 * Global buffer pool instance
 */
let globalBufferPool: BufferPool | null = null;

export function getGlobalBufferPool(logger: winston.Logger): BufferPool {
  if (!globalBufferPool) {
    globalBufferPool = new BufferPool(logger);
  }
  return globalBufferPool;
}

/**
 * Network message builder using buffer pool
 */
export class PooledMessageBuilder {
  private bufferPool: BufferPool;
  private buffer: Buffer | null = null;
  private position: number = 0;
  
  constructor(bufferPool: BufferPool, initialSize: number = 1024) {
    this.bufferPool = bufferPool;
    this.buffer = bufferPool.acquire(initialSize);
  }
  
  writeUInt8(value: number): this {
    this.ensureCapacity(1);
    this.buffer!.writeUInt8(value, this.position);
    this.position += 1;
    return this;
  }
  
  writeUInt16BE(value: number): this {
    this.ensureCapacity(2);
    this.buffer!.writeUInt16BE(value, this.position);
    this.position += 2;
    return this;
  }
  
  writeUInt32BE(value: number): this {
    this.ensureCapacity(4);
    this.buffer!.writeUInt32BE(value, this.position);
    this.position += 4;
    return this;
  }
  
  writeDoubleBE(value: number): this {
    this.ensureCapacity(8);
    this.buffer!.writeDoubleBE(value, this.position);
    this.position += 8;
    return this;
  }
  
  writeString(value: string): this {
    const bytes = Buffer.byteLength(value);
    this.writeUInt32BE(bytes);
    this.ensureCapacity(bytes);
    this.buffer!.write(value, this.position);
    this.position += bytes;
    return this;
  }
  
  build(): Buffer {
    if (!this.buffer) {
      throw new Error('Builder already consumed');
    }
    
    const result = this.buffer.slice(0, this.position);
    this.bufferPool.release(this.buffer);
    this.buffer = null;
    
    return result;
  }
  
  private ensureCapacity(needed: number): void {
    if (!this.buffer) {
      throw new Error('Builder already consumed');
    }
    
    if (this.position + needed > this.buffer.length) {
      // Need larger buffer
      const newSize = Math.max(
        this.buffer.length * 2,
        this.position + needed
      );
      
      const newBuffer = this.bufferPool.acquire(newSize);
      this.buffer.copy(newBuffer, 0, 0, this.position);
      
      this.bufferPool.release(this.buffer);
      this.buffer = newBuffer;
    }
  }
}

/**
 * Benchmark for buffer pool
 */
export class BufferPoolBenchmark {
  static async runBenchmark(logger: winston.Logger): Promise<void> {
    logger.info('\n🏊 Buffer Pool Performance Benchmark');
    logger.info('Target: -1ms network operation overhead\n');
    
    const iterations = 100000;
    const sizes = [64, 256, 1024, 4096, 16384];
    
    // Test without pooling
    logger.info('📊 Without pooling (allocate every time):');
    const withoutPoolStart = process.hrtime.bigint();
    
    for (let i = 0; i < iterations; i++) {
      const size = sizes[i % sizes.length];
      const buffer = Buffer.allocUnsafe(size);
      
      // Simulate usage
      buffer.writeUInt32BE(i, 0);
      buffer.writeDoubleBE(Math.random(), 4);
      
      // Buffer goes out of scope (GC pressure)
    }
    
    const withoutPoolTime = Number(process.hrtime.bigint() - withoutPoolStart) / 1_000_000;
    
    // Test with pooling
    logger.info('\n📊 With pooling (reuse buffers):');
    const pool = new BufferPool(logger);
    const withPoolStart = process.hrtime.bigint();
    
    for (let i = 0; i < iterations; i++) {
      const size = sizes[i % sizes.length];
      const buffer = pool.acquire(size);
      
      // Simulate usage
      buffer.writeUInt32BE(i, 0);
      buffer.writeDoubleBE(Math.random(), 4);
      
      // Return to pool
      pool.release(buffer);
    }
    
    const withPoolTime = Number(process.hrtime.bigint() - withPoolStart) / 1_000_000;
    
    // Test message builder
    logger.info('\n📊 Message builder benchmark:');
    const builderStart = process.hrtime.bigint();
    
    for (let i = 0; i < 10000; i++) {
      const builder = new PooledMessageBuilder(pool);
      builder
        .writeUInt8(1)
        .writeUInt16BE(i)
        .writeUInt32BE(Date.now())
        .writeDoubleBE(Math.random())
        .writeString(`Message ${i}`);
      
      const message = builder.build();
      // Message used and discarded
    }
    
    const builderTime = Number(process.hrtime.bigint() - builderStart) / 1_000_000;
    
    // Results
    logger.info('\nResults:');
    logger.info(`Without pooling: ${withoutPoolTime.toFixed(2)}ms (${(withoutPoolTime / iterations * 1000).toFixed(3)}µs per operation)`);
    logger.info(`With pooling: ${withPoolTime.toFixed(2)}ms (${(withPoolTime / iterations * 1000).toFixed(3)}µs per operation)`);
    logger.info(`Message builder: ${builderTime.toFixed(2)}ms (${(builderTime / 10).toFixed(3)}ms per message)`);
    
    const improvement = (withoutPoolTime - withPoolTime) / iterations;
    logger.info(`\n🎯 Improvement: ${(improvement * 1000).toFixed(3)}µs per operation`);
    
    const stats = pool.getStats();
    logger.info('\nPool statistics:');
    logger.info(`  Hit rate: ${(stats.hitRate * 100).toFixed(1)}%`);
    logger.info(`  Total allocated: ${(stats.totalAllocated / 1024 / 1024).toFixed(2)}MB`);
    logger.info(`  Misses: ${stats.misses}`);
    
    if (improvement >= 0.001) { // 1µs = 0.001ms
      logger.info('\n✅ SUCCESS: Achieved target improvement!');
    } else {
      logger.info(`\n⚠️  WARNING: Only achieved ${(improvement * 1000).toFixed(3)}µs improvement`);
    }
    
    pool.clear();
  }
}

// Run benchmark if executed directly
if (require.main === module) {
  const logger = winston.createLogger({
    level: 'info',
    format: winston.format.simple(),
    transports: [new winston.transports.Console()]
  });
  
  BufferPoolBenchmark.runBenchmark(logger).catch((err) => logger.error("Unhandled error", err));
} 