import { Logger } from '@noderr/utils';
import { ResilientDataConnector, ConnectorConfig } from './ResilientDataConnector';
import WebSocket from 'ws';
import crypto from 'crypto';

const logger = new Logger('CoinbaseConnector');
const createLogger = (name: string) => ({
  info: (message: string, meta?: any) => logger.info(`[${name}] INFO: ${message}`, meta),
  error: (message: string, error?: any) => logger.error(`[${name}] ERROR: ${message}`, error),
  debug: (message: string, meta?: any) => logger.debug(`[${name}] DEBUG: ${message}`, meta),
  warn: (message: string, meta?: any) => logger.warn(`[${name}] WARN: ${message}`, meta)
});

interface MarketData {
  symbol: string;
  price: number;
  volume: number;
  timestamp: number;
  bid: number;
  ask: number;
  spread: number;
}

interface OrderBookLevel {
  price: string;
  size: string;
  numOrders: number;
}

interface OrderBookSnapshot {
  symbol: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  sequence: number;
  timestamp: number;
}

interface TickerData {
  type: 'ticker';
  sequence: number;
  product_id: string;
  price: string;
  best_bid: string;
  best_ask: string;
  volume_24h: string;
  time: string;
}

interface CoinbaseConfig extends ConnectorConfig {
  wsUrl: string;
  restUrl: string;
  apiKey?: string;
  apiSecret?: string;
  passphrase?: string;
  symbols: string[];
}

export class CoinbaseConnector extends ResilientDataConnector {
  protected config: CoinbaseConfig;
  private sequenceNumbers: Map<string, number> = new Map();
  private subscribed: boolean = false;
  
  constructor(config: CoinbaseConfig) {
    super({
      url: config.wsUrl,
      name: 'CoinbaseConnector',
      enableTelemetry: true,
      reconnection: {
        // Coinbase-specific reconnection config
        initialDelay: 1000,
        maxDelay: 300000, // 5 minutes
        backoffMultiplier: 1.6, // Slightly more aggressive backoff
        jitterFactor: 0.3,
        circuitBreakerThreshold: 15, // More strict for order data
        circuitBreakerResetTime: 900000, // 15 minutes
        ...config.reconnection
      }
    });
    
    this.config = config;
  }
  
  /**
   * Handle connection setup after WebSocket is established
   */
  protected async onConnected(): Promise<void> {
    this.log('info', 'Coinbase WebSocket connected', {
      symbols: this.config.symbols
    });
    
    // Clear sequence tracking on reconnect
    this.sequenceNumbers.clear();
    
    // Authenticate if credentials provided
    await this.authenticate();
    
    // Subscribe to channels
    await this.subscribeToChannels();
  }
  
  /**
   * Handle incoming WebSocket messages
   */
  protected handleMessage(data: WebSocket.Data): void {
    try {
      const message = JSON.parse(data.toString());
      
      switch (message.type) {
        case 'subscriptions':
          this.handleSubscriptions(message);
          break;
        case 'ticker':
          this.handleTicker(message);
          break;
        case 'snapshot':
          this.handleSnapshot(message);
          break;
        case 'l2update':
          this.handleL2Update(message);
          break;
        case 'match':
          this.handleMatch(message);
          break;
        case 'heartbeat':
          this.handleHeartbeat(message);
          break;
        case 'error':
          this.handleError(message);
          break;
        default:
          this.log('debug', 'Unknown message type', { type: message.type });
      }
      
      // Emit telemetry
      this.emit('telemetry:message_processed', {
        type: message.type,
        exchange: 'coinbase',
        timestamp: Date.now()
      });
      
    } catch (error) {
      this.log('error', 'Failed to process message', error);
      this.emit('telemetry:error', {
        type: 'message_processing',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now()
      });
    }
  }
  
