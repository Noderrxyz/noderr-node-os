"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CircuitBreakerFactory = exports.CircuitBreaker = exports.CircuitState = void 0;
const events_1 = require("events");
var CircuitState;
(function (CircuitState) {
    CircuitState["CLOSED"] = "CLOSED";
    CircuitState["OPEN"] = "OPEN";
    CircuitState["HALF_OPEN"] = "HALF_OPEN";
})(CircuitState || (exports.CircuitState = CircuitState = {}));
class CircuitBreaker extends events_1.EventEmitter {
    config;
    state = CircuitState.CLOSED;
    logger;
    metrics;
    requestWindow = [];
    halfOpenSuccesses = 0;
    lastStateChange = new Date();
    nextAttempt = 0;
    stateChangeTimer;
    constructor(config, logger) {
        super();
        this.config = config;
        this.logger = logger;
        this.metrics = this.initializeMetrics();
    }
    async execute(fn) {
        // Check if circuit is open
        if (this.state === CircuitState.OPEN) {
            if (Date.now() < this.nextAttempt) {
                this.metrics.shortCircuited++;
                this.emit('short-circuit', { name: this.config.name });
                if (this.config.fallbackFunction) {
                    return this.executeFallback();
                }
                throw new Error(`Circuit breaker ${this.config.name} is OPEN`);
            }
            else {
                // Transition to half-open
                this.transitionTo(CircuitState.HALF_OPEN);
            }
        }
        const startTime = Date.now();
        try {
            // Set timeout
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Request timeout')), this.config.timeout);
            });
            const result = await Promise.race([fn(), timeoutPromise]);
            // Record success
            this.recordSuccess(Date.now() - startTime);
            // Handle half-open state
            if (this.state === CircuitState.HALF_OPEN) {
                this.halfOpenSuccesses++;
                if (this.halfOpenSuccesses >= this.config.successThresholdCount) {
                    this.transitionTo(CircuitState.CLOSED);
                }
            }
            return result;
        }
        catch (error) {
            // Record failure
            this.recordFailure(Date.now() - startTime, error);
            // Handle state transitions
            if (this.state === CircuitState.HALF_OPEN) {
                this.transitionTo(CircuitState.OPEN);
            }
            else if (this.state === CircuitState.CLOSED) {
                if (this.shouldOpen()) {
                    this.transitionTo(CircuitState.OPEN);
                }
            }
            // Try fallback
            if (this.config.fallbackFunction) {
                return this.executeFallback();
            }
            throw error;
        }
    }
    async executeFallback() {
        try {
            const result = await this.config.fallbackFunction();
            this.metrics.fallbackSuccess++;
            this.emit('fallback-success', { name: this.config.name });
            return result;
        }
        catch (error) {
            this.metrics.fallbackFailure++;
            this.emit('fallback-failure', { name: this.config.name, error });
            throw error;
        }
    }
    recordSuccess(latency) {
        this.metrics.totalRequests++;
        this.metrics.successfulRequests++;
        this.requestWindow.push({
            timestamp: Date.now(),
            success: true,
            latency
        });
        this.cleanupWindow();
        this.updateMetrics();
        this.emit('success', {
            name: this.config.name,
            latency,
            state: this.state
        });
    }
    recordFailure(latency, error) {
        this.metrics.totalRequests++;
        this.metrics.failedRequests++;
        if (error.message === 'Request timeout') {
            this.metrics.timeouts++;
        }
        this.requestWindow.push({
            timestamp: Date.now(),
            success: false,
            latency,
            error
        });
        this.cleanupWindow();
        this.updateMetrics();
        this.emit('failure', {
            name: this.config.name,
            latency,
            error,
            state: this.state
        });
    }
    shouldOpen() {
        const recentRequests = this.getRecentRequests();
        // Check volume threshold
        if (recentRequests.length < this.config.volumeThreshold) {
            return false;
        }
        // Check error count threshold
        const failures = recentRequests.filter(r => !r.success).length;
        if (failures >= this.config.errorThresholdCount) {
            return true;
        }
        // Check error percentage threshold
        const errorRate = failures / recentRequests.length;
        return errorRate >= this.config.errorThresholdPercentage / 100;
    }
    transitionTo(newState) {
        const oldState = this.state;
        this.state = newState;
        this.lastStateChange = new Date();
        this.metrics.lastStateChange = this.lastStateChange;
        this.metrics.state = newState;
        // Clear any existing timer
        if (this.stateChangeTimer) {
            clearTimeout(this.stateChangeTimer);
            this.stateChangeTimer = undefined;
        }
        switch (newState) {
            case CircuitState.OPEN:
                this.nextAttempt = Date.now() + this.config.resetTimeout;
                this.halfOpenSuccesses = 0;
                // Set timer to transition to half-open
                this.stateChangeTimer = setTimeout(() => {
                    if (this.state === CircuitState.OPEN) {
                        this.transitionTo(CircuitState.HALF_OPEN);
                    }
                }, this.config.resetTimeout);
                this.logger.warn(`Circuit breaker ${this.config.name} opened`, {
                    errorRate: this.metrics.errorRate,
                    failures: this.metrics.failedRequests
                });
                break;
            case CircuitState.HALF_OPEN:
                this.halfOpenSuccesses = 0;
                this.logger.info(`Circuit breaker ${this.config.name} half-open`);
                break;
            case CircuitState.CLOSED:
                this.halfOpenSuccesses = 0;
                this.logger.info(`Circuit breaker ${this.config.name} closed`);
                break;
        }
        this.emit('state-change', {
            name: this.config.name,
            oldState,
            newState,
            metrics: this.getMetrics()
        });
    }
    getRecentRequests() {
        const cutoff = Date.now() - this.config.rollingWindowSize;
        return this.requestWindow.filter(r => r.timestamp >= cutoff);
    }
    cleanupWindow() {
        const cutoff = Date.now() - this.config.rollingWindowSize * 2;
        this.requestWindow = this.requestWindow.filter(r => r.timestamp >= cutoff);
    }
    updateMetrics() {
        const recentRequests = this.getRecentRequests();
        if (recentRequests.length === 0) {
            this.metrics.errorRate = 0;
            return;
        }
        // Calculate error rate
        const failures = recentRequests.filter(r => !r.success).length;
        this.metrics.errorRate = failures / recentRequests.length;
        // Calculate latency percentiles
        const latencies = recentRequests.map(r => r.latency).sort((a, b) => a - b);
        this.metrics.latencyPercentiles = {
            p50: this.percentile(latencies, 0.5),
            p75: this.percentile(latencies, 0.75),
            p90: this.percentile(latencies, 0.9),
            p95: this.percentile(latencies, 0.95),
            p99: this.percentile(latencies, 0.99)
        };
    }
    percentile(sortedArray, p) {
        if (sortedArray.length === 0)
            return 0;
        const index = Math.ceil(sortedArray.length * p) - 1;
        return sortedArray[Math.max(0, Math.min(index, sortedArray.length - 1))];
    }
    initializeMetrics() {
        return {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            timeouts: 0,
            shortCircuited: 0,
            fallbackSuccess: 0,
            fallbackFailure: 0,
            latencyPercentiles: {
                p50: 0,
                p75: 0,
                p90: 0,
                p95: 0,
                p99: 0
            },
            errorRate: 0,
            state: CircuitState.CLOSED,
            lastStateChange: new Date()
        };
    }
    // Public methods
    getState() {
        return this.state;
    }
    getMetrics() {
        return { ...this.metrics };
    }
    reset() {
        this.transitionTo(CircuitState.CLOSED);
        this.requestWindow = [];
        this.metrics = this.initializeMetrics();
        this.emit('reset', { name: this.config.name });
    }
    forceOpen() {
        this.transitionTo(CircuitState.OPEN);
    }
    forceClosed() {
        this.transitionTo(CircuitState.CLOSED);
    }
    isOpen() {
        return this.state === CircuitState.OPEN;
    }
    isClosed() {
        return this.state === CircuitState.CLOSED;
    }
    isHalfOpen() {
        return this.state === CircuitState.HALF_OPEN;
    }
    destroy() {
        if (this.stateChangeTimer) {
            clearTimeout(this.stateChangeTimer);
        }
        this.removeAllListeners();
    }
}
exports.CircuitBreaker = CircuitBreaker;
// Factory for creating circuit breakers
class CircuitBreakerFactory {
    breakers = new Map();
    logger;
    defaultConfig;
    constructor(logger, defaultConfig) {
        this.logger = logger;
        this.defaultConfig = defaultConfig || {
            timeout: 3000,
            errorThresholdPercentage: 50,
            errorThresholdCount: 5,
            successThresholdCount: 3,
            resetTimeout: 30000,
            volumeThreshold: 10,
            rollingWindowSize: 60000
        };
    }
    create(config) {
        if (this.breakers.has(config.name)) {
            return this.breakers.get(config.name);
        }
        const fullConfig = {
            ...this.defaultConfig,
            ...config
        };
        const breaker = new CircuitBreaker(fullConfig, this.logger);
        this.breakers.set(config.name, breaker);
        // Set up monitoring
        breaker.on('state-change', (event) => {
            this.logger.info('Circuit breaker state change', event);
        });
        breaker.on('failure', (event) => {
            if (event.error?.message !== 'Request timeout') {
                this.logger.error('Circuit breaker request failed', event);
            }
        });
        return breaker;
    }
    get(name) {
        return this.breakers.get(name);
    }
    getAll() {
        return new Map(this.breakers);
    }
    getMetrics() {
        const metrics = new Map();
        for (const [name, breaker] of this.breakers) {
            metrics.set(name, breaker.getMetrics());
        }
        return metrics;
    }
    resetAll() {
        for (const breaker of this.breakers.values()) {
            breaker.reset();
        }
    }
    destroy() {
        for (const breaker of this.breakers.values()) {
            breaker.destroy();
        }
        this.breakers.clear();
    }
}
exports.CircuitBreakerFactory = CircuitBreakerFactory;
//# sourceMappingURL=CircuitBreaker.js.map