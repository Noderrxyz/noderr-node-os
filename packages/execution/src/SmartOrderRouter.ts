import {
  Order,
  Exchange,
  RoutingDecision,
  ExecutionRoute,
  LiquiditySnapshot,
  OrderBookDepth,
  PriceLevel,
  RoutingConfig,
  OrderSide,
  OrderType,
  ExecutionError,
  ExecutionErrorCode,
  MarketCondition,
  LiquidityCondition,
  ExchangeLiquidity,
  AggregatedLevel
} from './types';
import { Logger } from 'winston';
import EventEmitter from 'events';
import NodeCache from 'node-cache';
import * as math from 'mathjs';
import { LiquidityAggregator } from './LiquidityAggregator';
import { CostOptimizer } from './CostOptimizer';
import { LatencyManager } from './LatencyManager';
import { LiveMetricsCollector, VenuePerformanceReport } from './LiveMetricsCollector';
import { loadSorFlags } from './config';
import { PaperLiquidityAggregator } from './PaperLiquidityAggregator';

// [NODERR_EXEC_OPTIMIZATION_STAGE_3_PERFORMANCE]: Object pooling and pre-allocation
interface PooledRouteContext {
  order: Order;
  liquidity: LiquiditySnapshot;
  exchanges: ExchangeLiquidity[];
  calculations: RouteCalculation[];
  timestamp: number;
  inUse: boolean;
}

interface RouteCalculation {
  exchange: string;
  score: number;
  cost: number;
  latency: number;
  reliability: number;
  quantity: number;
  priority: number;
  slippage: number;
}

interface MemoizedRouteEntry {
  key: string;
  result: ExecutionRoute[][];
  timestamp: number;
  hitCount: number;
  computationTime: number;
}

interface PerformanceMetrics {
  routingCalculations: number;
  cacheHits: number;
  cacheMisses: number;
  averageCalculationTime: number;
  objectPoolHits: number;
  objectPoolMisses: number;
  memoryOptimizations: number;
}

interface RouterState {
  exchanges: Map<string, Exchange>;
  liquidityCache: NodeCache;
  performanceMetrics: Map<string, ExchangeMetrics>;
  marketCondition: MarketCondition;
  liquidityCondition: LiquidityCondition;
  currentBlockHeight?: number;
  gasPrice?: number;
  // [NODERR_EXEC_OPTIMIZATION_STAGE_3_PERFORMANCE]: Enhanced state for optimization
  routeCache: Map<string, MemoizedRouteEntry>; // Memoization cache
  objectPool: PooledRouteContext[]; // Object pool for reuse
  availablePoolObjects: number[]; // Indices of available pool objects
  routeCalculationCache: Map<string, RouteCalculation>; // Pre-computed calculations
  exchangeArrayCache: Exchange[]; // Pre-allocated exchange arrays
  priceUpdateThreshold: number; // Threshold for cache invalidation
  lastPriceSnapshot: Map<string, number>; // Last known prices for cache invalidation
  lastUpdate: number;
}

interface ExchangeMetrics {
  fillRate: number;
  averageSlippage: number;
  failureRate: number;
  averageLatency: number;
  reliability: number;
  liquidityScore: number;
  costEfficiency: number;
}

export class SmartOrderRouter extends EventEmitter {
  private logger: Logger;
  private config: RoutingConfig;
  private state: RouterState;
  private liquidityAggregator: { getAggregatedLiquidity(symbol: string): Promise<LiquiditySnapshot> };
  private costOptimizer: CostOptimizer;
  private latencyManager: LatencyManager;
  private liveMetricsCollector: LiveMetricsCollector;
  private routingCache: NodeCache;
  private metricsUpdateTimer?: NodeJS.Timeout;
  
  // NODERR_EXEC_OPTIMIZATION_STAGE_1: Enhanced caching system
  private routePrecomputeCache: Map<string, ExecutionRoute[]> = new Map();
  private priceSnapshot: Map<string, { price: number; timestamp: number }> = new Map();
  private cacheWarmingTimer?: NodeJS.Timeout;
  private popularPairs: Set<string> = new Set(['BTC/USD', 'ETH/USD', 'BNB/USD', 'ADA/USD', 'SOL/USD']);
  private commonOrderSizes: number[] = [100, 500, 1000, 5000, 10000, 50000];

  // [NODERR_EXEC_OPTIMIZATION_STAGE_3_PERFORMANCE]: Performance optimization state
  private readonly POOL_SIZE = 20; // Object pool size
  private readonly CACHE_TTL = 10000; // 10 seconds cache TTL
  private readonly MAX_CACHE_SIZE = 1000; // Maximum cache entries
  private performanceTimer?: NodeJS.Timeout;
  private cacheCleanupTimer?: NodeJS.Timeout;

  // Add performance data storage
  private performanceData?: PerformanceMetrics;

  constructor(
    config: RoutingConfig,
    logger: Logger,
    exchanges: Exchange[]
  ) {
    super();
    this.config = config;
    this.logger = logger;
    
    // Initialize state
    this.state = {
      exchanges: new Map(exchanges.map(e => [e.id, e])),
      liquidityCache: new NodeCache({ stdTTL: 1, checkperiod: 1 }), // 1 second cache
      performanceMetrics: new Map(),
      marketCondition: MarketCondition.NORMAL,
      liquidityCondition: LiquidityCondition.NORMAL,
      // Performance optimization state
      routeCache: new Map(),
      objectPool: [],
      availablePoolObjects: [],
      routeCalculationCache: new Map(),
      exchangeArrayCache: [...exchanges], // Pre-allocated array
      priceUpdateThreshold: 0.001, // 0.1% price change
      lastPriceSnapshot: new Map(),
      lastUpdate: Date.now()
    };

    // Initialize components
    const sorFlags = loadSorFlags();
    const paperMode = !sorFlags.useProduction;
    if (paperMode) {
      // High: paper-mode short-circuit to in-memory aggregator; skip live metrics
      this.liquidityAggregator = new PaperLiquidityAggregator(logger, exchanges);
    } else {
      this.liquidityAggregator = new LiquidityAggregator(logger, exchanges);
    }
    this.costOptimizer = new CostOptimizer(logger);
    this.latencyManager = new LatencyManager(logger);
    this.liveMetricsCollector = new LiveMetricsCollector(exchanges, 10000); // 10s reports
    
    // OPTIMIZED: Enhanced routing cache with LRU and larger capacity
    this.routingCache = new NodeCache({ 
      stdTTL: 5, 
      checkperiod: 2,
      maxKeys: 1000 // OPTIMIZED: Increased from default to 1000 entries
    });

    // Initialize performance metrics
    this.initializeMetrics();
    
    // Start live metrics collection
    if (!paperMode) {
      this.startLiveMetrics();
    }
    
    // OPTIMIZED: Start cache warming for popular pairs
    this.startCacheWarming();

    // [NODERR_EXEC_OPTIMIZATION_STAGE_3_PERFORMANCE]: Initialize object pool
    this.initializeObjectPool();
    
    // [NODERR_EXEC_OPTIMIZATION_STAGE_3_PERFORMANCE]: Start performance monitoring
    this.startPerformanceMonitoring();
    
    // [NODERR_EXEC_OPTIMIZATION_STAGE_3_PERFORMANCE]: Start cache cleanup
    this.startCacheCleanup();
  }

