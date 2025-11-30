/**
 * PPOAgent - Proximal Policy Optimization Agent
 * 
 * Implements PPO algorithm for stable and efficient policy learning
 * in continuous action spaces for trading
 */

import * as tf from '@tensorflow/tfjs-node';
import { RLAgent, MarketState, RLAction } from '@noderr/types';

interface PPOConfig {
  stateSize: number;
  actionSize: number;
  learningRate: number;
  clipEpsilon: number;
  epochs: number;
  miniBatchSize: number;
  gamma?: number;
  lambda?: number;
  entropyCoeff?: number;
  valueCoeff?: number;
}

export class PPOAgent implements RLAgent {
  id: string;
  algorithm = 'PPO';
  version = '1.0.0';
  trainingEpisodes = 0;
  currentPolicy: any;
  performanceHistory = [];
  hyperparameters: Record<string, any>;
  
  private config: PPOConfig;
  private actorModel!: tf.LayersModel;
  private criticModel!: tf.LayersModel;
  private actorOptimizer!: tf.Optimizer;
  private criticOptimizer!: tf.Optimizer;
  
  constructor(config: PPOConfig) {
    this.id = `ppo-${Date.now()}`;
    this.config = {
      gamma: 0.99,
      lambda: 0.95,
      entropyCoeff: 0.01,
      valueCoeff: 0.5,
      ...config
    };
    this.hyperparameters = { ...this.config };
  }
  
  async initialize(): Promise<void> {
    // Build actor network (policy)
    this.actorModel = this.buildActorModel();
    
    // Build critic network (value function)
    this.criticModel = this.buildCriticModel();
    
    // Initialize optimizers
    this.actorOptimizer = tf.train.adam(this.config.learningRate);
    this.criticOptimizer = tf.train.adam(this.config.learningRate);
    
    // Store initial policy
    this.currentPolicy = await this.actorModel.getWeights();
  }
  
  private buildActorModel(): tf.LayersModel {
    const input = tf.input({ shape: [this.config.stateSize] });
    
    // Hidden layers
    let x = tf.layers.dense({ 
      units: 256, 
      activation: 'relu',
      kernelInitializer: 'glorotUniform'
    }).apply(input) as tf.SymbolicTensor;
    
    x = tf.layers.dropout({ rate: 0.2 }).apply(x) as tf.SymbolicTensor;
    
    x = tf.layers.dense({ 
      units: 128, 
      activation: 'relu' 
    }).apply(x) as tf.SymbolicTensor;
    
    // Output layers for different action components
    const actionType = tf.layers.dense({
      units: 4, // buy, sell, hold, close
      activation: 'softmax',
      name: 'action_type'
    }).apply(x) as tf.SymbolicTensor;
    
    const quantity = tf.layers.dense({
      units: 1,
      activation: 'sigmoid', // 0-1 range
      name: 'quantity'
    }).apply(x) as tf.SymbolicTensor;
    
    const confidence = tf.layers.dense({
      units: 1,
      activation: 'sigmoid',
      name: 'confidence'
    }).apply(x) as tf.SymbolicTensor;
    
    return tf.model({
      inputs: input,
      outputs: [actionType, quantity, confidence]
    });
  }
  
  private buildCriticModel(): tf.LayersModel {
    const input = tf.input({ shape: [this.config.stateSize] });
    
    let x = tf.layers.dense({ 
      units: 256, 
      activation: 'relu',
      kernelInitializer: 'glorotUniform'
    }).apply(input) as tf.SymbolicTensor;
    
    x = tf.layers.dropout({ rate: 0.2 }).apply(x) as tf.SymbolicTensor;
    
    x = tf.layers.dense({ 
      units: 128, 
      activation: 'relu' 
    }).apply(x) as tf.SymbolicTensor;
    
    const value = tf.layers.dense({
      units: 1,
      name: 'value'
    }).apply(x) as tf.SymbolicTensor;
    
    return tf.model({
      inputs: input,
      outputs: value
    });
  }
  
