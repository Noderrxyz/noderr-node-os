import { Logger } from '@noderr/utils/src';
import { EventEmitter } from 'events';

const logger = new Logger('CapitalFlowOptimizer');
const createLogger = (name: string) => ({
  info: (message: string, meta?: any) => logger.info(`[${name}] INFO: ${message}`, meta),
  error: (message: string, error?: any) => logger.error(`[${name}] ERROR: ${message}`, error),
  debug: (message: string, meta?: any) => logger.debug(`[${name}] DEBUG: ${message}`, meta),
  warn: (message: string, meta?: any) => logger.warn(`[${name}] WARN: ${message}`, meta)
});

interface Venue {
  id: string;
  name: string;
  type: 'CEX' | 'DEX' | 'OTC' | 'DARK_POOL';
  fees: {
    maker: number;
    taker: number;
    withdrawal: number;
  };
  liquidity: Map<string, LiquidityProfile>;
  latency: number;
  reliability: number;
  mevRisk: number; // 0-1 risk score
}

interface LiquidityProfile {
  symbol: string;
  depth: {
    bids: Array<{ price: number; size: number }>;
    asks: Array<{ price: number; size: number }>;
  };
  avgDailyVolume: number;
  avgSpread: number;
  lastUpdated: Date;
}

interface FlowRequest {
  id: string;
  type: 'REBALANCE' | 'ENTRY' | 'EXIT' | 'HEDGE';
  fromStrategy: string;
  toStrategy?: string;
  symbol: string;
  targetAmount: number;
  urgency: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  constraints: FlowConstraints;
}

interface FlowConstraints {
  maxSlippage: number;
  maxFees: number;
  timeLimit: number;
  minLiquidity: number;
  avoidMEV: boolean;
  preferredVenues?: string[];
}

interface FlowRoute {
  id: string;
  request: FlowRequest;
  segments: RouteSegment[];
  totalCost: number;
  estimatedSlippage: number;
  estimatedTime: number;
  mevProtection: MEVProtection;
  status: 'PLANNED' | 'EXECUTING' | 'COMPLETED' | 'FAILED';
}

interface RouteSegment {
  venue: string;
  symbol: string;
  size: number;
  estimatedPrice: number;
  maxPrice: number;
  minPrice: number;
  executionTime: number;
  fees: number;
}

interface MEVProtection {
  enabled: boolean;
  strategy: 'TIME_WEIGHTED' | 'RANDOMIZED' | 'PRIVATE_POOL' | 'FLASHBOT';
  parameters: {
    minDelay?: number;
    maxDelay?: number;
    randomizationFactor?: number;
    privatePoolId?: string;
  };
}

interface FlowMetrics {
  totalVolume24h: number;
  avgSlippage: number;
  avgFees: number;
  mevLosses: number;
  successRate: number;
  venueDistribution: Map<string, number>;
}

export class CapitalFlowOptimizer extends EventEmitter {
  private logger: ReturnType<typeof createLogger>;
  private venues: Map<string, Venue>;
  private activeFlows: Map<string, FlowRoute>;
  private flowHistory: FlowRoute[];
  private flowMetrics: FlowMetrics;
  private liquidityUpdateInterval: NodeJS.Timeout | null = null;
  private mevDetector: MEVDetector;
  
  constructor() {
    super();
    this.logger = createLogger('CapitalFlowOptimizer');
    this.venues = new Map();
    this.activeFlows = new Map();
    this.flowHistory = [];
    this.mevDetector = new MEVDetector();
    
    this.flowMetrics = {
      totalVolume24h: 0,
      avgSlippage: 0,
      avgFees: 0,
      mevLosses: 0,
      successRate: 0,
      venueDistribution: new Map()
    };
    
    this.initialize();
  }
  
  private initialize(): void {
    this.initializeVenues();
    this.startLiquidityMonitoring();
    
    this.logger.info('Capital flow optimizer initialized');
  }
  
