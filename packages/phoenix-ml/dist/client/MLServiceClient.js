"use strict";
/**
 * Node.js gRPC client for ML service.
 *
 * Provides high-performance access to:
 * - Transformer price predictions
 * - GAF regime classification
 * - 94-feature generation
 *
 * Features:
 * - Connection pooling
 * - Automatic retries
 * - Error handling
 * - Performance monitoring
 * - Type-safe interface
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MLServiceClient = void 0;
exports.createMLServiceClient = createMLServiceClient;
const grpc = __importStar(require("@grpc/grpc-js"));
const protoLoader = __importStar(require("@grpc/proto-loader"));
const events_1 = require("events");
const path_1 = __importDefault(require("path"));
/**
 * gRPC client for ML service.
 *
 * Provides type-safe, high-performance access to ML inference.
 */
class MLServiceClient extends events_1.EventEmitter {
    client;
    config;
    requestCount = 0;
    totalLatency = 0;
    connected = false;
    constructor(config) {
        super();
        this.config = {
            host: config.host,
            port: config.port,
            maxRetries: config.maxRetries ?? 3,
            retryDelayMs: config.retryDelayMs ?? 1000,
            timeoutMs: config.timeoutMs ?? 30000,
            enableMonitoring: config.enableMonitoring ?? true,
        };
        this._initializeClient();
    }
    /**
     * Initialize the gRPC client.
     */
    _initializeClient() {
        // Load proto file
        const PROTO_PATH = path_1.default.join(__dirname, '../../../ml-service/proto/ml_service.proto');
        const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
            keepCase: true,
            longs: String,
            enums: String,
            defaults: true,
            oneofs: true,
        });
        const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
        const MLService = protoDescriptor.ml_service.MLService;
        // Create client
        const address = `${this.config.host}:${this.config.port}`;
        this.client = new MLService(address, grpc.credentials.createInsecure(), {
            'grpc.max_send_message_length': 50 * 1024 * 1024, // 50MB
            'grpc.max_receive_message_length': 50 * 1024 * 1024, // 50MB
        });
        this.connected = true;
        this.emit('connected', address);
    }
    /**
     * Make a gRPC call with retry logic.
     */
    async _callWithRetry(method, request) {
        let lastError = null;
        for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
            try {
                const startTime = Date.now();
                const result = await new Promise((resolve, reject) => {
                    const deadline = new Date(Date.now() + this.config.timeoutMs);
                    this.client[method](request, { deadline }, (error, response) => {
                        if (error) {
                            reject(error);
                        }
                        else {
                            resolve(response);
                        }
                    });
                });
                // Update metrics
                const latency = Date.now() - startTime;
                this.requestCount++;
                this.totalLatency += latency;
                if (this.config.enableMonitoring) {
                    this.emit('request', {
                        method,
                        latency,
                        attempt,
                        success: true,
                    });
                }
                return result;
            }
            catch (error) {
                lastError = error;
                if (this.config.enableMonitoring) {
                    this.emit('request', {
                        method,
                        attempt,
                        success: false,
                        error: lastError.message,
                    });
                }
                // Don't retry on certain errors
                if (error instanceof Error &&
                    (error.message.includes('INVALID_ARGUMENT') ||
                        error.message.includes('UNIMPLEMENTED'))) {
                    throw error;
                }
                // Wait before retry
                if (attempt < this.config.maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, this.config.retryDelayMs * (attempt + 1)));
                }
            }
        }
        throw lastError || new Error(`Failed after ${this.config.maxRetries} retries`);
    }
    /**
     * Get price prediction from Transformer ensemble.
     */
    async predict(symbol, features, batchSize, seqLen, nFeatures) {
        const request = {
            symbol,
            features,
            batch_size: batchSize,
            seq_len: seqLen,
            n_features: nFeatures,
        };
        const response = await this._callWithRetry('Predict', request);
        return {
            symbol: response.symbol,
            predictedReturn: response.predicted_return,
            predictedVolatility: response.predicted_volatility,
            confidence: response.confidence,
            modelCount: response.model_count,
            latencyMs: response.latency_ms,
        };
    }
    /**
     * Classify market regime using GAF-CNN.
     */
    async classifyRegime(symbol, prices) {
        const request = {
            symbol,
            prices,
        };
        const response = await this._callWithRetry('ClassifyRegime', request);
        return {
            symbol: response.symbol,
            regime: response.regime,
            confidence: response.confidence,
            probabilities: {
                bull: response.bull_prob,
                bear: response.bear_prob,
                sideways: response.sideways_prob,
                volatile: response.volatile_prob,
            },
            latencyMs: response.latency_ms,
        };
    }
    /**
     * Generate 94-characteristic features.
     */
    async generateFeatures(symbol, ohlcv) {
        const request = {
            symbol,
            open: ohlcv.open,
            high: ohlcv.high,
            low: ohlcv.low,
            close: ohlcv.close,
            volume: ohlcv.volume,
        };
        const response = await this._callWithRetry('GenerateFeatures', request);
        return {
            symbol: response.symbol,
            features: response.features,
            featureCount: response.feature_count,
            latencyMs: response.latency_ms,
        };
    }
    /**
     * Get predictions for multiple symbols in batch.
     */
    async batchPredict(symbols, features, seqLen, nFeatures) {
        const request = {
            symbols,
            features,
            seq_len: seqLen,
            n_features: nFeatures,
        };
        const response = await this._callWithRetry('BatchPredict', request);
        return response.predictions.map((pred) => ({
            symbol: pred.symbol,
            predictedReturn: pred.predicted_return,
            predictedVolatility: pred.predicted_volatility,
            confidence: pred.confidence,
            modelCount: pred.model_count,
            latencyMs: pred.latency_ms,
        }));
    }
    /**
     * Check service health.
     */
    async healthCheck() {
        const response = await this._callWithRetry('HealthCheck', {});
        return {
            status: response.status,
            uptimeSeconds: response.uptime_seconds,
            requestCount: response.request_count,
            avgLatencyMs: response.avg_latency_ms,
        };
    }
    /**
     * Get performance metrics.
     */
    async getMetrics() {
        const response = await this._callWithRetry('GetMetrics', {});
        return {
            uptimeSeconds: response.uptime_seconds,
            totalRequests: response.total_requests,
            avgLatencyMs: response.avg_latency_ms,
            requestsPerSecond: response.requests_per_second,
            modelCount: response.model_count,
            featureCount: response.feature_count,
        };
    }
    /**
     * Get client-side metrics.
     */
    getClientMetrics() {
        return {
            requestCount: this.requestCount,
            avgLatencyMs: this.requestCount > 0 ? this.totalLatency / this.requestCount : 0,
            connected: this.connected,
        };
    }
    /**
     * Close the client connection.
     */
    close() {
        if (this.client) {
            grpc.closeClient(this.client);
            this.connected = false;
            this.emit('disconnected');
        }
    }
}
exports.MLServiceClient = MLServiceClient;
/**
 * Create an ML service client with default configuration.
 */
function createMLServiceClient(host = 'localhost', port = 50051, config) {
    return new MLServiceClient({
        host,
        port,
        ...config,
    });
}
//# sourceMappingURL=MLServiceClient.js.map