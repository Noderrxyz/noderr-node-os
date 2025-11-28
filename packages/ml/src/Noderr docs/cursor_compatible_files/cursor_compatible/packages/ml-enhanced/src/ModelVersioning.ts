import { EventEmitter } from 'events';
import * as winston from 'winston';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

export interface ModelMetadata {
  id: string;
  name: string;
  version: string;
  type: 'tensorflow' | 'onnx' | 'pytorch' | 'custom';
  framework: string;
  architecture: Record<string, any>;
  hyperparameters: Record<string, any>;
  trainingMetrics: TrainingMetrics;
  validationMetrics: ValidationMetrics;
  createdAt: Date;
  trainedBy: string;
  datasetVersion: string;
  tags: string[];
  status: 'training' | 'validating' | 'deployed' | 'archived' | 'failed';
}

export interface TrainingMetrics {
  loss: number;
  accuracy?: number;
  epochs: number;
  trainingTime: number;
  convergenceEpoch: number;
  learningRate: number;
  batchSize: number;
}

export interface ValidationMetrics {
  testLoss: number;
  testAccuracy?: number;
  precision?: number;
  recall?: number;
  f1Score?: number;
  auc?: number;
  sharpeRatio?: number;
  maxDrawdown?: number;
  customMetrics: Record<string, number>;
}

export interface ModelDeployment {
  modelId: string;
  deploymentId: string;
  environment: 'development' | 'staging' | 'production';
  deployedAt: Date;
  deployedBy: string;
  endpoints: string[];
  resourceAllocation: ResourceAllocation;
  performanceBaseline: PerformanceBaseline;
  isActive: boolean;
}

export interface ResourceAllocation {
  cpu: number;
  memory: number;
  gpu?: number;
  replicas: number;
}

export interface PerformanceBaseline {
  latencyP50: number;
  latencyP95: number;
  latencyP99: number;
  throughput: number;
  errorRate: number;
}

export interface ModelComparison {
  baselineModel: string;
  candidateModel: string;
  metrics: ComparisonMetrics;
  recommendation: 'deploy' | 'reject' | 'further_testing';
  confidence: number;
}

export interface ComparisonMetrics {
  performanceImprovement: number;
  latencyChange: number;
  accuracyChange: number;
  stabilityScore: number;
}

export class ModelVersioningSystem extends EventEmitter {
  private logger: winston.Logger;
  private modelsPath: string;
  private metadataPath: string;
  private models: Map<string, ModelMetadata> = new Map();
  private deployments: Map<string, ModelDeployment> = new Map();
  private activeModels: Map<string, string> = new Map(); // environment -> modelId
  
  constructor(logger: winston.Logger, basePath: string) {
    super();
    this.logger = logger;
    this.modelsPath = path.join(basePath, 'models');
    this.metadataPath = path.join(basePath, 'metadata');
  }
  
  async initialize(): Promise<void> {
    // Create directories if they don't exist
    await fs.mkdir(this.modelsPath, { recursive: true });
    await fs.mkdir(this.metadataPath, { recursive: true });
    
    // Load existing models
    await this.loadModels();
    
    this.logger.info('Model versioning system initialized', {
      modelsCount: this.models.size,
      deploymentsCount: this.deployments.size
    });
  }
  
