/**
 * ReinforcementLearner - Deep Reinforcement Learning for Trading Strategy Optimization
 * Implements Double DQN with Prioritized Experience Replay and continuous action spaces
 */

import * as tf from '@tensorflow/tfjs';
import { Logger } from 'winston';
import EventEmitter from 'events';
import {
  RLEnvironment,
  RLConfig,
  RLAlgorithm,
  RLHyperparameters,
  TradingAction,
  FeatureSet,
  StateSpace,
  ActionSpace,
  RewardFunction,
  ExplorationStrategy,
  MemoryConfig,
  ModelStatus,
  ModelPerformance,
  MLError,
  MLErrorCode
} from './types';

interface Experience {
  state: tf.Tensor;
  action: number;
  reward: number;
  nextState: tf.Tensor;
  done: boolean;
  priority?: number;
}

interface ReplayBuffer {
  buffer: Experience[];
  capacity: number;
  position: number;
  priorities: number[];
  alpha: number;
  beta: number;
  betaSchedule: (step: number) => number;
}

interface RLState {
  qNetwork: tf.LayersModel | null;
  targetNetwork: tf.LayersModel | null;
  optimizer: tf.Optimizer;
  environment: RLEnvironment;
  hyperparameters: RLHyperparameters;
  replayBuffer: ReplayBuffer;
  episodeRewards: number[];
  totalSteps: number;
  episodeCount: number;
  exploration: ExplorationState;
  status: ModelStatus;
  performance: ModelPerformance;
}

interface ExplorationState {
  strategy: ExplorationStrategy;
  currentValue: number;
  schedule: (step: number) => number;
}

interface EpisodeResult {
  totalReward: number;
  steps: number;
  finalPortfolioValue: number;
  maxDrawdown: number;
  sharpeRatio: number;
  actions: TradingAction[];
}

export class ReinforcementLearner extends EventEmitter {
  private logger: Logger;
  private state: RLState;
  private actionSpace: number;
  private stateSpace: number;
  
  constructor(
    logger: Logger,
    config: RLConfig
  ) {
    super();
    this.logger = logger;
    
    // Initialize dimensions
    this.stateSpace = this.calculateStateSpace(config.environment.stateSpace);
    this.actionSpace = this.calculateActionSpace(config.environment.actionSpace);
    
    // Initialize state
    this.state = {
      qNetwork: null,
      targetNetwork: null,
      optimizer: tf.train.adam(config.hyperparameters.learningStarts),
      environment: config.environment,
      hyperparameters: config.hyperparameters,
      replayBuffer: this.createReplayBuffer(config.memory),
      episodeRewards: [],
      totalSteps: 0,
      episodeCount: 0,
      exploration: this.createExplorationStrategy(config.exploration),
      status: ModelStatus.READY,
      performance: this.initializePerformance()
    };
    
    this.initializeNetworks();
  }
  
  /**
   * Initialize Q-network and target network
   */
  private async initializeNetworks(): Promise<void> {
    try {
      this.logger.info('Initializing RL networks');
      
      // Build Q-network
      this.state.qNetwork = this.buildQNetwork();
      
      // Build target network (same architecture)
      this.state.targetNetwork = this.buildQNetwork();
      
      // Copy weights to target network
      await this.updateTargetNetwork();
      
      this.state.status = ModelStatus.READY;
      this.logger.info('RL networks initialized successfully');
      
    } catch (error) {
      this.logger.error('Failed to initialize RL networks', { error });
      this.state.status = ModelStatus.FAILED;
      throw new MLError(
        MLErrorCode.MODEL_NOT_FOUND,
        'Failed to initialize RL networks',
        error
      );
    }
  }
  
