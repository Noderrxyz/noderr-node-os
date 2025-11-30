/**
 * ML Service Client module.
 * 
 * Provides gRPC client for accessing ML inference services.
 */

export {
  MLServiceClient,
  createMLServiceClient,
  type MLPrediction,
  type RegimeClassification,
  type GeneratedFeatures,
  type OHLCVData,
  type HealthStatus,
  type PerformanceMetrics,
  type MLServiceClientConfig,
} from './MLServiceClient';
