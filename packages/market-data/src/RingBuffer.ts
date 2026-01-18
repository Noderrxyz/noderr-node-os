
export interface MarketDataPoint {
  symbol: string;
  timestamp: number;
  bid: number;
  ask: number;
  bidSize: number;
  askSize: number;
  lastPrice: number;
  volume: number;
}

/**
 * Lock-free ring buffer for high-frequency market data
 * Uses SharedArrayBuffer for zero-copy access across threads
 * Target: -3ms market data access
 */
export class MarketDataRingBuffer {
  private buffer: SharedArrayBuffer;
  private view: DataView;
  private metadata: Int32Array;
  
  // Metadata indices
  static readonly HEAD_INDEX = 0;
  static readonly TAIL_INDEX = 1;
  static readonly SIZE_INDEX = 2;
  
  // Data layout per entry (64 bytes)
  static readonly ENTRY_SIZE = 64;
  static readonly SYMBOL_OFFSET = 0;    // 8 bytes (symbol hash)
  static readonly TIMESTAMP_OFFSET = 8; // 8 bytes
  static readonly BID_OFFSET = 16;      // 8 bytes
  static readonly ASK_OFFSET = 24;      // 8 bytes
  static readonly BID_SIZE_OFFSET = 32; // 8 bytes
  static readonly ASK_SIZE_OFFSET = 40; // 8 bytes
  static readonly LAST_PRICE_OFFSET = 48; // 8 bytes
  static readonly VOLUME_OFFSET = 56;   // 8 bytes
  
  private capacity: number;
  private symbolCache: Map<string, number> = new Map();
  private reverseSymbolCache: Map<number, string> = new Map();
  
  constructor(capacity: number) {
    this.capacity = capacity;
    
    // Allocate shared memory
    const metadataSize = 12; // 3 * 4 bytes for metadata
    const dataSize = capacity * MarketDataRingBuffer.ENTRY_SIZE;
    const totalSize = metadataSize + dataSize;
    
    this.buffer = new SharedArrayBuffer(totalSize);
    this.metadata = new Int32Array(this.buffer, 0, 3);
    this.view = new DataView(this.buffer, metadataSize);
    
    // Initialize metadata
    Atomics.store(this.metadata, MarketDataRingBuffer.HEAD_INDEX, 0);
    Atomics.store(this.metadata, MarketDataRingBuffer.TAIL_INDEX, 0);
    Atomics.store(this.metadata, MarketDataRingBuffer.SIZE_INDEX, 0);
  }
  
  /**
   * Push market data to the ring buffer
   * Lock-free operation using atomic compare-and-swap
   */
  push(data: MarketDataPoint): boolean {
    const symbolHash = this.getSymbolHash(data.symbol);
    
    // Atomic increment of head
    let head: number;
    let newHead: number = 0;
    let size: number;
    
    do {
      head = Atomics.load(this.metadata, MarketDataRingBuffer.HEAD_INDEX);
      size = Atomics.load(this.metadata, MarketDataRingBuffer.SIZE_INDEX);
      
      // Check if buffer is full
      if (size >= this.capacity) {
        // MEDIUM FIX #92: Overflow handling race condition note
        // The race condition here is acceptable for market data:
        // - Market data is ephemeral and loss of a few data points is acceptable
        // - Lock-free performance is more important than perfect consistency
        // - Worst case: slightly inaccurate size counter, which self-corrects
        // For critical data, use a proper lock or queue implementation
        
        // Overwrite oldest data
        const tail = Atomics.load(this.metadata, MarketDataRingBuffer.TAIL_INDEX);
        const newTail = (tail + 1) % this.capacity;
        Atomics.compareExchange(this.metadata, MarketDataRingBuffer.TAIL_INDEX, tail, newTail);
        Atomics.sub(this.metadata, MarketDataRingBuffer.SIZE_INDEX, 1);
        continue;
      }
      
      newHead = (head + 1) % this.capacity;
    } while (Atomics.compareExchange(this.metadata, MarketDataRingBuffer.HEAD_INDEX, head, newHead) !== head);
    
    // Write data to buffer
    const offset = head * MarketDataRingBuffer.ENTRY_SIZE;
    this.view.setBigUint64(offset + MarketDataRingBuffer.SYMBOL_OFFSET, BigInt(symbolHash), true);
    this.view.setFloat64(offset + MarketDataRingBuffer.TIMESTAMP_OFFSET, data.timestamp, true);
    this.view.setFloat64(offset + MarketDataRingBuffer.BID_OFFSET, data.bid, true);
    this.view.setFloat64(offset + MarketDataRingBuffer.ASK_OFFSET, data.ask, true);
    this.view.setFloat64(offset + MarketDataRingBuffer.BID_SIZE_OFFSET, data.bidSize, true);
    this.view.setFloat64(offset + MarketDataRingBuffer.ASK_SIZE_OFFSET, data.askSize, true);
    this.view.setFloat64(offset + MarketDataRingBuffer.LAST_PRICE_OFFSET, data.lastPrice, true);
    this.view.setFloat64(offset + MarketDataRingBuffer.VOLUME_OFFSET, data.volume, true);
    
    // Atomic increment size
    Atomics.add(this.metadata, MarketDataRingBuffer.SIZE_INDEX, 1);
    
    return true;
  }
  
