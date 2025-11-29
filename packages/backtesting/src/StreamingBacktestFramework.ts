import { EventEmitter } from 'events';
import * as winston from 'winston';
import { Worker } from 'worker_threads';
import { Readable } from 'stream';

export interface StreamingBacktestConfig {
  startDate: Date;
  endDate: Date;
  initialCapital: number;
  symbols: string[];
  dataSource: DataStreamSource;
  slippageModel: SlippageModel;
  feeModel: FeeModel;
  executionDelay: number;
  chunkSize: number; // Number of bars to process at once
  parallelWorkers: number;
}

export interface DataStreamSource {
  createStream(symbol: string, startDate: Date, endDate: Date): AsyncIterable<MarketData>;
  getMetadata(symbol: string): Promise<DataMetadata>;
}

export interface DataMetadata {
  symbol: string;
  firstDate: Date;
  lastDate: Date;
  totalBars: number;
  frequency: string;
}

export interface SlippageModel {
  type: 'fixed' | 'linear' | 'square_root' | 'market_impact';
  baseSlippage: number;
  impactCoefficient: number;
  liquidityFactor?: number;
}

export interface FeeModel {
  maker: number;
  taker: number;
  fixed: number;
  rebate?: number;
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
  trades?: number;
  vwap?: number;
}

export interface StreamingBacktestResult {
  config: StreamingBacktestConfig;
  performance: PerformanceMetrics;
  trades: AsyncIterable<Trade>;
  equityCurve: AsyncIterable<EquityPoint>;
  finalMetrics: Promise<FinalMetrics>;
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
  dailyReturn?: number;
}

export interface FinalMetrics {
  performance: PerformanceMetrics;
  riskMetrics: RiskMetrics;
  executionMetrics: ExecutionMetrics;
}

export interface RiskMetrics {
  var95: number;
  var99: number;
  cvar95: number;
  cvar99: number;
  beta: number;
  alpha: number;
  informationRatio: number;
  treynorRatio: number;
  downsideDeviation: number;
  ulcerIndex: number;
}

export interface ExecutionMetrics {
  totalSlippage: number;
  totalFees: number;
  avgSlippageBps: number;
  avgSpread: number;
  fillRate: number;
  avgLatency: number;
}

export abstract class StreamingStrategy {
  abstract name: string;
  abstract onBar(data: MarketData, portfolio: StreamingPortfolio): Promise<Signal | null>;
  abstract onInit?(config: StreamingBacktestConfig): Promise<void>;
  abstract onEnd?(): Promise<void>;
}

export interface Signal {
  action: 'BUY' | 'SELL' | 'CLOSE' | 'CLOSE_ALL';
  symbol: string;
  quantity?: number;
  orderType: 'MARKET' | 'LIMIT';
  limitPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  urgency?: 'low' | 'normal' | 'high';
  metadata?: Record<string, any>;
}

export class StreamingPortfolio {
  private cash: number;
  private positions: Map<string, Position> = new Map();
  private pendingOrders: Map<string, PendingOrder> = new Map();
  private equity: number;
  private highWaterMark: number;
  
  constructor(initialCapital: number) {
    this.cash = initialCapital;
    this.equity = initialCapital;
    this.highWaterMark = initialCapital;
  }
  
  async getCash(): Promise<number> {
    return this.cash;
  }
  
  async getEquity(): Promise<number> {
    return this.equity;
  }
  
  async getPosition(symbol: string): Promise<Position | undefined> {
    return this.positions.get(symbol);
  }
  
  async getAllPositions(): Promise<Position[]> {
    return Array.from(this.positions.values());
  }
  