  /**
   * Start live metrics collection and updates
   */
  private startLiveMetrics(): void {
    // Start collecting live metrics
    this.liveMetricsCollector.start();
    
    // Subscribe to performance reports
    this.liveMetricsCollector.on('venue-performance', (report: VenuePerformanceReport) => {
      this.updateExchangeMetricsFromReport(report);
    });
    
    // Subscribe to real-time events
    this.liveMetricsCollector.on('orderbook-metrics', (data) => {
      this.emit('telemetry:orderbook_update', data);
    });
    
    this.liveMetricsCollector.on('latency-metrics', (data) => {
      this.emit('telemetry:latency_update', data);
    });
    
    // Update routing decisions based on live metrics
    this.metricsUpdateTimer = setInterval(() => {
      this.updateRoutingPreferences();
    }, 30000); // Every 30 seconds
    
    this.logger.info('Live metrics collection started');
  }
  
  /**
   * Update exchange metrics from live performance report
   */
  private updateExchangeMetricsFromReport(report: VenuePerformanceReport): void {
    const metrics = this.state.performanceMetrics.get(report.exchangeId);
    if (!metrics) return;
    
    // Update with real data
    metrics.averageLatency = report.latency.avg1m;
    metrics.fillRate = report.fillRate.rate;
    metrics.averageSlippage = report.slippage.avgBps / 10000; // Convert from bps
    metrics.failureRate = report.fillRate.totalOrders > 0 
      ? 1 - report.fillRate.rate 
      : 0.01;
    metrics.reliability = report.uptime.percentage / 100;
    metrics.liquidityScore = report.marketQuality.liquidityScore;
    
    // Calculate cost efficiency based on fees and slippage
    const exchange = this.state.exchanges.get(report.exchangeId);
    if (exchange) {
      const avgFee = (exchange.tradingFees.maker + exchange.tradingFees.taker) / 2;
      const totalCost = avgFee + metrics.averageSlippage;
      metrics.costEfficiency = Math.max(0, 1 - totalCost * 100);
    }
    
    // Emit telemetry
    this.emit('telemetry:venue_metrics', {
      exchangeId: report.exchangeId,
      timestamp: report.timestamp,
      metrics: {
        latency: metrics.averageLatency,
        fillRate: metrics.fillRate,
        slippage: metrics.averageSlippage,
        reliability: metrics.reliability,
        liquidityScore: metrics.liquidityScore,
        costEfficiency: metrics.costEfficiency
      }
    });
    
    this.logger.debug('Updated exchange metrics from live data', {
      exchangeId: report.exchangeId,
      fillRate: metrics.fillRate.toFixed(3),
      avgLatency: metrics.averageLatency.toFixed(0),
      reliability: metrics.reliability.toFixed(3)
    });
  }
  
  /**
   * Update routing preferences based on live metrics
   */
  private updateRoutingPreferences(): void {
    const reports = this.liveMetricsCollector.getAllReports();
    
    // Sort exchanges by overall performance
    const rankedExchanges = reports
      .map(report => ({
        exchangeId: report.exchangeId,
        score: this.calculateExchangeScore(report)
      }))
      .sort((a, b) => b.score - a.score);
    
    // Update exchange priorities
    rankedExchanges.forEach((item, index) => {
      const exchange = this.state.exchanges.get(item.exchangeId);
      if (exchange) {
        // Dynamically adjust priority based on performance
        exchange.liquidityScore = item.score;
      }
    });
    
    // Detect market condition changes
    this.detectMarketCondition(reports);
    
    this.logger.info('Updated routing preferences based on live metrics', {
      topExchange: rankedExchanges[0]?.exchangeId,
      topScore: rankedExchanges[0]?.score.toFixed(2)
    });
  }
  
  /**
   * Calculate overall exchange score from performance report
   */
  private calculateExchangeScore(report: VenuePerformanceReport): number {
    const weights = {
      fillRate: 0.25,
      latency: 0.20,
      liquidity: 0.25,
      slippage: 0.15,
      uptime: 0.15
    };
    
    // Normalize metrics to 0-100 scale
    const fillScore = report.fillRate.rate * 100;
    const latencyScore = Math.max(0, 100 - report.latency.avg1m / 10); // Lower is better
    const liquidityScore = report.marketQuality.liquidityScore;
    const slippageScore = Math.max(0, 100 - report.slippage.avgBps / 10); // Lower is better
    const uptimeScore = report.uptime.percentage;
    
    return (
      fillScore * weights.fillRate +
      latencyScore * weights.latency +
      liquidityScore * weights.liquidity +
      slippageScore * weights.slippage +
      uptimeScore * weights.uptime
    );
  }
  
  /**
   * Detect market condition from live metrics
   */
  private detectMarketCondition(reports: VenuePerformanceReport[]): void {
    if (reports.length === 0) return;
    
    // Calculate average volatility and liquidity
    const avgVolatility = reports.reduce((sum, r) => 
      sum + r.marketQuality.volatility, 0
    ) / reports.length;
    
    const avgLiquidity = reports.reduce((sum, r) => 
      sum + r.marketQuality.liquidityScore, 0
    ) / reports.length;
    
    // Determine market condition
    let condition = MarketCondition.NORMAL;
    
    if (avgVolatility > 5) {
      condition = MarketCondition.EXTREME;
    } else if (avgVolatility > 2) {
      condition = MarketCondition.VOLATILE;
    } else if (avgVolatility < 0.5 && avgLiquidity > 80) {
      condition = MarketCondition.CALM;
    }
    
    if (condition !== this.state.marketCondition) {
      this.state.marketCondition = condition;
      this.emit('market-condition-changed', {
        oldCondition: this.state.marketCondition,
        newCondition: condition,
        timestamp: Date.now()
      });
    }
  }

  /**
   * Route an order using smart routing algorithms
   */
  async routeOrder(order: Order): Promise<RoutingDecision> {
    const startTime = Date.now();
    this.logger.info('Routing order', { 
      orderId: order.id, 
      symbol: order.symbol, 
      quantity: order.quantity 
    });

    try {
      // Check cache first
      const cacheKey = this.generateCacheKey(order);
      const cached = this.routingCache.get<RoutingDecision>(cacheKey);
      if (cached && this.isRoutingValid(cached, order)) {
        this.logger.debug('Using cached routing decision');
        return cached;
      }

      // Get current liquidity snapshot
      const liquidity = await this.liquidityAggregator.getAggregatedLiquidity(
        order.symbol
      );

      // Validate liquidity
      if (!this.hasAdequateLiquidity(liquidity, order)) {
        throw new ExecutionError(
          ExecutionErrorCode.INSUFFICIENT_LIQUIDITY,
          `Insufficient liquidity for ${order.symbol}`
        );
      }

      // Generate routing candidates
      const candidates = await this.generateRoutingCandidates(
        order,
        liquidity
      );

      // Optimize routes based on configuration
      const optimizedRoutes = await this.optimizeRoutes(
        candidates,
        order,
        liquidity
      );

      // Create routing decision
      const decision = this.createRoutingDecision(
        order,
        optimizedRoutes,
        liquidity
      );

      // Cache the decision
      this.routingCache.set(cacheKey, decision);

      // Emit routing event
      this.emit('orderRouted', {
        orderId: order.id,
        decision,
        executionTime: Date.now() - startTime
      });

      return decision;

    } catch (error) {
      this.logger.error('Routing failed', error);
      throw error;
    }
  }

