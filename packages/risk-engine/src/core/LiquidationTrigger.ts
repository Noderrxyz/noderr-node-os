import {
  Portfolio,
  Position,
  LiquidationConfig,
  MarginStatus,
  MarginCallAction,
  LiquidationResult,
  RiskEngineError,
  RiskErrorCode
} from '@noderr/types';
import { Logger } from 'winston';
import EventEmitter from 'events';

export class LiquidationTrigger extends EventEmitter {
  private logger: Logger;
  private marginCallActive: Map<string, MarginCallInfo> = new Map();
  private liquidationInProgress: Set<string> = new Set();
  private priceCache: Map<string, PriceData> = new Map();

  constructor(logger: Logger) {
    super();
    this.logger = logger;
  }

  /**
   * Monitor margin levels and trigger actions as needed
   */
  async monitorMarginLevels(
    portfolio: Portfolio,
    config: LiquidationConfig
  ): Promise<MarginStatus> {
    const currentMargin = portfolio.marginAvailable + portfolio.marginUsed;
    const marginLevel = currentMargin > 0 
      ? portfolio.marginAvailable / portfolio.marginUsed 
      : 0;

    // Determine status
    let status: MarginStatus['status'] = 'safe';
    if (marginLevel < config.marginCallThreshold) {
      status = 'marginCall';
    } else if (marginLevel < config.marginCallThreshold * 1.2) {
      status = 'warning';
    }
    if (marginLevel < config.liquidationThreshold) {
      status = 'liquidation';
    }

    // Calculate time to critical levels
    const burnRate = await this.calculateMarginBurnRate(portfolio);
    const timeToMarginCall = burnRate > 0 
      ? (portfolio.marginAvailable - portfolio.marginUsed * config.marginCallThreshold) / burnRate
      : undefined;
    const timeToLiquidation = burnRate > 0
      ? (portfolio.marginAvailable - portfolio.marginUsed * config.liquidationThreshold) / burnRate
      : undefined;

    const marginStatus: MarginStatus = {
      currentMargin,
      usedMargin: portfolio.marginUsed,
      availableMargin: portfolio.marginAvailable,
      marginLevel: marginLevel * 100, // Convert to percentage
      status,
      timeToMarginCall: timeToMarginCall ? Math.max(0, timeToMarginCall) : undefined,
      timeToLiquidation: timeToLiquidation ? Math.max(0, timeToLiquidation) : undefined
    };

    // Handle status changes
    if (status === 'marginCall' && !this.marginCallActive.has(portfolio.id)) {
      await this.initiateMarginCall(portfolio, marginStatus, config);
    } else if (status === 'liquidation' && !this.liquidationInProgress.has(portfolio.id)) {
      await this.initiateLiquidation(portfolio, config);
    }

    return marginStatus;
  }

  /**
   * Calculate maintenance margin required for positions
   */
  calculateMaintenanceMargin(
    positions: Position[],
    maintenanceMarginRatio: number = 0.03
  ): number {
    let totalMaintenanceMargin = 0;

    for (const position of positions) {
      const positionValue = Math.abs(position.size * position.currentPrice);
      const maintenanceMargin = positionValue * maintenanceMarginRatio;
      
      // Add extra margin for volatile assets
      const volatilityMultiplier = this.getVolatilityMultiplier(position.symbol);
      totalMaintenanceMargin += maintenanceMargin * volatilityMultiplier;
    }

    return totalMaintenanceMargin;
  }

