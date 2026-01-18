import { Logger } from '@noderr/utils/src';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import * as os from 'os';

/**
 * Lock-free MPMC (Multi-Producer Multi-Consumer) queue
 * Uses SharedArrayBuffer and Atomics for thread-safe operations
 * Target: 1M+ orders/second throughput
 */
export class LockFreeOrderQueue {
  private buffer: SharedArrayBuffer;
  private capacity: number;
  private metadata: Int32Array;
  private data: Float64Array;
  
  // Metadata layout
  private static readonly HEAD_INDEX = 0;
  private static readonly TAIL_INDEX = 1;
  private static readonly SIZE_INDEX = 2;
  private static readonly PRODUCER_COUNT_INDEX = 3;
  private static readonly CONSUMER_COUNT_INDEX = 4;
  private static readonly SEQUENCE_INDEX = 5;
  
  // Order data layout (16 Float64 values = 128 bytes per order)
  private static readonly ORDER_SIZE = 16;
  private static readonly SYMBOL_HASH_OFFSET = 0;
  private static readonly SIDE_OFFSET = 1;
  private static readonly TYPE_OFFSET = 2;
  private static readonly QUANTITY_OFFSET = 3;
  private static readonly PRICE_OFFSET = 4;
  private static readonly TIMESTAMP_OFFSET = 5;
  private static readonly STATUS_OFFSET = 6;
  private static readonly VENUE_HASH_OFFSET = 7;
  private static readonly ORDER_ID_HIGH = 8;
  private static readonly ORDER_ID_LOW = 9;
  private static readonly CLIENT_ID_HIGH = 10;
  private static readonly CLIENT_ID_LOW = 11;
  // Remaining 4 slots for future use
  
  constructor(capacity: number = 1_000_000) {
    this.capacity = capacity;
    
    // Allocate shared memory
    const metadataSize = 24; // 6 * 4 bytes
    const dataSize = capacity * LockFreeOrderQueue.ORDER_SIZE * 8; // 8 bytes per Float64
    const totalSize = metadataSize + dataSize;
    
    this.buffer = new SharedArrayBuffer(totalSize);
    this.metadata = new Int32Array(this.buffer, 0, 6);
    this.data = new Float64Array(this.buffer, metadataSize);
    
    // Initialize metadata
    Atomics.store(this.metadata, LockFreeOrderQueue.HEAD_INDEX, 0);
    Atomics.store(this.metadata, LockFreeOrderQueue.TAIL_INDEX, 0);
    Atomics.store(this.metadata, LockFreeOrderQueue.SIZE_INDEX, 0);
    Atomics.store(this.metadata, LockFreeOrderQueue.PRODUCER_COUNT_INDEX, 0);
    Atomics.store(this.metadata, LockFreeOrderQueue.CONSUMER_COUNT_INDEX, 0);
    Atomics.store(this.metadata, LockFreeOrderQueue.SEQUENCE_INDEX, 0);
  }
  