  /**
   * Generate routing candidates based on liquidity and constraints
   */
  private async generateRoutingCandidates(
    order: Order,
    liquidity: LiquiditySnapshot
  ): Promise<ExecutionRoute[][]> {
    const candidates: ExecutionRoute[][] = [];

    // Strategy 1: Single venue execution
    if (this.config.mode !== 'smart' || order.quantity < this.config.splitThreshold) {
      candidates.push(...this.generateSingleVenueRoutes(order, liquidity));
    }

    // Strategy 2: Split execution across venues
    if (this.config.mode === 'smart' || this.config.mode === 'hybrid') {
      candidates.push(...this.generateSplitRoutes(order, liquidity));
    }

    // Strategy 3: Iceberg/Hidden liquidity
    if (this.config.darkPoolAccess && order.metadata?.darkPool !== false) {
      candidates.push(...this.generateDarkPoolRoutes(order, liquidity));
    }

    // Strategy 4: Cross-venue arbitrage
    if (this.config.crossVenueArbitrage) {
      candidates.push(...this.generateArbitrageRoutes(order, liquidity));
    }

    return candidates;
  }

  /**
   * Generate single venue execution routes
   */
  private generateSingleVenueRoutes(
    order: Order,
    liquidity: LiquiditySnapshot
  ): ExecutionRoute[][] {
    const routes: ExecutionRoute[][] = [];

    for (const exchangeLiq of liquidity.exchanges) {
      const exchange = this.state.exchanges.get(exchangeLiq.exchange);
      if (!exchange || !this.isExchangeEligible(exchange, order)) {
        continue;
      }

      const depth = order.side === OrderSide.BUY 
        ? exchangeLiq.ask 
        : exchangeLiq.bid;

      const execution = this.calculateSingleVenueExecution(
        order,
        exchange,
        depth
      );

      if (execution) {
        routes.push([execution]);
      }
    }

    return routes;
  }

  /**
   * Generate split execution routes across multiple venues
   */
  private generateSplitRoutes(
    order: Order,
    liquidity: LiquiditySnapshot
  ): ExecutionRoute[][] {
    const routes: ExecutionRoute[][] = [];
    
    // Get eligible exchanges sorted by liquidity
    const eligibleExchanges = liquidity.exchanges
      .filter((e: ExchangeLiquidity) => {
        const exchange = this.state.exchanges.get(e.exchange);
        return exchange && this.isExchangeEligible(exchange, order);
      })
      .sort((a: ExchangeLiquidity, b: ExchangeLiquidity) => b.volume24h - a.volume24h);

    // Generate different split strategies
    const splitStrategies = [
      this.generateProportionalSplit(order, eligibleExchanges),
      this.generateOptimalSplit(order, eligibleExchanges),
      this.generateTimeWeightedSplit(order, eligibleExchanges)
    ];

    routes.push(...splitStrategies.filter(s => s.length > 0));
    return routes;
  }

  /**
   * Generate proportional split based on available liquidity
   */
  private generateProportionalSplit(
    order: Order,
    exchanges: ExchangeLiquidity[]
  ): ExecutionRoute[] {
    const routes: ExecutionRoute[] = [];
    let remainingQuantity = order.quantity;

    // Calculate total available liquidity
    const totalLiquidity = exchanges.reduce((sum, e) => {
      const depth = order.side === OrderSide.BUY ? e.ask : e.bid;
      return sum + this.calculateAvailableLiquidity(depth, order.price);
    }, 0);

    if (totalLiquidity < order.quantity * 0.8) {
      return []; // Not enough liquidity
    }

    // Allocate proportionally
    for (const exchangeLiq of exchanges) {
      if (remainingQuantity <= 0) break;

      const exchange = this.state.exchanges.get(exchangeLiq.exchange)!;
      const depth = order.side === OrderSide.BUY ? exchangeLiq.ask : exchangeLiq.bid;
      const available = this.calculateAvailableLiquidity(depth, order.price);
      
      const proportion = available / totalLiquidity;
      const allocation = Math.min(
        order.quantity * proportion,
        remainingQuantity,
        available
      );

      if (allocation >= exchange.tradingFees.maker * order.quantity * 10) {
        const route = this.createExecutionRoute(
          exchange,
          order,
          allocation,
          depth
        );
        routes.push(route);
        remainingQuantity -= allocation;
      }
    }

    return routes;
  }

  /**
   * Generate optimal split using dynamic programming
   * [NODERR_EXEC_OPTIMIZATION_STAGE_2]: Enhanced with venue reliability, market impact, and fallback logic
   */
  private generateOptimalSplit(
    order: Order,
    exchanges: ExchangeLiquidity[]
  ): ExecutionRoute[] {
    // [NODERR_EXEC_OPTIMIZATION_STAGE_2]: Venue reliability scoring
    const scoredExchanges = this.scoreExchangesByReliability(exchanges, order);
    
    // [NODERR_EXEC_OPTIMIZATION_STAGE_2]: Market impact estimation for split ratios
    const impactAwareExchanges = this.estimateMarketImpact(scoredExchanges, order);
    
    // Implement optimal split algorithm with enhanced scoring
    const n = Math.min(impactAwareExchanges.length, this.config.maxSplits);
    const quantity = order.quantity;
    
    // DP table: dp[i][j] = min cost to execute j units using first i exchanges
    const dp: number[][] = Array(n + 1).fill(null).map(() => 
      Array(Math.floor(quantity) + 1).fill(Infinity)
    );
    const parent: number[][][] = Array(n + 1).fill(null).map(() => 
      Array(Math.floor(quantity) + 1).fill(null)
    );

    // Base case
    dp[0][0] = 0;

    // Fill DP table with enhanced cost calculation
    for (let i = 1; i <= n; i++) {
      const exchangeLiq = impactAwareExchanges[i - 1];
      const exchange = this.state.exchanges.get(exchangeLiq.exchange)!;
      const depth = order.side === OrderSide.BUY ? exchangeLiq.ask : exchangeLiq.bid;

      for (let j = 0; j <= quantity; j++) {
        // Option 1: Don't use this exchange
        dp[i][j] = dp[i - 1][j];
        parent[i][j] = [i - 1, j];

        // Option 2: Use this exchange for various quantities
        const maxQ = Math.min(j, this.calculateAvailableLiquidity(depth, order.price));
        
        for (let q = exchange.tradingFees.maker * quantity * 10; q <= maxQ; q += quantity / 100) {
          // [NODERR_EXEC_OPTIMIZATION_STAGE_2]: Enhanced cost calculation with reliability and impact
          const cost = this.calculateEnhancedExecutionCost(exchange, q, depth, exchangeLiq);
          if (dp[i - 1][j - q] + cost < dp[i][j]) {
            dp[i][j] = dp[i - 1][j - q] + cost;
            parent[i][j] = [i - 1, j - q, q];
          }
        }
      }
    }

    // Reconstruct optimal path
    let routes = this.reconstructOptimalPath(
      parent,
      impactAwareExchanges,
      order,
      n,
      Math.floor(quantity)
    );
    
    // [NODERR_EXEC_OPTIMIZATION_STAGE_2]: Apply fallback logic when top venue is unreachable
    routes = this.applyFallbackLogic(routes, order, exchanges);
    
    // [NODERR_EXEC_OPTIMIZATION_STAGE_2]: Time-weighted prioritization
    routes = this.applyTimeWeightedPrioritization(routes, order);
    
    return routes;
  }
  