  /**
   * Trigger a margin call
   */
  async triggerMarginCall(
    portfolio: Portfolio,
    config: LiquidationConfig
  ): Promise<MarginCallAction[]> {
    this.logger.warn('Triggering margin call', { portfolioId: portfolio.id });
    
    const actions: MarginCallAction[] = [];
    const marginDeficit = this.calculateMarginDeficit(portfolio, config);
    
    // Option 1: Add funds
    actions.push({
      type: 'addFunds',
      amount: marginDeficit,
      deadline: Date.now() + (config.gracePeriod || 3600000), // 1 hour default
      priority: 'high'
    });

    // Option 2: Close positions
    const positionsToClose = this.selectPositionsForClosure(
      portfolio,
      marginDeficit,
      config.deleveragingStrategy
    );
    
    if (positionsToClose.length > 0) {
      actions.push({
        type: 'closePosition',
        positions: positionsToClose.map(p => p.id),
        deadline: Date.now() + (config.gracePeriod || 3600000),
        priority: 'high'
      });
    }

    // Option 3: Reduce position sizes
    const positionsToReduce = this.selectPositionsForReduction(
      portfolio,
      marginDeficit
    );
    
    if (positionsToReduce.length > 0) {
      actions.push({
        type: 'reduceSize',
        positions: positionsToReduce.map(p => p.id),
        amount: marginDeficit,
        deadline: Date.now() + (config.gracePeriod || 3600000),
        priority: 'medium'
      });
    }

    // Emit margin call event
    this.emit('marginCall', {
      portfolio,
      actions,
      marginDeficit,
      deadline: Date.now() + (config.gracePeriod || 3600000)
    });

    return actions;
  }

  /**
   * Execute liquidation
   */
  async executeLiquidation(
    portfolio: Portfolio,
    config: LiquidationConfig
  ): Promise<LiquidationResult> {
    this.logger.error('Executing liquidation', { portfolioId: portfolio.id });
    
    if (this.liquidationInProgress.has(portfolio.id)) {
      throw new RiskEngineError(
        RiskErrorCode.LIQUIDATION_FAILED,
        'Liquidation already in progress'
      );
    }

    this.liquidationInProgress.add(portfolio.id);
    const startTime = Date.now();
    const liquidatedPositions: string[] = [];
    let totalLiquidated = 0;
    let liquidationCost = 0;
    let totalSlippage = 0;

    try {
      // Sort positions based on deleveraging strategy
      const sortedPositions = this.sortPositionsForLiquidation(
        portfolio.positions,
        config.deleveragingStrategy
      );

      // Liquidate positions until margin requirements are met
      for (const position of sortedPositions) {
        if (this.isMarginSufficient(portfolio, config)) {
          break;
        }

        const liquidationOrder = await this.createLiquidationOrder(position, config);
        const executionResult = await this.executeLiquidationOrder(liquidationOrder);
        
        liquidatedPositions.push(position.id);
        totalLiquidated += executionResult.executedValue;
        liquidationCost += executionResult.fees;
        totalSlippage += executionResult.slippage;

        // Update portfolio
        this.updatePortfolioAfterLiquidation(portfolio, position, executionResult);

        // Emit position liquidation event
        this.emit('positionLiquidated', {
          position,
          executionResult,
          remainingPositions: portfolio.positions.length - liquidatedPositions.length
        });

        // Check if partial liquidation is sufficient
        if (config.partialLiquidationAllowed && 
            this.isMarginSufficient(portfolio, config)) {
          break;
        }
      }

      const finalMarginLevel = this.calculateMarginLevel(portfolio);
      
      const result: LiquidationResult = {
        liquidatedPositions,
        totalLiquidated,
        remainingExposure: this.calculateRemainingExposure(portfolio),
        liquidationCost,
        slippage: totalSlippage,
        finalMarginLevel,
        timestamp: Date.now()
      };

      // Emit liquidation complete event
      this.emit('liquidationComplete', {
        portfolio,
        result,
        duration: Date.now() - startTime
      });

      return result;

    } catch (error) {
      this.logger.error('Liquidation failed', error);
      throw new RiskEngineError(
        RiskErrorCode.LIQUIDATION_FAILED,
        'Failed to execute liquidation',
        error
      );
    } finally {
      this.liquidationInProgress.delete(portfolio.id);
    }
  }