  /**
   * Enqueue an order (lock-free)
   * Returns true if successful, false if queue is full
   */
  enqueue(order: EncodedOrder): boolean {
    // Increment producer count
    Atomics.add(this.metadata, LockFreeOrderQueue.PRODUCER_COUNT_INDEX, 1);
    
    try {
      let tail: number;
      let newTail: number;
      let size: number;
      
      // Exponential backoff for contention
      let backoff = 1;
      const maxBackoff = 32;
      
      do {
        tail = Atomics.load(this.metadata, LockFreeOrderQueue.TAIL_INDEX);
        size = Atomics.load(this.metadata, LockFreeOrderQueue.SIZE_INDEX);
        
        // Check if queue is full
        if (size >= this.capacity) {
          return false;
        }
        
        newTail = (tail + 1) % this.capacity;
        
        // Try to claim the slot
        const result = Atomics.compareExchange(this.metadata, LockFreeOrderQueue.TAIL_INDEX, tail, newTail);
        if (result === tail) {
          break; // Success
        }
        
        // Backoff on contention
        if (backoff < maxBackoff) {
          for (let i = 0; i < backoff; i++) {
            // Spin
          }
          backoff *= 2;
        }
      } while (true);
      
      // We have exclusive access to this slot
      const offset = tail * LockFreeOrderQueue.ORDER_SIZE;
      
      // Write order data
      this.data[offset + LockFreeOrderQueue.SYMBOL_HASH_OFFSET] = order.symbolHash;
      this.data[offset + LockFreeOrderQueue.SIDE_OFFSET] = order.side;
      this.data[offset + LockFreeOrderQueue.TYPE_OFFSET] = order.type;
      this.data[offset + LockFreeOrderQueue.QUANTITY_OFFSET] = order.quantity;
      this.data[offset + LockFreeOrderQueue.PRICE_OFFSET] = order.price;
      this.data[offset + LockFreeOrderQueue.TIMESTAMP_OFFSET] = order.timestamp;
      this.data[offset + LockFreeOrderQueue.STATUS_OFFSET] = order.status;
      this.data[offset + LockFreeOrderQueue.VENUE_HASH_OFFSET] = order.venueHash;
      this.data[offset + LockFreeOrderQueue.ORDER_ID_HIGH] = order.orderIdHigh;
      this.data[offset + LockFreeOrderQueue.ORDER_ID_LOW] = order.orderIdLow;
      this.data[offset + LockFreeOrderQueue.CLIENT_ID_HIGH] = order.clientIdHigh;
      this.data[offset + LockFreeOrderQueue.CLIENT_ID_LOW] = order.clientIdLow;
      
      // Memory fence to ensure writes are visible
      this.data[offset + LockFreeOrderQueue.ORDER_SIZE - 1] = 1;
      
      // Increment size atomically
      Atomics.add(this.metadata, LockFreeOrderQueue.SIZE_INDEX, 1);
      
      // Increment sequence number
      Atomics.add(this.metadata, LockFreeOrderQueue.SEQUENCE_INDEX, 1);
      
      // Notify waiting consumers
      Atomics.notify(this.metadata, LockFreeOrderQueue.SIZE_INDEX, 1);
      
      return true;
      
    } finally {
      // Decrement producer count
      Atomics.sub(this.metadata, LockFreeOrderQueue.PRODUCER_COUNT_INDEX, 1);
    }
  }
  
  /**
   * Dequeue an order (lock-free)
   * Returns null if queue is empty
   */
  dequeue(): EncodedOrder | null {
    // Increment consumer count
    Atomics.add(this.metadata, LockFreeOrderQueue.CONSUMER_COUNT_INDEX, 1);
    
    try {
      let head: number;
      let newHead: number;
      let size: number;
      
      // Exponential backoff for contention
      let backoff = 1;
      const maxBackoff = 32;
      
      do {
        size = Atomics.load(this.metadata, LockFreeOrderQueue.SIZE_INDEX);
        
        // Check if queue is empty
        if (size === 0) {
          return null;
        }
        
        head = Atomics.load(this.metadata, LockFreeOrderQueue.HEAD_INDEX);
        newHead = (head + 1) % this.capacity;
        
        // Try to claim the slot
        const result = Atomics.compareExchange(this.metadata, LockFreeOrderQueue.HEAD_INDEX, head, newHead);
        if (result === head) {
          break; // Success
        }
        
        // Backoff on contention
        if (backoff < maxBackoff) {
          for (let i = 0; i < backoff; i++) {
            // Spin
          }
          backoff *= 2;
        }
      } while (true);
      
      // We have exclusive access to this slot
      const offset = head * LockFreeOrderQueue.ORDER_SIZE;
      
      // Wait for write to complete (memory fence)
      while (this.data[offset + LockFreeOrderQueue.ORDER_SIZE - 1] !== 1) {
        // Spin wait
      }
      
      // Read order data
      const order: EncodedOrder = {
        symbolHash: this.data[offset + LockFreeOrderQueue.SYMBOL_HASH_OFFSET],
        side: this.data[offset + LockFreeOrderQueue.SIDE_OFFSET],
        type: this.data[offset + LockFreeOrderQueue.TYPE_OFFSET],
        quantity: this.data[offset + LockFreeOrderQueue.QUANTITY_OFFSET],
        price: this.data[offset + LockFreeOrderQueue.PRICE_OFFSET],
        timestamp: this.data[offset + LockFreeOrderQueue.TIMESTAMP_OFFSET],
        status: this.data[offset + LockFreeOrderQueue.STATUS_OFFSET],
        venueHash: this.data[offset + LockFreeOrderQueue.VENUE_HASH_OFFSET],
        orderIdHigh: this.data[offset + LockFreeOrderQueue.ORDER_ID_HIGH],
        orderIdLow: this.data[offset + LockFreeOrderQueue.ORDER_ID_LOW],
        clientIdHigh: this.data[offset + LockFreeOrderQueue.CLIENT_ID_HIGH],
        clientIdLow: this.data[offset + LockFreeOrderQueue.CLIENT_ID_LOW]
      };
      
      // Clear memory fence
      this.data[offset + LockFreeOrderQueue.ORDER_SIZE - 1] = 0;
      
      // Decrement size atomically
      Atomics.sub(this.metadata, LockFreeOrderQueue.SIZE_INDEX, 1);
      
      // Notify waiting producers
      Atomics.notify(this.metadata, LockFreeOrderQueue.SIZE_INDEX, 1);
      
      return order;
      
    } finally {
      // Decrement consumer count
      Atomics.sub(this.metadata, LockFreeOrderQueue.CONSUMER_COUNT_INDEX, 1);
    }
  }
  
