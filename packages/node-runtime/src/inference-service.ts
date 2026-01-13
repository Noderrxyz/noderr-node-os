/**
 * Inference Service with Telemetry and Result Reporting
 * 
 * Runs ML inference on NODERR nodes and reports results
 * - Load models via ModelLoader
 * - Run inference on input data
 * - Collect performance telemetry
 * - Report results to backend
 * - Handle errors and retries
 * 
 * Integration Complete - Phase 7
 */

import * as tf from '@tensorflow/tfjs-node';
import { ModelLoader, LoadedModel } from './model-loader';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_PROJECT_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

/**
 * Inference request structure
 */
export interface InferenceRequest {
  requestId: string;
  modelId: string;
  inputData: number[] | number[][];
  metadata?: Record<string, any>;
}

/**
 * Inference result structure
 */
export interface InferenceResult {
  requestId: string;
  modelId: string;
  modelVersion: string;
  output: number[] | number[][];
  confidence?: number;
  executionTime: number;
  timestamp: Date;
  nodeId: string;
  metadata?: Record<string, any>;
}

/**
 * Telemetry data structure
 */
export interface InferenceTelemetry {
  nodeId: string;
  modelId: string;
  modelVersion: string;
  executionTime: number;
  memoryUsage: number;
  cpuUsage?: number;
  success: boolean;
  errorMessage?: string;
  timestamp: Date;
}

/**
 * Inference service class
 */
export class InferenceService {
  private modelLoader: ModelLoader;
  private nodeId: string;
  private tier: string;
  private telemetryBuffer: InferenceTelemetry[] = [];
  private resultBuffer: InferenceResult[] = [];
  private telemetryFlushInterval: NodeJS.Timeout | null = null;
  
  constructor(nodeId: string, tier: string, modelLoader: ModelLoader) {
    this.nodeId = nodeId;
    this.tier = tier;
    this.modelLoader = modelLoader;
  }
  
  /**
   * Initialize inference service
   */
  async initialize(): Promise<void> {
    console.log('🚀 Initializing inference service...');
    console.log(`   Node ID: ${this.nodeId}`);
    console.log(`   Tier: ${this.tier}`);
    
    // Start telemetry flush interval (every 60 seconds)
    this.telemetryFlushInterval = setInterval(() => {
      this.flushTelemetry().catch(err => {
        console.error('❌ Failed to flush telemetry:', err);
      });
    }, 60000);
    
    console.log('✅ Inference service initialized');
  }
  
  /**
   * Shutdown inference service
   */
  async shutdown(): Promise<void> {
    console.log('🛑 Shutting down inference service...');
    
    // Stop telemetry flush interval
    if (this.telemetryFlushInterval) {
      clearInterval(this.telemetryFlushInterval);
    }
    
    // Flush remaining telemetry and results
    await this.flushTelemetry();
    await this.flushResults();
    
    console.log('✅ Inference service shut down');
  }
  
  /**
   * Preprocess input data
   */
  private preprocessInput(
    inputData: number[] | number[][],
    model: LoadedModel
  ): tf.Tensor {
    const inputShape = model.manifest.inputShape;
    
    // Convert to tensor
    let tensor: tf.Tensor;
    
    if (Array.isArray(inputData[0])) {
      // 2D array
      tensor = tf.tensor2d(inputData as number[][]);
    } else {
      // 1D array
      tensor = tf.tensor1d(inputData as number[]);
    }
    
    // Reshape if needed
    if (inputShape && inputShape.length > 0) {
      const targetShape = [1, ...inputShape]; // Add batch dimension
      tensor = tensor.reshape(targetShape);
    }
    
    return tensor;
  }
  
