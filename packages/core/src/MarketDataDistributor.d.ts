import { EventEmitter } from 'events';
/**
 * Lock-Free Market Data Distributor
 * Features:
 * - Atomic sequence numbers for ordering
 * - Zero-copy conflation
 * - Lock-free ring buffers
 * - Multicast distribution
 * Target: 10M+ updates/second
 */
export declare class MarketDataDistributor extends EventEmitter {
    private sequenceNumber;
    private ringBuffers;
    private subscribers;
    private conflationEnabled;
    private bufferSize;
    private updateCount;
    private conflatedCount;
    constructor(options?: DistributorOptions);
    /**
     * Publish market data update (lock-free)
     */
    publish(update: MarketDataUpdate): boolean;
    /**
     * Batch publish for higher throughput
     */
    publishBatch(updates: MarketDataUpdate[]): number;
    /**
     * Subscribe to market data updates
     */
    subscribe(symbol: string, subscriber: MarketDataSubscriber): void;
    /**
     * Unsubscribe from market data
     */
    unsubscribe(symbol: string, subscriber: MarketDataSubscriber): void;
    /**
     * Get conflated view of market data
     */
    getConflatedView(symbol: string): MarketDataUpdate | null;
    /**
     * Get historical data from ring buffer
     */
    getHistory(symbol: string, count: number): MarketDataUpdate[];
    /**
     * Enable/disable conflation
     */
    setConflation(enabled: boolean): void;
    /**
     * Get distributor statistics
     */
    getStats(): DistributorStats;
}
export interface DistributorOptions {
    bufferSize?: number;
    conflation?: boolean;
    symbols?: string[];
}
export interface MarketDataUpdate {
    symbol: string;
    sequence?: number;
    timestamp?: bigint;
    bidPrice?: number;
    bidSize?: number;
    askPrice?: number;
    askSize?: number;
    lastPrice?: number;
    volume?: number;
    isSnapshot?: boolean;
    isTrade?: boolean;
    isQuote?: boolean;
}
export interface MarketDataSnapshot {
    symbol: string;
    timestamp: bigint;
    bidPrice: number;
    bidSize: number;
    askPrice: number;
    askSize: number;
    lastPrice: number;
    volume: number;
    updateCount: number;
}
export interface MarketDataSubscriber {
    onUpdate(update: MarketDataUpdate): void;
    onSnapshot(snapshot: MarketDataSnapshot): void;
}
export interface DistributorStats {
    sequenceNumber: number;
    updateCount: number;
    conflatedCount: number;
    symbolCount: number;
    subscriberCount: number;
    bufferStats: {
        [symbol: string]: BufferStats;
    };
    memoryUsage: NodeJS.MemoryUsage;
}
export interface BufferStats {
    size: number;
    capacity: number;
    writeCount: number;
    readCount: number;
    conflatedCount: number;
    head: number;
    tail: number;
}
/**
 * High-performance market data subscriber
 */
export declare class HighPerformanceSubscriber implements MarketDataSubscriber {
    private updateCount;
    private lastSequence;
    private gaps;
    onUpdate(update: MarketDataUpdate): void;
    onSnapshot(snapshot: MarketDataSnapshot): void;
    getStats(): {
        updateCount: number;
        gaps: number;
        lastSequence: number;
    };
}
/**
 * Benchmark for market data distributor
 */
export declare class MarketDataBenchmark {
    static runBenchmark(): Promise<void>;
}
export default MarketDataDistributor;
//# sourceMappingURL=MarketDataDistributor.d.ts.map