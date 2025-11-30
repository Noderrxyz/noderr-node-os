import {
  Exchange,
  LiquiditySnapshot,
  ExchangeLiquidity,
  OrderBookDepth,
  PriceLevel,
  AggregatedLevel,
  Trade,
  MarketData,
  ExchangeMarketData,
  PriceSource,
  WebSocketConfig,
  Subscription,
  ChannelType,
  ExecutionError,
  ExecutionErrorCode
} from './types';
import { Logger } from 'winston';
import EventEmitter from 'events';
import WebSocket from 'ws';
import NodeCache from 'node-cache';

// Paper mode support would be integrated here
// Note: For production, this would import from a relative path
// For now, implementing basic paper mode support inline

// [NODERR_EXEC_OPTIMIZATION_STAGE_3_LIQUIDITY]: Enhanced cache configuration
interface CacheConfig {
  cexTTL: number; // CEX cache TTL in ms
  dexTTL: number; // DEX cache TTL in ms
  defaultTTL: number; // Default TTL
  priceInvalidationThreshold: number; // Price change % to invalidate cache
  maxCacheSize: number; // Maximum cache entries
  warmupPairs: string[]; // Pairs to pre-warm in cache
  warmupInterval: number; // How often to warm cache in ms
}

interface BatchRequest {
  exchange: string;
  symbol: string;
  timestamp: number;
  retryCount: number;
}

interface VenueQueryResult {
  exchange: string;
  symbol: string;
  data?: ExchangeLiquidity;
  error?: string;
  latency: number;
  fromCache: boolean;
}

interface AggregatorState {
  exchanges: Map<string, Exchange>;
  orderBooks: Map<string, Map<string, OrderBook>>; // symbol -> exchange -> orderbook
  trades: Map<string, Trade[]>;
  marketData: Map<string, MarketData>;
  connections: Map<string, WebSocket>;
  lastUpdate: Map<string, number>;
  // [NODERR_EXEC_OPTIMIZATION_STAGE_3_LIQUIDITY]: Enhanced state for optimization
  lastPrices: Map<string, Map<string, number>>; // symbol -> exchange -> price (for invalidation)
  requestQueue: Map<string, BatchRequest[]>; // exchange -> pending requests
  concurrentRequestLimiter: Map<string, number>; // exchange -> active request count
  venueLatencyTracking: Map<string, number[]>; // exchange -> recent latencies
}

interface OrderBook {
  bids: PriceLevel[];
  asks: PriceLevel[];
  lastUpdate: number;
  sequenceId?: number;
}

export class LiquidityAggregator extends EventEmitter {
  private logger: Logger;
  private state: AggregatorState;
  private cache: NodeCache;
  // [NODERR_EXEC_OPTIMIZATION_STAGE_3_LIQUIDITY]: Enhanced cache system
  private cexCache: NodeCache; // Fast cache for CEX data
  private dexCache: NodeCache; // Slower cache for DEX data
  private cacheConfig: CacheConfig;
  private updateInterval?: NodeJS.Timeout;
  private warmupInterval?: NodeJS.Timeout;
  private reconnectAttempts: Map<string, number>;
  private maxConcurrentVenues: number = 10; // Concurrency limit
  private batchProcessor?: NodeJS.Timeout;

  constructor(logger: Logger, exchanges: Exchange[], cacheConfig?: Partial<CacheConfig>) {
    super();
    this.logger = logger;
    
    // [NODERR_EXEC_OPTIMIZATION_STAGE_3_LIQUIDITY]: Enhanced cache configuration
    this.cacheConfig = {
      cexTTL: 500, // 500ms for CEX
      dexTTL: 2000, // 2s for DEX
      defaultTTL: 1000, // 1s default
      priceInvalidationThreshold: 0.001, // 0.1% price change
      maxCacheSize: 1000,
      warmupPairs: ['BTC/USDT', 'ETH/USDT', 'BTC/ETH', 'USDC/USDT'],
      warmupInterval: 60000, // 1 minute
      ...cacheConfig
    };
    
    this.state = {
      exchanges: new Map(exchanges.map(e => [e.id, e])),
      orderBooks: new Map(),
      trades: new Map(),
      marketData: new Map(),
      connections: new Map(),
      lastUpdate: new Map(),
      // [NODERR_EXEC_OPTIMIZATION_STAGE_3_LIQUIDITY]: Enhanced state
      lastPrices: new Map(),
      requestQueue: new Map(),
      concurrentRequestLimiter: new Map(),
      venueLatencyTracking: new Map()
    };
    
    // [NODERR_EXEC_OPTIMIZATION_STAGE_3_LIQUIDITY]: Multiple cache layers
    this.cache = new NodeCache({ stdTTL: this.cacheConfig.defaultTTL / 1000, checkperiod: 0.5 });
    this.cexCache = new NodeCache({ 
      stdTTL: this.cacheConfig.cexTTL / 1000, 
      checkperiod: 0.1, 
      maxKeys: this.cacheConfig.maxCacheSize 
    });
    this.dexCache = new NodeCache({ 
      stdTTL: this.cacheConfig.dexTTL / 1000, 
      checkperiod: 0.5, 
      maxKeys: this.cacheConfig.maxCacheSize 
    });
    
    this.reconnectAttempts = new Map();
    
    // Initialize concurrency limiters
    for (const exchange of exchanges) {
      this.state.concurrentRequestLimiter.set(exchange.id, 0);
      this.state.venueLatencyTracking.set(exchange.id, []);
    }
    
    // Initialize WebSocket connections
    this.initializeConnections();
    
    // [NODERR_EXEC_OPTIMIZATION_STAGE_3_LIQUIDITY]: Start cache warming
    this.startCacheWarming();
    
    // Start batch processor
    this.startBatchProcessor();
  }

