import {
  Order,
  AlgorithmConfig,
  AlgorithmParameters,
  ExecutionResult,
  ExecutionStatus,
  Fill,
  ExecutedRoute,
  OrderSide,
  OrderType,
  TimeInForce,
  OrderStatus,
  ExecutionError,
  ExecutionErrorCode
} from '@noderr/types';
import { Logger } from 'winston';
import EventEmitter from 'events';

interface IcebergState {
  orderId: string;
  symbol: string;
  totalQuantity: number;
  executedQuantity: number;
  remainingQuantity: number;
  visibleQuantity: number;
  variance: number;
  currentClip: IcebergClip | null;
  clipHistory: IcebergClip[];
  fills: Fill[];
  status: ExecutionStatus;
  startTime: number;
  endTime?: number;
  priceLevel: number;
  side: OrderSide;
  marketMicrostructure: MarketMicrostructure;
  detectionRisk: number;
}

interface IcebergClip {
  id: string;
  quantity: number;
  visibleQuantity: number;
  executedQuantity: number;
  price: number;
  status: 'pending' | 'active' | 'filled' | 'cancelled';
  orderId?: string;
  placedAt: number;
  filledAt?: number;
  fills: Fill[];
  detectionScore: number;
}

interface MarketMicrostructure {
  avgOrderSize: number;
  orderSizeDistribution: SizeDistribution;
  participantProfile: ParticipantProfile;
  liquidityDepth: number;
  tickSize: number;
  lastUpdate: number;
}

interface SizeDistribution {
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  max: number;
}

interface ParticipantProfile {
  retailPercentage: number;
  institutionalPercentage: number;
  algoPercentage: number;
  avgClipSize: number;
}

interface IcebergMetrics {
  totalClips: number;
  activeClips: number;
  averageClipSize: number;
  fillRate: number;
  detectionRisk: number;
  hiddenRatio: number;
  completionPercentage: number;
  effectiveSpread: number;
  priceImprovement: number;
}

export class IcebergAlgorithm extends EventEmitter {
  private logger: Logger;
  private activeOrders: Map<string, IcebergState>;
  private executionLoop?: NodeJS.Timeout;
  private microstructureAnalyzer?: NodeJS.Timeout;
  private detectionMonitor?: NodeJS.Timeout;
  private marketMicrostructure: Map<string, MarketMicrostructure>;

  constructor(logger: Logger) {
    super();
    this.logger = logger;
    this.activeOrders = new Map();
    this.marketMicrostructure = new Map();
    
    // Start monitoring loops
    this.startExecutionLoop();
    this.startMicrostructureAnalysis();
    this.startDetectionMonitoring();
  }

  /**
   * Execute order using Iceberg algorithm
   */
  async execute(
    order: Order,
    config: AlgorithmConfig,
    router: any
  ): Promise<void> {
    this.logger.info('Starting Iceberg execution', {
      orderId: order.id,
      totalQuantity: order.quantity,
      visibleQuantity: config.parameters.visibleQuantity,
      variance: config.parameters.variance
    });

    // Validate parameters
    this.validateParameters(config.parameters, order);
    
    // Analyze market microstructure
    const microstructure = await this.analyzeMarketMicrostructure(order.symbol);
    
    // Initialize Iceberg state
    const state = this.initializeIcebergState(order, config.parameters, microstructure);
    this.activeOrders.set(order.id, state);
    
    // Store microstructure data
    this.marketMicrostructure.set(order.symbol, microstructure);
    
    // Emit start event
    this.emit('executionStarted', {
      orderId: order.id,
      algorithm: 'ICEBERG',
      parameters: config.parameters,
      hiddenQuantity: order.quantity - state.visibleQuantity
    });
    
    // Place first clip
    await this.placeNextClip(order.id, router);
  }

  /**
   * Get current execution status
   */
  getExecutionStatus(orderId: string): IcebergState | null {
    return this.activeOrders.get(orderId) || null;
  }

  /**
   * Get execution metrics
   */
  getMetrics(orderId: string): IcebergMetrics | null {
    const state = this.activeOrders.get(orderId);
    if (!state) return null;
    
    return this.calculateMetrics(state);
  }