  /**
   * Build Q-network architecture
   */
  private buildQNetwork(): tf.LayersModel {
    const input = tf.input({ shape: [this.stateSpace] });
    
    // Shared layers
    let x = tf.layers.dense({
      units: 512,
      activation: 'relu',
      kernelInitializer: 'heNormal',
      kernelRegularizer: tf.regularizers.l2({ l2: 1e-4 })
    }).apply(input) as tf.SymbolicTensor;
    
    x = tf.layers.batchNormalization().apply(x) as tf.SymbolicTensor;
    x = tf.layers.dropout({ rate: 0.2 }).apply(x) as tf.SymbolicTensor;
    
    x = tf.layers.dense({
      units: 256,
      activation: 'relu',
      kernelInitializer: 'heNormal'
    }).apply(x) as tf.SymbolicTensor;
    
    x = tf.layers.batchNormalization().apply(x) as tf.SymbolicTensor;
    x = tf.layers.dropout({ rate: 0.2 }).apply(x) as tf.SymbolicTensor;
    
    x = tf.layers.dense({
      units: 128,
      activation: 'relu',
      kernelInitializer: 'heNormal'
    }).apply(x) as tf.SymbolicTensor;
    
    // Dueling DQN architecture
    // Value stream
    let value = tf.layers.dense({
      units: 64,
      activation: 'relu'
    }).apply(x) as tf.SymbolicTensor;
    
    value = tf.layers.dense({
      units: 1,
      name: 'value'
    }).apply(value) as tf.SymbolicTensor;
    
    // Advantage stream
    let advantage = tf.layers.dense({
      units: 64,
      activation: 'relu'
    }).apply(x) as tf.SymbolicTensor;
    
    advantage = tf.layers.dense({
      units: this.actionSpace,
      name: 'advantage'
    }).apply(advantage) as tf.SymbolicTensor;
    
    // Combine value and advantage
    const output = tf.layers.lambda({
      f: ([value, advantage]: tf.Tensor[]) => {
        // Q(s,a) = V(s) + A(s,a) - mean(A(s,a))
        const advantageMean = tf.mean(advantage, -1, true);
        return tf.add(value, tf.sub(advantage, advantageMean));
      },
      name: 'q_values'
    }).apply([value, advantage]) as tf.SymbolicTensor;
    
    const model = tf.model({ inputs: input, outputs: output });
    
    // Compile with Huber loss
    model.compile({
      optimizer: this.state.optimizer,
      loss: this.huberLoss()
    });
    
    return model;
  }
  
  /**
   * Huber loss for stable training
   */
  private huberLoss(delta: number = 1.0): tf.LossOrMetricFn {
    return (yTrue: tf.Tensor, yPred: tf.Tensor) => {
      const error = tf.sub(yTrue, yPred);
      const condition = tf.lessEqual(tf.abs(error), delta);
      const smallError = tf.mul(0.5, tf.square(error));
      const largeError = tf.sub(tf.mul(delta, tf.abs(error)), tf.mul(0.5, tf.square(delta)));
      return tf.mean(tf.where(condition, smallError, largeError));
    };
  }
  
  /**
   * Train the RL agent
   */
  async train(episodes: number = 1000): Promise<void> {
    this.state.status = ModelStatus.TRAINING;
    this.logger.info(`Starting RL training for ${episodes} episodes`);
    
    for (let episode = 0; episode < episodes; episode++) {
      const result = await this.runEpisode();
      this.state.episodeRewards.push(result.totalReward);
      this.state.episodeCount++;
      
      // Log progress
      if (episode % 10 === 0) {
        const avgReward = this.calculateAverageReward(100);
        this.logger.info(`Episode ${episode}: Avg Reward = ${avgReward.toFixed(4)}`);
        this.emit('trainingProgress', {
          episode,
          averageReward: avgReward,
          exploration: this.state.exploration.currentValue,
          bufferSize: this.state.replayBuffer.position
        });
      }
      
      // Update target network
      if (this.state.totalSteps % this.state.hyperparameters.targetUpdateFrequency === 0) {
        await this.updateTargetNetwork();
      }
      
      // Train from replay buffer
      if (this.state.totalSteps > this.state.hyperparameters.learningStarts) {
        for (let i = 0; i < this.state.hyperparameters.gradientSteps; i++) {
          await this.optimizeModel();
        }
      }
      
      // Save checkpoint
      if (episode % 100 === 0 && episode > 0) {
        await this.saveCheckpoint(`episode-${episode}`);
      }
    }
    
    this.state.status = ModelStatus.READY;
    this.logger.info('RL training completed');
  }
  
