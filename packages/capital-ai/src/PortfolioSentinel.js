"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PortfolioSentinel = void 0;
const events_1 = require("events");
const createLogger = (name) => ({
    info: (message, meta) => console.log(`[${name}] INFO:`, message, meta || ''),
    error: (message, error) => console.error(`[${name}] ERROR:`, message, error || ''),
    debug: (message, meta) => console.debug(`[${name}] DEBUG:`, message, meta || ''),
    warn: (message, meta) => console.warn(`[${name}] WARN:`, message, meta || '')
});
class PortfolioSentinel extends events_1.EventEmitter {
    constructor() {
        super();
        this.updateInterval = null;
        this.frozen = false;
        this.highWaterMark = 0;
        this.logger = createLogger('PortfolioSentinel');
        this.rebalanceTriggers = new Map();
        this.capitalFlows = [];
        this.emergencyActions = [];
        this.portfolioState = {
            totalValue: 0,
            cash: 0,
            positions: new Map(),
            pnl: { realized: 0, unrealized: 0, total: 0 },
            metrics: this.initializeMetrics(),
            lastUpdated: new Date()
        };
        this.constraints = this.initializeConstraints();
        this.initializeTriggers();
        this.startMonitoring();
    }
    initializeMetrics() {
        return {
            sharpeRatio: 0,
            sortinoRatio: 0,
            maxDrawdown: 0,
            currentDrawdown: 0,
            volatility: 0,
            beta: 0,
            winRate: 0,
            profitFactor: 0,
            calmarRatio: 0
        };
    }
    initializeConstraints() {
        return {
            maxDrawdown: 0.20, // 20%
            maxLeverage: 2.0,
            maxConcentration: 0.30, // 30% in single position
            minCash: 0.10, // 10% cash buffer
            maxPositions: 50,
            sectorLimits: new Map([
                ['CRYPTO', 0.40],
                ['EQUITY', 0.30],
                ['COMMODITY', 0.20],
                ['FX', 0.20]
            ]),
            strategyLimits: new Map([
                ['MOMENTUM', 0.35],
                ['MEAN_REVERSION', 0.25],
                ['ARBITRAGE', 0.20],
                ['MARKET_MAKING', 0.20]
            ]),
            riskLimits: {
                maxVaR: 0.05, // 5% VaR
                maxDailyLoss: 0.03, // 3% daily loss
                maxVolatility: 0.25, // 25% annualized
                maxBeta: 1.5
            }
        };
    }
    initializeTriggers() {
        // Drawdown trigger
        this.registerTrigger({
            id: 'drawdown_trigger',
            type: 'THRESHOLD',
            condition: 'currentDrawdown > threshold',
            threshold: 0.15, // 15% drawdown
            action: 'REDUCE',
            priority: 'HIGH'
        });
        // Concentration trigger
        this.registerTrigger({
            id: 'concentration_trigger',
            type: 'THRESHOLD',
            condition: 'maxPositionWeight > threshold',
            threshold: 0.25, // 25% concentration
            action: 'REBALANCE',
            priority: 'MEDIUM'
        });
        // Daily loss trigger
        this.registerTrigger({
            id: 'daily_loss_trigger',
            type: 'EVENT',
            condition: 'dailyLoss > threshold',
            threshold: 0.025, // 2.5% daily loss
            action: 'FREEZE',
            priority: 'CRITICAL'
        });
        // Scheduled rebalance
        this.registerTrigger({
            id: 'scheduled_rebalance',
            type: 'SCHEDULE',
            condition: 'weekly',
            threshold: 0,
            action: 'REBALANCE',
            priority: 'LOW'
        });
        // Risk spike trigger
        this.registerTrigger({
            id: 'risk_spike_trigger',
            type: 'RISK',
            condition: 'volatility > threshold',
            threshold: 0.40, // 40% volatility
            action: 'REDUCE',
            priority: 'HIGH'
        });
    }
    registerTrigger(trigger) {
        this.rebalanceTriggers.set(trigger.id, trigger);
        this.logger.info(`Registered rebalance trigger: ${trigger.id}`, {
            type: trigger.type,
            action: trigger.action,
            priority: trigger.priority
        });
    }
    startMonitoring() {
        this.updateInterval = setInterval(() => {
            this.updatePortfolioState();
            this.checkTriggers();
            this.enforceConstraints();
        }, 1000); // Every second for real-time monitoring
        this.logger.info('Portfolio monitoring started');
    }
    async updatePosition(symbol, quantity, price, strategy) {
        const position = this.portfolioState.positions.get(symbol) || {
            symbol,
            quantity: 0,
            avgEntryPrice: 0,
            currentPrice: price,
            marketValue: 0,
            unrealizedPnL: 0,
            realizedPnL: 0,
            weight: 0,
            strategy
        };
        // Update position
        if (quantity > position.quantity) {
            // Buying
            const newQuantity = position.quantity + (quantity - position.quantity);
            position.avgEntryPrice =
                (position.avgEntryPrice * position.quantity + price * (quantity - position.quantity)) / newQuantity;
            position.quantity = newQuantity;
        }
        else if (quantity < position.quantity) {
            // Selling
            const soldQuantity = position.quantity - quantity;
            const realizedPnL = soldQuantity * (price - position.avgEntryPrice);
            position.realizedPnL += realizedPnL;
            position.quantity = quantity;
            this.portfolioState.pnl.realized += realizedPnL;
        }
        position.currentPrice = price;
        position.marketValue = position.quantity * price;
        position.unrealizedPnL = position.quantity * (price - position.avgEntryPrice);
        if (position.quantity > 0) {
            this.portfolioState.positions.set(symbol, position);
        }
        else {
            this.portfolioState.positions.delete(symbol);
        }
        this.updatePortfolioState();
        this.emit('position-updated', {
            symbol,
            position,
            portfolioValue: this.portfolioState.totalValue
        });
    }
    async updatePrice(symbol, price) {
        const position = this.portfolioState.positions.get(symbol);
        if (!position)
            return;
        position.currentPrice = price;
        position.marketValue = position.quantity * price;
        position.unrealizedPnL = position.quantity * (price - position.avgEntryPrice);
        this.updatePortfolioState();
    }
    updatePortfolioState() {
        // Calculate total portfolio value
        let totalPositionValue = 0;
        let totalUnrealizedPnL = 0;
        for (const position of this.portfolioState.positions.values()) {
            totalPositionValue += position.marketValue;
            totalUnrealizedPnL += position.unrealizedPnL;
            // Update position weight
            position.weight = position.marketValue / (this.portfolioState.totalValue || 1);
        }
        this.portfolioState.totalValue = this.portfolioState.cash + totalPositionValue;
        this.portfolioState.pnl.unrealized = totalUnrealizedPnL;
        this.portfolioState.pnl.total = this.portfolioState.pnl.realized + totalUnrealizedPnL;
        // Update high water mark
        if (this.portfolioState.totalValue > this.highWaterMark) {
            this.highWaterMark = this.portfolioState.totalValue;
        }
        // Update drawdown
        if (this.highWaterMark > 0) {
            this.portfolioState.metrics.currentDrawdown =
                (this.highWaterMark - this.portfolioState.totalValue) / this.highWaterMark;
            this.portfolioState.metrics.maxDrawdown = Math.max(this.portfolioState.metrics.maxDrawdown, this.portfolioState.metrics.currentDrawdown);
        }
        this.portfolioState.lastUpdated = new Date();
        // Calculate other metrics (simplified)
        this.updatePortfolioMetrics();
    }
    updatePortfolioMetrics() {
        // These would be calculated from historical data in production
        const returns = this.calculateReturns();
        this.portfolioState.metrics.volatility = this.calculateVolatility(returns);
        this.portfolioState.metrics.sharpeRatio = this.calculateSharpeRatio(returns);
        this.portfolioState.metrics.sortinoRatio = this.calculateSortinoRatio(returns);
        this.portfolioState.metrics.calmarRatio =
            this.portfolioState.metrics.maxDrawdown > 0
                ? (this.portfolioState.pnl.total / this.portfolioState.totalValue) / this.portfolioState.metrics.maxDrawdown
                : 0;
    }
    calculateReturns() {
        // Mock returns calculation
        return Array(252).fill(0).map(() => (Math.random() - 0.5) * 0.02);
    }
    calculateVolatility(returns) {
        const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
        const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
        return Math.sqrt(variance * 252); // Annualized
    }
    calculateSharpeRatio(returns) {
        const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
        const volatility = this.calculateVolatility(returns);
        const riskFreeRate = 0.02 / 252; // Daily risk-free rate
        return volatility > 0 ? Math.sqrt(252) * (meanReturn - riskFreeRate) / volatility : 0;
    }
    calculateSortinoRatio(returns) {
        const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
        const downReturns = returns.filter(r => r < 0);
        const downVolatility = this.calculateVolatility(downReturns);
        const riskFreeRate = 0.02 / 252;
        return downVolatility > 0 ? Math.sqrt(252) * (meanReturn - riskFreeRate) / downVolatility : 0;
    }
    checkTriggers() {
        if (this.frozen)
            return;
        for (const trigger of this.rebalanceTriggers.values()) {
            if (this.evaluateTrigger(trigger)) {
                this.handleTrigger(trigger);
            }
        }
    }
    evaluateTrigger(trigger) {
        switch (trigger.id) {
            case 'drawdown_trigger':
                return this.portfolioState.metrics.currentDrawdown > trigger.threshold;
            case 'concentration_trigger':
                const maxWeight = Math.max(...Array.from(this.portfolioState.positions.values()).map(p => p.weight));
                return maxWeight > trigger.threshold;
            case 'daily_loss_trigger':
                // Check daily P&L (would track actual daily in production)
                const dailyLoss = -this.portfolioState.pnl.total / this.portfolioState.totalValue;
                return dailyLoss > trigger.threshold;
            case 'scheduled_rebalance':
                // Check if week has passed since last trigger
                const weekMs = 7 * 24 * 60 * 60 * 1000;
                return !trigger.lastTriggered ||
                    (Date.now() - trigger.lastTriggered.getTime()) > weekMs;
            case 'risk_spike_trigger':
                return this.portfolioState.metrics.volatility > trigger.threshold;
            default:
                return false;
        }
    }
    handleTrigger(trigger) {
        trigger.lastTriggered = new Date();
        this.logger.warn('Rebalance trigger activated', {
            triggerId: trigger.id,
            action: trigger.action,
            priority: trigger.priority
        });
        this.emit('trigger-activated', trigger);
        switch (trigger.action) {
            case 'FREEZE':
                this.freezeCapital(trigger.condition);
                break;
            case 'REDUCE':
                this.reduceExposure(trigger.priority);
                break;
            case 'REBALANCE':
                this.requestRebalance(trigger);
                break;
            case 'ALERT':
                this.sendAlert(trigger);
                break;
        }
    }
    enforceConstraints() {
        let violationCount = 0;
        // Check drawdown constraint
        if (this.portfolioState.metrics.currentDrawdown > this.constraints.maxDrawdown) {
            violationCount++;
            this.handleConstraintViolation('maxDrawdown', this.portfolioState.metrics.currentDrawdown);
        }
        // Check leverage constraint
        const leverage = this.portfolioState.totalValue / this.portfolioState.cash;
        if (leverage > this.constraints.maxLeverage) {
            violationCount++;
            this.handleConstraintViolation('maxLeverage', leverage);
        }
        // Check concentration constraint
        for (const position of this.portfolioState.positions.values()) {
            if (position.weight > this.constraints.maxConcentration) {
                violationCount++;
                this.handleConstraintViolation('maxConcentration', position.weight, position.symbol);
            }
        }
        // Check cash buffer
        const cashRatio = this.portfolioState.cash / this.portfolioState.totalValue;
        if (cashRatio < this.constraints.minCash) {
            violationCount++;
            this.handleConstraintViolation('minCash', cashRatio);
        }
        if (violationCount > 0) {
            this.emit('constraints-violated', {
                count: violationCount,
                portfolioState: this.portfolioState
            });
        }
    }
    handleConstraintViolation(constraint, value, context) {
        this.logger.error('Constraint violation', {
            constraint,
            value,
            limit: this.constraints[constraint],
            context
        });
        // Take immediate action for critical violations
        if (constraint === 'maxDrawdown' && value > this.constraints.maxDrawdown * 1.5) {
            this.emergencyStop('Critical drawdown exceeded');
        }
    }
    freezeCapital(reason) {
        if (this.frozen)
            return;
        this.frozen = true;
        const action = {
            id: `emergency_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            timestamp: new Date(),
            type: 'FREEZE',
            reason,
            severity: 'CRITICAL',
            targetStrategies: Array.from(new Set(Array.from(this.portfolioState.positions.values()).map(p => p.strategy))),
            status: 'EXECUTING'
        };
        this.emergencyActions.push(action);
        this.logger.error('Capital frozen', {
            reason,
            portfolioValue: this.portfolioState.totalValue,
            drawdown: this.portfolioState.metrics.currentDrawdown
        });
        this.emit('capital-frozen', {
            action,
            portfolioState: this.portfolioState
        });
        action.status = 'COMPLETED';
        action.result = 'All trading halted';
    }
    unfreezeCapital() {
        if (!this.frozen)
            return;
        this.frozen = false;
        this.logger.info('Capital unfrozen');
        this.emit('capital-unfrozen');
    }
    emergencyStop(reason) {
        this.logger.error('EMERGENCY STOP ACTIVATED', { reason });
        // Freeze all capital
        this.freezeCapital(reason);
        // Create emergency liquidation plan
        const action = {
            id: `emergency_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            timestamp: new Date(),
            type: 'LIQUIDATE',
            reason,
            severity: 'CRITICAL',
            targetStrategies: ['ALL'],
            status: 'PENDING'
        };
        this.emergencyActions.push(action);
        this.emit('emergency-stop', {
            action,
            portfolioState: this.portfolioState
        });
    }
    reduceExposure(priority) {
        const reductionRatio = priority === 'CRITICAL' ? 0.5 :
            priority === 'HIGH' ? 0.3 : 0.1;
        this.emit('reduce-exposure', {
            ratio: reductionRatio,
            positions: Array.from(this.portfolioState.positions.values())
        });
    }
    requestRebalance(trigger) {
        this.emit('rebalance-requested', {
            trigger,
            portfolioState: this.portfolioState,
            constraints: this.constraints
        });
    }
    sendAlert(trigger) {
        this.emit('alert', {
            severity: trigger.priority,
            message: `Trigger ${trigger.id} activated: ${trigger.condition}`,
            portfolioState: this.portfolioState
        });
    }
    recordCapitalFlow(flow) {
        const capitalFlow = {
            id: `flow_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            timestamp: new Date(),
            impact: {
                portfolioValue: this.portfolioState.totalValue,
                drawdown: this.portfolioState.metrics.currentDrawdown,
                leverage: this.portfolioState.totalValue / this.portfolioState.cash
            },
            ...flow
        };
        this.capitalFlows.push(capitalFlow);
        // Keep last 10000 flows
        if (this.capitalFlows.length > 10000) {
            this.capitalFlows = this.capitalFlows.slice(-10000);
        }
        this.logger.info('Capital flow recorded', {
            type: flow.type,
            amount: flow.amount,
            from: flow.from,
            to: flow.to
        });
    }
    getPortfolioState() {
        return { ...this.portfolioState };
    }
    getCapitalFlowHistory(filters, limit = 1000) {
        let flows = [...this.capitalFlows];
        if (filters) {
            if (filters.type) {
                flows = flows.filter(f => f.type === filters.type);
            }
            if (filters.startDate) {
                flows = flows.filter(f => f.timestamp >= filters.startDate);
            }
            if (filters.endDate) {
                flows = flows.filter(f => f.timestamp <= filters.endDate);
            }
        }
        return flows.slice(-limit);
    }
    updateConstraints(newConstraints) {
        this.constraints = {
            ...this.constraints,
            ...newConstraints
        };
        this.logger.info('Portfolio constraints updated', newConstraints);
        // Re-check constraints with new values
        this.enforceConstraints();
    }
    getEmergencyActions() {
        return [...this.emergencyActions];
    }
    isFrozen() {
        return this.frozen;
    }
    destroy() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
        this.logger.info('Portfolio sentinel destroyed');
    }
}
exports.PortfolioSentinel = PortfolioSentinel;