  // [NODERR_EXEC_OPTIMIZATION_STAGE_2]: Venue reliability scoring based on past success/failure
  private scoreExchangesByReliability(
    exchanges: ExchangeLiquidity[], 
    order: Order
  ): ExchangeLiquidity[] {
    return exchanges.map(exchangeLiq => {
      const exchange = this.state.exchanges.get(exchangeLiq.exchange);
      const metrics = this.state.performanceMetrics.get(exchangeLiq.exchange);
      
      if (!exchange || !metrics) return exchangeLiq;
      
      // Calculate composite reliability score
      const reliabilityScore = (
        metrics.fillRate * 0.3 +           // 30% weight on fill success
        metrics.reliability * 0.25 +       // 25% weight on uptime
        (1 - metrics.failureRate) * 0.2 +  // 20% weight on low failure rate
        (100 - metrics.averageLatency) / 100 * 0.15 + // 15% weight on speed
        metrics.costEfficiency * 0.1       // 10% weight on cost efficiency
      );
      
      // Boost score for preferred exchanges
      const isPreferred = order.metadata?.preferredExchanges?.includes(exchangeLiq.exchange);
      const finalScore = isPreferred ? reliabilityScore * 1.2 : reliabilityScore;
      
      // Store score for later use
      (exchangeLiq as any).reliabilityScore = finalScore;
      
      return exchangeLiq;
    }).sort((a, b) => ((b as any).reliabilityScore || 0) - ((a as any).reliabilityScore || 0));
  }
  
  // [NODERR_EXEC_OPTIMIZATION_STAGE_2]: Market impact estimation logic for slippage-aware split ratios
  private estimateMarketImpact(
    exchanges: ExchangeLiquidity[], 
    order: Order
  ): ExchangeLiquidity[] {
    const tradeValue = order.quantity * (order.price || 0);
    
    return exchanges.map(exchangeLiq => {
      const depth = order.side === OrderSide.BUY ? exchangeLiq.ask : exchangeLiq.bid;
      
      // Calculate liquidity depth at various price levels
      const depthAt1Percent = this.calculateLiquidityAtPriceLevel(depth, 0.01);
      const depthAt5Percent = this.calculateLiquidityAtPriceLevel(depth, 0.05);
      
      // Estimate market impact based on order size vs available liquidity
      let impactScore = 1.0; // Default no impact
      
      if (order.quantity > depthAt1Percent) {
        impactScore = 0.7; // High impact
      } else if (order.quantity > depthAt5Percent * 0.5) {
        impactScore = 0.85; // Medium impact
      } else if (order.quantity > depthAt1Percent * 0.1) {
        impactScore = 0.95; // Low impact
      }
      
      // Adjust for exchange-specific factors
      const exchange = this.state.exchanges.get(exchangeLiq.exchange);
      if (exchange) {
        // Lower impact on high-liquidity exchanges
        if (exchange.liquidityScore > 80) {
          impactScore *= 1.1;
        }
        
        // Higher impact during volatile conditions
        if (this.state.marketCondition === MarketCondition.VOLATILE) {
          impactScore *= 0.9;
        }
      }
      
      // Store impact score
      (exchangeLiq as any).impactScore = Math.min(1.0, impactScore);
      
      return exchangeLiq;
    });
  }
  
  // [NODERR_EXEC_OPTIMIZATION_STAGE_2]: Enhanced cost calculation with reliability and impact factors
  private calculateEnhancedExecutionCost(
    exchange: Exchange,
    quantity: number,
    depth: PriceLevel[],
    exchangeLiq: ExchangeLiquidity
  ): number {
    // Base execution cost
    let cost = this.calculateExecutionCost(exchange, quantity, depth);
    
    // Apply reliability penalty
    const reliabilityScore = (exchangeLiq as any).reliabilityScore || 0.5;
    const reliabilityPenalty = (1 - reliabilityScore) * cost * 0.2; // Up to 20% penalty
    cost += reliabilityPenalty;
    
    // Apply market impact penalty
    const impactScore = (exchangeLiq as any).impactScore || 1.0;
    const impactPenalty = (1 - impactScore) * cost * 0.3; // Up to 30% penalty
    cost += impactPenalty;
    
    // Apply urgency multiplier
    const metrics = this.state.performanceMetrics.get(exchange.id);
    if (metrics && metrics.averageLatency > 100) {
      cost *= 1.1; // 10% penalty for slow exchanges
    }
    
    return cost;
  }
  
  /**
   * Calculate execution cost for a given quantity on an exchange
   */
  private calculateExecutionCost(
    exchange: Exchange,
    quantity: number,
    depth: PriceLevel[]
  ): number {
    let cost = 0;
    let remaining = quantity;
    
    for (const level of depth) {
      const fill = Math.min(remaining, level.quantity);
      cost += fill * level.price * (1 + exchange.tradingFees.taker);
      remaining -= fill;
      
      if (remaining <= 0) break;
    }
    
    // Add slippage penalty if not enough depth
    if (remaining > 0) {
      cost += remaining * depth[depth.length - 1].price * 1.1;
    }
    
    return cost;
  }
  
  // [NODERR_EXEC_OPTIMIZATION_STAGE_2]: Fallback logic when top venue is unreachable
  private applyFallbackLogic(
    routes: ExecutionRoute[], 
    order: Order, 
    allExchanges: ExchangeLiquidity[]
  ): ExecutionRoute[] {
    const enhancedRoutes: ExecutionRoute[] = [];
    
    for (const route of routes) {
      const exchange = this.state.exchanges.get(route.exchange);
      const metrics = this.state.performanceMetrics.get(route.exchange);
      
      // Check if exchange is currently reliable
      const isReliable = exchange?.status.operational && 
                        metrics && 
                        metrics.fillRate > 0.8 && 
                        metrics.failureRate < 0.1;
      
      if (isReliable) {
        enhancedRoutes.push(route);
      } else {
        // Find fallback exchange
        const fallbackExchange = this.findFallbackExchange(route, allExchanges, order);
        if (fallbackExchange) {
          const fallbackRoute = this.createExecutionRoute(
            fallbackExchange,
            order,
            route.quantity,
            order.side === OrderSide.BUY ? 
              allExchanges.find(e => e.exchange === fallbackExchange.id)?.ask || [] :
              allExchanges.find(e => e.exchange === fallbackExchange.id)?.bid || []
          );
          fallbackRoute.backup = true;
          enhancedRoutes.push(fallbackRoute);
          
          this.logger.warn(`Applied fallback from ${route.exchange} to ${fallbackExchange.id}`, {
            orderId: order.id,
            originalExchange: route.exchange,
            fallbackExchange: fallbackExchange.id,
            quantity: route.quantity
          });
        } else {
          // Keep original route but mark as risky
          route.backup = true;
          enhancedRoutes.push(route);
        }
      }
    }
    
    return enhancedRoutes;
  }
  
