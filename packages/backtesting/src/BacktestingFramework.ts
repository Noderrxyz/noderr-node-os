import { EventEmitter } from 'events';
import * as winston from 'winston';

export interface BacktestConfig {
  startDate: Date;
  endDate: Date;
  initialCapital: number;
  symbols: string[];
  dataSource: 'historical' | 'simulated';
  slippageModel: SlippageModel;
  feeModel: FeeModel;
  executionDelay: number; // milliseconds
  tickInterval: number; // milliseconds between ticks
}

export interface SlippageModel {
  type: 'fixed' | 'linear' | 'square_root';
  baseSlippage: number; // basis points
  impactCoefficient: number;
}

export interface FeeModel {
  maker: number;
  taker: number;
  fixed: number;
}

export interface BacktestResult {
  config: BacktestConfig;
  performance: PerformanceMetrics;
  trades: Trade[];
  equityCurve: EquityPoint[];
  drawdowns: DrawdownPeriod[];
  riskMetrics: RiskMetrics;
}

export interface PerformanceMetrics {
  totalReturn: number;
  annualizedReturn: number;
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdown: number;
  winRate: number;
  profitFactor: number;
  totalTrades: number;
  avgWin: number;
  avgLoss: number;
  expectancy: number;
  calmarRatio: number;
}

export interface Trade {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  entryTime: Date;
  entryPrice: number;
  exitTime?: Date;
  exitPrice?: number;
  quantity: number;
  pnl?: number;
  pnlPercent?: number;
  fees: number;
  slippage: number;
  isOpen: boolean;
}

export interface EquityPoint {
  timestamp: Date;
  equity: number;
  drawdown: number;
  openPositions: number;
}

export interface DrawdownPeriod {
  startDate: Date;
  endDate?: Date;
  maxDrawdown: number;
  duration: number;
  recovery?: Date;
}

export interface RiskMetrics {
  var95: number; // Value at Risk 95%
  var99: number; // Value at Risk 99%
  cvar95: number; // Conditional VaR 95%
  cvar99: number; // Conditional VaR 99%
  beta: number;
  alpha: number;
  informationRatio: number;
  treynorRatio: number;
}

export interface MarketData {
  symbol: string;
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  bid?: number;
  ask?: number;
  bidSize?: number;
  askSize?: number;
}

export abstract class Strategy {
  abstract name: string;
  abstract onTick(data: MarketData, portfolio: Portfolio): Signal | null;
  abstract onInit?(config: BacktestConfig): void;
  abstract onEnd?(): void;
}

export interface Signal {
  action: 'BUY' | 'SELL' | 'CLOSE' | 'CLOSE_ALL';
  symbol: string;
  quantity?: number;
  orderType: 'MARKET' | 'LIMIT';
  limitPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  metadata?: Record<string, any>;
}

export class Portfolio {
  private cash: number;
  private positions: Map<string, Position> = new Map();
  private trades: Trade[] = [];
  private equity: number;
  
  constructor(initialCapital: number) {
    this.cash = initialCapital;
    this.equity = initialCapital;
  }
  
  getCash(): number {
    return this.cash;
  }
  
  getEquity(): number {
    return this.equity;
  }
  
  getPosition(symbol: string): Position | undefined {
    return this.positions.get(symbol);
  }
  
  getAllPositions(): Position[] {
    return Array.from(this.positions.values());
  }
  
  updatePosition(symbol: string, quantity: number, price: number, fees: number): void {
    const existing = this.positions.get(symbol);
    
    if (existing) {
      // Update existing position
      const newQuantity = existing.quantity + quantity;
      
      if (Math.abs(newQuantity) < 0.0001) {
        // Position closed
        this.positions.delete(symbol);
      } else {
        // Update average price
        const totalCost = (existing.quantity * existing.avgPrice) + (quantity * price);
        existing.quantity = newQuantity;
        existing.avgPrice = totalCost / newQuantity;
      }
    } else if (Math.abs(quantity) > 0.0001) {
      // New position
      this.positions.set(symbol, {
        symbol,
        quantity,
        avgPrice: price,
        unrealizedPnl: 0
      });
    }
    
    // Update cash
    this.cash -= (quantity * price + fees);
  }
  
