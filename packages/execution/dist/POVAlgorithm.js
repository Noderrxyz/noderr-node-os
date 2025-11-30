"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.POVAlgorithm = void 0;
const types_1 = require("@noderr/types");
const events_1 = __importDefault(require("events"));
class POVAlgorithm extends events_1.default {
    logger;
    activeOrders;
    volumeMonitor;
    executionLoop;
    adaptiveAdjuster;
    volumeBuffer;
    constructor(logger) {
        super();
        this.logger = logger;
        this.activeOrders = new Map();
        this.volumeBuffer = new Map();
        // Start monitoring loops
        this.startVolumeMonitoring();
        this.startExecutionLoop();
        this.startAdaptiveAdjustment();
    }
    /**
     * Execute order using POV algorithm
     */
    async execute(order, config, router) {
        this.logger.info('Starting POV execution', {
            orderId: order.id,
            quantity: order.quantity,
            targetPercentage: config.parameters.targetPercentage,
            maxPercentage: config.parameters.maxPercentage
        });
        // Validate parameters
        this.validateParameters(config.parameters);
        // Initialize POV state
        const state = this.initializePOVState(order, config.parameters);
        this.activeOrders.set(order.id, state);
        // Initialize volume tracking for symbol
        if (!this.volumeBuffer.has(order.symbol)) {
            this.volumeBuffer.set(order.symbol, []);
        }
        // Emit start event
        this.emit('executionStarted', {
            orderId: order.id,
            algorithm: 'POV',
            parameters: config.parameters
        });
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
     * Update market volume data
     */
    updateMarketVolume(symbol, volume, price) {
        const point = {
            timestamp: Date.now(),
            marketVolume: volume,
            ourVolume: 0,
            price
        };
        const buffer = this.volumeBuffer.get(symbol) || [];
        buffer.push(point);
        // Keep only recent data (last 1000 points)
        if (buffer.length > 1000) {
            buffer.shift();
        }
        this.volumeBuffer.set(symbol, buffer);
        // Update active orders tracking this symbol
        this.updateActiveOrdersVolume(symbol, volume);
    }
    // Private methods
    validateParameters(params) {
        if (!params.targetPercentage || params.targetPercentage <= 0 || params.targetPercentage > 100) {
            throw new types_1.ExecutionError('Invalid target percentage (must be 0-100)', types_1.ExecutionErrorCode.INVALID_ORDER);
        }
        if (params.maxPercentage && params.maxPercentage < params.targetPercentage) {
            throw new types_1.ExecutionError('Max percentage must be >= target percentage', types_1.ExecutionErrorCode.INVALID_ORDER);
        }
    }
    initializePOVState(order, params) {
        const targetPercentage = params.targetPercentage || 10;
        const maxPercentage = params.maxPercentage || Math.min(targetPercentage * 1.5, 50);
        return {
            orderId: order.id,
            totalQuantity: order.quantity,
            executedQuantity: 0,
            remainingQuantity: order.quantity,
            targetPercentage: targetPercentage / 100,
            maxPercentage: maxPercentage / 100,
            adaptiveMode: params.adaptiveMode !== false,
            volumeTracking: {
                marketVolume: 0,
                ourVolume: 0,
                participationRate: 0,
                volumeHistory: [],
                movingAverage: 0,
                volatility: 0
            },
            fills: [],
            status: types_1.ExecutionStatus.PARTIAL,
            startTime: Date.now(),
            currentParticipation: 0,
            executionHistory: []
        };
    }
    startVolumeMonitoring() {
        this.volumeMonitor = setInterval(() => {
            this.updateVolumeTracking();
        }, 1000); // Update every second
    }
    startExecutionLoop() {
        this.executionLoop = setInterval(() => {
            this.processActiveOrders();
        }, 100); // Check every 100ms for tight control
    }
    startAdaptiveAdjustment() {
        this.adaptiveAdjuster = setInterval(() => {
            this.performAdaptiveAdjustments();
        }, 5000); // Adjust every 5 seconds
    }
    updateVolumeTracking() {
        // Simulate volume updates for active symbols
        for (const [symbol, buffer] of this.volumeBuffer) {
            const recentVolume = this.calculateRecentVolume(buffer);
            const price = buffer[buffer.length - 1]?.price || 50000;
            // Simulate new volume
            const newVolume = 100 + Math.random() * 500;
            this.updateMarketVolume(symbol, newVolume, price);
        }
    }
    calculateRecentVolume(buffer) {
        const oneMinuteAgo = Date.now() - 60000;
        const recentPoints = buffer.filter(p => p.timestamp > oneMinuteAgo);
        return recentPoints.reduce((sum, p) => sum + p.marketVolume, 0);
    }
    updateActiveOrdersVolume(symbol, volume) {
        for (const [orderId, state] of this.activeOrders) {
            // Check if order is for this symbol (would need symbol in state)
            state.volumeTracking.marketVolume += volume;
            // Update moving average
            const history = state.volumeTracking.volumeHistory;
            history.push({
                timestamp: Date.now(),
                marketVolume: volume,
                ourVolume: 0,
                price: 50000 // Would get from market data
            });
            // Keep last 100 points
            if (history.length > 100) {
                history.shift();
            }
            // Calculate moving average and volatility
            this.updateVolumeStatistics(state.volumeTracking);
        }
    }
    updateVolumeStatistics(tracking) {
        const history = tracking.volumeHistory;
        if (history.length < 2)
            return;
        // Calculate moving average
        const volumes = history.map(h => h.marketVolume);
        tracking.movingAverage = volumes.reduce((a, b) => a + b, 0) / volumes.length;
        // Calculate volatility
        const mean = tracking.movingAverage;
        const variance = volumes.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / volumes.length;
        tracking.volatility = Math.sqrt(variance) / mean;
        // Update participation rate
        tracking.participationRate = tracking.ourVolume / tracking.marketVolume;
    }
    async processActiveOrders() {
        for (const [orderId, state] of this.activeOrders) {
            if (state.status !== types_1.ExecutionStatus.PARTIAL) {
                continue;
            }
            // Check if we should execute
            if (this.shouldExecute(state)) {
                await this.executeSlice(orderId, state);
            }
            // Check completion
            if (state.executedQuantity >= state.totalQuantity * 0.99) {
                this.completeExecution(orderId);
            }
        }
    }
    shouldExecute(state) {
        // Don't execute if no recent volume
        if (state.volumeTracking.volumeHistory.length === 0) {
            return false;
        }
        // Calculate current participation rate
        const recentVolume = this.getRecentMarketVolume(state);
        const ourRecentVolume = this.getOurRecentVolume(state);
        const currentRate = recentVolume > 0 ? ourRecentVolume / recentVolume : 0;
        // Execute if below target participation
        return currentRate < state.targetPercentage;
    }
    getRecentMarketVolume(state) {
        const fiveSecondsAgo = Date.now() - 5000;
        const recent = state.volumeTracking.volumeHistory.filter(h => h.timestamp > fiveSecondsAgo);
        return recent.reduce((sum, h) => sum + h.marketVolume, 0);
    }
    getOurRecentVolume(state) {
        const fiveSecondsAgo = Date.now() - 5000;
        const recent = state.executionHistory.filter(h => h.timestamp > fiveSecondsAgo);
        return recent.reduce((sum, h) => sum + h.quantity, 0);
    }
    async executeSlice(orderId, state) {
        try {
            // Calculate execution size
            const size = this.calculateExecutionSize(state);
            if (size < 0.0001) {
                return; // Too small to execute
            }
            // Create child order
            const childOrder = this.createChildOrder(orderId, size);
            // Execute (mock)
            const fill = await this.executeChildOrder(childOrder);
            // Update state
            state.executedQuantity += fill.quantity;
            state.remainingQuantity -= fill.quantity;
            state.fills.push(fill);
            // Update volume tracking
            state.volumeTracking.ourVolume += fill.quantity;
            const history = state.volumeTracking.volumeHistory;
            if (history.length > 0) {
                history[history.length - 1].ourVolume += fill.quantity;
            }
            // Record execution snapshot
            const snapshot = {
                timestamp: Date.now(),
                quantity: fill.quantity,
                participationRate: this.calculateCurrentParticipation(state),
                marketVolume: state.volumeTracking.marketVolume,
                price: fill.price,
                impact: this.estimateMarketImpact(fill.quantity, state)
            };
            state.executionHistory.push(snapshot);
            state.currentParticipation = snapshot.participationRate;
            // Emit progress
            this.emit('sliceExecuted', {
                orderId,
                fill,
                metrics: this.calculateMetrics(state)
            });
        }
        catch (error) {
            this.logger.error('POV slice execution failed', { orderId, error });
        }
    }
    calculateExecutionSize(state) {
        // Get recent market volume rate (per second)
        const recentVolume = this.getRecentMarketVolume(state);
        const volumeRate = recentVolume / 5; // 5 second window
        // Calculate target execution rate
        const targetRate = volumeRate * state.targetPercentage;
        // Adjust for remaining quantity
        const maxSize = state.remainingQuantity;
        let size = Math.min(targetRate * 0.1, maxSize); // Execute for next 100ms
        // Apply adaptive adjustments
        if (state.adaptiveMode) {
            size = this.applyAdaptiveAdjustments(size, state);
        }
        // Apply max percentage constraint
        const maxAllowed = volumeRate * state.maxPercentage * 0.1;
        size = Math.min(size, maxAllowed);
        return size;
    }
    applyAdaptiveAdjustments(size, state) {
        // Increase size if we're behind schedule
        const elapsed = Date.now() - state.startTime;
        const expectedProgress = Math.min(1, elapsed / (8 * 3600000)); // Assume 8 hour day
        const actualProgress = state.executedQuantity / state.totalQuantity;
        if (actualProgress < expectedProgress * 0.9) {
            // Behind schedule - increase size
            size *= 1.2;
        }
        else if (actualProgress > expectedProgress * 1.1) {
            // Ahead of schedule - decrease size
            size *= 0.8;
        }
        // Adjust based on volatility
        if (state.volumeTracking.volatility > 0.3) {
            // High volatility - be more conservative
            size *= 0.9;
        }
        // Adjust based on recent impact
        const recentImpact = this.getRecentMarketImpact(state);
        if (recentImpact > 0.001) { // 10 bps
            size *= 0.8; // Reduce size if causing impact
        }
        return size;
    }
    getRecentMarketImpact(state) {
        const recentSnapshots = state.executionHistory.slice(-10);
        if (recentSnapshots.length === 0)
            return 0;
        const avgImpact = recentSnapshots.reduce((sum, s) => sum + s.impact, 0) / recentSnapshots.length;
        return avgImpact;
    }
    estimateMarketImpact(quantity, state) {
        // Simple impact model
        const participation = quantity / (state.volumeTracking.movingAverage || 1000);
        return participation * 0.0001; // 1 bp per 100% participation
    }
    calculateCurrentParticipation(state) {
        const marketVolume = state.volumeTracking.marketVolume;
        const ourVolume = state.volumeTracking.ourVolume;
        return marketVolume > 0 ? ourVolume / marketVolume : 0;
    }
    createChildOrder(parentOrderId, quantity) {
        return {
            id: `${parentOrderId}-pov-${Date.now()}`,
            clientOrderId: `pov-${parentOrderId}-${Date.now()}`,
            symbol: 'BTC/USDT',
            side: types_1.OrderSide.BUY,
            type: types_1.OrderType.MARKET,
            amount: quantity,
            quantity,
            timestamp: Date.now(),
            timeInForce: types_1.TimeInForce.IOC,
            status: types_1.OrderStatus.NEW,
            exchange: 'best',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            metadata: {
                algorithm: 'POV',
                parentOrder: parentOrderId,
                urgency: 'medium'
            }
        };
    }
    async executeChildOrder(order) {
        // Mock execution
        await new Promise(resolve => setTimeout(resolve, 50));
        return {
            id: `fill-${Date.now()}`,
            orderId: order.id,
            symbol: order.symbol,
            exchange: 'binance',
            price: 50000 + Math.random() * 100,
            quantity: order.quantity ?? order.amount,
            fee: (order.quantity ?? order.amount) * 50000 * 0.0001,
            timestamp: Date.now(),
            side: order.side,
            liquidity: 'taker',
            tradeId: `trade-${Date.now()}`
        };
    }
    performAdaptiveAdjustments() {
        for (const [orderId, state] of this.activeOrders) {
            if (!state.adaptiveMode || state.status !== types_1.ExecutionStatus.PARTIAL) {
                continue;
            }
            const metrics = this.calculateMetrics(state);
            // Adjust target percentage if needed
            if (metrics.actualParticipation > metrics.targetParticipation * 1.2) {
                // Participating too much - might be in thin market
                state.targetPercentage = Math.max(0.01, state.targetPercentage * 0.9);
                this.logger.info('Reduced POV target due to thin market', {
                    orderId,
                    newTarget: state.targetPercentage
                });
            }
            // Check if we need to be more aggressive
            const timeRemaining = this.estimateTimeRemaining(state);
            if (timeRemaining < 3600000 && state.remainingQuantity > state.totalQuantity * 0.5) {
                // Less than 1 hour left with >50% remaining
                state.targetPercentage = Math.min(state.maxPercentage, state.targetPercentage * 1.2);
                this.logger.info('Increased POV target due to time pressure', {
                    orderId,
                    newTarget: state.targetPercentage
                });
            }
        }
    }
    estimateTimeRemaining(state) {
        const currentRate = state.executedQuantity / (Date.now() - state.startTime);
        if (currentRate === 0)
            return Infinity;
        return state.remainingQuantity / currentRate;
    }
    calculateMetrics(state) {
        const participation = this.calculateCurrentParticipation(state);
        // Calculate average participation from history
        const avgParticipation = state.executionHistory.length > 0
            ? state.executionHistory.reduce((sum, s) => sum + s.participationRate, 0) / state.executionHistory.length
            : 0;
        // Calculate min/max participation
        const participations = state.executionHistory.map(s => s.participationRate);
        const maxParticipation = participations.length > 0 ? Math.max(...participations) : 0;
        const minParticipation = participations.length > 0 ? Math.min(...participations) : 0;
        // Calculate impact cost
        const impactCost = state.executionHistory.reduce((sum, s) => sum + s.impact * s.quantity, 0);
        return {
            targetParticipation: state.targetPercentage,
            actualParticipation: participation,
            volumeExecuted: state.executedQuantity,
            marketVolumeTracked: state.volumeTracking.marketVolume,
            completionPercentage: (state.executedQuantity / state.totalQuantity) * 100,
            averageParticipation: avgParticipation,
            maxParticipation,
            minParticipation,
            impactCost
        };
    }
    completeExecution(orderId) {
        const state = this.activeOrders.get(orderId);
        if (!state)
            return;
        state.status = types_1.ExecutionStatus.COMPLETED;
        state.endTime = Date.now();
        const result = this.createExecutionResult(state);
        this.logger.info('POV execution completed', {
            orderId,
            executedQuantity: state.executedQuantity,
            averageParticipation: (this.calculateMetrics(state).averageParticipation * 100).toFixed(2) + '%'
        });
        this.emit('executionCompleted', result);
        // Clean up
        setTimeout(() => {
            this.activeOrders.delete(orderId);
        }, 60000);
    }
    createExecutionResult(state) {
        const metrics = this.calculateMetrics(state);
        const totalValue = state.fills.reduce((sum, f) => sum + f.quantity * f.price, 0);
        const totalQuantity = state.fills.reduce((sum, f) => sum + f.quantity, 0);
        const totalFees = state.fills.reduce((sum, f) => sum + f.fee, 0);
        const averagePrice = totalQuantity > 0 ? totalValue / totalQuantity : 0;
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
            slippage: metrics.impactCost / totalValue,
            marketImpact: metrics.impactCost / totalValue,
            executionTime: (state.endTime || Date.now()) - state.startTime,
            routes: this.aggregateRoutes(state),
            performance: {
                slippageBps: (metrics.impactCost / totalValue) * 10000,
                implementationShortfall: metrics.impactCost,
                fillRate: totalQuantity / state.totalQuantity,
                reversion: 0,
                benchmarkDeviation: Math.abs(metrics.actualParticipation - metrics.targetParticipation),
                opportunityCost: 0,
                totalCost: totalFees + metrics.impactCost
            }
        };
    }
    aggregateRoutes(state) {
        const routeMap = new Map();
        for (const fill of state.fills) {
            const existing = routeMap.get(fill.exchange);
            if (existing) {
                existing.quantity += fill.quantity;
                existing.fills.push(fill);
                if (existing.fees !== undefined) {
                    existing.fees += fill.fee;
                }
                existing.totalFee += fill.fee;
            }
            else {
                routeMap.set(fill.exchange ?? fill.venue ?? 'unknown', {
                    venue: fill.exchange ?? fill.venue ?? 'unknown',
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
    /**
     * Cancel POV execution
     */
    cancelExecution(orderId) {
        const state = this.activeOrders.get(orderId);
        if (!state || state.status === types_1.ExecutionStatus.COMPLETED) {
            return false;
        }
        state.status = types_1.ExecutionStatus.CANCELLED;
        state.endTime = Date.now();
        const metrics = this.calculateMetrics(state);
        this.logger.info('POV execution cancelled', {
            orderId,
            executedQuantity: state.executedQuantity,
            remainingQuantity: state.remainingQuantity,
            averageParticipation: (metrics.averageParticipation * 100).toFixed(2) + '%'
        });
        this.emit('executionCancelled', {
            orderId,
            executedQuantity: state.executedQuantity,
            remainingQuantity: state.remainingQuantity,
            metrics
        });
        return true;
    }
    /**
     * Get all active POV executions
     */
    getActiveExecutions() {
        return new Map(this.activeOrders);
    }
    /**
     * Clean up resources
     */
    destroy() {
        if (this.volumeMonitor) {
            clearInterval(this.volumeMonitor);
            this.volumeMonitor = undefined;
        }
        if (this.executionLoop) {
            clearInterval(this.executionLoop);
            this.executionLoop = undefined;
        }
        if (this.adaptiveAdjuster) {
            clearInterval(this.adaptiveAdjuster);
            this.adaptiveAdjuster = undefined;
        }
        this.removeAllListeners();
    }
}
exports.POVAlgorithm = POVAlgorithm;
//# sourceMappingURL=POVAlgorithm.js.map