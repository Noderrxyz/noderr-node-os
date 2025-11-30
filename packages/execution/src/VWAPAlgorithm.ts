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

interface VWAPState {
  orderId: string;
  totalQuantity: number;
  executedQuantity: number;
  remainingQuantity: number;
  slices: VWAPSlice[];
  volumeProfile: VolumeProfile;
  targetVWAP: number;
  actualVWAP: number;
  startTime: number;
  endTime: number;
  fills: Fill[];
  status: ExecutionStatus;
  adaptiveMode: boolean;
  participationRate: number;
}

interface VWAPSlice {
  index: number;
  startTime: number;
  endTime: number;
  targetVolume: number;
  targetQuantity: number;
  executedQuantity: number;
  expectedPrice: number;
  status: 'pending' | 'executing' | 'completed' | 'failed';
  fills: Fill[];
  volumeDeviation: number;
}

interface VolumeProfile {
  historicalPattern: HourlyVolume[];
  intraday: IntradayVolume[];
  currentVolume: number;
  projectedVolume: number;
  confidence: number;
}

interface HourlyVolume {
  hour: number;
  averageVolume: number;
  volumePercentage: number;
  volatility: number;
  spread: number;
}

interface IntradayVolume {
  timestamp: number;
  volume: number;
  vwap: number;
  trades: number;
}

interface VWAPMetrics {
  targetVWAP: number;
  actualVWAP: number;
  trackingError: number;
  participationRate: number;
  volumeParticipation: number;
  completionPercentage: number;
  slippageBps: number;
  marketImpact: number;
}

export class VWAPAlgorithm extends EventEmitter {
  private logger: Logger;
  private activeOrders: Map<string, VWAPState>;
  private volumeProfiles: Map<string, VolumeProfile>;
  private executionTimer?: NodeJS.Timeout;
  private volumeUpdateTimer?: NodeJS.Timeout;
  private adaptiveAdjustmentTimer?: NodeJS.Timeout;

  constructor(logger: Logger) {
    super();
    this.logger = logger;
    this.activeOrders = new Map();
    this.volumeProfiles = new Map();
    
    // Start execution loops
    this.startExecutionLoop();
    this.startVolumeUpdateLoop();
    this.startAdaptiveAdjustmentLoop();
  }

  /**
   * Execute order using VWAP algorithm
   */
  async execute(
    order: Order,
    config: AlgorithmConfig,
    router: any
  ): Promise<void> {
    this.logger.info('Starting VWAP execution', {
      orderId: order.id,
      quantity: order.quantity,
      participationRate: config.parameters.targetPercentage
    });

    // Validate parameters
    this.validateParameters(config.parameters);
    
    // Fetch and analyze volume profile
    const volumeProfile = await this.analyzeVolumeProfile(order.symbol);
    
    // Initialize VWAP state
    const state = this.initializeVWAPState(order, config.parameters, volumeProfile);
    this.activeOrders.set(order.id, state);
    this.volumeProfiles.set(order.symbol, volumeProfile);
    
    // Emit start event
    this.emit('executionStarted', {
      orderId: order.id,
      algorithm: 'VWAP',
      parameters: config.parameters,
      volumeProfile: volumeProfile
    });
    
    // Start execution
    await this.executeNextSlice(order.id, router);
  }

  /**
   * Get current execution status
   */
  getExecutionStatus(orderId: string): VWAPState | null {
    return this.activeOrders.get(orderId) || null;
  }

  /**
   * Get execution metrics
   */
  getMetrics(orderId: string): VWAPMetrics | null {
    const state = this.activeOrders.get(orderId);
    if (!state) return null;
    
    return this.calculateMetrics(state);
  }

  /**
   * Update volume profile in real-time
   */
  updateVolumeProfile(symbol: string, volumeData: any): void {
    const profile = this.volumeProfiles.get(symbol);
    if (!profile) return;
    
    // Update intraday volume
    profile.intraday.push({
      timestamp: Date.now(),
      volume: volumeData.volume,
      vwap: volumeData.vwap,
      trades: volumeData.trades
    });
    
    // Keep only recent data (last 1000 points)
    if (profile.intraday.length > 1000) {
      profile.intraday.shift();
    }
    
    // Recalculate current metrics
    profile.currentVolume += volumeData.volume;
    this.recalculateProjections(profile);
  }