  async registerModel(
    modelPath: string,
    metadata: Omit<ModelMetadata, 'id' | 'createdAt' | 'status'>
  ): Promise<ModelMetadata> {
    // Validate input model path
    const normalizedModelPath = path.normalize(modelPath);
    const resolvedModelPath = path.resolve(normalizedModelPath);
    
    // Verify the model file exists and is readable
    try {
      await fs.access(resolvedModelPath, fs.constants.R_OK);
      const stats = await fs.stat(resolvedModelPath);
      if (!stats.isFile()) {
        throw new Error('Model path must be a file');
      }
      // Limit file size to prevent DoS
      const maxSize = 5 * 1024 * 1024 * 1024; // 5GB
      if (stats.size > maxSize) {
        throw new Error('Model file too large');
      }
    } catch (error) {
      throw new Error(`Model file not accessible: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    const modelId = this.generateModelId(metadata);
    
    const fullMetadata: ModelMetadata = {
      ...metadata,
      id: modelId,
      createdAt: new Date(),
      status: 'validating'
    };
    
    try {
      // Copy model to versioned location
      const versionedPath = path.join(this.modelsPath, modelId);
      await fs.mkdir(versionedPath, { recursive: true });
      await fs.copyFile(resolvedModelPath, path.join(versionedPath, 'model.bin'));
      
      // Save metadata
      await this.saveMetadata(fullMetadata);
      
      // Store in memory
      this.models.set(modelId, fullMetadata);
      
      this.logger.info('Model registered', {
        modelId,
        name: metadata.name,
        version: metadata.version
      });
      
      this.emit('model-registered', fullMetadata);
      
      // Start validation
      this.validateModel(modelId).catch(err => {
        this.logger.error('Model validation failed', { modelId, error: err });
      });
      
      return fullMetadata;
      
    } catch (error) {
      this.logger.error('Failed to register model', { modelId, error });
      throw error;
    }
  }
  
  async deployModel(
    modelId: string,
    environment: ModelDeployment['environment'],
    resourceAllocation: ResourceAllocation
  ): Promise<ModelDeployment> {
    const model = this.models.get(modelId);
    
    if (!model) {
      throw new Error(`Model ${modelId} not found`);
    }
    
    if (model.status !== 'validating' && model.status !== 'deployed') {
      throw new Error(`Model ${modelId} is not ready for deployment (status: ${model.status})`);
    }
    
    // Check if there's an active model in this environment
    const currentModelId = this.activeModels.get(environment);
    if (currentModelId) {
      // Perform A/B comparison
      const comparison = await this.compareModels(currentModelId, modelId);
      
      if (comparison.recommendation === 'reject') {
        throw new Error(`Model ${modelId} failed comparison test`);
      }
      
      this.emit('model-comparison', comparison);
    }
    
    const deployment: ModelDeployment = {
      modelId,
      deploymentId: `DEPLOY-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      environment,
      deployedAt: new Date(),
      deployedBy: 'system', // In production, get from auth context
      endpoints: this.generateEndpoints(environment),
      resourceAllocation,
      performanceBaseline: {
        latencyP50: 0,
        latencyP95: 0,
        latencyP99: 0,
        throughput: 0,
        errorRate: 0
      },
      isActive: true
    };
    
    // Deactivate previous deployment
    if (currentModelId) {
      const previousDeployments = Array.from(this.deployments.values())
        .filter(d => d.modelId === currentModelId && d.environment === environment);
      
      for (const prev of previousDeployments) {
        prev.isActive = false;
      }
    }
    
    // Store deployment
    this.deployments.set(deployment.deploymentId, deployment);
    this.activeModels.set(environment, modelId);
    
    // Update model status
    model.status = 'deployed';
    await this.saveMetadata(model);
    
    this.logger.info('Model deployed', {
      modelId,
      deploymentId: deployment.deploymentId,
      environment
    });
    
    this.emit('model-deployed', deployment);
    
    // Start performance monitoring
    this.monitorDeployment(deployment.deploymentId).catch(err => {
      this.logger.error('Deployment monitoring failed', { deploymentId: deployment.deploymentId, error: err });
    });
    
    return deployment;
  }
  
  async rollbackModel(
    environment: ModelDeployment['environment'],
    targetVersion?: string
  ): Promise<ModelDeployment> {
    const currentModelId = this.activeModels.get(environment);
    
    if (!currentModelId) {
      throw new Error(`No active model in ${environment} environment`);
    }
    
    // Find previous deployment
    const deploymentHistory = Array.from(this.deployments.values())
      .filter(d => d.environment === environment)
      .sort((a, b) => b.deployedAt.getTime() - a.deployedAt.getTime());
    
    let targetDeployment: ModelDeployment | undefined;
    
    if (targetVersion) {
      // Find specific version
      targetDeployment = deploymentHistory.find(d => {
        const model = this.models.get(d.modelId);
        return model?.version === targetVersion;
      });
    } else {
      // Find previous deployment
      targetDeployment = deploymentHistory.find(d => d.modelId !== currentModelId && d.modelId !== undefined);
    }
    
    if (!targetDeployment) {
      throw new Error('No previous deployment found for rollback');
    }
    
    // Verify target model is still valid
    const targetModel = this.models.get(targetDeployment.modelId);
    if (!targetModel || targetModel.status === 'failed') {
      throw new Error('Target model is not valid for rollback');
    }
    
    this.logger.warn('Rolling back model', {
      environment,
      fromModel: currentModelId,
      toModel: targetDeployment.modelId,
      targetVersion: targetModel.version
    });
    
    // Create rollback deployment record
    const rollbackDeployment: ModelDeployment = {
      ...targetDeployment,
      deploymentId: `ROLLBACK-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      deployedAt: new Date(),
      deployedBy: 'system-rollback',
      isActive: true
    };
    
    // Store rollback deployment
    this.deployments.set(rollbackDeployment.deploymentId, rollbackDeployment);
    
    // Update active model
    this.activeModels.set(environment, targetDeployment.modelId);
    
    // Deactivate current deployments
    const currentDeployments = deploymentHistory.filter(d => d.modelId === currentModelId && d.isActive);
    for (const curr of currentDeployments) {
      curr.isActive = false;
    }
    
    // Update model statuses
    const currentModel = this.models.get(currentModelId);
    if (currentModel) {
      currentModel.status = 'archived';
      await this.saveMetadata(currentModel);
    }
    
    targetModel.status = 'deployed';
    await this.saveMetadata(targetModel);
    
    // Emit rollback event
    this.emit('model-rollback', {
      environment,
      fromModel: currentModelId,
      toModel: targetDeployment.modelId,
      deployment: rollbackDeployment,
      reason: 'manual-rollback'
    });
    
    // Start monitoring the rolled-back model
    this.monitorDeployment(rollbackDeployment.deploymentId).catch(err => {
      this.logger.error('Failed to monitor rollback deployment', { 
        deploymentId: rollbackDeployment.deploymentId, 
        error: err 
      });
    });
    
    return rollbackDeployment;
  }
  
  async rollbackModelById(
    environment: ModelDeployment['environment'],
    targetModelId: string
  ): Promise<ModelDeployment> {
    const targetModel = this.models.get(targetModelId);
    if (!targetModel) {
      throw new Error(`Model ${targetModelId} not found`);
    }
    
    return this.rollbackModel(environment, targetModel.version);
  }
  
  async emergencyRollback(environment: ModelDeployment['environment']): Promise<ModelDeployment> {
    // Find the last known good deployment
    const deploymentHistory = Array.from(this.deployments.values())
      .filter(d => d.environment === environment)
      .sort((a, b) => b.deployedAt.getTime() - a.deployedAt.getTime());
    
    // Find a deployment with good performance metrics
    const goodDeployment = deploymentHistory.find(d => {
      const model = this.models.get(d.modelId);
      return model && 
             model.status !== 'failed' && 
             d.performanceBaseline.errorRate < 0.01 && // Less than 1% error rate
             d.performanceBaseline.latencyP95 < 100; // Less than 100ms P95 latency
    });
    
    if (!goodDeployment) {
      throw new Error('No suitable deployment found for emergency rollback');
    }
    
    this.logger.error('Performing emergency rollback', {
      environment,
      targetDeployment: goodDeployment.deploymentId
    });
    
    return this.rollbackModelById(environment, goodDeployment.modelId);
  }
  
  private async validateModel(modelId: string): Promise<void> {
    const model = this.models.get(modelId);
    if (!model) return;
    
    try {
      // Simulate validation process
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // In production, this would:
      // 1. Load the model
      // 2. Run test predictions
      // 3. Check performance metrics
      // 4. Validate against baseline
      
      const validationPassed = Math.random() > 0.1; // 90% pass rate for demo
      
      if (validationPassed) {
        model.status = 'validating';
        this.logger.info('Model validation passed', { modelId });
      } else {
        model.status = 'failed';
        this.logger.error('Model validation failed', { modelId });
      }
      
      await this.saveMetadata(model);
      
      this.emit('model-validated', {
        modelId,
        passed: validationPassed,
        metrics: model.validationMetrics
      });
      
    } catch (error) {
      model.status = 'failed';
      await this.saveMetadata(model);
      throw error;
    }
  }
  
  private async compareModels(
    baselineId: string,
    candidateId: string
  ): Promise<ModelComparison> {
    const baseline = this.models.get(baselineId);
    const candidate = this.models.get(candidateId);
    
    if (!baseline || !candidate) {
      throw new Error('Models not found for comparison');
    }
    
    // Calculate comparison metrics
    const performanceImprovement = 
      (candidate.validationMetrics.testAccuracy || 0) - 
      (baseline.validationMetrics.testAccuracy || 0);
    
    const latencyChange = 0; // Would be calculated from performance tests
    const accuracyChange = performanceImprovement;
    const stabilityScore = 0.95; // Would be calculated from variance tests
    
    // Determine recommendation
    let recommendation: ModelComparison['recommendation'] = 'reject';
    let confidence = 0.5;
    
    if (performanceImprovement > 0.01 && stabilityScore > 0.9) {
      recommendation = 'deploy';
      confidence = 0.9;
    } else if (performanceImprovement > 0 && stabilityScore > 0.8) {
      recommendation = 'further_testing';
      confidence = 0.7;
    }
    
    const comparison: ModelComparison = {
      baselineModel: baselineId,
      candidateModel: candidateId,
      metrics: {
        performanceImprovement,
        latencyChange,
        accuracyChange,
        stabilityScore
      },
      recommendation,
      confidence
    };
    
    this.logger.info('Model comparison completed', comparison);
    
    return comparison;
  }
  
  private async monitorDeployment(deploymentId: string): Promise<void> {
    const deployment = this.deployments.get(deploymentId);
    if (!deployment || !deployment.isActive) return;
    
    // Simulate performance monitoring
    const updateInterval = setInterval(async () => {
      if (!deployment.isActive) {
        clearInterval(updateInterval);
        return;
      }
      
      // Update performance metrics
      deployment.performanceBaseline = {
        latencyP50: 10 + Math.random() * 5,
        latencyP95: 20 + Math.random() * 10,
        latencyP99: 50 + Math.random() * 20,
        throughput: 1000 + Math.random() * 500,
        errorRate: Math.random() * 0.01
      };
      
      this.emit('deployment-metrics', {
        deploymentId,
        metrics: deployment.performanceBaseline
      });
      
      // Check for anomalies
      if (deployment.performanceBaseline.errorRate > 0.05) {
        this.logger.error('High error rate detected', {
          deploymentId,
          errorRate: deployment.performanceBaseline.errorRate
        });
        
        this.emit('deployment-anomaly', {
          deploymentId,
          type: 'high_error_rate',
          value: deployment.performanceBaseline.errorRate
        });
      }
      
    }, 30000); // Every 30 seconds
  }
  
  private generateModelId(metadata: Omit<ModelMetadata, 'id' | 'createdAt' | 'status'>): string {
    const hash = crypto.createHash('sha256');
    hash.update(`${metadata.name}-${metadata.version}-${Date.now()}`);
    return `MODEL-${hash.digest('hex').substring(0, 12)}`;
  }
  
  private generateEndpoints(environment: string): string[] {
    const base = `https://api.noderr.com/${environment}`;
    return [
      `${base}/predict`,
      `${base}/batch-predict`,
      `${base}/stream-predict`
    ];
  }
  
  private async saveMetadata(metadata: ModelMetadata): Promise<void> {
    const filePath = path.join(this.metadataPath, `${metadata.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(metadata, null, 2));
  }
  
  private async loadModels(): Promise<void> {
    try {
      const files = await fs.readdir(this.metadataPath);
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(this.metadataPath, file);
          const content = await fs.readFile(filePath, 'utf-8');
          const metadata: ModelMetadata = JSON.parse(content);
          
          // Convert date strings back to Date objects
          metadata.createdAt = new Date(metadata.createdAt);
          
          this.models.set(metadata.id, metadata);
        }
      }
      
    } catch (error) {
      this.logger.error('Failed to load models', error);
    }
  }
  
  // Query methods
  getModel(modelId: string): ModelMetadata | undefined {
    return this.models.get(modelId);
  }
  
  getModelsByStatus(status: ModelMetadata['status']): ModelMetadata[] {
    return Array.from(this.models.values()).filter(m => m.status === status);
  }
  
  getActiveModel(environment: string): ModelMetadata | undefined {
    const modelId = this.activeModels.get(environment);
    return modelId ? this.models.get(modelId) : undefined;
  }
  
  getDeploymentHistory(
    environment?: string,
    limit: number = 10
  ): ModelDeployment[] {
    let deployments = Array.from(this.deployments.values());
    
    if (environment) {
      deployments = deployments.filter(d => d.environment === environment);
    }
    
    return deployments
      .sort((a, b) => b.deployedAt.getTime() - a.deployedAt.getTime())
      .slice(0, limit);
  }
  
  async archiveModel(modelId: string): Promise<void> {
    const model = this.models.get(modelId);
    
    if (!model) {
      throw new Error(`Model ${modelId} not found`);
    }
    
    if (model.status === 'deployed') {
      throw new Error('Cannot archive deployed model');
    }
    
    model.status = 'archived';
    await this.saveMetadata(model);
    
    this.logger.info('Model archived', { modelId });
    this.emit('model-archived', { modelId });
  }
  
  async exportModel(modelId: string, outputPath: string): Promise<void> {
    const model = this.models.get(modelId);
    
    if (!model) {
      throw new Error(`Model ${modelId} not found`);
    }
    
    // Sanitize and validate output path to prevent path traversal
    const normalizedPath = path.normalize(outputPath);
    const resolvedPath = path.resolve(normalizedPath);
    
    // Ensure the output path is within allowed boundaries
    const allowedBasePath = path.resolve(process.cwd(), 'exports');
    if (!resolvedPath.startsWith(allowedBasePath)) {
      throw new Error('Invalid output path: Path traversal detected');
    }
    
    // Additional validation
    if (normalizedPath.includes('..') || normalizedPath.includes('~')) {
      throw new Error('Invalid output path: Contains forbidden characters');
    }
    
    const modelPath = path.join(this.modelsPath, modelId, 'model.bin');
    
    // Verify source file exists and is readable
    try {
      await fs.access(modelPath, fs.constants.R_OK);
    } catch (error) {
      throw new Error(`Model file not accessible: ${modelId}`);
    }
    
    const metadataPath = path.join(resolvedPath, 'metadata.json');
    const modelOutputPath = path.join(resolvedPath, 'model.bin');
    
    await fs.mkdir(resolvedPath, { recursive: true });
    await fs.copyFile(modelPath, modelOutputPath);
    await fs.writeFile(metadataPath, JSON.stringify(model, null, 2));
    
    this.logger.info('Model exported', { modelId, outputPath: resolvedPath });
  }
} 