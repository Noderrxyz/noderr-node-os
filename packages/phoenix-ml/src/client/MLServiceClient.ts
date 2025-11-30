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

import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { EventEmitter } from 'events';
import path from 'path';

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
export class MLServiceClient extends EventEmitter {
  private client: any;
  private config: Required<MLServiceClientConfig>;
  private requestCount: number = 0;
  private totalLatency: number = 0;
  private connected: boolean = false;

  constructor(config: MLServiceClientConfig) {
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
  private _initializeClient(): void {
    // Load proto file
    const PROTO_PATH = path.join(__dirname, '../../../ml-service/proto/ml_service.proto');
    
    const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });

    const protoDescriptor = grpc.loadPackageDefinition(packageDefinition) as any;
    const MLService = protoDescriptor.ml_service.MLService;

    // Create client
    const address = `${this.config.host}:${this.config.port}`;
    this.client = new MLService(
      address,
      grpc.credentials.createInsecure(),
      {
        'grpc.max_send_message_length': 50 * 1024 * 1024, // 50MB
        'grpc.max_receive_message_length': 50 * 1024 * 1024, // 50MB
      }
    );

    this.connected = true;
    this.emit('connected', address);
  }

  /**
   * Make a gRPC call with retry logic.
   */
  private async _callWithRetry<T>(
    method: string,
    request: any
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const startTime = Date.now();

        const result = await new Promise<T>((resolve, reject) => {
          const deadline = new Date(Date.now() + this.config.timeoutMs);

          this.client[method](
            request,
            { deadline },
            (error: grpc.ServiceError | null, response: T) => {
              if (error) {
                reject(error);
              } else {
                resolve(response);
              }
            }
          );
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

      } catch (error) {
        lastError = error as Error;

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
          await new Promise(resolve => 
            setTimeout(resolve, this.config.retryDelayMs * (attempt + 1))
          );
        }
      }
    }

    throw lastError || new Error(`Failed after ${this.config.maxRetries} retries`);
  }

  /**
   * Get price prediction from Transformer ensemble.
   */
  async predict(
    symbol: string,
    features: number[],
    batchSize: number,
    seqLen: number,
    nFeatures: number
  ): Promise<MLPrediction> {
    const request = {
      symbol,
      features,
      batch_size: batchSize,
      seq_len: seqLen,
      n_features: nFeatures,
    };

    const response = await this._callWithRetry<any>('Predict', request);

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
  async classifyRegime(
    symbol: string,
    prices: number[]
  ): Promise<RegimeClassification> {
    const request = {
      symbol,
      prices,
    };

    const response = await this._callWithRetry<any>('ClassifyRegime', request);

    return {
      symbol: response.symbol,
      regime: response.regime as 'BULL' | 'BEAR' | 'SIDEWAYS' | 'VOLATILE',
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
  async generateFeatures(
    symbol: string,
    ohlcv: OHLCVData
  ): Promise<GeneratedFeatures> {
    const request = {
      symbol,
      open: ohlcv.open,
      high: ohlcv.high,
      low: ohlcv.low,
      close: ohlcv.close,
      volume: ohlcv.volume,
    };

    const response = await this._callWithRetry<any>('GenerateFeatures', request);

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
  async batchPredict(
    symbols: string[],
    features: number[],
    seqLen: number,
    nFeatures: number
  ): Promise<MLPrediction[]> {
    const request = {
      symbols,
      features,
      seq_len: seqLen,
      n_features: nFeatures,
    };

    const response = await this._callWithRetry<any>('BatchPredict', request);

    return response.predictions.map((pred: any) => ({
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
  async healthCheck(): Promise<HealthStatus> {
    const response = await this._callWithRetry<any>('HealthCheck', {});

    return {
      status: response.status as 'healthy' | 'unhealthy',
      uptimeSeconds: response.uptime_seconds,
      requestCount: response.request_count,
      avgLatencyMs: response.avg_latency_ms,
    };
  }

  /**
   * Get performance metrics.
   */
  async getMetrics(): Promise<PerformanceMetrics> {
    const response = await this._callWithRetry<any>('GetMetrics', {});

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
  getClientMetrics(): {
    requestCount: number;
    avgLatencyMs: number;
    connected: boolean;
  } {
    return {
      requestCount: this.requestCount,
      avgLatencyMs: this.requestCount > 0 ? this.totalLatency / this.requestCount : 0,
      connected: this.connected,
    };
  }

  /**
   * Close the client connection.
   */
  close(): void {
    if (this.client) {
      grpc.closeClient(this.client);
      this.connected = false;
      this.emit('disconnected');
    }
  }
}

/**
 * Create an ML service client with default configuration.
 */
export function createMLServiceClient(
  host: string = 'localhost',
  port: number = 50051,
  config?: Partial<MLServiceClientConfig>
): MLServiceClient {
  return new MLServiceClient({
    host,
    port,
    ...config,
  });
}
