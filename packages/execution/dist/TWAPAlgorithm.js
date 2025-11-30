"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TWAPAlgorithm = void 0;
const types_1 = require("@noderr/types");
const events_1 = __importDefault(require("events"));
class TWAPAlgorithm extends events_1.default {
    logger;
    activeOrders;
    executionTimer;
    metricsInterval;
    constructor(logger) {
        super();
        this.logger = logger;
        this.activeOrders = new Map();
        // Start execution loop
        this.startExecutionLoop();
        // Start metrics collection
        this.startMetricsCollection();
    }
    /**
     * Execute order using TWAP algorithm
     */
    async execute(order, config, router // SmartOrderRouter instance
    ) {
        this.logger.info('Starting TWAP execution', {
            orderId: order.id,
            quantity: order.quantity,
            duration: config.parameters.duration
        });
        // Validate parameters
        this.validateParameters(config.parameters);
        // Initialize TWAP state
        const state = this.initializeTWAPState(order, config.parameters);
        this.activeOrders.set(order.id, state);
        // Emit start event
        this.emit('executionStarted', {
            orderId: order.id,
            algorithm: 'TWAP',
            parameters: config.parameters
        });
        // Start executing slices
        await this.executeNextSlice(order.id, router);
    }
    /**
     * Get current execution status
     */
    getExecutionStatus(orderId) {
        return this.activeOrders.get(orderId) || null;
    }
    /**
     * Get execution metrics
     */
    getMetrics(orderId) {
        const state = this.activeOrders.get(orderId);
        if (!state)
            return null;
        return this.calculateMetrics(state);
    }
    /**
     * Pause execution
     */
    pauseExecution(orderId) {
        const state = this.activeOrders.get(orderId);
        if (!state || state.status !== types_1.ExecutionStatus.PARTIAL) {
            return false;
        }
        state.paused = true;
        this.logger.info('TWAP execution paused', { orderId });
        this.emit('executionPaused', { orderId });
        return true;
    }
    /**
     * Resume execution
     */
    resumeExecution(orderId) {
        const state = this.activeOrders.get(orderId);
        if (!state || !state.paused) {
            return false;
        }
        state.paused = false;
        this.logger.info('TWAP execution resumed', { orderId });
        this.emit('executionResumed', { orderId });
        return true;
    }
    /**
     * Cancel execution
     */
    cancelExecution(orderId) {
        const state = this.activeOrders.get(orderId);
        if (!state || state.status === types_1.ExecutionStatus.COMPLETED) {
            return false;
        }
        state.status = types_1.ExecutionStatus.CANCELLED;
        this.logger.info('TWAP execution cancelled', {
            orderId,
            executedQuantity: state.executedQuantity
        });
        this.emit('executionCancelled', {
            orderId,
            executedQuantity: state.executedQuantity,
            remainingQuantity: state.remainingQuantity
        });
        return true;
    }
    // Private methods
    validateParameters(params) {
        if (!params.duration || params.duration <= 0) {
            throw new types_1.ExecutionError('Invalid TWAP duration', types_1.ExecutionErrorCode.INVALID_ORDER);
        }
        if (!params.slices || params.slices <= 0) {
            throw new types_1.ExecutionError('Invalid number of slices', types_1.ExecutionErrorCode.INVALID_ORDER);
        }
    }
    initializeTWAPState(order, params) {
        const slices = params.slices || 10;
        const duration = params.duration || 3600000; // 1 hour default
        const interval = duration / slices;
        const sliceQuantity = order.quantity / slices;
        const startTime = params.startTime || Date.now();
        const endTime = startTime + duration;
        // Create slices
        const twapSlices = [];
        for (let i = 0; i < slices; i++) {
            twapSlices.push({
                index: i,
                quantity: sliceQuantity,
                targetTime: startTime + (i * interval),
                executedQuantity: 0,
                status: 'pending',
                attempts: 0,
                fills: []
            });
        }
        return {
            orderId: order.id,
            totalQuantity: order.quantity,
            executedQuantity: 0,
            remainingQuantity: order.quantity,
            slices: twapSlices,
            currentSlice: 0,
            startTime,
            endTime,
            fills: [],
            status: types_1.ExecutionStatus.PARTIAL,
            paused: false
        };
    }
    startExecutionLoop() {
        this.executionTimer = setInterval(() => {
            this.processActiveOrders();
        }, 1000); // Check every second
    }
    startMetricsCollection() {
        this.metricsInterval = setInterval(() => {
            this.collectAndEmitMetrics();
        }, 5000); // Every 5 seconds
    }
    async processActiveOrders() {
        const now = Date.now();
        for (const [orderId, state] of this.activeOrders) {
            if (state.paused || state.status !== types_1.ExecutionStatus.PARTIAL) {
                continue;
            }
            // Check if we should execute next slice
            const currentSlice = state.slices[state.currentSlice];
            if (currentSlice && currentSlice.targetTime <= now &&
                currentSlice.status === 'pending') {
                // Execute slice
                await this.executeSlice(orderId, state.currentSlice);
            }
            // Check if execution is complete
            if (state.executedQuantity >= state.totalQuantity * 0.99) {
                this.completeExecution(orderId);
            }
            // Check if execution timed out
            if (now > state.endTime && state.remainingQuantity > 0) {
                this.handleTimeout(orderId);
            }
        }
    }
    async executeSlice(orderId, sliceIndex) {
        const state = this.activeOrders.get(orderId);
        if (!state)
            return;
        const slice = state.slices[sliceIndex];
        if (!slice || slice.status !== 'pending')
            return;
        slice.status = 'executing';
        slice.attempts++;
        this.logger.debug('Executing TWAP slice', {
            orderId,
            sliceIndex,
            quantity: slice.quantity
        });
        try {
            // Create child order for this slice
            const childOrder = {
                id: `${orderId}-slice-${sliceIndex}`,
                clientOrderId: `twap-${orderId}-${sliceIndex}`,
                symbol: 'BTC/USDT', // Would come from original order
                side: types_1.OrderSide.BUY, // Would come from original order
                type: types_1.OrderType.LIMIT,
                amount: slice.quantity,
                quantity: slice.quantity,
                price: await this.calculateSlicePrice(),
                timestamp: Date.now(),
                timeInForce: types_1.TimeInForce.IOC,
                status: types_1.OrderStatus.NEW,
                exchange: 'best', // Router will determine
                createdAt: Date.now(),
                updatedAt: Date.now(),
                metadata: {
                    algorithm: 'TWAP',
                    parentOrder: orderId,
                    urgency: 'medium'
                }
            };
            // Execute through router (mock implementation)
            const fill = await this.executeChildOrder(childOrder);
            // Update slice
            slice.executedQuantity = fill.quantity;
            slice.fills.push(fill);
            slice.status = 'completed';
            // Update state
            state.executedQuantity += fill.quantity;
            state.remainingQuantity -= fill.quantity;
            state.fills.push(fill);
            // Move to next slice
            if (state.currentSlice < state.slices.length - 1) {
                state.currentSlice++;
            }
            // Emit progress event
            this.emit('sliceExecuted', {
                orderId,
                sliceIndex,
                fill,
                progress: state.executedQuantity / state.totalQuantity
            });
        }
        catch (error) {
            this.logger.error('Slice execution failed', { orderId, sliceIndex, error });
            slice.status = 'failed';
            // Retry logic
            if (slice.attempts < 3) {
                setTimeout(() => {
                    slice.status = 'pending';
                }, 5000); // Retry after 5 seconds
            }
        }
    }
    async calculateSlicePrice() {
        // In production, would fetch current market price
        // and apply slight premium/discount for limit orders
        const marketPrice = 50000; // Mock BTC price
        return marketPrice * 0.999; // Slight discount for buying
    }
    async executeChildOrder(order) {
        // Mock execution - in production would use SmartOrderRouter
        await new Promise(resolve => setTimeout(resolve, 100));
        return {
            id: `fill-${Date.now()}`,
            orderId: order.id,
            symbol: order.symbol,
            exchange: 'binance',
            price: order.price || 50000,
            quantity: order.quantity ?? order.amount,
            fee: (order.quantity ?? order.amount) * (order.price || 50000) * 0.0001,
            timestamp: Date.now(),
            side: order.side,
            liquidity: 'taker',
            tradeId: `trade-${Date.now()}`
        };
    }
    async executeNextSlice(orderId, router) {
        const state = this.activeOrders.get(orderId);
        if (!state)
            return;
        // Find next pending slice
        const nextSlice = state.slices.find(s => s.status === 'pending');
        if (!nextSlice) {
            this.completeExecution(orderId);
            return;
        }
        // Wait for target time
        const delay = Math.max(0, nextSlice.targetTime - Date.now());
        setTimeout(() => {
            this.executeSlice(orderId, nextSlice.index);
        }, delay);
    }
    completeExecution(orderId) {
        const state = this.activeOrders.get(orderId);
        if (!state)
            return;
        state.status = types_1.ExecutionStatus.COMPLETED;
        const result = this.createExecutionResult(state);
        this.logger.info('TWAP execution completed', {
            orderId,
            executedQuantity: state.executedQuantity,
            fills: state.fills.length
        });
        this.emit('executionCompleted', result);
        // Clean up after delay
        setTimeout(() => {
            this.activeOrders.delete(orderId);
        }, 60000); // Keep for 1 minute for queries
    }
    handleTimeout(orderId) {
        const state = this.activeOrders.get(orderId);
        if (!state)
            return;
        state.status = types_1.ExecutionStatus.EXPIRED;
        this.logger.warn('TWAP execution timed out', {
            orderId,
            executedQuantity: state.executedQuantity,
            remainingQuantity: state.remainingQuantity
        });
        const result = this.createExecutionResult(state);
        this.emit('executionTimeout', result);
    }
    createExecutionResult(state) {
        const totalValue = state.fills.reduce((sum, fill) => sum + fill.quantity * fill.price, 0);
        const totalQuantity = state.fills.reduce((sum, fill) => sum + fill.quantity, 0);
        const totalFees = state.fills.reduce((sum, fill) => sum + fill.fee, 0);
        const averagePrice = totalQuantity > 0 ? totalValue / totalQuantity : 0;
        const metrics = this.calculateMetrics(state);
        // Map ExecutionStatus to OrderStatus
        const orderStatus = state.status === types_1.ExecutionStatus.COMPLETED ? types_1.OrderStatus.FILLED :
            state.status === types_1.ExecutionStatus.PARTIAL ? types_1.OrderStatus.PARTIALLY_FILLED :
                state.status === types_1.ExecutionStatus.FAILED ? types_1.OrderStatus.REJECTED :
                    state.status === types_1.ExecutionStatus.CANCELLED ? types_1.OrderStatus.CANCELLED :
                        types_1.OrderStatus.OPEN;
        return {
            orderId: state.orderId,
            status: orderStatus,
            fills: state.fills,
            averagePrice,
            totalQuantity,
            totalFees,
            slippage: metrics.slippage,
            marketImpact: 0, // Would calculate from market data
            executionTime: Date.now() - state.startTime,
            routes: this.aggregateRoutes(state),
            performance: {
                slippageBps: metrics.slippage * 10000,
                implementationShortfall: 0,
                fillRate: totalQuantity / state.totalQuantity,
                reversion: 0,
                benchmarkDeviation: metrics.deviation,
                vwapDeviation: metrics.actualVWAP - metrics.targetVWAP,
                opportunityCost: 0,
                totalCost: totalFees + (metrics.slippage * totalValue)
            }
        };
    }
    calculateMetrics(state) {
        const totalValue = state.fills.reduce((sum, fill) => sum + fill.quantity * fill.price, 0);
        const totalQuantity = state.fills.reduce((sum, fill) => sum + fill.quantity, 0);
        const actualVWAP = totalQuantity > 0 ? totalValue / totalQuantity : 0;
        // Calculate target VWAP (simplified)
        const targetVWAP = 50000; // Would calculate from market data
        const slippage = actualVWAP > 0
            ? (actualVWAP - targetVWAP) / targetVWAP
            : 0;
        const executionRate = state.executedQuantity / state.totalQuantity;
        const deviation = Math.abs(actualVWAP - targetVWAP) / targetVWAP;
        const completionPercentage = (state.executedQuantity / state.totalQuantity) * 100;
        return {
            actualVWAP,
            targetVWAP,
            slippage,
            executionRate,
            deviation,
            completionPercentage
        };
    }
    aggregateRoutes(state) {
        const routeMap = new Map();
        for (const fill of state.fills) {
            const exchange = fill.exchange ?? fill.venue ?? 'unknown';
            const existing = routeMap.get(exchange);
            if (existing) {
                existing.quantity += fill.quantity;
                existing.fills.push(fill);
                if (existing.fees !== undefined) {
                    existing.fees += fill.fee;
                }
                existing.totalFee += fill.fee;
            }
            else {
                routeMap.set(exchange, {
                    venue: exchange,
                    quantity: fill.quantity,
                    priority: 1,
                    fills: [fill],
                    avgPrice: fill.price,
                    averagePrice: fill.price,
                    totalFee: fill.fee,
                    fees: fill.fee
                });
            }
        }
        // Calculate average prices
        for (const route of routeMap.values()) {
            const exchangeFills = state.fills.filter(f => f.exchange === route.exchange);
            const totalValue = exchangeFills.reduce((sum, f) => sum + f.quantity * f.price, 0);
            route.averagePrice = totalValue / route.quantity;
        }
        return Array.from(routeMap.values());
    }
    collectAndEmitMetrics() {
        for (const [orderId, state] of this.activeOrders) {
            if (state.status === types_1.ExecutionStatus.PARTIAL) {
                const metrics = this.calculateMetrics(state);
                this.emit('metricsUpdate', {
                    orderId,
                    metrics,
                    timestamp: Date.now()
                });
            }
        }
    }
    /**
     * Get all active TWAP executions
     */
    getActiveExecutions() {
        return new Map(this.activeOrders);
    }
    /**
     * Clean up resources
     */
    destroy() {
        if (this.executionTimer) {
            clearInterval(this.executionTimer);
            this.executionTimer = undefined;
        }
        if (this.metricsInterval) {
            clearInterval(this.metricsInterval);
            this.metricsInterval = undefined;
        }
        this.removeAllListeners();
    }
}
exports.TWAPAlgorithm = TWAPAlgorithm;
//# sourceMappingURL=TWAPAlgorithm.js.map