  /**
   * Wait for orders (blocking dequeue)
   */
  async dequeueWait(timeoutMs: number = 1000): Promise<EncodedOrder | null> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      const order = this.dequeue();
      if (order) return order;
      
      // Wait for notification
      const size = Atomics.load(this.metadata, LockFreeOrderQueue.SIZE_INDEX);
      if (size === 0) {
        const result = Atomics.wait(this.metadata, LockFreeOrderQueue.SIZE_INDEX, 0, 100);
        if (result === 'timed-out') continue;
      }
    }
    
    return null;
  }
  
  /**
   * Batch enqueue for better throughput
   */
  enqueueBatch(orders: EncodedOrder[]): number {
    let enqueued = 0;
    
    for (const order of orders) {
      if (this.enqueue(order)) {
        enqueued++;
      } else {
        break; // Queue full
      }
    }
    
    return enqueued;
  }
  
  /**
   * Batch dequeue for better throughput
   */
  dequeueBatch(maxCount: number): EncodedOrder[] {
    const orders: EncodedOrder[] = [];
    
    for (let i = 0; i < maxCount; i++) {
      const order = this.dequeue();
      if (order) {
        orders.push(order);
      } else {
        break; // Queue empty
      }
    }
    
    return orders;
  }
  
  /**
   * Get queue statistics
   */
  getStats(): QueueStats {
    return {
      size: Atomics.load(this.metadata, LockFreeOrderQueue.SIZE_INDEX),
      capacity: this.capacity,
      head: Atomics.load(this.metadata, LockFreeOrderQueue.HEAD_INDEX),
      tail: Atomics.load(this.metadata, LockFreeOrderQueue.TAIL_INDEX),
      producers: Atomics.load(this.metadata, LockFreeOrderQueue.PRODUCER_COUNT_INDEX),
      consumers: Atomics.load(this.metadata, LockFreeOrderQueue.CONSUMER_COUNT_INDEX),
      sequence: Atomics.load(this.metadata, LockFreeOrderQueue.SEQUENCE_INDEX)
    };
  }
  
  /**
   * Get the shared buffer for worker threads
   */
  getSharedBuffer(): SharedArrayBuffer {
    return this.buffer;
  }
  
  /**
   * Create from existing shared buffer (for workers)
   */
  static fromSharedBuffer(buffer: SharedArrayBuffer, capacity: number): LockFreeOrderQueue {
    const queue = Object.create(LockFreeOrderQueue.prototype);
    queue.buffer = buffer;
    queue.capacity = capacity;
    queue.metadata = new Int32Array(buffer, 0, 6);
    queue.data = new Float64Array(buffer, 24);
    return queue;
  }
}