  // [NODERR_EXEC_OPTIMIZATION_STAGE_2]: Time-weighted prioritization (faster venues prioritized)
  private applyTimeWeightedPrioritization(routes: ExecutionRoute[], order: Order): ExecutionRoute[] {
    return routes.map((route, index) => {
      const exchange = this.state.exchanges.get(route.exchange);
      const metrics = this.state.performanceMetrics.get(route.exchange);
      
      if (exchange && metrics) {
        // Calculate time-weighted priority
        const latencyScore = Math.max(0, 100 - metrics.averageLatency) / 100;
        const baselineLatency = 50; // 50ms baseline
        const speedBonus = Math.max(0, (baselineLatency - metrics.averageLatency) / baselineLatency);
        
        // Adjust priority based on speed
        route.priority = Math.round(route.priority + (speedBonus * 20));
        
        // For time-sensitive orders, boost fast exchanges more
        if (order.metadata?.urgency === 'critical' || order.metadata?.urgency === 'high') {
          route.priority += Math.round(latencyScore * 15);
        }
      }
      
      return route;
    }).sort((a, b) => b.priority - a.priority); // Sort by priority descending
  }
  
  // [NODERR_EXEC_OPTIMIZATION_STAGE_2]: Helper methods for enhanced splitting
  private calculateLiquidityAtPriceLevel(depth: PriceLevel[], priceImpact: number): number {
    if (depth.length === 0) return 0;
    
    const basePrice = depth[0].price;
    const targetPrice = basePrice * (1 + priceImpact);
    
    let totalLiquidity = 0;
    for (const level of depth) {
      if (level.price <= targetPrice) {
        totalLiquidity += level.quantity;
      } else {
        break;
      }
    }
    
    return totalLiquidity;
  }
  
  private findFallbackExchange(
    failedRoute: ExecutionRoute, 
    allExchanges: ExchangeLiquidity[], 
    order: Order
  ): Exchange | null {
    // Find alternative exchanges excluding the failed one
    const alternatives = allExchanges
      .filter(e => e.exchange !== failedRoute.exchange)
      .map(e => this.state.exchanges.get(e.exchange))
      .filter(e => e && this.isExchangeEligible(e, order))
      .sort((a, b) => {
        const metricsA = this.state.performanceMetrics.get(a!.id);
        const metricsB = this.state.performanceMetrics.get(b!.id);
        
        const scoreA = (metricsA?.reliability || 0) * (metricsA?.fillRate || 0);
        const scoreB = (metricsB?.reliability || 0) * (metricsB?.fillRate || 0);
        
        return scoreB - scoreA;
      });
    
    return alternatives[0] || null;
  }

  /**
   * Optimize routes based on configured objectives
   */
  private async optimizeRoutes(
    candidates: ExecutionRoute[][],
    order: Order,
    liquidity: LiquiditySnapshot
  ): Promise<ExecutionRoute[]> {
    // Score each candidate
    const scoredCandidates = candidates.map(routes => ({
      routes,
      score: this.scoreRoutingCandidate(routes, order, liquidity)
    }));

    // Sort by score
    scoredCandidates.sort((a, b) => b.score - a.score);

    // Apply additional optimizations to the best candidate
    let bestRoutes = scoredCandidates[0].routes;

    if (this.config.latencyOptimization) {
      bestRoutes = await this.latencyManager.optimizeForLatency(bestRoutes);
    }

    if (this.config.venueAnalysis) {
      bestRoutes = this.applyVenueAnalysis(bestRoutes);
    }

    return bestRoutes;
  }

  /**
   * Score a routing candidate based on multiple factors
   */
  private scoreRoutingCandidate(
    routes: ExecutionRoute[],
    order: Order,
    liquidity: LiquiditySnapshot
  ): number {
    const weights = {
      cost: this.config.routingObjective === 'cost' ? 0.4 : 0.25,
      speed: this.config.routingObjective === 'speed' ? 0.4 : 0.25,
      size: this.config.routingObjective === 'size' ? 0.4 : 0.25,
      reliability: 0.25
    };

    // Calculate individual scores
    const costScore = this.calculateCostScore(routes);
    const speedScore = this.calculateSpeedScore(routes);
    const sizeScore = this.calculateSizeScore(routes, order.quantity);
    const reliabilityScore = this.calculateReliabilityScore(routes);

    // Weighted average
    return (
      weights.cost * costScore +
      weights.speed * speedScore +
      weights.size * sizeScore +
      weights.reliability * reliabilityScore
    );
  }

  /**
   * Create final routing decision
   */
  private createRoutingDecision(
    order: Order,
    routes: ExecutionRoute[],
    liquidity: LiquiditySnapshot
  ): RoutingDecision {
    const totalCost = routes.reduce((sum, r) => sum + r.fees, 0);
    const expectedSlippage = this.calculateExpectedSlippage(routes, order);
    const executionTime = this.calculateExpectedExecutionTime(routes);

    const reasoning = this.generateRoutingReasoning(
      order,
      routes,
      liquidity
    );

    return {
      orderId: order.id,
      routes,
      totalCost,
      expectedSlippage,
      executionTime,
      confidence: this.calculateRoutingConfidence(routes, liquidity),
      alternativeRoutes: this.generateAlternativeRoutes(order, liquidity),
      reasoning
    };
  }

  // Helper methods

  private initializeMetrics(): void {
    for (const exchange of this.state.exchanges.values()) {
      this.state.performanceMetrics.set(exchange.id, {
        fillRate: 0.95, // Will be updated with live data
        averageSlippage: 0.001,
        failureRate: 0.01,
        averageLatency: exchange.latency,
        reliability: exchange.reliability,
        liquidityScore: exchange.liquidityScore,
        costEfficiency: 0.9
      });
    }
  }

  private generateCacheKey(order: Order): string {
    // Determine quantity range for better cache hit rates
    const quantityRange = this.getQuantityRange(order.quantity);
    
    // Include market condition for volatility-aware caching
    const marketCondition = this.state.marketCondition;
    
    // Include timestamp bucket for time-based invalidation (5-minute buckets)
    const timeBucket = Math.floor(Date.now() / (5 * 60 * 1000));
    
    // Create enhanced cache key
    return `${order.symbol}-${order.side}-${quantityRange}-${order.type}-${marketCondition}-${timeBucket}`;
  }

  /**
   * OPTIMIZED: Enhanced routing validity check with price-based invalidation
   */
  private isRoutingValid(routing: RoutingDecision, order: Order): boolean {
    // Check time-based staleness
    const age = Date.now() - (routing as any).timestamp;
    if (age > 5000) return false; // 5 seconds max age
    
    // Check price-based invalidation
    return this.isPriceStillValid(order.symbol, routing.routes);
  }
  
