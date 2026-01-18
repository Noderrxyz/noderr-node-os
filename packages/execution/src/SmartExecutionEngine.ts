import { EventEmitter } from 'events';
import { TradingSignal, OrderExecutedEvent } from '@noderr/core';
import { SignalToOrderTranslator } from './SignalToOrderTranslator';
import { Logger } from '@noderr/utils';
import { eventBus, EventTopics, SimulationEvent } from '@noderr/core';
// RLOrderRouter temporarily disabled due to @tensorflow/tfjs-node-gpu dependency
// import { RLOrderRouter, MarketState, RoutingAction, ExecutionResult as RLExecutionResult } from './RLOrderRouter';

// LOW FIX #55: Extract magic numbers to named constants
const SLICE_STAGGER_MS = 100; // Time between order slices
const EXECUTION_DURATION_PER_SLICE_MS = 100; // Estimated duration per slice
const BASIS_POINTS_MULTIPLIER = 10000; // Convert decimals to basis points
const MOCK_VENUE_BID_ASK_SPREAD = 100; // Default spread for mock venues
const MOCK_VENUE_DEPTH = 100000; // Default depth for mock venues
const MOCK_VENUE_LATENCY_MS = 50; // Default latency for mock venues
const MOCK_VENUE_FEE_RATE = 0.001; // Default fee rate (0.1%)
const MOCK_VENUE_RELIABILITY = 0.99; // Default reliability (99%)
const MOCK_VENUE_SUCCESS_RATE = 0.95; // Default success rate (95%)
const MOCK_VENUE_BASE_PRICE = 50000; // Default base price for BTC
const MOCK_EXECUTION_LATENCY_MIN_MS = 10; // Min execution latency
const MOCK_EXECUTION_LATENCY_MAX_MS = 50; // Max execution latency
const PLACEHOLDER_VOLUME = 1000000; // Placeholder volume for market state
const PLACEHOLDER_VOLATILITY = 0.01; // Placeholder volatility

/**
 * Execution configuration
 */
export interface ExecutionConfig {
  // Maximum order size for a single execution
  maxOrderSize: number;
  // Minimum order size
  minOrderSize: number;
  // Maximum slippage tolerance (basis points)
  maxSlippageBps: number;
  // Order timeout (milliseconds)
  orderTimeout: number;
  // Enable smart order routing
  enableSmartRouting: boolean;
  // Enable order slicing
  enableOrderSlicing: boolean;
  // Venue priorities
  venuePriorities: Record<string, number>;
}

/**
 * Order request
 */
export interface OrderRequest {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  orderType: 'market' | 'limit' | 'iceberg';
  limitPrice?: number;
  timeInForce: 'IOC' | 'FOK' | 'GTC';
  urgency: number; // 0-1
  metadata?: Record<string, any>;
}

/**
 * Execution plan
 */
export interface ExecutionPlan {
  orderId: string;
  slices: OrderSlice[];
  estimatedCost: number;
  estimatedSlippage: number;
  estimatedDuration: number;
  routingStrategy: string;
}

/**
 * Order slice
 */
export interface OrderSlice {
  id: string;
  parentOrderId: string;
  venue: string;
  quantity: number;
  orderType: string;
  scheduledTime: number;
  priority: number;
}

/**
 * Execution result
 */
export interface ExecutionResult {
  orderId: string;
  status: 'completed' | 'partial' | 'failed' | 'cancelled';
  executedQuantity: number;
  remainingQuantity: number;
  avgExecutionPrice: number;
  totalCost: number;
  slippageBps: number;
  executionTimeMs: number;
  sliceResults: SliceResult[];
  errors: string[];
  metadata?: Record<string, any>;
}

/**
 * Slice execution result
 */
export interface SliceResult {
  sliceId: string;
  venue: string;
  status: 'success' | 'failed' | 'timeout';
  executedQuantity: number;
  executionPrice: number;
  fees: number;
  latencyMs: number;
  error?: string;
}

/**
 * RL Router interface (for when TensorFlow dependency is enabled)
 */
interface RLRouter {
  selectAction(marketState: unknown): Promise<{ venueAllocations: number[] }>;
  calculateReward(result: RLExecutionResult, benchmarkPrice: number, quantity: number): number;
  storeExperience(state: unknown, action: unknown, reward: number, nextState: unknown): void;
}

