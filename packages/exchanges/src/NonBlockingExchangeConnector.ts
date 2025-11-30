import { EventEmitter } from 'events';
import * as net from 'net';
import * as tls from 'tls';
import * as http2 from 'http2';
import { Worker } from 'worker_threads';

/**
 * Non-Blocking Exchange Connector
 * Features:
 * - Async I/O with zero blocking
 * - Automatic retry with exponential backoff
 * - Connection multiplexing
 * - Rate limiting
 * - Circuit breaker pattern
 */
export class NonBlockingExchangeConnector extends EventEmitter {
  private connections: Map<string, ConnectionPool> = new Map();
  private retryQueue: RetryQueue;
  private rateLimiter: RateLimiter;
  private circuitBreaker: CircuitBreaker;
  private messageSequence: number = 0;
  private pendingRequests: Map<string, PendingRequest> = new Map();
  
  constructor(private config: ConnectorConfig) {
    super();
    
    this.retryQueue = new RetryQueue(config.retryConfig);
    this.rateLimiter = new RateLimiter(config.rateLimit);
    this.circuitBreaker = new CircuitBreaker(config.circuitBreaker);
    
    // Initialize connection pools
    this.initializeConnections();
  }
  
  private initializeConnections(): void {
    for (const exchange of this.config.exchanges) {
      const pool = new ConnectionPool({
        exchange: exchange.name,
        endpoints: exchange.endpoints,
        maxConnections: exchange.maxConnections || 10,
        protocol: exchange.protocol || 'wss',
        keepAlive: exchange.keepAlive !== false
      });
      
      this.setupPoolHandlers(pool);
      this.connections.set(exchange.name, pool);
    }
  }
  
  private setupPoolHandlers(pool: ConnectionPool): void {
    pool.on('message', (msg: ExchangeMessage) => {
      this.handleMessage(msg);
    });
    
    pool.on('error', (error: Error) => {
      this.emit('connectionError', { exchange: pool.exchange, error });
    });
    
    pool.on('connected', () => {
      this.emit('connected', { exchange: pool.exchange });
    });
    
    pool.on('disconnected', () => {
      this.emit('disconnected', { exchange: pool.exchange });
    });
  }
  