  private initializeVenues(): void {
    // Major CEXs
    this.registerVenue({
      id: 'binance',
      name: 'Binance',
      type: 'CEX',
      fees: { maker: 0.0010, taker: 0.0010, withdrawal: 0.0005 },
      liquidity: new Map(),
      latency: 50,
      reliability: 0.99,
      mevRisk: 0.1
    });
    
    this.registerVenue({
      id: 'coinbase',
      name: 'Coinbase Pro',
      type: 'CEX',
      fees: { maker: 0.0050, taker: 0.0050, withdrawal: 0 },
      liquidity: new Map(),
      latency: 100,
      reliability: 0.98,
      mevRisk: 0.05
    });
    
    // DEXs
    this.registerVenue({
      id: 'uniswap',
      name: 'Uniswap V3',
      type: 'DEX',
      fees: { maker: 0.0030, taker: 0.0030, withdrawal: 0 },
      liquidity: new Map(),
      latency: 15000, // Block time
      reliability: 0.95,
      mevRisk: 0.8
    });
    
    // Dark Pool
    this.registerVenue({
      id: 'darkpool1',
      name: 'Institutional Dark Pool',
      type: 'DARK_POOL',
      fees: { maker: 0.0005, taker: 0.0008, withdrawal: 0 },
      liquidity: new Map(),
      latency: 200,
      reliability: 0.97,
      mevRisk: 0.02
    });
  }
  
  private registerVenue(venue: Venue): void {
    this.venues.set(venue.id, venue);
    this.logger.info(`Registered venue: ${venue.name}`, {
      type: venue.type,
      fees: venue.fees,
      mevRisk: venue.mevRisk
    });
  }
  
  private startLiquidityMonitoring(): void {
    // Update liquidity profiles periodically
    this.liquidityUpdateInterval = setInterval(() => {
      this.updateLiquidityProfiles();
    }, 30000); // Every 30 seconds
    
    // Initial update
    this.updateLiquidityProfiles();
  }
  
  private async updateLiquidityProfiles(): Promise<void> {
    for (const venue of this.venues.values()) {
      // In production, would fetch real order book data
      const symbols = ['BTC-USD', 'ETH-USD', 'SOL-USD'];
      
      for (const symbol of symbols) {
        const liquidity: LiquidityProfile = {
          symbol,
          depth: this.generateMockOrderBook(),
          avgDailyVolume: 10000000 + Math.random() * 90000000,
          avgSpread: 0.0001 + Math.random() * 0.0009,
          lastUpdated: new Date()
        };
        
        venue.liquidity.set(symbol, liquidity);
      }
    }
  }
  
  private generateMockOrderBook(): LiquidityProfile['depth'] {
    const midPrice = 50000; // Example for BTC
    const bids: Array<{ price: number; size: number }> = [];
    const asks: Array<{ price: number; size: number }> = [];
    
    // Generate order book levels
    for (let i = 0; i < 20; i++) {
      bids.push({
        price: midPrice - (i + 1) * 0.1,
        size: Math.random() * 10
      });
      
      asks.push({
        price: midPrice + (i + 1) * 0.1,
        size: Math.random() * 10
      });
    }
    
    return { bids, asks };
  }
  
  public async optimizeFlow(request: FlowRequest): Promise<FlowRoute> {
    this.logger.info('Optimizing capital flow', {
      requestId: request.id,
      type: request.type,
      symbol: request.symbol,
      amount: request.targetAmount,
      urgency: request.urgency
    });
    
    try {
      // Analyze liquidity across venues
      const venueAnalysis = this.analyzeLiquidity(request.symbol, request.targetAmount);
      
      // Detect MEV risk
      const mevRisk = await this.mevDetector.assessRisk(request);
      
      // Plan optimal route
      const route = this.planOptimalRoute(request, venueAnalysis, mevRisk);
      
      // Apply MEV protection if needed
      if (request.constraints.avoidMEV && mevRisk > 0.3) {
        route.mevProtection = this.planMEVProtection(request, mevRisk);
      }
      
      this.activeFlows.set(route.id, route);
      
      this.logger.info('Flow route optimized', {
        routeId: route.id,
        segments: route.segments.length,
        totalCost: route.totalCost,
        estimatedSlippage: route.estimatedSlippage,
        mevProtection: route.mevProtection.enabled
      });
      
      this.emit('flow-planned', route);
      
      return route;
      
    } catch (error) {
      this.logger.error('Flow optimization failed', error);
      throw error;
    }
  }
  
