/**
 * ML Model Packaging and Deployment System
 * 
 * Handles packaging, uploading, and distributing ML models to nodes
 * - Export trained model weights
 * - Create model manifest with metadata
 * - Compress for efficient distribution
 * - Upload to S3
 * - Update version beacon
 * 
 * Integration Complete - Phase 5
 */

import { Logger } from '@noderr/utils/src';
import * as tf from '@tensorflow/tfjs-node';
import { createHash } from 'crypto';
import { createGzip } from 'zlib';
import { pipeline } from 'stream/promises';
import { createReadStream, createWriteStream, promises as fs } from 'fs';
import path from 'path';
import tar from 'tar';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createClient } from '@supabase/supabase-js';
nconst logger = new Logger('ml-deployment');

// Initialize S3 client
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || ''
  }
});

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_PROJECT_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

/**
 * Model manifest structure
 */
export interface ModelManifest {
  id: string;
  version: string;
  tier: 'validator' | 'guardian' | 'oracle';
  architecture: string;
  inputShape: number[];
  outputShape: number[];
  checksum: string;
  size: number;
  createdAt: string;
  metadata: {
    accuracy?: number;
    loss?: number;
    epochs?: number;
    trainingDataset?: string;
    [key: string]: any;
  };
}

/**
 * Model package structure
 */
export interface ModelPackage {
  manifest: ModelManifest;
  modelPath: string;
  packagePath: string;
  checksum: string;
  size: number;
}

/**
 * Calculate file checksum (SHA-256)
 */
export async function calculateChecksum(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  const stream = createReadStream(filePath);
  
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  
  return hash.digest('hex');
}

/**
 * Get file size in bytes
 */
export async function getFileSize(filePath: string): Promise<number> {
  const stats = await fs.stat(filePath);
  return stats.size;
}

/**
 * Export TensorFlow model to disk
 */
export async function exportModel(
  model: tf.LayersModel,
  outputPath: string
): Promise<void> {
  logger.info('📦 Exporting model to:', outputPath);
  
  // Ensure output directory exists
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  
  // Save model in TensorFlow.js format
  await model.save(`file://${outputPath}`);
  
  logger.info('✅ Model exported successfully');
}

/**
 * Create model manifest
 */
export async function createManifest(
  modelId: string,
  version: string,
  tier: 'validator' | 'guardian' | 'oracle',
  modelPath: string,
  metadata: any = {}
): Promise<ModelManifest> {
  logger.info('📝 Creating model manifest...');
  
  // Load model to get architecture info
  const model = await tf.loadLayersModel(`file://${modelPath}/model.json`);
  
  // Get input/output shapes
  const inputShape = model.inputs[0].shape?.slice(1) || [];
  const outputShape = model.outputs[0].shape?.slice(1) || [];
  
  // Calculate checksum of model.json
  const checksum = await calculateChecksum(`${modelPath}/model.json`);
  
  // Get total size of model directory
  let totalSize = 0;
  const files = await fs.readdir(modelPath);
  for (const file of files) {
    const filePath = path.join(modelPath, file);
    const stats = await fs.stat(filePath);
    totalSize += stats.size;
  }
  
  const manifest: ModelManifest = {
    id: modelId,
    version: version,
    tier: tier,
    architecture: model.name || 'unknown',
    inputShape: inputShape as number[],
    outputShape: outputShape as number[],
    checksum: checksum,
    size: totalSize,
    createdAt: new Date().toISOString(),
    metadata: metadata
  };
  
  logger.info('✅ Manifest created:', manifest);
  
  return manifest;
}

/**
 * Package model with manifest
 */
export async function packageModel(
  modelPath: string,
  manifest: ModelManifest,
  outputDir: string
): Promise<ModelPackage> {
  logger.info('📦 Packaging model:', manifest.id);
  
  // Create output directory
  await fs.mkdir(outputDir, { recursive: true });
  
  // Create temporary directory for packaging
  const tempDir = path.join(outputDir, 'temp');
  await fs.mkdir(tempDir, { recursive: true });
  
  // Copy model files to temp directory
  const modelFiles = await fs.readdir(modelPath);
  for (const file of modelFiles) {
    const srcPath = path.join(modelPath, file);
    const destPath = path.join(tempDir, file);
    await fs.copyFile(srcPath, destPath);
  }
  
  // Write manifest.json
  const manifestPath = path.join(tempDir, 'manifest.json');
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  
  // Create tar.gz archive
  const packageName = `${manifest.id}-${manifest.version}.tar.gz`;
  const packagePath = path.join(outputDir, packageName);
  
  await tar.create(
    {
      gzip: true,
      file: packagePath,
      cwd: tempDir
    },
    await fs.readdir(tempDir)
  );
  
  // Calculate package checksum
  const checksum = await calculateChecksum(packagePath);
  const size = await getFileSize(packagePath);
  
  // Clean up temp directory
  await fs.rm(tempDir, { recursive: true, force: true });
  
  logger.info('✅ Model packaged:', packagePath);
  logger.info(`   Size: ${(size / 1024 / 1024).toFixed(2)} MB`);
  logger.info(`   Checksum: ${checksum}`);
  
  return {
    manifest,
    modelPath,
    packagePath,
    checksum,
    size
  };
}

