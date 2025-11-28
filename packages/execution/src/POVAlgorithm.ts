import {
  Order,
  AlgorithmConfig,
  AlgorithmParameters,
  ExecutionResult,
  ExecutionStatus,
  Fill,
  ExecutedRoute,
  ExecutionPerformance,
  OrderSide,
  OrderType,
  TimeInForce,
  OrderStatus,
  ExecutionError,
  ExecutionErrorCode
} from '@noderr/types';
import { Logger } from 'winston';
import EventEmitter from 'events';

interface POVState {
  orderId: string;
  totalQuantity: number;
  executedQuantity: number;
  remainingQuantity: number;
  targetPercentage: number;
  maxPercentage: number;
  adaptiveMode: boolean;
  volumeTracking: VolumeTracking;
  fills: Fill[];
  status: ExecutionStatus;
  startTime: number;
  endTime?: number;
  currentParticipation: number;
  executionHistory: ExecutionSnapshot[];
}

interface VolumeTracking {
  marketVolume: number;
  ourVolume: number;
  participationRate: number;
  volumeHistory: VolumePoint[];
  movingAverage: number;
  volatility: number;
}

interface VolumePoint {
  timestamp: number;
  marketVolume: number;
  ourVolume: number;
  price: number;
}

interface ExecutionSnapshot {
  timestamp: number;
  quantity: number;
  participationRate: number;
  marketVolume: number;
  price: number;
  impact: number;
}

interface POVMetrics {
  targetParticipation: number;
  actualParticipation: number;
  volumeExecuted: number;
  marketVolumeTracked: number;
  completionPercentage: number;
  averageParticipation: number;
  maxParticipation: number;
  minParticipation: number;
  impactCost: number;
}

export class POVAlgorithm extends EventEmitter {
  private logger: Logger;
  private activeOrders: Map<string, POVState>;
  private volumeMonitor?: NodeJS.Timeout;
  private executionLoop?: NodeJS.Timeout;
  private adaptiveAdjuster?: NodeJS.Timeout;
  private volumeBuffer: Map<string, VolumePoint[]>;

  constructor(logger: Logger) {
    super();
    this.logger = logger;
    this.activeOrders = new Map();
    this.volumeBuffer = new Map();
    
    // Start monitoring loops
    this.startVolumeMonitoring();
    this.startExecutionLoop();
    this.startAdaptiveAdjustment();
  }

  /**
   * Execute order using POV algorithm
   */
  async execute(
    order: Order,
    config: AlgorithmConfig,
    router: any
  ): Promise<void> {
    this.logger.info('Starting POV execution', {
      orderId: order.id,
      quantity: order.quantity,
      targetPercentage: config.parameters.targetPercentage,
      maxPercentage: config.parameters.maxPercentage
    });

    // Validate parameters
    this.validateParameters(config.parameters);
    
    // Initialize POV state
    const state = this.initializePOVState(order, config.parameters);
    this.activeOrders.set(order.id, state);
    
    // Initialize volume tracking for symbol
    if (!this.volumeBuffer.has(order.symbol)) {
      this.volumeBuffer.set(order.symbol, []);
    }
    
    // Emit start event
    this.emit('executionStarted', {
      orderId: order.id,
      algorithm: 'POV',
      parameters: config.parameters
    });
  }

  /**
   * Get current execution status
   */
  getExecutionStatus(orderId: string): POVState | null {
    return this.activeOrders.get(orderId) || null;
  }

  /**
   * Get execution metrics
   */
  getMetrics(orderId: string): POVMetrics | null {
    const state = this.activeOrders.get(orderId);
    if (!state) return null;
    
    return this.calculateMetrics(state);
  }

  /**
   * Update market volume data
   */
  updateMarketVolume(symbol: string, volume: number, price: number): void {
    const point: VolumePoint = {
      timestamp: Date.now(),
      marketVolume: volume,
      ourVolume: 0,
      price
    };
    
    const buffer = this.volumeBuffer.get(symbol) || [];
    buffer.push(point);
    
    // Keep only recent data (last 1000 points)
    if (buffer.length > 1000) {
      buffer.shift();
    }
    
    this.volumeBuffer.set(symbol, buffer);
    
    // Update active orders tracking this symbol
    this.updateActiveOrdersVolume(symbol, volume);
  }

  // Private methods