const logger = new Logger('LockFreeOrderQueue');
export interface EncodedOrder {
  symbolHash: number;
  side: number; // 0=BUY, 1=SELL
  type: number; // 0=MARKET, 1=LIMIT, etc
  quantity: number;
  price: number;
  timestamp: number;
  status: number;
  venueHash: number;
  orderIdHigh: number;
  orderIdLow: number;
  clientIdHigh: number;
  clientIdLow: number;
}

export interface QueueStats {
  size: number;
  capacity: number;
  head: number;
  tail: number;
  producers: number;
  consumers: number;
  sequence: number;
}

/**
 * Order encoder/decoder utilities
 */
export class OrderEncoder {
  private static symbolCache = new Map<string, number>();
  private static venueCache = new Map<string, number>();
  
  static encode(order: any): EncodedOrder {
    return {
      symbolHash: this.hashString(order.symbol || ''),
      side: order.side === 'SELL' ? 1 : 0,
      type: this.encodeOrderType(order.type),
      quantity: order.quantity || 0,
      price: order.price || 0,
      timestamp: order.timestamp || Date.now(),
      status: this.encodeOrderStatus(order.status),
      venueHash: this.hashString(order.venue || ''),
      orderIdHigh: this.encodeIdHigh(order.id || ''),
      orderIdLow: this.encodeIdLow(order.id || ''),
      clientIdHigh: this.encodeIdHigh(order.clientOrderId || ''),
      clientIdLow: this.encodeIdLow(order.clientOrderId || '')
    };
  }
  
  static decode(encoded: EncodedOrder): any {
    return {
      symbolHash: encoded.symbolHash,
      side: encoded.side === 1 ? 'SELL' : 'BUY',
      type: this.decodeOrderType(encoded.type),
      quantity: encoded.quantity,
      price: encoded.price,
      timestamp: encoded.timestamp,
      status: this.decodeOrderStatus(encoded.status),
      venueHash: encoded.venueHash,
      orderIdHigh: encoded.orderIdHigh,
      orderIdLow: encoded.orderIdLow,
      clientIdHigh: encoded.clientIdHigh,
      clientIdLow: encoded.clientIdLow
    };
  }
  
  private static hashString(str: string): number {
    let cached = this.symbolCache.get(str);
    if (cached !== undefined) return cached;
    
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash = hash & hash;
    }
    
    this.symbolCache.set(str, hash);
    return hash;
  }
  
  private static encodeIdHigh(id: string): number {
    // Take first 8 chars as number
    return parseInt(id.substring(0, 8), 36) || 0;
  }
  
  private static encodeIdLow(id: string): number {
    // Take last 8 chars as number
    return parseInt(id.substring(8, 16), 36) || 0;
  }
  
  private static encodeOrderType(type?: string): number {
    switch (type) {
      case 'MARKET': return 0;
      case 'LIMIT': return 1;
      case 'STOP': return 2;
      case 'STOP_LIMIT': return 3;
      case 'ICEBERG': return 4;
      case 'TWAP': return 5;
      case 'VWAP': return 6;
      default: return 1;
    }
  }
  
  private static decodeOrderType(code: number): string {
    const types = ['MARKET', 'LIMIT', 'STOP', 'STOP_LIMIT', 'ICEBERG', 'TWAP', 'VWAP'];
    return types[code] || 'LIMIT';
  }
  
  private static encodeOrderStatus(status?: string): number {
    switch (status) {
      case 'PENDING': return 0;
      case 'SUBMITTED': return 1;
      case 'ACKNOWLEDGED': return 2;
      case 'PARTIALLY_FILLED': return 3;
      case 'FILLED': return 4;
      case 'CANCELLED': return 5;
      case 'REJECTED': return 6;
      case 'EXPIRED': return 7;
      case 'STUCK': return 8;
      default: return 0;
    }
  }
  
  private static decodeOrderStatus(code: number): string {
    const statuses = ['PENDING', 'SUBMITTED', 'ACKNOWLEDGED', 'PARTIALLY_FILLED', 
                      'FILLED', 'CANCELLED', 'REJECTED', 'EXPIRED', 'STUCK'];
    return statuses[code] || 'PENDING';
  }
}

/**
 * Worker thread for order processing
 */
