"use strict";
/**
 * @noderr/execution - Simplified exports for working components
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.VERSION = exports.OrderPool = exports.SmartExecutionEngine = exports.VenueOptimizer = exports.LatencyManager = exports.LiquidityAggregator = exports.CostOptimizer = exports.IcebergAlgorithm = exports.POVAlgorithm = exports.VWAPAlgorithm = exports.TWAPAlgorithm = void 0;
// Export working algorithm implementations
var TWAPAlgorithm_1 = require("./TWAPAlgorithm");
Object.defineProperty(exports, "TWAPAlgorithm", { enumerable: true, get: function () { return TWAPAlgorithm_1.TWAPAlgorithm; } });
var VWAPAlgorithm_1 = require("./VWAPAlgorithm");
Object.defineProperty(exports, "VWAPAlgorithm", { enumerable: true, get: function () { return VWAPAlgorithm_1.VWAPAlgorithm; } });
var POVAlgorithm_1 = require("./POVAlgorithm");
Object.defineProperty(exports, "POVAlgorithm", { enumerable: true, get: function () { return POVAlgorithm_1.POVAlgorithm; } });
var IcebergAlgorithm_1 = require("./IcebergAlgorithm");
Object.defineProperty(exports, "IcebergAlgorithm", { enumerable: true, get: function () { return IcebergAlgorithm_1.IcebergAlgorithm; } });
// Export working utility classes
var CostOptimizer_1 = require("./CostOptimizer");
Object.defineProperty(exports, "CostOptimizer", { enumerable: true, get: function () { return CostOptimizer_1.CostOptimizer; } });
var LiquidityAggregator_1 = require("./LiquidityAggregator");
Object.defineProperty(exports, "LiquidityAggregator", { enumerable: true, get: function () { return LiquidityAggregator_1.LiquidityAggregator; } });
var LatencyManager_1 = require("./LatencyManager");
Object.defineProperty(exports, "LatencyManager", { enumerable: true, get: function () { return LatencyManager_1.LatencyManager; } });
var VenueOptimizer_1 = require("./VenueOptimizer");
Object.defineProperty(exports, "VenueOptimizer", { enumerable: true, get: function () { return VenueOptimizer_1.VenueOptimizer; } });
// ExchangeBatcher temporarily disabled due to CircuitBreaker dependency
// export { ExchangeBatcher } from './ExchangeBatcher';
// Export working services  
var SmartExecutionEngine_1 = require("./SmartExecutionEngine");
Object.defineProperty(exports, "SmartExecutionEngine", { enumerable: true, get: function () { return SmartExecutionEngine_1.SmartExecutionEngine; } });
// OrderLifecycleManager temporarily disabled due to DistributedStateManager dependency
// export { OrderLifecycleManager } from './OrderLifecycleManager';
// PositionReconciliation temporarily disabled due to CircuitBreaker dependency
// export { PositionReconciliation } from './PositionReconciliation';
var OrderPool_1 = require("./OrderPool");
Object.defineProperty(exports, "OrderPool", { enumerable: true, get: function () { return OrderPool_1.OrderPool; } });
exports.VERSION = '1.0.0';
//# sourceMappingURL=index-simple.js.map