  private validateParameters(params: AlgorithmParameters): void {
    if (!params.targetPercentage || params.targetPercentage <= 0 || params.targetPercentage > 100) {
      throw new ExecutionError(
        ExecutionErrorCode.INVALID_ORDER,
        'Invalid target percentage (must be 0-100)'
      );
    }
    
    if (params.maxPercentage && params.maxPercentage < params.targetPercentage) {
      throw new ExecutionError(
        ExecutionErrorCode.INVALID_ORDER,
        'Max percentage must be >= target percentage'
      );
    }
  }

  private initializePOVState(
    order: Order,
    params: AlgorithmParameters
  ): POVState {
    const targetPercentage = params.targetPercentage || 10;
    const maxPercentage = params.maxPercentage || Math.min(targetPercentage * 1.5, 50);
    
    return {
      orderId: order.id,
      totalQuantity: order.quantity,
      executedQuantity: 0,
      remainingQuantity: order.quantity,
      targetPercentage: targetPercentage / 100,
      maxPercentage: maxPercentage / 100,
      adaptiveMode: params.adaptiveMode !== false,
      volumeTracking: {
        marketVolume: 0,
        ourVolume: 0,
        participationRate: 0,
        volumeHistory: [],
        movingAverage: 0,
        volatility: 0
      },
      fills: [],
      status: ExecutionStatus.PARTIAL,
      startTime: Date.now(),
      currentParticipation: 0,
      executionHistory: []
    };
  }

  private startVolumeMonitoring(): void {
    this.volumeMonitor = setInterval(() => {
      this.updateVolumeTracking();
    }, 1000); // Update every second
  }

  private startExecutionLoop(): void {
    this.executionLoop = setInterval(() => {
      this.processActiveOrders();
    }, 100); // Check every 100ms for tight control
  }

  private startAdaptiveAdjustment(): void {
    this.adaptiveAdjuster = setInterval(() => {
      this.performAdaptiveAdjustments();
    }, 5000); // Adjust every 5 seconds
  }

  private updateVolumeTracking(): void {
    // Simulate volume updates for active symbols
    for (const [symbol, buffer] of this.volumeBuffer) {
      const recentVolume = this.calculateRecentVolume(buffer);
      const price = buffer[buffer.length - 1]?.price || 50000;
      
      // Simulate new volume
      const newVolume = 100 + Math.random() * 500;
      this.updateMarketVolume(symbol, newVolume, price);
    }
  }

  private calculateRecentVolume(buffer: VolumePoint[]): number {
    const oneMinuteAgo = Date.now() - 60000;
    const recentPoints = buffer.filter(p => p.timestamp > oneMinuteAgo);
    return recentPoints.reduce((sum, p) => sum + p.marketVolume, 0);
  }

  private updateActiveOrdersVolume(symbol: string, volume: number): void {
    for (const [orderId, state] of this.activeOrders) {
      // Check if order is for this symbol (would need symbol in state)
      state.volumeTracking.marketVolume += volume;
      
      // Update moving average
      const history = state.volumeTracking.volumeHistory;
      history.push({
        timestamp: Date.now(),
        marketVolume: volume,
        ourVolume: 0,
        price: 50000 // Would get from market data
      });
      
      // Keep last 100 points
      if (history.length > 100) {
        history.shift();
      }
      
      // Calculate moving average and volatility
      this.updateVolumeStatistics(state.volumeTracking);
    }
  }

  private updateVolumeStatistics(tracking: VolumeTracking): void {
    const history = tracking.volumeHistory;
    if (history.length < 2) return;
    
    // Calculate moving average
    const volumes = history.map(h => h.marketVolume);
    tracking.movingAverage = volumes.reduce((a, b) => a + b, 0) / volumes.length;
    
    // Calculate volatility
    const mean = tracking.movingAverage;
    const variance = volumes.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / volumes.length;
    tracking.volatility = Math.sqrt(variance) / mean;
    
    // Update participation rate
    tracking.participationRate = tracking.ourVolume / tracking.marketVolume;
  }

  private async processActiveOrders(): Promise<void> {
    for (const [orderId, state] of this.activeOrders) {
      if (state.status !== ExecutionStatus.PARTIAL) {
        continue;
      }
      
      // Check if we should execute
      if (this.shouldExecute(state)) {
        await this.executeSlice(orderId, state);
      }
      
      // Check completion
      if (state.executedQuantity >= state.totalQuantity * 0.99) {
        this.completeExecution(orderId);
      }
    }
  }

