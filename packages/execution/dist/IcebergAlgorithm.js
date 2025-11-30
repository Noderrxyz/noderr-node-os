"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IcebergAlgorithm = void 0;
const types_1 = require("@noderr/types");
const events_1 = __importDefault(require("events"));
class IcebergAlgorithm extends events_1.default {
    logger;
    activeOrders;
    executionLoop;
    microstructureAnalyzer;
    detectionMonitor;
    marketMicrostructure;
    constructor(logger) {
        super();
        this.logger = logger;
        this.activeOrders = new Map();
        this.marketMicrostructure = new Map();
        // Start monitoring loops
        this.startExecutionLoop();
        this.startMicrostructureAnalysis();
        this.startDetectionMonitoring();
    }
    /**
     * Execute order using Iceberg algorithm
     */
    async execute(order, config, router) {
        this.logger.info('Starting Iceberg execution', {
            orderId: order.id,
            totalQuantity: order.quantity,
            visibleQuantity: config.parameters.visibleQuantity,
            variance: config.parameters.variance
        });
        // Validate parameters
        this.validateParameters(config.parameters, order);
        // Analyze market microstructure
        const microstructure = await this.analyzeMarketMicrostructure(order.symbol);
        // Initialize Iceberg state
        const state = this.initializeIcebergState(order, config.parameters, microstructure);
        this.activeOrders.set(order.id, state);
        // Store microstructure data
        this.marketMicrostructure.set(order.symbol, microstructure);
        // Emit start event
        this.emit('executionStarted', {
            orderId: order.id,
            algorithm: 'ICEBERG',
            parameters: config.parameters,
            hiddenQuantity: order.quantity - state.visibleQuantity
        });
        // Place first clip
        await this.placeNextClip(order.id, router);
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
     * Update price level for limit orders
     */
    updatePriceLevel(orderId, newPrice) {
        const state = this.activeOrders.get(orderId);
        if (!state || state.status !== types_1.ExecutionStatus.PARTIAL) {
            return false;
        }
        state.priceLevel = newPrice;
        // Cancel current clip if active
        if (state.currentClip && state.currentClip.status === 'active') {
            this.cancelClip(state.currentClip);
        }
        this.logger.info('Updated Iceberg price level', {
            orderId,
            newPrice
        });
        return true;
    }
    // Private methods
    validateParameters(params, order) {
        if (!params.visibleQuantity || params.visibleQuantity <= 0) {
            throw new types_1.ExecutionError('Invalid visible quantity', types_1.ExecutionErrorCode.INVALID_ORDER);
        }
        if (params.visibleQuantity >= (order.quantity ?? order.amount)) {
            throw new types_1.ExecutionError('Visible quantity must be less than total quantity', types_1.ExecutionErrorCode.INVALID_ORDER);
        }
        if (params.variance && (params.variance < 0 || params.variance > 1)) {
            throw new types_1.ExecutionError('Variance must be between 0 and 1', types_1.ExecutionErrorCode.INVALID_ORDER);
        }
    }
    async analyzeMarketMicrostructure(symbol) {
        // In production, this would analyze real order book data
        // Mock implementation with realistic values
        const avgOrderSize = 0.5; // BTC
        const tickSize = 0.01; // Price tick
        return {
            avgOrderSize,
            orderSizeDistribution: {
                p25: avgOrderSize * 0.25,
                p50: avgOrderSize * 0.5,
                p75: avgOrderSize * 1.5,
                p90: avgOrderSize * 3,
                p95: avgOrderSize * 5,
                max: avgOrderSize * 20
            },
            participantProfile: {
                retailPercentage: 30,
                institutionalPercentage: 50,
                algoPercentage: 20,
                avgClipSize: avgOrderSize * 0.8
            },
            liquidityDepth: 100, // BTC within 10bps
            tickSize,
            lastUpdate: Date.now()
        };
    }
    initializeIcebergState(order, params, microstructure) {
        const visibleQuantity = params.visibleQuantity || microstructure.avgOrderSize;
        const variance = params.variance || 0.2;
        return {
            orderId: order.id,
            symbol: order.symbol,
            totalQuantity: order.quantity ?? order.amount,
            executedQuantity: 0,
            remainingQuantity: order.quantity ?? order.amount,
            visibleQuantity,
            variance,
            currentClip: null,
            clipHistory: [],
            fills: [],
            status: types_1.ExecutionStatus.PARTIAL,
            startTime: Date.now(),
            priceLevel: order.price || 0,
            side: order.side,
            marketMicrostructure: microstructure,
            detectionRisk: 0
        };
    }
    startExecutionLoop() {
        this.executionLoop = setInterval(() => {
            this.processActiveOrders();
        }, 100); // Check every 100ms
    }
    startMicrostructureAnalysis() {
        this.microstructureAnalyzer = setInterval(() => {
            this.updateMicrostructure();
        }, 30000); // Update every 30 seconds
    }
    startDetectionMonitoring() {
        this.detectionMonitor = setInterval(() => {
            this.monitorDetectionRisk();
        }, 5000); // Check every 5 seconds
    }
    async processActiveOrders() {
        for (const [orderId, state] of this.activeOrders) {
            if (state.status !== types_1.ExecutionStatus.PARTIAL) {
                continue;
            }
            // Check if current clip is filled
            if (state.currentClip && state.currentClip.status === 'filled') {
                // Place next clip
                await this.placeNextClip(orderId, null);
            }
            // Check completion
            if (state.executedQuantity >= state.totalQuantity * 0.999) {
                this.completeExecution(orderId);
            }
        }
    }
    async placeNextClip(orderId, router) {
        const state = this.activeOrders.get(orderId);
        if (!state || state.remainingQuantity <= 0)
            return;
        // Calculate clip size with variance
        const clipSize = this.calculateClipSize(state);
        if (clipSize < 0.0001) {
            // Remaining too small, execute as final clip
            await this.placeFinalClip(state, router);
            return;
        }
        // Create new clip
        const clip = {
            id: `${orderId}-clip-${state.clipHistory.length}`,
            quantity: clipSize,
            visibleQuantity: Math.min(clipSize, state.visibleQuantity),
            executedQuantity: 0,
            price: state.priceLevel,
            status: 'pending',
            placedAt: Date.now(),
            fills: [],
            detectionScore: 0
        };
        state.currentClip = clip;
        state.clipHistory.push(clip);
        // Place the order
        await this.placeClipOrder(state, clip, router);
        this.logger.debug('Placed Iceberg clip', {
            orderId,
            clipId: clip.id,
            visibleQuantity: clip.visibleQuantity,
            hiddenQuantity: clip.quantity - clip.visibleQuantity
        });
    }
    calculateClipSize(state) {
        const baseSize = state.visibleQuantity;
        const variance = state.variance;
        // Apply variance to make clips less predictable
        const randomFactor = 1 + (Math.random() - 0.5) * 2 * variance;
        let clipSize = baseSize * randomFactor;
        // Ensure clip size is reasonable based on market microstructure
        const microstructure = state.marketMicrostructure;
        // Don't exceed 95th percentile to avoid standing out
        clipSize = Math.min(clipSize, microstructure.orderSizeDistribution.p95);
        // Adjust based on remaining quantity
        clipSize = Math.min(clipSize, state.remainingQuantity);
        // Round to reasonable precision
        clipSize = Math.round(clipSize * 10000) / 10000;
        return clipSize;
    }
    async placeFinalClip(state, router) {
        const clip = {
            id: `${state.orderId}-final`,
            quantity: state.remainingQuantity,
            visibleQuantity: state.remainingQuantity,
            executedQuantity: 0,
            price: state.priceLevel,
            status: 'pending',
            placedAt: Date.now(),
            fills: [],
            detectionScore: 0
        };
        state.currentClip = clip;
        state.clipHistory.push(clip);
        await this.placeClipOrder(state, clip, router);
        this.logger.debug('Placed final Iceberg clip', {
            orderId: state.orderId,
            quantity: clip.quantity
        });
    }
    async placeClipOrder(state, clip, router) {
        // Create order for the clip
        const clipOrder = {
            id: clip.id,
            clientOrderId: `iceberg-${clip.id}`,
            symbol: state.symbol,
            side: state.side,
            type: types_1.OrderType.LIMIT,
            amount: clip.visibleQuantity,
            quantity: clip.visibleQuantity,
            price: clip.price,
            timestamp: Date.now(),
            timeInForce: types_1.TimeInForce.GTC,
            status: types_1.OrderStatus.NEW,
            exchange: 'best',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            metadata: {
                algorithm: 'ICEBERG',
                parentOrder: state.orderId,
                isIcebergClip: true,
                hiddenQuantity: clip.quantity - clip.visibleQuantity
            }
        };
        // Execute through router or mock
        clip.status = 'active';
        clip.orderId = clipOrder.id;
        // Simulate execution (in production, would use router)
        this.simulateClipExecution(state, clip);
    }
    simulateClipExecution(state, clip) {
        // Simulate partial fills over time
        const fillInterval = setInterval(() => {
            if (clip.status !== 'active' || clip.executedQuantity >= clip.quantity) {
                clearInterval(fillInterval);
                if (clip.executedQuantity >= clip.quantity) {
                    this.handleClipFilled(state, clip);
                }
                return;
            }
            // Simulate a partial fill
            const fillSize = Math.min(Math.random() * clip.visibleQuantity * 0.3, clip.quantity - clip.executedQuantity);
            const fill = {
                id: `fill-${Date.now()}-${Math.random()}`,
                orderId: clip.orderId || clip.id,
                symbol: state.symbol,
                exchange: 'binance',
                price: clip.price,
                quantity: fillSize,
                fee: fillSize * clip.price * 0.0001,
                timestamp: Date.now(),
                side: state.side,
                liquidity: 'maker',
                tradeId: `trade-${Date.now()}`
            };
            clip.fills.push(fill);
            clip.executedQuantity += fillSize;
            // Update state
            state.executedQuantity += fillSize;
            state.remainingQuantity -= fillSize;
            state.fills.push(fill);
            // Check if visible portion is filled
            if (clip.executedQuantity >= clip.visibleQuantity &&
                clip.executedQuantity < clip.quantity) {
                // Replenish visible quantity
                clip.visibleQuantity = Math.min(state.visibleQuantity, clip.quantity - clip.executedQuantity);
                this.logger.debug('Replenishing Iceberg clip', {
                    clipId: clip.id,
                    newVisibleQuantity: clip.visibleQuantity
                });
            }
            // Emit fill event
            this.emit('clipFill', {
                orderId: state.orderId,
                clipId: clip.id,
                fill,
                progress: state.executedQuantity / state.totalQuantity
            });
        }, 100 + Math.random() * 900); // Random interval 100-1000ms
    }
    handleClipFilled(state, clip) {
        clip.status = 'filled';
        clip.filledAt = Date.now();
        this.logger.debug('Iceberg clip filled', {
            orderId: state.orderId,
            clipId: clip.id,
            executionTime: clip.filledAt - clip.placedAt
        });
        // Calculate detection score for the clip
        clip.detectionScore = this.calculateDetectionScore(state, clip);
        // Update overall detection risk
        this.updateDetectionRisk(state);
    }
    cancelClip(clip) {
        if (clip.status === 'active') {
            clip.status = 'cancelled';
            this.logger.debug('Cancelled Iceberg clip', { clipId: clip.id });
        }
    }
    calculateDetectionScore(state, clip) {
        let score = 0;
        // Factor 1: Clip size consistency
        const avgClipSize = state.clipHistory
            .filter(c => c.status === 'filled')
            .reduce((sum, c) => sum + c.quantity, 0) / Math.max(1, state.clipHistory.length - 1);
        if (avgClipSize > 0) {
            const sizeDeviation = Math.abs(clip.quantity - avgClipSize) / avgClipSize;
            if (sizeDeviation < 0.1) {
                score += 0.3; // Too consistent
            }
        }
        // Factor 2: Timing pattern
        const timingScore = this.analyzeTimingPattern(state);
        score += timingScore * 0.3;
        // Factor 3: Price level persistence
        const samePriceClips = state.clipHistory.filter(c => c.price === clip.price && c.status === 'filled').length;
        if (samePriceClips > 3) {
            score += 0.2;
        }
        // Factor 4: Size relative to market
        const sizePercentile = this.getOrderSizePercentile(clip.quantity, state.marketMicrostructure);
        if (sizePercentile > 90) {
            score += 0.2; // Large orders are more noticeable
        }
        return Math.min(1, score);
    }
    analyzeTimingPattern(state) {
        const filledClips = state.clipHistory.filter(c => c.status === 'filled');
        if (filledClips.length < 3)
            return 0;
        // Calculate inter-arrival times
        const intervals = [];
        for (let i = 1; i < filledClips.length; i++) {
            intervals.push(filledClips[i].placedAt - filledClips[i - 1].placedAt);
        }
        // Check for regular pattern
        const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        const variance = intervals.reduce((sum, i) => sum + Math.pow(i - avgInterval, 2), 0) / intervals.length;
        const coefficientOfVariation = Math.sqrt(variance) / avgInterval;
        // Low CV indicates regular pattern
        return coefficientOfVariation < 0.3 ? 0.8 : 0;
    }
    getOrderSizePercentile(size, microstructure) {
        const dist = microstructure.orderSizeDistribution;
        if (size <= dist.p25)
            return 25;
        if (size <= dist.p50)
            return 50;
        if (size <= dist.p75)
            return 75;
        if (size <= dist.p90)
            return 90;
        if (size <= dist.p95)
            return 95;
        return 99;
    }
    updateDetectionRisk(state) {
        const scores = state.clipHistory
            .filter(c => c.status === 'filled')
            .map(c => c.detectionScore);
        if (scores.length === 0) {
            state.detectionRisk = 0;
            return;
        }
        // Weighted average with recent clips having more weight
        let weightedSum = 0;
        let weightSum = 0;
        for (let i = 0; i < scores.length; i++) {
            const weight = Math.pow(0.9, scores.length - i - 1); // Exponential decay
            weightedSum += scores[i] * weight;
            weightSum += weight;
        }
        state.detectionRisk = weightedSum / weightSum;
        // Alert if detection risk is high
        if (state.detectionRisk > 0.7) {
            this.logger.warn('High Iceberg detection risk', {
                orderId: state.orderId,
                risk: state.detectionRisk
            });
            // Adjust strategy
            this.adjustStrategyForDetection(state);
        }
    }
    adjustStrategyForDetection(state) {
        // Increase variance to make pattern less predictable
        state.variance = Math.min(0.5, state.variance * 1.5);
        // Consider changing price levels
        const tickSize = state.marketMicrostructure.tickSize;
        const priceAdjustment = (Math.random() - 0.5) * tickSize * 5;
        state.priceLevel += priceAdjustment;
        this.logger.info('Adjusted Iceberg strategy for detection avoidance', {
            orderId: state.orderId,
            newVariance: state.variance,
            priceAdjustment
        });
    }
    updateMicrostructure() {
        for (const [symbol, microstructure] of this.marketMicrostructure) {
            // Simulate microstructure updates
            // In production, would fetch real data
            microstructure.avgOrderSize *= (0.95 + Math.random() * 0.1);
            microstructure.liquidityDepth *= (0.9 + Math.random() * 0.2);
            microstructure.lastUpdate = Date.now();
        }
    }
    monitorDetectionRisk() {
        for (const [orderId, state] of this.activeOrders) {
            if (state.status !== types_1.ExecutionStatus.PARTIAL)
                continue;
            // Recalculate detection risk
            this.updateDetectionRisk(state);
            // Emit risk update
            if (state.detectionRisk > 0.5) {
                this.emit('detectionRiskAlert', {
                    orderId,
                    risk: state.detectionRisk,
                    clipsExecuted: state.clipHistory.filter(c => c.status === 'filled').length
                });
            }
        }
    }
    calculateMetrics(state) {
        const filledClips = state.clipHistory.filter(c => c.status === 'filled');
        const activeClips = state.clipHistory.filter(c => c.status === 'active').length;
        const avgClipSize = filledClips.length > 0
            ? filledClips.reduce((sum, c) => sum + c.quantity, 0) / filledClips.length
            : 0;
        const fillRate = state.totalQuantity > 0
            ? state.executedQuantity / state.totalQuantity
            : 0;
        const hiddenRatio = state.totalQuantity > 0
            ? 1 - (state.visibleQuantity / state.totalQuantity)
            : 0;
        // Calculate effective spread (execution price vs initial price)
        const avgExecutionPrice = state.fills.length > 0
            ? state.fills.reduce((sum, f) => sum + f.price * f.quantity, 0) / state.executedQuantity
            : 0;
        const effectiveSpread = state.priceLevel > 0
            ? Math.abs(avgExecutionPrice - state.priceLevel) / state.priceLevel
            : 0;
        // Calculate price improvement
        const priceImprovement = state.side === types_1.OrderSide.BUY
            ? state.priceLevel - avgExecutionPrice
            : avgExecutionPrice - state.priceLevel;
        return {
            totalClips: state.clipHistory.length,
            activeClips,
            averageClipSize: avgClipSize,
            fillRate,
            detectionRisk: state.detectionRisk,
            hiddenRatio,
            completionPercentage: fillRate * 100,
            effectiveSpread,
            priceImprovement: Math.max(0, priceImprovement)
        };
    }
    completeExecution(orderId) {
        const state = this.activeOrders.get(orderId);
        if (!state)
            return;
        state.status = types_1.ExecutionStatus.COMPLETED;
        state.endTime = Date.now();
        const result = this.createExecutionResult(state);
        const metrics = this.calculateMetrics(state);
        this.logger.info('Iceberg execution completed', {
            orderId,
            totalClips: metrics.totalClips,
            averageClipSize: metrics.averageClipSize,
            detectionRisk: metrics.detectionRisk,
            effectiveSpread: (metrics.effectiveSpread * 10000).toFixed(1) + ' bps'
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
            slippage: metrics.effectiveSpread,
            marketImpact: 0, // Iceberg minimizes market impact
            executionTime: (state.endTime || Date.now()) - state.startTime,
            routes: this.aggregateRoutes(state),
            performance: {
                slippageBps: metrics.effectiveSpread * 10000,
                implementationShortfall: 0,
                fillRate: metrics.fillRate,
                reversion: 0,
                benchmarkDeviation: 0,
                opportunityCost: 0,
                totalCost: totalFees
            }
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
    /**
     * Cancel Iceberg execution
     */
    cancelExecution(orderId) {
        const state = this.activeOrders.get(orderId);
        if (!state || state.status === types_1.ExecutionStatus.COMPLETED) {
            return false;
        }
        // Cancel active clip
        if (state.currentClip && state.currentClip.status === 'active') {
            this.cancelClip(state.currentClip);
        }
        state.status = types_1.ExecutionStatus.CANCELLED;
        state.endTime = Date.now();
        const metrics = this.calculateMetrics(state);
        this.logger.info('Iceberg execution cancelled', {
            orderId,
            executedQuantity: state.executedQuantity,
            remainingQuantity: state.remainingQuantity,
            clipsExecuted: metrics.totalClips
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
     * Get all active Iceberg executions
     */
    getActiveExecutions() {
        return new Map(this.activeOrders);
    }
    /**
     * Clean up resources
     */
    destroy() {
        if (this.executionLoop) {
            clearInterval(this.executionLoop);
            this.executionLoop = undefined;
        }
        if (this.microstructureAnalyzer) {
            clearInterval(this.microstructureAnalyzer);
            this.microstructureAnalyzer = undefined;
        }
        if (this.detectionMonitor) {
            clearInterval(this.detectionMonitor);
            this.detectionMonitor = undefined;
        }
        this.removeAllListeners();
    }
}
exports.IcebergAlgorithm = IcebergAlgorithm;
//# sourceMappingURL=IcebergAlgorithm.js.map