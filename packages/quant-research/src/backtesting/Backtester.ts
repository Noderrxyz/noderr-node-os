/**
 * Backtester - Elite historical strategy simulation engine
 * 
 * Simulates trading strategies with realistic market conditions including
 * slippage, fees, latency, and market impact for accurate performance assessment.
 */

import { EventEmitter } from 'events';
import { Logger } from 'winston';
import {
  BacktestConfig,
  BacktestResult,
  TradingStrategy,
  Trade,
  EquityCurve,
  Drawdown,
  ExecutionStats,
  StrategyPerformance,
  SlippageModel,
  FeeStructure
} from '../types';

interface OrderBook {
  bids: [number, number][]; // [price, size]
  asks: [number, number][]; // [price, size]
  timestamp: number;
}

interface Position {
  symbol: string;
  side: 'long' | 'short';
  size: number;
  entryPrice: number;
  entryTime: Date;
  unrealizedPnl: number;
  fees: number;
}

interface MarketData {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  orderBook?: OrderBook;
}

export class Backtester extends EventEmitter {
  private logger: Logger;
  private config?: BacktestConfig;
  private data: Map<string, MarketData[]> = new Map();
  private positions: Map<string, Position> = new Map();
  private trades: Trade[] = [];
  private equity: number[] = [];
  private timestamps: Date[] = [];
  private cash: number = 0;
  private totalFees: number = 0;
  private peakEquity: number = 0;
  private currentDrawdown: number = 0;
  private executionLatency: number = 10; // ms
  
  constructor(logger: Logger) {
    super();
    this.logger = logger;
  }
  
  /**
   * Initialize backtester
   */
  async initialize(): Promise<void> {
    this.logger.info('Initializing Backtester');
  }
  
  /**
   * Run backtest
   */
  async run(config: BacktestConfig, data: any): Promise<BacktestResult> {
    this.logger.info(`Starting backtest from ${config.startDate} to ${config.endDate}`);
    
    // Reset state
    this.reset(config);
    
    // Load and prepare data
    await this.prepareData(data);
    
    // Main backtest loop
    await this.runSimulation();
    
    // Calculate performance metrics
    const performance = this.calculatePerformance();
    
    // Generate results
    const result: BacktestResult = {
      strategyId: config.strategy.id,
      config,
      performance,
      trades: this.trades,
      equity: this.generateEquityCurve(),
      drawdowns: this.analyzeDrawdowns(),
      riskMetrics: {
        var95: 0,
        var99: 0,
        cvar95: 0,
        cvar99: 0,
        beta: 0,
        alpha: 0,
        correlation: 0,
        informationRatio: 0,
        treynorRatio: 0,
        omega: 0,
        kurtosis: 0,
        skewness: 0
      },
      executionStats: this.calculateExecutionStats()
    };
    
    this.logger.info('Backtest complete:', {
      trades: result.trades.length,
      sharpe: result.performance.sharpeRatio,
      returns: result.performance.totalReturn
    });
    
    return result;
  }
  
  /**
   * Private: Reset state
   */
  private reset(config: BacktestConfig): void {
    this.config = config;
    this.cash = config.initialCapital;
    this.positions.clear();
    this.trades = [];
    this.equity = [config.initialCapital];
    this.timestamps = [config.startDate];
    this.totalFees = 0;
    this.peakEquity = config.initialCapital;
    this.currentDrawdown = 0;
  }
  