  private shouldExecute(state: POVState): boolean {
    // Don't execute if no recent volume
    if (state.volumeTracking.volumeHistory.length === 0) {
      return false;
    }
    
    // Calculate current participation rate
    const recentVolume = this.getRecentMarketVolume(state);
    const ourRecentVolume = this.getOurRecentVolume(state);
    const currentRate = recentVolume > 0 ? ourRecentVolume / recentVolume : 0;
    
    // Execute if below target participation
    return currentRate < state.targetPercentage;
  }

  private getRecentMarketVolume(state: POVState): number {
    const fiveSecondsAgo = Date.now() - 5000;
    const recent = state.volumeTracking.volumeHistory.filter(
      h => h.timestamp > fiveSecondsAgo
    );
    return recent.reduce((sum, h) => sum + h.marketVolume, 0);
  }

  private getOurRecentVolume(state: POVState): number {
    const fiveSecondsAgo = Date.now() - 5000;
    const recent = state.executionHistory.filter(
      h => h.timestamp > fiveSecondsAgo
    );
    return recent.reduce((sum, h) => sum + h.quantity, 0);
  }

  private async executeSlice(orderId: string, state: POVState): Promise<void> {
    try {
      // Calculate execution size
      const size = this.calculateExecutionSize(state);
      
      if (size < 0.0001) {
        return; // Too small to execute
      }
      
      // Create child order
      const childOrder = this.createChildOrder(orderId, size);
      
      // Execute (mock)
      const fill = await this.executeChildOrder(childOrder);
      
      // Update state
      state.executedQuantity += fill.quantity;
      state.remainingQuantity -= fill.quantity;
      state.fills.push(fill);
      
      // Update volume tracking
      state.volumeTracking.ourVolume += fill.quantity;
      const history = state.volumeTracking.volumeHistory;
      if (history.length > 0) {
        history[history.length - 1].ourVolume += fill.quantity;
      }
      
      // Record execution snapshot
      const snapshot: ExecutionSnapshot = {
        timestamp: Date.now(),
        quantity: fill.quantity,
        participationRate: this.calculateCurrentParticipation(state),
        marketVolume: state.volumeTracking.marketVolume,
        price: fill.price,
        impact: this.estimateMarketImpact(fill.quantity, state)
      };
      
      state.executionHistory.push(snapshot);
      state.currentParticipation = snapshot.participationRate;
      
      // Emit progress
      this.emit('sliceExecuted', {
        orderId,
        fill,
        metrics: this.calculateMetrics(state)
      });
      
    } catch (error) {
      this.logger.error('POV slice execution failed', { orderId, error });
    }
  }

  private calculateExecutionSize(state: POVState): number {
    // Get recent market volume rate (per second)
    const recentVolume = this.getRecentMarketVolume(state);
    const volumeRate = recentVolume / 5; // 5 second window
    
    // Calculate target execution rate
    const targetRate = volumeRate * state.targetPercentage;
    
    // Adjust for remaining quantity
    const maxSize = state.remainingQuantity;
    let size = Math.min(targetRate * 0.1, maxSize); // Execute for next 100ms
    
    // Apply adaptive adjustments
    if (state.adaptiveMode) {
      size = this.applyAdaptiveAdjustments(size, state);
    }
    
    // Apply max percentage constraint
    const maxAllowed = volumeRate * state.maxPercentage * 0.1;
    size = Math.min(size, maxAllowed);
    
    return size;
  }

  private applyAdaptiveAdjustments(size: number, state: POVState): number {
    // Increase size if we're behind schedule
    const elapsed = Date.now() - state.startTime;
    const expectedProgress = Math.min(1, elapsed / (8 * 3600000)); // Assume 8 hour day
    const actualProgress = state.executedQuantity / state.totalQuantity;
    
    if (actualProgress < expectedProgress * 0.9) {
      // Behind schedule - increase size
      size *= 1.2;
    } else if (actualProgress > expectedProgress * 1.1) {
      // Ahead of schedule - decrease size
      size *= 0.8;
    }
    
    // Adjust based on volatility
    if (state.volumeTracking.volatility > 0.3) {
      // High volatility - be more conservative
      size *= 0.9;
    }
    
    // Adjust based on recent impact
    const recentImpact = this.getRecentMarketImpact(state);
    if (recentImpact > 0.001) { // 10 bps
      size *= 0.8; // Reduce size if causing impact
    }
    
    return size;
  }

