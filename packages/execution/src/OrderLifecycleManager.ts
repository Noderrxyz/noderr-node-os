import { EventEmitter } from 'events';
import * as winston from 'winston';
import { DistributedStateManager } from '../../core/src/DistributedStateManager';
import { OrderPool, getGlobalOrderPool } from './OrderPool';

export enum OrderStatus {
  PENDING = 'PENDING',
  SUBMITTED = 'SUBMITTED',
  ACKNOWLEDGED = 'ACKNOWLEDGED',
  PARTIALLY_FILLED = 'PARTIALLY_FILLED',
  FILLED = 'FILLED',
  CANCELLED = 'CANCELLED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
  STUCK = 'STUCK'
}

export enum OrderType {
  MARKET = 'MARKET',
  LIMIT = 'LIMIT',
  STOP = 'STOP',
  STOP_LIMIT = 'STOP_LIMIT',
  ICEBERG = 'ICEBERG',
  TWAP = 'TWAP',
  VWAP = 'VWAP'
}

export interface Order {
  id: string;
  clientOrderId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  type: OrderType;
  quantity: number;
  price?: number;
  stopPrice?: number;
  timeInForce: 'GTC' | 'IOC' | 'FOK' | 'GTX';
  status: OrderStatus;
  filledQuantity: number;
  avgFillPrice: number;
  createdAt: Date;
  updatedAt: Date;
  venue: string;
  metadata?: Record<string, any>;
}

export interface Fill {
  orderId: string;
  fillId: string;
  quantity: number;
  price: number;
  fee: number;
  feeCurrency: string;
  timestamp: Date;
  venue: string;
}

export interface OrderUpdate {
  order: Order;
  previousStatus: OrderStatus;
  fill?: Fill;
  reason?: string;
}

// LRU Cache for bounded memory usage
class LRUCache<K, V> {
  private cache: Map<K, V> = new Map();
  private readonly maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Remove least recently used (first item)
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  values(): IterableIterator<V> {
    return this.cache.values();
  }

  size(): number {
    return this.cache.size;
  }
}

export class OrderLifecycleManager extends EventEmitter {
  private logger: winston.Logger;
  private orders: LRUCache<string, Order>;
  private fills: LRUCache<string, Fill[]>;
  private stuckOrderCheckInterval: NodeJS.Timeout | null = null;
  private stateManager?: DistributedStateManager;
  private orderLocks: Map<string, Promise<void>> = new Map();
  private orderPool: OrderPool;
  
  // Configuration
  private readonly STUCK_ORDER_TIMEOUT = 60000; // 60 seconds
  private readonly MAX_ORDER_AGE = 3600000; // 1 hour
  private readonly STUCK_CHECK_INTERVAL = 10000; // 10 seconds
  private readonly MAX_RETRY_ATTEMPTS = 3;
  private readonly MAX_ORDERS_IN_MEMORY = 10000;
  private readonly MAX_FILLS_IN_MEMORY = 50000;
  
  constructor(logger: winston.Logger, stateManager?: DistributedStateManager) {
    super();
    this.logger = logger;
    this.stateManager = stateManager;
    this.orders = new LRUCache<string, Order>(this.MAX_ORDERS_IN_MEMORY);
    this.fills = new LRUCache<string, Fill[]>(this.MAX_FILLS_IN_MEMORY);
    this.orderPool = getGlobalOrderPool(logger);
    this.startStuckOrderMonitoring();
  }
  