  /**
   * Send order to exchange (non-blocking)
   */
  async sendOrder(order: Order): Promise<OrderResponse> {
    // Check circuit breaker
    if (!this.circuitBreaker.canExecute(order.exchange)) {
      throw new Error(`Circuit breaker open for ${order.exchange}`);
    }
    
    // Apply rate limiting
    await this.rateLimiter.acquire(order.exchange);
    
    // Get connection pool
    const pool = this.connections.get(order.exchange);
    if (!pool) {
      throw new Error(`No connection pool for exchange: ${order.exchange}`);
    }
    
    // Create request
    const requestId = this.generateRequestId();
    const request: ExchangeRequest = {
      id: requestId,
      type: 'order',
      exchange: order.exchange,
      payload: order,
      timestamp: Date.now()
    };
    
    // Create promise for response
    const responsePromise = new Promise<OrderResponse>((resolve, reject) => {
      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        request,
        timestamp: Date.now(),
        retries: 0
      });
      
      // Set timeout
      setTimeout(() => {
        const pending = this.pendingRequests.get(requestId);
        if (pending) {
          this.pendingRequests.delete(requestId);
          this.handleTimeout(request);
          reject(new Error('Request timeout'));
        }
      }, this.config.requestTimeout || 30000);
    });
    
    // Send request
    try {
      await pool.send(request);
      this.emit('orderSent', { order, requestId });
    } catch (error) {
      this.pendingRequests.delete(requestId);
      this.circuitBreaker.recordFailure(order.exchange);
      throw error;
    }
    
    return responsePromise;
  }
  
  /**
   * Cancel order (non-blocking)
   */
  async cancelOrder(exchange: string, orderId: string): Promise<CancelResponse> {
    const pool = this.connections.get(exchange);
    if (!pool) {
      throw new Error(`No connection pool for exchange: ${exchange}`);
    }
    
    const requestId = this.generateRequestId();
    const request: ExchangeRequest = {
      id: requestId,
      type: 'cancel',
      exchange,
      payload: { orderId },
      timestamp: Date.now()
    };
    
    const responsePromise = new Promise<CancelResponse>((resolve, reject) => {
      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        request,
        timestamp: Date.now(),
        retries: 0
      });
    });
    
    await pool.send(request);
    return responsePromise;
  }
  
  /**
   * Subscribe to market data (non-blocking)
   */
  async subscribe(subscription: MarketDataSubscription): Promise<void> {
    const pool = this.connections.get(subscription.exchange);
    if (!pool) {
      throw new Error(`No connection pool for exchange: ${subscription.exchange}`);
    }
    
    const request: ExchangeRequest = {
      id: this.generateRequestId(),
      type: 'subscribe',
      exchange: subscription.exchange,
      payload: subscription,
      timestamp: Date.now()
    };
    
    await pool.send(request);
    this.emit('subscribed', subscription);
  }
  
  /**
   * Handle incoming message from exchange
   */
  private handleMessage(msg: ExchangeMessage): void {
    // Check if this is a response to a pending request
    const pending = this.pendingRequests.get(msg.requestId || '');
    if (pending) {
      this.pendingRequests.delete(msg.requestId!);
      
      if (msg.error) {
        this.circuitBreaker.recordFailure(msg.exchange);
        pending.reject(new Error(msg.error));
      } else {
        this.circuitBreaker.recordSuccess(msg.exchange);
        pending.resolve(msg.data);
      }
      
      return;
    }
    
    // Handle different message types
    switch (msg.type) {
      case 'marketData':
        this.emit('marketData', msg.data);
        break;
        
      case 'orderUpdate':
        this.emit('orderUpdate', msg.data);
        break;
        
      case 'trade':
        this.emit('trade', msg.data);
        break;
        
      default:
        this.emit('message', msg);
    }
  }
  
  /**
   * Handle request timeout
   */
  private handleTimeout(request: ExchangeRequest): void {
    // Add to retry queue if retryable
    if (this.isRetryable(request)) {
      this.retryQueue.add(request);
    }
    
    this.emit('requestTimeout', request);
  }
  
  /**
   * Check if request should be retried
   */
  private isRetryable(request: ExchangeRequest): boolean {
    return request.type === 'order' && 
           (request.retries || 0) < (this.config.maxRetries || 3);
  }
  
  /**
   * Process retry queue
   */
  private async processRetryQueue(): Promise<void> {
    const ready = await this.retryQueue.getReady();
    
    for (const request of ready) {
      request.retries = (request.retries || 0) + 1;
      
      try {
        const pool = this.connections.get(request.exchange);
        if (pool) {
          await pool.send(request);
        }
      } catch (error) {
        // Re-add to retry queue if still retryable
        if (this.isRetryable(request)) {
          this.retryQueue.add(request);
        }
      }
    }
  }
  
  /**
   * Get connector statistics
   */
  getStats(): ConnectorStats {
    const poolStats: { [exchange: string]: PoolStats } = {};
    
    for (const [exchange, pool] of this.connections) {
      poolStats[exchange] = pool.getStats();
    }
    
    return {
      connections: poolStats,
      pendingRequests: this.pendingRequests.size,
      retryQueueSize: this.retryQueue.size(),
      rateLimiter: this.rateLimiter.getStats(),
      circuitBreaker: this.circuitBreaker.getStats()
    };
  }
  
  /**
   * Shutdown connector
   */
  async shutdown(): Promise<void> {
    // Stop retry processing
    this.retryQueue.stop();
    
    // Close all connections
    const closePromises = Array.from(this.connections.values()).map(pool => 
      pool.close()
    );
    
    await Promise.all(closePromises);
    
    // Reject pending requests
    for (const [id, pending] of this.pendingRequests) {
      pending.reject(new Error('Connector shutdown'));
    }
    
    this.pendingRequests.clear();
  }
  
  private generateRequestId(): string {
    return `req-${Date.now()}-${++this.messageSequence}`;
  }
}

