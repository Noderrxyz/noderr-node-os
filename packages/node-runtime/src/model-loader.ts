/**
 * Node-Side Model Loader
 * 
 * Downloads and loads ML models on NODERR nodes
 * - Query version beacon for latest models
 * - Download models from S3
 * - Verify checksums
 * - Cache models locally
 * - Load models into memory
 * - Handle model updates
 * 
 * Integration Complete - Phase 6
 */

import { Logger } from '@noderr/utils/src';
import * as tf from '@tensorflow/tfjs-node';
import { createHash } from 'crypto';
import { createWriteStream, createReadStream, promises as fs } from 'fs';
import { pipeline } from 'stream/promises';
import path from 'path';
import tar from 'tar';
import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';

const logger = new Logger('model-loader');

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_PROJECT_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

/**
 * Model info from version beacon
 */
export interface ModelInfo {
  id: string;
  model_id: string;
  version: string;
  tier: string;
  url: string;
  checksum: string;
  manifest: any;
  deployed_at: string;
}

/**
 * Loaded model structure
 */
export interface LoadedModel {
  modelId: string;
  version: string;
  tier: string;
  model: tf.LayersModel;
  manifest: any;
  loadedAt: Date;
}

/**
 * Model loader class
 */
export class ModelLoader {
  private cacheDir: string;
  private loadedModels: Map<string, LoadedModel> = new Map();
  private tier: string;
  
  constructor(tier: string, cacheDir: string = '/var/lib/noderr/models') {
    this.tier = tier;
    this.cacheDir = cacheDir;
  }
  
  /**
   * Initialize model loader
   * 
   * Creates cache directory and loads any cached models
   */
  async initialize(): Promise<void> {
    logger.info('🔧 Initializing model loader...');
    logger.info(`   Tier: ${this.tier}`);
    logger.info(`   Cache dir: ${this.cacheDir}`);
    
    // Create cache directory
    await fs.mkdir(this.cacheDir, { recursive: true });
    
    logger.info('✅ Model loader initialized');
  }
  
  /**
   * Query version beacon for available models
   */
  async queryVersionBeacon(modelId?: string): Promise<ModelInfo[]> {
    logger.info('🔔 Querying version beacon...');
    
    let query = supabase
      .from('model_versions')
      .select('*')
      .eq('tier', this.tier)
      .eq('active', true)
      .order('deployed_at', { ascending: false });
    
    if (modelId) {
      query = query.eq('model_id', modelId);
    }
    
    const { data, error } = await query;
    
    if (error) {
      throw new Error(`Failed to query version beacon: ${error.message}`);
    }
    
    logger.info(`✅ Found ${data?.length || 0} available models`);
    
    return (data || []) as ModelInfo[];
  }
  
  /**
   * Get latest model version
   */
  async getLatestVersion(modelId: string): Promise<ModelInfo | null> {
    const { data, error } = await supabase
      .from('model_versions')
      .select('*')
      .eq('model_id', modelId)
      .eq('tier', this.tier)
      .eq('active', true)
      .order('deployed_at', { ascending: false })
      .limit(1)
      .single();
    
    if (error) {
      return null;
    }
    
    return data as ModelInfo;
  }
  
  /**
   * Check if model is cached locally
   */
  async isModelCached(modelId: string, version: string): Promise<boolean> {
    const modelPath = path.join(this.cacheDir, modelId, version);
    
    try {
      await fs.access(path.join(modelPath, 'model.json'));
      return true;
    } catch {
      return false;
    }
  }
  
  /**
   * Calculate checksum of downloaded file
   */
  async calculateChecksum(filePath: string): Promise<string> {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    
    for await (const chunk of stream) {
      hash.update(chunk);
    }
    
    return hash.digest('hex');
  }
  
