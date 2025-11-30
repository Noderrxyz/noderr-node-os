"use strict";
/**
 * @noderr/types - Shared TypeScript type definitions
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdapterCategory = exports.ExecutionUrgency = exports.AlgorithmType = exports.MarketCondition = exports.ExecutionStatus = exports.ExecutionError = exports.ExecutionErrorCode = exports.TimeInForce = exports.OrderType = exports.OrderSide = exports.OrderStatus = void 0;
var OrderStatus;
(function (OrderStatus) {
    OrderStatus["PENDING"] = "pending";
    OrderStatus["NEW"] = "new";
    OrderStatus["OPEN"] = "open";
    OrderStatus["PARTIALLY_FILLED"] = "partially_filled";
    OrderStatus["FILLED"] = "filled";
    OrderStatus["CANCELLED"] = "cancelled";
    OrderStatus["REJECTED"] = "rejected";
    OrderStatus["EXPIRED"] = "expired";
})(OrderStatus || (exports.OrderStatus = OrderStatus = {}));
var OrderSide;
(function (OrderSide) {
    OrderSide["BUY"] = "buy";
    OrderSide["SELL"] = "sell";
})(OrderSide || (exports.OrderSide = OrderSide = {}));
var OrderType;
(function (OrderType) {
    OrderType["MARKET"] = "market";
    OrderType["LIMIT"] = "limit";
    OrderType["STOP"] = "stop";
    OrderType["STOP_LIMIT"] = "stop_limit";
})(OrderType || (exports.OrderType = OrderType = {}));
var TimeInForce;
(function (TimeInForce) {
    TimeInForce["GTC"] = "gtc";
    TimeInForce["IOC"] = "ioc";
    TimeInForce["FOK"] = "fok";
    TimeInForce["DAY"] = "day";
    TimeInForce["POST_ONLY"] = "post_only"; // Post Only (maker only)
})(TimeInForce || (exports.TimeInForce = TimeInForce = {}));
var ExecutionErrorCode;
(function (ExecutionErrorCode) {
    ExecutionErrorCode["INVALID_ORDER"] = "INVALID_ORDER";
    ExecutionErrorCode["INSUFFICIENT_BALANCE"] = "INSUFFICIENT_BALANCE";
    ExecutionErrorCode["VENUE_ERROR"] = "VENUE_ERROR";
    ExecutionErrorCode["TIMEOUT"] = "TIMEOUT";
    ExecutionErrorCode["RATE_LIMIT"] = "RATE_LIMIT";
    ExecutionErrorCode["NETWORK_ERROR"] = "NETWORK_ERROR";
    ExecutionErrorCode["UNKNOWN"] = "UNKNOWN";
})(ExecutionErrorCode || (exports.ExecutionErrorCode = ExecutionErrorCode = {}));
class ExecutionError extends Error {
    code;
    details;
    constructor(message, code, details) {
        super(message);
        this.code = code;
        this.details = details;
        this.name = 'ExecutionError';
    }
}
exports.ExecutionError = ExecutionError;
var ExecutionStatus;
(function (ExecutionStatus) {
    ExecutionStatus["PENDING"] = "pending";
    ExecutionStatus["PARTIAL"] = "partial";
    ExecutionStatus["COMPLETED"] = "completed";
    ExecutionStatus["FAILED"] = "failed";
    ExecutionStatus["CANCELLED"] = "cancelled";
    ExecutionStatus["EXPIRED"] = "expired";
})(ExecutionStatus || (exports.ExecutionStatus = ExecutionStatus = {}));
var MarketCondition;
(function (MarketCondition) {
    MarketCondition["NORMAL"] = "normal";
    MarketCondition["VOLATILE"] = "volatile";
    MarketCondition["TRENDING"] = "trending";
    MarketCondition["RANGING"] = "ranging";
})(MarketCondition || (exports.MarketCondition = MarketCondition = {}));
var AlgorithmType;
(function (AlgorithmType) {
    AlgorithmType["TWAP"] = "twap";
    AlgorithmType["VWAP"] = "vwap";
    AlgorithmType["POV"] = "pov";
    AlgorithmType["ICEBERG"] = "iceberg";
    AlgorithmType["ADAPTIVE"] = "adaptive";
})(AlgorithmType || (exports.AlgorithmType = AlgorithmType = {}));
var ExecutionUrgency;
(function (ExecutionUrgency) {
    ExecutionUrgency["LOW"] = "low";
    ExecutionUrgency["MEDIUM"] = "medium";
    ExecutionUrgency["HIGH"] = "high";
    ExecutionUrgency["CRITICAL"] = "critical";
})(ExecutionUrgency || (exports.ExecutionUrgency = ExecutionUrgency = {}));
var AdapterCategory;
(function (AdapterCategory) {
    AdapterCategory["LENDING"] = "lending";
    AdapterCategory["STAKING"] = "staking";
    AdapterCategory["YIELD"] = "yield";
    AdapterCategory["LIQUIDITY"] = "liquidity";
})(AdapterCategory || (exports.AdapterCategory = AdapterCategory = {}));
//# sourceMappingURL=index.js.map