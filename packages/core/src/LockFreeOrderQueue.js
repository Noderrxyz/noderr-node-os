"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LockFreeQueueBenchmark = exports.OrderProcessorWorker = exports.OrderEncoder = exports.LockFreeOrderQueue = void 0;
const worker_threads_1 = require("worker_threads");
const os = require("os");
/**
 * Lock-free MPMC (Multi-Producer Multi-Consumer) queue
 * Uses SharedArrayBuffer and Atomics for thread-safe operations
 * Target: 1M+ orders/second throughput
 */
class LockFreeOrderQueue {
    // Remaining 4 slots for future use
    constructor(capacity = 1000000) {
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
    enqueue(order) {
        // Increment producer count
        Atomics.add(this.metadata, LockFreeOrderQueue.PRODUCER_COUNT_INDEX, 1);
        try {
            let tail;
            let newTail;
            let size;
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
        }
        finally {
            // Decrement producer count
            Atomics.sub(this.metadata, LockFreeOrderQueue.PRODUCER_COUNT_INDEX, 1);
        }
    }
    /**
     * Dequeue an order (lock-free)
     * Returns null if queue is empty
     */
    dequeue() {
        // Increment consumer count
        Atomics.add(this.metadata, LockFreeOrderQueue.CONSUMER_COUNT_INDEX, 1);
        try {
            let head;
            let newHead;
            let size;
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
            const order = {
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
        }
        finally {
            // Decrement consumer count
            Atomics.sub(this.metadata, LockFreeOrderQueue.CONSUMER_COUNT_INDEX, 1);
        }
    }
    /**
     * Wait for orders (blocking dequeue)
     */
    async dequeueWait(timeoutMs = 1000) {
        const startTime = Date.now();
        while (Date.now() - startTime < timeoutMs) {
            const order = this.dequeue();
            if (order)
                return order;
            // Wait for notification
            const size = Atomics.load(this.metadata, LockFreeOrderQueue.SIZE_INDEX);
            if (size === 0) {
                const result = Atomics.wait(this.metadata, LockFreeOrderQueue.SIZE_INDEX, 0, 100);
                if (result === 'timed-out')
                    continue;
            }
        }
        return null;
    }
    /**
     * Batch enqueue for better throughput
     */
    enqueueBatch(orders) {
        let enqueued = 0;
        for (const order of orders) {
            if (this.enqueue(order)) {
                enqueued++;
            }
            else {
                break; // Queue full
            }
        }
        return enqueued;
    }
    /**
     * Batch dequeue for better throughput
     */
    dequeueBatch(maxCount) {
        const orders = [];
        for (let i = 0; i < maxCount; i++) {
            const order = this.dequeue();
            if (order) {
                orders.push(order);
            }
            else {
                break; // Queue empty
            }
        }
        return orders;
    }
    /**
     * Get queue statistics
     */
    getStats() {
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
    getSharedBuffer() {
        return this.buffer;
    }
    /**
     * Create from existing shared buffer (for workers)
     */
    static fromSharedBuffer(buffer, capacity) {
        const queue = Object.create(LockFreeOrderQueue.prototype);
        queue.buffer = buffer;
        queue.capacity = capacity;
        queue.metadata = new Int32Array(buffer, 0, 6);
        queue.data = new Float64Array(buffer, 24);
        return queue;
    }
}
exports.LockFreeOrderQueue = LockFreeOrderQueue;
// Metadata layout
LockFreeOrderQueue.HEAD_INDEX = 0;
LockFreeOrderQueue.TAIL_INDEX = 1;
LockFreeOrderQueue.SIZE_INDEX = 2;
LockFreeOrderQueue.PRODUCER_COUNT_INDEX = 3;
LockFreeOrderQueue.CONSUMER_COUNT_INDEX = 4;
LockFreeOrderQueue.SEQUENCE_INDEX = 5;
// Order data layout (16 Float64 values = 128 bytes per order)
LockFreeOrderQueue.ORDER_SIZE = 16;
LockFreeOrderQueue.SYMBOL_HASH_OFFSET = 0;
LockFreeOrderQueue.SIDE_OFFSET = 1;
LockFreeOrderQueue.TYPE_OFFSET = 2;
LockFreeOrderQueue.QUANTITY_OFFSET = 3;
LockFreeOrderQueue.PRICE_OFFSET = 4;
LockFreeOrderQueue.TIMESTAMP_OFFSET = 5;
LockFreeOrderQueue.STATUS_OFFSET = 6;
LockFreeOrderQueue.VENUE_HASH_OFFSET = 7;
LockFreeOrderQueue.ORDER_ID_HIGH = 8;
LockFreeOrderQueue.ORDER_ID_LOW = 9;
LockFreeOrderQueue.CLIENT_ID_HIGH = 10;
LockFreeOrderQueue.CLIENT_ID_LOW = 11;
/**
 * Order encoder/decoder utilities
 */
class OrderEncoder {
    static encode(order) {
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
    static decode(encoded) {
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
    static hashString(str) {
        let cached = this.symbolCache.get(str);
        if (cached !== undefined)
            return cached;
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash = hash & hash;
        }
        this.symbolCache.set(str, hash);
        return hash;
    }
    static encodeIdHigh(id) {
        // Take first 8 chars as number
        return parseInt(id.substring(0, 8), 36) || 0;
    }
    static encodeIdLow(id) {
        // Take last 8 chars as number
        return parseInt(id.substring(8, 16), 36) || 0;
    }
    static encodeOrderType(type) {
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
    static decodeOrderType(code) {
        const types = ['MARKET', 'LIMIT', 'STOP', 'STOP_LIMIT', 'ICEBERG', 'TWAP', 'VWAP'];
        return types[code] || 'LIMIT';
    }
    static encodeOrderStatus(status) {
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
    static decodeOrderStatus(code) {
        const statuses = ['PENDING', 'SUBMITTED', 'ACKNOWLEDGED', 'PARTIALLY_FILLED',
            'FILLED', 'CANCELLED', 'REJECTED', 'EXPIRED', 'STUCK'];
        return statuses[code] || 'PENDING';
    }
}
exports.OrderEncoder = OrderEncoder;
OrderEncoder.symbolCache = new Map();
OrderEncoder.venueCache = new Map();
/**
 * Worker thread for order processing
 */
class OrderProcessorWorker {
    constructor(sharedBuffer, capacity, workerId) {
        this.running = true;
        this.processed = 0;
        this.queue = LockFreeOrderQueue.fromSharedBuffer(sharedBuffer, capacity);
        this.workerId = workerId;
    }
    async start() {
        console.log(`Worker ${this.workerId} started on CPU ${os.cpus()[this.workerId % os.cpus().length].model}`);
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
    processOrder(order) {
        // Simulate order processing
        const decoded = OrderEncoder.decode(order);
        // Validate order
        if (decoded.quantity <= 0 || decoded.price < 0) {
            return; // Invalid order
        }
        // Risk checks would go here
        // Exchange routing would go here
    }
    reportStats() {
        if (worker_threads_1.parentPort) {
            worker_threads_1.parentPort.postMessage({
                type: 'stats',
                workerId: this.workerId,
                processed: this.processed,
                timestamp: Date.now()
            });
        }
    }
    stop() {
        this.running = false;
    }
}
exports.OrderProcessorWorker = OrderProcessorWorker;
/**
 * Benchmark for lock-free queue
 */
class LockFreeQueueBenchmark {
    static async runBenchmark() {
        console.log('\n🚀 Lock-Free Order Queue Benchmark');
        console.log('Target: 1M+ orders/second\n');
        const queue = new LockFreeOrderQueue(1000000);
        const numProducers = 4;
        const numConsumers = 8;
        const ordersPerProducer = 250000;
        const cpuCount = os.cpus().length;
        console.log(`System Configuration:`);
        console.log(`  CPU Cores: ${cpuCount}`);
        console.log(`  CPU Model: ${os.cpus()[0].model}`);
        console.log(`  Total Memory: ${(os.totalmem() / 1024 / 1024 / 1024).toFixed(2)} GB`);
        console.log(`\nBenchmark Configuration:`);
        console.log(`  Producers: ${numProducers}`);
        console.log(`  Consumers: ${numConsumers}`);
        console.log(`  Orders per producer: ${ordersPerProducer.toLocaleString()}`);
        console.log(`  Total orders: ${(numProducers * ordersPerProducer).toLocaleString()}\n`);
        const startTime = process.hrtime.bigint();
        // Spawn producer workers
        const producers = await Promise.all(Array.from({ length: numProducers }, async (_, i) => {
            const worker = new worker_threads_1.Worker(__filename, {
                workerData: {
                    role: 'producer',
                    workerId: i,
                    sharedBuffer: queue.getSharedBuffer(),
                    capacity: 1000000,
                    ordersToSend: ordersPerProducer
                }
            });
            return worker;
        }));
        // Spawn consumer workers
        const consumers = await Promise.all(Array.from({ length: numConsumers }, async (_, i) => {
            const worker = new worker_threads_1.Worker(__filename, {
                workerData: {
                    role: 'consumer',
                    workerId: i,
                    sharedBuffer: queue.getSharedBuffer(),
                    capacity: 1000000
                }
            });
            return worker;
        }));
        // Track progress
        let totalProduced = 0;
        let totalConsumed = 0;
        const producerStats = new Map();
        const consumerStats = new Map();
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
            console.log(`Progress: ${progress}% | Queue size: ${queueStats.size} | Produced: ${totalProduced.toLocaleString()} | Consumed: ${totalConsumed.toLocaleString()}`);
        }, 1000);
        // Wait for all orders to be consumed
        while (totalConsumed < targetOrders) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        clearInterval(progressInterval);
        const endTime = process.hrtime.bigint();
        const duration = Number(endTime - startTime) / 1000000000; // seconds
        const throughput = targetOrders / duration;
        console.log('\n📊 Results:');
        console.log(`  Duration: ${duration.toFixed(2)}s`);
        console.log(`  Total orders: ${targetOrders.toLocaleString()}`);
        console.log(`  Throughput: ${throughput.toFixed(0).toLocaleString()} orders/second`);
        console.log(`  Latency: ${(duration * 1000 / targetOrders).toFixed(3)}ms per order`);
        // Get final stats
        const finalStats = queue.getStats();
        console.log('\nFinal Queue Stats:');
        console.log(`  Size: ${finalStats.size}`);
        console.log(`  Sequence: ${finalStats.sequence.toLocaleString()}`);
        console.log(`  Head: ${finalStats.head}`);
        console.log(`  Tail: ${finalStats.tail}`);
        // Cleanup
        producers.forEach(w => w.terminate());
        consumers.forEach(w => w.terminate());
        if (throughput >= 1000000) {
            console.log('\n✅ SUCCESS: Achieved 1M+ orders/second!');
        }
        else if (throughput >= 500000) {
            console.log('\n⚠️  GOOD: Achieved 500K+ orders/second');
        }
        else {
            console.log(`\n❌ NEEDS OPTIMIZATION: Only ${throughput.toFixed(0)} orders/second`);
        }
        return;
    }
}
exports.LockFreeQueueBenchmark = LockFreeQueueBenchmark;
// Worker thread code
if (!worker_threads_1.isMainThread && worker_threads_1.workerData) {
    (async () => {
        const { role, workerId, sharedBuffer, capacity, ordersToSend } = worker_threads_1.workerData;
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
                const batch = [];
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
                    worker_threads_1.parentPort.postMessage({
                        type: 'stats',
                        workerId,
                        produced
                    });
                }
            }
            worker_threads_1.parentPort.postMessage({
                type: 'stats',
                workerId,
                produced
            });
        }
        else if (role === 'consumer') {
            const processor = new OrderProcessorWorker(sharedBuffer, capacity, workerId);
            await processor.start();
        }
    })();
}
// Run benchmark if executed directly
if (require.main === module && worker_threads_1.isMainThread) {
    LockFreeQueueBenchmark.runBenchmark().catch(console.error);
}