  updateEquity(marketPrices: Map<string, number>): void {
    let totalValue = this.cash;
    
    for (const [symbol, position] of this.positions) {
      const marketPrice = marketPrices.get(symbol) || position.avgPrice;
      position.unrealizedPnl = (marketPrice - position.avgPrice) * position.quantity;
      totalValue += position.quantity * marketPrice;
    }
    
    this.equity = totalValue;
  }
  
  addTrade(trade: Trade): void {
    this.trades.push(trade);
  }
  
  getTrades(): Trade[] {
    return this.trades;
  }
}

interface Position {
  symbol: string;
  quantity: number;
  avgPrice: number;
  unrealizedPnl: number;
}

export class BacktestingFramework extends EventEmitter {
  private logger: winston.Logger;
  private config!: BacktestConfig;
  private strategy!: Strategy;
  private portfolio!: Portfolio;
  private marketData: Map<string, MarketData[]> = new Map();
  private currentIndex: number = 0;
  private equityCurve: EquityPoint[] = [];
  private highWaterMark: number = 0;
  private currentDrawdown: number = 0;
  private drawdowns: DrawdownPeriod[] = [];
  private currentDrawdownPeriod: DrawdownPeriod | null = null;
  
  constructor(logger: winston.Logger) {
    super();
    this.logger = logger;
  }
  
  async runBacktest(config: BacktestConfig, strategy: Strategy): Promise<BacktestResult> {
    this.config = config;
    this.strategy = strategy;
    this.portfolio = new Portfolio(config.initialCapital);
    this.highWaterMark = config.initialCapital;
    
    this.logger.info('Starting backtest', {
      strategy: strategy.name,
      startDate: config.startDate,
      endDate: config.endDate,
      symbols: config.symbols
    });
    
    try {
      // Initialize strategy
      if (strategy.onInit) {
        strategy.onInit(config);
      }
      
      // Load historical data
      await this.loadHistoricalData();
      
      // Run simulation
      await this.simulate();
      
      // Finalize strategy
      if (strategy.onEnd) {
        strategy.onEnd();
      }
      
      // Calculate final metrics
      const result = this.calculateResults();
      
      this.logger.info('Backtest completed', {
        strategy: strategy.name,
        sharpeRatio: result.performance.sharpeRatio,
        totalReturn: result.performance.totalReturn,
        maxDrawdown: result.performance.maxDrawdown
      });
      
      return result;
      
    } catch (error) {
      this.logger.error('Backtest failed', error);
      throw error;
    }
  }
  
  private async loadHistoricalData(): Promise<void> {
    // In production, this would load from a database or data provider
    // For now, generate simulated data
    
    for (const symbol of this.config.symbols) {
      const data = this.generateSimulatedData(symbol);
      this.marketData.set(symbol, data);
    }
    
    this.logger.info('Historical data loaded', {
      symbols: this.config.symbols.length,
      dataPoints: Array.from(this.marketData.values()).reduce((sum, data) => sum + data.length, 0)
    });
  }
  
  private generateSimulatedData(symbol: string): MarketData[] {
    const data: MarketData[] = [];
    const startTime = this.config.startDate.getTime();
    const endTime = this.config.endDate.getTime();
    const interval = 60000; // 1 minute bars
    
    let price = 50000; // Starting price
    let time = startTime;
    
    while (time <= endTime) {
      // Random walk with drift
      const change = (Math.random() - 0.5) * 0.002 + 0.00001; // Slight upward drift
      price *= (1 + change);
      
      const high = price * (1 + Math.random() * 0.001);
      const low = price * (1 - Math.random() * 0.001);
      const close = low + Math.random() * (high - low);
      
      data.push({
        symbol,
        timestamp: new Date(time),
        open: price,
        high,
        low,
        close,
        volume: 100 + Math.random() * 1000,
        bid: close * 0.9999,
        ask: close * 1.0001,
        bidSize: 10 + Math.random() * 90,
        askSize: 10 + Math.random() * 90
      });
      
      price = close;
      time += interval;
    }
    
    return data;
  }
  
