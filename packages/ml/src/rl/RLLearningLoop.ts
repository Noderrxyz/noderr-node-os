/**
 * RLLearningLoop - Reinforcement Learning for Trading Strategy Optimization
 * 
 * Implements online learning with PPO/DQN agents for continuous strategy improvement
 * with risk-aware exploration and real-time adaptation
 */

import { EventEmitter } from 'events';
import { Logger } from 'winston';
import * as tf from '@tensorflow/tfjs-node';
import { 
  MarketState, 
  RLAction, 
  RLAgent, 
  AgentPerformance,
  RewardFunction 
} from '@noderr/types';
import { PPOAgent } from './PPOAgent';
import { SharpeRewardFunction, RiskAdjustedRewardFunction } from './RewardFunctions';

interface RLConfig {
  algorithm: 'PPO' | 'DQN' | 'A3C' | 'SAC';
  learningRate: number;
  discountFactor: number;
  explorationRate: number;
  batchSize: number;
  memorySize: number;
  updateFrequency: number;
  targetUpdateFrequency: number;
  maxEpisodeLength: number;
  riskAwareness: {
    enabled: boolean;
    maxDrawdown: number;
    volatilityPenalty: number;
    positionLimitPenalty: number;
  };
}

interface Experience {
  state: MarketState;
  action: RLAction;
  reward: number;
  nextState: MarketState;
  done: boolean;
}

export class RLLearningLoop extends EventEmitter {
  private logger: Logger;
  private config: RLConfig;
  private agent: RLAgent;
  private rewardFunction: RewardFunction;
  private experienceBuffer: Experience[] = [];
  private episodeCount = 0;
  private stepCount = 0;
  private performanceHistory: AgentPerformance[] = [];
  private currentEpisodeRewards: number[] = [];
  private isTraining = false;
  
  constructor(logger: Logger, config: RLConfig) {
    super();
    this.logger = logger;
    this.config = config;
    
    // Initialize reward function
    this.rewardFunction = config.riskAwareness.enabled
      ? new RiskAdjustedRewardFunction(config.riskAwareness)
      : new SharpeRewardFunction();
    
    // Initialize agent based on algorithm
    this.agent = this.createAgent(config);
  }
  
  private createAgent(config: RLConfig): RLAgent {
    switch (config.algorithm) {
      case 'PPO':
        return new PPOAgent({
          stateSize: this.getStateSize(),
          actionSize: this.getActionSize(),
          learningRate: config.learningRate,
          clipEpsilon: 0.2,
          epochs: 10,
          miniBatchSize: 64
        });
      
      case 'DQN':
        // DQN implementation would go here
        throw new Error('DQN not yet implemented');
      
      case 'A3C':
        // A3C implementation would go here
        throw new Error('A3C not yet implemented');
      
      case 'SAC':
        // SAC implementation would go here
        throw new Error('SAC not yet implemented');
      
      default:
        throw new Error(`Unknown algorithm: ${config.algorithm}`);
    }
  }
  
  async initialize(): Promise<void> {
    this.logger.info('Initializing RL Learning Loop', {
      algorithm: this.config.algorithm,
      learningRate: this.config.learningRate
    });
    
    await this.agent.initialize();
    
    this.logger.info('RL Learning Loop initialized');
  }
  
  /**
   * Train the agent online with live market data
   */
  async trainOnline(marketState: MarketState): Promise<RLAction> {
    if (!this.isTraining) {
      this.isTraining = true;
    }
    
    // Select action based on current policy
    const action = await this.selectAction(marketState);
    
    // Store for experience replay
    if (this.stepCount > 0) {
      const prevExperience = this.experienceBuffer[this.experienceBuffer.length - 1];
      if (prevExperience && !prevExperience.done) {
        prevExperience.nextState = marketState;
        prevExperience.done = false;
      }
    }
    
    // Initialize new experience
    const experience: Experience = {
      state: marketState,
      action,
      reward: 0, // Will be updated when we get the next state
      nextState: marketState, // Placeholder
      done: false
    };
    
    this.experienceBuffer.push(experience);
    this.stepCount++;
    
    // Maintain buffer size
    if (this.experienceBuffer.length > this.config.memorySize) {
      this.experienceBuffer.shift();
    }
    
    // Update model periodically
    if (this.stepCount % this.config.updateFrequency === 0) {
      await this.updateModel();
    }
    
    // Emit action event
    this.emit('rl:action:taken', action);
    
    return action;
  }
  
  /**
   * Select action using epsilon-greedy or policy-based selection
   */
  private async selectAction(state: MarketState): Promise<RLAction> {
    // Convert state to tensor
    const stateTensor = this.stateToTensor(state);
    
    // Exploration vs exploitation
    if (Math.random() < this.config.explorationRate) {
      // Random exploration
      return this.getRandomAction(state);
    } else {
      // Use policy
      return await this.agent.selectAction(stateTensor, state);
    }
  }
  
