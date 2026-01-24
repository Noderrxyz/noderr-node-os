"use strict";
/**
 * @noderr/types - Shared TypeScript type definitions
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
exports.NodeType = exports.RecoveryActionType = exports.MessageFactory = exports.MessagePriority = exports.MessageType = exports.HealthUtils = exports.ModuleHealthStatus = exports.ModuleStatus = exports.HealthStatus = exports.ConfigUtils = exports.AdapterCategory = exports.ExecutionUrgency = exports.AlgorithmType = exports.MarketCondition = exports.ExecutionStatus = exports.ExecutionError = exports.ExecutionErrorCode = exports.TimeInForce = exports.OrderType = exports.OrderSide = exports.OrderStatus = void 0;
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
    ExecutionUrgency["NORMAL"] = "normal";
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
// ============================================================================
// ML and AI Types
// ============================================================================
__exportStar(require("./ml-types"), exports);
class ConfigUtils {
    static merge(base, override) {
        return { ...base, ...override };
    }
    static validate(config, schema) {
        return { valid: true };
    }
    static setValueByPath(obj, path, value) {
        const keys = path.split('.');
        let current = obj;
        for (let i = 0; i < keys.length - 1; i++) {
            if (!current[keys[i]])
                current[keys[i]] = {};
            current = current[keys[i]];
        }
        current[keys[keys.length - 1]] = value;
    }
}
exports.ConfigUtils = ConfigUtils;
// Health Monitoring Types
var HealthStatus;
(function (HealthStatus) {
    HealthStatus["HEALTHY"] = "healthy";
    HealthStatus["DEGRADED"] = "degraded";
    HealthStatus["UNHEALTHY"] = "unhealthy";
    HealthStatus["UNKNOWN"] = "unknown";
})(HealthStatus || (exports.HealthStatus = HealthStatus = {}));
var ModuleStatus;
(function (ModuleStatus) {
    ModuleStatus["HEALTHY"] = "healthy";
    ModuleStatus["DEGRADED"] = "degraded";
    ModuleStatus["UNHEALTHY"] = "unhealthy";
    ModuleStatus["UNKNOWN"] = "unknown";
    ModuleStatus["STARTING"] = "starting";
    ModuleStatus["READY"] = "ready";
    ModuleStatus["ERROR"] = "error";
    ModuleStatus["STOPPING"] = "stopping";
    ModuleStatus["STOPPED"] = "stopped";
})(ModuleStatus || (exports.ModuleStatus = ModuleStatus = {}));
var ModuleHealthStatus;
(function (ModuleHealthStatus) {
    ModuleHealthStatus["HEALTHY"] = "healthy";
    ModuleHealthStatus["DEGRADED"] = "degraded";
    ModuleHealthStatus["UNHEALTHY"] = "unhealthy";
    ModuleHealthStatus["UNKNOWN"] = "unknown";
})(ModuleHealthStatus || (exports.ModuleHealthStatus = ModuleHealthStatus = {}));
class HealthUtils {
    static calculateStatus(metrics) {
        const errorRate = metrics.errorRate || 0;
        if (errorRate > 0.1)
            return HealthStatus.UNHEALTHY;
        if (errorRate > 0.05)
            return HealthStatus.DEGRADED;
        return HealthStatus.HEALTHY;
    }
}
exports.HealthUtils = HealthUtils;
// Message Bus Types
var MessageType;
(function (MessageType) {
    MessageType["COMMAND"] = "command";
    MessageType["EVENT"] = "event";
    MessageType["QUERY"] = "query";
    MessageType["RESPONSE"] = "response";
    MessageType["MODULE_RESET"] = "module_reset";
    MessageType["MODULE_FAILOVER"] = "module_failover";
    MessageType["MODULE_ROLLBACK"] = "module_rollback";
    MessageType["MODULE_SCALE"] = "module_scale";
    MessageType["MODULE_ALERT"] = "module_alert";
    MessageType["MODULE_ERROR"] = "module_error";
    MessageType["SYSTEM_STARTUP"] = "system_startup";
    MessageType["SYSTEM_SHUTDOWN"] = "system_shutdown";
    MessageType["MODULE_REGISTER"] = "module_register";
    MessageType["MODULE_READY"] = "module_ready";
    MessageType["HEALTH_RESPONSE"] = "health_response";
    MessageType["CONFIG_UPDATE"] = "config_update";
})(MessageType || (exports.MessageType = MessageType = {}));
var MessagePriority;
(function (MessagePriority) {
    MessagePriority[MessagePriority["LOW"] = 0] = "LOW";
    MessagePriority[MessagePriority["NORMAL"] = 1] = "NORMAL";
    MessagePriority[MessagePriority["HIGH"] = 2] = "HIGH";
    MessagePriority[MessagePriority["CRITICAL"] = 3] = "CRITICAL";
})(MessagePriority || (exports.MessagePriority = MessagePriority = {}));
class MessageFactory {
    static create(type, topic, payload, source) {
        return {
            id: Math.random().toString(36),
            type,
            topic,
            payload,
            priority: MessagePriority.NORMAL,
            timestamp: Date.now(),
            source
        };
    }
    static createCommand(topic, payload, source) {
        return {
            id: Math.random().toString(36),
            type: MessageType.COMMAND,
            topic,
            payload,
            priority: MessagePriority.NORMAL,
            timestamp: Date.now(),
            source
        };
    }
    static createEvent(topic, payload, source) {
        return {
            id: Math.random().toString(36),
            type: MessageType.EVENT,
            topic,
            payload,
            priority: MessagePriority.NORMAL,
            timestamp: Date.now(),
            source
        };
    }
    static createQuery(topic, payload, source) {
        return {
            id: Math.random().toString(36),
            type: MessageType.QUERY,
            topic,
            payload,
            priority: MessagePriority.NORMAL,
            timestamp: Date.now(),
            source
        };
    }
}
exports.MessageFactory = MessageFactory;
// Recovery Types
var RecoveryActionType;
(function (RecoveryActionType) {
    RecoveryActionType["RESTART"] = "restart";
    RecoveryActionType["SCALE"] = "scale";
    RecoveryActionType["FAILOVER"] = "failover";
    RecoveryActionType["ROLLBACK"] = "rollback";
    RecoveryActionType["NOTIFY"] = "notify";
    RecoveryActionType["RESET"] = "reset";
    RecoveryActionType["ALERT_ONLY"] = "alert_only";
    RecoveryActionType["RELOAD"] = "reload";
    RecoveryActionType["CIRCUIT_BREAK"] = "circuit_break";
    RecoveryActionType["SCALE_DOWN"] = "scale_down";
})(RecoveryActionType || (exports.RecoveryActionType = RecoveryActionType = {}));
// ============================================================================
// Node Type System
// ============================================================================
/**
 * Node types in the Noderr network
 */
var NodeType;
(function (NodeType) {
    NodeType["ORACLE"] = "ORACLE";
    NodeType["GUARDIAN"] = "GUARDIAN";
    NodeType["VALIDATOR"] = "VALIDATOR";
})(NodeType || (exports.NodeType = NodeType = {}));
// Alpha Exploitation Types
__exportStar(require("./alpha-exploitation-types"), exports);
// Strategy Types  
__exportStar(require("./strategy-types"), exports);
//# sourceMappingURL=index.js.map