  /**
   * Postprocess output data
   */
  private postprocessOutput(
    output: tf.Tensor,
    model: LoadedModel
  ): { data: number[] | number[][], confidence?: number } {
    // Get output data
    const outputData = output.arraySync() as number[] | number[][];
    
    // Calculate confidence (for classification tasks)
    let confidence: number | undefined;
    
    if (Array.isArray(outputData[0])) {
      // Multi-class classification
      const probs = outputData[0] as number[];
      confidence = Math.max(...probs);
    } else if (outputData.length > 1) {
      // Binary classification
      confidence = Math.max(...(outputData as number[]));
    }
    
    return {
      data: outputData,
      confidence
    };
  }
  
  /**
   * Run inference
   */
  async runInference(request: InferenceRequest): Promise<InferenceResult> {
    console.log(`🧠 Running inference: ${request.requestId}`);
    console.log(`   Model: ${request.modelId}`);
    
    const startTime = Date.now();
    const startMemory = process.memoryUsage().heapUsed;
    
    try {
      // Get model
      let model = this.modelLoader.getModel(request.modelId);
      
      if (!model) {
        console.log('   Loading model...');
        model = await this.modelLoader.loadModel(request.modelId);
      }
      
      // Preprocess input
      const inputTensor = this.preprocessInput(request.inputData, model);
      
      // Run inference
      const outputTensor = model.model.predict(inputTensor) as tf.Tensor;
      
      // Postprocess output
      const { data: outputData, confidence } = this.postprocessOutput(outputTensor, model);
      
      // Clean up tensors
      inputTensor.dispose();
      outputTensor.dispose();
      
      const executionTime = Date.now() - startTime;
      const memoryUsage = process.memoryUsage().heapUsed - startMemory;
      
      console.log(`✅ Inference complete (${executionTime}ms)`);
      if (confidence !== undefined) {
        console.log(`   Confidence: ${(confidence * 100).toFixed(2)}%`);
      }
      
      // Create result
      const result: InferenceResult = {
        requestId: request.requestId,
        modelId: request.modelId,
        modelVersion: model.version,
        output: outputData,
        confidence,
        executionTime,
        timestamp: new Date(),
        nodeId: this.nodeId,
        metadata: request.metadata
      };
      
      // Buffer result for reporting
      this.resultBuffer.push(result);
      
      // Collect telemetry
      const telemetry: InferenceTelemetry = {
        nodeId: this.nodeId,
        modelId: request.modelId,
        modelVersion: model.version,
        executionTime,
        memoryUsage,
        success: true,
        timestamp: new Date()
      };
      
      this.telemetryBuffer.push(telemetry);
      
      return result;
      
    } catch (error: any) {
      const executionTime = Date.now() - startTime;
      
      console.error('❌ Inference failed:', error);
      
      // Collect error telemetry
      const telemetry: InferenceTelemetry = {
        nodeId: this.nodeId,
        modelId: request.modelId,
        modelVersion: 'unknown',
        executionTime,
        memoryUsage: 0,
        success: false,
        errorMessage: error.message,
        timestamp: new Date()
      };
      
      this.telemetryBuffer.push(telemetry);
      
      throw error;
    }
  }
  
  /**
   * Run batch inference
   */
  async runBatchInference(requests: InferenceRequest[]): Promise<InferenceResult[]> {
    console.log(`🧠 Running batch inference: ${requests.length} requests`);
    
    const results: InferenceResult[] = [];
    
    for (const request of requests) {
      try {
        const result = await this.runInference(request);
        results.push(result);
      } catch (error) {
        console.error(`❌ Failed to process request ${request.requestId}:`, error);
      }
    }
    
    console.log(`✅ Batch inference complete: ${results.length}/${requests.length} successful`);
    
    return results;
  }
  
