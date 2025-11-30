// Type definitions for ML models

export interface LightGBMConfig {
  objective: string;
  metric: string;
  boosting_type: string;
  num_leaves: number;
  learning_rate: number;
  feature_fraction: number;
  bagging_fraction: number;
  bagging_freq: number;
  verbose: number;
  num_threads: number;
  device_type: string;
  force_col_wise: boolean;
}

export interface CatBoostConfig {
  iterations: number;
  learning_rate: number;
  depth: number;
  loss_function: string;
  eval_metric: string;
  random_seed: number;
  logging_level: string;
  thread_count: number;
  use_best_model: boolean;
  task_type: string;
  devices: string;
}

export interface XGBoostConfig {
  objective: string;
  max_depth: number;
  eta: number;
  subsample: number;
  colsample_bytree: number;
  tree_method: string;
  gpu_id: number;
  predictor: string;
  n_estimators: number;
}

export interface TabNetConfig {
  n_d: number;
  n_a: number;
  n_steps: number;
  gamma: number;
  cat_idxs: number[];
  cat_dims: number[];
  cat_emb_dim: number;
  n_independent: number;
  n_shared: number;
  epsilon: number;
  momentum: number;
  lambda_sparse: number;
  seed: number;
  clip_value: number;
  verbose: number;
  optimizer_fn: any;
  optimizer_params: any;
  scheduler_fn?: any;
  scheduler_params?: any;
  mask_type: string;
  device_name: string;
}

export interface SAINTConfig {
  num_heads: number;
  num_blocks: number;
  embedding_dim: number;
  attention_dropout: number;
  ffn_dropout: number;
  hidden_dim: number;
  activation: string;
  normalization: string;
  numerical_embedding_type: string;
  categorical_embedding_type: string;
  task: string;
  device: string;
}

// Mock implementations for now
export class LightGBM {
  constructor(config: LightGBMConfig) {}
  async train(X: number[][], y: number[], valX: number[][], valY: number[]): Promise<void> {}
  async predict(X: number[][]): Promise<number> { return 0; }
}

export class CatBoost {
  constructor(config: CatBoostConfig) {}
  async train(X: number[][], y: number[], valX: number[][], valY: number[]): Promise<void> {}
  async predict(X: number[][]): Promise<number> { return 0; }
}

export class XGBoost {
  constructor(config: XGBoostConfig) {}
  async train(X: number[][], y: number[], valX: number[][], valY: number[]): Promise<void> {}
  async predict(X: number[][]): Promise<number> { return 0; }
} 