  async updatePosition(
    symbol: string, 
    quantity: number, 
    price: number, 
    fees: number,
    slippage: number
  ): Promise<void> {
    const existing = this.positions.get(symbol);
    
    if (existing) {
      const newQuantity = existing.quantity + quantity;
      
      if (Math.abs(newQuantity) < 0.0001) {
        this.positions.delete(symbol);
      } else {
        const totalCost = (existing.quantity * existing.avgPrice) + (quantity * price);
        existing.quantity = newQuantity;
        existing.avgPrice = Math.abs(newQuantity) > 0 ? totalCost / newQuantity : 0;
        existing.totalFees += fees;
        existing.totalSlippage += slippage;
      }
    } else if (Math.abs(quantity) > 0.0001) {
      this.positions.set(symbol, {
        symbol,
        quantity,
        avgPrice: price,
        unrealizedPnl: 0,
        totalFees: fees,
        totalSlippage: slippage
      });
    }
    
    this.cash -= (quantity * price + fees);
  }
  
  async updateEquity(marketPrices: Map<string, number>): Promise<void> {
    let totalValue = this.cash;
    
    for (const [symbol, position] of this.positions) {
      const marketPrice = marketPrices.get(symbol) || position.avgPrice;
      position.unrealizedPnl = (marketPrice - position.avgPrice) * position.quantity;
      totalValue += position.quantity * marketPrice;
    }
    
    this.equity = totalValue;
    this.highWaterMark = Math.max(this.highWaterMark, this.equity);
  }
  
  getDrawdown(): number {
    return this.highWaterMark > 0 ? (this.highWaterMark - this.equity) / this.highWaterMark : 0;
  }
}

interface Position {
  symbol: string;
  quantity: number;
  avgPrice: number;
  unrealizedPnl: number;
  totalFees: number;
  totalSlippage: number;
}

interface PendingOrder {
  id: string;
  signal: Signal;
  timestamp: Date;
  status: 'pending' | 'partial' | 'filled' | 'cancelled';
}

export class StreamingBacktestingFramework extends EventEmitter {
  private logger: winston.Logger;
  private config!: StreamingBacktestConfig;
  private strategy!: StreamingStrategy;
  private portfolio!: StreamingPortfolio;
  private workers: Worker[] = [];
  private metricsWorker?: Worker;
  
  constructor(logger: winston.Logger) {
    super();
    this.logger = logger;
  }
  
  async runBacktest(
    config: StreamingBacktestConfig,
    strategy: StreamingStrategy
  ): Promise<StreamingBacktestResult> {
    this.config = config;
    this.strategy = strategy;
    this.portfolio = new StreamingPortfolio(config.initialCapital);
    
    this.logger.info('Starting streaming backtest', {
      strategy: strategy.name,
      startDate: config.startDate,
      endDate: config.endDate,
      symbols: config.symbols,
      workers: config.parallelWorkers
    });
    
    // Initialize workers
    await this.initializeWorkers();
    
    // Initialize strategy
    if (strategy.onInit) {
      await strategy.onInit(config);
    }
    
    // Create result streams
    const tradeStream = this.createTradeStream();
    const equityStream = this.createEquityStream();
    const finalMetrics = this.processFinalMetrics();
    
    // Start simulation
    this.simulate().catch(err => {
      this.logger.error('Simulation error', err);
      this.emit('error', err);
    });
    
    return {
      config,
      performance: await this.getInitialPerformance(),
      trades: tradeStream,
      equityCurve: equityStream,
      finalMetrics
    };
  }
  
  private async initializeWorkers(): Promise<void> {
    // Create worker pool for parallel processing
    for (let i = 0; i < this.config.parallelWorkers; i++) {
      const worker = new Worker('./workers/backtest-worker.js', {
        workerData: {
          workerId: i,
          config: this.config
        }
      });
      
      worker.on('error', err => {
        this.logger.error(`Worker ${i} error`, err);
      });
      
      worker.on('message', msg => {
        this.handleWorkerMessage(i, msg);
      });
      
      this.workers.push(worker);
    }
    
    // Create dedicated metrics worker
    this.metricsWorker = new Worker('./workers/metrics-worker.js');
  }
  
