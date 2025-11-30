/**
 * ExecutionTelemetryCollector - Collects and emits telemetry for order execution events
 * 
 * Tracks execution performance, errors, safety events, and market conditions
 */

import { EventEmitter } from 'events';
import { Counter, Histogram, Gauge, Registry } from 'prom-client';
import { 
  MetricType, 
  MetricValue, 
  LogLevel, 
  LogEntry,
  TelemetryEvents,
  SpanData,
  AlertSeverity,
  Alert
} from '@noderr/types/telemetry';
// Import types - in production these would be from a shared types package
// For now, we define minimal interfaces needed
interface Order {
  id: string;
  symbol: string;
  side: string;
  type: string;
  quantity: number;
  price?: number;
  exchange: string;
  metadata?: {
    algorithm?: string;
    isSimulation?: boolean;
    [key: string]: any;
  };
}

interface ExecutionResult {
  orderId: string;
  status: string;
  fills: Array<{
    symbol?: string;
    side?: string;
    quantity: number;
    price: number;
    fee: number;
  }>;
  averagePrice: number;
  totalQuantity: number;
  totalFees: number;
  executionTime: number;
  routes: Array<{
    exchange: string;
  }>;
  performance: {
    slippageBps: number;
    fillRate: number;
    totalCost: number;
  };
}

enum MarketCondition {
  CALM = 'calm',
  NORMAL = 'normal',
  VOLATILE = 'volatile',
  EXTREME = 'extreme'
}

enum ExecutionErrorCode {
  EXCHANGE_ERROR = 'EXCHANGE_ERROR'
}

export interface ExecutionTelemetryEvents {
  // Order lifecycle events
  'order:received': (order: Order) => void;
  'order:validated': (order: Order) => void;
  'order:routed': (order: Order, routing: any) => void;
  'order:executed': (result: ExecutionResult) => void;
  'order:cancelled': (orderId: string, reason: string) => void;
  'order:failed': (orderId: string, error: any) => void;
  
  // Safety events
  'safety:mode_enforced': (order: Order, mode: string, action: string) => void;
  'safety:order_converted': (order: Order, fromMode: string, toMode: string) => void;
  'safety:emergency_stop': (ordersAffected: number, reason: string) => void;
  
  // Performance events
  'execution:slippage_high': (orderId: string, slippageBps: number) => void;
  'execution:latency_high': (orderId: string, latencyMs: number) => void;
  'execution:cost_high': (orderId: string, costBps: number) => void;
  
  // Market events
  'market:condition_changed': (oldCondition: MarketCondition, newCondition: MarketCondition) => void;
  'market:liquidity_low': (symbol: string, liquidityScore: number) => void;
  'market:volatility_high': (symbol: string, volatility: number) => void;
  
  // Algorithm events
  'algorithm:selected': (orderId: string, algorithm: string, confidence: number) => void;
  'algorithm:parameter_optimized': (algorithm: string, parameters: any) => void;
  'algorithm:performance': (algorithm: string, metrics: any) => void;
  
  // MEV events
  'mev:attack_detected': (orderId: string, attackType: string) => void;
  'mev:protection_applied': (orderId: string, strategy: string) => void;
  'mev:savings_realized': (orderId: string, savedAmount: number) => void;
}

export class ExecutionTelemetryCollector extends EventEmitter {
  private registry: Registry;
  
  // Counters
  private ordersReceived!: Counter;
  private ordersExecuted!: Counter;
  private ordersFailed!: Counter;
  private ordersCancelled!: Counter;
  private ordersConverted!: Counter;
  private emergencyStops!: Counter;
  private mevAttacksDetected!: Counter;
  
  // Histograms
  private executionLatency!: Histogram;
  private slippage!: Histogram;
  private executionCost!: Histogram;
  private orderSize!: Histogram;
  private fillRate!: Histogram;
  
  // Gauges
  private activeOrders!: Gauge;
  private marketCondition!: Gauge;
  private liquidityScore!: Gauge;
  private currentTradingMode!: Gauge;
  
  constructor(registry?: Registry) {
    super();
    this.registry = registry || new Registry();
    this.initializeMetrics();
  }
  