  /**
   * Update price level for limit orders
   */
  updatePriceLevel(orderId: string, newPrice: number): boolean {
    const state = this.activeOrders.get(orderId);
    if (!state || state.status !== ExecutionStatus.PARTIAL) {
      return false;
    }
    
    state.priceLevel = newPrice;
    
    // Cancel current clip if active
    if (state.currentClip && state.currentClip.status === 'active') {
      this.cancelClip(state.currentClip);
    }
    
    this.logger.info('Updated Iceberg price level', {
      orderId,
      newPrice
    });
    
    return true;
  }

  // Private methods

  private validateParameters(params: AlgorithmParameters, order: Order): void {
    if (!params.visibleQuantity || params.visibleQuantity <= 0) {
      throw new ExecutionError(
        'Invalid visible quantity',
        ExecutionErrorCode.INVALID_ORDER
      );
    }
    
    if (params.visibleQuantity >= (order.quantity ?? order.amount)) {
      throw new ExecutionError(
        'Visible quantity must be less than total quantity',
        ExecutionErrorCode.INVALID_ORDER
      );
    }
    
    if (params.variance && (params.variance < 0 || params.variance > 1)) {
      throw new ExecutionError(
        'Variance must be between 0 and 1',
        ExecutionErrorCode.INVALID_ORDER
      );
    }
  }

  private async analyzeMarketMicrostructure(symbol: string): Promise<MarketMicrostructure> {
    // In production, this would analyze real order book data
    // Mock implementation with realistic values
    
    const avgOrderSize = 0.5; // BTC
    const tickSize = 0.01; // Price tick
    
    return {
      avgOrderSize,
      orderSizeDistribution: {
        p25: avgOrderSize * 0.25,
        p50: avgOrderSize * 0.5,
        p75: avgOrderSize * 1.5,
        p90: avgOrderSize * 3,
        p95: avgOrderSize * 5,
        max: avgOrderSize * 20
      },
      participantProfile: {
        retailPercentage: 30,
        institutionalPercentage: 50,
        algoPercentage: 20,
        avgClipSize: avgOrderSize * 0.8
      },
      liquidityDepth: 100, // BTC within 10bps
      tickSize,
      lastUpdate: Date.now()
    };
  }

  private initializeIcebergState(
    order: Order,
    params: AlgorithmParameters,
    microstructure: MarketMicrostructure
  ): IcebergState {
    const visibleQuantity = params.visibleQuantity || microstructure.avgOrderSize;
    const variance = params.variance || 0.2;
    
    return {
      orderId: order.id,
      symbol: order.symbol,
      totalQuantity: order.quantity ?? order.amount,
      executedQuantity: 0,
      remainingQuantity: order.quantity ?? order.amount,
      visibleQuantity,
      variance,
      currentClip: null,
      clipHistory: [],
      fills: [],
      status: ExecutionStatus.PARTIAL,
      startTime: Date.now(),
      priceLevel: order.price || 0,
      side: order.side as OrderSide,
      marketMicrostructure: microstructure,
      detectionRisk: 0
    };
  }

  private startExecutionLoop(): void {
    this.executionLoop = setInterval(() => {
      this.processActiveOrders();
    }, 100); // Check every 100ms
  }

  private startMicrostructureAnalysis(): void {
    this.microstructureAnalyzer = setInterval(() => {
      this.updateMicrostructure();
    }, 30000); // Update every 30 seconds
  }

  private startDetectionMonitoring(): void {
    this.detectionMonitor = setInterval(() => {
      this.monitorDetectionRisk();
    }, 5000); // Check every 5 seconds
  }

  private async processActiveOrders(): Promise<void> {
    for (const [orderId, state] of this.activeOrders) {
      if (state.status !== ExecutionStatus.PARTIAL) {
        continue;
      }
      
      // Check if current clip is filled
      if (state.currentClip && state.currentClip.status === 'filled') {
        // Place next clip
        await this.placeNextClip(orderId, null);
      }
      
      // Check completion
      if (state.executedQuantity >= state.totalQuantity * 0.999) {
        this.completeExecution(orderId);
      }
    }
  }