  private analyzeLiquidity(
    symbol: string,
    targetAmount: number
  ): Map<string, { available: number; impact: number; cost: number }> {
    const analysis = new Map();
    
    for (const [venueId, venue] of this.venues) {
      const liquidity = venue.liquidity.get(symbol);
      if (!liquidity) continue;
      
      // Calculate available liquidity
      const available = this.calculateAvailableLiquidity(liquidity.depth, targetAmount);
      
      // Calculate price impact
      const impact = this.calculatePriceImpact(liquidity.depth, targetAmount);
      
      // Calculate total cost (fees + impact)
      const fees = targetAmount * venue.fees.taker;
      const cost = fees + (impact * targetAmount);
      
      analysis.set(venueId, { available, impact, cost });
    }
    
    return analysis;
  }
  
  private calculateAvailableLiquidity(
    depth: LiquidityProfile['depth'],
    targetAmount: number
  ): number {
    let available = 0;
    
    // Sum liquidity from best levels
    for (const level of depth.asks) {
      available += level.size * level.price;
      if (available >= targetAmount) break;
    }
    
    return Math.min(available, targetAmount);
  }
  
  private calculatePriceImpact(
    depth: LiquidityProfile['depth'],
    targetAmount: number
  ): number {
    let remainingAmount = targetAmount;
    let totalCost = 0;
    let unitsFilled = 0;
    
    for (const level of depth.asks) {
      const levelValue = level.size * level.price;
      
      if (remainingAmount <= levelValue) {
        totalCost += remainingAmount;
        unitsFilled += remainingAmount / level.price;
        break;
      } else {
        totalCost += levelValue;
        unitsFilled += level.size;
        remainingAmount -= levelValue;
      }
    }
    
    const avgPrice = unitsFilled > 0 ? totalCost / unitsFilled : depth.asks[0].price;
    const impact = (avgPrice - depth.asks[0].price) / depth.asks[0].price;
    
    return impact;
  }
  
