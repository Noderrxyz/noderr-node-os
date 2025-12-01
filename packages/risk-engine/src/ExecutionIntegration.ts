import { Logger } from 'winston';
import { EventEmitter } from 'events';
import {
  Order,
  OrderSide,
  OrderType,
  OrderStatus,
  RoutingDecision,
  ExecutionResult,
  RiskCheckResult,
  Position,
  RiskLimits,
  RiskViolationType,
  MarketCondition
} from './types';

export interface RiskAwareRoutingOptions {
  maxSlippage: number;
  urgency: 'low' | 'medium' | 'high' | 'critical';
  venueRestrictions?: string[];
  splitAllowed?: boolean;
  darkPoolAllowed?: boolean;
}

export interface ExecutionRiskUpdate {
  orderId: string;
  executedQuantity: number;
  averagePrice: number;
  fees: number;
  timestamp: number;
}

export class RiskViolationError extends Error {
  constructor(
    public violationType: RiskViolationType,
    public details: any,
    message: string
  ) {
    super(message);
    this.name = 'RiskViolationError';
  }
}

export class RiskAwareExecutionGateway extends EventEmitter {
  private logger: Logger;
  private riskEngine: any; // Would be typed RiskEngine
  private executionRouter: any; // Would be typed SmartOrderRouter
  private positionManager: any; // Would be typed PositionManager
  private activeOrders: Map<string, Order>;
  private riskLimits: RiskLimits;
  private marketCondition: MarketCondition;

  constructor(
    logger: Logger,
    riskEngine: any,
    executionRouter: any,
    positionManager: any
  ) {
    super();
    this.logger = logger;
    this.riskEngine = riskEngine;
    this.executionRouter = executionRouter;
    this.positionManager = positionManager;
    this.activeOrders = new Map();
    this.marketCondition = MarketCondition.NORMAL;
    
    // Initialize risk limits
    this.riskLimits = {
      maxPositionSize: 1000000, // $1M
      maxLeverage: 3,
      maxDailyLoss: 50000, // $50k
      maxOrderSize: 100000, // $100k
      maxOpenOrders: 50,
      marginRequirement: 0.3 // 30%
    };
    
    this.setupEventHandlers();
  }