  /**
   * OPTIMIZED: Price-based cache invalidation
   */
  private isPriceStillValid(symbol: string, routes: ExecutionRoute[]): boolean {
    const currentSnapshot = this.priceSnapshot.get(symbol);
    if (!currentSnapshot) return true; // No reference price, assume valid
    
    // Check if price moved significantly since cache
    for (const route of routes) {
      const priceChange = Math.abs(route.price - currentSnapshot.price) / currentSnapshot.price;
      
      // Invalidate if price moved more than 0.5% (configurable threshold)
      if (priceChange > 0.005) {
        this.logger.debug(`Cache invalidated for ${symbol} due to price movement: ${(priceChange * 100).toFixed(2)}%`);
        return false;
      }
    }
    
    return true;
  }
  
  /**
   * OPTIMIZED: Update price snapshot for cache invalidation
   */
  private updatePriceSnapshot(symbol: string, price: number): void {
    this.priceSnapshot.set(symbol, {
      price,
      timestamp: Date.now()
    });
    
    // Clean up old snapshots (keep only last 100 symbols)
    if (this.priceSnapshot.size > 100) {
      const oldestEntry = Array.from(this.priceSnapshot.entries())
        .sort((a: [string, { price: number; timestamp: number }], b: [string, { price: number; timestamp: number }]) => a[1].timestamp - b[1].timestamp)[0];
      this.priceSnapshot.delete(oldestEntry[0]);
    }
  }

  private hasAdequateLiquidity(
    liquidity: LiquiditySnapshot,
    order: Order
  ): boolean {
    const requiredLiquidity = order.quantity;
    const availableLiquidity = order.side === OrderSide.BUY
      ? liquidity.aggregatedDepth.totalAskVolume
      : liquidity.aggregatedDepth.totalBidVolume;
    
    return availableLiquidity >= requiredLiquidity * 0.8; // 80% threshold
  }

  /**
   * Override isExchangeEligible to consider live metrics
   */
  private isExchangeEligible(exchange: Exchange, order: Order): boolean {
    // Check basic eligibility
    if (!exchange.status.operational || !exchange.status.tradingEnabled) {
      return false;
    }
    
    if (!exchange.supportedPairs.includes(order.symbol)) {
      return false;
    }
    
    // Check live metrics
    const metrics = this.state.performanceMetrics.get(exchange.id);
    if (metrics) {
      // Skip exchanges with poor performance
      if (metrics.fillRate < 0.5 || metrics.reliability < 0.5) {
        this.logger.debug(`Skipping ${exchange.id} due to poor metrics`, {
          fillRate: metrics.fillRate,
          reliability: metrics.reliability
        });
        return false;
      }
      
      // For urgent orders, skip high-latency exchanges
      if (order.metadata?.urgency === 'critical' && metrics.averageLatency > 100) {
        return false;
      }
    }
    
    return true;
  }

  private calculateAvailableLiquidity(
    depth: PriceLevel[],
    limitPrice?: number
  ): number {
    return depth.reduce((sum, level) => {
      if (!limitPrice || level.price <= limitPrice) {
        return sum + level.quantity;
      }
      return sum;
    }, 0);
  }

  private calculateSingleVenueExecution(
    order: Order,
    exchange: Exchange,
    depth: PriceLevel[]
  ): ExecutionRoute | null {
    const available = this.calculateAvailableLiquidity(depth, order.price);
    
    if (available < order.quantity * 0.95) {
      return null; // Not enough liquidity
    }

    return this.createExecutionRoute(exchange, order, order.quantity, depth);
  }

  private createExecutionRoute(
    exchange: Exchange,
    order: Order,
    quantity: number,
    depth: PriceLevel[]
  ): ExecutionRoute {
    const { price, slippage } = this.calculateExecutionPrice(
      quantity,
      depth
    );

    const fees = quantity * price * exchange.tradingFees.taker;
    
    return {
      exchange: exchange.id,
      orderType: order.type,
      quantity,
      percentage: quantity / order.quantity,
      price,
      fees,
      slippage,
      latency: exchange.latency,
      priority: this.calculateRoutePriority(exchange),
      backup: false
    };
  }

  private calculateExecutionPrice(
    quantity: number,
    depth: PriceLevel[]
  ): { price: number; slippage: number } {
    let remaining = quantity;
    let totalCost = 0;
    let firstPrice = depth[0]?.price || 0;

    for (const level of depth) {
      const fill = Math.min(remaining, level.quantity);
      totalCost += fill * level.price;
      remaining -= fill;
      
      if (remaining <= 0) break;
    }

    const avgPrice = totalCost / quantity;
    const slippage = (avgPrice - firstPrice) / firstPrice;

    return { price: avgPrice, slippage };
  }

  private calculateRoutePriority(exchange: Exchange): number {
    const metrics = this.state.performanceMetrics.get(exchange.id);
    if (!metrics) return 50;

    return Math.round(
      metrics.reliability * 30 +
      metrics.liquidityScore * 30 +
      metrics.costEfficiency * 20 +
      (100 - metrics.averageLatency / 10) * 20
    );
  }

  private generateTimeWeightedSplit(
    order: Order,
    exchanges: ExchangeLiquidity[]
  ): ExecutionRoute[] {
    // Implement time-weighted splitting for large orders
    const routes: ExecutionRoute[] = [];
    const slices = Math.min(10, Math.ceil(order.quantity / 1000));
    const sliceSize = order.quantity / slices;

    for (let i = 0; i < slices; i++) {
      const exchangeIndex = i % exchanges.length;
      const exchange = this.state.exchanges.get(exchanges[exchangeIndex].exchange)!;
      const depth = order.side === OrderSide.BUY 
        ? exchanges[exchangeIndex].ask 
        : exchanges[exchangeIndex].bid;

      const route = this.createExecutionRoute(
        exchange,
        order,
        sliceSize,
        depth
      );
      
      route.priority = 100 - i * 10; // Decreasing priority
      routes.push(route);
    }

    return routes;
  }

  private generateDarkPoolRoutes(
    order: Order,
    liquidity: LiquiditySnapshot
  ): ExecutionRoute[][] {
    // Mock implementation for dark pool routing
    // In production, this would interface with actual dark pools
    return [];
  }

  private generateArbitrageRoutes(
    order: Order,
    liquidity: LiquiditySnapshot
  ): ExecutionRoute[][] {
    // Mock implementation for cross-venue arbitrage
    // Would identify price discrepancies and route accordingly
    return [];
  }

  private reconstructOptimalPath(
    parent: number[][][],
    exchanges: ExchangeLiquidity[],
    order: Order,
    n: number,
    quantity: number
  ): ExecutionRoute[] {
    const routes: ExecutionRoute[] = [];
    let i = n;
    let j = quantity;

    while (i > 0 && j > 0) {
      const p = parent[i][j];
      if (p.length === 3) {
        // This exchange was used
        const exchangeLiq = exchanges[i - 1];
        const exchange = this.state.exchanges.get(exchangeLiq.exchange)!;
        const depth = order.side === OrderSide.BUY 
          ? exchangeLiq.ask 
          : exchangeLiq.bid;
        
        const route = this.createExecutionRoute(
          exchange,
          order,
          p[2],
          depth
        );
        routes.push(route);
      }
      
      i = p[0];
      j = p[1];
    }

    return routes.reverse();
  }