/**
 * RL execution result
 */
interface RLExecutionResult {
  executedPrice: number;
  executedQuantity: number;
  fees: number;
  slippage: number;
  executionTimeMs: number;
  venue: string;
}

/**
 * Smart execution engine
 */
export class SmartExecutionEngine extends EventEmitter {
  private config: ExecutionConfig;
  private logger: Logger;
  // RLOrderRouter temporarily disabled
  private rlRouter: RLRouter | null = null;
  private activeOrders: Map<string, OrderRequest> = new Map();
  private executionPlans: Map<string, ExecutionPlan> = new Map();
  private venueConnections: Map<string, VenueConnection> = new Map();
  
  constructor(config: ExecutionConfig, logger?: Logger) {
    super();
    
    this.config = config;
    this.logger = logger || new Logger('SmartExecutionEngine');
  }
  
  /**
   * Initialize the execution engine
   */
  async initialize(rlRouter?: RLRouter): Promise<void> {
    // Subscribe to trading signals from the strategy service
    eventBus.subscribe(EventTopics.STRATEGY_SIGNAL, this.handleTradingSignal.bind(this), 'SmartExecutionEngine');

    this.rlRouter = rlRouter || null;
    
    // Initialize venue connections
    await this.initializeVenueConnections();
    
    this.logger.info('Smart Execution Engine initialized.', {
      enableSmartRouting: this.config.enableSmartRouting,
      enableOrderSlicing: this.config.enableOrderSlicing,
      venues: Array.from(this.venueConnections.keys())
    });
  }
  
  /**
   * Handle incoming trading signal from the event bus
   */
  private async handleTradingSignal(event: SimulationEvent): Promise<void> {
    const signal = event.payload as TradingSignal;
    this.logger.info(`Received trading signal: ${signal.strategyId}`, { strategy: signal.strategyId, symbol: signal.symbol, side: signal.side, quantity: signal.quantity });
    
    try {
      await this.executeSignal(signal);
    } catch (error) {
      // MEDIUM FIX #50: Publish execution failure event instead of just logging
      this.logger.error(`Failed to execute signal from ${signal.strategyId}`, { error });
      eventBus.publish('execution.signal.failed', {
        strategyId: signal.strategyId,
        symbol: signal.symbol,
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
      }, 'SmartExecutionEngine');
    }
  }

  /**
   * Execute an order from a raw TradingSignal
   */
  async executeSignal(signal: TradingSignal): Promise<ExecutionResult> {
    const order = SignalToOrderTranslator.translate(signal);
    return this.executeOrder(order);
  }

  /**
   * Execute an order from a formal OrderRequest
   */
  async executeOrder(order: OrderRequest): Promise<ExecutionResult> {
    // MEDIUM FIX #51: Prevent race condition - check if order is already being executed
    if (this.activeOrders.has(order.id)) {
      this.logger.warn('Order already being executed', { orderId: order.id });
      throw new Error(`Order ${order.id} is already being executed`);
    }
    
    this.activeOrders.set(order.id, order);
    
    try {
      // Create execution plan
      const plan = await this.createExecutionPlan(order);
      this.executionPlans.set(order.id, plan);
      
      // Emit plan created event
      this.emit('executionPlanCreated', plan);
      
      // Execute the plan
      const result = await this.executePlan(plan, order);
      
      // Clean up
      this.activeOrders.delete(order.id);
      this.executionPlans.delete(order.id);
      
      // Emit completion event
      this.emit('orderExecuted', result);

      // Publish to SimulationEventBus for other services (e.g., Performance Tracker)
      eventBus.publish(EventTopics.ORDER_EXECUTED, result, 'SmartExecutionEngine');
      
      return result;
      
    } catch (error) {
      this.logger.error('Order execution failed', { orderId: order.id, error });
      
      // Clean up
      this.activeOrders.delete(order.id);
      this.executionPlans.delete(order.id);
      
      return {
        orderId: order.id,
        status: 'failed',
        executedQuantity: 0,
        remainingQuantity: order.quantity,
        avgExecutionPrice: 0,
        totalCost: 0,
        slippageBps: 0,
        executionTimeMs: 0,
        sliceResults: [],
        errors: [(error as Error).message]
      };
    }
  }
  