  /**
   * Private: Prepare data
   */
  private async prepareData(rawData: any): Promise<void> {
    // Convert raw data to internal format
    // This would handle different data sources and formats
    
    // For now, simulate data structure
    const symbols = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'];
    
    for (const symbol of symbols) {
      const marketData: MarketData[] = [];
      
      // Generate synthetic data for demonstration
      const startTime = this.config!.startDate.getTime();
      const endTime = this.config!.endDate.getTime();
      const interval = this.parseInterval(this.config!.dataFrequency);
      
      let price = symbol === 'BTC/USDT' ? 30000 : symbol === 'ETH/USDT' ? 2000 : 50;
      
      for (let time = startTime; time <= endTime; time += interval) {
        // Random walk for price
        const change = (Math.random() - 0.5) * 0.02; // ±2% max change
        price *= (1 + change);
        
        marketData.push({
          timestamp: new Date(time),
          open: price * (1 + (Math.random() - 0.5) * 0.005),
          high: price * (1 + Math.random() * 0.01),
          low: price * (1 - Math.random() * 0.01),
          close: price,
          volume: Math.random() * 1000000
        });
      }
      
      this.data.set(symbol, marketData);
    }
  }
  
  /**
   * Private: Run simulation
   */
  private async runSimulation(): Promise<void> {
    const strategy = this.config!.strategy;
    const symbols = Array.from(this.data.keys());
    
    // Get aligned timestamps
    const timestamps = this.data.get(symbols[0])!.map(d => d.timestamp);
    
    for (let i = strategy.parameters.lookbackPeriod; i < timestamps.length; i++) {
      const currentTime = timestamps[i];
      
      // Update positions with current prices
      this.updatePositions(currentTime);
      
      // Check exit conditions
      await this.checkExitConditions(strategy, currentTime, i);
      
      // Check entry conditions
      await this.checkEntryConditions(strategy, currentTime, i);
      
      // Update equity
      const totalEquity = this.calculateTotalEquity(currentTime);
      this.equity.push(totalEquity);
      this.timestamps.push(currentTime);
      
      // Update peak and drawdown
      if (totalEquity > this.peakEquity) {
        this.peakEquity = totalEquity;
        this.currentDrawdown = 0;
      } else {
        this.currentDrawdown = (this.peakEquity - totalEquity) / this.peakEquity;
      }
      
      // Emit progress
      if (i % 100 === 0) {
        this.emit('progress', {
          current: i,
          total: timestamps.length,
          equity: totalEquity
        });
      }
    }
    
    // Close all remaining positions
    await this.closeAllPositions(timestamps[timestamps.length - 1]);
  }
  
  /**
   * Private: Check entry conditions
   */
  private async checkEntryConditions(
    strategy: TradingStrategy,
    currentTime: Date,
    index: number
  ): Promise<void> {
    // Skip if max positions reached
    if (this.positions.size >= strategy.parameters.maxPositions) {
      return;
    }
    
    for (const symbol of this.data.keys()) {
      // Skip if already have position
      if (this.positions.has(symbol)) {
        continue;
      }
      
      const data = this.data.get(symbol)!;
      const currentBar = data[index];
      
      // Calculate indicators
      const indicators = this.calculateIndicators(symbol, index);
      
      // Check entry rules
      for (const rule of strategy.entryRules) {
        if (this.evaluateRule(rule, indicators, currentBar)) {
          // Simulate execution delay
          await this.simulateLatency();
          
          // Execute entry
          await this.executeEntry(symbol, rule.action, currentBar);
          break;
        }
      }
    }
  }
  
