/**
 * gRPC Client for Noderr PyTorch ML Service
 * 
 * Provides typed interface to ML service for:
 * - Transformer price predictions
 * - GAF regime classification  
 * - Feature generation
 * - Batch processing
 */

import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as path from 'path';
import { EventEmitter } from 'events';

// Type definitions matching proto
export interface PredictRequest {
  symbol: string;
  features: number[];  // Flattened: batch_size * seq_len * n_features
  batch_size: number;
  seq_len: number;
  n_features: number;
}

export interface PredictResponse {
  symbol: string;
  predicted_return: number;
  predicted_volatility: number;
  confidence: number;
  model_count: number;
  latency_ms: number;
}

export interface RegimeRequest {
  symbol: string;
  prices: number[];
}

export interface RegimeResponse {
  symbol: string;
  regime: 'BULL' | 'BEAR' | 'SIDEWAYS' | 'VOLATILE';
  confidence: number;
  bull_prob: number;
  bear_prob: number;
  sideways_prob: number;
  volatile_prob: number;
  latency_ms: number;
}

export interface FeatureRequest {
  symbol: string;
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  volume: number[];
}

export interface FeatureResponse {
  symbol: string;
  features: number[];
  feature_count: number;
  latency_ms: number;
}

export interface BatchPredictRequest {
  symbols: string[];
  features: number[];
  seq_len: number;
  n_features: number;
}

export interface BatchPredictResponse {
  predictions: PredictResponse[];
  total_latency_ms: number;
}

export interface HealthCheckRequest {
  service: string;
}

export interface HealthCheckResponse {
  status: 'SERVING' | 'NOT_SERVING';
  uptime_seconds: number;
  request_count: number;
  avg_latency_ms: number;
  version: string;
}

export interface MLClientConfig {
  host: string;
  port: number;
  maxRetries?: number;
  timeout?: number;
  credentials?: grpc.ChannelCredentials;
}

/**
 * gRPC client for ML service
 */
export class MLClient extends EventEmitter {
  private client: any;
  private config: Required<MLClientConfig>;
  private connected: boolean = false;
  private requestCount: number = 0;

  constructor(config: MLClientConfig) {
    super();
    
    this.config = {
      host: config.host,
      port: config.port,
      maxRetries: config.maxRetries || 3,
      timeout: config.timeout || 30000,
      credentials: config.credentials || grpc.credentials.createInsecure()
    };

    this.initialize();
  }

  private async initialize(): Promise<void> {
    try {
      // Load proto file - check multiple locations:
      // 1. Bundled with ml-client package (production / Docker)
      // 2. Relative to monorepo root (development)
      const bundledProto = path.join(__dirname, '../proto/ml_service.proto');
      const monorepoProto = path.join(__dirname, '../../../ml-service/proto/ml_service.proto');
      const envProto = process.env.ML_PROTO_PATH || '';
      
      let PROTO_PATH: string;
      const fs = require('fs');
      if (envProto && fs.existsSync(envProto)) {
        PROTO_PATH = envProto;
      } else if (fs.existsSync(bundledProto)) {
        PROTO_PATH = bundledProto;
      } else if (fs.existsSync(monorepoProto)) {
        PROTO_PATH = monorepoProto;
      } else {
        throw new Error(
          `ml_service.proto not found. Searched:\n` +
          `  - ${bundledProto}\n` +
          `  - ${monorepoProto}\n` +
          `Set ML_PROTO_PATH env var to override.`
        );
      }
      
      const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true
      });

      const protoDescriptor = grpc.loadPackageDefinition(packageDefinition) as any;
      const MLService = protoDescriptor.noderr.ml.MLService;

      // Create client
      const address = `${this.config.host}:${this.config.port}`;
      this.client = new MLService(address, this.config.credentials);

      this.connected = true;
      this.emit('connected');
    } catch (error) {
      this.emit('error', error);
      throw new Error(`Failed to initialize ML client: ${error}`);
    }
  }

  /**
   * Get price prediction from Transformer ensemble
   */
  async predict(request: PredictRequest): Promise<PredictResponse> {
    this.requestCount++;
    
    return new Promise((resolve, reject) => {
      const deadline = new Date();
      deadline.setMilliseconds(deadline.getMilliseconds() + this.config.timeout);

      this.client.Predict(request, { deadline }, (error: any, response: PredictResponse) => {
        if (error) {
          this.emit('error', error);
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  /**
   * Classify market regime using GAF-CNN
   */
  async classifyRegime(request: RegimeRequest): Promise<RegimeResponse> {
    this.requestCount++;
    
    return new Promise((resolve, reject) => {
      const deadline = new Date();
      deadline.setMilliseconds(deadline.getMilliseconds() + this.config.timeout);

      this.client.ClassifyRegime(request, { deadline }, (error: any, response: RegimeResponse) => {
        if (error) {
          this.emit('error', error);
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  /**
   * Generate 94-characteristic features
   */
  async generateFeatures(request: FeatureRequest): Promise<FeatureResponse> {
    this.requestCount++;
    
    return new Promise((resolve, reject) => {
      const deadline = new Date();
      deadline.setMilliseconds(deadline.getMilliseconds() + this.config.timeout);

      this.client.GenerateFeatures(request, { deadline }, (error: any, response: FeatureResponse) => {
        if (error) {
          this.emit('error', error);
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  /**
   * Get predictions for multiple symbols in batch
   */
  async batchPredict(request: BatchPredictRequest): Promise<BatchPredictResponse> {
    this.requestCount++;
    
    return new Promise((resolve, reject) => {
      const deadline = new Date();
      deadline.setMilliseconds(deadline.getMilliseconds() + this.config.timeout);

      this.client.BatchPredict(request, { deadline }, (error: any, response: BatchPredictResponse) => {
        if (error) {
          this.emit('error', error);
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  /**
   * Check ML service health
   */
  async healthCheck(service: string = 'ml'): Promise<HealthCheckResponse> {
    return new Promise((resolve, reject) => {
      const deadline = new Date();
      deadline.setMilliseconds(deadline.getMilliseconds() + 5000);

      this.client.HealthCheck({ service }, { deadline }, (error: any, response: HealthCheckResponse) => {
        if (error) {
          this.emit('error', error);
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  /**
   * Close the client connection
   */
  close(): void {
    if (this.client) {
      grpc.closeClient(this.client);
      this.connected = false;
      this.emit('disconnected');
    }
  }

  /**
   * Check if client is connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get request count
   */
  getRequestCount(): number {
    return this.requestCount;
  }
}

// Export types
export * from './types';
