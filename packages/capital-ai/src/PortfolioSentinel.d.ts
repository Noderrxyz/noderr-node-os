import { EventEmitter } from 'events';
interface PortfolioState {
    totalValue: number;
    cash: number;
    positions: Map<string, PositionState>;
    pnl: {
        realized: number;
        unrealized: number;
        total: number;
    };
    metrics: PortfolioMetrics;
    lastUpdated: Date;
}
interface PositionState {
    symbol: string;
    quantity: number;
    avgEntryPrice: number;
    currentPrice: number;
    marketValue: number;
    unrealizedPnL: number;
    realizedPnL: number;
    weight: number;
    strategy: string;
}
interface PortfolioMetrics {
    sharpeRatio: number;
    sortinoRatio: number;
    maxDrawdown: number;
    currentDrawdown: number;
    volatility: number;
    beta: number;
    winRate: number;
    profitFactor: number;
    calmarRatio: number;
}
interface PortfolioConstraints {
    maxDrawdown: number;
    maxLeverage: number;
    maxConcentration: number;
    minCash: number;
    maxPositions: number;
    sectorLimits: Map<string, number>;
    strategyLimits: Map<string, number>;
    riskLimits: {
        maxVaR: number;
        maxDailyLoss: number;
        maxVolatility: number;
        maxBeta: number;
    };
}
interface CapitalFlow {
    id: string;
    timestamp: Date;
    type: 'ALLOCATION' | 'REBALANCE' | 'WITHDRAWAL' | 'DEPOSIT' | 'FREEZE';
    from: string;
    to: string;
    amount: number;
    reason: string;
    approved: boolean;
    executed: boolean;
    impact: {
        portfolioValue: number;
        drawdown: number;
        leverage: number;
    };
}
interface EmergencyAction {
    id: string;
    timestamp: Date;
    type: 'FREEZE' | 'LIQUIDATE' | 'HEDGE' | 'DELEVERAGE';
    reason: string;
    severity: 'HIGH' | 'CRITICAL';
    targetStrategies: string[];
    status: 'PENDING' | 'EXECUTING' | 'COMPLETED' | 'FAILED';
    result?: string;
}
export declare class PortfolioSentinel extends EventEmitter {
    private logger;
    private portfolioState;
    private constraints;
    private rebalanceTriggers;
    private capitalFlows;
    private emergencyActions;
    private updateInterval;
    private frozen;
    private highWaterMark;
    constructor();
    private initializeMetrics;
    private initializeConstraints;
    private initializeTriggers;
    private registerTrigger;
    private startMonitoring;
    updatePosition(symbol: string, quantity: number, price: number, strategy: string): Promise<void>;
    updatePrice(symbol: string, price: number): Promise<void>;
    private updatePortfolioState;
    private updatePortfolioMetrics;
    private calculateReturns;
    private calculateVolatility;
    private calculateSharpeRatio;
    private calculateSortinoRatio;
    private checkTriggers;
    private evaluateTrigger;
    private handleTrigger;
    private enforceConstraints;
    private handleConstraintViolation;
    freezeCapital(reason: string): void;
    unfreezeCapital(): void;
    private emergencyStop;
    private reduceExposure;
    private requestRebalance;
    private sendAlert;
    recordCapitalFlow(flow: Omit<CapitalFlow, 'id' | 'timestamp' | 'impact'>): void;
    getPortfolioState(): PortfolioState;
    getCapitalFlowHistory(filters?: {
        type?: string;
        startDate?: Date;
        endDate?: Date;
    }, limit?: number): CapitalFlow[];
    updateConstraints(newConstraints: Partial<PortfolioConstraints>): void;
    getEmergencyActions(): EmergencyAction[];
    isFrozen(): boolean;
    destroy(): void;
}
export {};
//# sourceMappingURL=PortfolioSentinel.d.ts.map