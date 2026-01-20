import { Logger } from '@noderr/utils/src';

/**
 * @class PnLCalculator
 * 
 * Calculates Profit and Loss for trading positions.
 * Uses deterministic calculation methods to ensure reproducible results.
 */
export class PnLCalculator {
    private logger: Logger;

    constructor() {
        this.logger = new Logger('PnLCalculator');
    }

    /**
     * Calculate PnL for a completed trade
     * @param entryPrice Price at which position was entered
     * @param exitPrice Price at which position was exited
     * @param quantity Position size
     * @param side 'buy' or 'sell'
     * @returns PnL value
     */
    public calculateTradePnL(
        entryPrice: number,
        exitPrice: number,
        quantity: number,
        side: 'buy' | 'sell'
    ): number {
        if (entryPrice <= 0 || exitPrice <= 0 || quantity <= 0) {
            this.logger.warn('Invalid inputs for PnL calculation', {
                entryPrice,
                exitPrice,
                quantity,
                side
            });
            return 0;
        }

        let pnl: number;
        if (side === 'buy') {
            // Long position: profit when price goes up
            pnl = (exitPrice - entryPrice) * quantity;
        } else {
            // Short position: profit when price goes down
            pnl = (entryPrice - exitPrice) * quantity;
        }

        return pnl;
    }

    /**
     * Calculate unrealized PnL for an open position
     * @param entryPrice Price at which position was entered
     * @param currentPrice Current market price
     * @param quantity Position size
     * @param side 'buy' or 'sell'
     * @returns Unrealized PnL value
     */
    public calculateUnrealizedPnL(
        entryPrice: number,
        currentPrice: number,
        quantity: number,
        side: 'buy' | 'sell'
    ): number {
        return this.calculateTradePnL(entryPrice, currentPrice, quantity, side);
    }

    /**
     * Calculate percentage return
     * @param entryPrice Price at which position was entered
     * @param exitPrice Price at which position was exited
     * @param side 'buy' or 'sell'
     * @returns Return percentage (e.g., 0.05 for 5%)
     */
    public calculateReturnPercentage(
        entryPrice: number,
        exitPrice: number,
        side: 'buy' | 'sell'
    ): number {
        if (entryPrice <= 0) {
            return 0;
        }

        if (side === 'buy') {
            return (exitPrice - entryPrice) / entryPrice;
        } else {
            return (entryPrice - exitPrice) / entryPrice;
        }
    }

    /**
     * Calculate total PnL from multiple trades
     * @param trades Array of trade PnL values
     * @returns Total PnL
     */
    public calculateTotalPnL(trades: number[]): number {
        return trades.reduce((sum, pnl) => sum + pnl, 0);
    }

    /**
     * Calculate average PnL per trade
     * @param trades Array of trade PnL values
     * @returns Average PnL
     */
    public calculateAveragePnL(trades: number[]): number {
        if (trades.length === 0) {
            return 0;
        }
        return this.calculateTotalPnL(trades) / trades.length;
    }

    /**
     * Calculate win rate
     * @param trades Array of trade PnL values
     * @returns Win rate as decimal (e.g., 0.65 for 65%)
     */
    public calculateWinRate(trades: number[]): number {
        if (trades.length === 0) {
            return 0;
        }
        const winningTrades = trades.filter(pnl => pnl > 0).length;
        return winningTrades / trades.length;
    }

    /**
     * Calculate profit factor (ratio of gross profit to gross loss)
     * @param trades Array of trade PnL values
     * @returns Profit factor
     */
    public calculateProfitFactor(trades: number[]): number {
        const grossProfit = trades.filter(pnl => pnl > 0).reduce((sum, pnl) => sum + pnl, 0);
        const grossLoss = Math.abs(trades.filter(pnl => pnl < 0).reduce((sum, pnl) => sum + pnl, 0));

        if (grossLoss === 0) {
            return grossProfit > 0 ? Infinity : 0;
        }

        return grossProfit / grossLoss;
    }

    /**
     * Calculate maximum drawdown
     * @param equityCurve Array of cumulative equity values
     * @returns Maximum drawdown as positive number
     */
    public calculateMaxDrawdown(equityCurve: number[]): number {
        if (equityCurve.length === 0) {
            return 0;
        }

        let maxDrawdown = 0;
        let peak = equityCurve[0];

        for (const equity of equityCurve) {
            if (equity > peak) {
                peak = equity;
            }
            const drawdown = peak - equity;
            if (drawdown > maxDrawdown) {
                maxDrawdown = drawdown;
            }
        }

        return maxDrawdown;
    }

    /**
     * Calculate Sharpe ratio
     * @param returns Array of period returns
     * @param riskFreeRate Risk-free rate (annualized)
     * @param periodsPerYear Number of periods per year (e.g., 252 for daily, 12 for monthly)
     * @returns Sharpe ratio
     */
    public calculateSharpeRatio(
        returns: number[],
        riskFreeRate: number = 0,
        periodsPerYear: number = 252
    ): number {
        if (returns.length === 0) {
            return 0;
        }

        const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
        const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
        const stdDev = Math.sqrt(variance);

        if (stdDev === 0) {
            return 0;
        }

        const excessReturn = avgReturn - (riskFreeRate / periodsPerYear);
        return (excessReturn / stdDev) * Math.sqrt(periodsPerYear);
    }

    /**
     * Calculate PnL (overloaded for different use cases)
     */
    public calculatePnL(entryPrice: number, exitPrice: number, quantity: number, side: 'buy' | 'sell'): number;
    public calculatePnL(strategyId: string, executionResult: any): number;
    public calculatePnL(arg1: number | string, arg2: number | any, arg3?: number, arg4?: 'buy' | 'sell'): number {
        // If first arg is string, it's the (strategyId, executionResult) signature
        if (typeof arg1 === 'string') {
            const executionResult = arg2;
            // For now, return 0 as we don't have position tracking
            // In a real implementation, this would look up the entry price from position tracking
            this.logger.warn('calculatePnL with strategyId not fully implemented', { strategyId: arg1 });
            return 0;
        }
        // Otherwise, it's the (entryPrice, exitPrice, quantity, side) signature
        return this.calculateTradePnL(arg1, arg2, arg3!, arg4!);
    }

    /**
     * Get open positions (placeholder for compatibility)
     * In a real implementation, this would track open positions
     */
    public getOpenPositions(strategyId?: string): any[] {
        // Placeholder implementation
        if (strategyId) {
            this.logger.debug('getOpenPositions called for strategy', { strategyId });
        }
        return [];
    }
}