  /**
   * Run a single episode
   */
  private async runEpisode(): Promise<EpisodeResult> {
    let state = await this.resetEnvironment();
    let totalReward = 0;
    let done = false;
    let steps = 0;
    const actions: TradingAction[] = [];
    const rewards: number[] = [];
    
    while (!done && steps < this.state.environment.maxStepsPerEpisode) {
      // Select action
      const action = await this.selectAction(state);
      actions.push(this.decodeAction(action));
      
      // Take action in environment
      const { nextState, reward, isDone } = await this.step(state, action);
      rewards.push(reward);
      
      // Store experience
      this.storeExperience({
        state: state,
        action,
        reward,
        nextState: nextState,
        done: isDone
      });
      
      totalReward += reward;
      state = nextState;
      done = isDone;
      steps++;
      this.state.totalSteps++;
      
      // Update exploration
      this.updateExploration();
    }
    
    // Calculate episode metrics
    const portfolioValue = this.calculatePortfolioValue(rewards);
    const maxDrawdown = this.calculateMaxDrawdown(rewards);
    const sharpeRatio = this.calculateSharpeRatio(rewards);
    
    return {
      totalReward,
      steps,
      finalPortfolioValue: portfolioValue,
      maxDrawdown,
      sharpeRatio,
      actions
    };
  }
  
  /**
   * Select action using epsilon-greedy with exploration
   */
  private async selectAction(state: tf.Tensor): Promise<number> {
    // Exploration
    if (Math.random() < this.state.exploration.currentValue) {
      return Math.floor(Math.random() * this.actionSpace);
    }
    
    // Exploitation
    const qValues = this.state.qNetwork!.predict(state.expandDims(0)) as tf.Tensor;
    const action = await qValues.argMax(-1).data();
    qValues.dispose();
    
    return action[0];
  }
  
  /**
   * Optimize model using experience replay
   */
  private async optimizeModel(): Promise<void> {
    const batchSize = this.state.hyperparameters.batchSize;
    
    // Sample from replay buffer
    const { batch, indices, weights } = this.sampleBatch(batchSize);
    
    if (batch.length < batchSize) return;
    
    // Prepare batch tensors
    const states = tf.stack(batch.map(e => e.state));
    const actions = tf.tensor1d(batch.map(e => e.action), 'int32');
    const rewards = tf.tensor1d(batch.map(e => e.reward));
    const nextStates = tf.stack(batch.map(e => e.nextState));
    const dones = tf.tensor1d(batch.map(e => e.done ? 0 : 1));
    
    // Calculate target Q-values using Double DQN
    const nextQ = this.state.qNetwork!.predict(nextStates) as tf.Tensor;
    const nextActions = nextQ.argMax(-1);
    const targetNextQ = this.state.targetNetwork!.predict(nextStates) as tf.Tensor;
    
    // Get Q-values for best actions from target network
    const targetValues = tf.tidy(() => {
      const gatheredQ = this.gatherAlongAxis(targetNextQ, nextActions);
      const discountedQ = tf.mul(gatheredQ, this.state.hyperparameters.gamma);
      return tf.add(rewards, tf.mul(discountedQ, dones));
    });
    
    // Train Q-network
    const loss = await this.trainStep(states, actions, targetValues, weights);
    
    // Update priorities for prioritized replay
    if (this.state.hyperparameters.prioritizedReplay) {
      this.updatePriorities(indices, loss);
    }
    
    // Clean up tensors
    states.dispose();
    actions.dispose();
    rewards.dispose();
    nextStates.dispose();
    dones.dispose();
    nextQ.dispose();
    nextActions.dispose();
    targetNextQ.dispose();
    targetValues.dispose();
  }
  
  /**
   * Single training step
   */
  private async trainStep(
    states: tf.Tensor,
    actions: tf.Tensor,
    targets: tf.Tensor,
    weights: number[]
  ): Promise<number[]> {
    const weightsTensor = tf.tensor1d(weights);
    
    return new Promise((resolve) => {
      tf.tidy(() => {
        const f = () => tf.tidy(() => {
          const qValues = this.state.qNetwork!.apply(states) as tf.Tensor;
          const oneHotActions = tf.oneHot(actions, this.actionSpace);
          const qSelected = tf.sum(tf.mul(qValues, oneHotActions), -1);
          
          const losses = tf.losses.huberLoss(targets, qSelected, undefined, undefined, tf.Reduction.NONE);
          const weightedLoss = tf.mean(tf.mul(losses, weightsTensor));
          
                    // Store losses for priority update          losses.array().then((lossArray: any) => resolve(lossArray as number[]));
          
          return weightedLoss;
        });
        
        const grads = tf.variableGrads(f);
        this.state.optimizer.applyGradients(grads.grads);
      });
    });
  }
  
