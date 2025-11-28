import * as tf from '@tensorflow/tfjs-node-gpu';
import * as fs from 'fs/promises';
import * as path from 'path';
import { EventEmitter } from 'events';
import * as winston from 'winston';

/**
 * Checkpoint configuration
 */
export interface CheckpointConfig {
  // Base directory for checkpoints
  baseDir: string;
  // Maximum number of checkpoints to keep
  maxCheckpoints: number;
  // Save best model based on metric
  saveBest: boolean;
  // Metric to monitor for best model
  monitorMetric: string;
  // Mode for metric comparison ('min' or 'max')
  monitorMode: 'min' | 'max';
  // Save frequency (epochs)
  saveFrequency: number;
  // Enable compression
  compression: boolean;
}

/**
 * Checkpoint metadata
 */
export interface CheckpointMetadata {
  id: string;
  epoch: number;
  timestamp: Date;
  metrics: Record<string, number>;
  modelPath: string;
  weightsPath: string;
  optimizerPath?: string;
  isBest: boolean;
  fileSize: number;
}

/**
 * Model checkpoint manager
 */
export class ModelCheckpointer extends EventEmitter {
  private config: CheckpointConfig;
  private logger: winston.Logger;
  private checkpoints: CheckpointMetadata[] = [];
  private bestMetricValue: number | null = null;
  
  constructor(config: CheckpointConfig, logger: winston.Logger) {
    super();
    
    this.config = config;
    this.logger = logger;
    
    // Initialize best metric value
    this.bestMetricValue = config.monitorMode === 'min' ? Infinity : -Infinity;
  }
  
  /**
   * Initialize checkpointer
   */
  async initialize(): Promise<void> {
    // Create base directory if it doesn't exist
    await fs.mkdir(this.config.baseDir, { recursive: true });
    
    // Load existing checkpoints
    await this.loadCheckpointHistory();
    
    this.logger.info('Model checkpointer initialized', {
      baseDir: this.config.baseDir,
      existingCheckpoints: this.checkpoints.length
    });
  }
  
  /**
   * Save model checkpoint
   */
  async saveCheckpoint(
    model: tf.Sequential | tf.LayersModel,
    epoch: number,
    metrics: Record<string, number>,
    optimizer?: tf.Optimizer
  ): Promise<CheckpointMetadata> {
    const checkpointId = `checkpoint_${epoch}_${Date.now()}`;
    const checkpointDir = path.join(this.config.baseDir, checkpointId);
    
    // Create checkpoint directory
    await fs.mkdir(checkpointDir, { recursive: true });
    
    // Save model
    const modelPath = path.join(checkpointDir, 'model.json');
    await model.save(`file://${checkpointDir}`);
    
    // Save weights separately if compression is enabled
    let weightsPath = path.join(checkpointDir, 'weights.bin');
    if (this.config.compression) {
      // In practice, implement compression here
      weightsPath = path.join(checkpointDir, 'weights.bin.gz');
    }
    
    // Save optimizer state if provided
    let optimizerPath: string | undefined;
    if (optimizer) {
      optimizerPath = path.join(checkpointDir, 'optimizer.json');
      // Note: TensorFlow.js doesn't directly support saving optimizer state
      // This would need custom implementation
      await this.saveOptimizerState(optimizer, optimizerPath);
    }
    
    // Calculate file size
    const stats = await fs.stat(checkpointDir);
    const fileSize = await this.getDirectorySize(checkpointDir);
    
    // Check if this is the best model
    const isBest = this.isBestModel(metrics);
    
    // Create metadata
    const metadata: CheckpointMetadata = {
      id: checkpointId,
      epoch,
      timestamp: new Date(),
      metrics,
      modelPath,
      weightsPath,
      optimizerPath,
      isBest,
      fileSize
    };
    
    // Save metadata
    const metadataPath = path.join(checkpointDir, 'metadata.json');
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
    
    // Update checkpoint history
    this.checkpoints.push(metadata);
    await this.saveCheckpointHistory();
    
    // Clean up old checkpoints
    await this.cleanupOldCheckpoints();
    
    // Emit event
    this.emit('checkpointSaved', metadata);
    
    this.logger.info('Model checkpoint saved', {
      checkpointId,
      epoch,
      isBest,
      fileSize: `${(fileSize / 1024 / 1024).toFixed(2)} MB`
    });
    
    return metadata;
  }
  