  private applyVenueAnalysis(routes: ExecutionRoute[]): ExecutionRoute[] {
    // Apply venue-specific optimizations
    return routes.map(route => {
      const metrics = this.state.performanceMetrics.get(route.exchange);
      if (metrics && metrics.failureRate > 0.05) {
        // Add backup route for unreliable venues
        route.backup = true;
      }
      return route;
    });
  }

  private calculateCostScore(routes: ExecutionRoute[]): number {
    const totalFees = routes.reduce((sum, r) => sum + r.fees, 0);
    const totalValue = routes.reduce((sum, r) => sum + r.quantity * r.price, 0);
    const feePercentage = totalFees / totalValue;
    
    // Lower fees = higher score
    return Math.max(0, 100 - feePercentage * 10000);
  }

  private calculateSpeedScore(routes: ExecutionRoute[]): number {
    const maxLatency = Math.max(...routes.map(r => r.latency));
    // Lower latency = higher score
    return Math.max(0, 100 - maxLatency / 10);
  }

  private calculateSizeScore(routes: ExecutionRoute[], targetSize: number): number {
    const totalSize = routes.reduce((sum, r) => sum + r.quantity, 0);
    const fillRate = totalSize / targetSize;
    return Math.min(100, fillRate * 100);
  }

  private calculateReliabilityScore(routes: ExecutionRoute[]): number {
    const scores = routes.map(r => {
      const metrics = this.state.performanceMetrics.get(r.exchange);
      return metrics ? metrics.reliability * 100 : 50;
    });
    
    // Weighted average by quantity
    const totalQuantity = routes.reduce((sum, r) => sum + r.quantity, 0);
    return routes.reduce((sum, r, i) => 
      sum + (r.quantity / totalQuantity) * scores[i], 0
    );
  }

  private calculateExpectedSlippage(
    routes: ExecutionRoute[],
    order: Order
  ): number {
    const totalQuantity = routes.reduce((sum, r) => sum + r.quantity, 0);
    const weightedSlippage = routes.reduce(
      (sum, r) => sum + r.slippage * r.quantity,
      0
    );
    
    return weightedSlippage / totalQuantity;
  }

  private calculateExpectedExecutionTime(routes: ExecutionRoute[]): number {
    // Parallel execution - limited by slowest route
    return Math.max(...routes.map(r => r.latency));
  }

  private calculateRoutingConfidence(
    routes: ExecutionRoute[],
    liquidity: LiquiditySnapshot
  ): number {
    // Calculate confidence based on multiple factors
    const liquidityScore = Math.min(100, liquidity.aggregatedDepth.totalBidVolume / 1000000);
    const reliabilityScore = this.calculateReliabilityScore(routes);
    const spreadScore = Math.max(0, 100 - liquidity.spreadPercentage * 1000);
    
    return (liquidityScore + reliabilityScore + spreadScore) / 3;
  }

  private generateAlternativeRoutes(
    order: Order,
    liquidity: LiquiditySnapshot
  ): ExecutionRoute[] | undefined {
    // Generate backup routes for failover
    const alternatives: ExecutionRoute[] = [];
    
    for (const exchangeLiq of liquidity.exchanges) {
      const exchange = this.state.exchanges.get(exchangeLiq.exchange);
      if (!exchange || !this.isExchangeEligible(exchange, order)) {
        continue;
      }
      
      const depth = order.side === OrderSide.BUY 
        ? exchangeLiq.ask 
        : exchangeLiq.bid;
      
      const route = this.createExecutionRoute(
        exchange,
        order,
        order.quantity,
        depth
      );
      
      route.backup = true;
      alternatives.push(route);
    }
    
    return alternatives.length > 0 ? alternatives : undefined;
  }

  private generateRoutingReasoning(
    order: Order,
    routes: ExecutionRoute[],
    liquidity: LiquiditySnapshot
  ): string[] {
    const reasoning: string[] = [];
    
    reasoning.push(`Routing mode: ${this.config.routingObjective}`);
    reasoning.push(`Market condition: ${this.state.marketCondition}`);
    reasoning.push(`Split across ${routes.length} venues`);
    
    if (routes.length > 1) {
      reasoning.push('Order split to minimize market impact');
    }
    
    if (liquidity.spreadPercentage > 0.002) {
      reasoning.push('Wide spread detected - using limit orders');
    }
    
    if (this.config.mevProtection) {
      reasoning.push('MEV protection enabled for routing');
    }
    
    return reasoning;
  }

  /**
   * Update exchange metrics based on execution results
   */
  async updateExchangeMetrics(
    exchangeId: string,
    executionResult: any
  ): Promise<void> {
    const metrics = this.state.performanceMetrics.get(exchangeId);
    if (!metrics) return;

    // Update with exponential moving average
    const alpha = 0.1;
    
    metrics.fillRate = alpha * executionResult.fillRate + 
      (1 - alpha) * metrics.fillRate;
    
    metrics.averageSlippage = alpha * executionResult.slippage + 
      (1 - alpha) * metrics.averageSlippage;
    
    metrics.averageLatency = alpha * executionResult.latency + 
      (1 - alpha) * metrics.averageLatency;
    
    if (executionResult.failed) {
      metrics.failureRate = alpha * 1 + (1 - alpha) * metrics.failureRate;
    } else {
      metrics.failureRate = alpha * 0 + (1 - alpha) * metrics.failureRate;
    }
    
    this.emit('metricsUpdated', { exchangeId, metrics });
  }

  /**
   * Get current router state
   */
  getState(): RouterState {
    return { ...this.state };
  }

  /**
   * Update market condition
   */
  updateMarketCondition(condition: MarketCondition): void {
    this.state.marketCondition = condition;
    this.logger.info('Market condition updated', { condition });
  }

  /**
   * Clean up resources
   */
  public destroy(): void {
    // Stop live metrics
    this.liveMetricsCollector.stop();
    
    if (this.metricsUpdateTimer) {
      clearInterval(this.metricsUpdateTimer);
    }
    
    this.logger.info('SmartOrderRouter destroyed');
  }

  // NODERR_EXEC_OPTIMIZATION_STAGE_1: Enhanced caching system
  private startCacheWarming(): void {
    // Start cache warming for popular pairs
    this.cacheWarmingTimer = setInterval(() => {
      this.warmCache();
    }, 60000); // Every 60 seconds
    
    this.logger.info('Cache warming started');
  }