  private async simulate(): Promise<void> {
    // Get all timestamps
    const allTimestamps = new Set<number>();
    for (const data of this.marketData.values()) {
      for (const bar of data) {
        allTimestamps.add(bar.timestamp.getTime());
      }
    }
    
    const sortedTimestamps = Array.from(allTimestamps).sort((a, b) => a - b);
    
    // Process each timestamp
    for (const timestamp of sortedTimestamps) {
      const currentData = new Map<string, MarketData>();
      
      // Collect data for all symbols at this timestamp
      for (const [symbol, data] of this.marketData) {
        const bar = data.find(d => d.timestamp.getTime() === timestamp);
        if (bar) {
          currentData.set(symbol, bar);
        }
      }
      
      // Update portfolio equity
      const marketPrices = new Map<string, number>();
      for (const [symbol, bar] of currentData) {
        marketPrices.set(symbol, bar.close);
      }
      this.portfolio.updateEquity(marketPrices);
      
      // Record equity curve
      this.recordEquityPoint(new Date(timestamp));
      
      // Process each symbol
      for (const [symbol, bar] of currentData) {
        // Get signal from strategy
        const signal = this.strategy.onTick(bar, this.portfolio);
        
        if (signal) {
          await this.executeSignal(signal, bar);
        }
      }
      
      // Emit progress
      this.emit('progress', {
        timestamp: new Date(timestamp),
        equity: this.portfolio.getEquity(),
        positions: this.portfolio.getAllPositions().length
      });
      
      // Simulate execution delay
      if (this.config.executionDelay > 0) {
        await new Promise(resolve => setTimeout(resolve, this.config.tickInterval));
      }
    }
  }
  
  private async executeSignal(signal: Signal, marketData: MarketData): Promise<void> {
    const position = this.portfolio.getPosition(signal.symbol);
    
    switch (signal.action) {
      case 'BUY':
      case 'SELL':
        await this.executeTrade(signal, marketData, position);
        break;
        
      case 'CLOSE':
        if (position) {
          await this.closePosition(signal.symbol, marketData, position);
        }
        break;
        
      case 'CLOSE_ALL':
        await this.closeAllPositions(marketData);
        break;
    }
  }
  
