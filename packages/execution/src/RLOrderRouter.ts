import * as tf from '@tensorflow/tfjs-node-gpu';
import { EventEmitter } from 'events';
import * as winston from 'winston';

/**
 * Market state for RL decision making
 */
export interface MarketState {
  // Order book features
  bidAskSpread: number;
  bidDepth: number;
  askDepth: number;
  orderBookImbalance: number;
  
  // Market microstructure
  volatility: number;
  volume: number;
  vwap: number;
  
  // Venue-specific features
  venueLatency: number[];
  venueFees: number[];
  venueReliability: number[];
  
  // Order features
  orderSize: number;
  orderUrgency: number;
  remainingTime: number;
}

/**
 * Action space for order routing
 */
export interface RoutingAction {
  venueAllocations: number[]; // Percentage allocation to each venue
  orderType: 'market' | 'limit' | 'iceberg';
  aggressiveness: number; // 0-1, affects limit price
  timeSlicing: number; // Number of slices for TWAP
}

/**
 * Execution result for reward calculation
 */
export interface ExecutionResult {
  executedPrice: number;
  executedQuantity: number;
  fees: number;
  slippage: number;
  executionTimeMs: number;
  venue: string;
}

/**
 * RL configuration
 */
export interface RLConfig {
  stateSize: number;
  actionSize: number;
  learningRate: number;
  discountFactor: number;
  epsilon: number;
  epsilonDecay: number;
  epsilonMin: number;
  replayBufferSize: number;
  batchSize: number;
  updateFrequency: number;
  targetUpdateFrequency: number;
}

/**
 * Experience replay buffer entry
 */
interface Experience {
  state: tf.Tensor;
  action: tf.Tensor;
  reward: number;
  nextState: tf.Tensor;
  done: boolean;
}

/**
 * Reinforcement Learning Order Router using Deep Q-Network
 */
export class RLOrderRouter extends EventEmitter {
  private config: RLConfig;
  private logger: winston.Logger;
  private qNetwork: tf.Sequential | null = null;
  private targetNetwork: tf.Sequential | null = null;
  private optimizer: tf.Optimizer;
  private replayBuffer: Experience[] = [];
  private epsilon: number;
  private stepCount: number = 0;
  private episodeCount: number = 0;
  
  constructor(config: RLConfig, logger: winston.Logger) {
    super();
    
    this.config = config;
    this.logger = logger;
    this.epsilon = config.epsilon;
    this.optimizer = tf.train.adam(config.learningRate);
    
    this.initializeNetworks();
  }
  
  /**
   * Initialize Q-network and target network
   */
  private initializeNetworks(): void {
    // Q-Network architecture
    this.qNetwork = tf.sequential({
      layers: [
        // Input layer
        tf.layers.dense({
          inputShape: [this.config.stateSize],
          units: 256,
          activation: 'relu',
          kernelInitializer: 'heNormal'
        }),
        tf.layers.batchNormalization(),
        tf.layers.dropout({ rate: 0.1 }),
        
        // Hidden layers
        tf.layers.dense({
          units: 128,
          activation: 'relu',
          kernelInitializer: 'heNormal'
        }),
        tf.layers.batchNormalization(),
        tf.layers.dropout({ rate: 0.1 }),
        
        tf.layers.dense({
          units: 64,
          activation: 'relu',
          kernelInitializer: 'heNormal'
        }),
        
        // Output layer (Q-values for each action)
        tf.layers.dense({
          units: this.config.actionSize,
          activation: 'linear'
        })
      ]
    });
    
    // Target network (copy of Q-network)
    this.targetNetwork = tf.sequential();
    
    // Copy architecture from Q-network
    for (const layer of this.qNetwork.layers) {
      const config = layer.getConfig();
      const className = layer.getClassName();
      
      // Create new layer based on class name
      let newLayer;
      switch (className) {
        case 'Dense':
          newLayer = tf.layers.dense(config as any);
          break;
        case 'BatchNormalization':
          newLayer = tf.layers.batchNormalization(config as any);
          break;
        case 'Dropout':
          newLayer = tf.layers.dropout(config as any);
          break;
        default:
          throw new Error(`Unknown layer type: ${className}`);
      }
      
      this.targetNetwork.add(newLayer);
    }
    
    // Copy weights to target network
    this.updateTargetNetwork();
    
    this.logger.info('RL networks initialized', {
      stateSize: this.config.stateSize,
      actionSize: this.config.actionSize
    });
  }
  
