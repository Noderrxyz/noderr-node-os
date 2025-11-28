import * as tf from '@tensorflow/tfjs-node-gpu';
import * as winston from 'winston';
import { TradingDecision } from './IntegratedTradingSystem';

export interface RLState {
  features: number[][];
  marketRegime: string;
  currentPosition: number;
  recentReturns: number[];
  volatility: number;
}

export interface RLAction {
  action: 'buy' | 'sell' | 'hold';
  confidence: number;
  expectedReward: number;
  actionLogits: number[];
}

export interface Experience {
  state: RLState;
  action: RLAction;
  reward: number;
  nextState: RLState;
  done: boolean;
  priority: number;
  timestamp: number;
}

export class OnlineRLTrader {
  private policyNetwork!: tf.LayersModel;
  private valueNetwork!: tf.LayersModel;
  private oldPolicyNetwork!: tf.LayersModel;
  private replayBuffer: PrioritizedReplayBuffer;
  private logger: winston.Logger;
  
  // PPO hyperparameters
  private readonly clipRatio = 0.2;
  private readonly learningRate = 3e-4;
  private readonly gamma = 0.99;
  private readonly lambda = 0.95;
  private readonly entropyCoef = 0.01;
  private readonly valueCoef = 0.5;
  private readonly maxGradNorm = 0.5;
  private readonly batchSize = 128;
  private readonly updateFrequency = 128;
  
  // Safety constraints
  private readonly maxPositionSize = 0.3;
  private readonly maxActionChange = 0.1;
  private readonly volatilityThreshold = 0.05;
  
  private stepCount = 0;
  private episodeRewards: number[] = [];
  
  constructor(logger: winston.Logger) {
    this.logger = logger;
    this.replayBuffer = new PrioritizedReplayBuffer(1000000); // 1M capacity
    this.initializeNetworks();
  }
  
  private initializeNetworks(): void {
    // Shared feature extractor
    const featureExtractor = this.createFeatureExtractor();
    
    // Policy network (actor)
    const policyInput = tf.input({ shape: [128] });
    let policyHidden = tf.layers.dense({
      units: 256,
      activation: 'relu',
      kernelInitializer: 'heNormal',
      kernelRegularizer: tf.regularizers.l2({ l2: 0.01 })
    }).apply(policyInput) as tf.SymbolicTensor;
    
    policyHidden = tf.layers.dropout({ rate: 0.1 }).apply(policyHidden) as tf.SymbolicTensor;
    
    policyHidden = tf.layers.dense({
      units: 128,
      activation: 'relu',
      kernelInitializer: 'heNormal'
    }).apply(policyHidden) as tf.SymbolicTensor;
    
    const actionLogits = tf.layers.dense({
      units: 3, // buy, sell, hold
      activation: 'linear',
      kernelInitializer: tf.initializers.randomNormal({ stddev: 0.01 })
    }).apply(policyHidden) as tf.SymbolicTensor;
    
    this.policyNetwork = tf.model({
      inputs: policyInput,
      outputs: actionLogits
    });
    
    // Value network (critic)
    const valueInput = tf.input({ shape: [128] });
    let valueHidden = tf.layers.dense({
      units: 256,
      activation: 'relu',
      kernelInitializer: 'heNormal',
      kernelRegularizer: tf.regularizers.l2({ l2: 0.01 })
    }).apply(valueInput) as tf.SymbolicTensor;
    
    valueHidden = tf.layers.dropout({ rate: 0.1 }).apply(valueHidden) as tf.SymbolicTensor;
    
    valueHidden = tf.layers.dense({
      units: 128,
      activation: 'relu',
      kernelInitializer: 'heNormal'
    }).apply(valueHidden) as tf.SymbolicTensor;
    
    const value = tf.layers.dense({
      units: 1,
      activation: 'linear'
    }).apply(valueHidden) as tf.SymbolicTensor;
    
    this.valueNetwork = tf.model({
      inputs: valueInput,
      outputs: value
    });
    
    // Compile networks
    this.policyNetwork.compile({
      optimizer: tf.train.adam(this.learningRate),
      loss: 'categoricalCrossentropy'
    });
    
    this.valueNetwork.compile({
      optimizer: tf.train.adam(this.learningRate),
      loss: 'meanSquaredError'
    });
    
    // Clone policy for PPO
    this.oldPolicyNetwork = this.cloneModel(this.policyNetwork);
  }
  