  private async placeNextClip(orderId: string, router: any): Promise<void> {
    const state = this.activeOrders.get(orderId);
    if (!state || state.remainingQuantity <= 0) return;
    
    // Calculate clip size with variance
    const clipSize = this.calculateClipSize(state);
    
    if (clipSize < 0.0001) {
      // Remaining too small, execute as final clip
      await this.placeFinalClip(state, router);
      return;
    }
    
    // Create new clip
    const clip: IcebergClip = {
      id: `${orderId}-clip-${state.clipHistory.length}`,
      quantity: clipSize,
      visibleQuantity: Math.min(clipSize, state.visibleQuantity),
      executedQuantity: 0,
      price: state.priceLevel,
      status: 'pending',
      placedAt: Date.now(),
      fills: [],
      detectionScore: 0
    };
    
    state.currentClip = clip;
    state.clipHistory.push(clip);
    
    // Place the order
    await this.placeClipOrder(state, clip, router);
    
    this.logger.debug('Placed Iceberg clip', {
      orderId,
      clipId: clip.id,
      visibleQuantity: clip.visibleQuantity,
      hiddenQuantity: clip.quantity - clip.visibleQuantity
    });
  }

  private calculateClipSize(state: IcebergState): number {
    const baseSize = state.visibleQuantity;
    const variance = state.variance;
    
    // Apply variance to make clips less predictable
    const randomFactor = 1 + (Math.random() - 0.5) * 2 * variance;
    let clipSize = baseSize * randomFactor;
    
    // Ensure clip size is reasonable based on market microstructure
    const microstructure = state.marketMicrostructure;
    
    // Don't exceed 95th percentile to avoid standing out
    clipSize = Math.min(clipSize, microstructure.orderSizeDistribution.p95);
    
    // Adjust based on remaining quantity
    clipSize = Math.min(clipSize, state.remainingQuantity);
    
    // Round to reasonable precision
    clipSize = Math.round(clipSize * 10000) / 10000;
    
    return clipSize;
  }

  private async placeFinalClip(state: IcebergState, router: any): Promise<void> {
    const clip: IcebergClip = {
      id: `${state.orderId}-final`,
      quantity: state.remainingQuantity,
      visibleQuantity: state.remainingQuantity,
      executedQuantity: 0,
      price: state.priceLevel,
      status: 'pending',
      placedAt: Date.now(),
      fills: [],
      detectionScore: 0
    };
    
    state.currentClip = clip;
    state.clipHistory.push(clip);
    
    await this.placeClipOrder(state, clip, router);
    
    this.logger.debug('Placed final Iceberg clip', {
      orderId: state.orderId,
      quantity: clip.quantity
    });
  }

  private async placeClipOrder(
    state: IcebergState,
    clip: IcebergClip,
    router: any
  ): Promise<void> {
    // Create order for the clip
    const clipOrder: Order = {
      id: clip.id,
      clientOrderId: `iceberg-${clip.id}`,
      symbol: state.symbol,
      side: state.side,
      type: OrderType.LIMIT,
      amount: clip.visibleQuantity,
      quantity: clip.visibleQuantity,
      price: clip.price,
      timestamp: Date.now(),
      timeInForce: TimeInForce.GTC,
      status: OrderStatus.NEW,
      exchange: 'best',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: {
        algorithm: 'ICEBERG',
        parentOrder: state.orderId,
        isIcebergClip: true,
        hiddenQuantity: clip.quantity - clip.visibleQuantity
      }
    };
    
    // Execute through router or mock
    clip.status = 'active';
    clip.orderId = clipOrder.id;
    
    // Simulate execution (in production, would use router)
    this.simulateClipExecution(state, clip);
  }

