/**
 * @noderr/node-runtime - Node Runtime with Model Loading and Inference
 *
 * Provides GPU integration, ML model loading, and inference capabilities
 * for NODERR network nodes.
 */

export { getNodeGpuId, hasGpu, getSystemInfoWithGpu } from './gpu-integration';
export { InferenceService, createInferenceService } from './inference-service';
export type { InferenceRequest, InferenceResult, InferenceTelemetry } from './inference-service';
export { ModelLoader } from './model-loader';
export type { ModelInfo, LoadedModel } from './model-loader';

export const VERSION = '1.0.0';