  /**
   * Get aggregated liquidity snapshot for a symbol
   * [NODERR_EXEC_OPTIMIZATION_STAGE_3_LIQUIDITY]: Enhanced with smart caching and parallel processing
   */
  async getAggregatedLiquidity(symbol: string): Promise<LiquiditySnapshot> {
    const cacheKey = `liquidity-${symbol}`;
    
    // [NODERR_EXEC_OPTIMIZATION_STAGE_3_LIQUIDITY]: Smart cache lookup with venue-specific TTLs
    const cached = this.getFromSmartCache(cacheKey, symbol);
    if (cached) {
      this.logger.debug(`Cache hit for liquidity aggregation`, { symbol, cacheKey });
      return cached;
    }

    try {
      // [NODERR_EXEC_OPTIMIZATION_STAGE_3_LIQUIDITY]: Parallel venue queries with Promise.allSettled
      const exchangeLiquidity = await this.getExchangeLiquidityParallel(symbol);
      const aggregatedDepth = this.aggregateOrderBooks(exchangeLiquidity);
      
      // Calculate best bid/ask
      const { bestBid, bestAsk } = this.calculateBestPrices(exchangeLiquidity);
      
      // Calculate spread and imbalance
      const spread = bestAsk.price - bestBid.price;
      const spreadPercentage = spread / ((bestAsk.price + bestBid.price) / 2);
      const imbalance = this.calculateImbalance(aggregatedDepth);
      
      const snapshot: LiquiditySnapshot = {
        symbol,
        timestamp: Date.now(),
        exchanges: exchangeLiquidity,
        aggregatedDepth,
        bestBid,
        bestAsk,
        spread,
        spreadPercentage,
        imbalance
      };
      
      // [NODERR_EXEC_OPTIMIZATION_STAGE_3_LIQUIDITY]: Smart cache storage
      this.storeInSmartCache(cacheKey, snapshot, symbol);
      
      // Update price tracking for invalidation
      this.updatePriceTracking(symbol, exchangeLiquidity);
      
      return snapshot;
      
    } catch (error) {
      this.logger.error('Failed to aggregate liquidity', { symbol, error });
      throw new ExecutionError(
        ExecutionErrorCode.EXCHANGE_ERROR,
        'Failed to aggregate liquidity'
      );
    }
  }

  // [NODERR_EXEC_OPTIMIZATION_STAGE_3_LIQUIDITY]: Smart cache system with venue-specific TTLs
  private getFromSmartCache(cacheKey: string, symbol: string): LiquiditySnapshot | null {
    // Try CEX cache first (fastest)
    let cached = this.cexCache.get<LiquiditySnapshot>(cacheKey);
    if (cached) {
      // Verify cache is still valid based on price movements
      if (this.isCacheValid(symbol, cached)) {
        // [FIX][MONITORING] - Add cache hit logging
        this.logger.debug(`Cache hit (CEX)`, { 
          symbol, 
          cacheKey, 
          cacheType: 'cex',
          age: Date.now() - cached.timestamp 
        });
        return cached;
      } else {
        // Invalidate due to price movement
        this.logger.debug(`Cache invalidated due to price movement`, { symbol, cacheType: 'cex' });
        this.invalidateSymbolCache(symbol);
      }
    }
    
    // Try DEX cache
    cached = this.dexCache.get<LiquiditySnapshot>(cacheKey);
    if (cached && this.isCacheValid(symbol, cached)) {
      // [FIX][MONITORING] - Add cache hit logging
      this.logger.debug(`Cache hit (DEX)`, { 
        symbol, 
        cacheKey, 
        cacheType: 'dex',
        age: Date.now() - cached.timestamp 
      });
      return cached;
    }
    
    // Try default cache
    cached = this.cache.get<LiquiditySnapshot>(cacheKey);
    if (cached && this.isCacheValid(symbol, cached)) {
      // [FIX][MONITORING] - Add cache hit logging
      this.logger.debug(`Cache hit (default)`, { 
        symbol, 
        cacheKey, 
        cacheType: 'default',
        age: Date.now() - cached.timestamp 
      });
      return cached;
    }
    
    // [FIX][MONITORING] - Add cache miss logging
    this.logger.debug(`Cache miss`, { 
      symbol, 
      cacheKey,
      checkedCaches: ['cex', 'dex', 'default']
    });
    
    return null;
  }
  
  // [NODERR_EXEC_OPTIMIZATION_STAGE_3_LIQUIDITY]: Smart cache storage based on exchange type
  private storeInSmartCache(cacheKey: string, snapshot: LiquiditySnapshot, symbol: string): void {
    // Determine which cache to use based on exchange types in snapshot
    const hasCEX = snapshot.exchanges.some(e => {
      const exchange = this.state.exchanges.get(e.exchange);
      return exchange && exchange.type === 'cex';
    });
    
    const hasDEX = snapshot.exchanges.some(e => {
      const exchange = this.state.exchanges.get(e.exchange);
      return exchange && exchange.type === 'dex';
    });
    
    // Store in appropriate cache(s)
    if (hasCEX) {
      this.cexCache.set(cacheKey, snapshot);
    }
    
    if (hasDEX) {
      this.dexCache.set(cacheKey, snapshot);
    }
    
    // Always store in default cache as fallback
    this.cache.set(cacheKey, snapshot);
  }
  
  // [FIX][CRITICAL] - Dynamic price invalidation based on market conditions
  private getDynamicInvalidationThreshold(symbol: string): number {
    // Base threshold from config
    let threshold = this.cacheConfig.priceInvalidationThreshold;
    
    // Adjust threshold based on market volatility
    const volatility = this.getSymbolVolatility(symbol);
    if (volatility > 0.05) { // High volatility (>5%)
      threshold *= 0.5; // More sensitive invalidation
    } else if (volatility < 0.01) { // Low volatility (<1%)
      threshold *= 2.0; // Less sensitive invalidation
    }
    
    // Adjust threshold based on trading volume
    const volume = this.getSymbol24hVolume(symbol);
    if (volume > 1000000) { // High volume
      threshold *= 0.8; // More sensitive
    } else if (volume < 10000) { // Low volume
      threshold *= 1.5; // Less sensitive
    }
    
    // Ensure threshold stays within reasonable bounds
    return Math.max(0.001, Math.min(0.1, threshold)); // 0.1% to 10%
  }
  