  private simulateClipExecution(state: IcebergState, clip: IcebergClip): void {
    // Simulate partial fills over time
    const fillInterval = setInterval(() => {
      if (clip.status !== 'active' || clip.executedQuantity >= clip.quantity) {
        clearInterval(fillInterval);
        
        if (clip.executedQuantity >= clip.quantity) {
          this.handleClipFilled(state, clip);
        }
        return;
      }
      
      // Simulate a partial fill
      const fillSize = Math.min(
        Math.random() * clip.visibleQuantity * 0.3,
        clip.quantity - clip.executedQuantity
      );
      
      const fill: Fill = {
        id: `fill-${Date.now()}-${Math.random()}`,
        orderId: clip.orderId || clip.id,
        symbol: state.symbol,
        exchange: 'binance',
        price: clip.price,
        quantity: fillSize,
        fee: fillSize * clip.price * 0.0001,
        timestamp: Date.now(),
        side: state.side,
        liquidity: 'maker',
        tradeId: `trade-${Date.now()}`
      };
      
      clip.fills.push(fill);
      clip.executedQuantity += fillSize;
      
      // Update state
      state.executedQuantity += fillSize;
      state.remainingQuantity -= fillSize;
      state.fills.push(fill);
      
      // Check if visible portion is filled
      if (clip.executedQuantity >= clip.visibleQuantity && 
          clip.executedQuantity < clip.quantity) {
        // Replenish visible quantity
        clip.visibleQuantity = Math.min(
          state.visibleQuantity,
          clip.quantity - clip.executedQuantity
        );
        
        this.logger.debug('Replenishing Iceberg clip', {
          clipId: clip.id,
          newVisibleQuantity: clip.visibleQuantity
        });
      }
      
      // Emit fill event
      this.emit('clipFill', {
        orderId: state.orderId,
        clipId: clip.id,
        fill,
        progress: state.executedQuantity / state.totalQuantity
      });
      
    }, 100 + Math.random() * 900); // Random interval 100-1000ms
  }

  private handleClipFilled(state: IcebergState, clip: IcebergClip): void {
    clip.status = 'filled';
    clip.filledAt = Date.now();
    
    this.logger.debug('Iceberg clip filled', {
      orderId: state.orderId,
      clipId: clip.id,
      executionTime: clip.filledAt - clip.placedAt
    });
    
    // Calculate detection score for the clip
    clip.detectionScore = this.calculateDetectionScore(state, clip);
    
    // Update overall detection risk
    this.updateDetectionRisk(state);
  }

  private cancelClip(clip: IcebergClip): void {
    if (clip.status === 'active') {
      clip.status = 'cancelled';
      this.logger.debug('Cancelled Iceberg clip', { clipId: clip.id });
    }
  }

  private calculateDetectionScore(state: IcebergState, clip: IcebergClip): number {
    let score = 0;
    
    // Factor 1: Clip size consistency
    const avgClipSize = state.clipHistory
      .filter(c => c.status === 'filled')
      .reduce((sum, c) => sum + c.quantity, 0) / Math.max(1, state.clipHistory.length - 1);
    
    if (avgClipSize > 0) {
      const sizeDeviation = Math.abs(clip.quantity - avgClipSize) / avgClipSize;
      if (sizeDeviation < 0.1) {
        score += 0.3; // Too consistent
      }
    }
    
    // Factor 2: Timing pattern
    const timingScore = this.analyzeTimingPattern(state);
    score += timingScore * 0.3;
    
    // Factor 3: Price level persistence
    const samePriceClips = state.clipHistory.filter(
      c => c.price === clip.price && c.status === 'filled'
    ).length;
    if (samePriceClips > 3) {
      score += 0.2;
    }
    
    // Factor 4: Size relative to market
    const sizePercentile = this.getOrderSizePercentile(
      clip.quantity,
      state.marketMicrostructure
    );
    if (sizePercentile > 90) {
      score += 0.2; // Large orders are more noticeable
    }
    
    return Math.min(1, score);
  }

  private analyzeTimingPattern(state: IcebergState): number {
    const filledClips = state.clipHistory.filter(c => c.status === 'filled');
    if (filledClips.length < 3) return 0;
    
    // Calculate inter-arrival times
    const intervals: number[] = [];
    for (let i = 1; i < filledClips.length; i++) {
      intervals.push(filledClips[i].placedAt - filledClips[i-1].placedAt);
    }
    
    // Check for regular pattern
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance = intervals.reduce((sum, i) => sum + Math.pow(i - avgInterval, 2), 0) / intervals.length;
    const coefficientOfVariation = Math.sqrt(variance) / avgInterval;
    
    // Low CV indicates regular pattern
    return coefficientOfVariation < 0.3 ? 0.8 : 0;
  }