  /**
   * Calculate the liquidation price for a position
   */
  calculateLiquidationPrice(
    position: Position,
    maintenanceMarginRatio: number = 0.03
  ): number {
    const { entryPrice, size, margin, side } = position;
    
    if (side === 'long') {
      // Long liquidation: Price drops to where margin equals maintenance requirement
      // Liquidation Price = Entry Price * (1 - (Margin - Maintenance) / Position Value)
      const marginRatio = margin / (size * entryPrice);
      const liquidationRatio = marginRatio - maintenanceMarginRatio;
      return entryPrice * (1 - liquidationRatio);
    } else {
      // Short liquidation: Price rises to where margin equals maintenance requirement
      // Liquidation Price = Entry Price * (1 + (Margin - Maintenance) / Position Value)
      const marginRatio = margin / (size * entryPrice);
      const liquidationRatio = marginRatio - maintenanceMarginRatio;
      return entryPrice * (1 + liquidationRatio);
    }
  }

  // Helper methods

  private async calculateMarginBurnRate(portfolio: Portfolio): Promise<number> {
    // Calculate rate of margin consumption based on recent price movements
    const positions = portfolio.positions;
    let totalBurnRate = 0;

    for (const position of positions) {
      const priceVolatility = await this.getRecentVolatility(position.symbol);
      const positionValue = position.size * position.currentPrice;
      const dailyRisk = positionValue * priceVolatility;
      
      // Convert to hourly burn rate
      totalBurnRate += dailyRisk / 24;
    }

    return totalBurnRate;
  }

  private async getRecentVolatility(symbol: string): Promise<number> {
    // In production, calculate from recent price data
    // Mock implementation
    const volatilities: Record<string, number> = {
      'BTC': 0.02,
      'ETH': 0.03,
      'SOL': 0.04,
      'MATIC': 0.035,
      'LINK': 0.03
    };
    
    return volatilities[symbol] || 0.03;
  }

  private getVolatilityMultiplier(symbol: string): number {
    // Higher multiplier for more volatile assets
    const multipliers: Record<string, number> = {
      'BTC': 1.0,
      'ETH': 1.2,
      'SOL': 1.5,
      'MATIC': 1.4,
      'LINK': 1.3
    };
    
    return multipliers[symbol] || 1.5;
  }

  private async initiateMarginCall(
    portfolio: Portfolio,
    marginStatus: MarginStatus,
    config: LiquidationConfig
  ): Promise<void> {
    const marginCallInfo: MarginCallInfo = {
      portfolioId: portfolio.id,
      initiatedAt: Date.now(),
      marginStatus,
      deadline: Date.now() + (config.gracePeriod || 3600000),
      actions: await this.triggerMarginCall(portfolio, config)
    };
    
    this.marginCallActive.set(portfolio.id, marginCallInfo);
  }

  private async initiateLiquidation(
    portfolio: Portfolio,
    config: LiquidationConfig
  ): Promise<void> {
    // Check grace period for margin calls
    const marginCallInfo = this.marginCallActive.get(portfolio.id);
    
    if (marginCallInfo && Date.now() < marginCallInfo.deadline) {
      this.logger.info('Liquidation delayed - margin call grace period active');
      return;
    }
    
    await this.executeLiquidation(portfolio, config);
  }

  private calculateMarginDeficit(
    portfolio: Portfolio,
    config: LiquidationConfig
  ): number {
    const requiredMargin = portfolio.marginUsed * config.marginCallThreshold;
    const currentMargin = portfolio.marginAvailable + portfolio.marginUsed;
    return Math.max(0, requiredMargin - currentMargin);
  }