  // Private methods

  private validateParameters(params: AlgorithmParameters): void {
    if (!params.duration || params.duration <= 0) {
      throw new ExecutionError(
        'Invalid VWAP duration',
        ExecutionErrorCode.INVALID_ORDER
      );
    }
    
    if (params.targetPercentage && (params.targetPercentage <= 0 || params.targetPercentage > 100)) {
      throw new ExecutionError(
        'Invalid participation rate',
        ExecutionErrorCode.INVALID_ORDER
      );
    }
  }

  private async analyzeVolumeProfile(symbol: string): Promise<VolumeProfile> {
    // Fetch historical volume data (mock implementation)
    const historicalPattern = this.generateHistoricalPattern();
    
    // Calculate confidence based on data quality
    const confidence = this.calculateVolumeConfidence(historicalPattern);
    
    return {
      historicalPattern,
      intraday: [],
      currentVolume: 0,
      projectedVolume: this.projectDailyVolume(historicalPattern),
      confidence
    };
  }

  private generateHistoricalPattern(): HourlyVolume[] {
    // Generate typical intraday volume pattern
    // In production, this would fetch real historical data
    const pattern: HourlyVolume[] = [];
    
    for (let hour = 0; hour < 24; hour++) {
      // U-shaped volume pattern typical in markets
      let volumePercentage: number;
      if (hour < 2 || hour > 22) {
        volumePercentage = 0.02; // Low overnight volume
      } else if (hour >= 9 && hour <= 10) {
        volumePercentage = 0.12; // High morning volume
      } else if (hour >= 15 && hour <= 16) {
        volumePercentage = 0.10; // High afternoon volume
      } else {
        volumePercentage = 0.05; // Regular hours
      }
      
      pattern.push({
        hour,
        averageVolume: 1000000 * volumePercentage,
        volumePercentage,
        volatility: 0.02 + Math.random() * 0.01,
        spread: 0.001 + Math.random() * 0.0005
      });
    }
    
    return pattern;
  }

  private calculateVolumeConfidence(pattern: HourlyVolume[]): number {
    // Calculate confidence based on pattern stability
    const volatilities = pattern.map(p => p.volatility);
    const avgVolatility = volatilities.reduce((a, b) => a + b, 0) / volatilities.length;
    
    // Lower volatility = higher confidence
    return Math.max(0.5, Math.min(0.95, 1 - avgVolatility * 10));
  }

  private projectDailyVolume(pattern: HourlyVolume[]): number {
    return pattern.reduce((sum, h) => sum + h.averageVolume, 0);
  }

  private initializeVWAPState(
    order: Order,
    params: AlgorithmParameters,
    volumeProfile: VolumeProfile
  ): VWAPState {
    const duration = params.duration || 3600000; // 1 hour default
    const participationRate = params.targetPercentage || 10; // 10% default
    
    const startTime = params.startTime || Date.now();
    const endTime = startTime + duration;
    
    // Calculate target VWAP from current market
    const targetVWAP = this.calculateTargetVWAP(order.symbol);
    
    // Create slices based on volume profile
    const slices = this.createVolumeWeightedSlices(
      order,
      volumeProfile,
      startTime,
      endTime,
      participationRate
    );
    
    const quantity = order.quantity ?? order.amount;
    return {
      orderId: order.id,
      totalQuantity: quantity,
      executedQuantity: 0,
      remainingQuantity: quantity,
      slices,
      volumeProfile,
      targetVWAP,
      actualVWAP: 0,
      startTime,
      endTime,
      fills: [],
      status: ExecutionStatus.PARTIAL,
      adaptiveMode: params.adaptiveMode !== false,
      participationRate: participationRate / 100
    };
  }

  private calculateTargetVWAP(symbol: string): number {
    // In production, fetch current market VWAP
    return 50000; // Mock BTC VWAP
  }