  async selectAction(stateTensor: tf.Tensor, marketState: MarketState): Promise<RLAction> {
    return tf.tidy(() => {
      // Get action predictions from actor
      const predictions = this.actorModel.predict(stateTensor) as tf.Tensor[];
      
      // Extract action components
      const actionTypeProbs = predictions[0]?.dataSync() as Float32Array;
      const quantityData = predictions[1]?.dataSync();
      const confidenceData = predictions[2]?.dataSync();
      
      const quantity = quantityData ? quantityData[0] : 0.05;
      const confidence = confidenceData ? confidenceData[0] : 0.5;
      
      // Sample action type from probability distribution
      const actionType = this.sampleActionType(actionTypeProbs);
      
      // Get appropriate symbol based on action
      const symbols = Object.keys(marketState.prices);
      const symbol = this.selectSymbol(symbols, marketState, actionType);
      
      const orderType: RLAction['orderType'] = confidence > 0.8 ? 'limit' : 'market';
      
      return {
        type: actionType,
        symbol,
        quantity: (quantity ?? 0.05) * 0.1, // Scale to 0-10% of portfolio
        orderType,
        confidence: confidence ?? 0.5,
        reasoning: `PPO policy decision with confidence ${((confidence ?? 0.5) * 100).toFixed(1)}%`
      };
    });
  }
  
  private sampleActionType(probs: Float32Array): RLAction['type'] {
    const actions: RLAction['type'][] = ['buy', 'sell', 'hold', 'close'];
    
    // Sample from probability distribution
    let cumSum = 0;
    const rand = Math.random();
    
    for (let i = 0; i < probs.length && i < actions.length; i++) {
      cumSum += probs[i] || 0;
      if (rand < cumSum) {
        return actions[i]!;
      }
    }
    
    return 'hold'; // Default
  }
  
  private selectSymbol(
    symbols: string[], 
    marketState: MarketState, 
    actionType: RLAction['type']
  ): string {
    // For now, select based on highest momentum or existing positions
    if (actionType === 'close' && marketState.positions.length > 0) {
      // Close existing position
      return marketState.positions[0].symbol;
    }
    
    // Select based on technical indicators
    let bestSymbol = symbols[0] ?? 'BTC-USD';
    let bestScore = -Infinity;
    
    for (const symbol of symbols.slice(0, 5)) { // Limit to top 5 symbols
      const indicators = marketState.technicalIndicators[symbol];
      if (typeof indicators === 'object' && indicators !== null) {
        const momentum = typeof indicators === 'number' ? indicators : (indicators as any).momentum || 0;
        const rsi = typeof indicators === 'number' ? 50 : (indicators as any).rsi || 50;
        const score = momentum + rsi / 100;
        
        if (score > bestScore) {
          bestScore = score;
          bestSymbol = symbol;
        }
      }
    }
    
    return bestSymbol;
  }
  
  async update(
    states: tf.Tensor,
    actions: tf.Tensor,
    rewards: tf.Tensor,
    nextStates: tf.Tensor,
    dones: tf.Tensor
  ): Promise<void> {
    const batchSize = states.shape[0];
    
    // Calculate advantages using GAE
    const values = this.criticModel.predict(states) as tf.Tensor;
    const nextValues = this.criticModel.predict(nextStates) as tf.Tensor;
    const advantages = await this.calculateAdvantages(
      rewards, 
      values, 
      nextValues, 
      dones
    );
    
    // Get old action probabilities for ratio calculation
    const oldActionProbs = await this.getActionProbabilities(states, actions);
    
    // PPO update for multiple epochs
    for (let epoch = 0; epoch < this.config.epochs; epoch++) {
      // Create mini-batches
      const indices = tf.util.createShuffledIndices(batchSize);
      
      for (let i = 0; i < batchSize; i += this.config.miniBatchSize) {
        const batchIndices = indices.slice(i, i + this.config.miniBatchSize);
        
        await this.updateBatch(
          tf.gather(states, batchIndices),
          tf.gather(actions, batchIndices),
          tf.gather(advantages, batchIndices),
          tf.gather(oldActionProbs, batchIndices),
          tf.gather(rewards, batchIndices),
          tf.gather(values, batchIndices)
        );
      }
    }
    
    // Update policy reference
    this.currentPolicy = await this.actorModel.getWeights();
    this.trainingEpisodes++;
    
    // Clean up tensors
    values.dispose();
    nextValues.dispose();
    advantages.dispose();
    oldActionProbs.dispose();
  }
  