  /**
   * Validate and route order with risk checks
   */
  async validateAndRoute(order: Order): Promise<RoutingDecision> {
    const startTime = Date.now();
    
    this.logger.info('Processing order through risk gateway', {
      orderId: order.id,
      symbol: order.symbol,
      side: order.side,
      quantity: order.quantity
    });

    try {
      // 1. Pre-execution risk check
      const riskCheck = await this.performRiskCheck(order);
      if (!riskCheck.approved) {
        throw new RiskViolationError(
          riskCheck.violationType!,
          riskCheck.details,
          riskCheck.reason || 'Risk check failed'
        );
      }

      // 2. Apply position limits and adjustments
      const adjustedOrder = await this.applyPositionLimits(order, riskCheck);

      // 3. Check market conditions
      await this.checkMarketConditions(adjustedOrder);

      // 4. Route with risk parameters
      const routingOptions = this.buildRoutingOptions(riskCheck);
      const routing = await this.executionRouter.routeOrder(adjustedOrder, routingOptions);

      // 5. Validate routing against risk constraints
      await this.validateRouting(routing, adjustedOrder, riskCheck);

      // 6. Register order for monitoring
      this.activeOrders.set(order.id, adjustedOrder);

      // 7. Emit pre-execution event
      this.emit('order:pre-execution', {
        order: adjustedOrder,
        routing,
        riskCheck,
        timestamp: Date.now()
      });

      this.logger.info('Order approved and routed', {
        orderId: order.id,
        executionTime: Date.now() - startTime,
        routes: routing.routes.length
      });

      return routing;

    } catch (error) {
      this.logger.error('Risk-aware routing failed', {
        orderId: order.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      this.emit('order:rejected', {
        order,
        reason: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now()
      });
      
      throw error;
    }
  }

  /**
   * Perform comprehensive risk check
   */
  private async performRiskCheck(order: Order): Promise<RiskCheckResult> {
    // Get current positions
    const positions = await this.positionManager.getPositions(order.symbol);
    const totalExposure = this.calculateTotalExposure(positions);

    // Check various risk constraints
    const checks = await Promise.all([
      this.checkPositionLimits(order, totalExposure),
      this.checkLeverage(order, positions),
      this.checkDailyLoss(order),
      this.checkMarginRequirements(order, positions),
      this.checkOrderLimits(order),
      this.checkConcentrationRisk(order, positions)
    ]);

    // Aggregate results
    const failedCheck = checks.find(check => !check.approved);
    if (failedCheck) {
      return failedCheck;
    }

    // Calculate risk metrics
    const maxSlippage = this.calculateMaxSlippage(order, this.marketCondition);
    const urgency = this.determineUrgency(order, positions);

    return {
      approved: true,
      maxSlippage,
      urgency,
      allowedVenues: await this.getApprovedVenues(order),
      adjustedSize: order.quantity,
      riskScore: this.calculateRiskScore(order, positions),
      timestamp: Date.now()
    };
  }

  /**
   * Apply position limits and size adjustments
   */
  private async applyPositionLimits(
    order: Order, 
    riskCheck: RiskCheckResult
  ): Promise<Order> {
    const adjustedOrder = { ...order };

    // Apply size limits
    if (riskCheck.adjustedSize && riskCheck.adjustedSize < order.quantity) {
      adjustedOrder.quantity = riskCheck.adjustedSize;
      
      this.logger.warn('Order size adjusted for risk', {
        orderId: order.id,
        originalSize: order.quantity,
        adjustedSize: adjustedOrder.quantity
      });
    }

    // Apply price limits for limit orders
    if (order.type === OrderType.LIMIT && order.price) {
      const priceLimit = await this.calculatePriceLimit(order);
      if (order.side === OrderSide.BUY && order.price > priceLimit) {
        adjustedOrder.price = priceLimit;
      } else if (order.side === OrderSide.SELL && order.price < priceLimit) {
        adjustedOrder.price = priceLimit;
      }
    }

    // Add risk metadata
    adjustedOrder.metadata = {
      ...adjustedOrder.metadata,
      riskAdjusted: true,
      riskScore: riskCheck.riskScore,
      maxSlippage: riskCheck.maxSlippage
    };

    return adjustedOrder;
  }

  /**
   * Check market conditions
   */
  private async checkMarketConditions(order: Order): Promise<void> {
    const marketData = await this.getMarketData(order.symbol);
    
    // Check for extreme volatility
    if (marketData.volatility > 0.05) { // 5% volatility
      this.marketCondition = MarketCondition.VOLATILE;
      
      if (marketData.volatility > 0.1) { // 10% volatility
        this.marketCondition = MarketCondition.EXTREME;
        
        // Reject market orders in extreme conditions
        if (order.type === OrderType.MARKET) {
          throw new RiskViolationError(
            RiskViolationType.MARKET_CONDITION,
            { volatility: marketData.volatility },
            'Market orders not allowed in extreme volatility'
          );
        }
      }
    }

    // Check liquidity
    if (marketData.liquidityScore < 0.3) { // Low liquidity
      if (order.quantity > marketData.averageVolume * 0.01) { // >1% of avg volume
        throw new RiskViolationError(
          RiskViolationType.LIQUIDITY,
          { 
            orderSize: order.quantity,
            avgVolume: marketData.averageVolume 
          },
          'Insufficient liquidity for order size'
        );
      }
    }
  }

  /**
   * Build routing options based on risk check
   */
  private buildRoutingOptions(riskCheck: RiskCheckResult): RiskAwareRoutingOptions {
    return {
      maxSlippage: riskCheck.maxSlippage || 0.002, // 0.2% default
      urgency: riskCheck.urgency || 'medium',
      venueRestrictions: riskCheck.allowedVenues,
      splitAllowed: riskCheck.riskScore! < 0.7, // Allow splits for lower risk
      darkPoolAllowed: riskCheck.riskScore! < 0.5 // Dark pools for lowest risk
    };
  }

  /**
   * Validate routing decision against risk constraints
   */
  private async validateRouting(
    routing: RoutingDecision,
    order: Order,
    riskCheck: RiskCheckResult
  ): Promise<void> {
    // Check expected slippage
    if (routing.expectedSlippage > riskCheck.maxSlippage!) {
      throw new RiskViolationError(
        RiskViolationType.SLIPPAGE,
        { 
          expected: routing.expectedSlippage,
          max: riskCheck.maxSlippage 
        },
        'Expected slippage exceeds risk limits'
      );
    }

    // Validate venues
    if (riskCheck.allowedVenues && riskCheck.allowedVenues.length > 0) {
      const usedVenues = routing.routes.map(r => r.exchange);
      const unauthorizedVenues = usedVenues.filter(
        v => !riskCheck.allowedVenues!.includes(v)
      );
      
      if (unauthorizedVenues.length > 0) {
        throw new RiskViolationError(
          RiskViolationType.VENUE,
          { unauthorized: unauthorizedVenues },
          'Routing includes unauthorized venues'
        );
      }
    }

    // Check execution time
    if (routing.estimatedExecutionTime > 30000) { // 30 seconds
      this.logger.warn('Long execution time expected', {
        orderId: order.id,
        estimatedTime: routing.estimatedExecutionTime
      });
    }
  }

  /**
   * Update risk engine after execution
   */
  async updateAfterExecution(result: ExecutionResult): Promise<void> {
    const order = this.activeOrders.get(result.orderId);
    if (!order) {
      this.logger.warn('Order not found for risk update', { 
        orderId: result.orderId 
      });
      return;
    }

    try {
      // Update positions
      await this.positionManager.updatePosition({
        symbol: order.symbol,
        side: order.side,
        quantity: result.totalQuantity,
        averagePrice: result.averagePrice,
        fees: result.totalFees
      });

      // Update risk metrics
      await this.riskEngine.updateMetrics({
        orderId: result.orderId,
        pnl: this.calculatePnL(order, result),
        slippage: result.slippage,
        fees: result.totalFees
      });

      // Update daily statistics
      await this.updateDailyStats(result);

      // Remove from active orders
      this.activeOrders.delete(result.orderId);

      // Emit post-execution event
      this.emit('order:post-execution', {
        order,
        result,
        timestamp: Date.now()
      });

    } catch (error) {
      this.logger.error('Failed to update risk after execution', {
        orderId: result.orderId,
        error
      });
    }
  }

  /**
   * Setup event handlers
   */
  private setupEventHandlers(): void {
    // Listen to execution events
    this.executionRouter.on('orderRouted', (event: any) => {
      this.emit('execution:routed', event);
    });

    this.executionRouter.on('orderFilled', async (event: any) => {
      await this.handlePartialFill(event);
    });

    this.executionRouter.on('orderCompleted', async (event: any) => {
      await this.updateAfterExecution(event.result);
    });

    // Listen to risk events
    this.riskEngine.on('limitBreach', (event: any) => {
      this.handleLimitBreach(event);
    });

    this.riskEngine.on('marginCall', (event: any) => {
      this.handleMarginCall(event);
    });
  }

  /**
   * Handle partial fills
   */
  private async handlePartialFill(event: any): Promise<void> {
    const update: ExecutionRiskUpdate = {
      orderId: event.orderId,
      executedQuantity: event.fill.quantity,
      averagePrice: event.fill.price,
      fees: event.fill.fee,
      timestamp: event.timestamp
    };

    await this.riskEngine.updatePartialExecution(update);
  }

  /**
   * Handle limit breach
   */
  private handleLimitBreach(event: any): void {
    this.logger.error('Risk limit breached', event);
    
    // Cancel all active orders for the symbol
    for (const [orderId, order] of this.activeOrders) {
      if (order.symbol === event.symbol) {
        this.executionRouter.cancelOrder(orderId);
      }
    }
    
    this.emit('risk:limit-breach', event);
  }

  /**
   * Handle margin call
   */
  private handleMarginCall(event: any): void {
    this.logger.error('Margin call triggered', event);
    
    // Implement emergency liquidation logic
    this.emit('risk:margin-call', event);
  }

  // Helper methods

  private calculateTotalExposure(positions: Position[]): number {
    return positions.reduce((total, pos) => 
      total + Math.abs(pos.quantity * pos.averagePrice), 0
    );
  }

  private async checkPositionLimits(
    order: Order, 
    currentExposure: number
  ): Promise<RiskCheckResult> {
    const orderValue = order.quantity * (order.price || 0);
    const newExposure = currentExposure + orderValue;

    if (newExposure > this.riskLimits.maxPositionSize) {
      return {
        approved: false,
        violationType: RiskViolationType.POSITION_LIMIT,
        reason: `Position size would exceed limit: ${newExposure} > ${this.riskLimits.maxPositionSize}`,
        details: { currentExposure, orderValue, limit: this.riskLimits.maxPositionSize }
      };
    }

    return { approved: true };
  }

  private async checkLeverage(
    order: Order,
    positions: Position[]
  ): Promise<RiskCheckResult> {
    // Implementation would calculate actual leverage
    const currentLeverage = 2.5; // Mock
    
    if (currentLeverage > this.riskLimits.maxLeverage) {
      return {
        approved: false,
        violationType: RiskViolationType.LEVERAGE,
        reason: `Leverage exceeds limit: ${currentLeverage} > ${this.riskLimits.maxLeverage}`,
        details: { currentLeverage, limit: this.riskLimits.maxLeverage }
      };
    }

    return { approved: true };
  }

  private async checkDailyLoss(order: Order): Promise<RiskCheckResult> {
    const dailyPnL = await this.riskEngine.getDailyPnL();
    
    if (dailyPnL < -this.riskLimits.maxDailyLoss) {
      return {
        approved: false,
        violationType: RiskViolationType.DAILY_LOSS,
        reason: `Daily loss limit reached: ${dailyPnL}`,
        details: { dailyPnL, limit: -this.riskLimits.maxDailyLoss }
      };
    }

    return { approved: true };
  }

  private async checkMarginRequirements(
    order: Order,
    positions: Position[]
  ): Promise<RiskCheckResult> {
    const requiredMargin = order.quantity * (order.price || 0) * this.riskLimits.marginRequirement;
    const availableMargin = await this.positionManager.getAvailableMargin();

    if (availableMargin < requiredMargin) {
      return {
        approved: false,
        violationType: RiskViolationType.MARGIN,
        reason: `Insufficient margin: ${availableMargin} < ${requiredMargin}`,
        details: { availableMargin, requiredMargin }
      };
    }

    return { approved: true };
  }

  private async checkOrderLimits(order: Order): Promise<RiskCheckResult> {
    const orderValue = order.quantity * (order.price || 0);
    
    if (orderValue > this.riskLimits.maxOrderSize) {
      return {
        approved: false,
        violationType: RiskViolationType.ORDER_SIZE,
        reason: `Order size exceeds limit: ${orderValue} > ${this.riskLimits.maxOrderSize}`,
        details: { orderValue, limit: this.riskLimits.maxOrderSize }
      };
    }

    if (this.activeOrders.size >= this.riskLimits.maxOpenOrders) {
      return {
        approved: false,
        violationType: RiskViolationType.ORDER_COUNT,
        reason: `Too many open orders: ${this.activeOrders.size} >= ${this.riskLimits.maxOpenOrders}`,
        details: { openOrders: this.activeOrders.size, limit: this.riskLimits.maxOpenOrders }
      };
    }

    return { approved: true };
  }

  private async checkConcentrationRisk(
    order: Order,
    positions: Position[]
  ): Promise<RiskCheckResult> {
    // Check if too concentrated in one asset
    const symbolExposure = positions
      .filter(p => p.symbol === order.symbol)
      .reduce((sum, p) => sum + Math.abs(p.quantity * p.averagePrice), 0);
    
    const totalExposure = this.calculateTotalExposure(positions);
    const concentration = totalExposure > 0 ? symbolExposure / totalExposure : 0;

    if (concentration > 0.3) { // 30% concentration limit
      return {
        approved: false,
        violationType: RiskViolationType.CONCENTRATION,
        reason: `Concentration risk too high: ${(concentration * 100).toFixed(1)}%`,
        details: { concentration, symbolExposure, totalExposure }
      };
    }

    return { approved: true };
  }

  private calculateMaxSlippage(order: Order, marketCondition: MarketCondition): number {
    const baseSlippage = 0.001; // 0.1%
    
    const multipliers: Record<MarketCondition, number> = {
      [MarketCondition.CALM]: 0.5,
      [MarketCondition.NORMAL]: 1,
      [MarketCondition.VOLATILE]: 2,
      [MarketCondition.EXTREME]: 5
    };

    return baseSlippage * multipliers[marketCondition];
  }

  private determineUrgency(
    order: Order, 
    positions: Position[]
  ): 'low' | 'medium' | 'high' | 'critical' {
    // Determine based on order metadata and market conditions
    if (order.metadata?.urgency) {
      return order.metadata.urgency as any;
    }

    if (this.marketCondition === MarketCondition.EXTREME) {
      return 'high';
    }

    // Check if closing position
    const isClosing = positions.some(p => 
      p.symbol === order.symbol && 
      ((p.quantity > 0 && order.side === OrderSide.SELL) ||
       (p.quantity < 0 && order.side === OrderSide.BUY))
    );

    return isClosing ? 'high' : 'medium';
  }

  private async getApprovedVenues(order: Order): Promise<string[]> {
    // Get list of approved venues based on risk profile
    const allVenues = await this.executionRouter.getAvailableVenues();
    
    // Filter based on risk criteria
    return allVenues.filter(venue => {
      // Add venue-specific risk checks
      return true; // Simplified
    });
  }

  private calculateRiskScore(order: Order, positions: Position[]): number {
    // Calculate 0-1 risk score
    let score = 0;

    // Size risk
    const orderValue = order.quantity * (order.price || 0);
    score += Math.min(orderValue / this.riskLimits.maxOrderSize, 1) * 0.3;

    // Leverage risk
    score += Math.min(2.5 / this.riskLimits.maxLeverage, 1) * 0.3;

    // Concentration risk
    score += 0.2 * 0.2; // Simplified

    // Market condition risk
    const conditionScores: Record<MarketCondition, number> = {
      [MarketCondition.CALM]: 0,
      [MarketCondition.NORMAL]: 0.2,
      [MarketCondition.VOLATILE]: 0.6,
      [MarketCondition.EXTREME]: 1
    };
    score += conditionScores[this.marketCondition] * 0.2;

    return Math.min(score, 1);
  }

  private async calculatePriceLimit(order: Order): Promise<number> {
    const marketPrice = await this.getMarketPrice(order.symbol);
    const maxDeviation = 0.02; // 2% from market

    if (order.side === OrderSide.BUY) {
      return marketPrice * (1 + maxDeviation);
    } else {
      return marketPrice * (1 - maxDeviation);
    }
  }

  private async getMarketData(symbol: string): Promise<any> {
    // Mock implementation
    return {
      volatility: 0.03,
      liquidityScore: 0.8,
      averageVolume: 1000000,
      spread: 0.0001
    };
  }

  private async getMarketPrice(symbol: string): Promise<number> {
    // Mock implementation
    return 50000; // BTC price
  }

  private calculatePnL(order: Order, result: ExecutionResult): number {
    // Simplified P&L calculation
    const expectedValue = order.quantity * (order.price || 0);
    const actualValue = result.totalQuantity * result.averagePrice;
    
    if (order.side === OrderSide.BUY) {
      return expectedValue - actualValue - result.totalFees;
    } else {
      return actualValue - expectedValue - result.totalFees;
    }
  }

  private async updateDailyStats(result: ExecutionResult): Promise<void> {
    // Update daily trading statistics
    await this.riskEngine.updateDailyStats({
      volume: result.totalQuantity * result.averagePrice,
      fees: result.totalFees,
      orderCount: 1,
      slippage: result.slippage
    });
  }

  /**
   * Get current risk metrics
   */
  async getRiskMetrics(): Promise<any> {
    return {
      activeOrders: this.activeOrders.size,
      marketCondition: this.marketCondition,
      limits: this.riskLimits,
      dailyPnL: await this.riskEngine.getDailyPnL(),
      currentExposure: await this.positionManager.getTotalExposure()
    };
  }

  /**
   * Update risk limits
   */
  updateRiskLimits(limits: Partial<RiskLimits>): void {
    this.riskLimits = { ...this.riskLimits, ...limits };
    this.logger.info('Risk limits updated', this.riskLimits);
    this.emit('risk:limits-updated', this.riskLimits);
  }
} 