  private initializeMetrics(): void {
    // Counters
    this.ordersReceived = new Counter({
      name: 'execution_orders_received_total',
      help: 'Total number of orders received',
      labelNames: ['symbol', 'side', 'type'],
      registers: [this.registry]
    });
    
    this.ordersExecuted = new Counter({
      name: 'execution_orders_executed_total',
      help: 'Total number of orders executed',
      labelNames: ['symbol', 'side', 'status', 'exchange'],
      registers: [this.registry]
    });
    
    this.ordersFailed = new Counter({
      name: 'execution_orders_failed_total',
      help: 'Total number of failed orders',
      labelNames: ['symbol', 'error_code', 'exchange'],
      registers: [this.registry]
    });
    
    this.ordersCancelled = new Counter({
      name: 'execution_orders_cancelled_total',
      help: 'Total number of cancelled orders',
      labelNames: ['reason'],
      registers: [this.registry]
    });
    
    this.ordersConverted = new Counter({
      name: 'execution_orders_converted_total',
      help: 'Total number of orders converted to simulation',
      labelNames: ['from_mode', 'to_mode'],
      registers: [this.registry]
    });
    
    this.emergencyStops = new Counter({
      name: 'execution_emergency_stops_total',
      help: 'Total number of emergency stops triggered',
      registers: [this.registry]
    });
    
    this.mevAttacksDetected = new Counter({
      name: 'execution_mev_attacks_detected_total',
      help: 'Total number of MEV attacks detected',
      labelNames: ['attack_type'],
      registers: [this.registry]
    });
    
    // Histograms
    this.executionLatency = new Histogram({
      name: 'execution_latency_ms',
      help: 'Order execution latency in milliseconds',
      labelNames: ['symbol', 'exchange', 'algorithm'],
      buckets: [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
      registers: [this.registry]
    });
    
    this.slippage = new Histogram({
      name: 'execution_slippage_bps',
      help: 'Execution slippage in basis points',
      labelNames: ['symbol', 'side', 'exchange'],
      buckets: [0, 1, 5, 10, 25, 50, 100, 250, 500, 1000],
      registers: [this.registry]
    });
    
    this.executionCost = new Histogram({
      name: 'execution_cost_bps',
      help: 'Total execution cost in basis points',
      labelNames: ['symbol', 'exchange'],
      buckets: [0, 5, 10, 25, 50, 100, 250, 500, 1000],
      registers: [this.registry]
    });
    
    this.orderSize = new Histogram({
      name: 'execution_order_size_usd',
      help: 'Order size in USD',
      labelNames: ['symbol', 'side'],
      buckets: [100, 500, 1000, 5000, 10000, 50000, 100000, 500000, 1000000],
      registers: [this.registry]
    });
    
    this.fillRate = new Histogram({
      name: 'execution_fill_rate_percent',
      help: 'Order fill rate percentage',
      labelNames: ['symbol', 'exchange'],
      buckets: [0, 10, 25, 50, 75, 90, 95, 99, 100],
      registers: [this.registry]
    });
    
    // Gauges
    this.activeOrders = new Gauge({
      name: 'execution_active_orders',
      help: 'Number of currently active orders',
      labelNames: ['symbol', 'side'],
      registers: [this.registry]
    });
    
    this.marketCondition = new Gauge({
      name: 'execution_market_condition',
      help: 'Current market condition (0=calm, 1=normal, 2=volatile, 3=extreme)',
      registers: [this.registry]
    });
    
    this.liquidityScore = new Gauge({
      name: 'execution_liquidity_score',
      help: 'Current liquidity score (0-100)',
      labelNames: ['symbol', 'exchange'],
      registers: [this.registry]
    });
    
    this.currentTradingMode = new Gauge({
      name: 'execution_trading_mode',
      help: 'Current trading mode (0=simulation, 1=paused, 2=live)',
      registers: [this.registry]
    });
  }
  
  // Order lifecycle tracking
  recordOrderReceived(order: Order): void {
    this.ordersReceived.inc({
      symbol: order.symbol,
      side: order.side,
      type: order.type
    });
    
    this.activeOrders.inc({
      symbol: order.symbol,
      side: order.side
    });
    
    this.emit('order:received', order);
  }
  
  recordOrderExecuted(result: ExecutionResult): void {
    const labels = {
      symbol: result.fills[0]?.symbol || 'unknown',
      side: result.fills[0]?.side || 'unknown',
      status: result.status,
      exchange: result.routes[0]?.exchange || 'unknown'
    };
    
    this.ordersExecuted.inc(labels);
    
    // Record performance metrics
    this.executionLatency.observe(
      { 
        symbol: labels.symbol, 
        exchange: labels.exchange,
        algorithm: 'direct' // TODO: Get from order metadata
      },
      result.executionTime
    );
    
    const slippageBps = result.performance.slippageBps;
    this.slippage.observe(
      { symbol: labels.symbol, side: labels.side, exchange: labels.exchange },
      slippageBps
    );
    
    const costBps = (result.performance.totalCost / (result.totalQuantity * result.averagePrice)) * 10000;
    this.executionCost.observe(
      { symbol: labels.symbol, exchange: labels.exchange },
      costBps
    );
    
    this.fillRate.observe(
      { symbol: labels.symbol, exchange: labels.exchange },
      result.performance.fillRate * 100
    );
    
    // Decrease active orders
    this.activeOrders.dec({
      symbol: labels.symbol,
      side: labels.side
    });
    
    // Emit events
    this.emit('order:executed', result);
    
    // Check for high slippage
    if (slippageBps > 50) {
      this.emit('execution:slippage_high', result.orderId, slippageBps);
    }
    
    // Check for high latency
    if (result.executionTime > 1000) {
      this.emit('execution:latency_high', result.orderId, result.executionTime);
    }
    
    // Check for high cost
    if (costBps > 100) {
      this.emit('execution:cost_high', result.orderId, costBps);
    }
  }
  
  recordOrderFailed(orderId: string, error: any, order?: Order): void {
    const errorCode = error.code || ExecutionErrorCode.EXCHANGE_ERROR;
    const symbol = order?.symbol || 'unknown';
    const exchange = order?.exchange || 'unknown';
    
    this.ordersFailed.inc({
      symbol,
      error_code: errorCode,
      exchange
    });
    
    if (order) {
      this.activeOrders.dec({
        symbol: order.symbol,
        side: order.side
      });
    }
    
    this.emit('order:failed', orderId, error);
  }
  
  recordOrderCancelled(orderId: string, reason: string, order?: Order): void {
    this.ordersCancelled.inc({ reason });
    
    if (order) {
      this.activeOrders.dec({
        symbol: order.symbol,
        side: order.side
      });
    }
    
    this.emit('order:cancelled', orderId, reason);
  }
  
  // Safety tracking
  recordSafetyModeEnforced(order: Order, mode: string, action: string): void {
    this.emit('safety:mode_enforced', order, mode, action);
    
    if (action === 'converted') {
      this.ordersConverted.inc({
        from_mode: mode,
        to_mode: 'SIMULATION'
      });
    }
  }
  
  recordOrderConverted(order: Order, fromMode: string, toMode: string): void {
    this.ordersConverted.inc({ from_mode: fromMode, to_mode: toMode });
    this.emit('safety:order_converted', order, fromMode, toMode);
  }
  
  recordEmergencyStop(ordersAffected: number, reason: string): void {
    this.emergencyStops.inc();
    this.emit('safety:emergency_stop', ordersAffected, reason);
  }
  
  updateTradingMode(mode: 'SIMULATION' | 'PAUSED' | 'LIVE'): void {
    const modeValue = mode === 'SIMULATION' ? 0 : mode === 'PAUSED' ? 1 : 2;
    this.currentTradingMode.set(modeValue);
  }
  
  // Market tracking
  updateMarketCondition(condition: MarketCondition): void {
    const conditionValue = 
      condition === MarketCondition.CALM ? 0 :
      condition === MarketCondition.NORMAL ? 1 :
      condition === MarketCondition.VOLATILE ? 2 : 3;
    
    this.marketCondition.set(conditionValue);
  }
  
  updateLiquidityScore(symbol: string, exchange: string, score: number): void {
    this.liquidityScore.set({ symbol, exchange }, score);
    
    if (score < 30) {
      this.emit('market:liquidity_low', symbol, score);
    }
  }
  
  // Algorithm tracking
  recordAlgorithmSelection(orderId: string, algorithm: string, confidence: number): void {
    this.emit('algorithm:selected', orderId, algorithm, confidence);
  }
  
  recordAlgorithmPerformance(algorithm: string, metrics: any): void {
    this.emit('algorithm:performance', algorithm, metrics);
  }
  
  // MEV tracking
  recordMEVAttackDetected(orderId: string, attackType: string): void {
    this.mevAttacksDetected.inc({ attack_type: attackType });
    this.emit('mev:attack_detected', orderId, attackType);
  }
  
  recordMEVProtectionApplied(orderId: string, strategy: string): void {
    this.emit('mev:protection_applied', orderId, strategy);
  }
  
  recordMEVSavings(orderId: string, savedAmount: number): void {
    this.emit('mev:savings_realized', orderId, savedAmount);
  }
  
  // Get current metrics
  getMetrics(): Promise<string> {
    return this.registry.metrics();
  }
  
  // Get specific metric values
  getActiveOrderCount(): number {
    const metric = this.registry.getSingleMetric('execution_active_orders') as Gauge;
    return (metric as any)._getValue() || 0;
  }
  
  getCurrentStats(): {
    ordersReceived: number;
    ordersExecuted: number;
    ordersFailed: number;
    activeOrders: number;
    avgSlippage: number;
    avgLatency: number;
  } {
    // This would need more sophisticated implementation
    // to track running averages
    return {
      ordersReceived: 0,
      ordersExecuted: 0,
      ordersFailed: 0,
      activeOrders: this.getActiveOrderCount(),
      avgSlippage: 0,
      avgLatency: 0
    };
  }
} 