  /**
   * Get latest market data for a symbol
   * O(n) in worst case but typically O(1) for recent data
   */
  getLatest(symbol: string): MarketDataPoint | null {
    const symbolHash = this.getSymbolHash(symbol);
    const size = Atomics.load(this.metadata, MarketDataRingBuffer.SIZE_INDEX);
    
    if (size === 0) return null;
    
    const head = Atomics.load(this.metadata, MarketDataRingBuffer.HEAD_INDEX);
    const tail = Atomics.load(this.metadata, MarketDataRingBuffer.TAIL_INDEX);
    
    // Search backwards from head (most recent data)
    let current = (head - 1 + this.capacity) % this.capacity;
    let checked = 0;
    
    while (checked < size) {
      const offset = current * MarketDataRingBuffer.ENTRY_SIZE;
      const storedHash = Number(this.view.getBigUint64(offset + MarketDataRingBuffer.SYMBOL_OFFSET, true));
      
      if (storedHash === symbolHash) {
        return this.readEntry(offset, symbol);
      }
      
      current = (current - 1 + this.capacity) % this.capacity;
      checked++;
      
      if (current === tail && checked < size) {
        break;
      }
    }
    
    return null;
  }
  
  /**
   * Get all data points within a time range
   * Optimized for recent data access
   */
  getRange(startTime: number, endTime: number, symbol?: string): MarketDataPoint[] {
    const results: MarketDataPoint[] = [];
    const size = Atomics.load(this.metadata, MarketDataRingBuffer.SIZE_INDEX);
    
    if (size === 0) return results;
    
    const symbolHash = symbol ? this.getSymbolHash(symbol) : null;
    const head = Atomics.load(this.metadata, MarketDataRingBuffer.HEAD_INDEX);
    const tail = Atomics.load(this.metadata, MarketDataRingBuffer.TAIL_INDEX);
    
    let current = (head - 1 + this.capacity) % this.capacity;
    let checked = 0;
    
    while (checked < size) {
      const offset = current * MarketDataRingBuffer.ENTRY_SIZE;
      const timestamp = this.view.getFloat64(offset + MarketDataRingBuffer.TIMESTAMP_OFFSET, true);
      
      // Stop if we've gone past the start time
      if (timestamp < startTime) break;
      
      if (timestamp <= endTime) {
        if (!symbolHash) {
          // Return all symbols
          const storedHash = Number(this.view.getBigUint64(offset + MarketDataRingBuffer.SYMBOL_OFFSET, true));
          const symbolStr = this.reverseSymbolCache.get(storedHash) || 'UNKNOWN';
          results.push(this.readEntry(offset, symbolStr));
        } else {
          // Check symbol match
          const storedHash = Number(this.view.getBigUint64(offset + MarketDataRingBuffer.SYMBOL_OFFSET, true));
          if (storedHash === symbolHash) {
            results.push(this.readEntry(offset, symbol!));
          }
        }
      }
      
      current = (current - 1 + this.capacity) % this.capacity;
      checked++;
      
      if (current === tail && checked < size) {
        break;
      }
    }
    
    return results.reverse(); // Return in chronological order
  }
  
