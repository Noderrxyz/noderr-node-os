/**
 * Noderr ML Package - PyTorch Backend Integration
 * 
 * High-level API for machine learning predictions using PyTorch models
 * served via gRPC. Provides clean interface for:
 * - Price predictions (Transformer ensemble)
 * - Market regime classification (GAF-CNN)
 * - Feature engineering (94 characteristics)
 */

import { MLClient, MLClientConfig, PredictRequest, RegimeRequest, FeatureRequest } from '@noderr/ml-client';
import { EventEmitter } from 'events';

export interface MLServiceConfig {
  mlServiceHost?: string;
  mlServicePort?: number;
  timeout?: number;
  maxRetries?: number;
  autoReconnect?: boolean;
}

export interface PricePrediction {
  symbol: string;
  expectedReturn: number;
  volatility: number;
  confidence: number;
  timestamp: number;
}

export interface MarketRegimeResult {
  symbol: string;
  regime: 'BULL' | 'BEAR' | 'SIDEWAYS' | 'VOLATILE';
  confidence: number;
  probabilities: {
    bull: number;
    bear: number;
    sideways: number;
    volatile: number;
  };
  timestamp: number;
}

export interface FeatureSet {
  symbol: string;
  features: number[];
  featureCount: number;
  timestamp: number;
}

/**
 * Main ML Service class
 */
export class MLService extends EventEmitter {
  private client: MLClient;
  private config: Required<MLServiceConfig>;
  private initialized: boolean = false;

  constructor(config: MLServiceConfig = {}) {
    super();

    this.config = {
      mlServiceHost: config.mlServiceHost || process.env.ML_SERVICE_HOST || 'localhost',
      mlServicePort: config.mlServicePort || parseInt(process.env.ML_SERVICE_PORT || '50051'),
      timeout: config.timeout || 30000,
      maxRetries: config.maxRetries || 3,
      autoReconnect: config.autoReconnect !== false
    };

    this.client = new MLClient({
      host: this.config.mlServiceHost,
      port: this.config.mlServicePort,
      timeout: this.config.timeout,
      maxRetries: this.config.maxRetries
    });

    this.setupEventHandlers();
    this.initialized = true;
  }

  private setupEventHandlers(): void {
    this.client.on('connected', () => {
      this.emit('connected');
    });

    this.client.on('disconnected', () => {
      this.emit('disconnected');
      if (this.config.autoReconnect) {
        // Reconnection logic would go here
      }
    });

    this.client.on('error', (error) => {
      this.emit('error', error);
    });
  }

  /**
   * Get price prediction for a symbol
   * 
   * @param symbol - Trading symbol
   * @param features - Feature array (batch_size * seq_len * n_features)
   * @param batchSize - Batch size (default: 1)
   * @param seqLen - Sequence length (default: 60)
   * @param nFeatures - Number of features (default: 94)
   */
  async predictPrice(
    symbol: string,
    features: number[],
    batchSize: number = 1,
    seqLen: number = 60,
    nFeatures: number = 94
  ): Promise<PricePrediction> {
    if (!this.initialized) {
      throw new Error('MLService not initialized');
    }

    const request: PredictRequest = {
      symbol,
      features,
      batch_size: batchSize,
      seq_len: seqLen,
      n_features: nFeatures
    };

    const response = await this.client.predict(request);

    return {
      symbol: response.symbol,
      expectedReturn: response.predicted_return,
      volatility: response.predicted_volatility,
      confidence: response.confidence,
      timestamp: Date.now()
    };
  }

  /**
   * Classify market regime for a symbol
   * 
   * @param symbol - Trading symbol
   * @param prices - Price history array
   */
  async classifyRegime(symbol: string, prices: number[]): Promise<MarketRegimeResult> {
    if (!this.initialized) {
      throw new Error('MLService not initialized');
    }

    const request: RegimeRequest = {
      symbol,
      prices
    };

    const response = await this.client.classifyRegime(request);

    return {
      symbol: response.symbol,
      regime: response.regime,
      confidence: response.confidence,
      probabilities: {
        bull: response.bull_prob,
        bear: response.bear_prob,
        sideways: response.sideways_prob,
        volatile: response.volatile_prob
      },
      timestamp: Date.now()
    };
  }