  private createVolumeWeightedSlices(
    order: Order,
    volumeProfile: VolumeProfile,
    startTime: number,
    endTime: number,
    participationRate: number
  ): VWAPSlice[] {
    const slices: VWAPSlice[] = [];
    const duration = endTime - startTime;
    const sliceDuration = 60000; // 1 minute slices
    const numSlices = Math.floor(duration / sliceDuration);
    
    // Calculate expected volume for each slice
    const startHour = new Date(startTime).getHours();
    const endHour = new Date(endTime).getHours();
    
    let totalExpectedVolume = 0;
    for (let hour = startHour; hour <= endHour; hour++) {
      const hourPattern = volumeProfile.historicalPattern[hour % 24];
      totalExpectedVolume += hourPattern.averageVolume * (duration / 3600000);
    }
    
    // Distribute quantity based on expected volume
    for (let i = 0; i < numSlices; i++) {
      const sliceStart = startTime + (i * sliceDuration);
      const sliceEnd = sliceStart + sliceDuration;
      const sliceHour = new Date(sliceStart).getHours();
      
      const hourPattern = volumeProfile.historicalPattern[sliceHour];
      const expectedVolume = hourPattern.averageVolume * (sliceDuration / 3600000);
      const volumeRatio = expectedVolume / totalExpectedVolume;
      
      slices.push({
        index: i,
        startTime: sliceStart,
        endTime: sliceEnd,
        targetVolume: expectedVolume,
        targetQuantity: (order.quantity ?? order.amount) * volumeRatio,
        executedQuantity: 0,
        expectedPrice: this.calculateTargetVWAP(order.symbol),
        status: 'pending',
        fills: [],
        volumeDeviation: 0
      });
    }
    
    return slices;
  }

  private startExecutionLoop(): void {
    this.executionTimer = setInterval(() => {
      this.processActiveOrders();
    }, 500); // Check every 500ms for tighter control
  }

  private startVolumeUpdateLoop(): void {
    this.volumeUpdateTimer = setInterval(() => {
      this.updateVolumeTracking();
    }, 5000); // Update volume every 5 seconds
  }

  private startAdaptiveAdjustmentLoop(): void {
    this.adaptiveAdjustmentTimer = setInterval(() => {
      this.performAdaptiveAdjustments();
    }, 10000); // Adjust every 10 seconds
  }