  /**
   * Convert market state to tensor for neural network
   */
  private stateToTensor(state: MarketState): tf.Tensor {
    const features = [
      // Price features
      ...Object.values(state.prices).slice(0, 10),
      
      // Volume features
      ...Object.values(state.volumes).slice(0, 10),
      
      // Technical indicators
      ...Object.values(state.technicalIndicators).slice(0, 20),
      
      // Position information
      state.positions.length,
      state.accountBalance,
      
      // Sentiment scores
      ...Object.values(state.sentimentScores).slice(0, 5),
      
      // Custom features
      ...Object.values(state.customFeatures).slice(0, 10)
    ];
    
    // Normalize features
    const normalized = this.normalizeFeatures(features);
    
    return tf.tensor2d([normalized]);
  }
  
  /**
   * Normalize features to [-1, 1] range
   */
  private normalizeFeatures(features: number[]): number[] {
    // Simple min-max normalization
    // In production, use running statistics
    const min = Math.min(...features);
    const max = Math.max(...features);
    const range = max - min || 1;
    
    return features.map(f => (2 * (f - min) / range) - 1);
  }
  
  /**
   * Get random action for exploration
   */
  private getRandomAction(state: MarketState): RLAction {
    const actions: RLAction['type'][] = ['buy', 'sell', 'hold', 'close'];
    const symbols = Object.keys(state.prices);
    
    return {
      type: actions[Math.floor(Math.random() * actions.length)] ?? 'hold',
      symbol: symbols[Math.floor(Math.random() * symbols.length)] ?? 'BTC-USD',
      quantity: Math.random() * 0.1, // 0-10% of portfolio
      orderType: 'market',
      confidence: Math.random(),
      reasoning: 'Random exploration'
    };
  }
  
  /**
   * Update the model using experience replay
   */
  private async updateModel(): Promise<void> {
    if (this.experienceBuffer.length < this.config.batchSize) {
      return;
    }
    
    this.logger.debug('Updating RL model', {
      bufferSize: this.experienceBuffer.length,
      stepCount: this.stepCount
    });
    
    // Sample batch from experience buffer
    const batch = this.sampleBatch(this.config.batchSize);
    
    // Prepare training data
    const states: number[][] = [];
    const actions: number[][] = [];
    const rewards: number[] = [];
    const nextStates: number[][] = [];
    const dones: boolean[] = [];
    
    for (const exp of batch) {
      states.push(this.normalizeFeatures(this.stateToArray(exp.state)));
      actions.push(this.actionToVector(exp.action));
      rewards.push(exp.reward);
      nextStates.push(this.normalizeFeatures(this.stateToArray(exp.nextState)));
      dones.push(exp.done);
    }
    
    // Update agent
    await this.agent.update(
      tf.tensor2d(states),
      tf.tensor2d(actions),
      tf.tensor1d(rewards),
      tf.tensor2d(nextStates),
      tf.tensor1d(dones.map(d => d ? 1 : 0))
    );
    
    // Decay exploration rate
    this.config.explorationRate *= 0.995;
    this.config.explorationRate = Math.max(0.01, this.config.explorationRate);
  }
  
  /**
   * Sample random batch from experience buffer
   */
  private sampleBatch(size: number): Experience[] {
    const batch: Experience[] = [];
    const indices = new Set<number>();
    
    while (indices.size < size) {
      indices.add(Math.floor(Math.random() * this.experienceBuffer.length));
    }
    
    for (const idx of indices) {
      const exp = this.experienceBuffer[idx];
      if (exp) {
        batch.push(exp);
      }
    }
    
    return batch;
  }
  
  /**
   * Convert state to array for training
   */
  private stateToArray(state: MarketState): number[] {
    return [
      ...Object.values(state.prices).slice(0, 10),
      ...Object.values(state.volumes).slice(0, 10),
      ...Object.values(state.technicalIndicators).slice(0, 20),
      state.positions.length,
      state.accountBalance,
      ...Object.values(state.sentimentScores).slice(0, 5),
      ...Object.values(state.customFeatures).slice(0, 10)
    ];
  }
  
  /**
   * Convert action to one-hot vector
   */
  private actionToVector(action: RLAction): number[] {
    const actionTypes = ['buy', 'sell', 'hold', 'close'];
    const vector = new Array(actionTypes.length + 3).fill(0);
    
    // One-hot encode action type
    const typeIndex = actionTypes.indexOf(action.type);
    if (typeIndex >= 0) {
      vector[typeIndex] = 1;
    }
    
    // Add continuous values
    vector[actionTypes.length] = action.quantity;
    vector[actionTypes.length + 1] = action.confidence;
    vector[actionTypes.length + 2] = action.orderType === 'limit' ? 1 : 0;
    
    return vector;
  }
  