  /**
   * Create execution plan
   */
  private async createExecutionPlan(order: OrderRequest): Promise<ExecutionPlan> {
    const slices: OrderSlice[] = [];
    
    if (this.config.enableOrderSlicing && order.quantity > this.config.maxOrderSize) {
      // Slice the order
      const numSlices = Math.ceil(order.quantity / this.config.maxOrderSize);
      const baseSliceSize = Math.floor(order.quantity / numSlices);
      const remainder = order.quantity % numSlices;
      
      for (let i = 0; i < numSlices; i++) {
        const sliceSize = i < remainder ? baseSliceSize + 1 : baseSliceSize;
        
        // Get venue allocation
        const venue = await this.selectVenue(order, sliceSize, i);
        
        slices.push({
          id: `${order.id}_slice_${i}`,
          parentOrderId: order.id,
          venue,
          quantity: sliceSize,
          orderType: order.orderType,
          scheduledTime: Date.now() + (i * SLICE_STAGGER_MS), // Stagger by 100ms
          priority: numSlices - i // Higher priority for earlier slices
        });
      }
    } else {
      // Single slice
      const venue = await this.selectVenue(order, order.quantity, 0);
      
      slices.push({
        id: `${order.id}_slice_0`,
        parentOrderId: order.id,
        venue,
        quantity: order.quantity,
        orderType: order.orderType,
        scheduledTime: Date.now(),
        priority: 1
      });
    }
    
    // Estimate costs
    const { estimatedCost, estimatedSlippage } = await this.estimateExecutionCosts(order, slices);
    
    return {
      orderId: order.id,
      slices,
      estimatedCost,
      estimatedSlippage,
      estimatedDuration: slices.length * EXECUTION_DURATION_PER_SLICE_MS, // Rough estimate
      routingStrategy: this.config.enableSmartRouting ? 'smart' : 'priority'
    };
  }
  
  /**
   * Select venue for a slice
   */
  private async selectVenue(order: OrderRequest, sliceSize: number, sliceIndex: number): Promise<string> {
    if (this.config.enableSmartRouting && this.rlRouter) {
      // Use RL router
      const marketState = await this.getMarketState(order.symbol);
      const action = await this.rlRouter.selectAction(marketState);
      
      // Select venue with highest allocation
      const venues = Array.from(this.venueConnections.keys());
      let maxAllocation = 0;
      let selectedVenue = venues[0];
      
      for (let i = 0; i < venues.length && i < action.venueAllocations.length; i++) {
        if (action.venueAllocations[i] > maxAllocation) {
          maxAllocation = action.venueAllocations[i];
          selectedVenue = venues[i];
        }
      }
      
      return selectedVenue;
    } else {
      // Use priority-based selection
      const venues = Array.from(this.venueConnections.keys());
      venues.sort((a, b) => 
        (this.config.venuePriorities[b] || 0) - (this.config.venuePriorities[a] || 0)
      );
      
      // Round-robin among top venues
      return venues[sliceIndex % Math.min(3, venues.length)];
    }
  }
  
  /**
   * Execute the plan
   */
  private async executePlan(plan: ExecutionPlan, order: OrderRequest): Promise<ExecutionResult> {
    const startTime = Date.now();
    const sliceResults: SliceResult[] = [];
    let totalExecutedQuantity = 0;
    let totalCost = 0;
    const errors: string[] = [];
    
    // Sort slices by scheduled time
    const sortedSlices = [...plan.slices].sort((a, b) => a.scheduledTime - b.scheduledTime);
    
    // Execute slices
    for (const slice of sortedSlices) {
      // Wait until scheduled time
      const waitTime = slice.scheduledTime - Date.now();
      if (waitTime > 0) {
        await this.wait(waitTime);
      }
      
      // Execute slice
      const sliceResult = await this.executeSlice(slice, order);
      sliceResults.push(sliceResult);
      
      if (sliceResult.status === 'success') {
        totalExecutedQuantity += sliceResult.executedQuantity;
        totalCost += sliceResult.executedQuantity * sliceResult.executionPrice + sliceResult.fees;
      } else {
        errors.push(sliceResult.error || 'Unknown error');
      }
      
      // Check if we should continue
      if (order.timeInForce === 'FOK' && sliceResult.status !== 'success') {
        // Fill or Kill - cancel remaining slices
        break;
      }
    }
    
    // Calculate results
    const avgExecutionPrice = totalExecutedQuantity > 0 ? 
      (totalCost - sliceResults.reduce((sum, r) => sum + r.fees, 0)) / totalExecutedQuantity : 0;
    
    const expectedPrice = order.limitPrice || (await this.getMarketPrice(order.symbol));
    const slippageBps = expectedPrice > 0 ? 
      Math.abs(avgExecutionPrice - expectedPrice) / expectedPrice * BASIS_POINTS_MULTIPLIER : 0;
    
    const status = totalExecutedQuantity === order.quantity ? 'completed' :
                   totalExecutedQuantity > 0 ? 'partial' : 'failed';
    
    return {
      orderId: order.id,
      status,
      executedQuantity: totalExecutedQuantity,
      remainingQuantity: order.quantity - totalExecutedQuantity,
      avgExecutionPrice,
      totalCost,
      slippageBps,
      executionTimeMs: Date.now() - startTime,
      sliceResults,
      errors,
      metadata: order.metadata
    };
  }
  