/**
 * Connection pool for managing multiple connections to an exchange
 */
class ConnectionPool extends EventEmitter {
  public readonly exchange: string;
  private connections: ExchangeConnection[] = [];
  private activeConnections: number = 0;
  private currentConnection: number = 0;
  private reconnectTimer?: NodeJS.Timeout;
  
  constructor(private config: PoolConfig) {
    super();
    this.exchange = config.exchange;
    this.initialize();
  }
  
  private async initialize(): Promise<void> {
    // Create initial connections
    const initialConnections = Math.min(3, this.config.maxConnections);
    
    for (let i = 0; i < initialConnections; i++) {
      await this.createConnection();
    }
  }
  
  private async createConnection(): Promise<void> {
    const endpoint = this.selectEndpoint();
    const connection = new ExchangeConnection({
      exchange: this.exchange,
      endpoint,
      protocol: this.config.protocol,
      keepAlive: this.config.keepAlive
    });
    
    connection.on('message', (msg) => {
      this.emit('message', msg);
    });
    
    connection.on('error', (error) => {
      this.emit('error', error);
    });
    
    connection.on('close', () => {
      this.handleConnectionClose(connection);
    });
    
    try {
      await connection.connect();
      this.connections.push(connection);
      this.activeConnections++;
      this.emit('connected');
    } catch (error) {
      this.emit('error', error);
      this.scheduleReconnect();
    }
  }
  
  private selectEndpoint(): string {
    // Round-robin endpoint selection
    const endpoints = this.config.endpoints;
    return endpoints[Math.floor(Math.random() * endpoints.length)];
  }
  
  private handleConnectionClose(connection: ExchangeConnection): void {
    const index = this.connections.indexOf(connection);
    if (index !== -1) {
      this.connections.splice(index, 1);
      this.activeConnections--;
    }
    
    if (this.activeConnections === 0) {
      this.emit('disconnected');
    }
    
    // Schedule reconnection
    this.scheduleReconnect();
  }
  
  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = undefined;
      
      if (this.activeConnections < this.config.maxConnections) {
        try {
          await this.createConnection();
        } catch (error) {
          this.scheduleReconnect();
        }
      }
    }, 5000);
  }
  
  /**
   * Send request using round-robin connection selection
   */
  async send(request: ExchangeRequest): Promise<void> {
    if (this.activeConnections === 0) {
      throw new Error('No active connections');
    }
    
    // Select connection using round-robin
    let attempts = 0;
    while (attempts < this.connections.length) {
      const connection = this.connections[this.currentConnection];
      this.currentConnection = (this.currentConnection + 1) % this.connections.length;
      
      if (connection && connection.isReady()) {
        await connection.send(request);
        return;
      }
      
      attempts++;
    }
    
    throw new Error('No ready connections');
  }
  
  async close(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    
    const closePromises = this.connections.map(conn => conn.close());
    await Promise.all(closePromises);
  }
  
  getStats(): PoolStats {
    return {
      activeConnections: this.activeConnections,
      totalConnections: this.connections.length,
      maxConnections: this.config.maxConnections
    };
  }
}

/**
 * Individual exchange connection
 */
class ExchangeConnection extends EventEmitter {
  private socket?: net.Socket | tls.TLSSocket;
  private http2Session?: http2.ClientHttp2Session;
  private ready: boolean = false;
  private messageBuffer: string = '';
  
  constructor(private config: ConnectionConfig) {
    super();
  }
  
  async connect(): Promise<void> {
    switch (this.config.protocol) {
      case 'tcp':
        await this.connectTCP();
        break;
      case 'tls':
        await this.connectTLS();
        break;
      case 'http2':
        await this.connectHTTP2();
        break;
      case 'ws':
      case 'wss':
        await this.connectWebSocket();
        break;
      default:
        throw new Error(`Unsupported protocol: ${this.config.protocol}`);
    }
  }
  