  private planOptimalRoute(
    request: FlowRequest,
    venueAnalysis: Map<string, any>,
    mevRisk: number
  ): FlowRoute {
    const segments: RouteSegment[] = [];
    let remainingAmount = request.targetAmount;
    
    // Sort venues by cost efficiency
    const sortedVenues = Array.from(venueAnalysis.entries())
      .filter(([venueId]) => {
        // Apply venue preferences
        if (request.constraints.preferredVenues) {
          return request.constraints.preferredVenues.includes(venueId);
        }
        return true;
      })
      .sort((a, b) => a[1].cost - b[1].cost);
    
    // Distribute flow across venues
    for (const [venueId, analysis] of sortedVenues) {
      if (remainingAmount <= 0) break;
      
      const venue = this.venues.get(venueId)!;
      const allocation = Math.min(remainingAmount, analysis.available);
      
      // Skip if allocation is too small
      if (allocation < request.targetAmount * 0.01) continue;
      
      // Check slippage constraint
      if (analysis.impact > request.constraints.maxSlippage) continue;
      
      segments.push({
        venue: venueId,
        symbol: request.symbol,
        size: allocation,
        estimatedPrice: venue.liquidity.get(request.symbol)!.depth.asks[0].price,
        maxPrice: venue.liquidity.get(request.symbol)!.depth.asks[0].price * (1 + request.constraints.maxSlippage),
        minPrice: venue.liquidity.get(request.symbol)!.depth.asks[0].price,
        executionTime: this.estimateExecutionTime(venue, allocation, request.urgency),
        fees: allocation * venue.fees.taker
      });
      
      remainingAmount -= allocation;
    }
    
    // Calculate totals
    const totalCost = segments.reduce((sum, seg) => sum + seg.fees, 0);
    const avgSlippage = segments.reduce((sum, seg, _, arr) => 
      sum + (seg.estimatedPrice - seg.minPrice) / seg.minPrice / arr.length, 0
    );
    const totalTime = Math.max(...segments.map(seg => seg.executionTime));
    
    return {
      id: `route_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      request,
      segments,
      totalCost,
      estimatedSlippage: avgSlippage,
      estimatedTime: totalTime,
      mevProtection: { enabled: false, strategy: 'TIME_WEIGHTED', parameters: {} },
      status: 'PLANNED'
    };
  }
  
  private estimateExecutionTime(venue: Venue, size: number, urgency: string): number {
    let baseTime = venue.latency;
    
    // Add processing time based on size
    baseTime += size / 1000 * 100; // 100ms per 1000 units
    
    // Adjust for urgency
    switch (urgency) {
      case 'CRITICAL':
        baseTime *= 0.5;
        break;
      case 'HIGH':
        baseTime *= 0.7;
        break;
      case 'LOW':
        baseTime *= 1.5;
        break;
    }
    
    return baseTime;
  }
  
  private planMEVProtection(request: FlowRequest, mevRisk: number): MEVProtection {
    let strategy: MEVProtection['strategy'] = 'TIME_WEIGHTED';
    const parameters: MEVProtection['parameters'] = {};
    
    if (mevRisk > 0.7) {
      // High MEV risk - use private pool or flashbots
      strategy = 'PRIVATE_POOL';
      parameters.privatePoolId = 'flashbots-pool';
    } else if (mevRisk > 0.4) {
      // Medium MEV risk - randomize execution
      strategy = 'RANDOMIZED';
      parameters.minDelay = 1000;
      parameters.maxDelay = 5000;
      parameters.randomizationFactor = 0.3;
    } else {
      // Low MEV risk - time-weighted execution
      strategy = 'TIME_WEIGHTED';
      parameters.minDelay = 500;
      parameters.maxDelay = 2000;
    }
    
    return {
      enabled: true,
      strategy,
      parameters
    };
  }
  
  public async executeFlow(routeId: string): Promise<void> {
    const route = this.activeFlows.get(routeId);
    if (!route || route.status !== 'PLANNED') {
      throw new Error('Invalid route or already executing');
    }
    
    route.status = 'EXECUTING';
    
    this.logger.info('Executing flow route', {
      routeId,
      segments: route.segments.length,
      mevProtection: route.mevProtection.enabled
    });
    
    try {
      // Apply MEV protection delays if enabled
      if (route.mevProtection.enabled) {
        await this.applyMEVProtection(route);
      }
      
      // Execute segments
      const results = await this.executeSegments(route.segments);
      
      // Update metrics
      this.updateFlowMetrics(route, results);
      
      route.status = 'COMPLETED';
      this.flowHistory.push(route);
      this.activeFlows.delete(routeId);
      
      this.logger.info('Flow execution completed', {
        routeId,
        actualSlippage: results.avgSlippage,
        totalFees: results.totalFees
      });
      
      this.emit('flow-completed', { route, results });
      
    } catch (error) {
      route.status = 'FAILED';
      this.logger.error('Flow execution failed', { routeId, error });
      this.emit('flow-failed', { route, error });
      throw error;
    }
  }
  
  private async applyMEVProtection(route: FlowRoute): Promise<void> {
    const { strategy, parameters } = route.mevProtection;
    
    switch (strategy) {
      case 'TIME_WEIGHTED':
        // Execute with delays between segments
        const delay = parameters.minDelay || 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
        break;
        
      case 'RANDOMIZED':
        // Random delay
        const minDelay = parameters.minDelay || 1000;
        const maxDelay = parameters.maxDelay || 5000;
        const randomDelay = minDelay + Math.random() * (maxDelay - minDelay);
        await new Promise(resolve => setTimeout(resolve, randomDelay));
        break;
        
      case 'PRIVATE_POOL':
        // Route through private pool (implementation would be venue-specific)
        this.logger.info('Using private pool for MEV protection', {
          poolId: parameters.privatePoolId
        });
        break;
    }
  }
  
  private async executeSegments(segments: RouteSegment[]): Promise<any> {
    const results = {
      executedSegments: [] as any[],
      totalFees: 0,
      avgSlippage: 0
    };
    
    for (const segment of segments) {
      // In production, would execute real orders
      const executionResult = await this.simulateExecution(segment);
      
      results.executedSegments.push(executionResult);
      results.totalFees += executionResult.fees;
      results.avgSlippage += executionResult.slippage / segments.length;
    }
    
    return results;
  }
  
  private async simulateExecution(segment: RouteSegment): Promise<any> {
    // Simulate order execution
    await new Promise(resolve => setTimeout(resolve, segment.executionTime));
    
    const actualPrice = segment.estimatedPrice * (1 + Math.random() * 0.001);
    const slippage = (actualPrice - segment.estimatedPrice) / segment.estimatedPrice;
    
    return {
      venue: segment.venue,
      size: segment.size,
      price: actualPrice,
      fees: segment.fees,
      slippage,
      executionTime: segment.executionTime
    };
  }
  
  private updateFlowMetrics(route: FlowRoute, results: any): void {
    // Update 24h volume
    this.flowMetrics.totalVolume24h += route.request.targetAmount;
    
    // Update average slippage
    const totalFlows = this.flowHistory.length + 1;
    this.flowMetrics.avgSlippage = 
      (this.flowMetrics.avgSlippage * (totalFlows - 1) + results.avgSlippage) / totalFlows;
    
    // Update average fees
    this.flowMetrics.avgFees = 
      (this.flowMetrics.avgFees * (totalFlows - 1) + results.totalFees) / totalFlows;
    
    // Update venue distribution
    for (const segment of route.segments) {
      const current = this.flowMetrics.venueDistribution.get(segment.venue) || 0;
      this.flowMetrics.venueDistribution.set(segment.venue, current + segment.size);
    }
    
    // Update success rate
    const successful = this.flowHistory.filter(f => f.status === 'COMPLETED').length + 1;
    this.flowMetrics.successRate = successful / totalFlows;
  }
  
  public getFlowMetrics(): FlowMetrics {
    return { ...this.flowMetrics };
  }
  
  public getActiveFlows(): FlowRoute[] {
    return Array.from(this.activeFlows.values());
  }
  
  public getFlowHistory(limit: number = 100): FlowRoute[] {
    return this.flowHistory.slice(-limit);
  }
  
  public async cancelFlow(routeId: string): Promise<void> {
    const route = this.activeFlows.get(routeId);
    if (!route || route.status === 'COMPLETED') {
      throw new Error('Cannot cancel flow');
    }
    
    route.status = 'FAILED';
    this.activeFlows.delete(routeId);
    
    this.logger.warn('Flow cancelled', { routeId });
    this.emit('flow-cancelled', route);
  }
  
  public destroy(): void {
    if (this.liquidityUpdateInterval) {
      clearInterval(this.liquidityUpdateInterval);
      this.liquidityUpdateInterval = null;
    }
    
    this.logger.info('Capital flow optimizer destroyed');
  }
}

// MEV Detection helper class
class MEVDetector {
  async assessRisk(request: FlowRequest): Promise<number> {
    let risk = 0;
    
    // Size-based risk
    if (request.targetAmount > 1000000) risk += 0.3;
    else if (request.targetAmount > 100000) risk += 0.2;
    else if (request.targetAmount > 10000) risk += 0.1;
    
    // Urgency-based risk
    if (request.urgency === 'CRITICAL') risk += 0.3;
    else if (request.urgency === 'HIGH') risk += 0.2;
    
    // Type-based risk
    if (request.type === 'REBALANCE') risk += 0.2;
    else if (request.type === 'EXIT') risk += 0.1;
    
    return Math.min(1, risk);
  }
} 