  /**
   * Execute a single slice
   */
  private async executeSlice(slice: OrderSlice, order: OrderRequest): Promise<SliceResult> {
    const startTime = Date.now();
    const venue = this.venueConnections.get(slice.venue);
    
    if (!venue) {
      return {
        sliceId: slice.id,
        venue: slice.venue,
        status: 'failed',
        executedQuantity: 0,
        executionPrice: 0,
        fees: 0,
        latencyMs: 0,
        error: 'Venue not connected'
      };
    }
    
    try {
      // Execute on venue
      const result = await venue.executeOrder({
        symbol: order.symbol,
        side: order.side,
        quantity: slice.quantity,
        limitPrice: order.limitPrice
      });
      
      // Update RL router if available
      if (this.rlRouter && this.config.enableSmartRouting) {
        const rlResult: RLExecutionResult = {
          executedPrice: result.executionPrice,
          executedQuantity: result.executedQuantity,
          fees: result.fees,
          slippage: result.slippageBps / BASIS_POINTS_MULTIPLIER,
          executionTimeMs: Date.now() - startTime,
          venue: slice.venue
        };
        
        const marketState = await this.getMarketState(order.symbol);
        const benchmarkPrice = order.limitPrice || (await this.getMarketPrice(order.symbol));
        const reward = this.rlRouter.calculateReward(rlResult, benchmarkPrice, slice.quantity);
        
        // Store experience for training
        // Note: This would need the previous state and action
      }
      
      return {
        sliceId: slice.id,
        venue: slice.venue,
        status: result.success ? 'success' : 'failed',
        executedQuantity: result.executedQuantity,
        executionPrice: result.executionPrice,
        fees: result.fees,
        latencyMs: Date.now() - startTime,
        error: result.error
      };
      
    } catch (error) {
      return {
        sliceId: slice.id,
        venue: slice.venue,
        status: 'failed',
        executedQuantity: 0,
        executionPrice: 0,
        fees: 0,
        latencyMs: Date.now() - startTime,
        error: (error as Error).message
      };
    }
  }
  
  /**
   * Get market state for RL
   */
  private async getMarketState(symbol: string): Promise<any> {
    // Aggregate market data from all venues
    const venues = Array.from(this.venueConnections.values());
    
    let totalBidDepth = 0;
    let totalAskDepth = 0;
    let bestBid = 0;
    let bestAsk = Infinity;
    const venueLatencies: number[] = [];
    const venueFees: number[] = [];
    const venueReliabilities: number[] = [];
    
    for (const venue of venues) {
      const marketData = await venue.getMarketData(symbol);
      totalBidDepth += marketData.bidDepth;
      totalAskDepth += marketData.askDepth;
      bestBid = Math.max(bestBid, marketData.bidPrice);
      bestAsk = Math.min(bestAsk, marketData.askPrice);
      venueLatencies.push(venue.getAverageLatency());
      venueFees.push(venue.getFeeRate());
      venueReliabilities.push(venue.getReliability());
    }
    
    const bidAskSpread = bestAsk - bestBid;
    // MEDIUM FIX #52: Guard against division by zero
    const totalDepth = totalBidDepth + totalAskDepth;
    const orderBookImbalance = totalDepth > 0 ? (totalBidDepth - totalAskDepth) / totalDepth : 0;
    
    return {
      bidAskSpread,
      bidDepth: totalBidDepth,
      askDepth: totalAskDepth,
      orderBookImbalance,
      volatility: PLACEHOLDER_VOLATILITY, // Placeholder
      volume: PLACEHOLDER_VOLUME, // Placeholder
      vwap: (bestBid + bestAsk) / 2, // Simplified
      venueLatency: venueLatencies,
      venueFees,
      venueReliability: venueReliabilities,
      orderSize: 0, // Will be set by router
      orderUrgency: 0, // Will be set by router
      remainingTime: 0 // Will be set by router
    };
  }
  