  /**
   * Load model from checkpoint
   */
  async loadCheckpoint(
    checkpointId: string
  ): Promise<{
    model: tf.Sequential | tf.LayersModel;
    metadata: CheckpointMetadata;
    optimizer?: any;
  }> {
    const checkpoint = this.checkpoints.find(c => c.id === checkpointId);
    if (!checkpoint) {
      throw new Error(`Checkpoint ${checkpointId} not found`);
    }
    
    const checkpointDir = path.join(this.config.baseDir, checkpointId);
    
    // Load model
    const model = await tf.loadLayersModel(`file://${checkpointDir}/model.json`);
    
    // Load optimizer state if available
    let optimizer;
    if (checkpoint.optimizerPath) {
      optimizer = await this.loadOptimizerState(checkpoint.optimizerPath);
    }
    
    this.logger.info('Model checkpoint loaded', {
      checkpointId,
      epoch: checkpoint.epoch
    });
    
    return { model, metadata: checkpoint, optimizer };
  }
  
  /**
   * Load best model
   */
  async loadBestModel(): Promise<{
    model: tf.Sequential | tf.LayersModel;
    metadata: CheckpointMetadata;
  }> {
    const bestCheckpoint = this.checkpoints.find(c => c.isBest);
    if (!bestCheckpoint) {
      throw new Error('No best model found');
    }
    
    return this.loadCheckpoint(bestCheckpoint.id);
  }
  
  /**
   * Check if current model is best
   */
  private isBestModel(metrics: Record<string, number>): boolean {
    if (!this.config.saveBest) {
      return false;
    }
    
    const currentValue = metrics[this.config.monitorMetric];
    if (currentValue === undefined) {
      return false;
    }
    
    let isBest = false;
    if (this.config.monitorMode === 'min') {
      isBest = currentValue < this.bestMetricValue!;
    } else {
      isBest = currentValue > this.bestMetricValue!;
    }
    
    if (isBest) {
      this.bestMetricValue = currentValue;
      
      // Update previous best flags
      this.checkpoints.forEach(c => c.isBest = false);
    }
    
    return isBest;
  }
  
  /**
   * Clean up old checkpoints
   */
  private async cleanupOldCheckpoints(): Promise<void> {
    if (this.checkpoints.length <= this.config.maxCheckpoints) {
      return;
    }
    
    // Sort by timestamp
    const sorted = [...this.checkpoints].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
    );
    
    // Keep best model and recent checkpoints
    const toDelete: CheckpointMetadata[] = [];
    let kept = 0;
    
    for (const checkpoint of sorted) {
      if (checkpoint.isBest || kept < this.config.maxCheckpoints) {
        kept++;
      } else {
        toDelete.push(checkpoint);
      }
    }
    
    // Delete old checkpoints
    for (const checkpoint of toDelete) {
      const checkpointDir = path.join(this.config.baseDir, checkpoint.id);
      await fs.rm(checkpointDir, { recursive: true });
      
      // Remove from history
      const index = this.checkpoints.findIndex(c => c.id === checkpoint.id);
      if (index !== -1) {
        this.checkpoints.splice(index, 1);
      }
      
      this.logger.info('Deleted old checkpoint', { checkpointId: checkpoint.id });
    }
    