  /**
   * Update target network weights
   */
  private async updateTargetNetwork(): Promise<void> {
    const tau = this.state.hyperparameters.tau || 1.0;
    
    const qWeights = this.state.qNetwork!.getWeights();
    const targetWeights = this.state.targetNetwork!.getWeights();
    
         const newWeights = qWeights.map((qWeight: any, i: number) => {       const targetWeight = targetWeights[i];       return tf.add(         tf.mul(qWeight, tau),         tf.mul(targetWeight, 1 - tau)       );     });          this.state.targetNetwork!.setWeights(newWeights);          // Clean up old weights     qWeights.forEach((w: any) => w.dispose());     targetWeights.forEach((w: any) => w.dispose());
  }
  
  /**
   * Create replay buffer
   */
  private createReplayBuffer(config: MemoryConfig): ReplayBuffer {
    return {
      buffer: [],
      capacity: config.capacity,
      position: 0,
      priorities: [],
      alpha: config.alpha || 0.6,
      beta: config.beta || 0.4,
      betaSchedule: (step: number) => {
        // Linear annealing to 1.0
        const betaStart = config.beta || 0.4;
        const betaFrames = 100000;
        return Math.min(1.0, betaStart + step * (1.0 - betaStart) / betaFrames);
      }
    };
  }
  
  /**
   * Store experience in replay buffer
   */
  private storeExperience(experience: Experience): void {
    const buffer = this.state.replayBuffer;
    
    // Calculate initial priority
    const priority = buffer.priorities.length === 0
      ? 1.0
      : Math.max(...buffer.priorities) || 1.0;
    
    if (buffer.buffer.length < buffer.capacity) {
      buffer.buffer.push(experience);
      buffer.priorities.push(priority);
    } else {
      buffer.buffer[buffer.position] = experience;
      buffer.priorities[buffer.position] = priority;
    }
    
    buffer.position = (buffer.position + 1) % buffer.capacity;
  }
  
  /**
   * Sample batch from replay buffer
   */
  private sampleBatch(batchSize: number): {
    batch: Experience[];
    indices: number[];
    weights: number[];
  } {
    const buffer = this.state.replayBuffer;
    const validSize = Math.min(buffer.buffer.length, buffer.capacity);
    
    if (validSize < batchSize) {
      return { batch: [], indices: [], weights: [] };
    }
    
    if (!this.state.hyperparameters.prioritizedReplay) {
      // Uniform sampling
      const indices: number[] = [];
      const batch: Experience[] = [];
      
      for (let i = 0; i < batchSize; i++) {
        const idx = Math.floor(Math.random() * validSize);
        indices.push(idx);
        batch.push(buffer.buffer[idx]);
      }
      
      return {
        batch,
        indices,
        weights: new Array(batchSize).fill(1.0)
      };
    }
    
    // Prioritized sampling
    const priorities = buffer.priorities.slice(0, validSize);
    const probs = this.calculateProbabilities(priorities, buffer.alpha);
    const indices = this.sampleIndices(probs, batchSize);
    const batch = indices.map(i => buffer.buffer[i]);
    
    // Calculate importance sampling weights
    const beta = buffer.betaSchedule(this.state.totalSteps);
    const weights = this.calculateISWeights(probs, indices, beta);
    
    return { batch, indices, weights };
  }
  
  /**
   * Calculate sampling probabilities
   */
  private calculateProbabilities(priorities: number[], alpha: number): number[] {
    const prios = priorities.map(p => Math.pow(p + 1e-6, alpha));
    const sum = prios.reduce((a, b) => a + b, 0);
    return prios.map(p => p / sum);
  }
  
  /**
   * Sample indices based on probabilities
   */
  private sampleIndices(probs: number[], size: number): number[] {
    const indices: number[] = [];
    const cumsum = this.cumsum(probs);
    
    for (let i = 0; i < size; i++) {
      const rand = Math.random();
      const idx = cumsum.findIndex(cs => cs > rand);
      indices.push(idx === -1 ? cumsum.length - 1 : idx);
    }
    
    return indices;
  }
  