  private async processActiveOrders(): Promise<void> {
    const now = Date.now();
    
    for (const [orderId, state] of this.activeOrders) {
      if (state.status !== ExecutionStatus.PARTIAL) {
        continue;
      }
      
      // Find current slice
      const currentSlice = state.slices.find(
        s => s.startTime <= now && s.endTime > now && s.status === 'pending'
      );
      
      if (currentSlice) {
        await this.executeSlice(orderId, currentSlice.index);
      }
      
      // Check completion
      if (state.executedQuantity >= state.totalQuantity * 0.99) {
        this.completeExecution(orderId);
      }
      
      // Check timeout
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
    
    this.logger.debug('Executing VWAP slice', {
      orderId,
      sliceIndex,
      targetQuantity: slice.targetQuantity,
      targetVolume: slice.targetVolume
    });
    
    try {
      // Calculate actual quantity based on current market conditions
      const adjustedQuantity = this.calculateAdjustedQuantity(
        slice,
        state.volumeProfile,
        state.participationRate
      );
      
      // Create child order
      const childOrder = this.createChildOrder(
        orderId,
        slice,
        adjustedQuantity
      );
      
      // Execute through router (mock)
      const fill = await this.executeChildOrder(childOrder);
      
      // Update slice
      slice.executedQuantity = fill.quantity;
      slice.fills.push(fill);
      slice.status = 'completed';
      
      // Update volume deviation
      slice.volumeDeviation = (slice.executedQuantity - slice.targetQuantity) / slice.targetQuantity;
      
      // Update state
      state.executedQuantity += fill.quantity;
      state.remainingQuantity -= fill.quantity;
      state.fills.push(fill);
      state.actualVWAP = this.calculateActualVWAP(state.fills);
      
      // Emit progress
      this.emit('sliceExecuted', {
        orderId,
        sliceIndex,
        fill,
        metrics: this.calculateMetrics(state)
      });
      
    } catch (error) {
      this.logger.error('Slice execution failed', { orderId, sliceIndex, error });
      slice.status = 'failed';
    }
  }

  private calculateAdjustedQuantity(
    slice: VWAPSlice,
    volumeProfile: VolumeProfile,
    participationRate: number
  ): number {
    // Get current market volume
    const recentVolume = this.getRecentVolume(volumeProfile);
    
    // Compare to expected volume
    const volumeRatio = recentVolume / slice.targetVolume;
    
    // Adjust quantity based on actual vs expected volume
    let adjustedQuantity = slice.targetQuantity;
    
    if (volumeRatio < 0.8) {
      // Low volume - reduce quantity to avoid impact
      adjustedQuantity *= 0.8;
    } else if (volumeRatio > 1.2) {
      // High volume - can increase quantity
      adjustedQuantity *= Math.min(1.5, volumeRatio);
    }
    
    // Apply participation rate constraint
    const maxQuantity = recentVolume * participationRate;
    adjustedQuantity = Math.min(adjustedQuantity, maxQuantity);
    
    return adjustedQuantity;
  }

  private getRecentVolume(volumeProfile: VolumeProfile): number {
    // Get volume from last 5 minutes
    const fiveMinutesAgo = Date.now() - 300000;
    const recentData = volumeProfile.intraday.filter(
      d => d.timestamp > fiveMinutesAgo
    );
    
    if (recentData.length === 0) {
      // Use historical average if no recent data
      const hour = new Date().getHours();
      return volumeProfile.historicalPattern[hour].averageVolume / 12; // 5 min average
    }
    
    return recentData.reduce((sum, d) => sum + d.volume, 0);
  }

  private createChildOrder(
    parentOrderId: string,
    slice: VWAPSlice,
    quantity: number
  ): Order {
    return {
      id: `${parentOrderId}-vwap-${slice.index}`,
      clientOrderId: `vwap-${parentOrderId}-${slice.index}`,
      symbol: 'BTC/USDT', // Would come from parent
      side: OrderSide.BUY, // Would come from parent
      type: OrderType.LIMIT,
      amount: quantity,
      quantity,
      price: slice.expectedPrice * 0.999, // Slightly passive
      timestamp: Date.now(),
      timeInForce: TimeInForce.POST_ONLY, // Try to capture maker rebate
      status: OrderStatus.NEW,
      exchange: 'best',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: {
        algorithm: 'VWAP',
        parentOrder: parentOrderId,
        urgency: 'low',
        preferMaker: true
      }
    };
  }

  private async executeChildOrder(order: Order): Promise<Fill> {
    // Mock execution
    await new Promise(resolve => setTimeout(resolve, 100));
    
    return {
      id: `fill-${Date.now()}`,
      orderId: order.id,
      symbol: order.symbol,
      exchange: 'binance',
      price: order.price || 50000,
      quantity: order.quantity ?? order.amount,
      fee: (order.quantity ?? order.amount) * (order.price || 50000) * 0.0001, // Maker fee
      timestamp: Date.now(),
      side: order.side,
      liquidity: 'maker',
      tradeId: `trade-${Date.now()}`
    };
  }

  private calculateActualVWAP(fills: Fill[]): number {
    if (fills.length === 0) return 0;
    
    const totalValue = fills.reduce((sum, f) => sum + f.quantity * f.price, 0);
    const totalQuantity = fills.reduce((sum, f) => sum + f.quantity, 0);
    
    return totalQuantity > 0 ? totalValue / totalQuantity : 0;
  }

  private updateVolumeTracking(): void {
    // Update volume profiles for all active symbols
    for (const [symbol, profile] of this.volumeProfiles) {
      // Simulate volume update (in production, fetch from market data)
      const volumeData = {
        volume: 1000 + Math.random() * 500,
        vwap: 50000 + Math.random() * 100,
        trades: Math.floor(10 + Math.random() * 20)
      };
      
      this.updateVolumeProfile(symbol, volumeData);
    }
  }

  private performAdaptiveAdjustments(): void {
    for (const [orderId, state] of this.activeOrders) {
      if (!state.adaptiveMode || state.status !== ExecutionStatus.PARTIAL) {
        continue;
      }
      
      // Calculate performance metrics
      const metrics = this.calculateMetrics(state);
      
      // Adjust future slices if tracking error is high
      if (Math.abs(metrics.trackingError) > 0.002) { // 20 bps
        this.adjustFutureSlices(state, metrics);
      }
      
      // Adjust participation rate if market impact is high
      if (metrics.marketImpact > 0.001) { // 10 bps
        state.participationRate = Math.max(0.01, state.participationRate * 0.9);
        this.logger.info('Reduced participation rate due to market impact', {
          orderId,
          newRate: state.participationRate
        });
      }
    }
  }

  private adjustFutureSlices(state: VWAPState, metrics: VWAPMetrics): void {
    const remainingSlices = state.slices.filter(s => s.status === 'pending');
    
    if (remainingSlices.length === 0) return;
    
    // Calculate adjustment factor
    const adjustmentFactor = metrics.actualVWAP > metrics.targetVWAP ? 0.9 : 1.1;
    
    // Redistribute remaining quantity
    const remainingQuantity = state.remainingQuantity;
    const quantityPerSlice = remainingQuantity / remainingSlices.length;
    
    remainingSlices.forEach(slice => {
      slice.targetQuantity = quantityPerSlice * adjustmentFactor;
      slice.expectedPrice = metrics.targetVWAP; // Update to current target
    });
    
    this.logger.debug('Adjusted future slices', {
      orderId: state.orderId,
      adjustmentFactor,
      remainingSlices: remainingSlices.length
    });
  }

  private recalculateProjections(profile: VolumeProfile): void {
    // Recalculate projected volume based on current run rate
    const hoursSinceStart = (Date.now() - profile.intraday[0]?.timestamp || 0) / 3600000;
    if (hoursSinceStart > 0) {
      const runRate = profile.currentVolume / hoursSinceStart;
      profile.projectedVolume = runRate * 24; // Project to full day
    }
  }

  private calculateMetrics(state: VWAPState): VWAPMetrics {
    const totalValue = state.fills.reduce((sum, f) => sum + f.quantity * f.price, 0);
    const totalQuantity = state.fills.reduce((sum, f) => sum + f.quantity, 0);
    
    const actualVWAP = totalQuantity > 0 ? totalValue / totalQuantity : 0;
    const trackingError = actualVWAP > 0 
      ? (actualVWAP - state.targetVWAP) / state.targetVWAP 
      : 0;
    
    // Calculate volume participation
    const totalMarketVolume = state.volumeProfile.currentVolume;
    const volumeParticipation = totalMarketVolume > 0 
      ? totalQuantity / totalMarketVolume 
      : 0;
    
    // Estimate market impact
    const expectedSlippage = 0.0001; // 1 bp per 1% participation
    const marketImpact = volumeParticipation * expectedSlippage;
    
    return {
      targetVWAP: state.targetVWAP,
      actualVWAP,
      trackingError,
      participationRate: state.participationRate,
      volumeParticipation,
      completionPercentage: (state.executedQuantity / state.totalQuantity) * 100,
      slippageBps: Math.abs(trackingError) * 10000,
      marketImpact
    };
  }

  private async executeNextSlice(orderId: string, router: any): Promise<void> {
    const state = this.activeOrders.get(orderId);
    if (!state) return;
    
    // Process slices sequentially based on time
    this.logger.debug('VWAP execution started, waiting for first slice time');
  }

  private completeExecution(orderId: string): void {
    const state = this.activeOrders.get(orderId);
    if (!state) return;
    
    state.status = ExecutionStatus.COMPLETED;
    
    const result = this.createExecutionResult(state);
    
    this.logger.info('VWAP execution completed', {
      orderId,
      executedQuantity: state.executedQuantity,
      actualVWAP: state.actualVWAP,
      trackingError: ((state.actualVWAP - state.targetVWAP) / state.targetVWAP * 100).toFixed(3) + '%'
    });
    
    this.emit('executionCompleted', result);
    
    // Clean up
    setTimeout(() => {
      this.activeOrders.delete(orderId);
      const symbol = state.fills[0]?.symbol || '';
      if (symbol) {
        this.volumeProfiles.delete(symbol);
      }
    }, 60000);
  }

  private handleTimeout(orderId: string): void {
    const state = this.activeOrders.get(orderId);
    if (!state) return;
    
    state.status = ExecutionStatus.EXPIRED;
    
    this.logger.warn('VWAP execution timed out', {
      orderId,
      executedQuantity: state.executedQuantity,
      remainingQuantity: state.remainingQuantity
    });
    
    const result = this.createExecutionResult(state);
    this.emit('executionTimeout', result);
  }

  private createExecutionResult(state: VWAPState): ExecutionResult {
    const metrics = this.calculateMetrics(state);
    const totalValue = state.fills.reduce((sum, f) => sum + f.quantity * f.price, 0);
    const totalQuantity = state.fills.reduce((sum, f) => sum + f.quantity, 0);
    const totalFees = state.fills.reduce((sum, f) => sum + f.fee, 0);
    
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
      averagePrice: metrics.actualVWAP,
      totalQuantity,
      totalFees,
      slippage: metrics.trackingError,
      marketImpact: metrics.marketImpact,
      executionTime: Date.now() - state.startTime,
      routes: this.aggregateRoutes(state),
      performance: {
        slippageBps: metrics.slippageBps,
        implementationShortfall: Math.abs(metrics.trackingError) * totalValue,
        fillRate: totalQuantity / state.totalQuantity,
        reversion: 0,
        benchmarkDeviation: metrics.trackingError,
        vwapDeviation: metrics.actualVWAP - metrics.targetVWAP,
        opportunityCost: Math.abs(metrics.trackingError) * totalValue,
        totalCost: totalFees + (metrics.marketImpact * totalValue)
      }
    };
  }