    await this.saveCheckpointHistory();
  }
  
  /**
   * Save checkpoint history
   */
  private async saveCheckpointHistory(): Promise<void> {
    const historyPath = path.join(this.config.baseDir, 'checkpoint_history.json');
    await fs.writeFile(historyPath, JSON.stringify(this.checkpoints, null, 2));
  }
  
  /**
   * Load checkpoint history
   */
  private async loadCheckpointHistory(): Promise<void> {
    const historyPath = path.join(this.config.baseDir, 'checkpoint_history.json');
    
    try {
      const data = await fs.readFile(historyPath, 'utf-8');
      this.checkpoints = JSON.parse(data).map((c: any) => ({
        ...c,
        timestamp: new Date(c.timestamp)
      }));
      
      // Find best metric value
      const bestCheckpoint = this.checkpoints.find(c => c.isBest);
      if (bestCheckpoint) {
        this.bestMetricValue = bestCheckpoint.metrics[this.config.monitorMetric];
      }
    } catch (error) {
      // History doesn't exist yet
      this.checkpoints = [];
    }
  }
  
  /**
   * Get directory size
   */
  private async getDirectorySize(dir: string): Promise<number> {
    let size = 0;
    
    const files = await fs.readdir(dir, { withFileTypes: true });
    
    for (const file of files) {
      const filePath = path.join(dir, file.name);
      
      if (file.isDirectory()) {
        size += await this.getDirectorySize(filePath);
      } else {
        const stats = await fs.stat(filePath);
        size += stats.size;
      }
    }
    
    return size;
  }
  
  /**
   * Save optimizer state (placeholder)
   */
  private async saveOptimizerState(optimizer: tf.Optimizer, path: string): Promise<void> {
    // TensorFlow.js doesn't directly support saving optimizer state
    // This would need custom implementation to save learning rate, momentum, etc.
    const state = {
      className: optimizer.getClassName(),
      config: optimizer.getConfig()
    };
    
    await fs.writeFile(path, JSON.stringify(state, null, 2));
  }
  
  /**
   * Load optimizer state (placeholder)
   */
  private async loadOptimizerState(path: string): Promise<any> {
    const data = await fs.readFile(path, 'utf-8');
    return JSON.parse(data);
  }
  
  /**
   * Get checkpoint list
   */
  getCheckpoints(): CheckpointMetadata[] {
    return [...this.checkpoints].sort(
      (a, b) => b.timestamp.getTime() - a.timestamp.getTime()
    );
  }
  
  /**
   * Get best checkpoint
   */
  getBestCheckpoint(): CheckpointMetadata | null {
    return this.checkpoints.find(c => c.isBest) || null;
  }
  
  /**
   * Delete specific checkpoint
   */
  async deleteCheckpoint(checkpointId: string): Promise<void> {
    const checkpoint = this.checkpoints.find(c => c.id === checkpointId);
    if (!checkpoint) {
      throw new Error(`Checkpoint ${checkpointId} not found`);
    }
    
    if (checkpoint.isBest) {
      throw new Error('Cannot delete best model checkpoint');
    }
    
    // Delete files
    const checkpointDir = path.join(this.config.baseDir, checkpointId);
    await fs.rm(checkpointDir, { recursive: true });
    
    // Remove from history
    const index = this.checkpoints.findIndex(c => c.id === checkpointId);
    if (index !== -1) {
      this.checkpoints.splice(index, 1);
    }
    
    await this.saveCheckpointHistory();
    
    this.logger.info('Checkpoint deleted', { checkpointId });
  }
  
  /**
   * Export checkpoint to different format
   */
  async exportCheckpoint(
    checkpointId: string,
    format: 'tfjs' | 'onnx' | 'tflite',
    outputPath: string
  ): Promise<void> {
    const { model } = await this.loadCheckpoint(checkpointId);
    
    switch (format) {
      case 'tfjs':
        await model.save(`file://${outputPath}`);
        break;
      
      case 'onnx':
        // Would require tfjs-to-onnx converter
        throw new Error('ONNX export not implemented');
      
      case 'tflite':
        // Would require tfjs-to-tflite converter
        throw new Error('TFLite export not implemented');
      
      default:
        throw new Error(`Unknown export format: ${format}`);
    }
    
    this.logger.info('Checkpoint exported', {
      checkpointId,
      format,
      outputPath
    });
  }
} 