  /**
   * Calculate importance sampling weights
   */
  private calculateISWeights(probs: number[], indices: number[], beta: number): number[] {
    const minProb = Math.min(...probs);
    const maxWeight = Math.pow(1 / (probs.length * minProb), beta);
    
    return indices.map(idx => {
      const weight = Math.pow(1 / (probs.length * probs[idx]), beta);
      return weight / maxWeight; // Normalize
    });
  }
  
  /**
   * Update priorities after training
   */
  private updatePriorities(indices: number[], losses: number[]): void {
    const buffer = this.state.replayBuffer;
    
    indices.forEach((idx, i) => {
      // Priority = |TD error| + epsilon
      buffer.priorities[idx] = Math.abs(losses[i]) + 1e-6;
    });
  }
  
  /**
   * Calculate state space dimensions
   */
  private calculateStateSpace(stateSpace: StateSpace): number {
    const features = stateSpace.features;
    let totalFeatures = 0;
    
    totalFeatures += features.priceFeatures.length;
    totalFeatures += features.volumeFeatures.length;
    totalFeatures += features.technicalFeatures.length;
    totalFeatures += features.marketFeatures.length;
    totalFeatures += features.sentimentFeatures.length;
    totalFeatures += features.onChainFeatures.length;
    
    return totalFeatures * stateSpace.history;
  }
  
  /**
   * Calculate action space dimensions
   */
  private calculateActionSpace(actionSpace: ActionSpace): number {
    if (actionSpace.type === 'discrete') {
      return actionSpace.actions.length;
    } else if (actionSpace.type === 'continuous') {
      // For continuous actions, discretize into bins
      return 21; // -100% to +100% in 10% increments
    } else {
      // Hybrid: discrete actions * position sizes
      return actionSpace.actions.length * 5; // 5 position sizes
    }
  }
  
  /**
   * Create exploration strategy
   */
  private createExplorationStrategy(exploration: ExplorationStrategy): ExplorationState {
    const schedule = this.createExplorationSchedule(exploration);
    
    return {
      strategy: exploration,
      currentValue: exploration.initialValue,
      schedule
    };
  }
  
  /**
   * Create exploration schedule function
   */
  private createExplorationSchedule(exploration: ExplorationStrategy): (step: number) => number {
    switch (exploration.type) {
      case 'epsilon_greedy':
        return (step: number) => {
          const progress = Math.min(1.0, step / exploration.decaySteps);
          return exploration.finalValue + 
            (exploration.initialValue - exploration.finalValue) * (1 - progress);
        };
        
      case 'boltzmann':
        return (step: number) => {
          const temp = exploration.temperature || 1.0;
          const progress = Math.min(1.0, step / exploration.decaySteps);
          return temp * (1 - progress) + 0.01; // Min temperature
        };
        
      case 'ucb':
        return (step: number) => {
          const c = exploration.c || 2.0;
          return c / Math.sqrt(step + 1);
        };
        
      default:
        return () => exploration.initialValue;
    }
  }
  
  /**
   * Update exploration value
   */
  private updateExploration(): void {
    const exploration = this.state.exploration;
    exploration.currentValue = exploration.schedule(this.state.totalSteps);
  }
  
  /**
   * Reset environment for new episode
   */
  private async resetEnvironment(): Promise<tf.Tensor> {
    // In production, this would reset the trading environment
    // For now, return random initial state
    const stateArray = new Array(this.stateSpace).fill(0).map(() => Math.random());
    return tf.tensor1d(stateArray);
  }
  
  /**
   * Take a step in the environment
   */
  private async step(
    state: tf.Tensor,
    action: number
  ): Promise<{ nextState: tf.Tensor; reward: number; isDone: boolean }> {
    // In production, this would execute the action and return the new state
    // Mock implementation
    const stateArray = await state.array() as number[];
    const nextStateArray = stateArray.map(s => s + (Math.random() - 0.5) * 0.1);
    
    const reward = this.calculateReward(stateArray, action, nextStateArray);
    const isDone = Math.random() < 0.01; // 1% chance of episode ending
    
    return {
      nextState: tf.tensor1d(nextStateArray),
      reward,
      isDone
    };
  }
  
