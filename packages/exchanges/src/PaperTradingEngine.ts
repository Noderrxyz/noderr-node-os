/**
 * Paper Trading Engine
 * 
 * Simulates order execution without real capital deployment.
 * 
 * Features:
 * - Realistic order matching
 * - Slippage simulation
 * - Fee calculation
 * - Position tracking
 * - PnL calculation
 * - Order book simulation
 */

import { EventEmitter } from 'events';
import { Logger } from '@noderr/utils/src';

export interface Order {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit';
  quantity: number;
  price?: number; // For limit orders
  status: 'pending' | 'filled' | 'partially_filled' | 'cancelled';
  filledQuantity: number;
  averagePrice: number;
  timestamp: number;
}

export interface Position {
  symbol: string;
  quantity: number; // Positive = long, negative = short
  averagePrice: number;
  unrealizedPnL: number;
  realizedPnL: number;
}

export interface Trade {
  orderId: string;
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
  fee: number;
  timestamp: number;
}

export interface PaperTradingConfig {
  initialBalance: number;
  takerFee: number; // e.g., 0.001 = 0.1%
  makerFee: number; // e.g., 0.0005 = 0.05%
  slippage: number; // e.g., 0.001 = 0.1%
}

export class PaperTradingEngine extends EventEmitter {
  private logger: Logger;
  private config: PaperTradingConfig;
  private balance: number;
  private orders: Map<string, Order> = new Map();
  private positions: Map<string, Position> = new Map();
  private trades: Trade[] = [];
  private orderIdCounter: number = 0;
  private marketPrices: Map<string, { bid: number; ask: number }> = new Map();

  constructor(config: PaperTradingConfig) {
    super();
    this.logger = new Logger('PaperTradingEngine');
    this.config = config;
    this.balance = config.initialBalance;

    this.logger.info('Paper trading engine initialized', {
      initialBalance: config.initialBalance,
      takerFee: `${(config.takerFee * 100).toFixed(2)}%`,
      makerFee: `${(config.makerFee * 100).toFixed(2)}%`,
      slippage: `${(config.slippage * 100).toFixed(2)}%`
    });
  }

  /**
   * Update market prices (from market data feed)
   */
  updateMarketPrice(symbol: string, bid: number, ask: number): void {
    this.marketPrices.set(symbol, { bid, ask });
    
    // Check if any limit orders can be filled
    this.checkLimitOrders(symbol);
  }

  /**
   * Place a market order
   */
  placeMarketOrder(symbol: string, side: 'buy' | 'sell', quantity: number): Order {
    const orderId = this.generateOrderId();
    const marketPrice = this.marketPrices.get(symbol);

    if (!marketPrice) {
      throw new Error(`No market price available for ${symbol}`);
    }

    // Calculate execution price with slippage
    const basePrice = side === 'buy' ? marketPrice.ask : marketPrice.bid;
    const slippageAmount = basePrice * this.config.slippage;
    const executionPrice = side === 'buy' 
      ? basePrice + slippageAmount 
      : basePrice - slippageAmount;

    // Calculate fee (taker fee for market orders)
    const notional = quantity * executionPrice;
    const fee = notional * this.config.takerFee;

    // Check if we have enough balance
    if (side === 'buy' && this.balance < notional + fee) {
      throw new Error(`Insufficient balance: ${this.balance} < ${notional + fee}`);
    }

    // Create order
    const order: Order = {
      id: orderId,
      symbol,
      side,
      type: 'market',
      quantity,
      status: 'filled',
      filledQuantity: quantity,
      averagePrice: executionPrice,
      timestamp: Date.now()
    };

    this.orders.set(orderId, order);

    // Execute trade
    this.executeTrade(order, quantity, executionPrice, fee);

    this.logger.info('Market order executed', {
      orderId,
      symbol,
      side,
      quantity,
      price: executionPrice.toFixed(2),
      fee: fee.toFixed(2)
    });

    this.emit('orderFilled', order);

    return order;
  }

  /**
   * Place a limit order
   */
  placeLimitOrder(symbol: string, side: 'buy' | 'sell', quantity: number, price: number): Order {
    const orderId = this.generateOrderId();

    const order: Order = {
      id: orderId,
      symbol,
      side,
      type: 'limit',
      quantity,
      price,
      status: 'pending',
      filledQuantity: 0,
      averagePrice: 0,
      timestamp: Date.now()
    };

    this.orders.set(orderId, order);

    this.logger.info('Limit order placed', {
      orderId,
      symbol,
      side,
      quantity,
      price: price.toFixed(2)
    });

    // Check if it can be filled immediately
    this.checkLimitOrders(symbol);

    return order;
  }

  /**
   * Cancel an order
   */
  cancelOrder(orderId: string): boolean {
    const order = this.orders.get(orderId);

    if (!order) {
      return false;
    }

    if (order.status === 'filled') {
      throw new Error('Cannot cancel filled order');
    }

    order.status = 'cancelled';
    this.logger.info('Order cancelled', { orderId });
    this.emit('orderCancelled', order);

    return true;
  }

  /**
   * Check and fill limit orders
   */
  private checkLimitOrders(symbol: string): void {
    const marketPrice = this.marketPrices.get(symbol);
    if (!marketPrice) return;

    for (const [orderId, order] of this.orders) {
      if (order.symbol !== symbol || order.status !== 'pending' || order.type !== 'limit') {
        continue;
      }

      const shouldFill = order.side === 'buy'
        ? marketPrice.ask <= order.price!
        : marketPrice.bid >= order.price!;

      if (shouldFill) {
        this.fillLimitOrder(order);
      }
    }
  }

