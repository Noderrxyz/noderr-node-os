"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CostOptimizer = void 0;
const types_1 = require("@noderr/types");
class CostOptimizer {
    logger;
    feeCache;
    impactModels;
    constructor(logger) {
        this.logger = logger;
        this.feeCache = new Map();
        this.impactModels = new Map();
        // Initialize market impact models
        this.initializeImpactModels();
    }
    /**
     * Optimize execution routes for minimum cost
     */
    async optimizeForCost(routes, order, constraints, objectives) {
        this.logger.debug('Optimizing routes for cost', {
            routeCount: routes.length,
            orderSize: order.quantity
        });
        try {
            // Calculate current cost model
            const currentCost = this.calculateTotalCost(routes, order);
            // Apply various optimization strategies
            let optimizedRoutes = routes;
            // Strategy 1: Fee optimization
            optimizedRoutes = await this.optimizeFees(optimizedRoutes, order);
            // Strategy 2: Slippage minimization
            optimizedRoutes = this.minimizeSlippage(optimizedRoutes, order, constraints);
            // Strategy 3: Market impact reduction
            optimizedRoutes = this.reduceMarketImpact(optimizedRoutes, order);
            // Strategy 4: Timing optimization
            optimizedRoutes = this.optimizeTiming(optimizedRoutes, order, objectives);
            // Calculate optimized cost
            const optimizedCost = this.calculateTotalCost(optimizedRoutes, order);
            const savings = currentCost.totalCost - optimizedCost.totalCost;
            return {
                routes: optimizedRoutes,
                costModel: optimizedCost,
                savings,
                confidence: this.calculateOptimizationConfidence(optimizedRoutes, savings)
            };
        }
        catch (error) {
            this.logger.error('Cost optimization failed', error);
            throw error;
        }
    }
    /**
     * Calculate total execution cost for routes
     */
    calculateTotalCost(routes, order) {
        let fees = 0;
        let slippage = 0;
        let marketImpact = 0;
        let opportunityCost = 0;
        const totalQuantity = routes.reduce((sum, r) => sum + r.quantity, 0);
        const avgPrice = this.calculateWeightedAveragePrice(routes);
        for (const route of routes) {
            // Trading fees
            fees += route.fees ?? 0;
            // Slippage cost
            const slippageCost = (route.slippage ?? 0) * route.quantity * (route.price ?? 0);
            slippage += slippageCost;
            // Market impact
            const impact = this.calculateMarketImpact(route.exchange ?? route.venue, route.quantity, totalQuantity, order.side);
            marketImpact += impact * route.quantity * (route.price ?? 0);
            // Opportunity cost (delayed execution)
            const delay = (route.latency ?? 0) / 1000; // Convert to seconds
            const drift = this.estimatePriceDrift(route.exchange ?? route.venue, delay);
            opportunityCost += Math.abs(drift) * route.quantity * (route.price ?? 0);
        }
        const totalCost = fees + slippage + marketImpact + opportunityCost;
        return {
            fees,
            slippage,
            marketImpact,
            opportunityCost,
            totalCost
        };
    }
    /**
     * Analyze cost breakdown and provide insights
     */
    analyzeCostBreakdown(routes, order) {
        const costModel = this.calculateTotalCost(routes, order);
        const totalValue = routes.reduce((sum, r) => sum + r.quantity * (r.price ?? 0), 0);
        return {
            totalCost: costModel.totalCost,
            fees: costModel.fees,
            slippage: costModel.slippage,
            priceImpact: costModel.marketImpact
        };
    }
    // Optimization strategies
    async optimizeFees(routes, order) {
        const optimized = [];
        for (const route of routes) {
            // Check for fee rebates or maker opportunities
            const fees = await this.getOptimalFees(route.exchange, order);
            // If we can get maker rebate, adjust order type
            if (fees.rebate && fees.rebate > 0 && route.orderType !== 'limit') {
                optimized.push({
                    ...route,
                    orderType: 'limit',
                    fees: -fees.rebate * route.quantity * (route.price ?? 0), // Negative fee = rebate
                    price: (route.price ?? 0) * 0.9999 // Slightly better price to ensure maker
                });
            }
            else {
                optimized.push(route);
            }
        }
        return optimized;
    }
    minimizeSlippage(routes, order, constraints) {
        // Sort routes by expected slippage
        const sorted = [...routes].sort((a, b) => (a.slippage ?? 0) - (b.slippage ?? 0));
        // Redistribute quantity to minimize slippage
        const optimized = [];
        let remainingQuantity = order.quantity ?? order.amount;
        for (const route of sorted) {
            if (remainingQuantity <= 0)
                break;
            // Calculate optimal size for this route
            const maxSize = this.calculateMaxSizeForSlippage(route, constraints.maxSlippage ?? 0.01);
            const allocatedSize = Math.min(remainingQuantity, maxSize, route.quantity);
            if (allocatedSize > 0) {
                optimized.push({
                    ...route,
                    quantity: allocatedSize
                });
                remainingQuantity -= allocatedSize;
            }
        }
        return optimized;
    }
    reduceMarketImpact(routes, order) {
        const optimized = [];
        for (const route of routes) {
            const impactModel = this.impactModels.get(route.exchange);
            if (impactModel) {
                // Calculate optimal execution strategy
                const strategy = this.calculateOptimalExecutionStrategy(route, order, impactModel);
                // Split large orders into smaller chunks
                if (strategy.splitCount > 1) {
                    const chunkSize = route.quantity / strategy.splitCount;
                    for (let i = 0; i < strategy.splitCount; i++) {
                        optimized.push({
                            ...route,
                            quantity: chunkSize,
                            latency: (route.latency ?? 0) + (i * strategy.interval),
                            priority: route.priority - i
                        });
                    }
                }
                else {
                    optimized.push(route);
                }
            }
            else {
                optimized.push(route);
            }
        }
        return optimized;
    }
    optimizeTiming(routes, order, objectives) {
        // If speed is priority, don't delay
        if (objectives.primary === 'speed') {
            return routes;
        }
        // Otherwise, optimize execution timing
        const optimized = [];
        for (const route of routes) {
            const optimalTiming = this.calculateOptimalTiming(route.exchange, order.symbol);
            optimized.push({
                ...route,
                latency: Math.max(route.latency, optimalTiming.delay)
            });
        }
        return optimized;
    }
    // Helper methods
    initializeImpactModels() {
        // Initialize with default market impact models
        const exchanges = ['binance', 'coinbase', 'kraken', 'ftx'];
        for (const exchange of exchanges) {
            this.impactModels.set(exchange, {
                linear: 0.0001, // 1 bps per 1% of ADV
                sqrt: 0.001, // Square root model coefficient
                exponent: 0.6, // Power law exponent
                temporary: 0.5, // Temporary vs permanent impact
                decayRate: 0.1 // Impact decay rate
            });
        }
    }
    calculateMarketImpact(exchange, orderSize, totalSize, side) {
        const model = this.impactModels.get(exchange);
        if (!model)
            return 0.0001; // Default 1 bps
        // Use square root model for market impact
        // Impact = coefficient * sqrt(orderSize / ADV)
        const adv = 1000000; // Mock average daily volume
        const participation = orderSize / adv;
        const impact = model.sqrt * Math.sqrt(participation);
        // Adjust for order side (buys have positive impact, sells negative)
        return side === types_1.OrderSide.BUY ? impact : -impact;
    }
    calculateWeightedAveragePrice(routes) {
        const totalValue = routes.reduce((sum, r) => sum + r.quantity * r.price, 0);
        const totalQuantity = routes.reduce((sum, r) => sum + r.quantity, 0);
        return totalQuantity > 0 ? totalValue / totalQuantity : 0;
    }
    async getOptimalFees(exchange, order) {
        // Check cache first
        const cached = this.feeCache.get(exchange);
        if (cached)
            return cached;
        // Mock fee structure
        const fees = {
            maker: 0.0002,
            taker: 0.0004,
            withdrawal: 0.0005,
            rebate: 0.0001 // Maker rebate
        };
        this.feeCache.set(exchange, fees);
        return fees;
    }
    calculateMaxSizeForSlippage(route, maxSlippage) {
        // Calculate maximum size that keeps slippage under threshold
        // Assuming linear slippage model
        if (route.slippage === 0)
            return route.quantity;
        const currentSlippageRate = route.slippage / route.quantity;
        const maxSize = maxSlippage / currentSlippageRate;
        return Math.min(maxSize, route.quantity);
    }
    calculateOptimalExecutionStrategy(route, order, impactModel) {
        // Use Almgren-Chriss framework for optimal execution
        const T = 3600; // 1 hour execution horizon
        const sigma = 0.02; // Volatility
        const eta = impactModel.linear; // Linear impact
        const gamma = impactModel.temporary; // Temporary impact
        const lambda = 0.0001; // Risk aversion
        // Calculate optimal number of splits
        const optimalSplits = Math.ceil(Math.sqrt((eta * route.quantity) / (lambda * sigma * sigma * T)));
        // Calculate interval between executions
        const interval = T / optimalSplits;
        return {
            splitCount: Math.min(optimalSplits, 10), // Cap at 10 splits
            interval: interval * 1000, // Convert to milliseconds
            trajectory: 'linear' // Could be 'aggressive' or 'passive'
        };
    }
    calculateOptimalTiming(exchange, symbol) {
        // Mock implementation - would use historical data
        // to find optimal execution times
        const now = new Date();
        const hour = now.getHours();
        // Avoid low liquidity hours (simplified)
        let delay = 0;
        if (hour >= 0 && hour < 8) {
            delay = (8 - hour) * 3600 * 1000; // Wait until 8 AM
        }
        return {
            delay,
            reason: delay > 0 ? 'Low liquidity period' : 'Optimal timing'
        };
    }
    estimatePriceDrift(exchange, delaySeconds) {
        // Estimate price drift based on volatility
        const annualVolatility = 0.8; // 80% annual volatility
        const secondlyVolatility = annualVolatility / Math.sqrt(365 * 24 * 60 * 60);
        // Expected drift (assuming no directional bias)
        return secondlyVolatility * Math.sqrt(delaySeconds);
    }
    calculateOptimizationConfidence(routes, savings) {
        // Base confidence on data quality and savings achieved
        let confidence = 0.5;
        // Higher savings = higher confidence
        if (savings > 0) {
            confidence += Math.min(0.3, savings / 1000);
        }
        // More routes = better optimization potential
        if (routes.length > 3) {
            confidence += 0.1;
        }
        // Recent data = higher confidence
        const dataAge = Math.min(...routes.map(r => Date.now() - r.latency));
        if (dataAge < 1000) {
            confidence += 0.1;
        }
        return Math.min(1, confidence);
    }
    /**
     * Get real-time cost estimates
     */
    async estimateCosts(routes, order) {
        return this.calculateTotalCost(routes, order);
    }
    /**
     * Update fee cache with latest data
     */
    updateFeeCache(exchange, fees) {
        this.feeCache.set(exchange, fees);
        this.logger.debug('Updated fee cache', { exchange });
    }
    /**
     * Update market impact model
     */
    updateImpactModel(exchange, model) {
        this.impactModels.set(exchange, model);
        this.logger.debug('Updated impact model', { exchange });
    }
}
exports.CostOptimizer = CostOptimizer;
//# sourceMappingURL=CostOptimizer.js.map