  async submitOrder(orderRequest: Partial<Order>): Promise<Order> {
    // Use order pool for better performance
    const order = this.orderPool.acquire();
    
    // Populate order fields
    order.id = this.generateOrderId();
    order.clientOrderId = orderRequest.clientOrderId || this.generateClientOrderId();
    order.symbol = orderRequest.symbol!;
    order.side = orderRequest.side!;
    order.type = orderRequest.type || OrderType.LIMIT;
    order.quantity = orderRequest.quantity!;
    order.price = orderRequest.price;
    order.stopPrice = orderRequest.stopPrice;
    order.timeInForce = orderRequest.timeInForce || 'GTC';
    order.status = OrderStatus.PENDING;
    order.filledQuantity = 0;
    order.avgFillPrice = 0;
    order.createdAt = new Date();
    order.updatedAt = new Date();
    order.venue = orderRequest.venue || 'primary';
    order.metadata = orderRequest.metadata || {};
    
    // Validate order
    this.validateOrder(order);
    
    // Store order with distributed state
    await this.storeOrder(order);
    
    // Emit order created event
    this.emit('order-created', order);
    
    try {
      // Submit to exchange
      await this.submitToExchange(order);
      
      // Update status with locking
      await this.updateOrderStatus(order.id, OrderStatus.SUBMITTED);
      
      return order;
      
    } catch (error) {
      this.logger.error('Order submission failed', { order, error });
      await this.updateOrderStatus(order.id, OrderStatus.REJECTED, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
  
  async cancelOrder(orderId: string, reason?: string): Promise<void> {
    const order = await this.getOrder(orderId);
    
    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }
    
    if (this.isTerminalStatus(order.status)) {
      throw new Error(`Cannot cancel order in ${order.status} status`);
    }
    
    try {
      // Send cancellation to exchange
      await this.cancelOnExchange(order);
      
      // Update status with locking
      await this.updateOrderStatus(orderId, OrderStatus.CANCELLED, reason);
      
    } catch (error) {
      this.logger.error('Order cancellation failed', { orderId, error });
      throw error;
    }
  }
  
  async amendOrder(orderId: string, amendments: Partial<Order>): Promise<Order> {
    return await this.withOrderLock(orderId, async () => {
      const order = await this.getOrder(orderId);
      
      if (!order) {
        throw new Error(`Order ${orderId} not found`);
      }
      
      if (this.isTerminalStatus(order.status)) {
        throw new Error(`Cannot amend order in ${order.status} status`);
      }
      
      // Validate amendments
      this.validateAmendments(order, amendments);
      
      try {
        // Send amendment to exchange
        await this.amendOnExchange(order, amendments);
        
        // Update order
        const updatedOrder = {
          ...order,
          ...amendments,
          updatedAt: new Date()
        };
        
        await this.storeOrder(updatedOrder);
        
        this.emit('order-amended', {
          order: updatedOrder,
          amendments,
          previousOrder: order
        });
        
        return updatedOrder;
        
      } catch (error) {
        this.logger.error('Order amendment failed', { orderId, amendments, error });
        throw error;
      }
    });
  }
  
  async processFill(fill: Fill): Promise<void> {
    await this.withOrderLock(fill.orderId, async () => {
      const order = await this.getOrder(fill.orderId);
      
      if (!order) {
        this.logger.error('Fill received for unknown order', fill);
        return;
      }
      
      // Store fill
      await this.storeFill(fill);
      
      // Update order
      const previousFilledQty = order.filledQuantity;
      order.filledQuantity += fill.quantity;
      
      // Calculate average fill price
      const totalValue = (previousFilledQty * order.avgFillPrice) + (fill.quantity * fill.price);
      order.avgFillPrice = totalValue / order.filledQuantity;
      
      // Update status
      let newStatus = order.status;
      if (order.filledQuantity >= order.quantity * 0.999) { // Allow for rounding
        newStatus = OrderStatus.FILLED;
      } else if (order.filledQuantity > 0 && order.status !== OrderStatus.PARTIALLY_FILLED) {
        newStatus = OrderStatus.PARTIALLY_FILLED;
      }
      
      order.status = newStatus;
      order.updatedAt = new Date();
      
      // Store updated order
      await this.storeOrder(order);
      
      // Emit fill event
      this.emit('fill', {
        order,
        fill,
        remainingQuantity: order.quantity - order.filledQuantity
      });
    });
  }
  
  private async updateOrderStatus(orderId: string, status: OrderStatus, reason?: string): Promise<void> {
    await this.withOrderLock(orderId, async () => {
      const order = await this.getOrder(orderId);
      
      if (!order) {
        return;
      }
      
      // Validate state transition
      if (!this.isValidTransition(order.status, status)) {
        throw new Error(`Invalid transition: ${order.status} -> ${status}`);
      }
      
      const previousStatus = order.status;
      order.status = status;
      order.updatedAt = new Date();
      
      await this.storeOrder(order);
      
      const update: OrderUpdate = {
        order,
        previousStatus,
        reason
      };
      
      this.emit('order-update', update);
      
      this.logger.info('Order status updated', {
        orderId,
        previousStatus,
        newStatus: status,
        reason
      });
    });
  }
  
  private async withOrderLock<T>(orderId: string, fn: () => Promise<T>): Promise<T> {
    // Use distributed lock if state manager available
    if (this.stateManager) {
      return await this.stateManager.withLock(`order:${orderId}`, fn, 30);
    }
    
    // Fallback to local locking
    const existingLock = this.orderLocks.get(orderId) || Promise.resolve();
    const newLock = existingLock.then(fn);
    this.orderLocks.set(orderId, newLock.then(() => {}, () => {})); // Handle both success and error
    
    try {
      return await newLock;
    } finally {
      // Clean up lock after a delay
      setTimeout(() => {
        if (this.orderLocks.get(orderId) === newLock) {
          this.orderLocks.delete(orderId);
        }
      }, 1000);
    }
  }
  
  private async storeOrder(order: Order): Promise<void> {
    // Store in memory cache
    this.orders.set(order.id, order);
    
    // Store in distributed state
    if (this.stateManager) {
      await this.stateManager.setState(
        `order:${order.id}`,
        order,
        { namespace: 'orders', ttl: 86400 } // 24 hours
      );
    }
  }
  
  private async getOrder(orderId: string): Promise<Order | undefined> {
    // Check memory cache first
    let order = this.orders.get(orderId);
    if (order) {
      return order;
    }
    
    // Check distributed state
    if (this.stateManager) {
      const storedOrder = await this.stateManager.getState<Order>(
        `order:${orderId}`,
        { namespace: 'orders' }
      );
      
      if (storedOrder) {
        // Restore dates
        storedOrder.createdAt = new Date(storedOrder.createdAt);
        storedOrder.updatedAt = new Date(storedOrder.updatedAt);
        
        // Update cache
        this.orders.set(orderId, storedOrder);
        return storedOrder;
      }
    }
    
    return undefined;
  }
  
  private async storeFill(fill: Fill): Promise<void> {
    const orderId = fill.orderId;
    
    // Get existing fills
    let fills = this.fills.get(orderId) || [];
    fills.push(fill);
    
    // Store in memory cache
    this.fills.set(orderId, fills);
    
    // Store in distributed state
    if (this.stateManager) {
      await this.stateManager.setState(
        `fills:${orderId}`,
        fills,
        { namespace: 'fills', ttl: 86400 } // 24 hours
      );
    }
  }
  
  private startStuckOrderMonitoring(): void {
    this.stuckOrderCheckInterval = setInterval(() => {
      this.checkForStuckOrders().catch(err => {
        this.logger.error('Error checking for stuck orders', err);
      });
    }, this.STUCK_CHECK_INTERVAL);
  }
  
  private async checkForStuckOrders(): Promise<void> {
    const now = Date.now();
    
    // Get active orders from distributed state if available
    let activeOrders: Order[] = [];
    
    if (this.stateManager) {
      // In production, use a more efficient query
      // For now, check cached orders
      for (const order of this.orders.values()) {
        if (!this.isTerminalStatus(order.status)) {
          activeOrders.push(order);
        }
      }
    } else {
      activeOrders = Array.from(this.orders.values())
        .filter(order => !this.isTerminalStatus(order.status));
    }
    
    for (const order of activeOrders) {
      const orderAge = now - order.createdAt.getTime();
      const lastUpdateAge = now - order.updatedAt.getTime();
      
      // Check if order is stuck
      if (order.status === OrderStatus.SUBMITTED && lastUpdateAge > this.STUCK_ORDER_TIMEOUT) {
        await this.handleStuckOrder(order);
      }
      
      // Check if order is too old
      if (orderAge > this.MAX_ORDER_AGE && !this.isTerminalStatus(order.status)) {
        await this.handleExpiredOrder(order);
      }
    }
  }
  
  private async handleStuckOrder(order: Order): Promise<void> {
    this.logger.warn('Stuck order detected', {
      orderId: order.id,
      age: Date.now() - order.createdAt.getTime(),
      status: order.status
    });
    
    try {
      // Update status
      await this.updateOrderStatus(order.id, OrderStatus.STUCK);
      
      // Attempt recovery
      const exchangeStatus = await this.queryOrderStatus(order);
      
      if (exchangeStatus) {
        // Update with exchange status
        await this.reconcileOrderStatus(order, exchangeStatus);
      } else {
        // Order not found on exchange, consider it failed
        await this.updateOrderStatus(order.id, OrderStatus.REJECTED, 'Order not found on exchange');
      }
      
    } catch (error) {
      this.logger.error('Failed to recover stuck order', { orderId: order.id, error });
      
      // Attempt cancellation
      try {
        await this.cancelOrder(order.id, 'Stuck order recovery');
      } catch (cancelError) {
        this.logger.error('Failed to cancel stuck order', { orderId: order.id, cancelError });
      }
    }
  }
  
  private async handleExpiredOrder(order: Order): Promise<void> {
    this.logger.warn('Expired order detected', {
      orderId: order.id,
      age: Date.now() - order.createdAt.getTime()
    });
    
    try {
      await this.updateOrderStatus(order.id, OrderStatus.EXPIRED);
      await this.cancelOrder(order.id, 'Order expired');
    } catch (error) {
      this.logger.error('Failed to handle expired order', { orderId: order.id, error });
    }
  }
  
  private isValidTransition(from: OrderStatus, to: OrderStatus): boolean {
    const validTransitions: Record<OrderStatus, OrderStatus[]> = {
      [OrderStatus.PENDING]: [OrderStatus.SUBMITTED, OrderStatus.REJECTED, OrderStatus.CANCELLED],
      [OrderStatus.SUBMITTED]: [OrderStatus.ACKNOWLEDGED, OrderStatus.PARTIALLY_FILLED, OrderStatus.FILLED, OrderStatus.CANCELLED, OrderStatus.REJECTED, OrderStatus.STUCK],
      [OrderStatus.ACKNOWLEDGED]: [OrderStatus.PARTIALLY_FILLED, OrderStatus.FILLED, OrderStatus.CANCELLED, OrderStatus.REJECTED, OrderStatus.STUCK],
      [OrderStatus.PARTIALLY_FILLED]: [OrderStatus.FILLED, OrderStatus.CANCELLED],
      [OrderStatus.FILLED]: [],
      [OrderStatus.CANCELLED]: [],
      [OrderStatus.REJECTED]: [],
      [OrderStatus.EXPIRED]: [],
      [OrderStatus.STUCK]: [OrderStatus.CANCELLED, OrderStatus.REJECTED, OrderStatus.ACKNOWLEDGED, OrderStatus.PARTIALLY_FILLED, OrderStatus.FILLED]
    };
    
    return validTransitions[from]?.includes(to) || false;
  }
  
  private validateOrder(order: Order): void {
    // Basic validation
    if (!order.symbol || !order.side || !order.quantity) {
      throw new Error('Missing required order fields');
    }
    
    if (order.quantity <= 0) {
      throw new Error('Order quantity must be positive');
    }
    
    if (order.type === OrderType.LIMIT && !order.price) {
      throw new Error('Limit order requires price');
    }
    
    if ((order.type === OrderType.STOP || order.type === OrderType.STOP_LIMIT) && !order.stopPrice) {
      throw new Error('Stop order requires stop price');
    }
  }
  
  private validateAmendments(order: Order, amendments: Partial<Order>): void {
    // Cannot change fundamental properties
    if (amendments.symbol || amendments.side) {
      throw new Error('Cannot amend symbol or side');
    }
    
    // Cannot reduce quantity below filled
    if (amendments.quantity && amendments.quantity < order.filledQuantity) {
      throw new Error('Cannot reduce quantity below filled amount');
    }
  }
  
  private isTerminalStatus(status: OrderStatus): boolean {
    return [
      OrderStatus.FILLED,
      OrderStatus.CANCELLED,
      OrderStatus.REJECTED,
      OrderStatus.EXPIRED
    ].includes(status);
  }
  
  private generateOrderId(): string {
    return `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
  
  private generateClientOrderId(): string {
    return `CLIENT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
  
  // Exchange interaction methods
  private async submitToExchange(order: Order): Promise<void> {
    const exchangeConnector = this.getExchangeConnector(order.venue);
    
    try {
      const response = await exchangeConnector.submitOrder({
        symbol: order.symbol,
        side: order.side,
        type: order.type,
        quantity: order.quantity,
        price: order.price,
        timeInForce: order.timeInForce,
        clientOrderId: order.clientOrderId
      });
      
      // Update with exchange order ID
      order.metadata = {
        ...order.metadata,
        exchangeOrderId: response.orderId
      };
      
    } catch (error) {
      this.logger.error('Failed to submit order to exchange', { order, error });
      throw new Error(`Exchange submission failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  private async cancelOnExchange(order: Order): Promise<void> {
    const exchangeConnector = this.getExchangeConnector(order.venue);
    const exchangeOrderId = order.metadata?.exchangeOrderId;
    
    if (!exchangeOrderId) {
      throw new Error('No exchange order ID found');
    }
    
    try {
      await exchangeConnector.cancelOrder(exchangeOrderId, order.symbol);
    } catch (error) {
      this.logger.error('Failed to cancel order on exchange', { order, error });
      throw new Error(`Exchange cancellation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  private async amendOnExchange(order: Order, amendments: Partial<Order>): Promise<void> {
    const exchangeConnector = this.getExchangeConnector(order.venue);
    const exchangeOrderId = order.metadata?.exchangeOrderId;
    
    if (!exchangeOrderId) {
      throw new Error('No exchange order ID found');
    }
    
    try {
      await exchangeConnector.amendOrder(exchangeOrderId, {
        quantity: amendments.quantity,
        price: amendments.price
      });
    } catch (error) {
      this.logger.error('Failed to amend order on exchange', { order, amendments, error });
      throw new Error(`Exchange amendment failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  private async queryOrderStatus(order: Order): Promise<any> {
    const exchangeConnector = this.getExchangeConnector(order.venue);
    const exchangeOrderId = order.metadata?.exchangeOrderId;
    
    if (!exchangeOrderId) {
      return null;
    }
    
    try {
      const status = await exchangeConnector.getOrderStatus(exchangeOrderId, order.symbol);
      return {
        status: status.status,
        filledQuantity: status.executedQty,
        avgPrice: status.avgPrice || status.price
      };
    } catch (error) {
      this.logger.error('Failed to query order status', { order, error });
      return null;
    }
  }
  
  private getExchangeConnector(venue: string): any {
    // This would be injected via dependency injection in production
    // For now, throw error to ensure no mock behavior
    throw new Error(`Exchange connector not configured for venue: ${venue}`);
  }
  
  private async reconcileOrderStatus(order: Order, exchangeStatus: any): Promise<void> {
    // Update order based on exchange status
    if (exchangeStatus.status === 'FILLED') {
      const fill: Fill = {
        orderId: order.id,
        fillId: `FILL-${Date.now()}`,
        quantity: exchangeStatus.filledQuantity - order.filledQuantity,
        price: exchangeStatus.avgPrice,
        fee: 0,
        feeCurrency: 'USD',
        timestamp: new Date(),
        venue: order.venue
      };
      
      await this.processFill(fill);
    }
  }
  
  // Public query methods
  async getOrderAsync(orderId: string): Promise<Order | undefined> {
    return await this.getOrder(orderId);
  }
  
  async getOrdersByStatus(status: OrderStatus): Promise<Order[]> {
    const orders: Order[] = [];
    
    // Check memory cache
    for (const order of this.orders.values()) {
      if (order.status === status) {
        orders.push(order);
      }
    }
    
    // In production, query distributed state
    return orders;
  }
  
  async getActiveOrders(): Promise<Order[]> {
    const orders: Order[] = [];
    
    for (const order of this.orders.values()) {
      if (!this.isTerminalStatus(order.status)) {
        orders.push(order);
      }
    }
    
    return orders;
  }
  
  async getFills(orderId: string): Promise<Fill[]> {
    // Check memory cache
    let fills = this.fills.get(orderId);
    if (fills) {
      return fills;
    }
    
    // Check distributed state
    if (this.stateManager) {
      const storedFills = await this.stateManager.getState<Fill[]>(
        `fills:${orderId}`,
        { namespace: 'fills' }
      );
      
      if (storedFills) {
        // Restore dates
        const restoredFills = storedFills.map(fill => ({
          ...fill,
          timestamp: new Date(fill.timestamp)
        }));
        
        // Update cache
        this.fills.set(orderId, restoredFills);
        return restoredFills;
      }
    }
    
    return [];
  }
  
  // Cleanup
  stop(): void {
    if (this.stuckOrderCheckInterval) {
      clearInterval(this.stuckOrderCheckInterval);
      this.stuckOrderCheckInterval = null;
    }
    
    // Release all cached orders back to pool
    for (const order of this.orders.values()) {
      if (this.isTerminalStatus(order.status)) {
        this.orderPool.release(order);
      }
    }
  }
  
  /**
   * Clean up completed orders and return them to the pool
   * Should be called periodically to prevent memory buildup
   */
  async cleanupCompletedOrders(): Promise<void> {
    const now = Date.now();
    const cleanupAge = 3600000; // 1 hour
    let cleaned = 0;
    
    for (const order of this.orders.values()) {
      if (this.isTerminalStatus(order.status) && 
          now - order.updatedAt.getTime() > cleanupAge) {
        this.orders.delete(order.id);
        this.orderPool.release(order);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      this.logger.info(`Cleaned up ${cleaned} completed orders`);
    }
  }
} 