  /**
   * OPTIMIZED: Cache warming for popular pairs and common order sizes
   */
  private async warmCache(): Promise<void> {
    for (const symbol of this.popularPairs) {
      for (const orderSize of this.commonOrderSizes) {
        try {
          // Create synthetic orders for cache warming
          const buyOrder: Order = {
            id: `warm-${symbol}-buy-${orderSize}-${Date.now()}`,
            symbol,
            side: OrderSide.BUY,
            type: OrderType.MARKET,
            quantity: orderSize,
            timestamp: Date.now()
          };
          
          const sellOrder: Order = {
            id: `warm-${symbol}-sell-${orderSize}-${Date.now()}`,
            symbol,
            side: OrderSide.SELL,
            type: OrderType.MARKET,
            quantity: orderSize,
            timestamp: Date.now()
          };
          
          // Generate and cache routes for both sides
          const cacheKey1 = this.generateCacheKey(buyOrder);
          const cacheKey2 = this.generateCacheKey(sellOrder);
          
          // Only warm if not already cached
          if (!this.routingCache.has(cacheKey1) || !this.routingCache.has(cacheKey2)) {
            const liquidity = await this.liquidityAggregator.getAggregatedLiquidity(symbol);
            
            if (this.hasAdequateLiquidity(liquidity, buyOrder)) {
              const routes1 = await this.generateRoutingCandidates(buyOrder, liquidity);
              const routes2 = await this.generateRoutingCandidates(sellOrder, liquidity);
              
              // Cache the precomputed routes
              this.routePrecomputeCache.set(cacheKey1, routes1[0] || []);
              this.routePrecomputeCache.set(cacheKey2, routes2[0] || []);
            }
          }
          
        } catch (error) {
          this.logger.debug(`Cache warming failed for ${symbol} ${orderSize}:`, error);
        }
      }
    }
    
    this.logger.debug(`Cache warming completed for ${this.popularPairs.size} pairs`);
  }

  /**
   * OPTIMIZED: Determine quantity range for cache grouping
   */
  private getQuantityRange(quantity: number): string {
    if (quantity <= 100) return 'xs';
    if (quantity <= 500) return 's';
    if (quantity <= 1000) return 'm';
    if (quantity <= 5000) return 'l';
    if (quantity <= 10000) return 'xl';
    if (quantity <= 50000) return 'xxl';
    return 'giant';
  }

  // [NODERR_EXEC_OPTIMIZATION_STAGE_3_PERFORMANCE]: Initialize object pool for reuse
  private initializeObjectPool(): void {
    for (let i = 0; i < this.POOL_SIZE; i++) {
      this.state.objectPool.push({
        order: {} as Order,
        liquidity: {} as LiquiditySnapshot,
        exchanges: [],
        calculations: [],
        timestamp: 0,
        inUse: false
      });
      this.state.availablePoolObjects.push(i);
    }
  }

  // [NODERR_EXEC_OPTIMIZATION_STAGE_3_PERFORMANCE]: Get object from pool or create new one
  private getPooledContext(): PooledRouteContext {
    if (this.state.availablePoolObjects.length > 0) {
      const index = this.state.availablePoolObjects.pop()!;
      const context = this.state.objectPool[index];
      context.inUse = true;
      context.timestamp = Date.now();
      
      // Update metrics
      const metrics = this.getPerformanceMetrics();
      metrics.objectPoolHits++;
      
      return context;
    } else {
      // Pool exhausted, create new object
      const metrics = this.getPerformanceMetrics();
      metrics.objectPoolMisses++;
      
      return {
        order: {} as Order,
        liquidity: {} as LiquiditySnapshot,
        exchanges: [],
        calculations: [],
        timestamp: Date.now(),
        inUse: true
      };
    }
  }

  // [NODERR_EXEC_OPTIMIZATION_STAGE_3_PERFORMANCE]: Return object to pool
  private returnPooledContext(context: PooledRouteContext): void {
    // Find the object in pool and mark as available
    const index = this.state.objectPool.findIndex(obj => obj === context);
    if (index !== -1) {
      context.inUse = false;
      // Reset arrays without deallocating
      context.exchanges.length = 0;
      context.calculations.length = 0;
      this.state.availablePoolObjects.push(index);
    }
  }

  // [NODERR_EXEC_OPTIMIZATION_STAGE_3_PERFORMANCE]: Start performance monitoring
  private startPerformanceMonitoring(): void {
    this.performanceTimer = setInterval(() => {
      this.logPerformanceMetrics();
      this.optimizeMemoryUsage();
    }, 30000); // Every 30 seconds
  }

  // [NODERR_EXEC_OPTIMIZATION_STAGE_3_PERFORMANCE]: Log performance metrics
  private logPerformanceMetrics(): void {
    const metrics = this.getPerformanceMetrics();
    const cacheHitRate = metrics.cacheHits / (metrics.cacheHits + metrics.cacheMisses) || 0;
    const poolHitRate = metrics.objectPoolHits / (metrics.objectPoolHits + metrics.objectPoolMisses) || 0;
    
    this.logger.info('SmartOrderRouter performance metrics', {
      routingCalculations: metrics.routingCalculations,
      cacheHitRate: (cacheHitRate * 100).toFixed(1) + '%',
      poolHitRate: (poolHitRate * 100).toFixed(1) + '%',
      averageCalculationTime: metrics.averageCalculationTime.toFixed(2) + 'ms',
      cacheSize: this.state.routeCache.size,
      availablePoolObjects: this.state.availablePoolObjects.length
    });
  }

  // [NODERR_EXEC_OPTIMIZATION_STAGE_3_PERFORMANCE]: Optimize memory usage
  private optimizeMemoryUsage(): void {
    const metrics = this.getPerformanceMetrics();
    
    // Clear old calculation cache entries
    if (this.state.routeCalculationCache.size > 500) {
      this.state.routeCalculationCache.clear();
      metrics.memoryOptimizations++;
    }
    
    // Reset performance counters periodically
    if (metrics.routingCalculations > 10000) {
      metrics.routingCalculations = Math.floor(metrics.routingCalculations / 2);
      metrics.cacheHits = Math.floor(metrics.cacheHits / 2);
      metrics.cacheMisses = Math.floor(metrics.cacheMisses / 2);
    }
  }

  // [NODERR_EXEC_OPTIMIZATION_STAGE_3_PERFORMANCE]: Start cache cleanup
  private startCacheCleanup(): void {
    this.cacheCleanupTimer = setInterval(() => {
      this.cleanupExpiredCache();
    }, 60000); // Every minute
  }

  // [NODERR_EXEC_OPTIMIZATION_STAGE_3_PERFORMANCE]: Clean up expired cache entries
  private cleanupExpiredCache(): void {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, entry] of this.state.routeCache) {
      if (now - entry.timestamp > this.CACHE_TTL) {
        this.state.routeCache.delete(key);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      this.logger.debug(`Cleaned up ${cleaned} expired cache entries`);
    }
  }

  // [NODERR_EXEC_OPTIMIZATION_STAGE_3_PERFORMANCE]: Get performance metrics (with lazy initialization)
  private getPerformanceMetrics(): PerformanceMetrics {
    const key = 'global';
    // Use a separate performance metrics storage
    if (!this.performanceData) {
      this.performanceData = {
        routingCalculations: 0,
        cacheHits: 0,
        cacheMisses: 0,
        averageCalculationTime: 0,
        objectPoolHits: 0,
        objectPoolMisses: 0,
        memoryOptimizations: 0
      };
    }
    
    return this.performanceData;
  }
} 