  private async authenticate(): Promise<void> {
    if (!this.config.apiKey || !this.config.apiSecret || !this.config.passphrase) {
      this.log('info', 'No credentials provided, using public channels only');
      return;
    }
    
    const timestamp = Date.now() / 1000;
    const message = timestamp + 'GET' + '/users/self/verify';
    const signature = this.createSignature(message);
    
    const authMessage = {
      type: 'subscribe',
      channels: ['user'],
      signature,
      key: this.config.apiKey,
      passphrase: this.config.passphrase,
      timestamp
    };
    
    this.send(authMessage);
    
    // Wait for auth confirmation
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  private createSignature(message: string): string {
    const key = Buffer.from(this.config.apiSecret || '', 'base64');
    const hmac = crypto.createHmac('sha256', key);
    const signature = hmac.update(message).digest('base64');
    return signature;
  }
  
  private async subscribeToChannels(): Promise<void> {
    const subscribeMessage = {
      type: 'subscribe',
      product_ids: this.config.symbols,
      channels: [
        'ticker',
        'level2',
        'matches',
        'heartbeat'
      ]
    };
    
    this.send(subscribeMessage);
    this.subscribed = true;
    
    this.log('info', 'Subscribed to channels', {
      products: this.config.symbols,
      channels: subscribeMessage.channels
    });
    
    this.emit('subscriptions-ready', {
      symbols: this.config.symbols,
      channels: subscribeMessage.channels
    });
  }
  
  private handleSubscriptions(message: any): void {
    this.log('info', 'Subscription confirmed', {
      channels: message.channels
    });
    
    this.emit('telemetry:subscription_confirmed', {
      channels: message.channels,
      timestamp: Date.now()
    });
  }
  
  private handleTicker(data: TickerData): void {
    const marketData: MarketData = {
      symbol: data.product_id,
      price: parseFloat(data.price),
      volume: parseFloat(data.volume_24h),
      timestamp: new Date(data.time).getTime(),
      bid: parseFloat(data.best_bid),
      ask: parseFloat(data.best_ask),
      spread: parseFloat(data.best_ask) - parseFloat(data.best_bid)
    };
    
    this.emit('market-data', marketData);
    
    // Update sequence tracking
    this.sequenceNumbers.set(data.product_id, data.sequence);
    
    // Update telemetry
    this.emit('telemetry:market_data', {
      symbol: marketData.symbol,
      price: marketData.price,
      spread: marketData.spread,
      latency: Date.now() - marketData.timestamp,
      timestamp: Date.now()
    });
  }
  
  private handleSnapshot(message: any): void {
    const snapshot: OrderBookSnapshot = {
      symbol: message.product_id,
      bids: message.bids,
      asks: message.asks,
      sequence: message.sequence,
      timestamp: Date.now()
    };
    
    this.emit('orderbook-snapshot', snapshot);
    this.sequenceNumbers.set(message.product_id, message.sequence);
    
    // Telemetry for snapshot size
    this.emit('telemetry:orderbook_snapshot', {
      symbol: snapshot.symbol,
      bidLevels: snapshot.bids.length,
      askLevels: snapshot.asks.length,
      sequence: snapshot.sequence,
      timestamp: Date.now()
    });
  }
  
  private handleL2Update(message: any): void {
    const currentSequence = this.sequenceNumbers.get(message.product_id) || 0;
    
    // Check for sequence gaps
    if (message.sequence <= currentSequence) {
      this.log('warn', 'Out of sequence update', {
        product: message.product_id,
        expected: currentSequence + 1,
        received: message.sequence
      });
      
      // Emit sequence gap telemetry
      this.emit('telemetry:sequence_gap', {
        symbol: message.product_id,
        expected: currentSequence + 1,
        received: message.sequence,
        timestamp: Date.now()
      });
      
      // Request new snapshot
      this.requestSnapshot(message.product_id);
      return;
    }
    
    this.sequenceNumbers.set(message.product_id, message.sequence);
    
    this.emit('orderbook-update', {
      symbol: message.product_id,
      changes: message.changes,
      sequence: message.sequence,
      timestamp: new Date(message.time).getTime()
    });
    
    // Telemetry for update size
    this.emit('telemetry:orderbook_update', {
      symbol: message.product_id,
      changeCount: message.changes.length,
      sequence: message.sequence,
      timestamp: Date.now()
    });
  }
  
  private handleMatch(message: any): void {
    const trade = {
      symbol: message.product_id,
      price: message.price,
      size: message.size,
      side: message.side,
      time: new Date(message.time).getTime(),
      tradeId: message.trade_id
    };
    
    this.emit('trade', trade);
    
    // Trade telemetry
    this.emit('telemetry:trade', {
      symbol: trade.symbol,
      price: parseFloat(trade.price),
      size: parseFloat(trade.size),
      side: trade.side,
      timestamp: Date.now()
    });
  }
  
  private handleHeartbeat(message: any): void {
    const latency = Date.now() - new Date(message.time).getTime();
    
    this.emit('heartbeat', {
      sequence: message.sequence,
      lastTradeId: message.last_trade_id,
      productId: message.product_id,
      time: message.time
    });
    
    // Heartbeat telemetry
    this.emit('telemetry:heartbeat', {
      product: message.product_id,
      sequence: message.sequence,
      latency,
      timestamp: Date.now()
    });
  }
  
  private handleError(message: any): void {
    this.log('error', 'Received error from Coinbase', {
      message: message.message,
      reason: message.reason
    });
    
    this.emit('error', new Error(message.message));
    
    // Error telemetry
    this.emit('telemetry:exchange_error', {
      exchange: 'coinbase',
      error: message.message,
      reason: message.reason,
      timestamp: Date.now()
    });
  }
  
  private requestSnapshot(productId: string): void {
    this.log('info', 'Requesting new orderbook snapshot', { productId });
    
    // Re-subscribe to get fresh snapshot
    this.send({
      type: 'unsubscribe',
      product_ids: [productId],
      channels: ['level2']
    });
    
    setTimeout(() => {
      this.send({
        type: 'subscribe',
        product_ids: [productId],
        channels: ['level2']
      });
    }, 1000);
    
    // Snapshot request telemetry
    this.emit('telemetry:snapshot_requested', {
      product: productId,
      reason: 'sequence_gap',
      timestamp: Date.now()
    });
  }
  
  public async fetchHistoricalData(
    symbol: string,
    start: Date,
    end: Date,
    granularity: number = 3600
  ): Promise<any[]> {
    this.log('info', 'Fetching historical data', {
      symbol,
      start: start.toISOString(),
      end: end.toISOString(),
      granularity
    });
    
    // In production, would make REST API call to this.config.restUrl
    // Mock implementation for now
    const candles: any[] = [];
    const interval = granularity * 1000;
    let current = start.getTime();
    
    while (current <= end.getTime()) {
      candles.push({
        time: current,
        low: 50000 + Math.random() * 1000,
        high: 51000 + Math.random() * 1000,
        open: 50500 + Math.random() * 500,
        close: 50500 + Math.random() * 500,
        volume: Math.random() * 100
      });
      current += interval;
    }
    
    // Historical data telemetry
    this.emit('telemetry:historical_data_fetched', {
      symbol,
      candleCount: candles.length,
      timeRange: end.getTime() - start.getTime(),
      timestamp: Date.now()
    });
    
    return candles;
  }
  
  /**
   * Add a symbol to subscriptions
   */
  public async addSymbol(symbol: string): Promise<void> {
    if (this.config.symbols.includes(symbol)) {
      this.log('warn', `Already subscribed to ${symbol}`);
      return;
    }
    
    this.config.symbols.push(symbol);
    
    // If connected, update subscriptions
    if (this.subscribed) {
      await this.subscribeToChannels();
    }
    
    this.emit('symbol-added', { symbol, timestamp: Date.now() });
  }
  
  /**
   * Remove a symbol from subscriptions
   */
  public async removeSymbol(symbol: string): Promise<void> {
    const index = this.config.symbols.indexOf(symbol);
    if (index === -1) {
      this.log('warn', `Not subscribed to ${symbol}`);
      return;
    }
    
    // Unsubscribe first
    if (this.subscribed) {
      this.send({
        type: 'unsubscribe',
        product_ids: [symbol],
        channels: ['ticker', 'level2', 'matches']
      });
    }
    
    // Remove from config
    this.config.symbols.splice(index, 1);
    this.sequenceNumbers.delete(symbol);
    
    this.emit('symbol-removed', { symbol, timestamp: Date.now() });
  }
  
  /**
   * Override disconnect to clean up Coinbase-specific resources
   */
  public async disconnect(): Promise<void> {
    // Unsubscribe from all channels
    if (this.subscribed) {
      this.send({
        type: 'unsubscribe',
        product_ids: this.config.symbols,
        channels: ['ticker', 'level2', 'matches', 'heartbeat', 'user']
      });
    }
    
    // Clear state
    this.sequenceNumbers.clear();
    this.subscribed = false;
    
    // Call parent disconnect
    await super.disconnect();
  }
  
  /**
   * Get Coinbase-specific metrics
   */
  public getCoinbaseMetrics(): {
    sequenceGaps: number;
    trackedSymbols: number;
    authenticated: boolean;
  } {
    return {
      sequenceGaps: this.countSequenceGaps(),
      trackedSymbols: this.sequenceNumbers.size,
      authenticated: !!this.config.apiKey
    };
  }
  
  private countSequenceGaps(): number {
    // This would track actual gaps in production
    return 0;
  }
} 