  private getSymbolVolatility(symbol: string): number {
    // Calculate aggregate volatility across all exchanges
    let totalVolatility = 0;
    let exchangeCount = 0;
    
    for (const [exchangeId, exchange] of this.state.exchanges) {
      if (exchange.status.operational) {
        const volatility = this.calculateVolatility(symbol, exchangeId);
        if (volatility > 0) {
          totalVolatility += volatility;
          exchangeCount++;
        }
      }
    }
    
    return exchangeCount > 0 ? totalVolatility / exchangeCount : 0.02; // Default 2%
  }
  
  private getSymbol24hVolume(symbol: string): number {
    // Calculate aggregate 24h volume across all exchanges
    let totalVolume = 0;
    
    for (const [exchangeId, exchange] of this.state.exchanges) {
      if (exchange.status.operational) {
        totalVolume += this.calculate24hVolume(symbol, exchangeId);
      }
    }
    
    return totalVolume;
  }
  
  private isCacheValid(symbol: string, snapshot: LiquiditySnapshot): boolean {
    const now = Date.now();
    const age = now - snapshot.timestamp;
    
    // Check TTL first
    if (age > this.cacheConfig.defaultTTL) {
      return false;
    }
    
    // [FIX][CRITICAL] - Use dynamic invalidation threshold instead of static
    const dynamicThreshold = this.getDynamicInvalidationThreshold(symbol);
    
    // Get current prices for comparison
    const currentPrices = this.state.lastPrices.get(symbol);
    if (!currentPrices) {
      return true; // No price data to compare against
    }
    
    // Check if any exchange price has moved beyond the dynamic threshold
    for (const [exchangeId, currentPrice] of currentPrices) {
      const cachedExchange = snapshot.exchanges.find(e => e.exchange === exchangeId);
      if (cachedExchange && cachedExchange.bid.length > 0 && cachedExchange.ask.length > 0) {
        // Calculate midPrice from bid/ask
        const cachedMidPrice = (cachedExchange.bid[0].price + cachedExchange.ask[0].price) / 2;
        if (cachedMidPrice > 0) {
          const priceChange = Math.abs(currentPrice - cachedMidPrice) / cachedMidPrice;
          if (priceChange > dynamicThreshold) {
            this.logger.debug(`Cache invalidated for ${symbol}: ${exchangeId} price moved ${(priceChange * 100).toFixed(2)}% (threshold: ${(dynamicThreshold * 100).toFixed(2)}%)`);
            return false;
          }
        }
      }
    }
    
    return true;
  }
  
  // [NODERR_EXEC_OPTIMIZATION_STAGE_3_LIQUIDITY]: Update price tracking for invalidation
  private updatePriceTracking(symbol: string, exchangeLiquidity: ExchangeLiquidity[]): void {
    let symbolPrices = this.state.lastPrices.get(symbol);
    if (!symbolPrices) {
      symbolPrices = new Map();
      this.state.lastPrices.set(symbol, symbolPrices);
    }
    
    for (const exchangeLiq of exchangeLiquidity) {
      if (exchangeLiq.bid.length > 0 && exchangeLiq.ask.length > 0) {
        const midPrice = (exchangeLiq.bid[0].price + exchangeLiq.ask[0].price) / 2;
        symbolPrices.set(exchangeLiq.exchange, midPrice);
      }
    }
  }
  
  // [NODERR_EXEC_OPTIMIZATION_STAGE_3_LIQUIDITY]: Invalidate all cache entries for a symbol
  private invalidateSymbolCache(symbol: string): void {
    const patterns = [
      `liquidity-${symbol}`,
      `market-${symbol}`,
      `depth-${symbol}`
    ];
    
    for (const pattern of patterns) {
      this.cache.del(pattern);
      this.cexCache.del(pattern);
      this.dexCache.del(pattern);
    }
  }
  
  // [NODERR_EXEC_OPTIMIZATION_STAGE_3_LIQUIDITY]: Parallel exchange liquidity fetching with Promise.allSettled
  private async getExchangeLiquidityParallel(symbol: string): Promise<ExchangeLiquidity[]> {
    const startTime = Date.now();
    const exchanges = Array.from(this.state.exchanges.values());
    
    // [NODERR_EXEC_OPTIMIZATION_STAGE_3_LIQUIDITY]: Create promises for each exchange with concurrency limiting
    const promises = exchanges.map(exchange => 
      this.getLiquidityWithConcurrencyLimit(symbol, exchange)
    );
    
    // [NODERR_EXEC_OPTIMIZATION_STAGE_3_LIQUIDITY]: Use Promise.allSettled for resilient parallel execution
    const results = await Promise.allSettled(promises);
    
    const exchangeLiquidity: ExchangeLiquidity[] = [];
    const errors: string[] = [];
    
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const exchange = exchanges[i];
      
      if (result.status === 'fulfilled' && result.value) {
        exchangeLiquidity.push(result.value);
        
        // Track successful venue latency
        const latency = Date.now() - startTime;
        this.updateVenueLatency(exchange.id, latency);
        
      } else if (result.status === 'rejected') {
        const error = result.reason?.message || 'Unknown error';
        errors.push(`${exchange.id}: ${error}`);
        
        this.logger.warn(`Exchange liquidity fetch failed`, {
          symbol,
          exchange: exchange.id,
          error
        });
        
        // [NODERR_EXEC_OPTIMIZATION_STAGE_3_LIQUIDITY]: Schedule retry with backoff
        this.scheduleRetryWithBackoff(symbol, exchange.id);
      }
    }
    
    // [FIX][CRITICAL] - Handle case where all venues fail
    if (exchangeLiquidity.length === 0) {
      this.logger.error(`All venues failed for symbol ${symbol}`, {
        symbol,
        totalExchanges: exchanges.length,
        errors
      });
      
      throw new ExecutionError(
        ExecutionErrorCode.ALL_VENUES_FAILED,
        `All ${exchanges.length} venues failed for ${symbol}: ${errors.join('; ')}`
      );
    }
    