/**
 * Upload model package to S3
 */
export async function uploadToS3(
  packagePath: string,
  modelId: string,
  version: string,
  tier: string
): Promise<string> {
  logger.info('☁️  Uploading to S3...');
  
  const bucket = process.env.MODEL_BUCKET || 'noderr-models';
  const key = `models/${tier}/${modelId}/${version}/model.tar.gz`;
  
  // Read file
  const fileContent = await fs.readFile(packagePath);
  
  // Upload to S3
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: fileContent,
    ContentType: 'application/gzip',
    Metadata: {
      modelId: modelId,
      version: version,
      tier: tier
    }
  });
  
  await s3Client.send(command);
  
  const url = `https://${bucket}.s3.amazonaws.com/${key}`;
  
  logger.info('✅ Uploaded to S3:', url);
  
  return url;
}

/**
 * Update model version beacon
 */
export async function updateVersionBeacon(
  modelId: string,
  version: string,
  tier: string,
  url: string,
  checksum: string,
  manifest: ModelManifest
): Promise<void> {
  logger.info('🔔 Updating version beacon...');
  
  // Insert into model_versions table
  const { error } = await supabase
    .from('model_versions')
    .insert({
      model_id: modelId,
      version: version,
      tier: tier,
      url: url,
      checksum: checksum,
      manifest: manifest,
      deployed_at: new Date().toISOString(),
      active: true
    });
  
  if (error) {
    throw new Error(`Failed to update version beacon: ${error.message}`);
  }
  
  logger.info('✅ Version beacon updated');
}

/**
 * Main deployment function
 * 
 * Complete pipeline: export → package → upload → update beacon
 */
export async function deployModel(
  model: tf.LayersModel,
  modelId: string,
  version: string,
  tier: 'validator' | 'guardian' | 'oracle',
  metadata: any = {}
): Promise<{
  url: string;
  checksum: string;
  manifest: ModelManifest;
}> {
  logger.info('🚀 Deploying model:', { modelId, version, tier });
  
  const workDir = path.join('/tmp', 'model-deployment', modelId, version);
  await fs.mkdir(workDir, { recursive: true });
  
  try {
    // 1. Export model
    const modelPath = path.join(workDir, 'model');
    await exportModel(model, modelPath);
    
    // 2. Create manifest
    const manifest = await createManifest(modelId, version, tier, modelPath, metadata);
    
    // 3. Package model
    const modelPackage = await packageModel(modelPath, manifest, workDir);
    
    // 4. Upload to S3
    const url = await uploadToS3(modelPackage.packagePath, modelId, version, tier);
    
    // 5. Update version beacon
    await updateVersionBeacon(modelId, version, tier, url, modelPackage.checksum, manifest);
    
    // Clean up
    await fs.rm(workDir, { recursive: true, force: true });
    
    logger.info('🎉 Model deployment complete!');
    
    return {
      url,
      checksum: modelPackage.checksum,
      manifest
    };
  } catch (error) {
    // Clean up on error
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

/**
 * List available model versions
 */
export async function listModelVersions(
  modelId?: string,
  tier?: string
): Promise<any[]> {
  let query = supabase
    .from('model_versions')
    .select('*')
    .eq('active', true)
    .order('deployed_at', { ascending: false });
  
  if (modelId) {
    query = query.eq('model_id', modelId);
  }
  
  if (tier) {
    query = query.eq('tier', tier);
  }
  
  const { data, error } = await query;
  
  if (error) {
    throw new Error(`Failed to list model versions: ${error.message}`);
  }
  
  return data || [];
}

/**
 * Get latest model version
 */
export async function getLatestModelVersion(
  modelId: string,
  tier: string
): Promise<any | null> {
  const { data, error } = await supabase
    .from('model_versions')
    .select('*')
    .eq('model_id', modelId)
    .eq('tier', tier)
    .eq('active', true)
    .order('deployed_at', { ascending: false })
    .limit(1)
    .single();
  
  if (error) {
    return null;
  }
  
  return data;
}

/**
 * Deactivate model version
 */
export async function deactivateModelVersion(
  modelId: string,
  version: string
): Promise<void> {
  const { error } = await supabase
    .from('model_versions')
    .update({ active: false })
    .eq('model_id', modelId)
    .eq('version', version);
  
  if (error) {
    throw new Error(`Failed to deactivate model version: ${error.message}`);
  }
  
  logger.info('✅ Model version deactivated:', { modelId, version });
}