  private createFeatureExtractor(): tf.Sequential {
    return tf.sequential({
      layers: [
        tf.layers.dense({
          inputShape: [20], // Adjust based on actual feature size
          units: 64,
          activation: 'relu',
          kernelInitializer: 'heNormal'
        }),
        tf.layers.batchNormalization(),
        tf.layers.dense({
          units: 128,
          activation: 'relu',
          kernelInitializer: 'heNormal'
        }),
        tf.layers.dropout({ rate: 0.1 })
      ]
    });
  }
  
  async getAction(state: RLState): Promise<RLAction> {
    this.stepCount++;
    
    // Safety check: reduce action magnitude during high volatility
    const volatilityMultiplier = state.volatility > this.volatilityThreshold ? 0.5 : 1.0;
    
    // Extract and process features
    const features = this.extractStateFeatures(state);
    const featureTensor = tf.tensor2d([features]);
    
    // Get action probabilities from policy network
    const actionLogitsTensor = this.policyNetwork.predict(featureTensor) as tf.Tensor;
    const actionLogits = await actionLogitsTensor.array() as number[][];
    
    // Apply temperature scaling for exploration
    const temperature = this.getExplorationTemperature();
    const scaledLogits = actionLogits[0].map(l => l / temperature);
    
    // Sample action from categorical distribution
    const actionProbs = tf.softmax(tf.tensor1d(scaledLogits));
    const actionIndex = await this.sampleCategorical(actionProbs);
    
    // Map to action
    const actions: ('buy' | 'sell' | 'hold')[] = ['buy', 'sell', 'hold'];
    const selectedAction = actions[actionIndex];
    
    // Calculate confidence and expected reward
    const actionProbsArray = await actionProbs.array() as number[];
    const confidence = actionProbsArray[actionIndex] * volatilityMultiplier;
    
    // Estimate expected reward using value network
    const valueTensor = this.valueNetwork.predict(featureTensor) as tf.Tensor;
    const expectedReward = ((await valueTensor.array()) as number[][])[0][0];
    
    // Cleanup tensors
    featureTensor.dispose();
    actionLogitsTensor.dispose();
    actionProbs.dispose();
    valueTensor.dispose();
    
    // Apply safety constraints
    const safeAction = this.applySafetyConstraints(selectedAction, state, confidence);
    
    return {
      action: safeAction.action,
      confidence: safeAction.confidence,
      expectedReward: expectedReward * volatilityMultiplier,
      actionLogits: scaledLogits
    };
  }
  
  private extractStateFeatures(state: RLState): number[] {
    const features: number[] = [];
    
    // Market features
    if (state.features && state.features[0]) {
      features.push(...state.features[0].slice(0, 10)); // First 10 features
    }
    
    // Position and risk features
    features.push(
      state.currentPosition,
      Math.abs(state.currentPosition), // Position magnitude
      state.volatility,
      state.volatility > this.volatilityThreshold ? 1 : 0 // High volatility flag
    );
    
    // Recent returns features
    if (state.recentReturns && state.recentReturns.length > 0) {
      const returns = state.recentReturns.slice(-5);
      features.push(
        ...returns,
        Math.max(...returns),
        Math.min(...returns),
        returns.reduce((a, b) => a + b, 0) / returns.length
      );
    }
    
    // Regime encoding
    const regimeMap: Record<string, number> = {
      'trending': 0,
      'mean_reverting': 1,
      'volatile': 2,
      'stable': 3,
      'crisis': 4
    };
    features.push(regimeMap[state.marketRegime] || 3);
    
    // Pad or truncate to fixed size
    while (features.length < 128) features.push(0);
    return features.slice(0, 128);
  }
  