  private selectPositionsForClosure(
    portfolio: Portfolio,
    marginDeficit: number,
    strategy: LiquidationConfig['deleveragingStrategy']
  ): Position[] {
    const positions = [...portfolio.positions];
    const selected: Position[] = [];
    let recoveredMargin = 0;

    // Sort based on strategy
    switch (strategy) {
      case 'worstFirst':
        positions.sort((a, b) => a.unrealizedPnL - b.unrealizedPnL);
        break;
      case 'riskWeighted':
        positions.sort((a, b) => {
          const riskA = this.calculatePositionRisk(a);
          const riskB = this.calculatePositionRisk(b);
          return riskB - riskA;
        });
        break;
      case 'proportional':
        // Keep original order for proportional reduction
        break;
      case 'optimal':
        positions.sort((a, b) => {
          const scoreA = this.calculateLiquidationScore(a);
          const scoreB = this.calculateLiquidationScore(b);
          return scoreB - scoreA;
        });
        break;
    }

    // Select positions until margin deficit is covered
    for (const position of positions) {
      if (recoveredMargin >= marginDeficit) break;
      
      selected.push(position);
      recoveredMargin += position.margin;
    }

    return selected;
  }

  private selectPositionsForReduction(
    portfolio: Portfolio,
    marginDeficit: number
  ): Position[] {
    // Select largest positions for partial reduction
    return portfolio.positions
      .sort((a, b) => {
        const valueA = a.size * a.currentPrice;
        const valueB = b.size * b.currentPrice;
        return valueB - valueA;
      })
      .slice(0, 3); // Top 3 largest positions
  }

  private sortPositionsForLiquidation(
    positions: Position[],
    strategy: LiquidationConfig['deleveragingStrategy']
  ): Position[] {
    const sorted = [...positions];

    switch (strategy) {
      case 'worstFirst':
        return sorted.sort((a, b) => a.unrealizedPnL - b.unrealizedPnL);
      
      case 'riskWeighted':
        return sorted.sort((a, b) => {
          const riskA = this.calculatePositionRisk(a);
          const riskB = this.calculatePositionRisk(b);
          return riskB - riskA;
        });
      
      case 'proportional':
        // Shuffle for fairness in proportional liquidation
        return sorted.sort(() => Math.random() - 0.5);
      
      case 'optimal':
        return sorted.sort((a, b) => {
          const scoreA = this.calculateLiquidationScore(a);
          const scoreB = this.calculateLiquidationScore(b);
          return scoreB - scoreA;
        });
      
      default:
        return sorted;
    }
  }

  private calculatePositionRisk(position: Position): number {
    const positionValue = position.size * position.currentPrice;
    const leverage = positionValue / position.margin;
    const volatilityMultiplier = this.getVolatilityMultiplier(position.symbol);
    
    return leverage * volatilityMultiplier;
  }

  private calculateLiquidationScore(position: Position): number {
    // Higher score = better to liquidate
    let score = 0;
    
    // Factor 1: Loss positions scored higher
    if (position.unrealizedPnL < 0) {
      score += Math.abs(position.unrealizedPnL) / (position.size * position.currentPrice);
    }
    
    // Factor 2: High leverage positions
    const leverage = (position.size * position.currentPrice) / position.margin;
    score += leverage / 10;
    
    // Factor 3: Liquidity (mock implementation)
    const liquidityScore = this.getAssetLiquidity(position.symbol);
    score += liquidityScore;
    
    // Factor 4: Correlation with other positions (reduce concentrated risk)
    const concentrationPenalty = this.getConcentrationScore(position.symbol);
    score += concentrationPenalty;
    
    return score;
  }

  private getAssetLiquidity(symbol: string): number {
    // Higher score for more liquid assets
    const liquidityScores: Record<string, number> = {
      'BTC': 1.0,
      'ETH': 0.9,
      'USDT': 0.95,
      'USDC': 0.95,
      'SOL': 0.7,
      'MATIC': 0.6
    };
    
    return liquidityScores[symbol] || 0.5;
  }

  private getConcentrationScore(symbol: string): number {
    // In production, calculate based on portfolio composition
    // Mock implementation
    return Math.random() * 0.5;
  }

  private isMarginSufficient(
    portfolio: Portfolio,
    config: LiquidationConfig
  ): boolean {
    const marginLevel = this.calculateMarginLevel(portfolio);
    return marginLevel >= config.marginCallThreshold;
  }