  /**
   * Complete an episode and calculate rewards
   */
  async completeEpisode(finalState: MarketState, totalPnL: number): Promise<void> {
    this.episodeCount++;
    
    // Calculate final rewards for all experiences in this episode
    const episodeReturn = this.calculateEpisodeRewards(totalPnL);
    
    // Update agent performance
    const performance: AgentPerformance = {
      episode: this.episodeCount,
      totalReward: episodeReturn,
      sharpeRatio: this.calculateSharpe(this.currentEpisodeRewards),
      winRate: this.calculateWinRate(),
      avgDrawdown: this.calculateAvgDrawdown(),
      actions: this.currentEpisodeRewards.length
    };
    
    this.performanceHistory.push(performance);
    
    // Emit episode complete event
    this.emit('rl:episode:complete', performance);
    
    // Reset episode
    this.currentEpisodeRewards = [];
    
    // Log performance
    this.logger.info('RL Episode completed', {
      episode: this.episodeCount,
      totalReward: episodeReturn,
      sharpeRatio: performance.sharpeRatio
    });
  }
  
  /**
   * Calculate rewards for all experiences in an episode
   */
  private calculateEpisodeRewards(totalPnL: number): number {
    let totalReward = 0;
    
    // Backward pass to assign rewards
    for (let i = this.experienceBuffer.length - 1; i >= 0; i--) {
      const exp = this.experienceBuffer[i];
      if (!exp) continue;
      
      // Calculate immediate reward
      const immediateReward = this.rewardFunction.calculate(
        exp.state,
        exp.action,
        exp.nextState
      );
      
      // Add episode-end bonus/penalty
      if (i === this.experienceBuffer.length - 1) {
        exp.reward = immediateReward + (totalPnL > 0 ? 1 : -1);
        exp.done = true;
      } else {
        exp.reward = immediateReward;
      }
      
      totalReward += exp.reward;
      this.currentEpisodeRewards.push(exp.reward);
    }
    
    return totalReward;
  }
  
  /**
   * Calculate Sharpe ratio from rewards
   */
  private calculateSharpe(rewards: number[]): number {
    if (rewards.length < 2) return 0;
    
    const mean = rewards.reduce((a, b) => a + b, 0) / rewards.length;
    const variance = rewards.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / rewards.length;
    const std = Math.sqrt(variance);
    
    return std > 0 ? mean / std * Math.sqrt(252) : 0; // Annualized
  }
  
  /**
   * Calculate win rate from recent actions
   */
  private calculateWinRate(): number {
    const recentRewards = this.currentEpisodeRewards.slice(-100);
    const wins = recentRewards.filter(r => r > 0).length;
    return recentRewards.length > 0 ? wins / recentRewards.length : 0;
  }
  
  /**
   * Calculate average drawdown
   */
  private calculateAvgDrawdown(): number {
    const values = this.currentEpisodeRewards;
    if (values.length < 2) return 0;
    
    let maxValue = values[0];
    let maxDrawdown = 0;
    let currentDrawdown = 0;
    
    for (let i = 1; i < values.length; i++) {
      const cumValue = values.slice(0, i + 1).reduce((a, b) => a + b, 0);
      
      if (cumValue > maxValue) {
        maxValue = cumValue;
        currentDrawdown = 0;
      } else {
        currentDrawdown = (maxValue - cumValue) / Math.abs(maxValue);
        maxDrawdown = Math.max(maxDrawdown, currentDrawdown);
      }
    }
    
    return maxDrawdown;
  }
  
  /**
   * Get agent performance metrics
   */
  getPerformance(): AgentPerformance | null {
    return this.performanceHistory.length > 0
      ? this.performanceHistory[this.performanceHistory.length - 1]
      : null;
  }
  
  /**
   * Get state and action space sizes
   */
  private getStateSize(): number {
    // Prices(10) + Volumes(10) + Indicators(20) + Position(2) + Sentiment(5) + Custom(10)
    return 57;
  }
  
  private getActionSize(): number {
    // Action types(4) + Quantity + Confidence + OrderType
    return 7;
  }
  
  /**
   * Save agent model
   */
  async saveModel(path: string): Promise<void> {
    await this.agent.save(path);
    this.logger.info('RL model saved', { path });
  }
  
  /**
   * Load agent model
   */
  async loadModel(path: string): Promise<void> {
    await this.agent.load(path);
    this.logger.info('RL model loaded', { path });
  }
  
  /**
   * Get training statistics
   */
  getStats() {
    return {
      episodeCount: this.episodeCount,
      stepCount: this.stepCount,
      explorationRate: this.config.explorationRate,
      bufferSize: this.experienceBuffer.length,
      avgReward: this.performanceHistory.length > 0
        ? this.performanceHistory.reduce((a, b) => a + b.totalReward, 0) / this.performanceHistory.length
        : 0,
      bestSharpe: Math.max(...this.performanceHistory.map(p => p.sharpeRatio), 0)
    };
  }
  
  async stop(): Promise<void> {
    this.logger.info('Stopping RL Learning Loop');
    this.isTraining = false;
    
    // Save final model
    await this.saveModel('./models/rl_final.json');
    
    // Clear buffers
    this.experienceBuffer = [];
    this.currentEpisodeRewards = [];
  }
} 