  /**
   * Select action using epsilon-greedy policy
   */
  async selectAction(state: MarketState): Promise<RoutingAction> {
    const stateTensor = this.preprocessState(state);
    
    try {
      // Epsilon-greedy action selection
      if (Math.random() < this.epsilon) {
        // Explore: random action
        return this.generateRandomAction();
      } else {
        // Exploit: use Q-network
        const qValues = this.qNetwork!.predict(stateTensor) as tf.Tensor;
        const qArray = await qValues.array() as number[][];
        const actionIndex = qArray[0].indexOf(Math.max(...qArray[0]));
        
        qValues.dispose();
        return this.decodeAction(actionIndex);
      }
    } finally {
      stateTensor.dispose();
    }
  }
  
  /**
   * Train the network on a batch of experiences
   */
  async train(): Promise<void> {
    if (this.replayBuffer.length < this.config.batchSize) {
      return;
    }
    
    // Sample batch from replay buffer
    const batch = this.sampleBatch();
    
    // Prepare tensors
    const states = tf.stack(batch.map(e => e.state));
    const actions = tf.stack(batch.map(e => e.action));
    const rewards = tf.tensor1d(batch.map(e => e.reward));
    const nextStates = tf.stack(batch.map(e => e.nextState));
    const dones = tf.tensor1d(batch.map(e => e.done ? 1 : 0));
    
    // Calculate target Q-values
    const targetQValues = this.targetNetwork!.predict(nextStates) as tf.Tensor;
    const maxTargetQ = targetQValues.max(1);
    const targets = rewards.add(
      maxTargetQ.mul(this.config.discountFactor).mul(tf.scalar(1).sub(dones))
    );
    
    // Train Q-network
    const loss = await this.optimizer.minimize(() => {
      const predictions = this.qNetwork!.predict(states) as tf.Tensor;
      const qValues = predictions.gather(actions.argMax(1), 1);
      return qValues.sub(targets).square().mean();
    });
    
    // Clean up tensors
    states.dispose();
    actions.dispose();
    rewards.dispose();
    nextStates.dispose();
    dones.dispose();
    targetQValues.dispose();
    maxTargetQ.dispose();
    targets.dispose();
    
    // Update target network periodically
    if (this.stepCount % this.config.targetUpdateFrequency === 0) {
      this.updateTargetNetwork();
    }
    
    // Decay epsilon
    this.epsilon = Math.max(
      this.config.epsilonMin,
      this.epsilon * this.config.epsilonDecay
    );
    
    this.stepCount++;
    
    // Emit training progress
    const lossValue = loss ? await loss.data() : null;
    this.emit('trainingStep', {
      step: this.stepCount,
      loss: lossValue,
      epsilon: this.epsilon,
      bufferSize: this.replayBuffer.length
    });
  }
  
  /**
   * Store experience in replay buffer
   */
  storeExperience(
    state: MarketState,
    action: RoutingAction,
    reward: number,
    nextState: MarketState,
    done: boolean
  ): void {
    const experience: Experience = {
      state: this.preprocessState(state),
      action: this.encodeAction(action),
      reward,
      nextState: this.preprocessState(nextState),
      done
    };
    
    this.replayBuffer.push(experience);
    
    // Maintain buffer size
    if (this.replayBuffer.length > this.config.replayBufferSize) {
      const old = this.replayBuffer.shift()!;
      old.state.dispose();
      old.action.dispose();
      old.nextState.dispose();
    }
    
    // Train if it's time
    if (this.stepCount % this.config.updateFrequency === 0) {
      this.train().catch(err => {
        this.logger.error('Training error', err);
      });
    }
  }
  
  /**
   * Calculate reward from execution result
   */
  calculateReward(
    result: ExecutionResult,
    benchmarkPrice: number,
    targetQuantity: number
  ): number {
    // Components of reward
    const slippageReward = -Math.abs(result.slippage) * 100; // Penalize slippage
    const fillRateReward = (result.executedQuantity / targetQuantity) * 10; // Reward fill rate
    const feeReward = -result.fees * 1000; // Penalize fees
    const speedReward = Math.max(0, 100 - result.executionTimeMs) / 100; // Reward speed
    
    // Price improvement reward
    const priceImprovement = benchmarkPrice - result.executedPrice;
    const priceReward = priceImprovement * result.executedQuantity * 100;
    
    const totalReward = slippageReward + fillRateReward + feeReward + speedReward + priceReward;
    
    return totalReward;
  }
  