    // Log aggregation summary
    this.logger.info(`Parallel liquidity aggregation completed`, {
      symbol,
      totalExchanges: exchanges.length,
      successfulExchanges: exchangeLiquidity.length,
      failedExchanges: errors.length,
      totalLatency: Date.now() - startTime,
      errors: errors.length > 0 ? errors : undefined
    });
    
    return exchangeLiquidity;
  }
  
  // [NODERR_EXEC_OPTIMIZATION_STAGE_3_LIQUIDITY]: Concurrency-limited liquidity fetching
  private async getLiquidityWithConcurrencyLimit(
    symbol: string,
    exchange: Exchange
  ): Promise<ExchangeLiquidity | null> {
    // Check concurrency limit
    const currentLimit = this.state.concurrentRequestLimiter.get(exchange.id) || 0;
    if (currentLimit >= this.maxConcurrentVenues) {
      // Queue the request for batch processing
      this.queueBatchRequest(exchange.id, symbol);
      throw new Error(`Concurrency limit reached for ${exchange.id}`);
    }
    
    // Increment concurrency counter
    this.state.concurrentRequestLimiter.set(exchange.id, currentLimit + 1);
    
    try {
      const orderBook = this.state.orderBooks.get(symbol)?.get(exchange.id);
      if (!orderBook || !orderBook.bids.length || !orderBook.asks.length) {
        // Return minimal data structure to avoid breaking aggregation
        return null;
      }
      
      const liquidity = await this.getExchangeLiquidityData(symbol, exchange.id, orderBook);
      return liquidity;
      
    } finally {
      // Decrement concurrency counter
      const newLimit = Math.max(0, (this.state.concurrentRequestLimiter.get(exchange.id) || 1) - 1);
      this.state.concurrentRequestLimiter.set(exchange.id, newLimit);
    }
  }
  
  // [NODERR_EXEC_OPTIMIZATION_STAGE_3_LIQUIDITY]: Queue batch requests for processing
  private queueBatchRequest(exchange: string, symbol: string): void {
    let queue = this.state.requestQueue.get(exchange);
    if (!queue) {
      queue = [];
      this.state.requestQueue.set(exchange, queue);
    }
    
    // Avoid duplicate requests
    const isDuplicate = queue.some(req => req.symbol === symbol);
    if (!isDuplicate) {
      queue.push({
        exchange,
        symbol,
        timestamp: Date.now(),
        retryCount: 0
      });
    }
  }
  
  // [NODERR_EXEC_OPTIMIZATION_STAGE_3_LIQUIDITY]: Batch request processor
  private startBatchProcessor(): void {
    this.batchProcessor = setInterval(async () => {
      try {
        await this.processBatchRequests();
      } catch (error) {
        this.logger.error('Error in batch processor:', error);
      }
    }, 100); // Process every 100ms
  }
  
  // [NODERR_EXEC_OPTIMIZATION_STAGE_3_LIQUIDITY]: Process queued batch requests
  private async processBatchRequests(): Promise<void> {
    for (const [exchange, queue] of this.state.requestQueue) {
      if (queue.length === 0) continue;
      
      const currentLimit = this.state.concurrentRequestLimiter.get(exchange) || 0;
      const availableSlots = this.maxConcurrentVenues - currentLimit;
      
      if (availableSlots > 0) {
        // Process available requests
        const requestsToProcess = queue.splice(0, availableSlots);
        
        for (const request of requestsToProcess) {
          try {
            await this.getLiquidityWithConcurrencyLimit(request.symbol, 
              this.state.exchanges.get(exchange)!);
          } catch (error) {
            // Request failed, increment retry count
            request.retryCount++;
            if (request.retryCount < 3) {
              queue.push(request); // Re-queue for retry
            }
          }
        }
      }
    }
  }
  
  // [NODERR_EXEC_OPTIMIZATION_STAGE_3_LIQUIDITY]: Track venue latency for optimization
  private updateVenueLatency(exchangeId: string, latency: number): void {
    let latencies = this.state.venueLatencyTracking.get(exchangeId);
    if (!latencies) {
      latencies = [];
      this.state.venueLatencyTracking.set(exchangeId, latencies);
    }
    
    latencies.push(latency);
    if (latencies.length > 10) {
      latencies.shift(); // Keep only last 10 measurements
    }
  }
  
  // [NODERR_EXEC_OPTIMIZATION_STAGE_3_LIQUIDITY]: Schedule retry with exponential backoff
  private scheduleRetryWithBackoff(symbol: string, exchangeId: string): void {
    const retryDelay = 100 * Math.pow(2, Math.min(3, this.reconnectAttempts.get(exchangeId) || 0));
    
    setTimeout(async () => {
      try {
        const exchange = this.state.exchanges.get(exchangeId);
        if (exchange) {
          await this.getLiquidityWithConcurrencyLimit(symbol, exchange);
        }
      } catch (error) {
        // Retry failed, increment attempt counter
        const attempts = (this.reconnectAttempts.get(exchangeId) || 0) + 1;
        this.reconnectAttempts.set(exchangeId, Math.min(attempts, 5)); // Cap at 5 attempts
      }
    }, retryDelay);
  }
  
  // [NODERR_EXEC_OPTIMIZATION_STAGE_3_LIQUIDITY]: Predictive cache warming for popular pairs
  private startCacheWarming(): void {
    this.warmupInterval = setInterval(async () => {
      try {
        await this.warmPopularPairs();
      } catch (error) {
        this.logger.error('Error in cache warming:', error);
      }
    }, this.cacheConfig.warmupInterval);
    
    // Initial warm-up
    setTimeout(async () => {
      try {
        await this.warmPopularPairs();
      } catch (error) {
        this.logger.error('Error in initial cache warming:', error);
      }
    }, 1000);
  }
  
  // [NODERR_EXEC_OPTIMIZATION_STAGE_3_LIQUIDITY]: Warm cache for popular trading pairs
  private async warmPopularPairs(): Promise<void> {
    this.logger.debug(`Starting cache warming for popular pairs`, {
      pairs: this.cacheConfig.warmupPairs
    });
    
    const warmupPromises = this.cacheConfig.warmupPairs.map(async symbol => {
      try {
        // Check if already cached
        const cacheKey = `liquidity-${symbol}`;
        if (!this.getFromSmartCache(cacheKey, symbol)) {
          // Not cached, fetch and cache
          await this.getAggregatedLiquidity(symbol);
          this.logger.debug(`Warmed cache for ${symbol}`);
        }
      } catch (error) {
        this.logger.warn(`Failed to warm cache for ${symbol}`, { error });
      }
    });
    
    await Promise.allSettled(warmupPromises);
  }

  /**
   * Get real-time market data for a symbol
   */
  async getMarketData(symbol: string): Promise<MarketData> {
    const cached = this.state.marketData.get(symbol);
    if (cached && Date.now() - cached.timestamp < 1000) {
      return cached;
    }

    const exchanges: Record<string, ExchangeMarketData> = {};
    
    for (const [exchangeId, exchange] of this.state.exchanges) {
      const orderBook = this.state.orderBooks.get(symbol)?.get(exchangeId);
      if (!orderBook || !orderBook.bids.length || !orderBook.asks.length) {
        continue;
      }

      exchanges[exchangeId] = {
        bid: orderBook.bids[0].price,
        ask: orderBook.asks[0].price,
        last: this.getLastTradePrice(symbol, exchangeId),
        volume24h: this.calculate24hVolume(symbol, exchangeId),
        high24h: this.calculate24hHigh(symbol, exchangeId),
        low24h: this.calculate24hLow(symbol, exchangeId),
        vwap24h: this.calculate24hVWAP(symbol, exchangeId),
        trades24h: this.count24hTrades(symbol, exchangeId)
      };
    }

    const aggregated = this.aggregateMarketData(exchanges);
    
    const marketData: MarketData = {
      symbol,
      exchanges,
      aggregated,
      timestamp: Date.now()
    };

    this.state.marketData.set(symbol, marketData);
    return marketData;
  }

  /**
   * Subscribe to real-time updates for symbols
   */
  subscribe(symbols: string[]): void {
    for (const [exchangeId, ws] of this.state.connections) {
      if (ws.readyState === WebSocket.OPEN) {
        this.subscribeToExchange(exchangeId, symbols);
      }
    }
  }

  /**
   * Unsubscribe from symbols
   */
  unsubscribe(symbols: string[]): void {
    for (const [exchangeId, ws] of this.state.connections) {
      if (ws.readyState === WebSocket.OPEN) {
        this.unsubscribeFromExchange(exchangeId, symbols);
      }
    }
  }

  // Private methods

  private initializeConnections(): void {
    for (const exchange of this.state.exchanges.values()) {
      if (exchange.capabilities.includes('WEBSOCKET_FEED' as any)) {
        this.connectToExchange(exchange);
      }
    }
    
    // Start periodic refresh
    this.updateInterval = setInterval(() => {
      this.refreshStaleData();
    }, 5000);
  }

  private connectToExchange(exchange: Exchange): void {
    this.logger.info(`Connecting to ${exchange.name} WebSocket`);
    
    // Mock WebSocket URL - in production, use actual exchange URLs
    const wsUrl = `wss://stream.${exchange.id}.com/ws`;
    
    const ws = new WebSocket(wsUrl, {
      perMessageDeflate: true,
      handshakeTimeout: 10000
    });

    ws.on('open', () => {
      this.logger.info(`Connected to ${exchange.name}`);
      this.state.connections.set(exchange.id, ws);
      this.reconnectAttempts.set(exchange.id, 0);
      
      // Subscribe to default channels
      this.subscribeToExchange(exchange.id, []);
    });

    ws.on('message', (data: WebSocket.Data) => {
      this.handleMessage(exchange.id, data);
    });

    ws.on('error', (error) => {
      this.logger.error(`WebSocket error for ${exchange.name}`, error);
    });

    ws.on('close', () => {
      this.logger.warn(`Disconnected from ${exchange.name}`);
      this.state.connections.delete(exchange.id);
      
      // Attempt reconnection
      this.scheduleReconnect(exchange);
    });

    ws.on('ping', () => {
      ws.pong();
    });
  }

  private scheduleReconnect(exchange: Exchange): void {
    const attempts = this.reconnectAttempts.get(exchange.id) || 0;
    
    if (attempts < 5) {
      const delay = Math.min(1000 * Math.pow(2, attempts), 30000);
      
      setTimeout(() => {
        this.logger.info(`Reconnecting to ${exchange.name} (attempt ${attempts + 1})`);
        this.reconnectAttempts.set(exchange.id, attempts + 1);
        this.connectToExchange(exchange);
      }, delay);
    } else {
      this.logger.error(`Max reconnection attempts reached for ${exchange.name}`);
    }
  }

  private handleMessage(exchangeId: string, data: WebSocket.Data): void {
    try {
      const message = JSON.parse(data.toString());
      
      switch (message.type) {
        case 'orderbook':
          this.handleOrderBookUpdate(exchangeId, message);
          break;
        case 'trade':
          this.handleTradeUpdate(exchangeId, message);
          break;
        case 'ticker':
          this.handleTickerUpdate(exchangeId, message);
          break;
        default:
          this.logger.debug('Unknown message type', { exchangeId, type: message.type });
      }
      
      this.state.lastUpdate.set(exchangeId, Date.now());
      
    } catch (error) {
      this.logger.error('Failed to parse message', { exchangeId, error });
    }
  }

  private handleOrderBookUpdate(exchangeId: string, message: any): void {
    const { symbol, bids, asks, sequence } = message.data;
    
    let symbolBooks = this.state.orderBooks.get(symbol);
    if (!symbolBooks) {
      symbolBooks = new Map();
      this.state.orderBooks.set(symbol, symbolBooks);
    }

    const orderBook: OrderBook = {
      bids: this.parsePriceLevels(bids).slice(0, 50), // Keep top 50 levels
      asks: this.parsePriceLevels(asks).slice(0, 50),
      lastUpdate: Date.now(),
      sequenceId: sequence
    };

    symbolBooks.set(exchangeId, orderBook);
    
    // Emit update event
    this.emit('orderBookUpdate', {
      exchangeId,
      symbol,
      orderBook
    });
  }

  private handleTradeUpdate(exchangeId: string, message: any): void {
    const { symbol, price, quantity, side, timestamp, id } = message.data;
    
    const trade: Trade = {
      id: id || `${exchangeId}-${Date.now()}`,
      symbol,
      price: parseFloat(price),
      quantity: parseFloat(quantity),
      timestamp: timestamp || Date.now(),
      side: side.toLowerCase(),
      exchange: exchangeId
    };

    // Store recent trades
    const key = `${symbol}-${exchangeId}`;
    const trades = this.state.trades.get(key) || [];
    trades.unshift(trade);
    
    // Keep only recent trades (last 1000)
    if (trades.length > 1000) {
      trades.pop();
    }
    
    this.state.trades.set(key, trades);
    
    // Emit trade event
    this.emit('trade', trade);
  }

  private handleTickerUpdate(exchangeId: string, message: any): void {
    // Update market data with ticker information
    const { symbol, bid, ask, last, volume } = message.data;
    
    let marketData = this.state.marketData.get(symbol);
    if (!marketData) {
      marketData = {
        symbol,
        exchanges: {},
        aggregated: {} as any,
        timestamp: Date.now()
      };
      this.state.marketData.set(symbol, marketData);
    }

    marketData.exchanges[exchangeId] = {
      ...marketData.exchanges[exchangeId],
      bid: parseFloat(bid),
      ask: parseFloat(ask),
      last: parseFloat(last),
      volume24h: parseFloat(volume)
    };
  }

  private parsePriceLevels(levels: any[]): PriceLevel[] {
    return levels.map(level => ({
      price: parseFloat(level[0]),
      quantity: parseFloat(level[1]),
      orders: level[2] ? parseInt(level[2]) : 1
    }));
  }

  private async getExchangeLiquidity(symbol: string): Promise<ExchangeLiquidity[]> {
    const symbolBooks = this.state.orderBooks.get(symbol);
    if (!symbolBooks) {
      return [];
    }

    // OPTIMIZED: Create parallel tasks for each exchange
    const exchangeTasks = Array.from(symbolBooks.entries()).map(async ([exchangeId, orderBook]) => {
      const exchange = this.state.exchanges.get(exchangeId);
      if (!exchange || !exchange.status.operational) {
        return null;
      }

      try {
        // OPTIMIZED: Add timeout to individual exchange queries (5s max)
        const exchangeLiquidityPromise = this.getExchangeLiquidityData(symbol, exchangeId, orderBook);
        const timeoutPromise = new Promise<null>((_, reject) => {
          setTimeout(() => reject(new Error(`Exchange ${exchangeId} query timeout`)), 5000);
        });
        
        return await Promise.race([exchangeLiquidityPromise, timeoutPromise]);
      } catch (error) {
        this.logger.debug(`Failed to get liquidity from ${exchangeId}:`, error);
        return null;
      }
    });

    // OPTIMIZED: Execute all exchange queries in parallel with concurrency limit
    const maxConcurrency = 10; // Cap at 10 simultaneous queries
    const results: ExchangeLiquidity[] = [];
    
    // Process in batches to respect concurrency limit
    for (let i = 0; i < exchangeTasks.length; i += maxConcurrency) {
      const batch = exchangeTasks.slice(i, i + maxConcurrency);
      
      // OPTIMIZED: Use Promise.allSettled to handle partial failures gracefully
      const batchResults = await Promise.allSettled(batch);
      
      for (const result of batchResults) {
        if (result.status === 'fulfilled' && result.value) {
          results.push(result.value);
        } else if (result.status === 'rejected') {
          this.logger.debug('Exchange query failed:', result.reason);
        }
      }
    }

    this.logger.debug(`Aggregated liquidity from ${results.length}/${symbolBooks.size} exchanges for ${symbol}`);
    return results;
  }
  
  /**
   * OPTIMIZED: Extract individual exchange liquidity data gathering
   */
  private async getExchangeLiquidityData(
    symbol: string, 
    exchangeId: string, 
    orderBook: OrderBook
  ): Promise<ExchangeLiquidity> {
    const trades = this.state.trades.get(`${symbol}-${exchangeId}`) || [];
    const lastTrade = trades[0] || this.createMockTrade(symbol, exchangeId);
    
    // These calculations are now done in parallel context
    const [volume24h, trades24h, volatility] = await Promise.all([
      Promise.resolve(this.calculate24hVolume(symbol, exchangeId)),
      Promise.resolve(this.count24hTrades(symbol, exchangeId)),
      Promise.resolve(this.calculateVolatility(symbol, exchangeId))
    ]);
    
    return {
      exchange: exchangeId,
      bid: orderBook.bids,
      ask: orderBook.asks,
      lastTrade,
      volume24h,
      trades24h,
      volatility
    };
  }

  private aggregateOrderBooks(exchangeLiquidity: ExchangeLiquidity[]): OrderBookDepth {
    const aggregatedBids: Map<number, AggregatedLevel> = new Map();
    const aggregatedAsks: Map<number, AggregatedLevel> = new Map();
    
    // Aggregate bids
    for (const exchange of exchangeLiquidity) {
      for (const bid of exchange.bid) {
        const existing = aggregatedBids.get(bid.price);
        if (existing) {
          existing.quantity += bid.quantity;
          existing.exchanges.push(exchange.exchange);
          existing.orders += bid.orders || 1;
        } else {
          aggregatedBids.set(bid.price, {
            price: bid.price,
            quantity: bid.quantity,
            exchanges: [exchange.exchange],
            orders: bid.orders || 1
          });
        }
      }
    }
    
    // Aggregate asks
    for (const exchange of exchangeLiquidity) {
      for (const ask of exchange.ask) {
        const existing = aggregatedAsks.get(ask.price);
        if (existing) {
          existing.quantity += ask.quantity;
          existing.exchanges.push(exchange.exchange);
          existing.orders += ask.orders || 1;
        } else {
          aggregatedAsks.set(ask.price, {
            price: ask.price,
            quantity: ask.quantity,
            exchanges: [exchange.exchange],
            orders: ask.orders || 1
          });
        }
      }
    }
    
    // Sort and convert to arrays
    const bids = Array.from(aggregatedBids.values())
      .sort((a, b) => b.price - a.price)
      .slice(0, 100);
    
    const asks = Array.from(aggregatedAsks.values())
      .sort((a, b) => a.price - b.price)
      .slice(0, 100);
    
    // Calculate metrics
    const totalBidVolume = bids.reduce((sum, b) => sum + b.quantity, 0);
    const totalAskVolume = asks.reduce((sum, a) => sum + a.quantity, 0);
    const midPrice = bids.length && asks.length 
      ? (bids[0].price + asks[0].price) / 2 
      : 0;
    
    // Weighted mid price
    const bidWeight = bids.slice(0, 10).reduce((sum, b) => sum + b.quantity * b.price, 0);
    const askWeight = asks.slice(0, 10).reduce((sum, a) => sum + a.quantity * a.price, 0);
    const totalWeight = bids.slice(0, 10).reduce((sum, b) => sum + b.quantity, 0) +
                       asks.slice(0, 10).reduce((sum, a) => sum + a.quantity, 0);
    const weightedMidPrice = totalWeight > 0 ? (bidWeight + askWeight) / totalWeight : midPrice;
    
    return {
      bids,
      asks,
      midPrice,
      weightedMidPrice,
      totalBidVolume,
      totalAskVolume,
      depthImbalance: (totalBidVolume - totalAskVolume) / (totalBidVolume + totalAskVolume)
    };
  }

  private calculateBestPrices(
    exchangeLiquidity: ExchangeLiquidity[]
  ): { bestBid: PriceLevel; bestAsk: PriceLevel } {
    let bestBid: PriceLevel = { price: 0, quantity: 0 };
    let bestAsk: PriceLevel = { price: Infinity, quantity: 0 };
    
    for (const exchange of exchangeLiquidity) {
      if (exchange.bid.length > 0 && exchange.bid[0].price > bestBid.price) {
        bestBid = {
          ...exchange.bid[0],
          exchange: exchange.exchange
        };
      }
      
      if (exchange.ask.length > 0 && exchange.ask[0].price < bestAsk.price) {
        bestAsk = {
          ...exchange.ask[0],
          exchange: exchange.exchange
        };
      }
    }
    
    return { bestBid, bestAsk };
  }

  private calculateImbalance(depth: OrderBookDepth): number {
    // Calculate order book imbalance
    const bidPressure = depth.bids.slice(0, 10).reduce((sum: number, b: AggregatedLevel) => sum + b.quantity, 0);
    const askPressure = depth.asks.slice(0, 10).reduce((sum: number, a: AggregatedLevel) => sum + a.quantity, 0);
    
    return (bidPressure - askPressure) / (bidPressure + askPressure);
  }

  private subscribeToExchange(exchangeId: string, symbols: string[]): void {
    const ws = this.state.connections.get(exchangeId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }

    // Mock subscription message - format varies by exchange
    const subscribeMsg = {
      method: 'subscribe',
      params: {
        channels: ['orderbook', 'trades', 'ticker'],
        symbols: symbols.length > 0 ? symbols : ['BTC/USDT', 'ETH/USDT']
      }
    };

    ws.send(JSON.stringify(subscribeMsg));
  }

  private unsubscribeFromExchange(exchangeId: string, symbols: string[]): void {
    const ws = this.state.connections.get(exchangeId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const unsubscribeMsg = {
      method: 'unsubscribe',
      params: {
        channels: ['orderbook', 'trades', 'ticker'],
        symbols
      }
    };

    ws.send(JSON.stringify(unsubscribeMsg));
  }

  private refreshStaleData(): void {
    const staleThreshold = Date.now() - 10000; // 10 seconds
    
    for (const [exchangeId, lastUpdate] of this.state.lastUpdate) {
      if (lastUpdate < staleThreshold) {
        this.logger.warn(`Stale data detected for ${exchangeId}`);
        
        // Mark exchange as potentially problematic
        const exchange = this.state.exchanges.get(exchangeId);
        if (exchange) {
          exchange.reliability = Math.max(0, exchange.reliability - 0.01);
        }
      }
    }
  }

  private getLastTradePrice(symbol: string, exchangeId: string): number {
    const trades = this.state.trades.get(`${symbol}-${exchangeId}`);
    return trades && trades.length > 0 ? trades[0].price : 0;
  }

  private calculate24hVolume(symbol: string, exchangeId: string): number {
    const trades = this.state.trades.get(`${symbol}-${exchangeId}`) || [];
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    
    return trades
      .filter(t => t.timestamp > cutoff)
      .reduce((sum, t) => sum + t.quantity * t.price, 0);
  }

  private calculate24hHigh(symbol: string, exchangeId: string): number {
    const trades = this.state.trades.get(`${symbol}-${exchangeId}`) || [];
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    
    const prices = trades
      .filter(t => t.timestamp > cutoff)
      .map(t => t.price);
    
    return prices.length > 0 ? Math.max(...prices) : 0;
  }

  private calculate24hLow(symbol: string, exchangeId: string): number {
    const trades = this.state.trades.get(`${symbol}-${exchangeId}`) || [];
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    
    const prices = trades
      .filter(t => t.timestamp > cutoff)
      .map(t => t.price);
    
    return prices.length > 0 ? Math.min(...prices) : 0;
  }

  private calculate24hVWAP(symbol: string, exchangeId: string): number {
    const trades = this.state.trades.get(`${symbol}-${exchangeId}`) || [];
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    
    const recentTrades = trades.filter(t => t.timestamp > cutoff);
    
    if (recentTrades.length === 0) return 0;
    
    const totalValue = recentTrades.reduce((sum, t) => sum + t.quantity * t.price, 0);
    const totalVolume = recentTrades.reduce((sum, t) => sum + t.quantity, 0);
    
    return totalVolume > 0 ? totalValue / totalVolume : 0;
  }

  private count24hTrades(symbol: string, exchangeId: string): number {
    const trades = this.state.trades.get(`${symbol}-${exchangeId}`) || [];
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    
    return trades.filter(t => t.timestamp > cutoff).length;
  }

  private calculateVolatility(symbol: string, exchangeId: string): number {
    const trades = this.state.trades.get(`${symbol}-${exchangeId}`) || [];
    
    if (trades.length < 20) return 0;
    
    // Calculate returns
    const returns: number[] = [];
    for (let i = 1; i < Math.min(trades.length, 100); i++) {
      const ret = (trades[i - 1].price - trades[i].price) / trades[i].price;
      returns.push(ret);
    }
    
    // Calculate standard deviation
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    
    return Math.sqrt(variance) * Math.sqrt(252 * 24); // Annualized hourly volatility
  }

  private aggregateMarketData(
    exchanges: Record<string, ExchangeMarketData>
  ): MarketData['aggregated'] {
    const values = Object.values(exchanges);
    
    if (values.length === 0) {
      return {
        bestBid: { price: 0, quantity: 0, exchange: '', timestamp: Date.now() },
        bestAsk: { price: 0, quantity: 0, exchange: '', timestamp: Date.now() },
        midPrice: 0,
        weightedMidPrice: 0,
        spread: 0,
        volume24h: 0,
        vwap24h: 0,
        volatility: 0,
        liquidityScore: 0
      };
    }

    // Find best bid/ask
    let bestBid: PriceSource = { price: 0, quantity: 0, exchange: '', timestamp: Date.now() };
    let bestAsk: PriceSource = { price: Infinity, quantity: 0, exchange: '', timestamp: Date.now() };
    
    for (const [exchangeId, data] of Object.entries(exchanges)) {
      if (data.bid > bestBid.price) {
        bestBid = {
          price: data.bid,
          quantity: 0, // Would need order book data for actual quantity
          exchange: exchangeId,
          timestamp: Date.now()
        };
      }
      
      if (data.ask < bestAsk.price) {
        bestAsk = {
          price: data.ask,
          quantity: 0,
          exchange: exchangeId,
          timestamp: Date.now()
        };
      }
    }
    
    const midPrice = (bestBid.price + bestAsk.price) / 2;
    const spread = bestAsk.price - bestBid.price;
    const volume24h = values.reduce((sum, v) => sum + v.volume24h, 0);
    
    // Weighted average VWAP
    const totalValue = values.reduce((sum, v) => sum + v.vwap24h * v.volume24h, 0);
    const vwap24h = volume24h > 0 ? totalValue / volume24h : 0;
    
    return {
      bestBid,
      bestAsk,
      midPrice,
      weightedMidPrice: midPrice, // Simplified
      spread,
      volume24h,
      vwap24h,
      volatility: 0.02, // Mock value
      liquidityScore: Math.min(100, volume24h / 1000000)
    };
  }

  private createMockTrade(symbol: string, exchangeId: string): Trade {
    return {
      id: `mock-${Date.now()}`,
      symbol,
      price: 0,
      quantity: 0,
      timestamp: Date.now(),
      side: 'buy' as any,
      exchange: exchangeId
    };
  }

  /**
   * Clean up resources
   * [FIX][CRITICAL] - Enhanced cleanup with comprehensive timer and resource management and WebSocket listener cleanup
   */
  destroy(): void {
    this.logger.info('Destroying LiquidityAggregator and cleaning up resources');
    
    // Clear update interval
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = undefined;
    }
    
    // [FIX][CRITICAL] - Clear warmup interval timer
    if (this.warmupInterval) {
      clearInterval(this.warmupInterval);
      this.warmupInterval = undefined;
    }
    
    // [FIX][CRITICAL] - Clear batch processor timer
    if (this.batchProcessor) {
      clearInterval(this.batchProcessor);
      this.batchProcessor = undefined;
    }

    // [FIX][CRITICAL] - Close all WebSocket connections with proper event listener cleanup
    for (const [exchangeId, ws] of this.state.connections) {
      try {
        // Remove all event listeners before closing to prevent memory leaks
        ws.removeAllListeners('open');
        ws.removeAllListeners('message');
        ws.removeAllListeners('error');
        ws.removeAllListeners('close');
        ws.removeAllListeners('ping');
        ws.removeAllListeners('pong');
        
        // Set readyState check before closing
        if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) {
          ws.close();
        }
        
        this.logger.debug(`Cleaned up WebSocket for ${exchangeId}`);
      } catch (error) {
        this.logger.warn(`Error closing WebSocket for ${exchangeId}:`, error);
      }
      this.state.connections.delete(exchangeId);
    }

    // [FIX][CRITICAL] - Clear all caches with logging
    const cacheStats = {
      defaultCache: this.cache.keys().length,
      cexCache: this.cexCache.keys().length,
      dexCache: this.dexCache.keys().length
    };
    
    this.cache.flushAll();
    this.cexCache.flushAll();
    this.dexCache.flushAll();
    
    this.logger.info('Cache cleanup completed', cacheStats);
    
    // [FIX][CRITICAL] - Clear all state maps and arrays
    this.state.exchanges.clear();
    this.state.orderBooks.clear();
    this.state.trades.clear();
    this.state.marketData.clear();
    this.state.lastUpdate.clear();
    this.state.lastPrices.clear();
    this.state.requestQueue.clear();
    this.state.concurrentRequestLimiter.clear();
    this.state.venueLatencyTracking.clear();
    
    // Clear reconnection attempts
    this.reconnectAttempts.clear();
    
    // [FIX][CRITICAL] - Remove all EventEmitter listeners to prevent memory leaks
    this.removeAllListeners();
    
    this.logger.info('LiquidityAggregator destruction completed');
  }
} 