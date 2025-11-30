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
import { KellyCriterionConfig, PositionSize, ModelPerformance } from '@noderr/phoenix-types';
import { EventEmitter } from 'events';
/**
 * Represents the historical performance statistics for a symbol.
 */
interface PerformanceStats {
    symbol: string;
    winRate: number;
    avgWin: number;
    avgLoss: number;
    totalTrades: number;
    sharpeRatio: number;
    sortinoRatio: number;
    maxDrawdown: number;
}
/**
 * Kelly Criterion Position Sizer
 *
 * Implements the Kelly Criterion for optimal position sizing with safety features:
 * - Fractional Kelly (default 0.25) for reduced risk
 * - Minimum trade requirement before using Kelly
 * - Maximum position size caps
 * - Continuous performance tracking
 */
export declare class KellyCriterion extends EventEmitter {
    private config;
    private performanceHistory;
    /**
     * Creates a new Kelly Criterion position sizer.
     *
     * @param config Configuration for the Kelly Criterion
     */
    constructor(config: KellyCriterionConfig);
    /**
     * Validates the configuration parameters.
     *
     * @throws {MLError} If configuration is invalid
     */
    private validateConfig;
    /**
     * Calculates the optimal position size using the Kelly Criterion.
     *
     * @param symbol The trading symbol
     * @param confidence The model's confidence in the prediction (0-1)
     * @param maxPositionSize Maximum position size as a fraction of capital (0-1)
     * @returns The recommended position size
     */
    calculatePositionSize(symbol: string, confidence: number, maxPositionSize?: number): Promise<PositionSize>;
    /**
     * Validates the input parameters.
     *
     * @param symbol The trading symbol
     * @param confidence The model's confidence
     * @param maxPositionSize Maximum position size
     * @throws {MLError} If inputs are invalid
     */
    private validateInputs;
    /**
     * Gets the performance statistics for a symbol.
     *
     * @param symbol The trading symbol
     * @returns The performance statistics
     */
    private getPerformanceStats;
    /**
     * Calculates the Kelly fraction.
     *
     * Formula: f* = (p * b - q) / b
     *
     * @param stats Performance statistics
     * @param confidence Model confidence
     * @returns The Kelly fraction
     */
    private calculateKellyFraction;
    /**
     * Calculates the risk contribution of a position.
     *
     * @param positionSize The position size
     * @param stats Performance statistics
     * @returns The risk contribution
     */
    private calculateRiskContribution;
    /**
     * Updates the performance statistics for a symbol.
     *
     * @param symbol The trading symbol
     * @param performance The model performance
     */
    updatePerformance(symbol: string, performance: ModelPerformance): void;
    /**
     * Gets the current performance statistics for a symbol.
     *
     * @param symbol The trading symbol
     * @returns The performance statistics or null if not available
     */
    getPerformance(symbol: string): PerformanceStats | null;
    /**
     * Clears the performance history for a symbol.
     *
     * @param symbol The trading symbol
     */
    clearPerformance(symbol: string): void;
    /**
     * Clears all performance history.
     */
    clearAllPerformance(): void;
}
export {};
//# sourceMappingURL=KellyCriterion.d.ts.map