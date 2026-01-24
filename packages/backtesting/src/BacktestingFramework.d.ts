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
    executionDelay: number;
    tickInterval: number;
}
export interface SlippageModel {
    type: 'fixed' | 'linear' | 'square_root';
    baseSlippage: number;
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
    var95: number;
    var99: number;
    cvar95: number;
    cvar99: number;
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
export declare abstract class Strategy {
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
export declare class Portfolio {
    private cash;
    private positions;
    private trades;
    private equity;
    constructor(initialCapital: number);
    getCash(): number;
    getEquity(): number;
    getPosition(symbol: string): Position | undefined;
    getAllPositions(): Position[];
    updatePosition(symbol: string, quantity: number, price: number, fees: number): void;
    updateEquity(marketPrices: Map<string, number>): void;
    addTrade(trade: Trade): void;
    getTrades(): Trade[];
}
interface Position {
    symbol: string;
    quantity: number;
    avgPrice: number;
    unrealizedPnl: number;
}
export declare class BacktestingFramework extends EventEmitter {
    private logger;
    private config;
    private strategy;
    private portfolio;
    private marketData;
    private currentIndex;
    private equityCurve;
    private highWaterMark;
    private currentDrawdown;
    private drawdowns;
    private currentDrawdownPeriod;
    constructor(logger: winston.Logger);
    runBacktest(config: BacktestConfig, strategy: Strategy): Promise<BacktestResult>;
    private loadHistoricalData;
    private generateSimulatedData;
    private simulate;
    private executeSignal;
    private executeTrade;
    private closePosition;
    private closeAllPositions;
    private calculateExecutionPrice;
    private calculateFees;
    private calculateTradeQuantity;
    private recordEquityPoint;
    private calculateResults;
    private calculateDailyReturns;
    private calculateSharpeRatio;
    private calculateSortinoRatio;
    private calculateProfitFactor;
    private calculateExpectancy;
    private calculateCalmarRatio;
    private calculateRiskMetrics;
}
export {};
//# sourceMappingURL=BacktestingFramework.d.ts.map