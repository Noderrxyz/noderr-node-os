/**
 * @noderr/backtesting
 * 
 * Institutional-grade backtesting framework for algorithmic trading strategies.
 * 
 * Features:
 * - Full portfolio simulation with realistic slippage and fees
 * - Comprehensive performance metrics (Sharpe, Sortino, Calmar ratios)
 * - Risk analytics (VaR, CVaR, drawdown analysis)
 * - Streaming backtest support for real-time strategy validation
 * - Event-driven architecture for complex strategy testing
 * 
 * @module @noderr/backtesting
 */

// Export all types and classes from BacktestingFramework
export * from './BacktestingFramework';

// Export only the StreamingBacktestingFramework class (types already exported above)
export { StreamingBacktestingFramework } from './StreamingBacktestFramework';
