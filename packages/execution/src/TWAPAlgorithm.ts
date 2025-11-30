import {
  Order,
  AlgorithmConfig,
  AlgorithmParameters,
  ExecutionConstraints,
  ExecutionRoute,
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

interface TWAPState {
  orderId: string;
  totalQuantity: number;
  executedQuantity: number;
  remainingQuantity: number;
  slices: TWAPSlice[];
  currentSlice: number;
  startTime: number;
  endTime: number;
  fills: Fill[];
  status: ExecutionStatus;
  paused: boolean;
}

interface TWAPSlice {
  index: number;
  quantity: number;
  targetTime: number;
  executedQuantity: number;
  status: 'pending' | 'executing' | 'completed' | 'failed';
  attempts: number;
  fills: Fill[];
}

interface TWAPMetrics {
  actualVWAP: number;
  targetVWAP: number;
  slippage: number;
  executionRate: number;
  deviation: number;
  completionPercentage: number;
}

export class TWAPAlgorithm extends EventEmitter {
  private logger: Logger;
  private activeOrders: Map<string, TWAPState>;
  private executionTimer?: NodeJS.Timeout;
  private metricsInterval?: NodeJS.Timeout;

  constructor(logger: Logger) {
    super();
    this.logger = logger;
    this.activeOrders = new Map();
    
    // Start execution loop
    this.startExecutionLoop();
    
    // Start metrics collection
    this.startMetricsCollection();
  }

  /**
   * Execute order using TWAP algorithm
   */
  async execute(
    order: Order,
    config: AlgorithmConfig,
    router: any // SmartOrderRouter instance
  ): Promise<void> {
    this.logger.info('Starting TWAP execution', {
      orderId: order.id,
      quantity: order.quantity,
      duration: config.parameters.duration
    });

    // Validate parameters
    this.validateParameters(config.parameters);
    
    // Initialize TWAP state
    const state = this.initializeTWAPState(order, config.parameters);
    this.activeOrders.set(order.id, state);
    
    // Emit start event
    this.emit('executionStarted', {
      orderId: order.id,
      algorithm: 'TWAP',
      parameters: config.parameters
    });
    
    // Start executing slices
    await this.executeNextSlice(order.id, router);
  }

  /**
   * Get current execution status
   */
  getExecutionStatus(orderId: string): TWAPState | null {
    return this.activeOrders.get(orderId) || null;
  }

  /**
   * Get execution metrics
   */
  getMetrics(orderId: string): TWAPMetrics | null {
    const state = this.activeOrders.get(orderId);
    if (!state) return null;
    
    return this.calculateMetrics(state);
  }

  /**
   * Pause execution
   */
  pauseExecution(orderId: string): boolean {
    const state = this.activeOrders.get(orderId);
    if (!state || state.status !== ExecutionStatus.PARTIAL) {
      return false;
    }
    
    state.paused = true;
    this.logger.info('TWAP execution paused', { orderId });
    
    this.emit('executionPaused', { orderId });
    return true;
  }

  /**
   * Resume execution
   */
  resumeExecution(orderId: string): boolean {
    const state = this.activeOrders.get(orderId);
    if (!state || !state.paused) {
      return false;
    }
    
    state.paused = false;
    this.logger.info('TWAP execution resumed', { orderId });
    
    this.emit('executionResumed', { orderId });
    return true;
  }

  /**
   * Cancel execution
   */
  cancelExecution(orderId: string): boolean {
    const state = this.activeOrders.get(orderId);
    if (!state || state.status === ExecutionStatus.COMPLETED) {
      return false;
    }
    
    state.status = ExecutionStatus.CANCELLED;
    this.logger.info('TWAP execution cancelled', { 
      orderId,
      executedQuantity: state.executedQuantity 
    });
    
    this.emit('executionCancelled', {
      orderId,
      executedQuantity: state.executedQuantity,
      remainingQuantity: state.remainingQuantity
    });
    
    return true;
  }

  // Private methods

  private validateParameters(params: AlgorithmParameters): void {
    if (!params.duration || params.duration <= 0) {
      throw new ExecutionError(
        'Invalid TWAP duration',
        ExecutionErrorCode.INVALID_ORDER
      );
    }
    
    if (!params.slices || params.slices <= 0) {
      throw new ExecutionError(
        'Invalid number of slices',
        ExecutionErrorCode.INVALID_ORDER
      );
    }
  }

  private initializeTWAPState(
    order: Order,
    params: AlgorithmParameters
  ): TWAPState {
    const slices = params.slices || 10;
    const duration = params.duration || 3600000; // 1 hour default
    const interval = duration / slices;
    const sliceQuantity = order.quantity / slices;
    
    const startTime = params.startTime || Date.now();
    const endTime = startTime + duration;
    
    // Create slices
    const twapSlices: TWAPSlice[] = [];
    for (let i = 0; i < slices; i++) {
      twapSlices.push({
        index: i,
        quantity: sliceQuantity,
        targetTime: startTime + (i * interval),
        executedQuantity: 0,
        status: 'pending',
        attempts: 0,
        fills: []
      });
    }
    
    return {
      orderId: order.id,
      totalQuantity: order.quantity,
      executedQuantity: 0,
      remainingQuantity: order.quantity,
      slices: twapSlices,
      currentSlice: 0,
      startTime,
      endTime,
      fills: [],
      status: ExecutionStatus.PARTIAL,
      paused: false
    };
  }

  private startExecutionLoop(): void {
    this.executionTimer = setInterval(() => {
      this.processActiveOrders();
    }, 1000); // Check every second
  }

  private startMetricsCollection(): void {
    this.metricsInterval = setInterval(() => {
      this.collectAndEmitMetrics();
    }, 5000); // Every 5 seconds
  }

  private async processActiveOrders(): Promise<void> {
    const now = Date.now();
    
    for (const [orderId, state] of this.activeOrders) {
      if (state.paused || state.status !== ExecutionStatus.PARTIAL) {
        continue;
      }
      
      // Check if we should execute next slice
      const currentSlice = state.slices[state.currentSlice];
      if (currentSlice && currentSlice.targetTime <= now && 
          currentSlice.status === 'pending') {
        // Execute slice
        await this.executeSlice(orderId, state.currentSlice);
      }
      
      // Check if execution is complete
      if (state.executedQuantity >= state.totalQuantity * 0.99) {
        this.completeExecution(orderId);
      }
      
      // Check if execution timed out
      if (now > state.endTime && state.remainingQuantity > 0) {
        this.handleTimeout(orderId);
      }
    }
  }

  private async executeSlice(
    orderId: string,
    sliceIndex: number
  ): Promise<void> {
    const state = this.activeOrders.get(orderId);
    if (!state) return;
    
    const slice = state.slices[sliceIndex];
    if (!slice || slice.status !== 'pending') return;
    
    slice.status = 'executing';
    slice.attempts++;
    
    this.logger.debug('Executing TWAP slice', {
      orderId,
      sliceIndex,
      quantity: slice.quantity
    });
    
    try {
      // Create child order for this slice
      const childOrder: Order = {
        id: `${orderId}-slice-${sliceIndex}`,
        clientOrderId: `twap-${orderId}-${sliceIndex}`,
        symbol: 'BTC/USDT', // Would come from original order
        side: OrderSide.BUY, // Would come from original order
        type: OrderType.LIMIT,
        amount: slice.quantity,
        quantity: slice.quantity,
        price: await this.calculateSlicePrice(),
        timestamp: Date.now(),
        timeInForce: TimeInForce.IOC,
        status: OrderStatus.NEW,
        exchange: 'best', // Router will determine
        createdAt: Date.now(),
        updatedAt: Date.now(),
        metadata: {
          algorithm: 'TWAP',
          parentOrder: orderId,
          urgency: 'medium'
        }
      };
      
      // Execute through router (mock implementation)
      const fill = await this.executeChildOrder(childOrder);
      
      // Update slice
      slice.executedQuantity = fill.quantity;
      slice.fills.push(fill);
      slice.status = 'completed';
      
      // Update state
      state.executedQuantity += fill.quantity;
      state.remainingQuantity -= fill.quantity;
      state.fills.push(fill);
      
      // Move to next slice
      if (state.currentSlice < state.slices.length - 1) {
        state.currentSlice++;
      }
      
      // Emit progress event
      this.emit('sliceExecuted', {
        orderId,
        sliceIndex,
        fill,
        progress: state.executedQuantity / state.totalQuantity
      });
      
    } catch (error) {
      this.logger.error('Slice execution failed', { orderId, sliceIndex, error });
      slice.status = 'failed';
      
      // Retry logic
      if (slice.attempts < 3) {
        setTimeout(() => {
          slice.status = 'pending';
        }, 5000); // Retry after 5 seconds
      }
    }
  }

  private async calculateSlicePrice(): Promise<number> {
    // In production, would fetch current market price
    // and apply slight premium/discount for limit orders
    const marketPrice = 50000; // Mock BTC price
    return marketPrice * 0.999; // Slight discount for buying
  }

  private async executeChildOrder(order: Order): Promise<Fill> {
    // Mock execution - in production would use SmartOrderRouter
    await new Promise(resolve => setTimeout(resolve, 100));
    
    return {
      id: `fill-${Date.now()}`,
      orderId: order.id,
      symbol: order.symbol,
      exchange: 'binance',
      price: order.price || 50000,
      quantity: order.quantity ?? order.amount,
      fee: (order.quantity ?? order.amount) * (order.price || 50000) * 0.0001,
      timestamp: Date.now(),
      side: order.side,
      liquidity: 'taker',
      tradeId: `trade-${Date.now()}`
    };
  }

  private async executeNextSlice(
    orderId: string,
    router: any
  ): Promise<void> {
    const state = this.activeOrders.get(orderId);
    if (!state) return;
    
    // Find next pending slice
    const nextSlice = state.slices.find(s => s.status === 'pending');
    if (!nextSlice) {
      this.completeExecution(orderId);
      return;
    }
    
    // Wait for target time
    const delay = Math.max(0, nextSlice.targetTime - Date.now());
    
    setTimeout(() => {
      this.executeSlice(orderId, nextSlice.index);
    }, delay);
  }

  private completeExecution(orderId: string): void {
    const state = this.activeOrders.get(orderId);
    if (!state) return;
    
    state.status = ExecutionStatus.COMPLETED;
    
    const result = this.createExecutionResult(state);
    
    this.logger.info('TWAP execution completed', {
      orderId,
      executedQuantity: state.executedQuantity,
      fills: state.fills.length
    });
    
    this.emit('executionCompleted', result);
    
    // Clean up after delay
    setTimeout(() => {
      this.activeOrders.delete(orderId);
    }, 60000); // Keep for 1 minute for queries
  }

  private handleTimeout(orderId: string): void {
    const state = this.activeOrders.get(orderId);
    if (!state) return;
    
    state.status = ExecutionStatus.EXPIRED;
    
    this.logger.warn('TWAP execution timed out', {
      orderId,
      executedQuantity: state.executedQuantity,
      remainingQuantity: state.remainingQuantity
    });
    
    const result = this.createExecutionResult(state);
    
    this.emit('executionTimeout', result);
  }

  private createExecutionResult(state: TWAPState): ExecutionResult {
    const totalValue = state.fills.reduce(
      (sum, fill) => sum + fill.quantity * fill.price,
      0
    );
    const totalQuantity = state.fills.reduce(
      (sum, fill) => sum + fill.quantity,
      0
    );
    const totalFees = state.fills.reduce(
      (sum, fill) => sum + fill.fee,
      0
    );
    
    const averagePrice = totalQuantity > 0 ? totalValue / totalQuantity : 0;
    const metrics = this.calculateMetrics(state);
    
    // Map ExecutionStatus to OrderStatus
    const orderStatus = state.status === ExecutionStatus.COMPLETED ? OrderStatus.FILLED :
                        state.status === ExecutionStatus.PARTIAL ? OrderStatus.PARTIALLY_FILLED :
                        state.status === ExecutionStatus.FAILED ? OrderStatus.REJECTED :
                        state.status === ExecutionStatus.CANCELLED ? OrderStatus.CANCELLED :
                        OrderStatus.OPEN;
    
    return {
      orderId: state.orderId,
      status: orderStatus,
      fills: state.fills,
      averagePrice,
      totalQuantity,
      totalFees,
      slippage: metrics.slippage,
      marketImpact: 0, // Would calculate from market data
      executionTime: Date.now() - state.startTime,
      routes: this.aggregateRoutes(state),
      performance: {
        slippageBps: metrics.slippage * 10000,
        implementationShortfall: 0,
        fillRate: totalQuantity / state.totalQuantity,
        reversion: 0,
        benchmarkDeviation: metrics.deviation,
        vwapDeviation: metrics.actualVWAP - metrics.targetVWAP,
        opportunityCost: 0,
        totalCost: totalFees + (metrics.slippage * totalValue)
      }
    };
  }

  private calculateMetrics(state: TWAPState): TWAPMetrics {
    const totalValue = state.fills.reduce(
      (sum, fill) => sum + fill.quantity * fill.price,
      0
    );
    const totalQuantity = state.fills.reduce(
      (sum, fill) => sum + fill.quantity,
      0
    );
    
    const actualVWAP = totalQuantity > 0 ? totalValue / totalQuantity : 0;
    
    // Calculate target VWAP (simplified)
    const targetVWAP = 50000; // Would calculate from market data
    
    const slippage = actualVWAP > 0 
      ? (actualVWAP - targetVWAP) / targetVWAP 
      : 0;
    
    const executionRate = state.executedQuantity / state.totalQuantity;
    const deviation = Math.abs(actualVWAP - targetVWAP) / targetVWAP;
    const completionPercentage = (state.executedQuantity / state.totalQuantity) * 100;
    
    return {
      actualVWAP,
      targetVWAP,
      slippage,
      executionRate,
      deviation,
      completionPercentage
    };
  }

  private aggregateRoutes(state: TWAPState): ExecutedRoute[] {
    const routeMap = new Map<string, ExecutedRoute>();
    
    for (const fill of state.fills) {
      const exchange = fill.exchange ?? fill.venue ?? 'unknown';
      const existing = routeMap.get(exchange);
      
      if (existing) {
        existing.quantity += fill.quantity;
        existing.fills.push(fill);
        if (existing.fees !== undefined) {
          existing.fees += fill.fee;
        }
        existing.totalFee += fill.fee;
      } else {
        routeMap.set(exchange, {
          venue: exchange,
          quantity: fill.quantity,
          priority: 1,
          fills: [fill],
          avgPrice: fill.price,
          averagePrice: fill.price,
          totalFee: fill.fee,
          fees: fill.fee
        } as ExecutedRoute);
      }
    }
    
    // Calculate average prices
    for (const route of routeMap.values()) {
      const exchangeFills = state.fills.filter(f => f.exchange === route.exchange);
      const totalValue = exchangeFills.reduce(
        (sum, f) => sum + f.quantity * f.price,
        0
      );
      route.averagePrice = totalValue / route.quantity;
    }
    
    return Array.from(routeMap.values());
  }

  private collectAndEmitMetrics(): void {
    for (const [orderId, state] of this.activeOrders) {
      if (state.status === ExecutionStatus.PARTIAL) {
        const metrics = this.calculateMetrics(state);
        
        this.emit('metricsUpdate', {
          orderId,
          metrics,
          timestamp: Date.now()
        });
      }
    }
  }

  /**
   * Get all active TWAP executions
   */
  getActiveExecutions(): Map<string, TWAPState> {
    return new Map(this.activeOrders);
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    if (this.executionTimer) {
      clearInterval(this.executionTimer);
      this.executionTimer = undefined;
    }
    
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = undefined;
    }
    
    this.removeAllListeners();
  }
} 