  private async simulate(): Promise<void> {
    const dataStreams = new Map<string, AsyncIterable<MarketData>>();
    
    // Create data streams for each symbol
    for (const symbol of this.config.symbols) {
      const stream = this.config.dataSource.createStream(
        symbol,
        this.config.startDate,
        this.config.endDate
      );
      dataStreams.set(symbol, stream);
    }
    
    // Process data in parallel chunks
    const chunkPromises: Promise<void>[] = [];
    
    for (const [symbol, stream] of dataStreams) {
      const promise = this.processSymbolStream(symbol, stream);
      chunkPromises.push(promise);
    }
    
    // Wait for all streams to complete
    await Promise.all(chunkPromises);
    
    // Finalize strategy
    if (this.strategy.onEnd) {
      await this.strategy.onEnd();
    }
    
    // Cleanup workers
    await this.cleanupWorkers();
    
    this.emit('complete');
  }
  
  private async processSymbolStream(
    symbol: string,
    stream: AsyncIterable<MarketData>
  ): Promise<void> {
    const chunks: MarketData[] = [];
    
    for await (const bar of stream) {
      chunks.push(bar);
      
      if (chunks.length >= this.config.chunkSize) {
        await this.processChunk(chunks);
        chunks.length = 0;
      }
      
      // Emit progress
      this.emit('progress', {
        symbol,
        timestamp: bar.timestamp,
        processed: true
      });
    }
    
    // Process remaining data
    if (chunks.length > 0) {
      await this.processChunk(chunks);
    }
  }
  
  private async processChunk(chunk: MarketData[]): Promise<void> {
    // Group by timestamp for synchronized processing
    const timeGroups = new Map<number, MarketData[]>();
    
    for (const bar of chunk) {
      const time = bar.timestamp.getTime();
      if (!timeGroups.has(time)) {
        timeGroups.set(time, []);
      }
      timeGroups.get(time)!.push(bar);
    }
    
    // Process each time group
    for (const [timestamp, bars] of timeGroups) {
      await this.processTimeSlice(new Date(timestamp), bars);
    }
  }
  
  private async processTimeSlice(timestamp: Date, bars: MarketData[]): Promise<void> {
    // Update market prices
    const marketPrices = new Map<string, number>();
    for (const bar of bars) {
      marketPrices.set(bar.symbol, bar.close);
    }
    
    // Update portfolio equity
    await this.portfolio.updateEquity(marketPrices);
    
    // Record equity point
    const equityPoint: EquityPoint = {
      timestamp,
      equity: await this.portfolio.getEquity(),
      drawdown: this.portfolio.getDrawdown(),
      openPositions: (await this.portfolio.getAllPositions()).length
    };
    
    this.emit('equity-update', equityPoint);
    
    // Process each bar through strategy
    for (const bar of bars) {
      const signal = await this.strategy.onBar(bar, this.portfolio);
      
      if (signal) {
        await this.executeSignal(signal, bar);
      }
    }
  }
  