  private calculateMarginLevel(portfolio: Portfolio): number {
    if (portfolio.marginUsed === 0) return Infinity;
    return portfolio.marginAvailable / portfolio.marginUsed;
  }

  private async createLiquidationOrder(
    position: Position,
    config: LiquidationConfig
  ): Promise<LiquidationOrder> {
    const orderType = position.unrealizedPnL < 0 ? 'market' : 'limit';
    const limitPrice = orderType === 'limit' 
      ? position.currentPrice * (position.side === 'long' ? 0.995 : 1.005)
      : undefined;

    return {
      positionId: position.id,
      symbol: position.symbol,
      side: position.side === 'long' ? 'sell' : 'buy',
      size: position.size,
      orderType,
      limitPrice,
      maxSlippage: config.maxSlippage || 0.02,
      urgency: 'immediate'
    };
  }

  private async executeLiquidationOrder(
    order: LiquidationOrder
  ): Promise<ExecutionResult> {
    // In production, execute through exchange API
    // Mock implementation
    const basePrice = order.limitPrice || this.getCurrentPrice(order.symbol);
    const slippage = order.orderType === 'market' 
      ? Math.random() * order.maxSlippage 
      : 0;
    
    const executionPrice = order.side === 'sell'
      ? basePrice * (1 - slippage)
      : basePrice * (1 + slippage);
    
    const executedValue = order.size * executionPrice;
    const fees = executedValue * 0.001; // 0.1% fees
    
    return {
      orderId: `LIQ-${Date.now()}-${Math.random()}`,
      executedPrice: executionPrice,
      executedSize: order.size,
      executedValue,
      fees,
      slippage: slippage * executedValue,
      timestamp: Date.now()
    };
  }

  private getCurrentPrice(symbol: string): number {
    // In production, fetch from price feed
    const prices: Record<string, number> = {
      'BTC': 65000,
      'ETH': 3500,
      'SOL': 150,
      'MATIC': 0.8,
      'LINK': 15
    };
    
    return prices[symbol] || 100;
  }

  private updatePortfolioAfterLiquidation(
    portfolio: Portfolio,
    position: Position,
    execution: ExecutionResult
  ): void {
    // Remove liquidated position
    portfolio.positions = portfolio.positions.filter(p => p.id !== position.id);
    
    // Update portfolio values
    portfolio.marginUsed -= position.margin;
    portfolio.marginAvailable += execution.executedValue - execution.fees - position.margin;
    portfolio.totalValue = portfolio.cash + portfolio.positions.reduce(
      (sum, p) => sum + p.size * p.currentPrice,
      0
    );
    
    // Update leverage
    const totalExposure = portfolio.positions.reduce(
      (sum, p) => sum + p.size * p.currentPrice,
      0
    );
    portfolio.leverage = portfolio.totalValue > 0 
      ? totalExposure / portfolio.totalValue 
      : 0;
  }

  private calculateRemainingExposure(portfolio: Portfolio): number {
    return portfolio.positions.reduce(
      (sum, position) => sum + position.size * position.currentPrice,
      0
    );
  }
}

// Supporting interfaces
interface MarginCallInfo {
  portfolioId: string;
  initiatedAt: number;
  marginStatus: MarginStatus;
  deadline: number;
  actions: MarginCallAction[];
}

interface LiquidationOrder {
  positionId: string;
  symbol: string;
  side: 'buy' | 'sell';
  size: number;
  orderType: 'market' | 'limit';
  limitPrice?: number;
  maxSlippage: number;
  urgency: 'immediate' | 'normal';
}

interface ExecutionResult {
  orderId: string;
  executedPrice: number;
  executedSize: number;
  executedValue: number;
  fees: number;
  slippage: number;
  timestamp: number;
}

interface PriceData {
  symbol: string;
  price: number;
  timestamp: number;
  source: string;
} 