  private async sampleCategorical(probs: tf.Tensor1D): Promise<number> {
    const cumSum = await tf.cumsum(probs).array() as number[];
    const random = Math.random();
    
    for (let i = 0; i < cumSum.length; i++) {
      if (random < cumSum[i]) return i;
    }
    
    return cumSum.length - 1;
  }
  
  private getExplorationTemperature(): number {
    // Decay exploration over time
    const minTemp = 0.5;
    const maxTemp = 2.0;
    const decayRate = 0.9999;
    
    return minTemp + (maxTemp - minTemp) * Math.pow(decayRate, this.stepCount);
  }
  
  private applySafetyConstraints(
    action: 'buy' | 'sell' | 'hold',
    state: RLState,
    confidence: number
  ): { action: 'buy' | 'sell' | 'hold'; confidence: number } {
    // Position size limits
    if (action === 'buy' && state.currentPosition >= this.maxPositionSize) {
      return { action: 'hold', confidence: confidence * 0.5 };
    }
    
    if (action === 'sell' && state.currentPosition <= -this.maxPositionSize) {
      return { action: 'hold', confidence: confidence * 0.5 };
    }
    
    // Reduce confidence during extreme volatility
    if (state.volatility > this.volatilityThreshold * 2) {
      confidence *= 0.3;
    }
    
    // Prevent rapid position changes
    if (Math.abs(state.currentPosition) > 0.2 && action !== 'hold') {
      confidence *= 0.7;
    }
    
    return { action, confidence };
  }
  
  async updateWithReward(
    decision: TradingDecision,
    pnl: number,
    slippage: number,
    state: RLState,
    nextState: RLState
  ): Promise<void> {
    // Calculate shaped reward
    const reward = this.calculateShapedReward(pnl, slippage, decision, state);
    
    // Create experience
    const experience: Experience = {
      state,
      action: {
        action: decision.action,
        confidence: decision.confidence,
        expectedReward: 0,
        actionLogits: []
      },
      reward,
      nextState,
      done: false,
      priority: Math.abs(reward) + 1e-6,
      timestamp: Date.now()
    };
    
    // Add to replay buffer
    this.replayBuffer.add(experience);
    
    // Update episode rewards
    this.episodeRewards.push(reward);
    
    // Perform PPO update if enough steps
    if (this.stepCount % this.updateFrequency === 0 && 
        this.replayBuffer.size() >= this.batchSize) {
      await this.performPPOUpdate();
    }
    
    // Log performance
    if (this.episodeRewards.length % 100 === 0) {
      const avgReward = this.episodeRewards.slice(-100)
        .reduce((a, b) => a + b, 0) / 100;
      
      this.logger.info('RL Performance Update', {
        stepCount: this.stepCount,
        avgReward: avgReward.toFixed(4),
        bufferSize: this.replayBuffer.size(),
        explorationTemp: this.getExplorationTemperature().toFixed(3)
      });
    }
  }
  
  private calculateShapedReward(
    pnl: number,
    slippage: number,
    decision: TradingDecision,
    state: RLState
  ): number {
    // Base reward from PnL (normalized)
    let reward = pnl / 10000; // Normalize to roughly [-1, 1]
    
    // Penalize slippage
    reward -= slippage / 100; // Convert bps to penalty
    
    // Reward risk-adjusted returns
    if (state.volatility > 0) {
      const sharpeComponent = (pnl / 10000) / (state.volatility + 1e-6);
      reward += sharpeComponent * 0.3;
    }
    
    // Penalize excessive position sizes
    const positionPenalty = Math.pow(Math.abs(state.currentPosition), 2) * 0.1;
    reward -= positionPenalty;
    
    // Reward confident correct decisions
    if (pnl > 0 && decision.confidence > 0.7) {
      reward += 0.1;
    }
    
    // Penalize overconfident wrong decisions
    if (pnl < 0 && decision.confidence > 0.8) {
      reward -= 0.2;
    }
    
    // Clip reward to prevent instability
    return Math.max(-2, Math.min(2, reward));
  }
  