  private async executeTrade(signal: Signal, marketData: MarketData, position?: Position): Promise<void> {
    // Calculate execution price with slippage
    const side = signal.action as 'BUY' | 'SELL';
    const executionPrice = this.calculateExecutionPrice(marketData, side, signal.quantity || 0);
    
    // Calculate fees
    const fees = this.calculateFees(signal.quantity || 0, executionPrice, signal.orderType === 'MARKET');
    
    // Calculate actual quantity based on available capital
    const quantity = this.calculateTradeQuantity(signal, executionPrice, fees);
    
    if (Math.abs(quantity) < 0.0001) {
      this.logger.warn('Insufficient capital for trade', { signal, available: this.portfolio.getCash() });
      return;
    }
    
    // Create trade record
    const trade: Trade = {
      id: `TRADE-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      symbol: signal.symbol,
      side,
      entryTime: marketData.timestamp,
      entryPrice: executionPrice,
      quantity: Math.abs(quantity),
      fees,
      slippage: Math.abs(executionPrice - marketData.close),
      isOpen: true
    };
    
    // Update portfolio
    const actualQuantity = side === 'BUY' ? quantity : -quantity;
    this.portfolio.updatePosition(signal.symbol, actualQuantity, executionPrice, fees);
    this.portfolio.addTrade(trade);
    
    this.logger.debug('Trade executed', {
      trade,
      equity: this.portfolio.getEquity()
    });
  }
  
  private async closePosition(symbol: string, marketData: MarketData, position: Position): Promise<void> {
    const side = position.quantity > 0 ? 'SELL' : 'BUY';
    const executionPrice = this.calculateExecutionPrice(marketData, side, Math.abs(position.quantity));
    const fees = this.calculateFees(Math.abs(position.quantity), executionPrice, true);
    
    // Find open trade
    const openTrade = this.portfolio.getTrades()
      .filter(t => t.symbol === symbol && t.isOpen)
      .sort((a, b) => a.entryTime.getTime() - b.entryTime.getTime())[0];
    
    if (openTrade) {
      // Update trade record
      openTrade.exitTime = marketData.timestamp;
      openTrade.exitPrice = executionPrice;
      openTrade.isOpen = false;
      
      // Calculate PnL
      const entryValue = openTrade.quantity * openTrade.entryPrice;
      const exitValue = openTrade.quantity * executionPrice;
      openTrade.pnl = position.quantity > 0 ? 
        (exitValue - entryValue - openTrade.fees - fees) :
        (entryValue - exitValue - openTrade.fees - fees);
      openTrade.pnlPercent = openTrade.pnl / entryValue;
    }
    
    // Update portfolio
    this.portfolio.updatePosition(symbol, -position.quantity, executionPrice, fees);
  }
  
  private async closeAllPositions(marketData: MarketData): Promise<void> {
    const positions = this.portfolio.getAllPositions();
    
    for (const position of positions) {
      const symbolData = this.marketData.get(position.symbol)?.find(
        d => d.timestamp.getTime() === marketData.timestamp.getTime()
      );
      
      if (symbolData) {
        await this.closePosition(position.symbol, symbolData, position);
      }
    }
  }
  
  private calculateExecutionPrice(marketData: MarketData, side: 'BUY' | 'SELL', quantity: number): number {
    const basePrice = side === 'BUY' ? (marketData.ask || marketData.close) : (marketData.bid || marketData.close);
    
    // Apply slippage model
    let slippage = 0;
    switch (this.config.slippageModel.type) {
      case 'fixed':
        slippage = this.config.slippageModel.baseSlippage / 10000;
        break;
        
      case 'linear':
        slippage = (this.config.slippageModel.baseSlippage + 
                   this.config.slippageModel.impactCoefficient * quantity) / 10000;
        break;
        
      case 'square_root':
        slippage = (this.config.slippageModel.baseSlippage + 
                   this.config.slippageModel.impactCoefficient * Math.sqrt(quantity)) / 10000;
        break;
    }
    
    return side === 'BUY' ? basePrice * (1 + slippage) : basePrice * (1 - slippage);
  }
  
  private calculateFees(quantity: number, price: number, isTaker: boolean): number {
    const notional = quantity * price;
    const rate = isTaker ? this.config.feeModel.taker : this.config.feeModel.maker;
    return notional * rate + this.config.feeModel.fixed;
  }
  
  private calculateTradeQuantity(signal: Signal, price: number, fees: number): number {
    if (signal.quantity) {
      // Check if we have enough capital
      const required = signal.quantity * price + fees;
      if (required <= this.portfolio.getCash()) {
        return signal.quantity;
      }
    }
    
    // Calculate maximum affordable quantity
    const available = this.portfolio.getCash() - fees;
    return Math.floor((available / price) * 10000) / 10000; // Round to 4 decimals
  }
  
  private recordEquityPoint(timestamp: Date): void {
    const equity = this.portfolio.getEquity();
    
    // Update high water mark and drawdown
    if (equity > this.highWaterMark) {
      this.highWaterMark = equity;
      
      // End current drawdown period if any
      if (this.currentDrawdownPeriod) {
        this.currentDrawdownPeriod.endDate = timestamp;
        this.currentDrawdownPeriod.recovery = timestamp;
        this.drawdowns.push(this.currentDrawdownPeriod);
        this.currentDrawdownPeriod = null;
      }
      
      this.currentDrawdown = 0;
    } else {
      this.currentDrawdown = (this.highWaterMark - equity) / this.highWaterMark;
      
      // Start new drawdown period if needed
      if (!this.currentDrawdownPeriod && this.currentDrawdown > 0) {
        this.currentDrawdownPeriod = {
          startDate: timestamp,
          maxDrawdown: this.currentDrawdown,
          duration: 0
        };
      }
      
      // Update current drawdown period
      if (this.currentDrawdownPeriod) {
        this.currentDrawdownPeriod.maxDrawdown = Math.max(
          this.currentDrawdownPeriod.maxDrawdown,
          this.currentDrawdown
        );
        this.currentDrawdownPeriod.duration = 
          timestamp.getTime() - this.currentDrawdownPeriod.startDate.getTime();
      }
    }
    
    this.equityCurve.push({
      timestamp,
      equity,
      drawdown: this.currentDrawdown,
      openPositions: this.portfolio.getAllPositions().length
    });
  }
  
  private calculateResults(): BacktestResult {
    const trades = this.portfolio.getTrades();
    const closedTrades = trades.filter(t => !t.isOpen);
    const winningTrades = closedTrades.filter(t => t.pnl! > 0);
    const losingTrades = closedTrades.filter(t => t.pnl! <= 0);
    
    // Calculate returns
    const initialCapital = this.config.initialCapital;
    const finalEquity = this.portfolio.getEquity();
    const totalReturn = (finalEquity - initialCapital) / initialCapital;
    
    // Calculate time-based metrics
    const days = (this.config.endDate.getTime() - this.config.startDate.getTime()) / (1000 * 60 * 60 * 24);
    const years = days / 365;
    const annualizedReturn = Math.pow(1 + totalReturn, 1 / years) - 1;
    
    // Calculate daily returns for risk metrics
    const dailyReturns = this.calculateDailyReturns();
    
    // Performance metrics
    const performance: PerformanceMetrics = {
      totalReturn,
      annualizedReturn,
      sharpeRatio: this.calculateSharpeRatio(dailyReturns),
      sortinoRatio: this.calculateSortinoRatio(dailyReturns),
      maxDrawdown: Math.max(...this.drawdowns.map(d => d.maxDrawdown), 0),
      winRate: closedTrades.length > 0 ? winningTrades.length / closedTrades.length : 0,
      profitFactor: this.calculateProfitFactor(winningTrades, losingTrades),
      totalTrades: trades.length,
      avgWin: winningTrades.length > 0 ? 
        winningTrades.reduce((sum, t) => sum + t.pnl!, 0) / winningTrades.length : 0,
      avgLoss: losingTrades.length > 0 ?
        losingTrades.reduce((sum, t) => sum + t.pnl!, 0) / losingTrades.length : 0,
      expectancy: this.calculateExpectancy(closedTrades),
      calmarRatio: this.calculateCalmarRatio(annualizedReturn, this.drawdowns)
    };
    
    // Risk metrics
    const riskMetrics = this.calculateRiskMetrics(dailyReturns);
    
    return {
      config: this.config,
      performance,
      trades,
      equityCurve: this.equityCurve,
      drawdowns: this.drawdowns,
      riskMetrics
    };
  }
  
  private calculateDailyReturns(): number[] {
    const dailyReturns: number[] = [];
    let lastEquity = this.config.initialCapital;
    let lastDate = this.config.startDate;
    
    for (const point of this.equityCurve) {
      if (point.timestamp.getDate() !== lastDate.getDate()) {
        const dailyReturn = (point.equity - lastEquity) / lastEquity;
        dailyReturns.push(dailyReturn);
        lastEquity = point.equity;
        lastDate = point.timestamp;
      }
    }
    
    return dailyReturns;
  }
  
  private calculateSharpeRatio(returns: number[]): number {
    if (returns.length === 0) return 0;
    
    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const stdDev = Math.sqrt(
      returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length
    );
    
    // Annualize
    const annualizedReturn = avgReturn * 252;
    const annualizedStdDev = stdDev * Math.sqrt(252);
    
    return stdDev > 0 ? annualizedReturn / annualizedStdDev : 0;
  }
  
  private calculateSortinoRatio(returns: number[]): number {
    if (returns.length === 0) return 0;
    
    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const downside = returns.filter(r => r < 0);
    
    if (downside.length === 0) {
      return avgReturn > 0 ? Number.POSITIVE_INFINITY : 0;
    }
    
    const downsideDeviation = Math.sqrt(
      downside.reduce((sum, r) => sum + r * r, 0) / downside.length
    );
    
    // Annualize
    const annualizedReturn = avgReturn * 252;
    const annualizedDownside = downsideDeviation * Math.sqrt(252);
    
    return annualizedDownside > 0 ? annualizedReturn / annualizedDownside : 0;
  }
  
  private calculateProfitFactor(winningTrades: Trade[], losingTrades: Trade[]): number {
    const grossProfit = winningTrades.reduce((sum, t) => sum + t.pnl!, 0);
    const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl!, 0));
    
    if (grossLoss > 0) {
      return grossProfit / grossLoss;
    } else if (grossProfit > 0) {
      return Number.POSITIVE_INFINITY;
    } else {
      return 0;
    }
  }
  
  private calculateExpectancy(trades: Trade[]): number {
    if (trades.length === 0) return 0;
    
    return trades.reduce((sum, t) => sum + t.pnl!, 0) / trades.length;
  }
  
  private calculateCalmarRatio(annualizedReturn: number, drawdowns: DrawdownPeriod[]): number {
    const maxDrawdown = Math.max(...drawdowns.map(d => d.maxDrawdown), 0);
    
    if (maxDrawdown > 0) {
      return annualizedReturn / maxDrawdown;
    } else if (annualizedReturn > 0) {
      return Number.POSITIVE_INFINITY;
    } else {
      return 0;
    }
  }
  
  private calculateRiskMetrics(returns: number[]): RiskMetrics {
    if (returns.length === 0) {
      return {
        var95: 0,
        var99: 0,
        cvar95: 0,
        cvar99: 0,
        beta: 0,
        alpha: 0,
        informationRatio: 0,
        treynorRatio: 0
      };
    }
    
    // Sort returns for VaR calculation
    const sortedReturns = [...returns].sort((a, b) => a - b);
    
    // VaR calculation
    const var95Index = Math.floor(returns.length * 0.05);
    const var99Index = Math.floor(returns.length * 0.01);
    
    const var95 = sortedReturns[var95Index] || sortedReturns[0];
    const var99 = sortedReturns[var99Index] || sortedReturns[0];
    
    // CVaR calculation
    const cvar95 = sortedReturns.slice(0, var95Index + 1).reduce((sum, r) => sum + r, 0) / (var95Index + 1);
    const cvar99 = sortedReturns.slice(0, var99Index + 1).reduce((sum, r) => sum + r, 0) / (var99Index + 1);
    
    // Simplified beta and alpha (would need market returns in production)
    const beta = 1.0; // Placeholder
    const alpha = this.calculateSharpeRatio(returns) - beta; // Simplified
    
    // Information ratio (would need benchmark in production)
    const informationRatio = this.calculateSharpeRatio(returns); // Simplified
    
    // Treynor ratio
    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const treynorRatio = Math.abs(beta) > 0.0001 ? (avgReturn * 252) / beta : 0;
    
    return {
      var95: Math.abs(var95),
      var99: Math.abs(var99),
      cvar95: Math.abs(cvar95),
      cvar99: Math.abs(cvar99),
      beta,
      alpha,
      informationRatio,
      treynorRatio
    };
  }
} 