  private async executeSignal(signal: Signal, marketData: MarketData): Promise<void> {
    const position = await this.portfolio.getPosition(signal.symbol);
    
    // Calculate execution details
    const execution = await this.calculateExecution(signal, marketData, position);
    
    if (!execution) {
      return;
    }
    
    // Create trade record
    const trade: Trade = {
      id: `TRADE-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      symbol: signal.symbol,
      side: signal.action as 'BUY' | 'SELL',
      entryTime: marketData.timestamp,
      entryPrice: execution.price,
      quantity: execution.quantity,
      fees: execution.fees,
      slippage: execution.slippage,
      isOpen: true
    };
    
    // Update portfolio
    const actualQuantity = signal.action === 'BUY' ? execution.quantity : -execution.quantity;
    await this.portfolio.updatePosition(
      signal.symbol,
      actualQuantity,
      execution.price,
      execution.fees,
      execution.slippage
    );
    
    this.emit('trade', trade);
  }
  
  private async calculateExecution(
    signal: Signal,
    marketData: MarketData,
    position?: Position
  ): Promise<ExecutionDetails | null> {
    // Delegate to worker for parallel calculation
    return new Promise((resolve) => {
      const workerId = Math.floor(Math.random() * this.workers.length);
      const worker = this.workers[workerId];
      
      const requestId = Math.random().toString(36);
      
      const handler = (msg: any) => {
        if (msg.type === 'execution-result' && msg.requestId === requestId) {
          worker.off('message', handler);
          resolve(msg.result);
        }
      };
      
      worker.on('message', handler);
      
      worker.postMessage({
        type: 'calculate-execution',
        requestId,
        signal,
        marketData,
        position,
        slippageModel: this.config.slippageModel,
        feeModel: this.config.feeModel
      });
    });
  }
  
  private createTradeStream(): AsyncIterable<Trade> {
    const trades: Trade[] = [];
    let resolveNext: ((value: IteratorResult<Trade>) => void) | null = null;
    
    this.on('trade', (trade: Trade) => {
      if (resolveNext) {
        resolveNext({ value: trade, done: false });
        resolveNext = null;
      } else {
        trades.push(trade);
      }
    });
    
    return {
      [Symbol.asyncIterator](): AsyncIterator<Trade> {
        return {
          async next(): Promise<IteratorResult<Trade>> {
            if (trades.length > 0) {
              return { value: trades.shift()!, done: false };
            }
            
            return new Promise(resolve => {
              resolveNext = resolve;
            });
          }
        };
      }
    };
  }
  
  private createEquityStream(): AsyncIterable<EquityPoint> {
    const points: EquityPoint[] = [];
    let resolveNext: ((value: IteratorResult<EquityPoint>) => void) | null = null;
    
    this.on('equity-update', (point: EquityPoint) => {
      if (resolveNext) {
        resolveNext({ value: point, done: false });
        resolveNext = null;
      } else {
        points.push(point);
      }
    });
    
    return {
      [Symbol.asyncIterator](): AsyncIterator<EquityPoint> {
        return {
          async next(): Promise<IteratorResult<EquityPoint>> {
            if (points.length > 0) {
              return { value: points.shift()!, done: false };
            }
            
            return new Promise(resolve => {
              resolveNext = resolve;
            });
          }
        };
      }
    };
  }
  
  private async processFinalMetrics(): Promise<FinalMetrics> {
    return new Promise((resolve) => {
      this.once('complete', async () => {
        // Delegate metrics calculation to worker
        if (this.metricsWorker) {
          this.metricsWorker.postMessage({
            type: 'calculate-final-metrics',
            data: {
              // Collect necessary data
            }
          });
          
          this.metricsWorker.once('message', (msg) => {
            if (msg.type === 'final-metrics') {
              resolve(msg.metrics);
            }
          });
        }
      });
    });
  }
  
  private async getInitialPerformance(): Promise<PerformanceMetrics> {
    // Return initial/empty performance metrics
    return {
      totalReturn: 0,
      annualizedReturn: 0,
      sharpeRatio: 0,
      sortinoRatio: 0,
      maxDrawdown: 0,
      winRate: 0,
      profitFactor: 0,
      totalTrades: 0,
      avgWin: 0,
      avgLoss: 0,
      expectancy: 0,
      calmarRatio: 0
    };
  }
  
  private handleWorkerMessage(workerId: number, message: any): void {
    switch (message.type) {
      case 'log':
        const logLevel = message.level as keyof winston.Logger;
        if (typeof this.logger[logLevel] === 'function') {
          (this.logger[logLevel] as any)(message.message, message.meta);
        }
        break;
        
      case 'error':
        this.logger.error(`Worker ${workerId} error`, message.error);
        break;
        
      case 'metrics':
        this.emit('worker-metrics', { workerId, metrics: message.metrics });
        break;
    }
  }
  
  private async cleanupWorkers(): Promise<void> {
    const terminationPromises = this.workers.map(worker => worker.terminate());
    
    if (this.metricsWorker) {
      terminationPromises.push(this.metricsWorker.terminate());
    }
    
    await Promise.all(terminationPromises);
    
    this.workers = [];
    this.metricsWorker = undefined;
  }
}

interface ExecutionDetails {
  price: number;
  quantity: number;
  fees: number;
  slippage: number;
} 