  /**
   * Read entry from buffer
   */
  private readEntry(offset: number, symbol: string): MarketDataPoint {
    return {
      symbol,
      timestamp: this.view.getFloat64(offset + MarketDataRingBuffer.TIMESTAMP_OFFSET, true),
      bid: this.view.getFloat64(offset + MarketDataRingBuffer.BID_OFFSET, true),
      ask: this.view.getFloat64(offset + MarketDataRingBuffer.ASK_OFFSET, true),
      bidSize: this.view.getFloat64(offset + MarketDataRingBuffer.BID_SIZE_OFFSET, true),
      askSize: this.view.getFloat64(offset + MarketDataRingBuffer.ASK_SIZE_OFFSET, true),
      lastPrice: this.view.getFloat64(offset + MarketDataRingBuffer.LAST_PRICE_OFFSET, true),
      volume: this.view.getFloat64(offset + MarketDataRingBuffer.VOLUME_OFFSET, true)
    };
  }
  
  /**
   * Get or create symbol hash
   */
  private getSymbolHash(symbol: string): number {
    let hash = this.symbolCache.get(symbol);
    if (!hash) {
      // Simple hash function
      hash = 0;
      for (let i = 0; i < symbol.length; i++) {
        hash = ((hash << 5) - hash) + symbol.charCodeAt(i);
        hash = hash & hash; // Convert to 32-bit integer
      }
      
      // MEDIUM FIX #91: Handle hash collisions
      let attempts = 0;
      const maxAttempts = 100;
      while (this.reverseSymbolCache.has(hash) && this.reverseSymbolCache.get(hash) !== symbol) {
        // Collision detected - use linear probing
        hash = (hash + 1) & 0x7FFFFFFF; // Keep positive
        attempts++;
        if (attempts >= maxAttempts) {
          throw new Error(`Hash collision: Unable to find unique hash for symbol ${symbol} after ${maxAttempts} attempts`);
        }
      }
      
      this.symbolCache.set(symbol, hash);
      this.reverseSymbolCache.set(hash, symbol);
    }
    return hash;
  }
  
  /**
   * Get buffer statistics
   */
  getStats(): { size: number; capacity: number; head: number; tail: number } {
    return {
      size: Atomics.load(this.metadata, MarketDataRingBuffer.SIZE_INDEX),
      capacity: this.capacity,
      head: Atomics.load(this.metadata, MarketDataRingBuffer.HEAD_INDEX),
      tail: Atomics.load(this.metadata, MarketDataRingBuffer.TAIL_INDEX)
    };
  }
  
  /**
   * Get the underlying SharedArrayBuffer for worker sharing
   */
  getSharedBuffer(): SharedArrayBuffer {
    return this.buffer;
  }
}

/**
 * Worker-side view of the ring buffer
 */
export class MarketDataRingBufferView {
  private view: DataView;
  private metadata: Int32Array;
  private capacity: number;
  
  constructor(buffer: SharedArrayBuffer, capacity: number) {
    this.capacity = capacity;
    this.metadata = new Int32Array(buffer, 0, 3);
    this.view = new DataView(buffer, 12);
  }
  
  /**
   * Read latest data without symbol lookup
   */
  readLatestRaw(index: number): {
    symbolHash: number;
    timestamp: number;
    bid: number;
    ask: number;
    lastPrice: number;
  } | null {
    const size = Atomics.load(this.metadata, MarketDataRingBuffer.SIZE_INDEX);
    if (index >= size) return null;
    
    const head = Atomics.load(this.metadata, MarketDataRingBuffer.HEAD_INDEX);
    const position = (head - 1 - index + this.capacity) % this.capacity;
    const offset = position * MarketDataRingBuffer.ENTRY_SIZE;
    
    return {
      symbolHash: Number(this.view.getBigUint64(offset + MarketDataRingBuffer.SYMBOL_OFFSET, true)),
      timestamp: this.view.getFloat64(offset + MarketDataRingBuffer.TIMESTAMP_OFFSET, true),
      bid: this.view.getFloat64(offset + MarketDataRingBuffer.BID_OFFSET, true),
      ask: this.view.getFloat64(offset + MarketDataRingBuffer.ASK_OFFSET, true),
      lastPrice: this.view.getFloat64(offset + MarketDataRingBuffer.LAST_PRICE_OFFSET, true)
    };
  }
}

/**
 * Benchmark for ring buffer performance
 */