  /**
   * Download model from S3
   */
  async downloadModel(modelInfo: ModelInfo): Promise<string> {
    logger.info(`📥 Downloading model: ${modelInfo.model_id}@${modelInfo.version}`);
    logger.info(`   URL: ${modelInfo.url}`);
    
    const downloadPath = path.join(this.cacheDir, 'downloads', `${modelInfo.model_id}-${modelInfo.version}.tar.gz`);
    await fs.mkdir(path.dirname(downloadPath), { recursive: true });
    
    // Download file
    const response = await fetch(modelInfo.url);
    
    if (!response.ok) {
      throw new Error(`Failed to download model: ${response.statusText}`);
    }
    
    // Save to disk
    const fileStream = createWriteStream(downloadPath);
    await pipeline(response.body as any, fileStream);
    
    logger.info('✅ Model downloaded');
    
    // Verify checksum
    logger.info('🔍 Verifying checksum...');
    const checksum = await this.calculateChecksum(downloadPath);
    
    if (checksum !== modelInfo.checksum) {
      await fs.unlink(downloadPath);
      throw new Error(`Checksum mismatch! Expected: ${modelInfo.checksum}, Got: ${checksum}`);
    }
    
    logger.info('✅ Checksum verified');
    
    return downloadPath;
  }
  
  /**
   * Extract model archive
   */
  async extractModel(archivePath: string, modelId: string, version: string): Promise<string> {
    logger.info('📦 Extracting model archive...');
    
    const extractPath = path.join(this.cacheDir, modelId, version);
    await fs.mkdir(extractPath, { recursive: true });
    
    // Extract tar.gz
    await tar.extract({
      file: archivePath,
      cwd: extractPath
    });
    
    logger.info('✅ Model extracted to:', extractPath);
    
    // Clean up archive
    await fs.unlink(archivePath);
    
    return extractPath;
  }
  
  /**
   * Load model into memory
   */
  async loadModelIntoMemory(modelPath: string, modelInfo: ModelInfo): Promise<LoadedModel> {
    logger.info(`🧠 Loading model into memory: ${modelInfo.model_id}@${modelInfo.version}`);
    
    // Load TensorFlow model
    const model = await tf.loadLayersModel(`file://${modelPath}/model.json`);
    
    logger.info('✅ Model loaded into memory');
    logger.info(`   Architecture: ${model.name}`);
    logger.info(`   Inputs: ${model.inputs.map(i => i.shape).join(', ')}`);
    logger.info(`   Outputs: ${model.outputs.map(o => o.shape).join(', ')}`);
    
    const loadedModel: LoadedModel = {
      modelId: modelInfo.model_id,
      version: modelInfo.version,
      tier: modelInfo.tier,
      model: model,
      manifest: modelInfo.manifest,
      loadedAt: new Date()
    };
    
    return loadedModel;
  }
  
  /**
   * Load model (download if not cached)
   */
  async loadModel(modelId: string, version?: string): Promise<LoadedModel> {
    logger.info(`🔄 Loading model: ${modelId}${version ? `@${version}` : ' (latest)'}`);
    
    // Get model info from version beacon
    let modelInfo: ModelInfo | null;
    
    if (version) {
      const { data } = await supabase
        .from('model_versions')
        .select('*')
        .eq('model_id', modelId)
        .eq('version', version)
        .eq('tier', this.tier)
        .single();
      
      modelInfo = data as ModelInfo;
    } else {
      modelInfo = await this.getLatestVersion(modelId);
    }
    
    if (!modelInfo) {
      throw new Error(`Model not found: ${modelId}${version ? `@${version}` : ''}`);
    }
    
    // Check if already loaded
    const cacheKey = `${modelInfo.model_id}@${modelInfo.version}`;
    if (this.loadedModels.has(cacheKey)) {
      logger.info('✅ Model already loaded (using cached)');
      return this.loadedModels.get(cacheKey)!;
    }
    
    // Check if cached locally
    const isCached = await this.isModelCached(modelInfo.model_id, modelInfo.version);
    
    let modelPath: string;
    
    if (isCached) {
      logger.info('✅ Using cached model');
      modelPath = path.join(this.cacheDir, modelInfo.model_id, modelInfo.version);
    } else {
      // Download and extract
      const archivePath = await this.downloadModel(modelInfo);
      modelPath = await this.extractModel(archivePath, modelInfo.model_id, modelInfo.version);
      
      // Increment download counter
      await supabase
        .from('model_versions')
        .update({ downloads: (modelInfo as any).downloads + 1 })
        .eq('id', modelInfo.id);
    }
    
    // Load into memory
    const loadedModel = await this.loadModelIntoMemory(modelPath, modelInfo);
    
    // Cache in memory
    this.loadedModels.set(cacheKey, loadedModel);
    
    logger.info('🎉 Model ready for inference!');
    
    return loadedModel;
  }
  