export class OrderProcessorWorker {
  private queue: LockFreeOrderQueue;
  private workerId: number;
  private running: boolean = true;
  private processed: number = 0;
  
  constructor(sharedBuffer: SharedArrayBuffer, capacity: number, workerId: number) {
    this.queue = LockFreeOrderQueue.fromSharedBuffer(sharedBuffer, capacity);
    this.workerId = workerId;
  }
  
  async start(): Promise<void> {
    logger.info(`Worker ${this.workerId} started on CPU ${os.cpus()[this.workerId % os.cpus().length].model}`);
    
    while (this.running) {
      const order = await this.queue.dequeueWait(100);
      
      if (order) {
        // Process order
        this.processOrder(order);
        this.processed++;
        
        // Report stats periodically
        if (this.processed % 10000 === 0) {
          this.reportStats();
        }
      }
    }
  }
  
  private processOrder(order: EncodedOrder): void {
    // Simulate order processing
    const decoded = OrderEncoder.decode(order);
    
    // Validate order
    if (decoded.quantity <= 0 || decoded.price < 0) {
      return; // Invalid order
    }
    
    // Risk checks would go here
    // Exchange routing would go here
  }
  
  private reportStats(): void {
    if (parentPort) {
      parentPort.postMessage({
        type: 'stats',
        workerId: this.workerId,
        processed: this.processed,
        timestamp: Date.now()
      });
    }
  }
  
  stop(): void {
    this.running = false;
  }
}

/**
 * Benchmark for lock-free queue
 */
export class LockFreeQueueBenchmark {
  static async runBenchmark(): Promise<void> {
    logger.info('\n🚀 Lock-Free Order Queue Benchmark');
    logger.info('Target: 1M+ orders/second\n');
    
    const queue = new LockFreeOrderQueue(1_000_000);
    const numProducers = 4;
    const numConsumers = 8;
    const ordersPerProducer = 250_000;
    const cpuCount = os.cpus().length;
    
    logger.info(`System Configuration:`);
    logger.info(`  CPU Cores: ${cpuCount}`);
    logger.info(`  CPU Model: ${os.cpus()[0].model}`);
    logger.info(`  Total Memory: ${(os.totalmem() / 1024 / 1024 / 1024).toFixed(2)} GB`);
    logger.info(`\nBenchmark Configuration:`);
    logger.info(`  Producers: ${numProducers}`);
    logger.info(`  Consumers: ${numConsumers}`);
    logger.info(`  Orders per producer: ${ordersPerProducer.toLocaleString()}`);
    logger.info(`  Total orders: ${(numProducers * ordersPerProducer).toLocaleString()}\n`);
    
    const startTime = process.hrtime.bigint();
    
    // Spawn producer workers
    const producers = await Promise.all(
      Array.from({ length: numProducers }, async (_, i) => {
        const worker = new Worker(__filename, {
          workerData: {
            role: 'producer',
            workerId: i,
            sharedBuffer: queue.getSharedBuffer(),
            capacity: 1_000_000,
            ordersToSend: ordersPerProducer
          }
        });
        return worker;
      })
    );
    
    // Spawn consumer workers
    const consumers = await Promise.all(
      Array.from({ length: numConsumers }, async (_, i) => {
        const worker = new Worker(__filename, {
          workerData: {
            role: 'consumer',
            workerId: i,
            sharedBuffer: queue.getSharedBuffer(),
            capacity: 1_000_000
          }
        });
        return worker;
      })
    );
    
    // Track progress
    let totalProduced = 0;
    let totalConsumed = 0;
    const producerStats = new Map<number, number>();
    const consumerStats = new Map<number, number>();
    
    // Set up message handlers
    producers.forEach((worker, idx) => {
      worker.on('message', (msg) => {
        if (msg.type === 'stats') {
          producerStats.set(idx, msg.produced);
          totalProduced = Array.from(producerStats.values()).reduce((a, b) => a + b, 0);
        }
      });
    });
    
    consumers.forEach((worker, idx) => {
      worker.on('message', (msg) => {
        if (msg.type === 'stats') {
          consumerStats.set(idx, msg.processed);
          totalConsumed = Array.from(consumerStats.values()).reduce((a, b) => a + b, 0);
        }
      });
    });
    
    // Wait for completion
    const targetOrders = numProducers * ordersPerProducer;
    const progressInterval = setInterval(() => {
      const progress = (totalConsumed / targetOrders * 100).toFixed(1);
      const queueStats = queue.getStats();
      logger.info(`Progress: ${progress}% | Queue size: ${queueStats.size} | Produced: ${totalProduced.toLocaleString()} | Consumed: ${totalConsumed.toLocaleString()}`);
    }, 1000);
    
    // Wait for all orders to be consumed
    while (totalConsumed < targetOrders) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    clearInterval(progressInterval);
    
    const endTime = process.hrtime.bigint();
    const duration = Number(endTime - startTime) / 1_000_000_000; // seconds
    const throughput = targetOrders / duration;
    
    logger.info('\n📊 Results:');
    logger.info(`  Duration: ${duration.toFixed(2)}s`);
    logger.info(`  Total orders: ${targetOrders.toLocaleString()}`);
    logger.info(`  Throughput: ${throughput.toFixed(0).toLocaleString()} orders/second`);
    logger.info(`  Latency: ${(duration * 1000 / targetOrders).toFixed(3)}ms per order`);
    
    // Get final stats
    const finalStats = queue.getStats();
    logger.info('\nFinal Queue Stats:');
    logger.info(`  Size: ${finalStats.size}`);
    logger.info(`  Sequence: ${finalStats.sequence.toLocaleString()}`);
    logger.info(`  Head: ${finalStats.head}`);
    logger.info(`  Tail: ${finalStats.tail}`);
    
    // Cleanup
    producers.forEach(w => w.terminate());
    consumers.forEach(w => w.terminate());
    
    if (throughput >= 1_000_000) {
      logger.info('\n✅ SUCCESS: Achieved 1M+ orders/second!');
    } else if (throughput >= 500_000) {
      logger.info('\n⚠️  GOOD: Achieved 500K+ orders/second');
    } else {
      logger.info(`\n❌ NEEDS OPTIMIZATION: Only ${throughput.toFixed(0)} orders/second`);
    }
    
    return;
  }
}