  private getOrderSizePercentile(size: number, microstructure: MarketMicrostructure): number {
    const dist = microstructure.orderSizeDistribution;
    
    if (size <= dist.p25) return 25;
    if (size <= dist.p50) return 50;
    if (size <= dist.p75) return 75;
    if (size <= dist.p90) return 90;
    if (size <= dist.p95) return 95;
    return 99;
  }

  private updateDetectionRisk(state: IcebergState): void {
    const scores = state.clipHistory
      .filter(c => c.status === 'filled')
      .map(c => c.detectionScore);
    
    if (scores.length === 0) {
      state.detectionRisk = 0;
      return;
    }
    
    // Weighted average with recent clips having more weight
    let weightedSum = 0;
    let weightSum = 0;
    
    for (let i = 0; i < scores.length; i++) {
      const weight = Math.pow(0.9, scores.length - i - 1); // Exponential decay
      weightedSum += scores[i] * weight;
      weightSum += weight;
    }
    
    state.detectionRisk = weightedSum / weightSum;
    
    // Alert if detection risk is high
    if (state.detectionRisk > 0.7) {
      this.logger.warn('High Iceberg detection risk', {
        orderId: state.orderId,
        risk: state.detectionRisk
      });
      
      // Adjust strategy
      this.adjustStrategyForDetection(state);
    }
  }

  private adjustStrategyForDetection(state: IcebergState): void {
    // Increase variance to make pattern less predictable
    state.variance = Math.min(0.5, state.variance * 1.5);
    
    // Consider changing price levels
    const tickSize = state.marketMicrostructure.tickSize;
    const priceAdjustment = (Math.random() - 0.5) * tickSize * 5;
    state.priceLevel += priceAdjustment;
    
    this.logger.info('Adjusted Iceberg strategy for detection avoidance', {
      orderId: state.orderId,
      newVariance: state.variance,
      priceAdjustment
    });
  }

  private updateMicrostructure(): void {
    for (const [symbol, microstructure] of this.marketMicrostructure) {
      // Simulate microstructure updates
      // In production, would fetch real data
      microstructure.avgOrderSize *= (0.95 + Math.random() * 0.1);
      microstructure.liquidityDepth *= (0.9 + Math.random() * 0.2);
      microstructure.lastUpdate = Date.now();
    }
  }

  private monitorDetectionRisk(): void {
    for (const [orderId, state] of this.activeOrders) {
      if (state.status !== ExecutionStatus.PARTIAL) continue;
      
      // Recalculate detection risk
      this.updateDetectionRisk(state);
      
      // Emit risk update
      if (state.detectionRisk > 0.5) {
        this.emit('detectionRiskAlert', {
          orderId,
          risk: state.detectionRisk,
          clipsExecuted: state.clipHistory.filter(c => c.status === 'filled').length
        });
      }
    }
  }

  private calculateMetrics(state: IcebergState): IcebergMetrics {
    const filledClips = state.clipHistory.filter(c => c.status === 'filled');
    const activeClips = state.clipHistory.filter(c => c.status === 'active').length;
    
    const avgClipSize = filledClips.length > 0
      ? filledClips.reduce((sum, c) => sum + c.quantity, 0) / filledClips.length
      : 0;
    
    const fillRate = state.totalQuantity > 0
      ? state.executedQuantity / state.totalQuantity
      : 0;
    
    const hiddenRatio = state.totalQuantity > 0
      ? 1 - (state.visibleQuantity / state.totalQuantity)
      : 0;
    
    // Calculate effective spread (execution price vs initial price)
    const avgExecutionPrice = state.fills.length > 0
      ? state.fills.reduce((sum, f) => sum + f.price * f.quantity, 0) / state.executedQuantity
      : 0;
    
    const effectiveSpread = state.priceLevel > 0
      ? Math.abs(avgExecutionPrice - state.priceLevel) / state.priceLevel
      : 0;
    
    // Calculate price improvement
    const priceImprovement = state.side === OrderSide.BUY
      ? state.priceLevel - avgExecutionPrice
      : avgExecutionPrice - state.priceLevel;
    
    return {
      totalClips: state.clipHistory.length,
      activeClips,
      averageClipSize: avgClipSize,
      fillRate,
      detectionRisk: state.detectionRisk,
      hiddenRatio,
      completionPercentage: fillRate * 100,
      effectiveSpread,
      priceImprovement: Math.max(0, priceImprovement)
    };
  }