  private getRecentMarketImpact(state: POVState): number {
    const recentSnapshots = state.executionHistory.slice(-10);
    if (recentSnapshots.length === 0) return 0;
    
    const avgImpact = recentSnapshots.reduce((sum, s) => sum + s.impact, 0) / recentSnapshots.length;
    return avgImpact;
  }

  private estimateMarketImpact(quantity: number, state: POVState): number {
    // Simple impact model
    const participation = quantity / (state.volumeTracking.movingAverage || 1000);
    return participation * 0.0001; // 1 bp per 100% participation
  }

  private calculateCurrentParticipation(state: POVState): number {
    const marketVolume = state.volumeTracking.marketVolume;
    const ourVolume = state.volumeTracking.ourVolume;
    
    return marketVolume > 0 ? ourVolume / marketVolume : 0;
  }

  private createChildOrder(parentOrderId: string, quantity: number): Order {
    return {
      id: `${parentOrderId}-pov-${Date.now()}`,
      clientOrderId: `pov-${parentOrderId}-${Date.now()}`,
      symbol: 'BTC/USDT',
      side: OrderSide.BUY,
      type: OrderType.MARKET,
      quantity,
      timeInForce: TimeInForce.IOC,
      status: OrderStatus.NEW,
      exchange: 'best',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: {
        algorithm: 'POV',
        parentOrder: parentOrderId,
        urgency: 'medium'
      }
    };
  }

  private async executeChildOrder(order: Order): Promise<Fill> {
    // Mock execution
    await new Promise(resolve => setTimeout(resolve, 50));
    
    return {
      id: `fill-${Date.now()}`,
      orderId: order.id,
      exchange: 'binance',
      price: 50000 + Math.random() * 100,
      quantity: order.quantity,
      fee: order.quantity * 50000 * 0.0001,
      timestamp: Date.now(),
      side: order.side,
      liquidity: 'taker',
      tradeId: `trade-${Date.now()}`
    };
  }

  private performAdaptiveAdjustments(): void {
    for (const [orderId, state] of this.activeOrders) {
      if (!state.adaptiveMode || state.status !== ExecutionStatus.PARTIAL) {
        continue;
      }
      
      const metrics = this.calculateMetrics(state);
      
      // Adjust target percentage if needed
      if (metrics.actualParticipation > metrics.targetParticipation * 1.2) {
        // Participating too much - might be in thin market
        state.targetPercentage = Math.max(0.01, state.targetPercentage * 0.9);
        this.logger.info('Reduced POV target due to thin market', {
          orderId,
          newTarget: state.targetPercentage
        });
      }
      
      // Check if we need to be more aggressive
      const timeRemaining = this.estimateTimeRemaining(state);
      if (timeRemaining < 3600000 && state.remainingQuantity > state.totalQuantity * 0.5) {
        // Less than 1 hour left with >50% remaining
        state.targetPercentage = Math.min(
          state.maxPercentage,
          state.targetPercentage * 1.2
        );
        this.logger.info('Increased POV target due to time pressure', {
          orderId,
          newTarget: state.targetPercentage
        });
      }
    }
  }

  private estimateTimeRemaining(state: POVState): number {
    const currentRate = state.executedQuantity / (Date.now() - state.startTime);
    if (currentRate === 0) return Infinity;
    
    return state.remainingQuantity / currentRate;
  }

  private calculateMetrics(state: POVState): POVMetrics {
    const participation = this.calculateCurrentParticipation(state);
    
    // Calculate average participation from history
    const avgParticipation = state.executionHistory.length > 0
      ? state.executionHistory.reduce((sum, s) => sum + s.participationRate, 0) / state.executionHistory.length
      : 0;
    
    // Calculate min/max participation
    const participations = state.executionHistory.map(s => s.participationRate);
    const maxParticipation = participations.length > 0 ? Math.max(...participations) : 0;
    const minParticipation = participations.length > 0 ? Math.min(...participations) : 0;
    
    // Calculate impact cost
    const impactCost = state.executionHistory.reduce((sum, s) => sum + s.impact * s.quantity, 0);
    
    return {
      targetParticipation: state.targetPercentage,
      actualParticipation: participation,
      volumeExecuted: state.executedQuantity,
      marketVolumeTracked: state.volumeTracking.marketVolume,
      completionPercentage: (state.executedQuantity / state.totalQuantity) * 100,
      averageParticipation: avgParticipation,
      maxParticipation,
      minParticipation,
      impactCost
    };
  }