// Worker thread code
if (!isMainThread && workerData) {
  (async () => {
    const { role, workerId, sharedBuffer, capacity, ordersToSend } = workerData;
    
    if (role === 'producer') {
      const queue = LockFreeOrderQueue.fromSharedBuffer(sharedBuffer, capacity);
      let produced = 0;
      
      // Create sample order
      const sampleOrder = {
        symbol: 'BTC/USD',
        side: 'BUY',
        type: 'LIMIT',
        quantity: 1,
        price: 50000,
        venue: 'binance',
        status: 'PENDING',
        id: 'ORD123456789',
        clientOrderId: 'CLIENT123456'
      };
      
      const encoded = OrderEncoder.encode(sampleOrder);
      
      // Produce orders
      const batchSize = 1000;
      while (produced < ordersToSend) {
        const batch: EncodedOrder[] = [];
        const remaining = ordersToSend - produced;
        const count = Math.min(batchSize, remaining);
        
        for (let i = 0; i < count; i++) {
          batch.push({
            ...encoded,
            timestamp: Date.now(),
            orderIdHigh: produced + i,
            orderIdLow: workerId
          });
        }
        
        const enqueued = queue.enqueueBatch(batch);
        produced += enqueued;
        
        if (enqueued < batch.length) {
          // Queue full, wait a bit
          await new Promise(resolve => setTimeout(resolve, 1));
        }
        
        // Report progress
        if (produced % 50000 === 0) {
          parentPort!.postMessage({
            type: 'stats',
            workerId,
            produced
          });
        }
      }
      
      parentPort!.postMessage({
        type: 'stats',
        workerId,
        produced
      });
      
    } else if (role === 'consumer') {
      const processor = new OrderProcessorWorker(sharedBuffer, capacity, workerId);
      await processor.start();
    }
  })();
}

// Run benchmark if executed directly
if (require.main === module && isMainThread) {
  LockFreeQueueBenchmark.runBenchmark().catch((err) => logger.error("Unhandled error", err));
} 