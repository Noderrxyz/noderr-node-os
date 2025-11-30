"use strict";
/**
 * @fileoverview Kelly Criterion Position Sizing
 *
 * Implements the Kelly Criterion for optimal position sizing in trading systems.
 * The Kelly Criterion maximizes the expected logarithmic growth rate of capital.
 *
 * Formula: f* = (p * b - q) / b
 * where:
 * - f* = fraction of capital to wager
 * - p = probability of winning
 * - q = probability of losing (1 - p)
 * - b = ratio of win to loss
 *
 * @author Manus AI
 * @version 1.0.0
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.KellyCriterion = void 0;
const phoenix_types_1 = require("@noderr/phoenix-types");
const events_1 = require("events");
/**
 * Kelly Criterion Position Sizer
 *
 * Implements the Kelly Criterion for optimal position sizing with safety features:
 * - Fractional Kelly (default 0.25) for reduced risk
 * - Minimum trade requirement before using Kelly
 * - Maximum position size caps
 * - Continuous performance tracking
 */
class KellyCriterion extends events_1.EventEmitter {
    config;
    performanceHistory;
    /**
     * Creates a new Kelly Criterion position sizer.
     *
     * @param config Configuration for the Kelly Criterion
     */
    constructor(config) {
        super();
        this.config = config;
        this.performanceHistory = new Map();
        // Validate configuration
        this.validateConfig();
    }
    /**
     * Validates the configuration parameters.
     *
     * @throws {MLError} If configuration is invalid
     */
    validateConfig() {
        if (this.config.confidenceLevel <= 0 || this.config.confidenceLevel > 1) {
            throw new phoenix_types_1.MLError(phoenix_types_1.MLErrorCode.INVALID_FEATURES, 'Kelly confidence level must be between 0 and 1');
        }
        if (this.config.minTrades < 1) {
            throw new phoenix_types_1.MLError(phoenix_types_1.MLErrorCode.INVALID_FEATURES, 'Minimum trades must be at least 1');
        }
    }
    /**
     * Calculates the optimal position size using the Kelly Criterion.
     *
     * @param symbol The trading symbol
     * @param confidence The model's confidence in the prediction (0-1)
     * @param maxPositionSize Maximum position size as a fraction of capital (0-1)
     * @returns The recommended position size
     */
    async calculatePositionSize(symbol, confidence, maxPositionSize = 0.25) {
        const startTime = Date.now();
        try {
            // Validate inputs
            this.validateInputs(symbol, confidence, maxPositionSize);
            // Get performance statistics
            const stats = await this.getPerformanceStats(symbol);
            // Calculate Kelly fraction
            const kellyFraction = this.calculateKellyFraction(stats, confidence);
            // Apply Kelly fraction (fractional Kelly for safety)
            const adjustedKelly = kellyFraction * this.config.confidenceLevel;
            // Apply position size limits
            const finalSize = Math.max(0, Math.min(adjustedKelly, maxPositionSize));
            // Calculate risk contribution
            const riskContribution = this.calculateRiskContribution(finalSize, stats);
            const result = {
                symbol,
                recommendedSize: finalSize,
                maxSize: maxPositionSize,
                minSize: 0,
                sizingMethod: 'Kelly Criterion',
                riskContribution,
            };
            // Emit telemetry event
            this.emit('positionSized', {
                symbol,
                kellyFraction,
                adjustedKelly,
                finalSize,
                processingTime: Date.now() - startTime,
            });
            return result;
        }
        catch (error) {
            this.emit('error', error);
            throw error;
        }
    }
    /**
     * Validates the input parameters.
     *
     * @param symbol The trading symbol
     * @param confidence The model's confidence
     * @param maxPositionSize Maximum position size
     * @throws {MLError} If inputs are invalid
     */
    validateInputs(symbol, confidence, maxPositionSize) {
        if (!symbol || symbol.trim().length === 0) {
            throw new phoenix_types_1.MLError(phoenix_types_1.MLErrorCode.INVALID_FEATURES, 'Symbol must be a non-empty string');
        }
        if (confidence < 0 || confidence > 1) {
            throw new phoenix_types_1.MLError(phoenix_types_1.MLErrorCode.INVALID_FEATURES, 'Confidence must be between 0 and 1');
        }
        if (maxPositionSize <= 0 || maxPositionSize > 1) {
            throw new phoenix_types_1.MLError(phoenix_types_1.MLErrorCode.INVALID_FEATURES, 'Max position size must be between 0 and 1');
        }
    }
    /**
     * Gets the performance statistics for a symbol.
     *
     * @param symbol The trading symbol
     * @returns The performance statistics
     */
    async getPerformanceStats(symbol) {
        const stats = this.performanceHistory.get(symbol);
        if (!stats || stats.totalTrades < this.config.minTrades) {
            // Not enough data for Kelly, return conservative default
            return {
                symbol,
                winRate: 0.5,
                avgWin: 0.02,
                avgLoss: 0.02,
                totalTrades: 0,
                sharpeRatio: 0,
                sortinoRatio: 0,
                maxDrawdown: 0,
            };
        }
        return stats;
    }
    /**
     * Calculates the Kelly fraction.
     *
     * Formula: f* = (p * b - q) / b
     *
     * @param stats Performance statistics
     * @param confidence Model confidence
     * @returns The Kelly fraction
     */
    calculateKellyFraction(stats, confidence) {
        const p = stats.winRate;
        const q = 1 - p;
        const b = Math.abs(stats.avgWin / stats.avgLoss);
        // Adjust win rate based on model confidence
        const adjustedP = p * confidence;
        const adjustedQ = 1 - adjustedP;
        // Kelly formula
        const kelly = (adjustedP * b - adjustedQ) / b;
        return kelly;
    }
    /**
     * Calculates the risk contribution of a position.
     *
     * @param positionSize The position size
     * @param stats Performance statistics
     * @returns The risk contribution
     */
    calculateRiskContribution(positionSize, stats) {
        // Risk contribution = position size * average loss
        return positionSize * Math.abs(stats.avgLoss);
    }
    /**
     * Updates the performance statistics for a symbol.
     *
     * @param symbol The trading symbol
     * @param performance The model performance
     */
    updatePerformance(symbol, performance) {
        const stats = {
            symbol,
            winRate: performance.winRate,
            avgWin: performance.avgWin,
            avgLoss: performance.avgLoss,
            totalTrades: performance.totalTrades,
            sharpeRatio: performance.sharpeRatio,
            sortinoRatio: performance.sortinoRatio,
            maxDrawdown: performance.maxDrawdown,
        };
        this.performanceHistory.set(symbol, stats);
        this.emit('performanceUpdated', { symbol, stats });
    }
    /**
     * Gets the current performance statistics for a symbol.
     *
     * @param symbol The trading symbol
     * @returns The performance statistics or null if not available
     */
    getPerformance(symbol) {
        return this.performanceHistory.get(symbol) || null;
    }
    /**
     * Clears the performance history for a symbol.
     *
     * @param symbol The trading symbol
     */
    clearPerformance(symbol) {
        this.performanceHistory.delete(symbol);
        this.emit('performanceCleared', { symbol });
    }
    /**
     * Clears all performance history.
     */
    clearAllPerformance() {
        this.performanceHistory.clear();
        this.emit('allPerformanceCleared');
    }
}
exports.KellyCriterion = KellyCriterion;
//# sourceMappingURL=KellyCriterion.js.map