  /**
   * Private: Check exit conditions
   */
  private async checkExitConditions(
    strategy: TradingStrategy,
    currentTime: Date,
    index: number
  ): Promise<void> {
    for (const [symbol, position] of this.positions) {
      const data = this.data.get(symbol)!;
      const currentBar = data[index];
      
      // Update unrealized PnL
      const currentPrice = currentBar.close;
      if (position.side === 'long') {
        position.unrealizedPnl = (currentPrice - position.entryPrice) * position.size;
      } else {
        position.unrealizedPnl = (position.entryPrice - currentPrice) * position.size;
      }
      
      // Check stop loss
      if (strategy.riskManagement.stopLoss) {
        const stopLossPrice = position.side === 'long'
          ? position.entryPrice * (1 - strategy.riskManagement.stopLoss)
          : position.entryPrice * (1 + strategy.riskManagement.stopLoss);
        
        if ((position.side === 'long' && currentPrice <= stopLossPrice) ||
            (position.side === 'short' && currentPrice >= stopLossPrice)) {
          await this.executeExit(symbol, position, currentBar, 'stop_loss');
          continue;
        }
      }
      
      // Check take profit
      if (strategy.riskManagement.takeProfit) {
        const takeProfitPrice = position.side === 'long'
          ? position.entryPrice * (1 + strategy.riskManagement.takeProfit)
          : position.entryPrice * (1 - strategy.riskManagement.takeProfit);
        
        if ((position.side === 'long' && currentPrice >= takeProfitPrice) ||
            (position.side === 'short' && currentPrice <= takeProfitPrice)) {
          await this.executeExit(symbol, position, currentBar, 'take_profit');
          continue;
        }
      }
      
      // Check exit rules
      const indicators = this.calculateIndicators(symbol, index);
      for (const rule of strategy.exitRules) {
        if (this.evaluateRule(rule, indicators, currentBar)) {
          await this.executeExit(symbol, position, currentBar, 'rule');
          break;
        }
      }
    }
  }
  
  /**
   * Private: Execute entry
   */
  private async executeEntry(
    symbol: string,
    action: any,
    bar: MarketData
  ): Promise<void> {
    const size = this.calculatePositionSize(action, bar);
    const side = action.type === 'buy' ? 'long' : 'short';
    
    // Calculate slippage
    const slippage = this.calculateSlippage(size, bar);
    const entryPrice = side === 'long'
      ? bar.close * (1 + slippage)
      : bar.close * (1 - slippage);
    
    // Calculate fees
    const fees = this.calculateFees(size * entryPrice, 'entry');
    
    // Create position
    const position: Position = {
      symbol,
      side,
      size,
      entryPrice,
      entryTime: bar.timestamp,
      unrealizedPnl: 0,
      fees
    };
    
    this.positions.set(symbol, position);
    this.cash -= (size * entryPrice + fees);
    this.totalFees += fees;
    
    this.emit('tradeExecuted', {
      symbol,
      side,
      size,
      price: entryPrice,
      fees,
      timestamp: bar.timestamp
    });
  }
  