  /**
   * Fill a limit order
   */
  private fillLimitOrder(order: Order): void {
    const executionPrice = order.price!;
    const notional = order.quantity * executionPrice;
    const fee = notional * this.config.makerFee; // Maker fee for limit orders

    // Check balance
    if (order.side === 'buy' && this.balance < notional + fee) {
      this.logger.warn('Insufficient balance to fill limit order', {
        orderId: order.id,
        required: notional + fee,
        available: this.balance
      });
      return;
    }

    order.status = 'filled';
    order.filledQuantity = order.quantity;
    order.averagePrice = executionPrice;

    this.executeTrade(order, order.quantity, executionPrice, fee);

    this.logger.info('Limit order filled', {
      orderId: order.id,
      symbol: order.symbol,
      side: order.side,
      quantity: order.quantity,
      price: executionPrice.toFixed(2),
      fee: fee.toFixed(2)
    });

    this.emit('orderFilled', order);
  }

  /**
   * Execute a trade and update positions
   */
  private executeTrade(order: Order, quantity: number, price: number, fee: number): void {
    const trade: Trade = {
      orderId: order.id,
      symbol: order.symbol,
      side: order.side,
      quantity,
      price,
      fee,
      timestamp: Date.now()
    };

    this.trades.push(trade);

    // Update balance
    const notional = quantity * price;
    if (order.side === 'buy') {
      this.balance -= (notional + fee);
    } else {
      this.balance += (notional - fee);
    }

    // Update position
    this.updatePosition(order.symbol, order.side, quantity, price);

    this.emit('trade', trade);
  }

  /**
   * Update position
   */
  private updatePosition(symbol: string, side: 'buy' | 'sell', quantity: number, price: number): void {
    let position = this.positions.get(symbol);

    if (!position) {
      position = {
        symbol,
        quantity: 0,
        averagePrice: 0,
        unrealizedPnL: 0,
        realizedPnL: 0
      };
      this.positions.set(symbol, position);
    }

    const signedQuantity = side === 'buy' ? quantity : -quantity;

    // Calculate realized PnL if closing/reducing position
    if (Math.sign(position.quantity) !== Math.sign(signedQuantity) && position.quantity !== 0) {
      const closedQuantity = Math.min(Math.abs(position.quantity), Math.abs(signedQuantity));
      const pnl = (price - position.averagePrice) * closedQuantity * Math.sign(position.quantity);
      position.realizedPnL += pnl;
    }

    // Update position quantity and average price
    const oldNotional = position.quantity * position.averagePrice;
    const newNotional = signedQuantity * price;
    position.quantity += signedQuantity;

    if (position.quantity !== 0) {
      position.averagePrice = (oldNotional + newNotional) / position.quantity;
    } else {
      position.averagePrice = 0;
    }

    // Update unrealized PnL
    const marketPrice = this.marketPrices.get(symbol);
    if (marketPrice && position.quantity !== 0) {
      const currentPrice = position.quantity > 0 ? marketPrice.bid : marketPrice.ask;
      position.unrealizedPnL = (currentPrice - position.averagePrice) * position.quantity;
    } else {
      position.unrealizedPnL = 0;
    }
  }

  /**
   * Get current position for a symbol
   */
  getPosition(symbol: string): Position | null {
    return this.positions.get(symbol) || null;
  }

  /**
   * Get all positions
   */
  getAllPositions(): Position[] {
    return Array.from(this.positions.values());
  }

  /**
   * Get order by ID
   */
  getOrder(orderId: string): Order | null {
    return this.orders.get(orderId) || null;
  }

  /**
   * Get all orders
   */
  getAllOrders(): Order[] {
    return Array.from(this.orders.values());
  }

  /**
   * Get all trades
   */
  getAllTrades(): Trade[] {
    return this.trades;
  }

  /**
   * Get current balance
   */
  getBalance(): number {
    return this.balance;
  }

  /**
   * Get total equity (balance + unrealized PnL)
   */
  getEquity(): number {
    let totalUnrealizedPnL = 0;
    for (const position of this.positions.values()) {
      totalUnrealizedPnL += position.unrealizedPnL;
    }
    return this.balance + totalUnrealizedPnL;
  }

  /**
   * Get total realized PnL
   */
  getRealizedPnL(): number {
    let total = 0;
    for (const position of this.positions.values()) {
      total += position.realizedPnL;
    }
    return total;
  }

  /**
   * Get performance metrics
   */
  getMetrics(): {
    balance: number;
    equity: number;
    realizedPnL: number;
    unrealizedPnL: number;
    totalPnL: number;
    roi: number;
    tradeCount: number;
  } {
    const equity = this.getEquity();
    const realizedPnL = this.getRealizedPnL();
    const unrealizedPnL = equity - this.balance;
    const totalPnL = realizedPnL + unrealizedPnL;
    const roi = (totalPnL / this.config.initialBalance) * 100;

    return {
      balance: this.balance,
      equity,
      realizedPnL,
      unrealizedPnL,
      totalPnL,
      roi,
      tradeCount: this.trades.length
    };
  }

  /**
   * Generate unique order ID
   */
  private generateOrderId(): string {
    return `ORDER_${Date.now()}_${this.orderIdCounter++}`;
  }

  /**
   * Reset engine (for testing)
   */
  reset(): void {
    this.balance = this.config.initialBalance;
    this.orders.clear();
    this.positions.clear();
    this.trades = [];
    this.orderIdCounter = 0;
    this.logger.info('Paper trading engine reset');
  }
}
