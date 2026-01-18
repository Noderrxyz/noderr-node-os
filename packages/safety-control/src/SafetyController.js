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
exports.SafetyController = void 0;
var events_1 = require("events");
var fs = require("fs");
var path = require("path");
var crypto = require("crypto");
var createLogger = function (name) { return ({
    info: function (message, meta) { return console.log("[".concat(name, "] INFO:"), message, meta || ''); },
    error: function (message, error) { return console.error("[".concat(name, "] ERROR:"), message, error || ''); },
    debug: function (message, meta) { return console.debug("[".concat(name, "] DEBUG:"), message, meta || ''); },
    warn: function (message, meta) { return console.warn("[".concat(name, "] WARN:"), message, meta || ''); }
}); };
var SafetyController = /** @class */ (function (_super) {
    __extends(SafetyController, _super);
    function SafetyController() {
        var _this = _super.call(this) || this;
        _this.tradingMode = 'SIMULATION';
        _this.modeHistory = [];
        _this.safetyChecks = [];
        _this.lockFilePath = '.trading-mode.lock';
        _this.encryptedLockPath = '.trading-mode.lock.enc';
        _this.logger = createLogger('SafetyController');
        // Generate or load encryption key
        _this.encryptionKey = _this.loadOrGenerateEncryptionKey();
        // Load persisted mode
        _this.loadPersistedMode();
        // Setup default safety checks
        _this.setupDefaultSafetyChecks();
        // Log initialization
        _this.logger.warn("\uD83D\uDD10 SafetyController initialized in ".concat(_this.tradingMode, " mode"));
        return _this;
    }
    SafetyController.getInstance = function () {
        if (!SafetyController.instance) {
            SafetyController.instance = new SafetyController();
        }
        return SafetyController.instance;
    };
    SafetyController.prototype.loadOrGenerateEncryptionKey = function () {
        var keyPath = path.join(process.cwd(), '.safety-key');
        if (fs.existsSync(keyPath)) {
            return fs.readFileSync(keyPath);
        }
        else {
            var key = crypto.randomBytes(32);
            fs.writeFileSync(keyPath, key);
            this.logger.info('Generated new encryption key for safety state');
            return key;
        }
    };
    SafetyController.prototype.loadPersistedMode = function () {
        try {
            // Try loading encrypted file first
            if (fs.existsSync(this.encryptedLockPath)) {
                var encrypted = fs.readFileSync(this.encryptedLockPath);
                var decrypted = this.decryptState(encrypted);
                var state = JSON.parse(decrypted);
                // Verify checksum
                if (this.verifyChecksum(state)) {
                    this.tradingMode = state.mode || 'SIMULATION';
                    if (state.lastChange) {
                        this.modeHistory.push(state.lastChange);
                    }
                    this.logger.info("Loaded encrypted trading mode: ".concat(this.tradingMode));
                    return;
                }
                else {
                    this.logger.error('Checksum verification failed, defaulting to SIMULATION');
                }
            }
            // Fallback to unencrypted file
            if (fs.existsSync(this.lockFilePath)) {
                var lockData = JSON.parse(fs.readFileSync(this.lockFilePath, 'utf8'));
                this.tradingMode = lockData.mode || 'SIMULATION';
                this.logger.info("Loaded persisted trading mode: ".concat(this.tradingMode));
            }
        }
        catch (error) {
            this.logger.error('Failed to load persisted mode, defaulting to SIMULATION', error);
            this.tradingMode = 'SIMULATION';
        }
    };
    SafetyController.prototype.setupDefaultSafetyChecks = function () {
        var _this = this;
        // Environment check
        this.addSafetyCheck({
            name: 'Environment Configuration',
            description: 'Verify ENABLE_LIVE_TRADING flag is set',
            check: function () { return __awaiter(_this, void 0, void 0, function () {
                var enabled;
                return __generator(this, function (_a) {
                    enabled = process.env.ENABLE_LIVE_TRADING === 'true';
                    if (!enabled) {
                        this.logger.warn('ENABLE_LIVE_TRADING is not true');
                    }
                    return [2 /*return*/, enabled];
                });
            }); },
            critical: true
        });
        // API Keys check
        this.addSafetyCheck({
            name: 'API Keys Validation',
            description: 'Ensure exchange API keys are configured',
            check: function () { return __awaiter(_this, void 0, void 0, function () {
                var hasKeys;
                return __generator(this, function (_a) {
                    hasKeys = !!(process.env.BINANCE_API_KEY &&
                        process.env.BINANCE_API_SECRET &&
                        process.env.COINBASE_API_KEY &&
                        process.env.COINBASE_API_SECRET);
                    if (!hasKeys) {
                        this.logger.warn('Missing exchange API keys');
                    }
                    return [2 /*return*/, this.tradingMode !== 'LIVE' || hasKeys];
                });
            }); },
            critical: true
        });
        // Database connectivity
        this.addSafetyCheck({
            name: 'Database Connectivity',
            description: 'Verify database is accessible',
            check: function () { return __awaiter(_this, void 0, void 0, function () {
                var dbConfigured;
                return __generator(this, function (_a) {
                    dbConfigured = !!(process.env.DB_HOST && process.env.DB_PASSWORD);
                    return [2 /*return*/, dbConfigured];
                });
            }); },
            critical: false
        });
        // Risk limits configured
        this.addSafetyCheck({
            name: 'Risk Limits Configuration',
            description: 'Ensure risk parameters are set',
            check: function () { return __awaiter(_this, void 0, void 0, function () {
                var hasLimits;
                return __generator(this, function (_a) {
                    hasLimits = !!(process.env.MAX_DRAWDOWN &&
                        process.env.DAILY_LOSS_LIMIT &&
                        process.env.MAX_POSITION_SIZE);
                    return [2 /*return*/, hasLimits];
                });
            }); },
            critical: true
        });
    };
    SafetyController.prototype.setTradingMode = function (mode, reason, authorizedBy, approvalSignatures) {
        return __awaiter(this, void 0, void 0, function () {
            var previousMode, safetyResult, changeEvent, logMessage;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        previousMode = this.tradingMode;
                        // Don't change if already in requested mode
                        if (previousMode === mode) {
                            this.logger.info("Already in ".concat(mode, " mode"));
                            return [2 /*return*/, true];
                        }
                        // Log mode change attempt
                        this.logger.warn("\uD83D\uDD04 Trading mode change requested: ".concat(previousMode, " \u2192 ").concat(mode), {
                            reason: reason,
                            authorizedBy: authorizedBy,
                            timestamp: new Date().toISOString()
                        });
                        if (!(mode === 'LIVE')) return [3 /*break*/, 2];
                        return [4 /*yield*/, this.runSafetyChecks()];
                    case 1:
                        safetyResult = _a.sent();
                        if (!safetyResult.passed) {
                            this.logger.error('❌ Safety checks failed, cannot enable LIVE mode', {
                                failedChecks: safetyResult.failedChecks
                            });
                            this.emit('mode-change-rejected', {
                                requestedMode: mode,
                                reason: 'Safety checks failed',
                                failedChecks: safetyResult.failedChecks,
                                timestamp: Date.now()
                            });
                            return [2 /*return*/, false];
                        }
                        // Additional warning for LIVE mode
                        this.logger.warn('⚠️  ENABLING LIVE TRADING MODE - REAL MONEY AT RISK');
                        _a.label = 2;
                    case 2:
                        // Update mode
                        this.tradingMode = mode;
                        changeEvent = {
                            previousMode: previousMode,
                            newMode: mode,
                            reason: reason,
                            timestamp: Date.now(),
                            authorizedBy: authorizedBy,
                            approvalSignatures: approvalSignatures
                        };
                        // Persist to both encrypted and plain files
                        this.persistMode(changeEvent);
                        // Add to history
                        this.modeHistory.push(changeEvent);
                        logMessage = "\uD83D\uDD10 TRADING MODE CHANGED: ".concat(previousMode, " \u2192 ").concat(mode);
                        if (mode === 'LIVE') {
                            this.logger.error(logMessage, changeEvent); // Use error level for visibility
                        }
                        else {
                            this.logger.warn(logMessage, changeEvent);
                        }
                        // Emit change event
                        this.emit('mode-changed', changeEvent);
                        // If changing away from LIVE, emit safety event
                        if (previousMode === 'LIVE' && mode !== 'LIVE') {
                            this.emit('live-trading-disabled', changeEvent);
                        }
                        return [2 /*return*/, true];
                }
            });
        });
    };
    SafetyController.prototype.persistMode = function (event) {
        try {
            var state = {
                mode: this.tradingMode,
                lastChange: event,
                timestamp: Date.now(),
                checksum: ''
            };
            // Calculate checksum
            state.checksum = this.calculateChecksum(state);
            // Save encrypted version
            var encrypted = this.encryptState(JSON.stringify(state));
            fs.writeFileSync(this.encryptedLockPath, encrypted);
            // Also save plain version for debugging
            fs.writeFileSync(this.lockFilePath, JSON.stringify(state, null, 2));
            // Append to audit log
            this.appendToAuditLog(event);
        }
        catch (error) {
            this.logger.error('Failed to persist mode', error);
        }
    };
    SafetyController.prototype.encryptState = function (data) {
        var iv = crypto.randomBytes(16);
        var cipher = crypto.createCipheriv('aes-256-cbc', this.encryptionKey, iv);
        var encrypted = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
        return Buffer.concat([iv, encrypted]);
    };
    SafetyController.prototype.decryptState = function (data) {
        var iv = data.slice(0, 16);
        var encrypted = data.slice(16);
        var decipher = crypto.createDecipheriv('aes-256-cbc', this.encryptionKey, iv);
        var decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
        return decrypted.toString('utf8');
    };
    SafetyController.prototype.calculateChecksum = function (state) {
        var _a;
        var data = "".concat(state.mode, "-").concat(state.timestamp, "-").concat(((_a = state.lastChange) === null || _a === void 0 ? void 0 : _a.timestamp) || 0);
        return crypto.createHash('sha256').update(data).digest('hex');
    };
    SafetyController.prototype.verifyChecksum = function (state) {
        var calculated = this.calculateChecksum(__assign(__assign({}, state), { checksum: '' }));
        return calculated === state.checksum;
    };
    SafetyController.prototype.appendToAuditLog = function (event) {
        var auditPath = path.join(process.cwd(), 'SAFETY_AUDIT_LOG.jsonl');
        var auditEntry = __assign(__assign({}, event), { type: 'MODE_CHANGE', systemTime: new Date().toISOString() });
        fs.appendFileSync(auditPath, JSON.stringify(auditEntry) + '\n');
    };
    SafetyController.prototype.getTradingMode = function () {
        return this.tradingMode;
    };
    SafetyController.prototype.canExecuteLiveTrade = function () {
        var canTrade = this.tradingMode === 'LIVE' && process.env.ENABLE_LIVE_TRADING === 'true';
        if (!canTrade && this.tradingMode === 'LIVE') {
            this.logger.warn('Live mode enabled but ENABLE_LIVE_TRADING is not true');
        }
        return canTrade;
    };
    SafetyController.prototype.isSimulationMode = function () {
        return this.tradingMode === 'SIMULATION';
    };
    SafetyController.prototype.isPaused = function () {
        return this.tradingMode === 'PAUSED';
    };
    SafetyController.prototype.addSafetyCheck = function (check) {
        this.safetyChecks.push(check);
        this.logger.debug("Added safety check: ".concat(check.name));
    };
    SafetyController.prototype.runSafetyChecks = function () {
        return __awaiter(this, void 0, void 0, function () {
            var failedChecks, criticalFailure, _i, _a, check, passed_1, error_1, passed;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        this.logger.info('Running safety checks...');
                        failedChecks = [];
                        criticalFailure = false;
                        _i = 0, _a = this.safetyChecks;
                        _b.label = 1;
                    case 1:
                        if (!(_i < _a.length)) return [3 /*break*/, 6];
                        check = _a[_i];
                        _b.label = 2;
                    case 2:
                        _b.trys.push([2, 4, , 5]);
                        return [4 /*yield*/, check.check()];
                    case 3:
                        passed_1 = _b.sent();
                        if (!passed_1) {
                            failedChecks.push(check.name);
                            this.logger.warn("Safety check failed: ".concat(check.name));
                            if (check.critical) {
                                criticalFailure = true;
                            }
                        }
                        else {
                            this.logger.debug("Safety check passed: ".concat(check.name));
                        }
                        return [3 /*break*/, 5];
                    case 4:
                        error_1 = _b.sent();
                        this.logger.error("Safety check error: ".concat(check.name), error_1);
                        failedChecks.push(check.name);
                        if (check.critical) {
                            criticalFailure = true;
                        }
                        return [3 /*break*/, 5];
                    case 5:
                        _i++;
                        return [3 /*break*/, 1];
                    case 6:
                        passed = !criticalFailure && failedChecks.length === 0;
                        this.logger.info("Safety checks complete: ".concat(passed ? 'PASSED' : 'FAILED'));
                        return [2 /*return*/, { passed: passed, failedChecks: failedChecks }];
                }
            });
        });
    };
    SafetyController.prototype.getModeHistory = function () {
        return __spreadArray([], this.modeHistory, true);
    };
    SafetyController.prototype.getLastModeChange = function () {
        return this.modeHistory[this.modeHistory.length - 1];
    };
    SafetyController.prototype.getSafetyStatus = function () {
        var _a;
        var startTime = ((_a = this.getLastModeChange()) === null || _a === void 0 ? void 0 : _a.timestamp) || Date.now();
        return {
            mode: this.tradingMode,
            isLiveEnabled: this.canExecuteLiveTrade(),
            lastChange: this.getLastModeChange(),
            uptime: Date.now() - startTime,
            checksConfigured: this.safetyChecks.length
        };
    };
    // Emergency stop function
    SafetyController.prototype.emergencyStop = function (reason) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        this.logger.error("\uD83D\uDEA8 EMERGENCY STOP TRIGGERED: ".concat(reason));
                        // Immediately switch to PAUSED mode
                        return [4 /*yield*/, this.setTradingMode('PAUSED', "EMERGENCY: ".concat(reason), 'SYSTEM')];
                    case 1:
                        // Immediately switch to PAUSED mode
                        _a.sent();
                        // Emit emergency event
                        this.emit('emergency-stop', {
                            reason: reason,
                            timestamp: Date.now(),
                            previousMode: this.tradingMode
                        });
                        // Log to audit
                        this.appendToAuditLog({
                            previousMode: this.tradingMode,
                            newMode: 'PAUSED',
                            reason: "EMERGENCY STOP: ".concat(reason),
                            timestamp: Date.now(),
                            authorizedBy: 'SYSTEM'
                        });
                        return [2 /*return*/];
                }
            });
        });
    };
    // CLI command support
    SafetyController.prototype.getCliStatus = function () {
        var status = this.getSafetyStatus();
        var lines = [
            '╔════════════════════════════════════════╗',
            '║        SAFETY CONTROLLER STATUS        ║',
            '╠════════════════════════════════════════╣',
            "\u2551 Mode: ".concat(status.mode.padEnd(32), " \u2551"),
            "\u2551 Live Trading: ".concat((status.isLiveEnabled ? 'ENABLED' : 'DISABLED').padEnd(24), " \u2551"),
            "\u2551 Safety Checks: ".concat(String(status.checksConfigured).padEnd(23), " \u2551"),
            "\u2551 Uptime: ".concat(this.formatUptime(status.uptime).padEnd(30), " \u2551"),
            '╚════════════════════════════════════════╝'
        ];
        if (status.lastChange) {
            lines.push('');
            lines.push("Last Change: ".concat(new Date(status.lastChange.timestamp).toISOString()));
            lines.push("Reason: ".concat(status.lastChange.reason));
            lines.push("Authorized By: ".concat(status.lastChange.authorizedBy || 'Unknown'));
        }
        return lines.join('\n');
    };
    SafetyController.prototype.formatUptime = function (ms) {
        var seconds = Math.floor(ms / 1000);
        var minutes = Math.floor(seconds / 60);
        var hours = Math.floor(minutes / 60);
        var days = Math.floor(hours / 24);
        if (days > 0)
            return "".concat(days, "d ").concat(hours % 24, "h");
        if (hours > 0)
            return "".concat(hours, "h ").concat(minutes % 60, "m");
        if (minutes > 0)
            return "".concat(minutes, "m ").concat(seconds % 60, "s");
        return "".concat(seconds, "s");
    };
    return SafetyController;
}(events_1.EventEmitter));
exports.SafetyController = SafetyController;