  private completeExecution(orderId: string): void {
    const state = this.activeOrders.get(orderId);
    if (!state) return;
    
    state.status = ExecutionStatus.COMPLETED;
    state.endTime = Date.now();
    
    const result = this.createExecutionResult(state);
    const metrics = this.calculateMetrics(state);
    
    this.logger.info('Iceberg execution completed', {
      orderId,
      totalClips: metrics.totalClips,
      averageClipSize: metrics.averageClipSize,
      detectionRisk: metrics.detectionRisk,
      effectiveSpread: (metrics.effectiveSpread * 10000).toFixed(1) + ' bps'
    });
    
    this.emit('executionCompleted', result);
    
    // Clean up
    setTimeout(() => {
      this.activeOrders.delete(orderId);
    }, 60000);
  }

  private createExecutionResult(state: IcebergState): ExecutionResult {
    const metrics = this.calculateMetrics(state);
    const totalValue = state.fills.reduce((sum, f) => sum + f.quantity * f.price, 0);
    const totalQuantity = state.fills.reduce((sum, f) => sum + f.quantity, 0);
    const totalFees = state.fills.reduce((sum, f) => sum + f.fee, 0);
    const averagePrice = totalQuantity > 0 ? totalValue / totalQuantity : 0;
    
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
      slippage: metrics.effectiveSpread,
      marketImpact: 0, // Iceberg minimizes market impact
      executionTime: (state.endTime || Date.now()) - state.startTime,
      routes: this.aggregateRoutes(state),
      performance: {
        slippageBps: metrics.effectiveSpread * 10000,
        implementationShortfall: 0,
        fillRate: metrics.fillRate,
        reversion: 0,
        benchmarkDeviation: 0,
        opportunityCost: 0,
        totalCost: totalFees
      }
    };
  }

  private aggregateRoutes(state: IcebergState): ExecutedRoute[] {
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
      const totalValue = exchangeFills.reduce((sum, f) => sum + f.quantity * f.price, 0);
      route.averagePrice = totalValue / route.quantity;
    }
    
    return Array.from(routeMap.values());
  }

  /**
   * Cancel Iceberg execution
   */
  cancelExecution(orderId: string): boolean {
    const state = this.activeOrders.get(orderId);
    if (!state || state.status === ExecutionStatus.COMPLETED) {
      return false;
    }
    
    // Cancel active clip
    if (state.currentClip && state.currentClip.status === 'active') {
      this.cancelClip(state.currentClip);
    }
    
    state.status = ExecutionStatus.CANCELLED;
    state.endTime = Date.now();
    
    const metrics = this.calculateMetrics(state);
    
    this.logger.info('Iceberg execution cancelled', {
      orderId,
      executedQuantity: state.executedQuantity,
      remainingQuantity: state.remainingQuantity,
      clipsExecuted: metrics.totalClips
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
   * Get all active Iceberg executions
   */
  getActiveExecutions(): Map<string, IcebergState> {
    return new Map(this.activeOrders);
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    if (this.executionLoop) {
      clearInterval(this.executionLoop);
      this.executionLoop = undefined;
    }
    
    if (this.microstructureAnalyzer) {
      clearInterval(this.microstructureAnalyzer);
      this.microstructureAnalyzer = undefined;
    }
    
    if (this.detectionMonitor) {
      clearInterval(this.detectionMonitor);
      this.detectionMonitor = undefined;
    }
    
    this.removeAllListeners();
  }
} 