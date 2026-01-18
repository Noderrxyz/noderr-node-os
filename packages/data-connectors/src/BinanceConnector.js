"use strict";
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
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BinanceConnector = void 0;
var ResilientDataConnector_1 = require("./ResilientDataConnector");
var BinanceConnector = /** @class */ (function (_super) {
    __extends(BinanceConnector, _super);
    function BinanceConnector(config) {
        var _this = _super.call(this, __assign(__assign({}, config), { name: 'BinanceConnector', enableTelemetry: true, reconnection: __assign({ 
                // Binance-specific reconnection config
                initialDelay: 1000, maxDelay: 300000, backoffMultiplier: 1.5, jitterFactor: 0.3, circuitBreakerThreshold: 20, circuitBreakerResetTime: 600000 }, config.reconnection) })) || this;
        _this.subscriptions = new Set();
        _this.messageBuffer = [];
        _this.bufferTimer = null;
        _this.config = config;
        return _this;
    }
    /**
     * Handle connection setup after WebSocket is established
     */
    BinanceConnector.prototype.onConnected = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _i, _a, symbol;
            return __generator(this, function (_b) {
                this.log('info', 'Binance WebSocket connected', {
                    symbols: this.config.symbols
                });
                // Subscriptions are handled via URL in Binance
                for (_i = 0, _a = this.config.symbols; _i < _a.length; _i++) {
                    symbol = _a[_i];
                    this.subscriptions.add(symbol);
                }
                this.emit('subscriptions-ready', {
                    symbols: Array.from(this.subscriptions)
                });
                return [2 /*return*/];
            });
        });
    };
    /**
     * Override connect to build proper Binance WebSocket URL
     */
    BinanceConnector.prototype.connect = function () {
        return __awaiter(this, void 0, void 0, function () {
            var streams;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        streams = this.config.symbols.map(function (symbol) {
                            return "".concat(symbol.toLowerCase(), "@ticker/").concat(symbol.toLowerCase(), "@depth20@100ms/").concat(symbol.toLowerCase(), "@trade");
                        }).join('/');
                        // Update URL with streams
                        this.config.url = "".concat(this.config.url, "/stream?streams=").concat(streams);
                        // Call parent connect
                        return [4 /*yield*/, _super.prototype.connect.call(this)];
                    case 1:
                        // Call parent connect
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Handle incoming WebSocket messages
     */
    BinanceConnector.prototype.handleMessage = function (data) {
        try {
            var message = JSON.parse(data.toString());
            // Binance wraps stream data
            if (message.stream && message.data) {
                var streamType = this.getStreamType(message.stream);
                var streamData = message.data;
                switch (streamType) {
                    case 'ticker':
                        this.processTicker(streamData);
                        break;
                    case 'depth':
                        this.processOrderBook(streamData);
                        break;
                    case 'trade':
                        this.processTrade(streamData);
                        break;
                    default:
                        this.log('debug', 'Unknown stream type', { type: streamType });
                }
            }
            // Buffer messages for batch processing
            this.bufferMessage(message);
            // Emit telemetry
            this.emit('telemetry:message_processed', {
                type: 'market_data',
                exchange: 'binance',
                timestamp: Date.now()
            });
        }
        catch (error) {
            this.log('error', 'Failed to process message', error);
            this.emit('telemetry:error', {
                type: 'message_processing',
                error: error instanceof Error ? error.message : 'Unknown error',
                timestamp: Date.now()
            });
        }
    };
    BinanceConnector.prototype.getStreamType = function (stream) {
        if (stream.includes('@ticker'))
            return 'ticker';
        if (stream.includes('@depth'))
            return 'depth';
        if (stream.includes('@trade'))
            return 'trade';
        return 'unknown';
    };
    BinanceConnector.prototype.processTicker = function (data) {
        var marketData = {
            symbol: data.s,
            price: parseFloat(data.c),
            volume: parseFloat(data.v),
            timestamp: data.E,
            bid: parseFloat(data.b),
            ask: parseFloat(data.a),
            spread: parseFloat(data.a) - parseFloat(data.b)
        };
        this.emit('market-data', marketData);
        // Update telemetry
        this.emit('telemetry:market_data', {
            symbol: marketData.symbol,
            price: marketData.price,
            spread: marketData.spread,
            latency: Date.now() - marketData.timestamp,
            timestamp: Date.now()
        });
    };
    BinanceConnector.prototype.processOrderBook = function (data) {
        var orderBook = {
            symbol: this.extractSymbolFromStream(data),
            bids: data.bids || [],
            asks: data.asks || [],
            lastUpdateId: data.lastUpdateId || data.u,
            timestamp: Date.now()
        };
        this.emit('orderbook-update', orderBook);
        // Telemetry for order book depth
        this.emit('telemetry:orderbook_depth', {
            symbol: orderBook.symbol,
            bidLevels: orderBook.bids.length,
            askLevels: orderBook.asks.length,
            timestamp: Date.now()
        });
    };
    BinanceConnector.prototype.processTrade = function (data) {
        var trade = {
            symbol: data.s,
            price: data.p,
            quantity: data.q,
            time: data.T,
            isBuyerMaker: data.m,
            tradeId: data.t
        };
        this.emit('trade', trade);
        // Trade flow telemetry
        this.emit('telemetry:trade', {
            symbol: trade.symbol,
            price: parseFloat(trade.price),
            quantity: parseFloat(trade.quantity),
            side: trade.isBuyerMaker ? 'sell' : 'buy',
            timestamp: Date.now()
        });
    };
    BinanceConnector.prototype.extractSymbolFromStream = function (data) {
        return data.s || data.symbol || 'UNKNOWN';
    };
    BinanceConnector.prototype.bufferMessage = function (message) {
        var _this = this;
        this.messageBuffer.push(message);
        // Process buffer periodically
        if (!this.bufferTimer) {
            this.bufferTimer = setTimeout(function () {
                _this.processMessageBuffer();
                _this.bufferTimer = null;
            }, 100); // Process every 100ms
        }
    };
    BinanceConnector.prototype.processMessageBuffer = function () {
        if (this.messageBuffer.length === 0)
            return;
        var bufferSize = this.messageBuffer.length;
        var messages = __spreadArray([], this.messageBuffer, true);
        this.messageBuffer = [];
        this.emit('batch-update', {
            messages: messages,
            count: bufferSize,
            timestamp: Date.now()
        });
        // Batch processing telemetry
        this.emit('telemetry:batch_processed', {
            messageCount: bufferSize,
            timestamp: Date.now()
        });
    };
    BinanceConnector.prototype.addSymbol = function (symbol) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (this.subscriptions.has(symbol)) {
                            this.log('warn', "Already subscribed to ".concat(symbol));
                            return [2 /*return*/];
                        }
                        this.log('info', "Adding symbol: ".concat(symbol));
                        // For Binance, we need to reconnect with new stream list
                        this.config.symbols.push(symbol);
                        // Disconnect and reconnect with new symbol list
                        return [4 /*yield*/, this.disconnect()];
                    case 1:
                        // Disconnect and reconnect with new symbol list
                        _a.sent();
                        return [4 /*yield*/, this.connect()];
                    case 2:
                        _a.sent();
                        this.emit('symbol-added', { symbol: symbol, timestamp: Date.now() });
                        return [2 /*return*/];
                }
            });
        });
    };
    BinanceConnector.prototype.removeSymbol = function (symbol) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!this.subscriptions.has(symbol)) {
                            this.log('warn', "Not subscribed to ".concat(symbol));
                            return [2 /*return*/];
                        }
                        this.log('info', "Removing symbol: ".concat(symbol));
                        // For Binance, we need to reconnect with new stream list
                        this.config.symbols = this.config.symbols.filter(function (s) { return s !== symbol; });
                        this.subscriptions.delete(symbol);
                        // Disconnect and reconnect with new symbol list
                        return [4 /*yield*/, this.disconnect()];
                    case 1:
                        // Disconnect and reconnect with new symbol list
                        _a.sent();
                        return [4 /*yield*/, this.connect()];
                    case 2:
                        _a.sent();
                        this.emit('symbol-removed', { symbol: symbol, timestamp: Date.now() });
                        return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Override disconnect to clean up Binance-specific resources
     */
    BinanceConnector.prototype.disconnect = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        // Process any remaining buffered messages
                        if (this.bufferTimer) {
                            clearTimeout(this.bufferTimer);
                            this.bufferTimer = null;
                        }
                        this.processMessageBuffer();
                        // Clear subscriptions
                        this.subscriptions.clear();
                        // Call parent disconnect
                        return [4 /*yield*/, _super.prototype.disconnect.call(this)];
                    case 1:
                        // Call parent disconnect
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Get active subscriptions
     */
    BinanceConnector.prototype.getActiveSymbols = function () {
        return Array.from(this.subscriptions);
    };
    /**
     * Get exchange-specific status
     */
    BinanceConnector.prototype.getExchangeStatus = function () {
        return {
            exchange: 'binance',
            symbols: this.config.symbols,
            messageBufferSize: this.messageBuffer.length,
            subscriptionCount: this.subscriptions.size
        };
    };
    return BinanceConnector;
}(ResilientDataConnector_1.ResilientDataConnector));
exports.BinanceConnector = BinanceConnector;
