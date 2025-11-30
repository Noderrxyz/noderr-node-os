import { Exchange, LiquiditySnapshot, MarketData } from './types';
import { Logger } from 'winston';
import EventEmitter from 'events';
interface CacheConfig {
    cexTTL: number;
    dexTTL: number;
    defaultTTL: number;
    priceInvalidationThreshold: number;
    maxCacheSize: number;
    warmupPairs: string[];
    warmupInterval: number;
}
export declare class LiquidityAggregator extends EventEmitter {
    private logger;
    private state;
    private cache;
    private cexCache;
    private dexCache;
    private cacheConfig;
    private updateInterval?;
    private warmupInterval?;
    private reconnectAttempts;
    private maxConcurrentVenues;
    private batchProcessor?;
    constructor(logger: Logger, exchanges: Exchange[], cacheConfig?: Partial<CacheConfig>);
    /**
     * Get aggregated liquidity snapshot for a symbol
     * [NODERR_EXEC_OPTIMIZATION_STAGE_3_LIQUIDITY]: Enhanced with smart caching and parallel processing
     */
    getAggregatedLiquidity(symbol: string): Promise<LiquiditySnapshot>;
    private getFromSmartCache;
    private storeInSmartCache;
    private getDynamicInvalidationThreshold;
    private getSymbolVolatility;
    private getSymbol24hVolume;
    private isCacheValid;
    private updatePriceTracking;
    private invalidateSymbolCache;
    private getExchangeLiquidityParallel;
    private getLiquidityWithConcurrencyLimit;
    private queueBatchRequest;
    private startBatchProcessor;
    private processBatchRequests;
    private updateVenueLatency;
    private scheduleRetryWithBackoff;
    private startCacheWarming;
    private warmPopularPairs;
    /**
     * Get real-time market data for a symbol
     */
    getMarketData(symbol: string): Promise<MarketData>;
    /**
     * Subscribe to real-time updates for symbols
     */
    subscribe(symbols: string[]): void;
    /**
     * Unsubscribe from symbols
     */
    unsubscribe(symbols: string[]): void;
    private initializeConnections;
    private connectToExchange;
    private scheduleReconnect;
    private handleMessage;
    private handleOrderBookUpdate;
    private handleTradeUpdate;
    private handleTickerUpdate;
    private parsePriceLevels;
    private getExchangeLiquidity;
    /**
     * OPTIMIZED: Extract individual exchange liquidity data gathering
     */
    private getExchangeLiquidityData;
    private aggregateOrderBooks;
    private calculateBestPrices;
    private calculateImbalance;
    private subscribeToExchange;
    private unsubscribeFromExchange;
    private refreshStaleData;
    private getLastTradePrice;
    private calculate24hVolume;
    private calculate24hHigh;
    private calculate24hLow;
    private calculate24hVWAP;
    private count24hTrades;
    private calculateVolatility;
    private aggregateMarketData;
    private createMockTrade;
    /**
     * Clean up resources
     * [FIX][CRITICAL] - Enhanced cleanup with comprehensive timer and resource management and WebSocket listener cleanup
     */
    destroy(): void;
}
export {};
//# sourceMappingURL=LiquidityAggregator.d.ts.map