  /**
   * Preprocess market state into tensor
   */
  private preprocessState(state: MarketState): tf.Tensor {
    const features = [
      // Normalize features to [0, 1] or [-1, 1]
      state.bidAskSpread / 0.001, // Normalize by typical spread
      state.bidDepth / 1000000,    // Normalize by typical depth
      state.askDepth / 1000000,
      state.orderBookImbalance,    // Already in [-1, 1]
      state.volatility / 0.01,     // Normalize by typical volatility
      state.volume / 1000000,      // Normalize by typical volume
      state.vwap / 100000,         // Normalize by typical price
      ...state.venueLatency.map(l => l / 100),    // Normalize by 100ms
      ...state.venueFees.map(f => f / 0.001),     // Normalize by typical fee
      ...state.venueReliability,                   // Already in [0, 1]
      state.orderSize / 10000,     // Normalize by typical order size
      state.orderUrgency,          // Already in [0, 1]
      state.remainingTime / 3600   // Normalize by 1 hour
    ];
    
    return tf.tensor2d([features]);
  }
  
  /**
   * Generate random action for exploration
   */
  private generateRandomAction(): RoutingAction {
    const numVenues = 3; // Assuming 3 venues
    const allocations = Array(numVenues).fill(0).map(() => Math.random());
    const sum = allocations.reduce((a, b) => a + b, 0);
    
    return {
      venueAllocations: allocations.map(a => a / sum), // Normalize to sum to 1
      orderType: ['market', 'limit', 'iceberg'][Math.floor(Math.random() * 3)] as any,
      aggressiveness: Math.random(),
      timeSlicing: Math.floor(Math.random() * 10) + 1
    };
  }
  
  /**
   * Encode action as tensor
   */
  private encodeAction(action: RoutingAction): tf.Tensor {
    const encoded = [
      ...action.venueAllocations,
      action.orderType === 'market' ? 1 : 0,
      action.orderType === 'limit' ? 1 : 0,
      action.orderType === 'iceberg' ? 1 : 0,
      action.aggressiveness,
      action.timeSlicing / 10 // Normalize
    ];
    
    return tf.tensor2d([encoded]);
  }
  
  /**
   * Decode action index to routing action
   */
  private decodeAction(actionIndex: number): RoutingAction {
    // Simple discretization of action space
    const numVenues = 3;
    const venueIndex = actionIndex % numVenues;
    const orderTypeIndex = Math.floor(actionIndex / numVenues) % 3;
    const aggressivenessIndex = Math.floor(actionIndex / (numVenues * 3)) % 5;
    
    // Create allocation with majority to selected venue
    const allocations = Array(numVenues).fill(0.1);
    allocations[venueIndex] = 0.8;
    
    return {
      venueAllocations: allocations,
      orderType: ['market', 'limit', 'iceberg'][orderTypeIndex] as any,
      aggressiveness: aggressivenessIndex / 4, // 0, 0.25, 0.5, 0.75, 1
      timeSlicing: 1 // Simple for now
    };
  }
  
  /**
   * Sample batch from replay buffer
   */
  private sampleBatch(): Experience[] {
    const batch: Experience[] = [];
    const indices = new Set<number>();
    
    while (indices.size < this.config.batchSize) {
      indices.add(Math.floor(Math.random() * this.replayBuffer.length));
    }
    
    indices.forEach(i => batch.push(this.replayBuffer[i]));
    return batch;
  }
  
  /**
   * Update target network with Q-network weights
   */
  private updateTargetNetwork(): void {
    if (!this.qNetwork || !this.targetNetwork) return;
    
    const qWeights = this.qNetwork.getWeights();
    this.targetNetwork.setWeights(qWeights);
    
    this.logger.debug('Target network updated');
  }
  
  /**
   * Save model to disk
   */
  async saveModel(path: string): Promise<void> {
    if (!this.qNetwork) return;
    
    await this.qNetwork.save(`file://${path}`);
    this.logger.info('Model saved', { path });
  }
  
  /**
   * Load model from disk
   */
  async loadModel(path: string): Promise<void> {
    this.qNetwork = await tf.loadLayersModel(`file://${path}`) as tf.Sequential;
    this.updateTargetNetwork();
    this.logger.info('Model loaded', { path });
  }
  
  /**
   * Get current performance metrics
   */
  getMetrics(): RLMetrics {
    return {
      stepCount: this.stepCount,
      episodeCount: this.episodeCount,
      epsilon: this.epsilon,
      bufferSize: this.replayBuffer.length,
      bufferCapacity: this.config.replayBufferSize
    };
  }
  
  /**
   * Cleanup resources
   */
  dispose(): void {
    // Dispose tensors in replay buffer
    for (const exp of this.replayBuffer) {
      exp.state.dispose();
      exp.action.dispose();
      exp.nextState.dispose();
    }
    this.replayBuffer = [];
    
    // Dispose networks
    if (this.qNetwork) {
      this.qNetwork.dispose();
    }
    if (this.targetNetwork) {
      this.targetNetwork.dispose();
    }
  }
}

/**
 * RL performance metrics
 */
export interface RLMetrics {
  stepCount: number;
  episodeCount: number;
  epsilon: number;
  bufferSize: number;
  bufferCapacity: number;
} 