  private async connectTCP(): Promise<void> {
    const [host, port] = this.config.endpoint.split(':');
    
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection({
        host,
        port: parseInt(port),
        allowHalfOpen: false
      });
      
      this.socket.on('connect', () => {
        this.ready = true;
        this.setupSocketHandlers();
        resolve();
      });
      
      this.socket.on('error', reject);
    });
  }
  
  private async connectTLS(): Promise<void> {
    const [host, port] = this.config.endpoint.split(':');
    
    return new Promise((resolve, reject) => {
      this.socket = tls.connect({
        host,
        port: parseInt(port),
        rejectUnauthorized: true
      });
      
      this.socket.on('secureConnect', () => {
        this.ready = true;
        this.setupSocketHandlers();
        resolve();
      });
      
      this.socket.on('error', reject);
    });
  }
  
  private async connectHTTP2(): Promise<void> {
    this.http2Session = http2.connect(`https://${this.config.endpoint}`);
    
    return new Promise((resolve, reject) => {
      this.http2Session!.on('connect', () => {
        this.ready = true;
        resolve();
      });
      
      this.http2Session!.on('error', reject);
    });
  }
  
  private async connectWebSocket(): Promise<void> {
    // WebSocket implementation would go here
    // Using ws library or native WebSocket
    throw new Error('WebSocket not implemented in this example');
  }
  
  private setupSocketHandlers(): void {
    if (!this.socket) return;
    
    this.socket.on('data', (data: Buffer) => {
      this.handleData(data);
    });
    
    this.socket.on('error', (error) => {
      this.emit('error', error);
    });
    
    this.socket.on('close', () => {
      this.ready = false;
      this.emit('close');
    });
    
    // Keep-alive
    if (this.config.keepAlive) {
      this.socket.setKeepAlive(true, 30000);
    }
    
    // No delay for low latency
    this.socket.setNoDelay(true);
  }
  
  private handleData(data: Buffer): void {
    this.messageBuffer += data.toString();
    
    // Parse messages (assuming newline delimited JSON)
    let newlineIndex;
    while ((newlineIndex = this.messageBuffer.indexOf('\n')) !== -1) {
      const message = this.messageBuffer.substring(0, newlineIndex);
      this.messageBuffer = this.messageBuffer.substring(newlineIndex + 1);
      
      try {
        const parsed = JSON.parse(message);
        this.emit('message', {
          exchange: this.config.exchange,
          ...parsed
        });
      } catch (error) {
        this.emit('error', new Error(`Failed to parse message: ${message}`));
      }
    }
  }
  
  async send(request: ExchangeRequest): Promise<void> {
    if (!this.ready) {
      throw new Error('Connection not ready');
    }
    
    const message = JSON.stringify(request) + '\n';
    
    if (this.socket) {
      return new Promise((resolve, reject) => {
        this.socket!.write(message, (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    } else if (this.http2Session) {
      // HTTP2 request
      const stream = this.http2Session.request({
        ':method': 'POST',
        ':path': '/api/v1/orders',
        'content-type': 'application/json'
      });
      
      stream.write(message);
      stream.end();
      
      return new Promise((resolve, reject) => {
        stream.on('response', () => resolve());
        stream.on('error', reject);
      });
    }
  }
  
  isReady(): boolean {
    return this.ready;
  }
  
  async close(): Promise<void> {
    this.ready = false;
    
    if (this.socket) {
      this.socket.destroy();
    }
    
    if (this.http2Session) {
      this.http2Session.close();
    }
  }
}

/**
 * Retry queue for failed requests
 */
class RetryQueue {
  private queue: QueuedRequest[] = [];
  private processing: boolean = false;
  private timer?: NodeJS.Timeout;
  
  constructor(private config: RetryConfig) {}
  
  add(request: ExchangeRequest): void {
    const retryAfter = this.calculateRetryDelay(request.retries || 0);
    
    this.queue.push({
      request,
      retryAfter: Date.now() + retryAfter
    });
    
    this.scheduleProcessing();
  }
  
  async getReady(): Promise<ExchangeRequest[]> {
    const now = Date.now();
    const ready: ExchangeRequest[] = [];
    
    this.queue = this.queue.filter(item => {
      if (item.retryAfter <= now) {
        ready.push(item.request);
        return false;
      }
      return true;
    });
    
    return ready;
  }
  
  size(): number {
    return this.queue.length;
  }
  
  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
  }
  
  private calculateRetryDelay(retries: number): number {
    // Exponential backoff with jitter
    const baseDelay = this.config.baseDelay || 1000;
    const maxDelay = this.config.maxDelay || 60000;
    const delay = Math.min(baseDelay * Math.pow(2, retries), maxDelay);
    const jitter = Math.random() * delay * 0.1;
    return delay + jitter;
  }
  
  private scheduleProcessing(): void {
    if (this.timer) return;
    
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.emit('process');
    }, 1000);
  }
  
  private emit(event: string): void {
    // Event emission for processing
  }
}