  private async performPPOUpdate(): Promise<void> {
    const startTime = Date.now();
    
    // Sample batch from replay buffer
    const batch = this.replayBuffer.sample(this.batchSize);
    if (batch.length < this.batchSize) return;
    
    // Prepare tensors
    const states = batch.map(exp => this.extractStateFeatures(exp.state));
    const actions = batch.map(exp => {
      const actionMap = { 'buy': 0, 'sell': 1, 'hold': 2 };
      return actionMap[exp.action.action];
    });
    const rewards = batch.map(exp => exp.reward);
    const nextStates = batch.map(exp => this.extractStateFeatures(exp.nextState));
    const dones = batch.map(exp => exp.done ? 1 : 0);
    
    const statesTensor = tf.tensor2d(states);
    const actionsTensor = tf.tensor1d(actions, 'int32');
    const rewardsTensor = tf.tensor1d(rewards);
    const nextStatesTensor = tf.tensor2d(nextStates);
    const donesTensor = tf.tensor1d(dones);
    
    // Calculate advantages using GAE
    const advantages = await this.calculateGAE(
      statesTensor,
      rewardsTensor,
      nextStatesTensor,
      donesTensor
    );
    
    // PPO update loop
    const epochs = 4;
    for (let epoch = 0; epoch < epochs; epoch++) {
      // Calculate old action probabilities
      const oldActionProbs = this.oldPolicyNetwork.predict(statesTensor) as tf.Tensor;
      
      // Policy loss
      const policyLoss = this.calculatePPOLoss(
        statesTensor,
        actionsTensor,
        advantages,
        oldActionProbs
      );
      
      // Value loss
      const valueLoss = this.calculateValueLoss(
        statesTensor,
        rewardsTensor,
        nextStatesTensor,
        donesTensor
      );
      
      // Combined loss
      const totalLoss = tf.add(
        policyLoss,
        tf.mul(valueLoss, this.valueCoef)
      );
      
      // Update networks
      await this.policyNetwork.fit(statesTensor, actionsTensor, {
        epochs: 1,
        batchSize: this.batchSize,
        verbose: 0
      });
      
      await this.valueNetwork.fit(statesTensor, rewardsTensor, {
        epochs: 1,
        batchSize: this.batchSize,
        verbose: 0
      });
      
      oldActionProbs.dispose();
      totalLoss.dispose();
    }
    
    // Update old policy network
    this.oldPolicyNetwork = this.cloneModel(this.policyNetwork);
    
    // Update priorities in replay buffer
    const tdErrors = await this.calculateTDErrors(batch);
    batch.forEach((exp, i) => {
      exp.priority = Math.abs(tdErrors[i]) + 1e-6;
    });
    
    // Cleanup
    statesTensor.dispose();
    actionsTensor.dispose();
    rewardsTensor.dispose();
    nextStatesTensor.dispose();
    donesTensor.dispose();
    advantages.dispose();
    
    const updateTime = Date.now() - startTime;
    this.logger.debug(`PPO update completed in ${updateTime}ms`);
  }
  
  private async calculateGAE(
    states: tf.Tensor2D,
    rewards: tf.Tensor1D,
    nextStates: tf.Tensor2D,
    dones: tf.Tensor1D
  ): Promise<tf.Tensor1D> {
    const values = this.valueNetwork.predict(states) as tf.Tensor;
    const nextValues = this.valueNetwork.predict(nextStates) as tf.Tensor;
    
    const valuesArray = await values.array() as number[][];
    const nextValuesArray = await nextValues.array() as number[][];
    const rewardsArray = await rewards.array() as number[];
    const donesArray = await dones.array() as number[];
    
    const advantages: number[] = [];
    let gae = 0;
    
    // Calculate GAE backwards
    for (let t = rewardsArray.length - 1; t >= 0; t--) {
      const delta = rewardsArray[t] + 
        this.gamma * nextValuesArray[t][0] * (1 - donesArray[t]) - 
        valuesArray[t][0];
      
      gae = delta + this.gamma * this.lambda * (1 - donesArray[t]) * gae;
      advantages.unshift(gae);
    }
    
    values.dispose();
    nextValues.dispose();
    
    return tf.tensor1d(advantages);
  }
  
