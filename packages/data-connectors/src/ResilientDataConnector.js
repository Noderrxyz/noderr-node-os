"use strict";
/**
 * ResilientDataConnector - Enterprise-grade base class for data connectors
 *
 * Features:
 * - Exponential backoff with jitter
 * - Infinite retry with circuit breaker protection
 * - Connection pooling support
 * - Comprehensive telemetry
 * - Graceful degradation
 */
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResilientDataConnector = void 0;
var events_1 = require("events");
var ws_1 = require("ws");
var ResilientDataConnector = /** @class */ (function (_super) {
    __extends(ResilientDataConnector, _super);
    function ResilientDataConnector(config) {
        var _this = _super.call(this) || this;
        _this.ws = null;
        _this.connectionPool = [];
        _this.isConnected = false;
        _this.reconnectAttempts = 0;
        _this.consecutiveFailures = 0;
        _this.circuitBreakerOpen = false;
        _this.connectionAttempts = [];
        _this.reconnectStartTime = 0;
        _this.config = config;
        // Set default reconnection config with provided overrides
        _this.reconnectionConfig = __assign({ initialDelay: 1000, maxDelay: 300000, backoffMultiplier: 1.5, jitterFactor: 0.3, maxConsecutiveFailures: 10, circuitBreakerThreshold: 50, circuitBreakerResetTime: 300000, connectionTimeout: 30000, heartbeatInterval: 30000, staleConnectionThreshold: 60000 }, config.reconnection);
        _this.metrics = _this.initializeMetrics();
        return _this;
    }
    ResilientDataConnector.prototype.initializeMetrics = function () {
        return {
            connected: false,
            uptime: 0,
            reconnects: 0,
            consecutiveFailures: 0,
            totalFailures: 0,
            messagesReceived: 0,
            lastMessage: Date.now(),
            latency: 0,
            errors: 0,
            bytesReceived: 0,
            bytesSent: 0,
            avgReconnectTime: 0,
            maxReconnectTime: 0,
            connectionQuality: 100
        };
    };
    /**
     * Connect with resilient retry logic
     */
    ResilientDataConnector.prototype.connect = function () {
        return __awaiter(this, void 0, void 0, function () {
            var error_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (this.circuitBreakerOpen) {
                            throw new Error('Circuit breaker is open - connection attempts blocked');
                        }
                        this.log('info', 'Initiating connection', {
                            url: this.config.url,
                            poolSize: this.config.poolSize || 1
                        });
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 4, , 5]);
                        return [4 /*yield*/, this.establishConnection()];
                    case 2:
                        _a.sent();
                        return [4 /*yield*/, this.onConnected()];
                    case 3:
                        _a.sent();
                        this.startHeartbeat();
                        // Reset failure counters on successful connection
                        this.consecutiveFailures = 0;
                        this.metrics.consecutiveFailures = 0;
                        this.updateConnectionQuality();
                        this.emit('connected', {
                            timestamp: Date.now(),
                            reconnectAttempts: this.reconnectAttempts,
                            metrics: this.getMetrics()
                        });
                        return [3 /*break*/, 5];
                    case 4:
                        error_1 = _a.sent();
                        this.handleConnectionFailure(error_1);
                        throw error_1;
                    case 5: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Establish WebSocket connection with timeout
     */
    ResilientDataConnector.prototype.establishConnection = function () {
        return __awaiter(this, void 0, void 0, function () {
            var attemptStart;
            var _this = this;
            return __generator(this, function (_a) {
                attemptStart = Date.now();
                return [2 /*return*/, new Promise(function (resolve, reject) {
                        var timeout = setTimeout(function () {
                            reject(new Error('Connection timeout'));
                        }, _this.reconnectionConfig.connectionTimeout);
                        try {
                            var ws_2 = new ws_1.default(_this.config.url, {
                                perMessageDeflate: _this.config.enableCompression
                            });
                            ws_2.on('open', function () {
                                clearTimeout(timeout);
                                _this.isConnected = true;
                                _this.metrics.connected = true;
                                _this.ws = ws_2;
                                // Record successful attempt
                                _this.recordConnectionAttempt(attemptStart, true);
                                // Set up message handlers
                                _this.setupWebSocketHandlers(ws_2);
                                resolve();
                            });
                            ws_2.on('error', function (error) {
                                clearTimeout(timeout);
                                _this.recordConnectionAttempt(attemptStart, false, error.message);
                                reject(error);
                            });
                        }
                        catch (error) {
                            clearTimeout(timeout);
                            reject(error);
                        }
                    })];
            });
        });
    };
    /**
     * Set up WebSocket event handlers
     */
    ResilientDataConnector.prototype.setupWebSocketHandlers = function (ws) {
        var _this = this;
        ws.on('message', function (data) {
            _this.metrics.messagesReceived++;
            _this.metrics.lastMessage = Date.now();
            _this.metrics.bytesReceived += data.toString().length;
            try {
                _this.handleMessage(data);
            }
            catch (error) {
                _this.log('error', 'Failed to handle message', error);
                _this.metrics.errors++;
            }
        });
        ws.on('error', function (error) {
            _this.log('error', 'WebSocket error', error);
            _this.metrics.errors++;
            _this.emit('error', error);
        });
        ws.on('close', function (code, reason) {
            _this.log('warn', 'WebSocket closed', { code: code, reason: reason });
            _this.handleDisconnection();
        });
        ws.on('ping', function () {
            ws.pong();
            _this.updateLatency();
        });
        ws.on('pong', function () {
            _this.updateLatency();
        });
    };
    /**
     * Handle connection failure with telemetry
     */
    ResilientDataConnector.prototype.handleConnectionFailure = function (error) {
        this.consecutiveFailures++;
        this.metrics.consecutiveFailures = this.consecutiveFailures;
        this.metrics.totalFailures++;
        this.metrics.errors++;
        this.emit('connection-failure', {
            error: error.message,
            consecutiveFailures: this.consecutiveFailures,
            totalFailures: this.metrics.totalFailures,
            timestamp: Date.now()
        });
        // Check circuit breaker
        if (this.consecutiveFailures >= this.reconnectionConfig.circuitBreakerThreshold) {
            this.openCircuitBreaker();
        }
    };
    /**
     * Handle disconnection and schedule reconnect
     */
    ResilientDataConnector.prototype.handleDisconnection = function () {
        this.isConnected = false;
        this.metrics.connected = false;
        var downtime = Date.now();
        // Clean up
        this.stopHeartbeat();
        if (this.ws) {
            this.ws.removeAllListeners();
            this.ws = null;
        }
        this.emit('disconnected', {
            timestamp: downtime,
            uptime: this.metrics.uptime,
            metrics: this.getMetrics()
        });
        // Schedule reconnection with backoff
        this.scheduleReconnection();
    };
    /**
     * Schedule reconnection with exponential backoff and jitter
     */
    ResilientDataConnector.prototype.scheduleReconnection = function () {
        var _this = this;
        if (this.circuitBreakerOpen) {
            this.log('warn', 'Circuit breaker open - skipping reconnection');
            return;
        }
        this.reconnectAttempts++;
        this.metrics.reconnects++;
        // Calculate delay with exponential backoff
        var baseDelay = Math.min(this.reconnectionConfig.initialDelay * Math.pow(this.reconnectionConfig.backoffMultiplier, Math.min(this.reconnectAttempts - 1, 10) // Cap exponential growth
        ), this.reconnectionConfig.maxDelay);
        // Add jitter to prevent thundering herd
        var jitter = baseDelay * this.reconnectionConfig.jitterFactor * (Math.random() - 0.5);
        var delay = Math.max(0, baseDelay + jitter);
        this.log('info', 'Scheduling reconnection', {
            attempt: this.reconnectAttempts,
            delay: Math.round(delay),
            consecutiveFailures: this.consecutiveFailures
        });
        this.emit('reconnection-scheduled', {
            attempt: this.reconnectAttempts,
            delay: delay,
            timestamp: Date.now()
        });
        this.reconnectStartTime = Date.now();
        this.reconnectTimer = setTimeout(function () {
            _this.reconnect();
        }, delay);
    };
    /**
     * Attempt to reconnect
     */
    ResilientDataConnector.prototype.reconnect = function () {
        return __awaiter(this, void 0, void 0, function () {
            var reconnectTime, error_2;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        this.log('info', 'Attempting reconnection', {
                            attempt: this.reconnectAttempts,
                            consecutiveFailures: this.consecutiveFailures
                        });
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, this.connect()];
                    case 2:
                        _a.sent();
                        reconnectTime = Date.now() - this.reconnectStartTime;
                        this.updateReconnectionMetrics(reconnectTime);
                        this.emit('reconnected', {
                            attempt: this.reconnectAttempts,
                            duration: reconnectTime,
                            timestamp: Date.now()
                        });
                        // Reset reconnect attempts on success
                        this.reconnectAttempts = 0;
                        return [3 /*break*/, 4];
                    case 3:
                        error_2 = _a.sent();
                        this.log('error', 'Reconnection failed', error_2);
                        this.handleDisconnection();
                        return [3 /*break*/, 4];
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Start heartbeat monitoring
     */
    ResilientDataConnector.prototype.startHeartbeat = function () {
        var _this = this;
        this.heartbeatTimer = setInterval(function () {
            if (!_this.ws || !_this.isConnected)
                return;
            // Send ping
            _this.ws.ping();
            // Check for stale connection
            var timeSinceLastMessage = Date.now() - _this.metrics.lastMessage;
            if (timeSinceLastMessage > _this.reconnectionConfig.staleConnectionThreshold) {
                _this.log('warn', 'Connection appears stale - forcing reconnection', {
                    lastMessage: timeSinceLastMessage
                });
                _this.emit('stale-connection', {
                    timeSinceLastMessage: timeSinceLastMessage,
                    timestamp: Date.now()
                });
                // Force reconnection
                _this.ws.terminate();
            }
        }, this.reconnectionConfig.heartbeatInterval);
    };
    /**
     * Stop heartbeat monitoring
     */
    ResilientDataConnector.prototype.stopHeartbeat = function () {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = undefined;
        }
    };
    /**
     * Open circuit breaker to prevent excessive reconnection attempts
     */
    ResilientDataConnector.prototype.openCircuitBreaker = function () {
        var _this = this;
        this.circuitBreakerOpen = true;
        this.log('error', 'Circuit breaker opened - blocking connections', {
            failures: this.consecutiveFailures,
            resetTime: this.reconnectionConfig.circuitBreakerResetTime
        });
        this.emit('circuit-breaker-open', {
            failures: this.consecutiveFailures,
            resetTime: this.reconnectionConfig.circuitBreakerResetTime,
            timestamp: Date.now()
        });
        // Schedule circuit breaker reset
        this.circuitBreakerTimer = setTimeout(function () {
            _this.resetCircuitBreaker();
        }, this.reconnectionConfig.circuitBreakerResetTime);
    };
    /**
     * Reset circuit breaker
     */
    ResilientDataConnector.prototype.resetCircuitBreaker = function () {
        this.circuitBreakerOpen = false;
        this.consecutiveFailures = 0;
        this.metrics.consecutiveFailures = 0;
        this.log('info', 'Circuit breaker reset - connections allowed');
        this.emit('circuit-breaker-reset', {
            timestamp: Date.now()
        });
        // Attempt to reconnect
        this.scheduleReconnection();
    };
    /**
     * Update latency metrics
     */
    ResilientDataConnector.prototype.updateLatency = function () {
        var latency = Date.now() - this.metrics.lastMessage;
        this.metrics.latency = latency;
        this.emit('latency-update', {
            latency: latency,
            timestamp: Date.now()
        });
    };
    /**
     * Update connection quality score
     */
    ResilientDataConnector.prototype.updateConnectionQuality = function () {
        // Calculate quality based on various factors
        var quality = 100;
        // Deduct for errors
        quality -= Math.min(this.metrics.errors * 2, 30);
        // Deduct for high latency
        if (this.metrics.latency > 1000)
            quality -= 10;
        if (this.metrics.latency > 5000)
            quality -= 20;
        // Deduct for reconnections
        quality -= Math.min(this.metrics.reconnects * 5, 30);
        // Deduct for consecutive failures
        quality -= this.metrics.consecutiveFailures * 10;
        this.metrics.connectionQuality = Math.max(0, quality);
    };
    /**
     * Record connection attempt for metrics
     */
    ResilientDataConnector.prototype.recordConnectionAttempt = function (startTime, success, error) {
        var attempt = {
            attemptNumber: this.reconnectAttempts + 1,
            timestamp: startTime,
            duration: Date.now() - startTime,
            success: success,
            error: error
        };
        this.connectionAttempts.push(attempt);
        // Keep only last 100 attempts
        if (this.connectionAttempts.length > 100) {
            this.connectionAttempts.shift();
        }
    };
    /**
     * Update reconnection metrics
     */
    ResilientDataConnector.prototype.updateReconnectionMetrics = function (duration) {
        // Update max reconnection time
        if (duration > this.metrics.maxReconnectTime) {
            this.metrics.maxReconnectTime = duration;
        }
        // Update average reconnection time
        var successfulAttempts = this.connectionAttempts.filter(function (a) { return a.success; });
        if (successfulAttempts.length > 0) {
            var totalTime = successfulAttempts.reduce(function (sum, a) { return sum + a.duration; }, 0);
            this.metrics.avgReconnectTime = totalTime / successfulAttempts.length;
        }
    };
    /**
     * Get current metrics
     */
    ResilientDataConnector.prototype.getMetrics = function () {
        return __assign(__assign({}, this.metrics), { uptime: this.isConnected ? Date.now() - this.metrics.lastMessage : 0 });
    };
    /**
     * Check if connection is healthy
     */
    ResilientDataConnector.prototype.isHealthy = function () {
        return this.isConnected &&
            !this.circuitBreakerOpen &&
            this.metrics.connectionQuality > 50 &&
            (Date.now() - this.metrics.lastMessage) < this.reconnectionConfig.staleConnectionThreshold;
    };
    /**
     * Graceful disconnect
     */
    ResilientDataConnector.prototype.disconnect = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _i, _a, ws;
            return __generator(this, function (_b) {
                this.log('info', 'Disconnecting gracefully');
                // Stop reconnection attempts
                if (this.reconnectTimer) {
                    clearTimeout(this.reconnectTimer);
                    this.reconnectTimer = undefined;
                }
                // Stop circuit breaker timer
                if (this.circuitBreakerTimer) {
                    clearTimeout(this.circuitBreakerTimer);
                    this.circuitBreakerTimer = undefined;
                }
                // Stop heartbeat
                this.stopHeartbeat();
                // Close WebSocket
                if (this.ws) {
                    this.ws.removeAllListeners();
                    this.ws.close(1000, 'Normal closure');
                    this.ws = null;
                }
                // Close connection pool
                for (_i = 0, _a = this.connectionPool; _i < _a.length; _i++) {
                    ws = _a[_i];
                    ws.removeAllListeners();
                    ws.close(1000, 'Normal closure');
                }
                this.connectionPool = [];
                this.isConnected = false;
                this.metrics.connected = false;
                this.emit('shutdown', {
                    timestamp: Date.now(),
                    metrics: this.getMetrics()
                });
                return [2 /*return*/];
            });
        });
    };
    /**
     * Send data with telemetry
     */
    ResilientDataConnector.prototype.send = function (data) {
        if (!this.ws || !this.isConnected) {
            throw new Error('Not connected');
        }
        var payload = typeof data === 'string' ? data : JSON.stringify(data);
        this.ws.send(payload);
        this.metrics.bytesSent += payload.length;
    };
    /**
     * Logging with telemetry
     */
    ResilientDataConnector.prototype.log = function (level, message, meta) {
        var logEntry = __assign({ timestamp: new Date().toISOString(), connector: this.config.name, level: level, message: message }, meta);
        // Emit telemetry event
        if (this.config.enableTelemetry) {
            this.emit('telemetry:log', logEntry);
        }
        // Console logging
        console[level]("[".concat(this.config.name, "] ").concat(message), meta || '');
    };
    return ResilientDataConnector;
}(events_1.EventEmitter));
exports.ResilientDataConnector = ResilientDataConnector;
