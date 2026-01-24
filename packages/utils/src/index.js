"use strict";
/**
 * @noderr/utils - Shared utilities for Noderr Protocol
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
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = exports.CircularBuffer = exports.RetryManager = exports.Logger = void 0;
exports.generateId = generateId;
exports.sleep = sleep;
exports.deepClone = deepClone;
const winston = __importStar(require("winston"));
const uuid_1 = require("uuid");
// Logger
class Logger {
    logger;
    constructor(name, options) {
        this.logger = winston.createLogger({
            level: options?.level || 'info',
            format: winston.format.combine(winston.format.timestamp(), winston.format.errors({ stack: true }), winston.format.json()),
            defaultMeta: { service: name },
            transports: [
                new winston.transports.Console({
                    format: winston.format.combine(winston.format.colorize(), winston.format.simple())
                })
            ],
            ...options
        });
    }
    debug(message, meta) {
        this.logger.debug(message, meta);
    }
    info(message, meta) {
        this.logger.info(message, meta);
    }
    warn(message, meta) {
        this.logger.warn(message, meta);
    }
    error(message, error, meta) {
        if (error instanceof Error) {
            this.logger.error(message, { error: error.message, stack: error.stack, ...meta });
        }
        else {
            this.logger.error(message, { error, ...meta });
        }
    }
    child(name) {
        return new Logger(`${this.logger.defaultMeta?.service}.${name}`);
    }
    // Get the underlying winston logger instance for compatibility
    getWinstonLogger() {
        return this.logger;
    }
}
exports.Logger = Logger;
class RetryManager {
    options;
    constructor(options) {
        this.options = options;
    }
    async execute(operation, shouldRetry) {
        let lastError;
        for (let attempt = 1; attempt <= this.options.maxAttempts; attempt++) {
            try {
                return await operation();
            }
            catch (error) {
                lastError = error;
                if (attempt === this.options.maxAttempts) {
                    throw lastError;
                }
                if (shouldRetry && !shouldRetry(lastError)) {
                    throw lastError;
                }
                const delay = this.calculateDelay(attempt);
                await this.sleep(delay);
            }
        }
        throw lastError;
    }
    calculateDelay(attempt) {
        let delay;
        if (this.options.backoff === 'exponential') {
            const factor = this.options.factor || 2;
            delay = this.options.initialDelay * Math.pow(factor, attempt - 1);
        }
        else {
            delay = this.options.initialDelay * attempt;
        }
        if (this.options.maxDelay) {
            delay = Math.min(delay, this.options.maxDelay);
        }
        if (this.options.jitter) {
            delay = delay * (0.5 + Math.random() * 0.5);
        }
        return delay;
    }
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
exports.RetryManager = RetryManager;
// Circular Buffer
class CircularBuffer {
    capacity;
    buffer;
    head = 0;
    tail = 0;
    count = 0;
    constructor(capacity) {
        this.capacity = capacity;
        this.buffer = new Array(capacity);
    }
    push(item) {
        this.buffer[this.tail] = item;
        this.tail = (this.tail + 1) % this.capacity;
        if (this.count < this.capacity) {
            this.count++;
        }
        else {
            this.head = (this.head + 1) % this.capacity;
        }
    }
    pop() {
        if (this.count === 0) {
            return undefined;
        }
        const item = this.buffer[this.head];
        this.buffer[this.head] = undefined;
        this.head = (this.head + 1) % this.capacity;
        this.count--;
        return item;
    }
    peek() {
        if (this.count === 0) {
            return undefined;
        }
        return this.buffer[this.head];
    }
    toArray() {
        const result = [];
        let index = this.head;
        for (let i = 0; i < this.count; i++) {
            result.push(this.buffer[index]);
            index = (index + 1) % this.capacity;
        }
        return result;
    }
    clear() {
        this.buffer = new Array(this.capacity);
        this.head = 0;
        this.tail = 0;
        this.count = 0;
    }
    get size() {
        return this.count;
    }
    get isFull() {
        return this.count === this.capacity;
    }
    get isEmpty() {
        return this.count === 0;
    }
}
exports.CircularBuffer = CircularBuffer;
// ID Generator
function generateId(prefix) {
    const id = (0, uuid_1.v4)();
    return prefix ? `${prefix}_${id}` : id;
}
// Sleep utility
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
// Deep clone utility
function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}
// Export default logger instance
exports.logger = new Logger('noderr');
// Export graceful shutdown utilities
__exportStar(require("./graceful-shutdown"), exports);
// Export state persistence utilities
__exportStar(require("./state-persistence"), exports);
// Export NFT verification utilities
__exportStar(require("./nft-verification"), exports);
//# sourceMappingURL=index.js.map