  /**
   * Estimate execution costs
   */
  private async estimateExecutionCosts(
    order: OrderRequest,
    slices: OrderSlice[]
  ): Promise<{ estimatedCost: number; estimatedSlippage: number }> {
    let totalCost = 0;
    let totalSlippage = 0;
    
    for (const slice of slices) {
      const venue = this.venueConnections.get(slice.venue);
      if (venue) {
        const feeRate = venue.getFeeRate();
        const marketPrice = await this.getMarketPrice(order.symbol);
        const estimatedPrice = marketPrice * (order.side === 'buy' ? 1.0001 : 0.9999); // 1bp slippage estimate
        
        totalCost += slice.quantity * estimatedPrice * (1 + feeRate);
        // MEDIUM FIX #52: Guard against division by zero
        if (marketPrice > 0) {
          totalSlippage += Math.abs(estimatedPrice - marketPrice) / marketPrice;
        }
      }
    }
    
    return {
      estimatedCost: totalCost,
      // MEDIUM FIX #52: Guard against division by zero
      estimatedSlippage: slices.length > 0 ? (totalSlippage / slices.length * 10000) : 0 // Convert to bps
    };
  }
  
  /**
   * Get current market price
   */
  private async getMarketPrice(symbol: string): Promise<number> {
    const venues = Array.from(this.venueConnections.values());
    let totalPrice = 0;
    let count = 0;
    
    for (const venue of venues) {
      try {
        const marketData = await venue.getMarketData(symbol);
        totalPrice += (marketData.bidPrice + marketData.askPrice) / 2;
        count++;
      } catch (error) {
        // MEDIUM FIX #54: Log errors instead of silently swallowing
        this.logger.warn('Failed to get market data from venue', { symbol, error });
      }
    }
    
    // MEDIUM FIX #54: Fail fast if all venues fail
    if (count === 0) {
      this.logger.error('All venues failed to provide market data', { symbol });
      throw new Error(`Unable to get market price for ${symbol} - all venues failed`);
    }
    
    return totalPrice / count;
  }
  
  /**
   * Initialize venue connections
   */
  private async initializeVenueConnections(): Promise<void> {
    // Placeholder - in practice, initialize real venue connections
    const venues = ['Binance', 'Coinbase', 'Kraken'];
    
    for (const venueName of venues) {
      this.venueConnections.set(venueName, new MockVenueConnection(venueName));
    }
  }
  
  /**
   * Wait for specified milliseconds
   */
  private wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * Cancel an active order
   */
  async cancelOrder(orderId: string): Promise<boolean> {
    const order = this.activeOrders.get(orderId);
    if (!order) {
      return false;
    }
    
    // Cancel all slices
    const plan = this.executionPlans.get(orderId);
    if (plan) {
      for (const slice of plan.slices) {
        const venue = this.venueConnections.get(slice.venue);
        if (venue) {
          await venue.cancelOrder(slice.id);
        }
      }
    }
    
    this.activeOrders.delete(orderId);
    this.executionPlans.delete(orderId);
    
    this.emit('orderCancelled', orderId);
    return true;
  }
  
  /**
   * Get active orders
   */
  getActiveOrders(): OrderRequest[] {
    return Array.from(this.activeOrders.values());
  }
  
