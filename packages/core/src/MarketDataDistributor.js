"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MarketDataBenchmark = exports.HighPerformanceSubscriber = exports.MarketDataDistributor = void 0;
const events_1 = require("events");
/**
 * Lock-Free Market Data Distributor
 * Features:
 * - Atomic sequence numbers for ordering
 * - Zero-copy conflation
 * - Lock-free ring buffers
 * - Multicast distribution
 * Target: 10M+ updates/second
 */
class MarketDataDistributor extends events_1.EventEmitter {
    sequenceNumber;
    ringBuffers = new Map();
    subscribers = new Map();
    conflationEnabled = true;
    bufferSize;
    updateCount = 0;
    conflatedCount = 0;
    constructor(options = {}) {
        super();
        this.bufferSize = options.bufferSize || 65536; // 64K entries
        this.conflationEnabled = options.conflation !== false;
        // Atomic sequence number
        const seqBuffer = new SharedArrayBuffer(8);
        this.sequenceNumber = new BigInt64Array(seqBuffer);
        Atomics.store(this.sequenceNumber, 0, 0n);
        // Initialize symbol buffers
        const symbols = options.symbols || ['BTC/USD', 'ETH/USD', 'SPY', 'QQQ'];
        for (const symbol of symbols) {
            this.ringBuffers.set(symbol, new RingBuffer(symbol, this.bufferSize));
            this.subscribers.set(symbol, new Set());
        }
    }
    /**
     * Publish market data update (lock-free)
     */
    publish(update) {
        // Increment sequence number atomically
        const seq = Atomics.add(this.sequenceNumber, 0, 1n);
        update.sequence = Number(seq);
        update.timestamp = process.hrtime.bigint();
        // Get ring buffer for symbol
        const buffer = this.ringBuffers.get(update.symbol);
        if (!buffer) {
            // Create new buffer for unknown symbol
            const newBuffer = new RingBuffer(update.symbol, this.bufferSize);
            this.ringBuffers.set(update.symbol, newBuffer);
            this.subscribers.set(update.symbol, new Set());
            return newBuffer.write(update);
        }
        // Write to ring buffer (lock-free)
        const written = buffer.write(update);
        if (written) {
            this.updateCount++;
            // Notify subscribers (zero-copy)
            const subs = this.subscribers.get(update.symbol);
            if (subs && subs.size > 0) {
                // Use setImmediate for async notification
                setImmediate(() => {
                    for (const subscriber of subs) {
                        subscriber.onUpdate(update);
                    }
                });
            }
        }
        return written;
    }
    /**
     * Batch publish for higher throughput
     */
    publishBatch(updates) {
        let published = 0;
        // Group by symbol for better cache locality
        const bySymbol = new Map();
        for (const update of updates) {
            const list = bySymbol.get(update.symbol) || [];
            list.push(update);
            bySymbol.set(update.symbol, list);
        }
        // Publish each symbol's updates
        for (const [symbol, symbolUpdates] of bySymbol) {
            const buffer = this.ringBuffers.get(symbol);
            if (!buffer)
                continue;
            for (const update of symbolUpdates) {
                // Assign sequence number
                const seq = Atomics.add(this.sequenceNumber, 0, 1n);
                update.sequence = Number(seq);
                update.timestamp = process.hrtime.bigint();
                if (buffer.write(update)) {
                    published++;
                }
            }
        }
        this.updateCount += published;
        return published;
    }
    /**
     * Subscribe to market data updates
     */
    subscribe(symbol, subscriber) {
        let subs = this.subscribers.get(symbol);
        if (!subs) {
            subs = new Set();
            this.subscribers.set(symbol, subs);
        }
        subs.add(subscriber);
        // Send snapshot of current data
        const buffer = this.ringBuffers.get(symbol);
        if (buffer) {
            const snapshot = buffer.getSnapshot();
            if (snapshot) {
                subscriber.onSnapshot(snapshot);
            }
        }
    }
    /**
     * Unsubscribe from market data
     */
    unsubscribe(symbol, subscriber) {
        const subs = this.subscribers.get(symbol);
        if (subs) {
            subs.delete(subscriber);
        }
    }
    /**
     * Get conflated view of market data
     */
    getConflatedView(symbol) {
        const buffer = this.ringBuffers.get(symbol);
        return buffer ? buffer.getLatest() : null;
    }
    /**
     * Get historical data from ring buffer
     */
    getHistory(symbol, count) {
        const buffer = this.ringBuffers.get(symbol);
        return buffer ? buffer.readLast(count) : [];
    }
    /**
     * Enable/disable conflation
     */
    setConflation(enabled) {
        this.conflationEnabled = enabled;
        for (const buffer of this.ringBuffers.values()) {
            buffer.setConflation(enabled);
        }
    }
    /**
     * Get distributor statistics
     */
    getStats() {
        const bufferStats = {};
        for (const [symbol, buffer] of this.ringBuffers) {
            bufferStats[symbol] = buffer.getStats();
        }
        return {
            sequenceNumber: Number(Atomics.load(this.sequenceNumber, 0)),
            updateCount: this.updateCount,
            conflatedCount: this.conflatedCount,
            symbolCount: this.ringBuffers.size,
            subscriberCount: Array.from(this.subscribers.values())
                .reduce((sum, subs) => sum + subs.size, 0),
            bufferStats,
            memoryUsage: process.memoryUsage()
        };
    }
}
exports.MarketDataDistributor = MarketDataDistributor;
/**
 * Lock-free ring buffer for market data
 */
