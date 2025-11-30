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
import { EventEmitter } from 'events';
/**
 * ML prediction result.
 */
export interface MLPrediction {
    symbol: string;
    predictedReturn: number;
    predictedVolatility: number;
    confidence: number;
    modelCount: number;
    latencyMs: number;
}
/**
 * Market regime classification result.
 */
export interface RegimeClassification {
    symbol: string;
    regime: 'BULL' | 'BEAR' | 'SIDEWAYS' | 'VOLATILE';
    confidence: number;
    probabilities: {
        bull: number;
        bear: number;
        sideways: number;
        volatile: number;
    };
    latencyMs: number;
}
/**
 * Generated features.
 */
export interface GeneratedFeatures {
    symbol: string;
    features: number[];
    featureCount: number;
    latencyMs: number;
}
/**
 * OHLCV data for feature generation.
 */
export interface OHLCVData {
    open: number[];
    high: number[];
    low: number[];
    close: number[];
    volume: number[];
}
/**
 * Service health status.
 */
export interface HealthStatus {
    status: 'healthy' | 'unhealthy';
    uptimeSeconds: number;
    requestCount: number;
    avgLatencyMs: number;
}
/**
 * Performance metrics.
 */
export interface PerformanceMetrics {
    uptimeSeconds: number;
    totalRequests: number;
    avgLatencyMs: number;
    requestsPerSecond: number;
    modelCount: number;
    featureCount: number;
}
/**
 * Client configuration.
 */
export interface MLServiceClientConfig {
    host: string;
    port: number;
    maxRetries?: number;
    retryDelayMs?: number;
    timeoutMs?: number;
    enableMonitoring?: boolean;
}
/**
 * gRPC client for ML service.
 *
 * Provides type-safe, high-performance access to ML inference.
 */
export declare class MLServiceClient extends EventEmitter {
    private client;
    private config;
    private requestCount;
    private totalLatency;
    private connected;
    constructor(config: MLServiceClientConfig);
    /**
     * Initialize the gRPC client.
     */
    private _initializeClient;
    /**
     * Make a gRPC call with retry logic.
     */
    private _callWithRetry;
    /**
     * Get price prediction from Transformer ensemble.
     */
    predict(symbol: string, features: number[], batchSize: number, seqLen: number, nFeatures: number): Promise<MLPrediction>;
    /**
     * Classify market regime using GAF-CNN.
     */
    classifyRegime(symbol: string, prices: number[]): Promise<RegimeClassification>;
    /**
     * Generate 94-characteristic features.
     */
    generateFeatures(symbol: string, ohlcv: OHLCVData): Promise<GeneratedFeatures>;
    /**
     * Get predictions for multiple symbols in batch.
     */
    batchPredict(symbols: string[], features: number[], seqLen: number, nFeatures: number): Promise<MLPrediction[]>;
    /**
     * Check service health.
     */
    healthCheck(): Promise<HealthStatus>;
    /**
     * Get performance metrics.
     */
    getMetrics(): Promise<PerformanceMetrics>;
    /**
     * Get client-side metrics.
     */
    getClientMetrics(): {
        requestCount: number;
        avgLatencyMs: number;
        connected: boolean;
    };
    /**
     * Close the client connection.
     */
    close(): void;
}
/**
 * Create an ML service client with default configuration.
 */
export declare function createMLServiceClient(host?: string, port?: number, config?: Partial<MLServiceClientConfig>): MLServiceClient;
//# sourceMappingURL=MLServiceClient.d.ts.map