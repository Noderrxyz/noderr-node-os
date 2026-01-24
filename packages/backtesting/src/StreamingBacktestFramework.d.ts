import { EventEmitter } from 'events';
import * as winston from 'winston';
export interface StreamingBacktestConfig {
    startDate: Date;
    endDate: Date;
    initialCapital: number;
    symbols: string[];
    dataSource: DataStreamSource;
    slippageModel: SlippageModel;
    feeModel: FeeModel;
    executionDelay: number;
    chunkSize: number;
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
export declare abstract class StreamingStrategy {
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
export declare class StreamingPortfolio {
    private cash;
    private positions;
    private pendingOrders;
    private equity;
    private highWaterMark;
    constructor(initialCapital: number);
    getCash(): Promise<number>;
    getEquity(): Promise<number>;
    getPosition(symbol: string): Promise<Position | undefined>;
    getAllPositions(): Promise<Position[]>;
    updatePosition(symbol: string, quantity: number, price: number, fees: number, slippage: number): Promise<void>;
    updateEquity(marketPrices: Map<string, number>): Promise<void>;
    getDrawdown(): number;
}
interface Position {
    symbol: string;
    quantity: number;
    avgPrice: number;
    unrealizedPnl: number;
    totalFees: number;
    totalSlippage: number;
}
export declare class StreamingBacktestingFramework extends EventEmitter {
    private logger;
    private config;
    private strategy;
    private portfolio;
    private workers;
    private metricsWorker?;
    constructor(logger: winston.Logger);
    runBacktest(config: StreamingBacktestConfig, strategy: StreamingStrategy): Promise<StreamingBacktestResult>;
    private initializeWorkers;
    private simulate;
    private processSymbolStream;
    private processChunk;
    private processTimeSlice;
    private executeSignal;
    private calculateExecution;
    private createTradeStream;
    private createEquityStream;
    private processFinalMetrics;
    private getInitialPerformance;
    private handleWorkerMessage;
    private cleanupWorkers;
}
export {};
//# sourceMappingURL=StreamingBacktestFramework.d.ts.map