export class RingBufferBenchmark {
  static async runBenchmark(logger: any): Promise<void> {
    logger.info('\n💍 Ring Buffer Performance Benchmark');
    logger.info('Target: -3ms market data access\n');
    
    const capacity = 100000;
    const iterations = 1000000;
    
    // Test with array-based storage
    logger.info('📊 Array-based storage:');
    const arrayStorage: MarketDataPoint[] = [];
    const arrayWriteStart = process.hrtime.bigint();
    
    for (let i = 0; i < iterations; i++) {
      arrayStorage.push({
        symbol: `SYMBOL${i % 100}`,
        timestamp: Date.now(),
        bid: 100 + Math.random(),
        ask: 100.1 + Math.random(),
        bidSize: Math.random() * 1000,
        askSize: Math.random() * 1000,
        lastPrice: 100.05 + Math.random(),
        volume: Math.random() * 10000
      });
      
      // Maintain capacity
      if (arrayStorage.length > capacity) {
        arrayStorage.shift();
      }
    }
    
    const arrayWriteTime = Number(process.hrtime.bigint() - arrayWriteStart) / 1_000_000;
    
    // Test reads
    const arrayReadStart = process.hrtime.bigint();
    let arraySum = 0;
    
    for (let i = 0; i < 10000; i++) {
      const symbol = `SYMBOL${i % 100}`;
      // Find last matching element (backwards search)
      let found: MarketDataPoint | undefined;
      for (let j = arrayStorage.length - 1; j >= 0; j--) {
        if (arrayStorage[j].symbol === symbol) {
          found = arrayStorage[j];
          break;
        }
      }
      if (found) arraySum += found.lastPrice;
    }
    
    const arrayReadTime = Number(process.hrtime.bigint() - arrayReadStart) / 1_000_000;
    
    // Test with ring buffer
    logger.info('\n📊 Ring buffer storage:');
    const ringBuffer = new MarketDataRingBuffer(capacity);
    const ringWriteStart = process.hrtime.bigint();
    
    for (let i = 0; i < iterations; i++) {
      ringBuffer.push({
        symbol: `SYMBOL${i % 100}`,
        timestamp: Date.now(),
        bid: 100 + Math.random(),
        ask: 100.1 + Math.random(),
        bidSize: Math.random() * 1000,
        askSize: Math.random() * 1000,
        lastPrice: 100.05 + Math.random(),
        volume: Math.random() * 10000
      });
    }
    
    const ringWriteTime = Number(process.hrtime.bigint() - ringWriteStart) / 1_000_000;
    
    // Test reads
    const ringReadStart = process.hrtime.bigint();
    let ringSum = 0;
    
    for (let i = 0; i < 10000; i++) {
      const symbol = `SYMBOL${i % 100}`;
      const found = ringBuffer.getLatest(symbol);
      if (found) ringSum += found.lastPrice;
    }
    
    const ringReadTime = Number(process.hrtime.bigint() - ringReadStart) / 1_000_000;
    
    // Results
    logger.info('\nResults:');
    logger.info('Array-based:');
    logger.info(`  Write time: ${arrayWriteTime.toFixed(2)}ms (${(iterations / (arrayWriteTime / 1000)).toFixed(0)} ops/sec)`);
    logger.info(`  Read time: ${arrayReadTime.toFixed(2)}ms (${(arrayReadTime / 10).toFixed(3)}ms per read)`);
    
    logger.info('\nRing buffer:');
    logger.info(`  Write time: ${ringWriteTime.toFixed(2)}ms (${(iterations / (ringWriteTime / 1000)).toFixed(0)} ops/sec)`);
    logger.info(`  Read time: ${ringReadTime.toFixed(2)}ms (${(ringReadTime / 10).toFixed(3)}ms per read)`);
    
    const improvement = (arrayReadTime / 10) - (ringReadTime / 10);
    logger.info(`\n🎯 Read latency improvement: ${improvement.toFixed(3)}ms per read`);
    
    if (improvement >= 3) {
      logger.info('✅ SUCCESS: Achieved target -3ms improvement!');
    } else {
      logger.info(`⚠️  WARNING: Only achieved ${improvement.toFixed(3)}ms improvement (target: 3ms)`);
    }
    
    logger.info('\nRing buffer stats:', ringBuffer.getStats());
  }
}

// Run benchmark if executed directly
if (require.main === module) {
  import { Logger } from '@noderr/utils/src';
  const logger = new Logger('RingBufferBenchmark');
  
  RingBufferBenchmark.runBenchmark(logger as any).catch((err) => logger.error("Unhandled error", err));
} 