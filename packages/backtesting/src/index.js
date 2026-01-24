"use strict";
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
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StreamingBacktestingFramework = void 0;
// Export all types and classes from BacktestingFramework
__exportStar(require("./BacktestingFramework"), exports);
// Export only the StreamingBacktestingFramework class (types already exported above)
var StreamingBacktestFramework_1 = require("./StreamingBacktestFramework");
Object.defineProperty(exports, "StreamingBacktestingFramework", { enumerable: true, get: function () { return StreamingBacktestFramework_1.StreamingBacktestingFramework; } });
//# sourceMappingURL=index.js.map