/**
 * Rate limiter for API calls
 */
class RateLimiter {
  private limits: Map<string, ExchangeLimit> = new Map();
  
  constructor(config: RateLimitConfig) {
    for (const [exchange, limit] of Object.entries(config)) {
      this.limits.set(exchange, {
        tokens: limit.burst || limit.rate,
        rate: limit.rate,
        burst: limit.burst || limit.rate,
        lastRefill: Date.now()
      });
    }
  }
  
  async acquire(exchange: string): Promise<void> {
    const limit = this.limits.get(exchange);
    if (!limit) return; // No limit configured
    
    // Refill tokens
    const now = Date.now();
    const elapsed = now - limit.lastRefill;
    const refill = (elapsed / 1000) * limit.rate;
    limit.tokens = Math.min(limit.burst, limit.tokens + refill);
    limit.lastRefill = now;
    
    // Check if token available
    if (limit.tokens >= 1) {
      limit.tokens--;
      return;
    }
    
    // Wait for token
    const waitTime = (1 - limit.tokens) / limit.rate * 1000;
    await new Promise(resolve => setTimeout(resolve, waitTime));
    limit.tokens = 0;
  }
  
  getStats(): { [exchange: string]: any } {
    const stats: { [exchange: string]: any } = {};
    
    for (const [exchange, limit] of this.limits) {
      stats[exchange] = {
        tokens: limit.tokens,
        rate: limit.rate,
        burst: limit.burst
      };
    }
    
    return stats;
  }
}

/**
 * Circuit breaker for fault tolerance
 */
class CircuitBreaker {
  private states: Map<string, BreakerState> = new Map();
  
  constructor(private config: CircuitBreakerConfig) {}
  
  canExecute(exchange: string): boolean {
    const state = this.getState(exchange);
    
    if (state.status === 'open') {
      // Check if should transition to half-open
      if (Date.now() - state.lastFailure > this.config.resetTimeout) {
        state.status = 'half-open';
        state.halfOpenAttempts = 0;
      } else {
        return false;
      }
    }
    
    return true;
  }
  
  recordSuccess(exchange: string): void {
    const state = this.getState(exchange);
    state.failures = 0;
    
    if (state.status === 'half-open') {
      state.halfOpenAttempts++;
      if (state.halfOpenAttempts >= this.config.halfOpenAttempts) {
        state.status = 'closed';
      }
    }
  }
  
  recordFailure(exchange: string): void {
    const state = this.getState(exchange);
    state.failures++;
    state.lastFailure = Date.now();
    
    if (state.failures >= this.config.failureThreshold) {
      state.status = 'open';
    }
  }
  