  /**
   * Generate 94-characteristic features from OHLCV data
   * 
   * @param symbol - Trading symbol
   * @param ohlcv - OHLCV data
   */
  async generateFeatures(
    symbol: string,
    ohlcv: {
      open: number[];
      high: number[];
      low: number[];
      close: number[];
      volume: number[];
    }
  ): Promise<FeatureSet> {
    if (!this.initialized) {
      throw new Error('MLService not initialized');
    }

    const request: FeatureRequest = {
      symbol,
      ...ohlcv
    };

    const response = await this.client.generateFeatures(request);

    return {
      symbol: response.symbol,
      features: response.features,
      featureCount: response.feature_count,
      timestamp: Date.now()
    };
  }

  /**
   * Check if ML service is healthy
   */
  async isHealthy(): Promise<boolean> {
    try {
      const response = await this.client.healthCheck('ml');
      return response.status === 'SERVING';
    } catch (error) {
      return false;
    }
  }

  /**
   * Get ML service status
   */
  async getStatus(): Promise<{
    healthy: boolean;
    uptime: number;
    requestCount: number;
    avgLatency: number;
    version: string;
  }> {
    const response = await this.client.healthCheck('ml');
    
    return {
      healthy: response.status === 'SERVING',
      uptime: response.uptime_seconds,
      requestCount: response.request_count,
      avgLatency: response.avg_latency_ms,
      version: response.version
    };
  }

  /**
   * Close ML service connection
   */
  close(): void {
    this.client.close();
    this.initialized = false;
  }
}

// Export types and client
export * from '@noderr/ml-client';
export { MLClient };


// ============================================================================
// Main Entry Point for ML Service
// ============================================================================

import { Logger } from '@noderr/utils';
import { getShutdownHandler, onShutdown } from '@noderr/utils';

let mlService: MLService | null = null;

/**
 * Start the ML service
 */
export async function startMLService(): Promise<void> {
  const logger = new Logger('MLService');
  
  try {
    logger.info('Starting ML Service...');
    
    // Initialize ML service
    mlService = new MLService({
      mlServiceHost: process.env.ML_SERVICE_HOST || 'ml-service',
      mlServicePort: parseInt(process.env.ML_SERVICE_PORT || '50051'),
      timeout: 30000,
      maxRetries: 3,
      autoReconnect: true,
    });
    
    // Wait for ML service to be healthy
    logger.info('Waiting for ML service to be ready...');
    let retries = 0;
    const maxRetries = 30;  // 30 seconds
    
    while (retries < maxRetries) {
      const healthy = await mlService.isHealthy();
      if (healthy) {
        logger.info('ML service is healthy');
        break;
      }
      
      retries++;
      if (retries >= maxRetries) {
        throw new Error('ML service did not become healthy within 30 seconds');
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Get status
    const status = await mlService.getStatus();
    logger.info('ML service status', status);
    
    // Register graceful shutdown handlers
    onShutdown('ml-service', async () => {
      logger.info('Shutting down ML service...');
      
      if (mlService) {
        // Close gRPC connection
        mlService.close();
      }
      
      logger.info('ML service shut down complete');
    }, 10000);  // 10 second timeout
    
    logger.info('ML Service started successfully');
    
    // Keep process alive
    await new Promise(() => {});  // Never resolves
  } catch (error) {
    logger.error('Failed to start ML Service', error);
    throw error;
  }
}

/**
 * If run directly, start the service
 */
if (require.main === module) {
  // Initialize graceful shutdown
  getShutdownHandler(30000);  // 30 second global timeout
  
  startMLService().catch((error) => {
    console.error('Fatal error starting ML Service:', error);
    process.exit(1);
  });
}