  private calculatePPOLoss(
    states: tf.Tensor2D,
    actions: tf.Tensor1D,
    advantages: tf.Tensor1D,
    oldActionProbs: tf.Tensor
  ): tf.Tensor {
    return tf.tidy(() => {
      const actionProbs = this.policyNetwork.predict(states) as tf.Tensor;
      const actionProbsSoftmax = tf.softmax(actionProbs);
      const oldActionProbsSoftmax = tf.softmax(oldActionProbs);
      
      // Get probabilities for taken actions
      const indices = tf.stack([
        tf.range(0, actions.shape[0], 1, 'int32'),
        actions
      ], 1);
      
      const actionProb = tf.gatherND(actionProbsSoftmax, indices);
      const oldActionProb = tf.gatherND(oldActionProbsSoftmax, indices);
      
      // Calculate ratio
      const ratio = tf.div(actionProb, tf.add(oldActionProb, 1e-8));
      
      // Clipped surrogate objective
      const surr1 = tf.mul(ratio, advantages);
      const surr2 = tf.mul(
        tf.clipByValue(ratio, 1 - this.clipRatio, 1 + this.clipRatio),
        advantages
      );
      
      const policyLoss = tf.neg(tf.mean(tf.minimum(surr1, surr2)));
      
      // Add entropy bonus
      const entropy = tf.neg(tf.sum(
        tf.mul(actionProbsSoftmax, tf.log(tf.add(actionProbsSoftmax, 1e-8))),
        1
      ));
      const entropyLoss = tf.neg(tf.mul(tf.mean(entropy), this.entropyCoef));
      
      return tf.add(policyLoss, entropyLoss);
    });
  }
  
  private calculateValueLoss(
    states: tf.Tensor2D,
    rewards: tf.Tensor1D,
    nextStates: tf.Tensor2D,
    dones: tf.Tensor1D
  ): tf.Tensor {
    return tf.tidy(() => {
      const values = this.valueNetwork.predict(states) as tf.Tensor;
      const nextValues = this.valueNetwork.predict(nextStates) as tf.Tensor;
      
      // Calculate TD targets
      const targets = tf.add(
        rewards,
        tf.mul(
          tf.mul(nextValues.squeeze(), tf.sub(1, dones)),
          this.gamma
        )
      );
      
      return tf.losses.meanSquaredError(targets, values.squeeze());
    });
  }
  
  private async calculateTDErrors(batch: Experience[]): Promise<number[]> {
    const states = batch.map(exp => this.extractStateFeatures(exp.state));
    const nextStates = batch.map(exp => this.extractStateFeatures(exp.nextState));
    const rewards = batch.map(exp => exp.reward);
    const dones = batch.map(exp => exp.done ? 1 : 0);
    
    const statesTensor = tf.tensor2d(states);
    const nextStatesTensor = tf.tensor2d(nextStates);
    
    const values = await (this.valueNetwork.predict(statesTensor) as tf.Tensor).array() as number[][];
    const nextValues = await (this.valueNetwork.predict(nextStatesTensor) as tf.Tensor).array() as number[][];
    
    statesTensor.dispose();
    nextStatesTensor.dispose();
    
    return batch.map((exp, i) => {
      const tdTarget = rewards[i] + this.gamma * nextValues[i][0] * (1 - dones[i]);
      return Math.abs(tdTarget - values[i][0]);
    });
  }
  
