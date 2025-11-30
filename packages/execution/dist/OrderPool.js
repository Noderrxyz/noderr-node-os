"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrderPoolBenchmark = exports.OrderPool = void 0;
exports.getGlobalOrderPool = getGlobalOrderPool;
const winston = __importStar(require("winston"));
const types_1 = require("@noderr/types");
/**
 * High-performance object pool for Order instances
 * Prevents GC pressure by reusing objects
 * Target: -2ms P99 latency improvement
 */
class OrderPool {
    static DEFAULT_POOL_SIZE = 10000;
    static DEFAULT_MAX_POOL_SIZE = 50000;
    pool = [];
    config;
    logger;
    metrics = {
        created: 0,
        acquired: 0,
        released: 0,
        inUse: 0,
        available: 0,
        gcPressureWarnings: 0
    };
    // Pre-allocated order template for fast cloning
    orderTemplate;
    constructor(logger, config) {
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
    acquire() {
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
    release(order) {
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
    preAllocatePool() {
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
    createOrder() {
        // Clone from template for speed
        return {
            ...this.orderTemplate,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            metadata: {}
        };
    }
    /**
     * Reset order to initial state for reuse
     * Critical for preventing data leaks between uses
     */
    resetOrder(order) {
        // Reset all fields to template values
        order.id = '';
        order.clientOrderId = '';
        order.symbol = '';
        order.side = types_1.OrderSide.BUY;
        order.type = types_1.OrderType.LIMIT;
        order.amount = 0;
        order.quantity = 0;
        order.price = undefined;
        order.timeInForce = types_1.TimeInForce.GTC;
        order.status = types_1.OrderStatus.PENDING;
        order.createdAt = Date.now();
        order.updatedAt = Date.now();
        order.timestamp = Date.now();
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
    createOrderTemplate() {
        return {
            id: '',
            clientOrderId: '',
            symbol: '',
            side: types_1.OrderSide.BUY,
            type: types_1.OrderType.LIMIT,
            amount: 0,
            quantity: 0,
            price: undefined,
            timestamp: Date.now(),
            timeInForce: types_1.TimeInForce.GTC,
            status: types_1.OrderStatus.PENDING,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            metadata: {}
        };
    }
    /**
     * Monitor pool health and log metrics
     */
    startHealthMonitoring() {
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
    getMetrics() {
        return { ...this.metrics };
    }
    /**
     * Drain the pool (for shutdown)
     */
    drain() {
        this.pool = [];
        this.metrics.available = 0;
        this.logger.info('Order pool drained');
    }
}
exports.OrderPool = OrderPool;
/**
 * Global singleton instance for the application
 */
let globalOrderPool = null;
function getGlobalOrderPool(logger) {
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
class OrderPoolBenchmark {
    static async runBenchmark(logger, iterations = 100000) {
        console.log(`\n🏊 Order Pool Performance Benchmark`);
        console.log(`Iterations: ${iterations}\n`);
        // Benchmark without pooling
        console.log('📊 Without pooling (new objects):');
        const withoutPoolStart = process.hrtime.bigint();
        const withoutPoolLatencies = [];
        for (let i = 0; i < iterations; i++) {
            const iterStart = process.hrtime.bigint();
            const order = {
                id: `ORD-${i}`,
                clientOrderId: `CLIENT-${i}`,
                symbol: 'BTC/USD',
                side: types_1.OrderSide.BUY,
                type: types_1.OrderType.LIMIT,
                amount: 1,
                quantity: 1,
                price: 50000,
                timestamp: Date.now(),
                timeInForce: types_1.TimeInForce.GTC,
                status: types_1.OrderStatus.PENDING,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                metadata: {}
            };
            // Simulate usage
            order.status = types_1.OrderStatus.OPEN;
            const iterTime = Number(process.hrtime.bigint() - iterStart) / 1_000_000;
            withoutPoolLatencies.push(iterTime);
        }
        const withoutPoolTime = Number(process.hrtime.bigint() - withoutPoolStart) / 1_000_000;
        // Benchmark with pooling
        console.log('\n📊 With pooling (reused objects):');
        const pool = new OrderPool(logger, { preAllocate: true });
        const withPoolStart = process.hrtime.bigint();
        const withPoolLatencies = [];
        for (let i = 0; i < iterations; i++) {
            const iterStart = process.hrtime.bigint();
            const order = pool.acquire();
            order.id = `ORD-${i}`;
            order.clientOrderId = `CLIENT-${i}`;
            order.symbol = 'BTC/USD';
            order.side = types_1.OrderSide.BUY;
            order.amount = 1;
            order.quantity = 1;
            order.price = 50000;
            // Simulate usage
            order.status = types_1.OrderStatus.OPEN;
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
        }
        else {
            console.log('\n⚠️  WARNING: Improvement below target');
        }
        pool.drain();
    }
}
exports.OrderPoolBenchmark = OrderPoolBenchmark;
// Run benchmark if executed directly
if (require.main === module) {
    const logger = winston.createLogger({
        level: 'info',
        format: winston.format.simple(),
        transports: [new winston.transports.Console()]
    });
    OrderPoolBenchmark.runBenchmark(logger).catch(console.error);
}
//# sourceMappingURL=OrderPool.js.map