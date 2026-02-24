import { Logger } from '@noderr/utils';
import { eventBus, EventTopics, SimulationEvent, ExecutionResult } from '@noderr/core';
import { PnLCalculator } from './PnLCalculator';

interface StrategyPerformance {
    strategyId: string;
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    neutralTrades: number;
    totalPnl: number;
    winRate: number;
    lastUpdated: number;
}

export class PerformanceTracker {
    private logger: Logger;
    private performanceRecords: Map<string, StrategyPerformance> = new Map();
    private pnlCalculator: PnLCalculator;
    private lastMarketPrices: Map<string, number> = new Map(); // key: symbol

    constructor() {
        this.logger = new Logger('PerformanceTracker');
        this.pnlCalculator = new PnLCalculator();
    }

    public start(): void {
        this.logger.info('Performance Tracker started. Subscribing to events.');
        eventBus.subscribe(EventTopics.ORDER_EXECUTED, this.handleOrderExecuted.bind(this), 'PerformanceTracker');
        eventBus.subscribe(EventTopics.MARKET_DATA_CANDLE, this.handleMarketData.bind(this), 'PerformanceTracker');
    }

    private handleMarketData(event: SimulationEvent): void {
        try {
            const candle = event.payload;
            if (candle && candle.symbol && typeof candle.close === 'number') {
                this.lastMarketPrices.set(candle.symbol, candle.close);
            }
        } catch (error) {
            this.logger.error('Error handling market data', { error });
        }
    }

    private handleOrderExecuted(event: SimulationEvent): void {
        try {
            const executionResult: ExecutionResult = event.payload;
            
            // CRITICAL FIX: Extract strategyId from metadata, not orderId
            // Type assertion needed because metadata is Record<string, unknown>
            const strategyId = (executionResult.metadata?.strategyId as string) || 'unknown';
            
            if (strategyId === 'unknown') {
                this.logger.warn('Order executed without strategyId in metadata', { orderId: executionResult.orderId });
                return;
            }

            if (!this.performanceRecords.has(strategyId)) {
                this.performanceRecords.set(strategyId, {
                    strategyId,
                    totalTrades: 0,
                    winningTrades: 0,
                    losingTrades: 0,
                    neutralTrades: 0,
                    totalPnl: 0,
                    winRate: 0,
                    lastUpdated: Date.now(),
                });
            }

            const record = this.performanceRecords.get(strategyId)!;
            record.totalTrades++;
            record.lastUpdated = Date.now();

            // CRITICAL FIX: Calculate real PnL using shared calculator
            const pnl = this.pnlCalculator.calculatePnL(strategyId, executionResult);
            record.totalPnl += pnl;

            // MEDIUM FIX: Proper win/loss/neutral categorization
            if (pnl > 0) {
                record.winningTrades++;
            } else if (pnl < 0) {
                record.losingTrades++;
            } else {
                record.neutralTrades++;
            }

            record.winRate = record.totalTrades > 0 ? record.winningTrades / record.totalTrades : 0;

            this.logger.info(`[${strategyId}] Performance updated. PnL: ${pnl.toFixed(4)}, Win Rate: ${(record.winRate * 100).toFixed(2)}%`);

            eventBus.publish(EventTopics.PNL_UPDATE, record, 'PerformanceTracker');
        } catch (error) {
            this.logger.error('Error handling order executed event', { error });
        }
    }



    public getPerformanceReport(strategyId: string): StrategyPerformance | undefined {
        return this.performanceRecords.get(strategyId);
    }

    public getOpenPositions(strategyId: string) {
        return this.pnlCalculator.getOpenPositions(strategyId);
    }

    public stop(): void {
        this.logger.info('Performance Tracker stopping. Unsubscribing from events.');
        // Event bus should handle unsubscribe internally
    }
}
