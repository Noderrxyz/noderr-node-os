import { EventEmitter } from 'events';
import * as winston from 'winston';
/**
 * Trading signal
 */
export interface TradingSignal {
    id: string;
    nodeId: string;
    timestamp: Date;
    symbol: string;
    action: 'buy' | 'sell' | 'hold';
    confidence: number;
    price?: number;
    quantity?: number;
    timeframe: string;
    indicators?: Record<string, any>;
    signature?: string;
}
/**
 * Consensus configuration
 */
export interface ConsensusConfig {
    minNodes: number;
    consensusThreshold: number;
    signalValidityWindow: number;
    useReputation: boolean;
    byzantineTolerance: number;
}
/**
 * Consensus result
 */
export interface ConsensusResult {
    consensusId: string;
    symbol: string;
    timestamp: Date;
    action: 'buy' | 'sell' | 'hold';
    confidence: number;
    participatingNodes: number;
    signals: TradingSignal[];
    weights: Map<string, number>;
    achieved: boolean;
}
/**
 * Node reputation data
 */
export interface NodeReputation {
    nodeId: string;
    score: number;
    signalsSubmitted: number;
    accurateSignals: number;
    lastUpdate: Date;
}
/**
 * Signal consensus mechanism
 */
export declare class SignalConsensus extends EventEmitter {
    private config;
    private logger;
    private activeSignals;
    private consensusHistory;
    private nodeReputations;
    private consensusTimer;
    constructor(config: ConsensusConfig, logger: winston.Logger);
    /**
     * Start consensus mechanism
     */
    start(): void;
    /**
     * Stop consensus mechanism
     */
    stop(): void;
    /**
     * Submit a trading signal
     */
    submitSignal(signal: TradingSignal): Promise<void>;
    /**
     * Check consensus for all symbols
     */
    private checkConsensus;
    /**
     * Check consensus for a specific symbol
     */
    private checkConsensusForSymbol;
    /**
     * Calculate signal weight based on node reputation
     */
    private calculateSignalWeight;
    /**
     * Update node reputations based on consensus
     */
    private updateReputations;
    /**
     * Verify signal signature
     */
    private verifySignature;
    /**
     * Get consensus history
     */
    getConsensusHistory(symbol?: string, limit?: number): ConsensusResult[];
    /**
     * Get node reputation
     */
    getNodeReputation(nodeId: string): NodeReputation | null;
    /**
     * Get all node reputations
     */
    getAllReputations(): NodeReputation[];
    /**
     * Get active signals
     */
    getActiveSignals(symbol?: string): TradingSignal[];
    /**
     * Calculate Byzantine fault tolerance
     */
    isByzantineTolerant(nodeCount: number): boolean;
    /**
     * Get consensus metrics
     */
    getMetrics(): ConsensusMetrics;
}
/**
 * Consensus metrics
 */
export interface ConsensusMetrics {
    totalSignals: number;
    activeSymbols: number;
    totalConsensus: number;
    successfulConsensus: number;
    successRate: number;
    averageNodes: number;
    nodeCount: number;
}
//# sourceMappingURL=SignalConsensus.d.ts.map