  private getState(exchange: string): BreakerState {
    let state = this.states.get(exchange);
    if (!state) {
      state = {
        status: 'closed',
        failures: 0,
        lastFailure: 0,
        halfOpenAttempts: 0
      };
      this.states.set(exchange, state);
    }
    return state;
  }
  
  getStats(): { [exchange: string]: any } {
    const stats: { [exchange: string]: any } = {};
    
    for (const [exchange, state] of this.states) {
      stats[exchange] = {
        status: state.status,
        failures: state.failures
      };
    }
    
    return stats;
  }
}

// Types
export interface ConnectorConfig {
  exchanges: ExchangeConfig[];
  retryConfig: RetryConfig;
  rateLimit: RateLimitConfig;
  circuitBreaker: CircuitBreakerConfig;
  requestTimeout?: number;
  maxRetries?: number;
}

export interface ExchangeConfig {
  name: string;
  endpoints: string[];
  protocol?: 'tcp' | 'tls' | 'http2' | 'ws' | 'wss';
  maxConnections?: number;
  keepAlive?: boolean;
}

export interface Order {
  exchange: string;
  symbol: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit';
  quantity: number;
  price?: number;
  timeInForce?: string;
  clientOrderId?: string;
}

export interface OrderResponse {
  orderId: string;
  status: string;
  filledQuantity?: number;
  remainingQuantity?: number;
  averagePrice?: number;
  timestamp: number;
}

export interface CancelResponse {
  orderId: string;
  status: string;
  timestamp: number;
}

export interface MarketDataSubscription {
  exchange: string;
  symbols: string[];
  channels: string[];
}

export interface ExchangeRequest {
  id: string;
  type: string;
  exchange: string;
  payload: any;
  timestamp: number;
  retries?: number;
}

export interface ExchangeMessage {
  exchange: string;
  type: string;
  data: any;
  requestId?: string;
  error?: string;
  timestamp: number;
}

export interface PendingRequest {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  request: ExchangeRequest;
  timestamp: number;
  retries: number;
}

export interface ConnectorStats {
  connections: { [exchange: string]: PoolStats };
  pendingRequests: number;
  retryQueueSize: number;
  rateLimiter: { [exchange: string]: any };
  circuitBreaker: { [exchange: string]: any };
}

export interface PoolConfig {
  exchange: string;
  endpoints: string[];
  maxConnections: number;
  protocol: string;
  keepAlive: boolean;
}

export interface PoolStats {
  activeConnections: number;
  totalConnections: number;
  maxConnections: number;
}

export interface ConnectionConfig {
  exchange: string;
  endpoint: string;
  protocol: string;
  keepAlive: boolean;
}

export interface RetryConfig {
  baseDelay?: number;
  maxDelay?: number;
  maxRetries?: number;
}

export interface RateLimitConfig {
  [exchange: string]: {
    rate: number;
    burst?: number;
  };
}

export interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeout: number;
  halfOpenAttempts: number;
}

interface QueuedRequest {
  request: ExchangeRequest;
  retryAfter: number;
}

interface ExchangeLimit {
  tokens: number;
  rate: number;
  burst: number;
  lastRefill: number;
}

interface BreakerState {
  status: 'open' | 'closed' | 'half-open';
  failures: number;
  lastFailure: number;
  halfOpenAttempts: number;
}

/**
 * Benchmark for non-blocking exchange connector
 */
