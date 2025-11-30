"use strict";
/**
 * Project Phoenix: Execution Types
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AlgorithmType = exports.ExecutionStatus = exports.BundleStatus = exports.MEVProtectionStrategy = exports.ExecutionError = exports.ExecutionErrorCode = exports.LiquidityCondition = exports.MarketCondition = exports.ChannelType = exports.OrderStatus = exports.TimeInForce = exports.OrderType = exports.OrderSide = exports.ExchangeCapability = void 0;
var ExchangeCapability;
(function (ExchangeCapability) {
    ExchangeCapability["SPOT_TRADING"] = "spot_trading";
    ExchangeCapability["MARGIN_TRADING"] = "margin_trading";
    ExchangeCapability["FUTURES_TRADING"] = "futures_trading";
    ExchangeCapability["OPTIONS_TRADING"] = "options_trading";
    ExchangeCapability["STAKING"] = "staking";
    ExchangeCapability["LENDING"] = "lending";
    ExchangeCapability["API_TRADING"] = "api_trading";
    ExchangeCapability["WEBSOCKET_FEED"] = "websocket_feed";
    ExchangeCapability["OCO_ORDERS"] = "oco_orders";
    ExchangeCapability["STOP_ORDERS"] = "stop_orders";
    ExchangeCapability["TRAILING_STOP"] = "trailing_stop";
    ExchangeCapability["ICEBERG_ORDERS"] = "iceberg_orders";
    ExchangeCapability["POST_ONLY"] = "post_only";
    ExchangeCapability["TIME_IN_FORCE"] = "time_in_force";
    ExchangeCapability["REDUCE_ONLY"] = "reduce_only";
})(ExchangeCapability || (exports.ExchangeCapability = ExchangeCapability = {}));
var OrderSide;
(function (OrderSide) {
    OrderSide["BUY"] = "buy";
    OrderSide["SELL"] = "sell";
})(OrderSide || (exports.OrderSide = OrderSide = {}));
var OrderType;
(function (OrderType) {
    OrderType["MARKET"] = "market";
    OrderType["LIMIT"] = "limit";
    OrderType["STOP_LOSS"] = "stop_loss";
    OrderType["STOP_LOSS_LIMIT"] = "stop_loss_limit";
    OrderType["TAKE_PROFIT"] = "take_profit";
    OrderType["TAKE_PROFIT_LIMIT"] = "take_profit_limit";
    OrderType["TRAILING_STOP"] = "trailing_stop";
    OrderType["OCO"] = "oco";
    OrderType["ICEBERG"] = "iceberg";
})(OrderType || (exports.OrderType = OrderType = {}));
var TimeInForce;
(function (TimeInForce) {
    TimeInForce["GTC"] = "gtc";
    TimeInForce["IOC"] = "ioc";
    TimeInForce["FOK"] = "fok";
    TimeInForce["GTD"] = "gtd";
    TimeInForce["POST_ONLY"] = "post_only";
})(TimeInForce || (exports.TimeInForce = TimeInForce = {}));
var OrderStatus;
(function (OrderStatus) {
    OrderStatus["NEW"] = "new";
    OrderStatus["PARTIALLY_FILLED"] = "partially_filled";
    OrderStatus["FILLED"] = "filled";
    OrderStatus["CANCELLED"] = "cancelled";
    OrderStatus["REJECTED"] = "rejected";
    OrderStatus["EXPIRED"] = "expired";
    OrderStatus["PENDING"] = "pending";
})(OrderStatus || (exports.OrderStatus = OrderStatus = {}));
var ChannelType;
(function (ChannelType) {
    ChannelType["TICKER"] = "ticker";
    ChannelType["TRADES"] = "trades";
    ChannelType["ORDERBOOK"] = "orderbook";
    ChannelType["CANDLES"] = "candles";
    ChannelType["ORDERS"] = "orders";
    ChannelType["BALANCES"] = "balances";
    ChannelType["POSITIONS"] = "positions";
})(ChannelType || (exports.ChannelType = ChannelType = {}));
// Market Conditions
var MarketCondition;
(function (MarketCondition) {
    MarketCondition["CALM"] = "calm";
    MarketCondition["NORMAL"] = "normal";
    MarketCondition["VOLATILE"] = "volatile";
    MarketCondition["EXTREME"] = "extreme";
})(MarketCondition || (exports.MarketCondition = MarketCondition = {}));
var LiquidityCondition;
(function (LiquidityCondition) {
    LiquidityCondition["DEEP"] = "deep";
    LiquidityCondition["NORMAL"] = "normal";
    LiquidityCondition["THIN"] = "thin";
    LiquidityCondition["ILLIQUID"] = "illiquid";
})(LiquidityCondition || (exports.LiquidityCondition = LiquidityCondition = {}));
// Error Handling
var ExecutionErrorCode;
(function (ExecutionErrorCode) {
    ExecutionErrorCode["INSUFFICIENT_LIQUIDITY"] = "INSUFFICIENT_LIQUIDITY";
    ExecutionErrorCode["EXCHANGE_ERROR"] = "EXCHANGE_ERROR";
    ExecutionErrorCode["RATE_LIMIT_EXCEEDED"] = "RATE_LIMIT_EXCEEDED";
    ExecutionErrorCode["INVALID_ORDER"] = "INVALID_ORDER";
    ExecutionErrorCode["MEV_ATTACK_DETECTED"] = "MEV_ATTACK_DETECTED";
    ExecutionErrorCode["SLIPPAGE_EXCEEDED"] = "SLIPPAGE_EXCEEDED";
    ExecutionErrorCode["TIMEOUT"] = "TIMEOUT";
    ExecutionErrorCode["CONFIGURATION_ERROR"] = "CONFIGURATION_ERROR";
    ExecutionErrorCode["ALL_VENUES_FAILED"] = "ALL_VENUES_FAILED";
})(ExecutionErrorCode || (exports.ExecutionErrorCode = ExecutionErrorCode = {}));
class ExecutionError extends Error {
    code;
    details;
    constructor(code, message, details) {
        super(message);
        this.code = code;
        this.details = details;
        this.name = 'ExecutionError';
    }
}
exports.ExecutionError = ExecutionError;
var MEVProtectionStrategy;
(function (MEVProtectionStrategy) {
    MEVProtectionStrategy["FLASHBOTS"] = "flashbots";
    MEVProtectionStrategy["PRIVATE_MEMPOOL"] = "private_mempool";
    MEVProtectionStrategy["COMMIT_REVEAL"] = "commit_reveal";
    MEVProtectionStrategy["TIME_BASED_EXECUTION"] = "time_based_execution";
    MEVProtectionStrategy["STEALTH_TRANSACTIONS"] = "stealth_transactions";
    MEVProtectionStrategy["BUNDLE_TRANSACTIONS"] = "bundle_transactions";
    MEVProtectionStrategy["MEV_BLOCKER"] = "mev_blocker";
})(MEVProtectionStrategy || (exports.MEVProtectionStrategy = MEVProtectionStrategy = {}));
var BundleStatus;
(function (BundleStatus) {
    BundleStatus["PENDING"] = "pending";
    BundleStatus["INCLUDED"] = "included";
    BundleStatus["FAILED"] = "failed";
    BundleStatus["TIMEOUT"] = "timeout";
    BundleStatus["UNCLED"] = "uncled";
})(BundleStatus || (exports.BundleStatus = BundleStatus = {}));
var ExecutionStatus;
(function (ExecutionStatus) {
    ExecutionStatus["COMPLETED"] = "completed";
    ExecutionStatus["PARTIAL"] = "partial";
    ExecutionStatus["FAILED"] = "failed";
    ExecutionStatus["CANCELLED"] = "cancelled";
    ExecutionStatus["EXPIRED"] = "expired";
})(ExecutionStatus || (exports.ExecutionStatus = ExecutionStatus = {}));
// Algorithm Types
var AlgorithmType;
(function (AlgorithmType) {
    AlgorithmType["TWAP"] = "twap";
    AlgorithmType["VWAP"] = "vwap";
    AlgorithmType["POV"] = "pov";
    AlgorithmType["IS"] = "implementation_shortfall";
    AlgorithmType["ICEBERG"] = "iceberg";
    AlgorithmType["SNIPER"] = "sniper";
    AlgorithmType["LIQUIDITY_SEEKING"] = "liquidity_seeking";
    AlgorithmType["DARK_POOL"] = "dark_pool";
    AlgorithmType["ADAPTIVE"] = "adaptive";
    AlgorithmType["ARRIVAL_PRICE"] = "arrival_price";
})(AlgorithmType || (exports.AlgorithmType = AlgorithmType = {}));
//# sourceMappingURL=execution.js.map