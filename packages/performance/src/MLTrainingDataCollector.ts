import { Logger } from '@noderr/utils/src';
import { eventBus, EventTopics, SimulationEvent, TradingSignal, ExecutionResult } from '@noderr/core/src';
import { PnLCalculator } from './PnLCalculator';
import * as fs from 'fs/promises';
import * as path from 'path';

interface MarketState {
    symbol: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    timestamp: number;
}

interface TrainingSample {
    state: MarketState;
    action: TradingSignal;
    reward: number;
    nextState: MarketState | null;
    done: boolean;
    strategyId: string;
    timestamp: number;
}

interface PendingExecution {
    signal: TradingSignal;
    state: MarketState;
    timestamp: number;
}

export class MLTrainingDataCollector {
    private logger: Logger;
    private trainingData: TrainingSample[] = [];
    private pnlCalculator: PnLCalculator;
    
    // CRITICAL FIX: Use proper correlation tracking
    private lastMarketState: Map<string, MarketState> = new Map(); // key: symbol
    private pendingExecutions: Map<string, PendingExecution> = new Map(); // key: orderId
    
    // MEDIUM FIX: Implement circular buffer to prevent unbounded memory growth
    private readonly MAX_TRAINING_SAMPLES = 100000;
    // LOW FIX #70: Make file path configurable via environment variable
    private readonly SAVE_DIRECTORY = process.env.ML_TRAINING_DATA_DIR || path.join(process.cwd(), 'ml_training_data');

    constructor() {
        this.logger = new Logger('MLTrainingDataCollector');
        this.pnlCalculator = new PnLCalculator();
    }

    public async start(): Promise<void> {
        this.logger.info('ML Training Data Collector started.');
        
        // Ensure save directory exists
        try {
            await fs.mkdir(this.SAVE_DIRECTORY, { recursive: true });
        } catch (error) {
            this.logger.error('Failed to create ML training data directory', { error });
        }
        
        eventBus.subscribe(EventTopics.MARKET_DATA_CANDLE, this.handleMarketData.bind(this), 'MLTrainingDataCollector');
        eventBus.subscribe(EventTopics.STRATEGY_SIGNAL, this.handleStrategySignal.bind(this), 'MLTrainingDataCollector');
        eventBus.subscribe(EventTopics.ORDER_EXECUTED, this.handleOrderExecuted.bind(this), 'MLTrainingDataCollector');
    }

    // MEDIUM FIX: Add error handling to all event handlers
    private handleMarketData(event: SimulationEvent): void {
        try {
            const candle = event.payload;
            if (!candle || !candle.symbol) {
                return;
            }
            
            const state: MarketState = {
                symbol: candle.symbol,
                open: candle.open || 0,
                high: candle.high || 0,
                low: candle.low || 0,
                close: candle.close || 0,
                volume: candle.volume || 0,
                timestamp: candle.timestamp || Date.now(),
            };
            
            this.lastMarketState.set(candle.symbol, state);
        } catch (error) {
            this.logger.error('Error handling market data', { error });
        }
    }

    private handleStrategySignal(event: SimulationEvent): void {
        try {
            const signal: TradingSignal = event.payload;
            if (!signal || !signal.symbol) {
                return;
            }
            
            const state = this.lastMarketState.get(signal.symbol);
            if (!state) {
                this.logger.warn('Received signal but no market state available', { symbol: signal.symbol });
                return;
            }
            
            // CRITICAL FIX: Store the signal with its market state for later correlation
            // We'll use the signal's metadata to track it through execution
            const trackingId = `${signal.strategyId}-${Date.now()}-${Math.random()}`;
            this.pendingExecutions.set(trackingId, {
                signal,
                state: { ...state },
                timestamp: Date.now(),
            });
            
            // Store tracking ID in signal metadata for correlation
            if (!signal.metadata) {
                signal.metadata = {};
            }
            // Type assertion needed because metadata is Record<string, unknown>
            (signal.metadata as Record<string, string>).mlTrackingId = trackingId;
            
        } catch (error) {
            this.logger.error('Error handling strategy signal', { error });
        }
    }

    private handleOrderExecuted(event: SimulationEvent): void {
        try {
            // LOW FIX #63: Properly type and validate event payload
            const executionResult = event.payload as ExecutionResult;
            if (!executionResult || typeof executionResult !== 'object') {
                this.logger.warn('Invalid execution result payload');
                return;
            }
            if (!executionResult || !executionResult.metadata) {
                return;
            }
            
            const trackingId = executionResult.metadata.mlTrackingId as string | undefined;
            if (!trackingId) {
                this.logger.debug('Order executed without ML tracking ID');
                return;
            }
            
            const pending = this.pendingExecutions.get(trackingId);
            if (!pending) {
                this.logger.warn('No pending execution found for tracking ID', { trackingId });
                return;
            }
            
            // CRITICAL FIX: Calculate real PnL using shared calculator
            const strategyId = (executionResult.metadata.strategyId as string) || 'unknown';
            const pnl = this.pnlCalculator.calculatePnL(strategyId, executionResult);
            
            // Get the next market state (current state after execution)
            const nextState = this.lastMarketState.get(executionResult.symbol) || null;
            
            // CRITICAL FIX: Create complete training sample with all fields populated
            const sample: TrainingSample = {
                state: pending.state,
                action: pending.signal,
                reward: pnl,
                nextState: nextState ? { ...nextState } : null,
                done: executionResult.status !== 'completed', // Episode ends if execution failed
                strategyId,
                timestamp: Date.now(),
            };
            
            this.addTrainingSample(sample);
            
            // Clean up pending execution
            this.pendingExecutions.delete(trackingId);
            
            this.logger.info(`Collected complete training sample. Reward: ${pnl.toFixed(4)}, Total samples: ${this.trainingData.length}`);
            
        } catch (error) {
            this.logger.error('Error handling order executed', { error });
        }
    }

    private addTrainingSample(sample: TrainingSample): void {
        this.trainingData.push(sample);
        
        // MEDIUM FIX: Implement circular buffer to prevent memory overflow
        if (this.trainingData.length > this.MAX_TRAINING_SAMPLES) {
            // Remove oldest 10% of samples when limit is reached
            const removeCount = Math.floor(this.MAX_TRAINING_SAMPLES * 0.1);
            this.trainingData.splice(0, removeCount);
            this.logger.info(`Training data buffer full. Removed ${removeCount} oldest samples.`);
        }
    }

    public async saveTrainingData(fileName?: string): Promise<void> {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const defaultFileName = `training_data_${timestamp}.json`;
        const filePath = path.join(this.SAVE_DIRECTORY, fileName || defaultFileName);
        
        try {
            await fs.writeFile(filePath, JSON.stringify(this.trainingData, null, 2));
            this.logger.info(`Successfully saved ${this.trainingData.length} training samples to ${filePath}`);
        } catch (error) {
            this.logger.error('Failed to save training data', { error, filePath });
        }
    }

    public getTrainingDataStats(): { count: number; pendingExecutions: number; trackedSymbols: number } {
        return {
            count: this.trainingData.length,
            pendingExecutions: this.pendingExecutions.size,
            trackedSymbols: this.lastMarketState.size,
        };
    }

    public stop(): void {
        this.logger.info('ML Training Data Collector stopping.');
        // Clean up pending executions that are too old (> 5 minutes)
        const now = Date.now();
        const fiveMinutes = 5 * 60 * 1000;
        for (const [trackingId, pending] of this.pendingExecutions.entries()) {
            if (now - pending.timestamp > fiveMinutes) {
                this.pendingExecutions.delete(trackingId);
            }
        }
    }
}
