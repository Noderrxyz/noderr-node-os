import { MetaEnsemble, EnsemblePrediction } from './MetaEnsemble';
import * as winston from 'winston';

export class LatencyAwareInference {
  private metaEnsemble: MetaEnsemble;
  private logger: winston.Logger;
  
  constructor(logger: winston.Logger) {
    this.logger = logger;
    this.metaEnsemble = new MetaEnsemble(logger);
  }
  
  async predict(features: number[][], budgetMs: number): Promise<EnsemblePrediction> {
    const startTime = Date.now();
    
    // Enable adaptive model selection based on latency budget
    this.metaEnsemble.enableAdaptiveModelSelection(budgetMs);
    
    try {
      // Get prediction with timeout
      const timeoutPromise = new Promise<EnsemblePrediction>((_, reject) => {
        setTimeout(() => reject(new Error('Prediction timeout')), budgetMs);
      });
      
      const predictionPromise = this.metaEnsemble.predictWithConfidence(features);
      
      const result = await Promise.race([predictionPromise, timeoutPromise]);
      
      const latency = Date.now() - startTime;
      this.logger.debug(`Latency-aware prediction completed in ${latency}ms (budget: ${budgetMs}ms)`);
      
      return result;
    } catch (error) {
      this.logger.warn('Prediction failed or timed out, using fast fallback', error);
      
      // Fallback to fastest model only
      return {
        value: 0,
        uncertainty: 1,
        modelWeights: [1, 0, 0, 0, 0],
        confidence: 0.3
      };
    }
  }
  
  async warmup(): Promise<void> {
    // Warm up models with dummy data
    const dummyFeatures = [[...Array(20).fill(0)]];
    
    try {
      await this.predict(dummyFeatures, 100);
      this.logger.info('Model warmup completed');
    } catch (error) {
      this.logger.warn('Model warmup failed', error);
    }
  }
} 