  /**
   * QUICK WIN: Health check method for monitoring
   */
  async healthCheck(): Promise<{
    status: 'healthy' | 'unhealthy';
    timestamp: string;
    checks: Record<string, string>;
    activeOrders: number;
    venues: number;
  }> {
    const checks: Record<string, string> = {};
    let allHealthy = true;
    
    // Check if RL router is initialized
    if (this.config.enableSmartRouting) {
      checks.rlRouter = this.rlRouter ? 'ok' : 'not initialized';
      if (!this.rlRouter) allHealthy = false;
    } else {
      checks.rlRouter = 'disabled';
    }
    
    // Check venues
    checks.venues = `${this.venueConnections.size} configured`;
    if (this.venueConnections.size === 0) {
      allHealthy = false;
    }
    
    // Check active orders
    checks.activeOrders = `${this.activeOrders.size} active`;
    
    return {
      status: allHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      checks,
      activeOrders: this.activeOrders.size,
      venues: this.venueConnections.size
    };
  }
}

/**
 * Venue execution parameters
 */
interface VenueExecutionParams {
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  limitPrice?: number;
}

/**
 * Venue execution result
 */
interface VenueExecutionResult {
  success: boolean;
  executedQuantity: number;
  executionPrice: number;
  fees: number;
  slippageBps: number;
  error?: string;
}

/**
 * Market data from venue
 */
interface VenueMarketData {
  bidPrice: number;
  askPrice: number;
  bidDepth: number;
  askDepth: number;
}

/**
 * Venue connection interface
 */
interface VenueConnection {
  executeOrder(params: VenueExecutionParams): Promise<VenueExecutionResult>;
  cancelOrder(orderId: string): Promise<boolean>;
  getMarketData(symbol: string): Promise<VenueMarketData>;
  getAverageLatency(): number;
  getFeeRate(): number;
  getReliability(): number;
}

/**
 * Mock venue configuration
 */
interface MockVenueConfig {
  basePrice?: number;
  bidAskSpread?: number;
  depth?: number;
  latency?: number;
  feeRate?: number;
  reliability?: number;
  successRate?: number;
}

/**
 * Mock venue connection for testing
 */
class MockVenueConnection implements VenueConnection {
  private config: Required<MockVenueConfig>;
  // LOW FIX #56: Add seeded random generator for deterministic behavior
  private seed: number;
  
  constructor(
    private name: string,
    config: MockVenueConfig = {},
    seed?: number
  ) {
    // Use venue name hash as seed for deterministic behavior
    this.seed = seed ?? name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    // MEDIUM FIX #53: Make mock values configurable with sensible defaults
    this.config = {
      basePrice: config.basePrice ?? MOCK_VENUE_BASE_PRICE,
      bidAskSpread: config.bidAskSpread ?? MOCK_VENUE_BID_ASK_SPREAD,
      depth: config.depth ?? MOCK_VENUE_DEPTH,
      latency: config.latency ?? 30,
      feeRate: config.feeRate ?? MOCK_VENUE_FEE_RATE,
      reliability: config.reliability ?? 0.95,
      successRate: config.successRate ?? MOCK_VENUE_SUCCESS_RATE,
    };
  }
  
  // LOW FIX #56: Seeded random generator for deterministic behavior
  private seededRandom(): number {
    this.seed = (this.seed * 9301 + 49297) % 233280;
    return this.seed / 233280;
  }
  
  async executeOrder(params: VenueExecutionParams): Promise<VenueExecutionResult> {
    // Simulate execution with deterministic latency
    await this.wait(this.seededRandom() * MOCK_EXECUTION_LATENCY_MAX_MS + MOCK_EXECUTION_LATENCY_MIN_MS);
    
    const success = this.seededRandom() > (1 - this.config.successRate);
    const executionPrice = params.limitPrice || this.config.basePrice;
    
    return {
      success,
      executedQuantity: success ? params.quantity : 0,
      executionPrice,
      fees: params.quantity * executionPrice * this.config.feeRate,
      slippageBps: this.seededRandom() * 10,
      error: success ? undefined : 'Simulated failure'
    };
  }
  
  async cancelOrder(orderId: string): Promise<boolean> {
    return true;
  }
  
  async getMarketData(symbol: string): Promise<VenueMarketData> {
    const halfSpread = this.config.bidAskSpread / 2;
    return {
      bidPrice: this.config.basePrice - halfSpread,
      askPrice: this.config.basePrice + halfSpread,
      bidDepth: this.config.depth,
      askDepth: this.config.depth
    };
  }
  
  getAverageLatency(): number {
    return this.config.latency;
  }
  
  getFeeRate(): number {
    return this.config.feeRate;
  }
  
  getReliability(): number {
    return this.config.reliability;
  }
  
  private wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
} 