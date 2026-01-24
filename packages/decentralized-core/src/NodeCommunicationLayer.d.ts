import { EventEmitter } from 'events';
import * as winston from 'winston';
/**
 * Node identity and metadata
 */
export interface NodeIdentity {
    peerId: string;
    address: string;
    reputation: number;
    capabilities: string[];
    region: string;
    version: string;
}
/**
 * Trading signal to broadcast
 */
export interface TradingSignal {
    id: string;
    timestamp: number;
    symbol: string;
    action: 'buy' | 'sell' | 'hold';
    confidence: number;
    price: number;
    size: number;
    strategy: string;
    nodeId: string;
    signature: string;
}
/**
 * Execution result to share
 */
export interface ExecutionResult {
    signalId: string;
    nodeId: string;
    timestamp: number;
    executedPrice: number;
    executedSize: number;
    slippage: number;
    fees: number;
    venue: string;
    success: boolean;
    signature: string;
}
/**
 * Node performance metrics
 */
export interface NodeMetrics {
    nodeId: string;
    timestamp: number;
    signalsGenerated: number;
    signalsExecuted: number;
    successRate: number;
    avgSlippage: number;
    totalPnL: number;
    uptime: number;
}
/**
 * Message types for P2P communication
 */
export declare enum MessageType {
    SIGNAL = "signal",
    EXECUTION = "execution",
    METRICS = "metrics",
    HEARTBEAT = "heartbeat",
    CONSENSUS = "consensus",
    CHALLENGE = "challenge"
}
/**
 * P2P message structure
 */
export interface P2PMessage {
    type: MessageType;
    payload: any;
    timestamp: number;
    sender: string;
    signature: string;
}
/**
 * Decentralized node communication layer
 */
export declare class NodeCommunicationLayer extends EventEmitter {
    private node;
    private logger;
    private identity;
    private wallet;
    private peers;
    private signalHistory;
    private executionHistory;
    private readonly SIGNAL_TOPIC;
    private readonly EXECUTION_TOPIC;
    private readonly METRICS_TOPIC;
    private readonly CONSENSUS_TOPIC;
    constructor(identity: NodeIdentity, privateKey: string, logger: winston.Logger);
    /**
     * Initialize P2P node
     */
    initialize(listenAddresses?: string[]): Promise<void>;
    /**
     * Set up event handlers
     */
    private setupEventHandlers;
    /**
     * Subscribe to pub/sub topics
     */
    private subscribeToTopics;
    /**
     * Broadcast trading signal
     */
    broadcastSignal(signal: Omit<TradingSignal, 'nodeId' | 'signature'>): Promise<void>;
    /**
     * Broadcast execution result
     */
    broadcastExecution(execution: Omit<ExecutionResult, 'nodeId' | 'signature'>): Promise<void>;
    /**
     * Generic broadcast message method
     */
    broadcastMessage(message: Omit<P2PMessage, "signature">): Promise<void>;
    /**
     * Handle incoming signal message
     */
    private handleSignalMessage;
    /**
     * Handle incoming execution message
     */
    private handleExecutionMessage;
    /**
     * Handle incoming metrics message
     */
    private handleMetricsMessage;
    /**
     * Handle consensus message
     */
    private handleConsensusMessage;
    /**
     * Verify message signature
     */
    private verifySignature;
    /**
     * Validate DHT record
     */
    private validateRecord;
    /**
     * Start heartbeat
     */
    private startHeartbeat;
    /**
     * Get connected peers
     */
    getConnectedPeers(): string[];
    /**
     * Get peer info
     */
    getPeerInfo(peerId: string): NodeIdentity | undefined;
    /**
     * Get signal history
     */
    getSignalHistory(limit?: number): TradingSignal[];
    /**
     * Get execution history for a signal
     */
    getExecutionHistory(signalId: string): ExecutionResult[];
    /**
     * Calculate consensus for a signal
     */
    calculateSignalConsensus(signalId: string): {
        executed: number;
        successful: number;
        avgSlippage: number;
        consensus: number;
    };
    /**
     * Shutdown the node
     */
    shutdown(): Promise<void>;
}
//# sourceMappingURL=NodeCommunicationLayer.d.ts.map