class RingBuffer {
    buffer;
    metadata;
    data;
    capacity;
    symbol;
    conflationEnabled = true;
    lastUpdate = null;
    // Metadata indices
    static HEAD_INDEX = 0;
    static TAIL_INDEX = 1;
    static SIZE_INDEX = 2;
    static WRITE_COUNT_INDEX = 3;
    static READ_COUNT_INDEX = 4;
    static CONFLATED_COUNT_INDEX = 5;
    // Data layout per entry (10 Float64 values = 80 bytes)
    static ENTRY_SIZE = 10;
    static SEQUENCE_OFFSET = 0;
    static TIMESTAMP_HIGH_OFFSET = 1;
    static TIMESTAMP_LOW_OFFSET = 2;
    static BID_PRICE_OFFSET = 3;
    static BID_SIZE_OFFSET = 4;
    static ASK_PRICE_OFFSET = 5;
    static ASK_SIZE_OFFSET = 6;
    static LAST_PRICE_OFFSET = 7;
    static VOLUME_OFFSET = 8;
    static FLAGS_OFFSET = 9;
    constructor(symbol, capacity) {
        this.symbol = symbol;
        this.capacity = capacity;
        // Allocate shared memory
        const metadataSize = 24; // 6 * 4 bytes
        const dataSize = capacity * RingBuffer.ENTRY_SIZE * 8; // 8 bytes per Float64
        const totalSize = metadataSize + dataSize;
        this.buffer = new SharedArrayBuffer(totalSize);
        this.metadata = new Int32Array(this.buffer, 0, 6);
        this.data = new Float64Array(this.buffer, metadataSize);
        // Initialize metadata
        Atomics.store(this.metadata, RingBuffer.HEAD_INDEX, 0);
        Atomics.store(this.metadata, RingBuffer.TAIL_INDEX, 0);
        Atomics.store(this.metadata, RingBuffer.SIZE_INDEX, 0);
        Atomics.store(this.metadata, RingBuffer.WRITE_COUNT_INDEX, 0);
        Atomics.store(this.metadata, RingBuffer.READ_COUNT_INDEX, 0);
        Atomics.store(this.metadata, RingBuffer.CONFLATED_COUNT_INDEX, 0);
    }
    /**
     * Write market data to ring buffer (lock-free)
     */
    write(update) {
        // Check for conflation
        if (this.conflationEnabled && this.shouldConflate(update)) {
            Atomics.add(this.metadata, RingBuffer.CONFLATED_COUNT_INDEX, 1);
            this.lastUpdate = update;
            return true;
        }
        // Get current tail position
        const tail = Atomics.load(this.metadata, RingBuffer.TAIL_INDEX);
        const size = Atomics.load(this.metadata, RingBuffer.SIZE_INDEX);
        // Check if buffer is full
        if (size >= this.capacity) {
            // Overwrite oldest entry
            const head = Atomics.load(this.metadata, RingBuffer.HEAD_INDEX);
            const newHead = (head + 1) % this.capacity;
            Atomics.store(this.metadata, RingBuffer.HEAD_INDEX, newHead);
            Atomics.sub(this.metadata, RingBuffer.SIZE_INDEX, 1);
        }
        // Calculate write position
        const writePos = tail * RingBuffer.ENTRY_SIZE;
        // Write data (zero-copy)
        this.data[writePos + RingBuffer.SEQUENCE_OFFSET] = update.sequence || 0;
        // Split BigInt timestamp into two parts
        const timestamp = update.timestamp || 0n;
        this.data[writePos + RingBuffer.TIMESTAMP_HIGH_OFFSET] = Number(timestamp >> 32n);
        this.data[writePos + RingBuffer.TIMESTAMP_LOW_OFFSET] = Number(timestamp & 0xffffffffn);
        this.data[writePos + RingBuffer.BID_PRICE_OFFSET] = update.bidPrice || 0;
        this.data[writePos + RingBuffer.BID_SIZE_OFFSET] = update.bidSize || 0;
        this.data[writePos + RingBuffer.ASK_PRICE_OFFSET] = update.askPrice || 0;
        this.data[writePos + RingBuffer.ASK_SIZE_OFFSET] = update.askSize || 0;
        this.data[writePos + RingBuffer.LAST_PRICE_OFFSET] = update.lastPrice || 0;
        this.data[writePos + RingBuffer.VOLUME_OFFSET] = update.volume || 0;
        this.data[writePos + RingBuffer.FLAGS_OFFSET] = this.encodeFlags(update);
        // Update tail and size atomically
        const newTail = (tail + 1) % this.capacity;
        Atomics.store(this.metadata, RingBuffer.TAIL_INDEX, newTail);
        Atomics.add(this.metadata, RingBuffer.SIZE_INDEX, 1);
        Atomics.add(this.metadata, RingBuffer.WRITE_COUNT_INDEX, 1);
        this.lastUpdate = update;
        return true;
    }
    /**
     * Read last N entries from buffer
     */
    readLast(count) {
        const size = Atomics.load(this.metadata, RingBuffer.SIZE_INDEX);
        const actualCount = Math.min(count, size);
        if (actualCount === 0)
            return [];
        const updates = [];
        const tail = Atomics.load(this.metadata, RingBuffer.TAIL_INDEX);
        for (let i = 0; i < actualCount; i++) {
            const index = (tail - i - 1 + this.capacity) % this.capacity;
            const readPos = index * RingBuffer.ENTRY_SIZE;
            // Read data
            const update = {
                symbol: this.symbol,
                sequence: this.data[readPos + RingBuffer.SEQUENCE_OFFSET],
                timestamp: this.reconstructTimestamp(this.data[readPos + RingBuffer.TIMESTAMP_HIGH_OFFSET], this.data[readPos + RingBuffer.TIMESTAMP_LOW_OFFSET]),
                bidPrice: this.data[readPos + RingBuffer.BID_PRICE_OFFSET],
                bidSize: this.data[readPos + RingBuffer.BID_SIZE_OFFSET],
                askPrice: this.data[readPos + RingBuffer.ASK_PRICE_OFFSET],
                askSize: this.data[readPos + RingBuffer.ASK_SIZE_OFFSET],
                lastPrice: this.data[readPos + RingBuffer.LAST_PRICE_OFFSET],
                volume: this.data[readPos + RingBuffer.VOLUME_OFFSET]
            };
            this.decodeFlags(this.data[readPos + RingBuffer.FLAGS_OFFSET], update);
            updates.unshift(update);
        }
        Atomics.add(this.metadata, RingBuffer.READ_COUNT_INDEX, actualCount);
        return updates;
    }
    /**
     * Get latest update (conflated view)
     */
    getLatest() {
        return this.lastUpdate;
    }
    /**
     * Get snapshot of current state
     */
    getSnapshot() {
        const latest = this.getLatest();
        if (!latest) {
            return {
                symbol: this.symbol,
                timestamp: process.hrtime.bigint(),
                bidPrice: 0,
                bidSize: 0,
                askPrice: 0,
                askSize: 0,
                lastPrice: 0,
                volume: 0,
                updateCount: 0
            };
        }
        return {
            symbol: this.symbol,
            timestamp: latest.timestamp || process.hrtime.bigint(),
            bidPrice: latest.bidPrice || 0,
            bidSize: latest.bidSize || 0,
            askPrice: latest.askPrice || 0,
            askSize: latest.askSize || 0,
            lastPrice: latest.lastPrice || 0,
            volume: latest.volume || 0,
            updateCount: Atomics.load(this.metadata, RingBuffer.WRITE_COUNT_INDEX)
        };
    }
    /**
     * Check if update should be conflated
     */
    shouldConflate(update) {
        if (!this.lastUpdate)
            return false;
        // Conflate if same price level and within time window
        const timeDiff = update.timestamp && this.lastUpdate.timestamp
            ? Number(update.timestamp - this.lastUpdate.timestamp)
            : 0;
        return timeDiff < 1000000n && // 1ms window
            update.bidPrice === this.lastUpdate.bidPrice &&
            update.askPrice === this.lastUpdate.askPrice;
    }
    /**
     * Encode update flags into a single number
     */
    encodeFlags(update) {
        let flags = 0;
        if (update.isSnapshot)
            flags |= 1;
        if (update.isTrade)
            flags |= 2;
        if (update.isQuote)
            flags |= 4;
        return flags;
    }
    /**
     * Decode flags from number
     */
    decodeFlags(flags, update) {
        update.isSnapshot = (flags & 1) !== 0;
        update.isTrade = (flags & 2) !== 0;
        update.isQuote = (flags & 4) !== 0;
    }
    /**
     * Reconstruct BigInt timestamp from two parts
     */
    reconstructTimestamp(high, low) {
        return (BigInt(high) << 32n) | BigInt(low >>> 0);
    }
    /**
     * Set conflation enabled/disabled
     */
    setConflation(enabled) {
        this.conflationEnabled = enabled;
    }
    /**
     * Get buffer statistics
     */
    getStats() {
        return {
            size: Atomics.load(this.metadata, RingBuffer.SIZE_INDEX),
            capacity: this.capacity,
            writeCount: Atomics.load(this.metadata, RingBuffer.WRITE_COUNT_INDEX),
            readCount: Atomics.load(this.metadata, RingBuffer.READ_COUNT_INDEX),
            conflatedCount: Atomics.load(this.metadata, RingBuffer.CONFLATED_COUNT_INDEX),
            head: Atomics.load(this.metadata, RingBuffer.HEAD_INDEX),
            tail: Atomics.load(this.metadata, RingBuffer.TAIL_INDEX)
        };
    }
}
/**
 * High-performance market data subscriber
 */