  /**
   * Load all available models for this tier
   */
  async loadAllModels(): Promise<LoadedModel[]> {
    logger.info('🔄 Loading all available models...');
    
    const availableModels = await this.queryVersionBeacon();
    const loadedModels: LoadedModel[] = [];
    
    for (const modelInfo of availableModels) {
      try {
        const loaded = await this.loadModel(modelInfo.model_id, modelInfo.version);
        loadedModels.push(loaded);
      } catch (error) {
        logger.error(`❌ Failed to load model ${modelInfo.model_id}:`, error);
      }
    }
    
    logger.info(`✅ Loaded ${loadedModels.length}/${availableModels.length} models`);
    
    return loadedModels;
  }
  
  /**
   * Get loaded model
   */
  getModel(modelId: string): LoadedModel | null {
    for (const [key, model] of this.loadedModels.entries()) {
      if (model.modelId === modelId) {
        return model;
      }
    }
    
    return null;
  }
  
  /**
   * Unload model from memory
   */
  async unloadModel(modelId: string): Promise<void> {
    const model = this.getModel(modelId);
    
    if (!model) {
      logger.info(`⚠️  Model not loaded: ${modelId}`);
      return;
    }
    
    // Dispose TensorFlow model
    model.model.dispose();
    
    // Remove from cache
    const cacheKey = `${model.modelId}@${model.version}`;
    this.loadedModels.delete(cacheKey);
    
    logger.info(`✅ Model unloaded: ${modelId}`);
  }
  
  /**
   * Check for model updates
   */
  async checkForUpdates(): Promise<{
    modelId: string;
    currentVersion: string;
    latestVersion: string;
    updateAvailable: boolean;
  }[]> {
    logger.info('🔍 Checking for model updates...');
    
    const updates: any[] = [];
    
    for (const [_, loadedModel] of this.loadedModels.entries()) {
      const latest = await this.getLatestVersion(loadedModel.modelId);
      
      if (latest && latest.version !== loadedModel.version) {
        updates.push({
          modelId: loadedModel.modelId,
          currentVersion: loadedModel.version,
          latestVersion: latest.version,
          updateAvailable: true
        });
      }
    }
    
    if (updates.length > 0) {
      logger.info(`📢 ${updates.length} model update(s) available`);
    } else {
      logger.info('✅ All models up to date');
    }
    
    return updates;
  }
  
  /**
   * Update model to latest version
   */
  async updateModel(modelId: string): Promise<LoadedModel> {
    logger.info(`🔄 Updating model: ${modelId}`);
    
    // Unload current version
    await this.unloadModel(modelId);
    
    // Load latest version
    const updated = await this.loadModel(modelId);
    
    logger.info(`✅ Model updated: ${modelId}@${updated.version}`);
    
    return updated;
  }
  
  /**
   * Clean up old cached models
   */
  async cleanupCache(keepVersions: number = 2): Promise<void> {
    logger.info('🧹 Cleaning up old cached models...');
    
    const modelDirs = await fs.readdir(this.cacheDir);
    
    for (const modelId of modelDirs) {
      if (modelId === 'downloads') continue;
      
      const modelPath = path.join(this.cacheDir, modelId);
      const versions = await fs.readdir(modelPath);
      
      // Sort versions by modification time
      const versionStats = await Promise.all(
        versions.map(async (version) => {
          const versionPath = path.join(modelPath, version);
          const stats = await fs.stat(versionPath);
          return { version, mtime: stats.mtime, path: versionPath };
        })
      );
      
      versionStats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
      
      // Delete old versions
      const toDelete = versionStats.slice(keepVersions);
      
      for (const { version, path: versionPath } of toDelete) {
        logger.info(`   Deleting old version: ${modelId}@${version}`);
        await fs.rm(versionPath, { recursive: true, force: true });
      }
    }
    
    logger.info('✅ Cache cleanup complete');
  }
}