  private async calculateAdvantages(
    rewards: tf.Tensor,
    values: tf.Tensor,
    nextValues: tf.Tensor,
    dones: tf.Tensor
  ): Promise<tf.Tensor> {
    return tf.tidy(() => {
      const gamma = this.config.gamma!;
      const lambda = this.config.lambda!;
      
      // Calculate TD errors
      const notDones = tf.sub(1, dones);
      const targets = tf.add(
        rewards,
        tf.mul(tf.mul(nextValues.squeeze(), notDones), gamma)
      );
      const tdErrors = tf.sub(targets, values.squeeze());
      
      // Calculate GAE
      const advantages = [];
      let gae = 0;
      
      const tdErrorsArray = tdErrors.arraySync() as number[];
      const notDonesArray = notDones.arraySync() as number[];
      
      for (let i = tdErrorsArray.length - 1; i >= 0; i--) {
        gae = (tdErrorsArray[i] ?? 0) + gamma * lambda * (notDonesArray[i] ?? 0) * gae;
        advantages.unshift(gae);
      }
      
      const advantagesTensor = tf.tensor1d(advantages);
      
      // Normalize advantages
      const mean = advantagesTensor.mean();
      const std = tf.sqrt(advantagesTensor.variance());
      
      return advantagesTensor.sub(mean).div(std.add(1e-8));
    });
  }
  
  private async getActionProbabilities(
    states: tf.Tensor,
    actions: tf.Tensor
  ): Promise<tf.Tensor> {
    return tf.tidy(() => {
      const predictions = this.actorModel.predict(states) as tf.Tensor[];
      const actionTypeProbs = predictions[0];
      
      // Extract action type indices from actions tensor
      const actionIndices = actions.slice([0, 0], [-1, 1]).reshape([-1]);
      
      // Gather probabilities for taken actions
      const probs = tf.gather(
        actionTypeProbs.transpose(),
        actionIndices.cast('int32')
      ).diagonal();
      
      return probs;
    });
  }
  
  private async updateBatch(
    states: tf.Tensor,
    actions: tf.Tensor,
    advantages: tf.Tensor,
    oldProbs: tf.Tensor,
    rewards: tf.Tensor,
    oldValues: tf.Tensor
  ): Promise<void> {
    // Actor update
    await this.actorOptimizer.minimize(() => {
      const predictions = this.actorModel.predict(states) as tf.Tensor[];
      const actionProbs = predictions[0];
      
      // Calculate ratio
      const actionIndices = actions.slice([0, 0], [-1, 1]).reshape([-1]);
      const newProbs = tf.gather(
        actionProbs.transpose(),
        actionIndices.cast('int32')
      ).diagonal();
      
      const ratio = tf.div(newProbs, tf.add(oldProbs, 1e-8));
      
      // Clipped surrogate objective
      const surr1 = tf.mul(ratio, advantages);
      const surr2 = tf.mul(
        tf.clipByValue(ratio, 1 - this.config.clipEpsilon, 1 + this.config.clipEpsilon),
        advantages
      );
      
      const policyLoss = tf.neg(tf.mean(tf.minimum(surr1, surr2)));
      
      // Entropy bonus
      const entropy = tf.neg(
        tf.sum(tf.mul(actionProbs, tf.log(tf.add(actionProbs, 1e-8))), 1)
      );
      const entropyLoss = tf.neg(tf.mean(entropy));
      
      // Total loss
      return tf.add(policyLoss, tf.mul(entropyLoss, this.config.entropyCoeff!));
    });
    
    // Critic update
    await this.criticOptimizer.minimize(() => {
      const values = this.criticModel.predict(states) as tf.Tensor;
      const valueTargets = tf.add(oldValues.squeeze(), advantages);
      
      // Value loss (MSE)
      const valueLoss = tf.losses.meanSquaredError(valueTargets, values.squeeze());
      
      return tf.mul(valueLoss, this.config.valueCoeff!);
    });
  }
  
  async save(path: string): Promise<void> {
    await this.actorModel.save(`file://${path}/actor`);
    await this.criticModel.save(`file://${path}/critic`);
  }
  
  async load(path: string): Promise<void> {
    this.actorModel = await tf.loadLayersModel(`file://${path}/actor/model.json`);
    this.criticModel = await tf.loadLayersModel(`file://${path}/critic/model.json`);
  }
} 