  private cloneModel(model: tf.LayersModel): tf.LayersModel {
    // Create a new model with the same architecture
    const input = tf.input({ shape: [128] });
    
    // Recreate the architecture based on which model we're cloning
    let output: tf.SymbolicTensor;
    
    // Simple architecture recreation - in production, you'd save/load the model properly
    let hidden = tf.layers.dense({
      units: 256,
      activation: 'relu',
      kernelInitializer: 'heNormal',
      kernelRegularizer: tf.regularizers.l2({ l2: 0.01 })
    }).apply(input) as tf.SymbolicTensor;
    
    hidden = tf.layers.dropout({ rate: 0.1 }).apply(hidden) as tf.SymbolicTensor;
    
    hidden = tf.layers.dense({
      units: 128,
      activation: 'relu',
      kernelInitializer: 'heNormal'
    }).apply(hidden) as tf.SymbolicTensor;
    
    // Determine output layer based on model type
    if (model.outputs[0].shape[1] === 3) {
      // Policy network
      output = tf.layers.dense({
        units: 3,
        activation: 'linear',
        kernelInitializer: tf.initializers.randomNormal({ stddev: 0.01 })
      }).apply(hidden) as tf.SymbolicTensor;
    } else {
      // Value network
      output = tf.layers.dense({
        units: 1,
        activation: 'linear'
      }).apply(hidden) as tf.SymbolicTensor;
    }
    
    const cloned = tf.model({ inputs: input, outputs: output });
    cloned.setWeights(model.getWeights());
    
    return cloned;
  }
  
  getMetrics(): {
    totalSteps: number;
    avgReward: number;
    explorationTemp: number;
    bufferSize: number;
  } {
    const recentRewards = this.episodeRewards.slice(-100);
    const avgReward = recentRewards.length > 0
      ? recentRewards.reduce((a, b) => a + b, 0) / recentRewards.length
      : 0;
    
    return {
      totalSteps: this.stepCount,
      avgReward,
      explorationTemp: this.getExplorationTemperature(),
      bufferSize: this.replayBuffer.size()
    };
  }
}

class PrioritizedReplayBuffer {
  private buffer: Experience[] = [];
  private priorities: number[] = [];
  private capacity: number;
  private alpha = 0.6; // Priority exponent
  private beta = 0.4; // Importance sampling exponent
  private betaIncrement = 0.001;
  private epsilon = 1e-6;
  
  constructor(capacity: number) {
    this.capacity = capacity;
  }
  
  add(experience: Experience): void {
    const priority = experience.priority || this.getMaxPriority();
    
    if (this.buffer.length >= this.capacity) {
      // Remove oldest experience
      this.buffer.shift();
      this.priorities.shift();
    }
    
    this.buffer.push(experience);
    this.priorities.push(Math.pow(priority + this.epsilon, this.alpha));
  }
  
  sample(batchSize: number): Experience[] {
    if (this.buffer.length < batchSize) {
      return [];
    }
    
    const batch: Experience[] = [];
    const indices: number[] = [];
    
    // Calculate sampling probabilities
    const totalPriority = this.priorities.reduce((a, b) => a + b, 0);
    const probs = this.priorities.map(p => p / totalPriority);
    
    // Sample with priorities
    for (let i = 0; i < batchSize; i++) {
      const idx = this.sampleIndex(probs);
      batch.push(this.buffer[idx]);
      indices.push(idx);
    }
    
    // Update beta for importance sampling
    this.beta = Math.min(1.0, this.beta + this.betaIncrement);
    
    return batch;
  }
  
  private sampleIndex(probs: number[]): number {
    const random = Math.random();
    let cumSum = 0;
    
    for (let i = 0; i < probs.length; i++) {
      cumSum += probs[i];
      if (random < cumSum) return i;
    }
    
    return probs.length - 1;
  }
  
  private getMaxPriority(): number {
    return this.priorities.length > 0 ? Math.max(...this.priorities) : 1.0;
  }
  
  size(): number {
    return this.buffer.length;
  }
  
  updatePriorities(indices: number[], priorities: number[]): void {
    for (let i = 0; i < indices.length; i++) {
      if (indices[i] < this.priorities.length) {
        this.priorities[indices[i]] = Math.pow(priorities[i] + this.epsilon, this.alpha);
      }
    }
  }
} 