  /**
   * Calculate reward based on state transition
   */
  private calculateReward(
    state: number[],
    action: number,
    nextState: number[]
  ): number {
    const rewardFunc = this.state.environment.rewardFunction;
    
    // Mock returns calculation
    const returns = (nextState[0] - state[0]) * this.decodeActionSize(action);
    const volatility = Math.abs(nextState[1] - state[1]);
    
    // Apply reward function
    let reward = returns;
    
    // Apply penalties
    reward -= rewardFunc.penaltyFactors.volatility * volatility;
    reward -= rewardFunc.penaltyFactors.turnover * Math.abs(this.decodeActionSize(action));
    
    // Risk-adjusted returns (Sharpe-like)
    if (volatility > 0) {
      reward = reward / volatility;
    }
    
    return reward;
  }
  
  /**
   * Decode action to trading action
   */
  private decodeAction(action: number): TradingAction {
    const actionSpace = this.state.environment.actionSpace;
    
    if (actionSpace.type === 'discrete') {
      return actionSpace.actions[action];
    }
    
    // For continuous/hybrid actions
    const actionType = Math.floor(action / 5); // 0: sell, 1: hold, 2: buy
    const sizeIndex = action % 5;
    const sizes = [0.2, 0.4, 0.6, 0.8, 1.0];
    
    const actionMap = ['sell', 'hold', 'buy'];
    
    return {
      type: actionMap[actionType] as any,
      confidence: 0.8,
      size: sizes[sizeIndex]
    };
  }
  
  /**
   * Decode action to position size
   */
  private decodeActionSize(action: number): number {
    const decodedAction = this.decodeAction(action);
    
    if (decodedAction.type === 'buy') {
      return decodedAction.size;
    } else if (decodedAction.type === 'sell') {
      return -decodedAction.size;
    }
    
    return 0;
  }
  
  /**
   * Helper function for gathering along axis
   */
  private gatherAlongAxis(tensor: tf.Tensor, indices: tf.Tensor): tf.Tensor {
    return tf.tidy(() => {
      const shape = tensor.shape;
      const flatTensor = tensor.reshape([-1]);
      const flatIndices = indices.add(tf.range(0, shape[0]).mul(shape[1]));
      return flatTensor.gather(flatIndices);
    });
  }
  
  /**
   * Calculate cumulative sum
   */
  private cumsum(arr: number[]): number[] {
    const result: number[] = [];
    let sum = 0;
    
    for (const val of arr) {
      sum += val;
      result.push(sum);
    }
    
    return result;
  }
  
  /**
   * Calculate average reward
   */
  private calculateAverageReward(window: number): number {
    const rewards = this.state.episodeRewards;
    if (rewards.length === 0) return 0;
    
    const start = Math.max(0, rewards.length - window);
    const windowRewards = rewards.slice(start);
    
    return windowRewards.reduce((a, b) => a + b, 0) / windowRewards.length;
  }
  
  /**
   * Calculate portfolio value from rewards
   */
  private calculatePortfolioValue(rewards: number[]): number {
    let value = 1.0; // Starting value
    
    for (const reward of rewards) {
      value *= (1 + reward);
    }
    
    return value;
  }
  
  /**
   * Calculate maximum drawdown
   */
  private calculateMaxDrawdown(rewards: number[]): number {
    let peak = 1.0;
    let maxDrawdown = 0;
    let value = 1.0;
    
    for (const reward of rewards) {
      value *= (1 + reward);
      
      if (value > peak) {
        peak = value;
      }
      
      const drawdown = (peak - value) / peak;
      maxDrawdown = Math.max(maxDrawdown, drawdown);
    }
    
    return maxDrawdown;
  }
  
  /**
   * Calculate Sharpe ratio
   */
  private calculateSharpeRatio(rewards: number[]): number {
    if (rewards.length < 2) return 0;
    
    const mean = rewards.reduce((a, b) => a + b, 0) / rewards.length;
    const variance = rewards.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / rewards.length;
    const std = Math.sqrt(variance);
    
    const riskFreeRate = this.state.environment.rewardFunction.riskFreeRate;
    
    return std > 0 ? (mean - riskFreeRate) / std : 0;
  }
  