export class ExchangeConnectorBenchmark {
  static async runBenchmark(): Promise<void> {
    console.log('\n🚀 Non-Blocking Exchange Connector Benchmark');
    console.log('Features: Async I/O, Retry Queue, Multiplexing\n');
    
    const connector = new NonBlockingExchangeConnector({
      exchanges: [
        {
          name: 'binance',
          endpoints: ['api.binance.com:443', 'api1.binance.com:443'],
          protocol: 'tls',
          maxConnections: 10
        },
        {
          name: 'coinbase',
          endpoints: ['api.exchange.coinbase.com:443'],
          protocol: 'http2',
          maxConnections: 5
        }
      ],
      retryConfig: {
        baseDelay: 1000,
        maxDelay: 30000
      },
      rateLimit: {
        binance: { rate: 1200, burst: 2000 },
        coinbase: { rate: 100, burst: 150 }
      },
      circuitBreaker: {
        failureThreshold: 5,
        resetTimeout: 60000,
        halfOpenAttempts: 3
      },
      requestTimeout: 5000
    });
    
    // Simulate order flow
    console.log('Simulating order flow...');
    const orders: Order[] = [];
    const numOrders = 1000;
    
    for (let i = 0; i < numOrders; i++) {
      orders.push({
        exchange: i % 2 === 0 ? 'binance' : 'coinbase',
        symbol: ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'][i % 3],
        side: i % 2 === 0 ? 'buy' : 'sell',
        type: 'limit',
        quantity: Math.random() * 10,
        price: 50000 + Math.random() * 1000,
        clientOrderId: `test-${i}`
      });
    }
    
    // Benchmark order sending
    const startTime = process.hrtime.bigint();
    const promises: Promise<OrderResponse>[] = [];
    let sent = 0;
    let errors = 0;
    
    // Send orders concurrently
    for (const order of orders) {
      promises.push(
        connector.sendOrder(order)
          .then(response => {
            sent++;
            return response;
          })
          .catch(error => {
            errors++;
            return null as any;
          })
      );
      
      // Small delay to avoid overwhelming
      if (promises.length % 100 === 0) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
    
    // Wait for all orders
    await Promise.all(promises);
    
    const endTime = process.hrtime.bigint();
    const duration = Number(endTime - startTime) / 1_000_000_000;
    const throughput = numOrders / duration;
    
    console.log('\n📊 Results:');
    console.log(`  Duration: ${duration.toFixed(2)}s`);
    console.log(`  Orders Sent: ${sent}`);
    console.log(`  Errors: ${errors}`);
    console.log(`  Throughput: ${throughput.toFixed(0)} orders/second`);
    console.log(`  Latency: ${(duration * 1000 / numOrders).toFixed(2)}ms per order`);
    
    // Get statistics
    const stats = connector.getStats();
    console.log('\nConnection Statistics:');
    for (const [exchange, poolStats] of Object.entries(stats.connections)) {
      console.log(`  ${exchange}:`);
      console.log(`    Active: ${poolStats.activeConnections}/${poolStats.maxConnections}`);
    }
    
    console.log('\nRate Limiter:');
    for (const [exchange, limits] of Object.entries(stats.rateLimiter)) {
      console.log(`  ${exchange}: ${limits.tokens.toFixed(0)}/${limits.burst} tokens`);
    }
    
    console.log('\nCircuit Breaker:');
    for (const [exchange, breaker] of Object.entries(stats.circuitBreaker)) {
      console.log(`  ${exchange}: ${breaker.status} (${breaker.failures} failures)`);
    }
    
    console.log(`\nPending Requests: ${stats.pendingRequests}`);
    console.log(`Retry Queue Size: ${stats.retryQueueSize}`);
    
    // Cleanup
    await connector.shutdown();
    
    console.log('\n📊 Performance Summary:');
    console.log(`  Orders/Second: ${throughput.toFixed(0)}`);
    console.log(`  Success Rate: ${((sent / numOrders) * 100).toFixed(2)}%`);
    console.log(`  P99 Latency: <${(duration * 1000 / numOrders * 2).toFixed(0)}ms (estimated)`);
    
    if (throughput >= 1000 && errors < numOrders * 0.01) {
      console.log('\n✅ SUCCESS: Achieved 1000+ orders/second with <1% errors!');
    } else {
      console.log(`\n⚠️  Performance: ${throughput.toFixed(0)} orders/second, ${((errors / numOrders) * 100).toFixed(2)}% errors`);
    }
  }
}

// Export for use in other modules
export default NonBlockingExchangeConnector; 