  private aggregateRoutes(state: VWAPState): ExecutedRoute[] {
    const routeMap = new Map<string, ExecutedRoute>();
    
    for (const fill of state.fills) {
      const exchange = fill.exchange ?? fill.venue ?? 'unknown';
      const existing = routeMap.get(exchange);
      
      if (existing) {
        existing.quantity += fill.quantity;
        const fillCount = (existing.fills as any) || 0;
        (existing as any).fills = fillCount + 1;
        if (existing.fees !== undefined) {
          existing.fees += fill.fee;
        }
      } else {
        routeMap.set(exchange, {
          venue: exchange,
          exchange,
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
      const exchangeFills = state.fills.filter(f => (f.exchange ?? f.venue) === route.exchange);
      const totalValue = exchangeFills.reduce((sum, f) => sum + f.quantity * f.price, 0);
      if (route.averagePrice !== undefined) {
        route.averagePrice = totalValue / route.quantity;
      }
      route.avgPrice = totalValue / route.quantity;
    }
    
    return Array.from(routeMap.values());
  }

  /**
   * Cancel VWAP execution
   */
  cancelExecution(orderId: string): boolean {
    const state = this.activeOrders.get(orderId);
    if (!state || state.status === ExecutionStatus.COMPLETED) {
      return false;
    }
    
    state.status = ExecutionStatus.CANCELLED;
    
    this.logger.info('VWAP execution cancelled', {
      orderId,
      executedQuantity: state.executedQuantity,
      remainingQuantity: state.remainingQuantity
    });
    
    this.emit('executionCancelled', {
      orderId,
      executedQuantity: state.executedQuantity,
      remainingQuantity: state.remainingQuantity,
      metrics: this.calculateMetrics(state)
    });
    
    return true;
  }

  /**
   * Get all active VWAP executions
   */
  getActiveExecutions(): Map<string, VWAPState> {
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
    
    if (this.volumeUpdateTimer) {
      clearInterval(this.volumeUpdateTimer);
      this.volumeUpdateTimer = undefined;
    }
    
    if (this.adaptiveAdjustmentTimer) {
      clearInterval(this.adaptiveAdjustmentTimer);
      this.adaptiveAdjustmentTimer = undefined;
    }
    
    this.removeAllListeners();
  }
} 