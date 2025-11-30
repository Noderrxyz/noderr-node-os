"use strict";
/**
 * @noderr/utils - Shared utilities for Noderr Protocol
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = exports.CircularBuffer = exports.RetryManager = exports.Logger = void 0;
exports.generateId = generateId;
exports.sleep = sleep;
exports.deepClone = deepClone;
const winston_1 = __importDefault(require("winston"));
const uuid_1 = require("uuid");
// Logger
class Logger {
    logger;
    constructor(name, options) {
        this.logger = winston_1.default.createLogger({
            level: options?.level || 'info',
            format: winston_1.default.format.combine(winston_1.default.format.timestamp(), winston_1.default.format.errors({ stack: true }), winston_1.default.format.json()),
            defaultMeta: { service: name },
            transports: [
                new winston_1.default.transports.Console({
                    format: winston_1.default.format.combine(winston_1.default.format.colorize(), winston_1.default.format.simple())
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
//# sourceMappingURL=index.js.map