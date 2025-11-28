import {
  Portfolio,
  Position,
  LiquidationConfig,
  MarginStatus,
  MarginCallAction,
  LiquidationResult,
  RiskTelemetryEvent,
  TelemetryClient
} from './types';
import { EventEmitter } from 'events';

/**
 * Institutional-grade Liquidation Trigger
 * Monitors margin levels and executes liquidations to protect capital
 */
export class LiquidationTrigger extends EventEmitter {
  private config: LiquidationConfig;
  private telemetry?: TelemetryClient;
  private marginHistory: Map<string, MarginStatus[]> = new Map();
  private activeMarginCalls: Map<string, MarginCallAction> = new Map();
  
  constructor(config: LiquidationConfig, telemetry?: TelemetryClient) {
    super();
    this.config = config;
    this.telemetry = telemetry;
  }

  /**
   * Monitor margin levels and trigger actions if necessary
   */
  async monitorMarginLevels(portfolio: Portfolio): Promise<MarginStatus> {
    const startTime = Date.now();

    try {
      // Calculate current margin status
      const marginStatus = this.calculateMarginStatus(portfolio);
      
      // Store in history
      this.updateMarginHistory(portfolio.id, marginStatus);
      
      // Check for margin call or liquidation
      if (marginStatus.status === 'marginCall') {
        await this.handleMarginCall(portfolio, marginStatus);
      } else if (marginStatus.status === 'liquidation') {
        await this.handleLiquidation(portfolio, marginStatus);
      }
      
      // Calculate time to critical levels
      marginStatus.timeToMarginCall = this.calculateTimeToMarginCall(portfolio, marginStatus);
      marginStatus.timeToLiquidation = this.calculateTimeToLiquidation(portfolio, marginStatus);
      
      // Emit telemetry
      if (this.telemetry) {
        this.telemetry.track({
          eventType: 'liquidation_check',
          data: {
            portfolioId: portfolio.id,
            marginLevel: marginStatus.marginLevel,
            status: marginStatus.status,
            timeToMarginCall: marginStatus.timeToMarginCall,
            timeToLiquidation: marginStatus.timeToLiquidation
          },
          duration: Date.now() - startTime,
          timestamp: new Date()
        });
      }

      this.emit('marginStatusUpdated', marginStatus);
      return marginStatus;

    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Calculate maintenance margin requirement
   */
  calculateMaintenanceMargin(positions: Position[]): number {
    let totalMaintenanceMargin = 0;
    
    for (const position of positions) {
      const positionValue = Math.abs(position.quantity * position.currentPrice);
      const leverage = position.leverage || 1;
      
      // Base maintenance margin requirement
      let marginRequirement = 0;
      
      // Different requirements based on asset type and leverage
      if (position.symbol.includes('BTC') || position.symbol.includes('ETH')) {
        // Crypto assets - higher margin requirements
        marginRequirement = positionValue * (0.05 * leverage); // 5% base * leverage
      } else if (position.symbol.includes('SPY') || position.symbol.includes('QQQ')) {
        // Equity indices - standard requirements
        marginRequirement = positionValue * (0.025 * leverage); // 2.5% base * leverage
      } else {
        // Other assets - conservative requirement
        marginRequirement = positionValue * (0.1 * leverage); // 10% base * leverage
      }
      
      // Add extra margin for short positions
      if (position.positionType === 'short') {
        marginRequirement *= 1.5;
      }
      
      totalMaintenanceMargin += marginRequirement;
    }
    
    return totalMaintenanceMargin;
  }

  /**
   * Trigger margin call actions
   */
  async triggerMarginCall(portfolio: Portfolio): Promise<MarginCallAction[]> {
    const actions: MarginCallAction[] = [];
    const marginStatus = this.calculateMarginStatus(portfolio);
    
    // Calculate required additional margin
    const requiredMargin = this.calculateRequiredAdditionalMargin(portfolio, marginStatus);
    
    // Option 1: Add funds
    actions.push({
      type: 'addFunds',
      amount: requiredMargin,
      deadline: new Date(Date.now() + (this.config.gracePeriod || 60) * 60 * 1000)
    });
    
    // Option 2: Reduce positions
    const positionsToReduce = this.selectPositionsToReduce(portfolio, requiredMargin);
    if (positionsToReduce.length > 0) {
      actions.push({
        type: 'reducePosition',
        positions: positionsToReduce,
        deadline: new Date(Date.now() + (this.config.gracePeriod || 60) * 60 * 1000)
      });
    }
    
    // Option 3: Close positions
    const positionsToClose = this.selectPositionsToClose(portfolio, requiredMargin);
    if (positionsToClose.length > 0) {
      actions.push({
        type: 'closePosition',
        positions: positionsToClose,
        deadline: new Date(Date.now() + (this.config.gracePeriod || 60) * 60 * 1000)
      });
    }
    
    return actions;
  }

  /**
   * Execute liquidation
   */
  async executeLiquidation(
    portfolio: Portfolio,
    config?: LiquidationConfig
  ): Promise<LiquidationResult> {
    const startTime = Date.now();
    const liquidationConfig = config || this.config;
    
    try {
      const liquidatedPositions: Position[] = [];
      let totalLoss = 0;
      
      // Sort positions based on deleveraging strategy
      const sortedPositions = this.sortPositionsForLiquidation(
        portfolio.positions,
        liquidationConfig.deleveragingStrategy
      );
      
      // Calculate target margin level
      const targetMarginLevel = 0.5; // 50% margin level after liquidation
      let currentMarginLevel = this.calculateMarginLevel(portfolio);
      
      // Liquidate positions until target margin level is reached
      for (const position of sortedPositions) {
        if (currentMarginLevel >= targetMarginLevel) {
          break;
        }
        
        // Calculate liquidation price (with slippage)
        const liquidationPrice = this.calculateLiquidationPrice(position);
        const positionValue = position.quantity * position.currentPrice;
        const liquidationValue = position.quantity * liquidationPrice;
        const loss = positionValue - liquidationValue;
        
        totalLoss += loss;
        liquidatedPositions.push(position);
        
        // Update portfolio state
        portfolio.marginUsed -= position.marginRequired;
        portfolio.marginAvailable += liquidationValue;
        portfolio.totalValue -= loss;
        
        // Recalculate margin level
        currentMarginLevel = this.calculateMarginLevel(portfolio);
      }
      
      // Get remaining positions
      const liquidatedIds = new Set(liquidatedPositions.map(p => p.id));
      const remainingPositions = portfolio.positions.filter(p => !liquidatedIds.has(p.id));
      
      const result: LiquidationResult = {
        liquidatedPositions,
        totalLoss,
        remainingPositions,
        finalMarginLevel: currentMarginLevel,
        timestamp: new Date()
      };
      
      // Emit telemetry
      if (this.telemetry) {
        this.telemetry.track({
          eventType: 'liquidation_check',
          data: {
            portfolioId: portfolio.id,
            liquidatedCount: liquidatedPositions.length,
            totalLoss,
            finalMarginLevel: currentMarginLevel,
            strategy: liquidationConfig.deleveragingStrategy
          },
          duration: Date.now() - startTime,
          timestamp: new Date()
        });
      }

      this.emit('liquidationExecuted', result);
      return result;

    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Calculate liquidation price for a position
   */
  calculateLiquidationPrice(position: Position): number {
    // Base liquidation price
    let liquidationPrice = position.currentPrice;
    
    // Apply slippage based on position size and market conditions
    const positionValue = Math.abs(position.quantity * position.currentPrice);
    let slippage = 0;
    
    // Size-based slippage
    if (positionValue > 1000000) {
      slippage = 0.02; // 2% for large positions
    } else if (positionValue > 100000) {
      slippage = 0.01; // 1% for medium positions
    } else {
      slippage = 0.005; // 0.5% for small positions
    }
    
    // Additional slippage for illiquid assets
    if (position.symbol.includes('ALT') || position.symbol.includes('SMALL')) {
      slippage *= 2;
    }
    
    // Apply slippage based on position type
    if (position.positionType === 'long') {
      liquidationPrice *= (1 - slippage);
    } else {
      liquidationPrice *= (1 + slippage);
    }
    
    return liquidationPrice;
  }

  /**
   * Private helper methods
   */
  
  private calculateMarginStatus(portfolio: Portfolio): MarginStatus {
    const marginLevel = this.calculateMarginLevel(portfolio);
    
    let status: 'safe' | 'warning' | 'marginCall' | 'liquidation' = 'safe';
    
    if (marginLevel <= this.config.liquidationThreshold) {
      status = 'liquidation';
    } else if (marginLevel <= this.config.marginCallThreshold) {
      status = 'marginCall';
    } else if (marginLevel <= this.config.marginCallThreshold * 1.25) {
      status = 'warning';
    }
    
    return {
      marginUsed: portfolio.marginUsed,
      marginAvailable: portfolio.marginAvailable,
      marginLevel,
      status
    };
  }

  private calculateMarginLevel(portfolio: Portfolio): number {
    const totalMargin = portfolio.marginUsed + portfolio.marginAvailable;
    return totalMargin > 0 ? portfolio.marginAvailable / totalMargin : 0;
  }

  private updateMarginHistory(portfolioId: string, status: MarginStatus): void {
    const history = this.marginHistory.get(portfolioId) || [];
    history.push(status);
    
    // Keep last 100 entries
    if (history.length > 100) {
      history.shift();
    }
    
    this.marginHistory.set(portfolioId, history);
  }

  private async handleMarginCall(portfolio: Portfolio, marginStatus: MarginStatus): Promise<void> {
    // Check if margin call already active
    const existingCall = this.activeMarginCalls.get(portfolio.id);
    if (existingCall) {
      return;
    }
    
    // Trigger margin call actions
    const actions = await this.triggerMarginCall(portfolio);
    
    // Store active margin call
    if (actions.length > 0) {
      this.activeMarginCalls.set(portfolio.id, actions[0]);
      this.emit('marginCallTriggered', {
        portfolio,
        marginStatus,
        actions
      });
    }
  }

  private async handleLiquidation(portfolio: Portfolio, marginStatus: MarginStatus): Promise<void> {
    // Check grace period
    const activeCall = this.activeMarginCalls.get(portfolio.id);
    if (activeCall && activeCall.deadline > new Date()) {
      // Still in grace period
      return;
    }
    
    // Execute liquidation
    const result = await this.executeLiquidation(portfolio);
    
    // Clear active margin call
    this.activeMarginCalls.delete(portfolio.id);
    
    this.emit('liquidationTriggered', {
      portfolio,
      marginStatus,
      result
    });
  }

  private calculateTimeToMarginCall(portfolio: Portfolio, currentStatus: MarginStatus): number | undefined {
    if (currentStatus.status === 'marginCall' || currentStatus.status === 'liquidation') {
      return 0;
    }
    
    // Analyze margin trend
    const history = this.marginHistory.get(portfolio.id) || [];
    if (history.length < 2) {
      return undefined;
    }
    
    // Calculate rate of margin decline
    const recentHistory = history.slice(-10);
    const marginDeclineRate = this.calculateMarginDeclineRate(recentHistory);
    
    if (marginDeclineRate <= 0) {
      return undefined; // Margin improving
    }
    
    // Estimate time to margin call
    const marginToCall = currentStatus.marginLevel - this.config.marginCallThreshold;
    const timeToCall = marginToCall / marginDeclineRate;
    
    return Math.max(0, timeToCall * 60); // Convert to minutes
  }

  private calculateTimeToLiquidation(portfolio: Portfolio, currentStatus: MarginStatus): number | undefined {
    if (currentStatus.status === 'liquidation') {
      return 0;
    }
    
    // Analyze margin trend
    const history = this.marginHistory.get(portfolio.id) || [];
    if (history.length < 2) {
      return undefined;
    }
    
    // Calculate rate of margin decline
    const recentHistory = history.slice(-10);
    const marginDeclineRate = this.calculateMarginDeclineRate(recentHistory);
    
    if (marginDeclineRate <= 0) {
      return undefined; // Margin improving
    }
    
    // Estimate time to liquidation
    const marginToLiquidation = currentStatus.marginLevel - this.config.liquidationThreshold;
    const timeToLiquidation = marginToLiquidation / marginDeclineRate;
    
    return Math.max(0, timeToLiquidation * 60); // Convert to minutes
  }

  private calculateMarginDeclineRate(history: MarginStatus[]): number {
    if (history.length < 2) {
      return 0;
    }
    
    // Simple linear regression
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    const n = history.length;
    
    for (let i = 0; i < n; i++) {
      const x = i;
      const y = history[i].marginLevel;
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumX2 += x * x;
    }
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    return -slope; // Negative slope means declining margin
  }

  private calculateRequiredAdditionalMargin(portfolio: Portfolio, marginStatus: MarginStatus): number {
    const targetMarginLevel = this.config.marginCallThreshold * 1.5; // 50% above margin call
    const currentTotal = portfolio.marginUsed + portfolio.marginAvailable;
    const requiredAvailable = targetMarginLevel * currentTotal;
    const additionalRequired = requiredAvailable - portfolio.marginAvailable;
    
    return Math.max(0, additionalRequired);
  }

  private selectPositionsToReduce(portfolio: Portfolio, requiredMargin: number): Position[] {
    const positions: Position[] = [];
    let marginFreed = 0;
    
    // Sort by profit/loss ratio (reduce losers first)
    const sortedPositions = [...portfolio.positions].sort((a, b) => 
      a.unrealizedPnL - b.unrealizedPnL
    );
    
    for (const position of sortedPositions) {
      if (marginFreed >= requiredMargin) {
        break;
      }
      
      // Reduce position by 50%
      const reducedPosition = {
        ...position,
        quantity: position.quantity * 0.5
      };
      
      positions.push(reducedPosition);
      marginFreed += position.marginRequired * 0.5;
    }
    
    return positions;
  }

  private selectPositionsToClose(portfolio: Portfolio, requiredMargin: number): Position[] {
    const positions: Position[] = [];
    let marginFreed = 0;
    
    // Sort by profit/loss ratio (close losers first)
    const sortedPositions = [...portfolio.positions].sort((a, b) => 
      a.unrealizedPnL - b.unrealizedPnL
    );
    
    for (const position of sortedPositions) {
      if (marginFreed >= requiredMargin) {
        break;
      }
      
      positions.push(position);
      marginFreed += position.marginRequired;
    }
    
    return positions;
  }

  private sortPositionsForLiquidation(
    positions: Position[],
    strategy: 'proportional' | 'worstFirst' | 'riskWeighted'
  ): Position[] {
    switch (strategy) {
      case 'worstFirst':
        // Liquidate worst performing positions first
        return [...positions].sort((a, b) => a.unrealizedPnL - b.unrealizedPnL);
        
      case 'riskWeighted':
        // Liquidate highest risk positions first
        return [...positions].sort((a, b) => {
          const riskA = (a.leverage || 1) * Math.abs(a.quantity * a.currentPrice);
          const riskB = (b.leverage || 1) * Math.abs(b.quantity * b.currentPrice);
          return riskB - riskA;
        });
        
      case 'proportional':
      default:
        // Liquidate proportionally (largest positions first)
        return [...positions].sort((a, b) => {
          const valueA = Math.abs(a.quantity * a.currentPrice);
          const valueB = Math.abs(b.quantity * b.currentPrice);
          return valueB - valueA;
        });
    }
  }

  /**
   * Clear margin call for a portfolio
   */
  clearMarginCall(portfolioId: string): void {
    this.activeMarginCalls.delete(portfolioId);
  }

  /**
   * Get active margin calls
   */
  getActiveMarginCalls(): Map<string, MarginCallAction> {
    return new Map(this.activeMarginCalls);
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<LiquidationConfig>): void {
    this.config = { ...this.config, ...config };
  }
} 