  private completeExecution(orderId: string): void {
    const state = this.activeOrders.get(orderId);
    if (!state) return;
    
    state.status = ExecutionStatus.COMPLETED;
    state.endTime = Date.now();
    
    const result = this.createExecutionResult(state);
    
    this.logger.info('POV execution completed', {
      orderId,
      executedQuantity: state.executedQuantity,
      averageParticipation: (this.calculateMetrics(state).averageParticipation * 100).toFixed(2) + '%'
    });
    
    this.emit('executionCompleted', result);
    
    // Clean up
    setTimeout(() => {
      this.activeOrders.delete(orderId);
    }, 60000);
  }

  private createExecutionResult(state: POVState): ExecutionResult {
    const metrics = this.calculateMetrics(state);
    const totalValue = state.fills.reduce((sum, f) => sum + f.quantity * f.price, 0);
    const totalQuantity = state.fills.reduce((sum, f) => sum + f.quantity, 0);
    const totalFees = state.fills.reduce((sum, f) => sum + f.fee, 0);
    const averagePrice = totalQuantity > 0 ? totalValue / totalQuantity : 0;
    
    return {
      orderId: state.orderId,
      status: state.status,
      fills: state.fills,
      averagePrice,
      totalQuantity,
      totalFees,
      slippage: metrics.impactCost / totalValue,
      marketImpact: metrics.impactCost / totalValue,
      executionTime: (state.endTime || Date.now()) - state.startTime,
      routes: this.aggregateRoutes(state),
      performance: {
        slippageBps: (metrics.impactCost / totalValue) * 10000,
        implementationShortfall: metrics.impactCost,
        fillRate: totalQuantity / state.totalQuantity,
        reversion: 0,
        benchmarkDeviation: Math.abs(metrics.actualParticipation - metrics.targetParticipation),
        opportunityCost: 0,
        totalCost: totalFees + metrics.impactCost
      }
    };
  }

  private aggregateRoutes(state: POVState): ExecutedRoute[] {
    const routeMap = new Map<string, ExecutedRoute>();
    
    for (const fill of state.fills) {
      const existing = routeMap.get(fill.exchange);
      
      if (existing) {
        existing.quantity += fill.quantity;
        existing.fills++;
        existing.fees += fill.fee;
      } else {
        routeMap.set(fill.exchange, {
          exchange: fill.exchange,
          orderId: fill.orderId,
          quantity: fill.quantity,
          fills: 1,
          averagePrice: fill.price,
          fees: fill.fee,
          latency: 50,
          success: true
        });
      }
    }
    
    // Calculate average prices
    for (const route of routeMap.values()) {
      const exchangeFills = state.fills.filter(f => f.exchange === route.exchange);
      const totalValue = exchangeFills.reduce((sum, f) => sum + f.quantity * f.price, 0);
      route.averagePrice = totalValue / route.quantity;
    }
    
    return Array.from(routeMap.values());
  }

  /**
   * Cancel POV execution
   */
  cancelExecution(orderId: string): boolean {
    const state = this.activeOrders.get(orderId);
    if (!state || state.status === ExecutionStatus.COMPLETED) {
      return false;
    }
    
    state.status = ExecutionStatus.CANCELLED;
    state.endTime = Date.now();
    
    const metrics = this.calculateMetrics(state);
    
    this.logger.info('POV execution cancelled', {
      orderId,
      executedQuantity: state.executedQuantity,
      remainingQuantity: state.remainingQuantity,
      averageParticipation: (metrics.averageParticipation * 100).toFixed(2) + '%'
    });
    
    this.emit('executionCancelled', {
      orderId,
      executedQuantity: state.executedQuantity,
      remainingQuantity: state.remainingQuantity,
      metrics
    });
    
    return true;
  }

  /**
   * Get all active POV executions
   */
  getActiveExecutions(): Map<string, POVState> {
    return new Map(this.activeOrders);
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    if (this.volumeMonitor) {
      clearInterval(this.volumeMonitor);
      this.volumeMonitor = undefined;
    }
    
    if (this.executionLoop) {
      clearInterval(this.executionLoop);
      this.executionLoop = undefined;
    }
    
    if (this.adaptiveAdjuster) {
      clearInterval(this.adaptiveAdjuster);
      this.adaptiveAdjuster = undefined;
    }
    
    this.removeAllListeners();
  }
} 