  /**
   * Save model checkpoint
   */
  private async saveCheckpoint(name: string): Promise<void> {
    try {
      // In production, save to disk or cloud storage
      this.logger.info(`RL checkpoint saved: ${name}`);
    } catch (error) {
      this.logger.error('Failed to save checkpoint', { error });
    }
  }
  
  /**
   * Initialize performance metrics
   */
  private initializePerformance(): ModelPerformance {
    return {
      accuracy: 0,
      precision: 0,
      recall: 0,
      f1Score: 0,
      auc: 0,
      sharpeRatio: 0,
      sortinoRatio: 0,
      calmarRatio: 0,
      maxDrawdown: 0,
      winRate: 0,
      profitFactor: 0,
      mse: 0,
      mae: 0,
      rmse: 0,
      mape: 0,
      r2: 0,
      directionalAccuracy: 0,
      upAccuracy: 0,
      downAccuracy: 0,
      var95: 0,
      cvar95: 0,
      tailRatio: 0,
      stabilityScore: 0,
      consistencyScore: 0,
      outOfSamplePerformance: 0
    };
  }
  
  /**
   * Execute action in live environment
   */
  async act(features: FeatureSet): Promise<TradingAction> {
    if (!this.state.qNetwork || this.state.status !== ModelStatus.READY) {
      throw new MLError(
        MLErrorCode.MODEL_NOT_FOUND,
        'Model not ready for action'
      );
    }
    
    // Convert features to state tensor
    const state = await this.featuresToState(features);
    
    // Get Q-values
    const qValues = this.state.qNetwork.predict(state.expandDims(0)) as tf.Tensor;
    const actionIndex = await qValues.argMax(-1).data();
    
    // Decode action
    const action = this.decodeAction(actionIndex[0]);
    
    // Clean up
    state.dispose();
    qValues.dispose();
    
    return action;
  }
  
  /**
   * Convert features to state representation
   */
  private async featuresToState(features: FeatureSet): Promise<tf.Tensor> {
    const stateArray: number[] = [];
    
    // Add price features
    const pf = features.priceFeatures;
    stateArray.push(
      pf.returns1h,
      pf.returns4h,
      pf.returns1d,
      pf.realizedVol1h,
      pf.realizedVol24h,
      pf.bidAskSpread,
      pf.percentileRank
    );
    
    // Add volume features
    const vf = features.volumeFeatures;
    stateArray.push(
      vf.volumeRatio,
      vf.volumeImbalance,
      vf.orderFlowImbalance,
      vf.liquidityScore
    );
    
         // Add technical features     const techFeatures = features.technicalFeatures;     stateArray.push(       techFeatures.rsi[14] || 0,       techFeatures.macd.histogram,       techFeatures.bollingerBands.percentB,       techFeatures.adx     );
    
    // Add market features
    const mf = features.marketFeatures;
    stateArray.push(
      mf.trendStrength,
      mf.vix / 100,
      mf.correlations['SPY'] || 0
    );
    
    // Normalize and pad to state space size
    while (stateArray.length < this.stateSpace) {
      stateArray.push(0);
    }
    
    return tf.tensor1d(stateArray.slice(0, this.stateSpace));
  }
  
  /**
   * Get model performance
   */
  getPerformance(): ModelPerformance {
    // Update performance from episode rewards
    const rewards = this.state.episodeRewards;
    
    if (rewards.length > 0) {
      const avgReward = this.calculateAverageReward(100);
      const winRate = rewards.filter(r => r > 0).length / rewards.length;
      
      this.state.performance.sharpeRatio = this.calculateSharpeRatio(rewards);
      this.state.performance.winRate = winRate;
      this.state.performance.directionalAccuracy = winRate; // Simplified
    }
    
    return { ...this.state.performance };
  }
  
  /**
   * Clean up resources
   */
  dispose(): void {
    if (this.state.qNetwork) {
      this.state.qNetwork.dispose();
    }
    
    if (this.state.targetNetwork) {
      this.state.targetNetwork.dispose();
    }
    
    // Clean up replay buffer tensors
    this.state.replayBuffer.buffer.forEach(exp => {
      exp.state.dispose();
      exp.nextState.dispose();
    });
    
    this.removeAllListeners();
  }
} 