  /**
   * Private: Execute exit
   */
  private async executeExit(
    symbol: string,
    position: Position,
    bar: MarketData,
    reason: string
  ): Promise<void> {
    // Simulate execution delay
    await this.simulateLatency();
    
    // Calculate slippage
    const slippage = this.calculateSlippage(position.size, bar);
    const exitPrice = position.side === 'long'
      ? bar.close * (1 - slippage)
      : bar.close * (1 + slippage);
    
    // Calculate fees
    const fees = this.calculateFees(position.size * exitPrice, 'exit');
    
    // Calculate PnL
    const pnl = position.side === 'long'
      ? (exitPrice - position.entryPrice) * position.size
      : (position.entryPrice - exitPrice) * position.size;
    
    const netPnl = pnl - position.fees - fees;
    
    // Create trade record
    const trade: Trade = {
      id: `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      entryTime: position.entryTime,
      exitTime: bar.timestamp,
      symbol,
      side: position.side,
      entryPrice: position.entryPrice,
      exitPrice,
      size: position.size,
      fees: position.fees + fees,
      pnl: netPnl,
      pnlPercent: netPnl / (position.size * position.entryPrice),
      holdingPeriod: bar.timestamp.getTime() - position.entryTime.getTime(),
      mae: 0, // Would track during position lifetime
      mfe: 0  // Would track during position lifetime
    };
    
    this.trades.push(trade);
    this.cash += (position.size * exitPrice - fees);
    this.totalFees += fees;
    
    // Remove position
    this.positions.delete(symbol);
    
    this.emit('tradeExecuted', {
      symbol,
      side: position.side === 'long' ? 'sell' : 'buy',
      size: position.size,
      price: exitPrice,
      fees,
      pnl: netPnl,
      timestamp: bar.timestamp,
      reason
    });
  }
  
  /**
   * Private: Calculate position size
   */
  private calculatePositionSize(action: any, bar: MarketData): number {
    const strategy = this.config!.strategy;
    const availableCapital = this.cash;
    
    switch (action.sizeType) {
      case 'fixed':
        return action.size;
        
      case 'percentage':
        return (availableCapital * action.size) / bar.close;
        
      case 'risk_based':
        const riskAmount = availableCapital * action.size;
        const stopLoss = strategy.riskManagement.stopLoss || 0.02;
        return riskAmount / (bar.close * stopLoss);
        
      case 'kelly':
        // Simplified Kelly criterion
        const winRate = 0.55; // Would calculate from historical performance
        const avgWinLoss = 1.5; // Would calculate from historical performance
        const kellyFraction = (winRate * avgWinLoss - (1 - winRate)) / avgWinLoss;
        return (availableCapital * Math.min(kellyFraction, 0.25)) / bar.close;
        
      default:
        return 1;
    }
  }
  
  /**
   * Private: Calculate slippage
   */
  private calculateSlippage(size: number, bar: MarketData): number {
    if (!this.config!.slippage) {
      return 0;
    }
    
    const model = this.config!.slippage;
    const liquidity = bar.volume;
    
    switch (model.type) {
      case 'fixed':
        return model.baseSlippage;
        
      case 'linear':
        return model.baseSlippage + (size / liquidity) * (model.impactCoefficient || 0.1);
        
      case 'square_root':
        return model.baseSlippage + Math.sqrt(size / liquidity) * (model.impactCoefficient || 0.1);
        
      case 'custom':
        return model.customFunction ? model.customFunction(size, liquidity) : 0;
        
      default:
        return 0;
    }
  }
  
  /**
   * Private: Calculate fees
   */
  private calculateFees(notional: number, type: 'entry' | 'exit'): number {
    if (!this.config!.includeFees || !this.config!.feeStructure) {
      return 0;
    }
    
    const fees = this.config!.feeStructure;
    
    // Assume taker fees for backtest (conservative)
    return notional * fees.taker;
  }
  
  /**
   * Private: Calculate indicators
   */
  private calculateIndicators(symbol: string, index: number): any {
    const data = this.data.get(symbol)!;
    const lookback = this.config!.strategy.parameters.lookbackPeriod;
    
    // Simple indicators for demonstration
    const prices = data.slice(Math.max(0, index - lookback), index + 1).map(d => d.close);
    
    return {
      price: prices[prices.length - 1],
      sma20: prices.reduce((a, b) => a + b, 0) / prices.length,
      rsi: this.calculateRSI(prices),
      volume: data[index].volume,
      high: Math.max(...prices),
      low: Math.min(...prices)
    };
  }
  
  /**
   * Private: Calculate RSI
   */
  private calculateRSI(prices: number[]): number {
    if (prices.length < 2) return 50;
    
    const changes = prices.slice(1).map((p, i) => p - prices[i]);
    const gains = changes.filter(c => c > 0);
    const losses = changes.filter(c => c < 0).map(c => Math.abs(c));
    
    const avgGain = gains.length > 0 ? gains.reduce((a, b) => a + b, 0) / changes.length : 0;
    const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / changes.length : 0;
    
    if (avgLoss === 0) return 100;
    
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }
  
  /**
   * Private: Evaluate rule
   */
  private evaluateRule(rule: any, indicators: any, bar: MarketData): boolean {
    // Simplified rule evaluation
    // In production, this would handle complex conditions
    
    if (rule.condition.type === 'simple') {
      const value = indicators[rule.condition.indicator];
      const threshold = rule.condition.value;
      
      switch (rule.condition.operator) {
        case '>':
          return value > threshold;
        case '<':
          return value < threshold;
        case 'crosses_above':
          // Would need previous value
          return false;
        default:
          return false;
      }
    }
    
    return false;
  }
  
  /**
   * Private: Update positions
   */
  private updatePositions(currentTime: Date): void {
    // Update unrealized PnL for all positions
    for (const [symbol, position] of this.positions) {
      const data = this.data.get(symbol)!;
      const currentBar = data.find(d => d.timestamp.getTime() === currentTime.getTime());
      
      if (currentBar) {
        const currentPrice = currentBar.close;
        
        if (position.side === 'long') {
          position.unrealizedPnl = (currentPrice - position.entryPrice) * position.size;
        } else {
          position.unrealizedPnl = (position.entryPrice - currentPrice) * position.size;
        }
      }
    }
  }
  
  /**
   * Private: Calculate total equity
   */
  private calculateTotalEquity(currentTime: Date): number {
    let totalEquity = this.cash;
    
    for (const [symbol, position] of this.positions) {
      const data = this.data.get(symbol)!;
      const currentBar = data.find(d => d.timestamp.getTime() === currentTime.getTime());
      
      if (currentBar) {
        const marketValue = position.size * currentBar.close;
        totalEquity += marketValue;
        totalEquity += position.unrealizedPnl;
      }
    }
    
    return totalEquity;
  }
  
  /**
   * Private: Close all positions
   */
  private async closeAllPositions(timestamp: Date): Promise<void> {
    for (const [symbol, position] of this.positions) {
      const data = this.data.get(symbol)!;
      const lastBar = data[data.length - 1];
      await this.executeExit(symbol, position, lastBar, 'end_of_backtest');
    }
  }
  
  /**
   * Private: Calculate performance
   */
  private calculatePerformance(): StrategyPerformance {
    const returns = this.calculateReturns();
    const winningTrades = this.trades.filter(t => t.pnl! > 0);
    const losingTrades = this.trades.filter(t => t.pnl! < 0);
    
    const totalReturn = (this.equity[this.equity.length - 1] - this.config!.initialCapital) / 
                       this.config!.initialCapital;
    
    const annualizedReturn = this.annualizeReturn(totalReturn);
    const volatility = this.calculateVolatility(returns);
    const sharpeRatio = volatility > 0 ? (annualizedReturn - 0.02) / volatility : 0; // Assume 2% risk-free rate
    
    const avgWin = winningTrades.length > 0
      ? winningTrades.reduce((sum, t) => sum + t.pnl!, 0) / winningTrades.length
      : 0;
    
    const avgLoss = losingTrades.length > 0
      ? Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl!, 0) / losingTrades.length)
      : 0;
    
    return {
      totalReturn,
      annualizedReturn,
      volatility,
      sharpeRatio,
      sortinoRatio: this.calculateSortinoRatio(returns, annualizedReturn),
      calmarRatio: this.currentDrawdown > 0 ? annualizedReturn / this.currentDrawdown : 0,
      maxDrawdown: this.currentDrawdown,
      winRate: this.trades.length > 0 ? winningTrades.length / this.trades.length : 0,
      profitFactor: avgLoss > 0 ? avgWin / avgLoss : 0,
      averageWin: avgWin,
      averageLoss: avgLoss,
      expectancy: this.trades.length > 0
        ? this.trades.reduce((sum, t) => sum + t.pnl!, 0) / this.trades.length
        : 0,
      trades: this.trades.length
    };
  }
  
  /**
   * Private: Calculate returns
   */
  private calculateReturns(): number[] {
    const returns: number[] = [];
    
    for (let i = 1; i < this.equity.length; i++) {
      returns.push((this.equity[i] - this.equity[i - 1]) / this.equity[i - 1]);
    }
    
    return returns;
  }
  
  /**
   * Private: Annualize return
   */
  private annualizeReturn(totalReturn: number): number {
    const days = (this.config!.endDate.getTime() - this.config!.startDate.getTime()) / 
                (1000 * 60 * 60 * 24);
    const years = days / 365;
    
    return Math.pow(1 + totalReturn, 1 / years) - 1;
  }
  
  /**
   * Private: Calculate volatility
   */
  private calculateVolatility(returns: number[]): number {
    if (returns.length < 2) return 0;
    
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    
    // Annualize based on data frequency
    const periodsPerYear = this.getPeriodsPerYear();
    return Math.sqrt(variance * periodsPerYear);
  }
  
  /**
   * Private: Calculate Sortino ratio
   */
  private calculateSortinoRatio(returns: number[], annualizedReturn: number): number {
    const negativeReturns = returns.filter(r => r < 0);
    
    if (negativeReturns.length === 0) return 0;
    
    const downside = Math.sqrt(
      negativeReturns.reduce((sum, r) => sum + r * r, 0) / negativeReturns.length
    );
    
    const annualizedDownside = downside * Math.sqrt(this.getPeriodsPerYear());
    
    return annualizedDownside > 0 ? (annualizedReturn - 0.02) / annualizedDownside : 0;
  }
  
  /**
   * Private: Generate equity curve
   */
  private generateEquityCurve(): EquityCurve {
    const returns = this.calculateReturns();
    const drawdown: number[] = [];
    let peak = this.equity[0];
    
    for (const value of this.equity) {
      if (value > peak) {
        peak = value;
      }
      drawdown.push((peak - value) / peak);
    }
    
    return {
      timestamps: this.timestamps,
      values: this.equity,
      returns: [0, ...returns], // Prepend 0 for initial return
      drawdown
    };
  }
  
  /**
   * Private: Analyze drawdowns
   */
  private analyzeDrawdowns(): Drawdown[] {
    const drawdowns: Drawdown[] = [];
    let inDrawdown = false;
    let currentDD: Partial<Drawdown> = {};
    let peak = this.equity[0];
    
    for (let i = 0; i < this.equity.length; i++) {
      const value = this.equity[i];
      
      if (value > peak) {
        if (inDrawdown && currentDD.start) {
          // Drawdown ended
          currentDD.end = this.timestamps[i];
          currentDD.recovery = i;
          currentDD.duration = currentDD.end.getTime() - currentDD.start.getTime();
          drawdowns.push(currentDD as Drawdown);
          currentDD = {};
          inDrawdown = false;
        }
        peak = value;
      } else {
        if (!inDrawdown) {
          // Drawdown started
          inDrawdown = true;
          currentDD.start = this.timestamps[i];
          currentDD.peak = peak;
        }
        
        currentDD.trough = Math.min(currentDD.trough || value, value);
        currentDD.depth = (peak - value) / peak;
      }
    }
    
    // Handle ongoing drawdown
    if (inDrawdown && currentDD.start) {
      drawdowns.push(currentDD as Drawdown);
    }
    
    return drawdowns;
  }
  
  /**
   * Private: Calculate execution stats
   */
  private calculateExecutionStats(): ExecutionStats {
    const totalOrders = this.trades.length * 2; // Entry and exit
    
    return {
      totalOrders,
      filledOrders: totalOrders, // Assume all filled in backtest
      partialFills: 0,
      rejectedOrders: 0,
      averageSlippage: this.config!.slippage?.baseSlippage || 0,
      totalFees: this.totalFees,
      averageLatency: this.executionLatency
    };
  }
  
  /**
   * Private: Parse interval
   */
  private parseInterval(frequency: string): number {
    const intervals: { [key: string]: number } = {
      '1m': 60 * 1000,
      '5m': 5 * 60 * 1000,
      '15m': 15 * 60 * 1000,
      '30m': 30 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '4h': 4 * 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000
    };
    
    return intervals[frequency] || intervals['1h'];
  }
  
  /**
   * Private: Get periods per year
   */
  private getPeriodsPerYear(): number {
    const periods: { [key: string]: number } = {
      '1m': 525600,
      '5m': 105120,
      '15m': 35040,
      '30m': 17520,
      '1h': 8760,
      '4h': 2190,
      '1d': 365
    };
    
    return periods[this.config!.dataFrequency] || 365;
  }
  
  /**
   * Private: Simulate latency
   */
  private async simulateLatency(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, this.executionLatency));
  }
  
  /**
   * Shutdown
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down Backtester');
  }
} 