  /**
   * Flush telemetry to database
   */
  async flushTelemetry(): Promise<void> {
    if (this.telemetryBuffer.length === 0) {
      return;
    }
    
    console.log(`📊 Flushing telemetry: ${this.telemetryBuffer.length} records`);
    
    try {
      // Insert telemetry records
      const { error } = await supabase
        .from('node_telemetry')
        .insert(
          this.telemetryBuffer.map(t => ({
            node_id: t.nodeId,
            model_id: t.modelId,
            model_version: t.modelVersion,
            execution_time: t.executionTime,
            memory_usage: t.memoryUsage,
            cpu_usage: t.cpuUsage,
            success: t.success,
            error_message: t.errorMessage,
            timestamp: t.timestamp.toISOString()
          }))
        );
      
      if (error) {
        console.error('❌ Failed to flush telemetry:', error);
        return;
      }
      
      console.log('✅ Telemetry flushed successfully');
      
      // Clear buffer
      this.telemetryBuffer = [];
      
    } catch (error) {
      console.error('❌ Failed to flush telemetry:', error);
    }
  }
  
  /**
   * Flush results to database
   */
  async flushResults(): Promise<void> {
    if (this.resultBuffer.length === 0) {
      return;
    }
    
    console.log(`📤 Flushing results: ${this.resultBuffer.length} records`);
    
    try {
      // Insert result records
      const { error } = await supabase
        .from('inference_results')
        .insert(
          this.resultBuffer.map(r => ({
            request_id: r.requestId,
            node_id: r.nodeId,
            model_id: r.modelId,
            model_version: r.modelVersion,
            output: r.output,
            confidence: r.confidence,
            execution_time: r.executionTime,
            timestamp: r.timestamp.toISOString(),
            metadata: r.metadata
          }))
        );
      
      if (error) {
        console.error('❌ Failed to flush results:', error);
        return;
      }
      
      console.log('✅ Results flushed successfully');
      
      // Clear buffer
      this.resultBuffer = [];
      
    } catch (error) {
      console.error('❌ Failed to flush results:', error);
    }
  }
  
  /**
   * Get telemetry statistics
   */
  getTelemetryStats(): {
    totalInferences: number;
    successfulInferences: number;
    failedInferences: number;
    averageExecutionTime: number;
    averageMemoryUsage: number;
  } {
    const total = this.telemetryBuffer.length;
    const successful = this.telemetryBuffer.filter(t => t.success).length;
    const failed = total - successful;
    
    const avgExecutionTime = total > 0
      ? this.telemetryBuffer.reduce((sum, t) => sum + t.executionTime, 0) / total
      : 0;
    
    const avgMemoryUsage = total > 0
      ? this.telemetryBuffer.reduce((sum, t) => sum + t.memoryUsage, 0) / total
      : 0;
    
    return {
      totalInferences: total,
      successfulInferences: successful,
      failedInferences: failed,
      averageExecutionTime: avgExecutionTime,
      averageMemoryUsage: avgMemoryUsage
    };
  }
  
  /**
   * Health check
   */
  async healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    modelsLoaded: number;
    telemetryBufferSize: number;
    resultBufferSize: number;
    stats: any;
  }> {
    const stats = this.getTelemetryStats();
    const modelsLoaded = Array.from(this.modelLoader['loadedModels'].values()).length;
    
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    
    // Check if models are loaded
    if (modelsLoaded === 0) {
      status = 'degraded';
    }
    
    // Check error rate
    if (stats.totalInferences > 10) {
      const errorRate = stats.failedInferences / stats.totalInferences;
      if (errorRate > 0.5) {
        status = 'unhealthy';
      } else if (errorRate > 0.2) {
        status = 'degraded';
      }
    }
    
    return {
      status,
      modelsLoaded,
      telemetryBufferSize: this.telemetryBuffer.length,
      resultBufferSize: this.resultBuffer.length,
      stats
    };
  }
}

/**
 * Create and initialize inference service
 */
export async function createInferenceService(
  nodeId: string,
  tier: string,
  cacheDir?: string
): Promise<InferenceService> {
  console.log('🔧 Creating inference service...');
  
  // Create model loader
  const modelLoader = new ModelLoader(tier, cacheDir);
  await modelLoader.initialize();
  
  // Load all available models
  await modelLoader.loadAllModels();
  
  // Create inference service
  const inferenceService = new InferenceService(nodeId, tier, modelLoader);
  await inferenceService.initialize();
  
  console.log('✅ Inference service ready');
  
  return inferenceService;
}