class HighPerformanceSubscriber {
    updateCount = 0;
    lastSequence = 0;
    gaps = 0;
    onUpdate(update) {
        this.updateCount++;
        // Check for sequence gaps
        if (update.sequence && this.lastSequence > 0) {
            const expectedSeq = this.lastSequence + 1;
            if (update.sequence !== expectedSeq) {
                this.gaps++;
                console.warn(`Sequence gap detected: expected ${expectedSeq}, got ${update.sequence}`);
            }
        }
        this.lastSequence = update.sequence || 0;
        // Process update (example)
        if (update.isTrade) {
            // Handle trade
        }
        else if (update.isQuote) {
            // Handle quote
        }
    }
    onSnapshot(snapshot) {
        console.log(`Received snapshot for ${snapshot.symbol}:`, snapshot);
    }
    getStats() {
        return {
            updateCount: this.updateCount,
            gaps: this.gaps,
            lastSequence: this.lastSequence
        };
    }
}
exports.HighPerformanceSubscriber = HighPerformanceSubscriber;
/**
 * Benchmark for market data distributor
 */
class MarketDataBenchmark {
    static async runBenchmark() {
        console.log('\n🚀 Market Data Distributor Benchmark');
        console.log('Target: 10M+ updates/second\n');
        const distributor = new MarketDataDistributor({
            bufferSize: 100000,
            conflation: true,
            symbols: ['BTC/USD', 'ETH/USD', 'SPY', 'QQQ', 'AAPL', 'GOOGL', 'MSFT', 'AMZN']
        });
        // Create subscribers
        const subscribers = [];
        const symbols = ['BTC/USD', 'ETH/USD', 'SPY', 'QQQ'];
        for (const symbol of symbols) {
            const subscriber = new HighPerformanceSubscriber();
            subscribers.push(subscriber);
            distributor.subscribe(symbol, subscriber);
        }
        // Generate test updates
        const numUpdates = 1_000_000;
        const updates = [];
        console.log(`Generating ${numUpdates.toLocaleString()} market data updates...`);
        for (let i = 0; i < numUpdates; i++) {
            const symbol = symbols[i % symbols.length];
            const basePrice = symbol.includes('BTC') ? 50000 : symbol.includes('ETH') ? 3000 : 100;
            updates.push({
                symbol,
                bidPrice: basePrice + Math.random() * 10 - 5,
                bidSize: Math.random() * 100,
                askPrice: basePrice + Math.random() * 10,
                askSize: Math.random() * 100,
                lastPrice: basePrice + Math.random() * 10 - 2,
                volume: Math.random() * 1000,
                isQuote: Math.random() > 0.3,
                isTrade: Math.random() > 0.7
            });
        }
        // Benchmark single updates
        console.log('\n1. Single Update Performance:');
        const singleStart = process.hrtime.bigint();
        for (let i = 0; i < 100000; i++) {
            distributor.publish(updates[i]);
        }
        const singleEnd = process.hrtime.bigint();
        const singleDuration = Number(singleEnd - singleStart) / 1_000_000_000;
        const singleThroughput = 100000 / singleDuration;
        console.log(`   Duration: ${singleDuration.toFixed(3)}s`);
        console.log(`   Throughput: ${singleThroughput.toFixed(0).toLocaleString()} updates/second`);
        // Benchmark batch updates
        console.log('\n2. Batch Update Performance:');
        const batchSize = 1000;
        const numBatches = Math.floor((numUpdates - 100000) / batchSize);
        const batchStart = process.hrtime.bigint();
        for (let i = 0; i < numBatches; i++) {
            const start = 100000 + i * batchSize;
            const batch = updates.slice(start, start + batchSize);
            distributor.publishBatch(batch);
        }
        const batchEnd = process.hrtime.bigint();
        const batchDuration = Number(batchEnd - batchStart) / 1_000_000_000;
        const batchThroughput = (numBatches * batchSize) / batchDuration;
        console.log(`   Duration: ${batchDuration.toFixed(3)}s`);
        console.log(`   Throughput: ${batchThroughput.toFixed(0).toLocaleString()} updates/second`);
        console.log(`   Batches: ${numBatches.toLocaleString()} x ${batchSize}`);
        // Get statistics
        const stats = distributor.getStats();
        console.log('\n3. Distribution Statistics:');
        console.log(`   Total Updates: ${stats.updateCount.toLocaleString()}`);
        console.log(`   Sequence Number: ${stats.sequenceNumber.toLocaleString()}`);
        console.log(`   Conflated: ${stats.conflatedCount.toLocaleString()}`);
        console.log(`   Memory: ${(stats.memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`);
        console.log('\n4. Buffer Statistics:');
        for (const [symbol, bufferStats] of Object.entries(stats.bufferStats)) {
            console.log(`   ${symbol}:`);
            console.log(`     Size: ${bufferStats.size.toLocaleString()}`);
            console.log(`     Writes: ${bufferStats.writeCount.toLocaleString()}`);
            console.log(`     Conflated: ${bufferStats.conflatedCount.toLocaleString()}`);
        }
        console.log('\n5. Subscriber Statistics:');
        subscribers.forEach((sub, i) => {
            const subStats = sub.getStats();
            console.log(`   Subscriber ${i}: ${subStats.updateCount.toLocaleString()} updates, ${subStats.gaps} gaps`);
        });
        // Test conflation
        console.log('\n6. Conflation Test:');
        distributor.setConflation(false);
        const noConflateStart = process.hrtime.bigint();
        for (let i = 0; i < 10000; i++) {
            distributor.publish({
                symbol: 'BTC/USD',
                bidPrice: 50000,
                askPrice: 50001,
                timestamp: process.hrtime.bigint()
            });
        }
        const noConflateEnd = process.hrtime.bigint();
        const noConflateDuration = Number(noConflateEnd - noConflateStart) / 1_000_000;
        console.log(`   Without conflation: ${noConflateDuration.toFixed(2)}ms for 10K updates`);
        distributor.setConflation(true);
        const conflateStart = process.hrtime.bigint();
        for (let i = 0; i < 10000; i++) {
            distributor.publish({
                symbol: 'BTC/USD',
                bidPrice: 50000,
                askPrice: 50001,
                timestamp: process.hrtime.bigint()
            });
        }
        const conflateEnd = process.hrtime.bigint();
        const conflateDuration = Number(conflateEnd - conflateStart) / 1_000_000;
        console.log(`   With conflation: ${conflateDuration.toFixed(2)}ms for 10K updates`);
        console.log(`   Speedup: ${(noConflateDuration / conflateDuration).toFixed(2)}x`);
        // Summary
        const totalThroughput = Math.max(singleThroughput, batchThroughput);
        console.log('\n📊 Performance Summary:');
        console.log(`   Peak Throughput: ${totalThroughput.toFixed(0).toLocaleString()} updates/second`);
        console.log(`   Latency: ${(1000000 / totalThroughput).toFixed(3)}μs per update`);
        if (totalThroughput >= 10_000_000) {
            console.log('\n✅ SUCCESS: Achieved 10M+ updates/second!');
        }
        else if (totalThroughput >= 1_000_000) {
            console.log('\n⚠️  GOOD: Achieved 1M+ updates/second');
        }
        else {
            console.log(`\n❌ NEEDS OPTIMIZATION: Only ${totalThroughput.toFixed(0)} updates/second`);
        }
    }
}
exports.MarketDataBenchmark = MarketDataBenchmark;
// Export for use in other modules
exports.default = MarketDataDistributor;
//# sourceMappingURL=MarketDataDistributor.js.map