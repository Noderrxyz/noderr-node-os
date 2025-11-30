import { ResilientDataConnector, ConnectorConfig } from './ResilientDataConnector';
import WebSocket from 'ws';

interface MarketData {
  symbol: string;
  price: number;
  volume: number;
  timestamp: number;
  bid: number;
  ask: number;
  spread: number;
}

interface OrderBookUpdate {
  symbol: string;
  bids: Array<[string, string]>;
  asks: Array<[string, string]>;
  lastUpdateId: number;
  timestamp: number;
}

interface TradeUpdate {
  symbol: string;
  price: string;
  quantity: string;
  time: number;
  isBuyerMaker: boolean;
  tradeId: number;
}

interface BinanceConfig extends ConnectorConfig {
  apiKey?: string;
  apiSecret?: string;
  symbols: string[];
}

export class BinanceConnector extends ResilientDataConnector {
  private subscriptions: Set<string> = new Set();
  private messageBuffer: any[] = [];
  private bufferTimer: NodeJS.Timeout | null = null;
  protected config: BinanceConfig;
  
  constructor(config: BinanceConfig) {
    super({
      ...config,
      name: 'BinanceConnector',
      enableTelemetry: true,
      reconnection: {
        // Binance-specific reconnection config
        initialDelay: 1000,
        maxDelay: 300000, // 5 minutes
        backoffMultiplier: 1.5,
        jitterFactor: 0.3,
        circuitBreakerThreshold: 20, // More lenient for market data
        circuitBreakerResetTime: 600000, // 10 minutes
        ...config.reconnection
      }
    });
    
    this.config = config;
  }
  
  /**
   * Handle connection setup after WebSocket is established
   */
  protected async onConnected(): Promise<void> {
    this.log('info', 'Binance WebSocket connected', {
      symbols: this.config.symbols
    });
    
    // Subscriptions are handled via URL in Binance
    for (const symbol of this.config.symbols) {
      this.subscriptions.add(symbol);
    }
    
    this.emit('subscriptions-ready', {
      symbols: Array.from(this.subscriptions)
    });
  }
  
  /**
   * Override connect to build proper Binance WebSocket URL
   */
  public async connect(): Promise<void> {
    // Construct WebSocket URL with streams
    const streams = this.config.symbols.map(symbol => 
      `${symbol.toLowerCase()}@ticker/${symbol.toLowerCase()}@depth20@100ms/${symbol.toLowerCase()}@trade`
    ).join('/');
    
    // Update URL with streams
    this.config.url = `${this.config.url}/stream?streams=${streams}`;
    
    // Call parent connect
    await super.connect();
  }
  
  /**
   * Handle incoming WebSocket messages
   */
  protected handleMessage(data: WebSocket.Data): void {
    try {
      const message = JSON.parse(data.toString());
      
      // Binance wraps stream data
      if (message.stream && message.data) {
        const streamType = this.getStreamType(message.stream);
        const streamData = message.data;
        
        switch (streamType) {
          case 'ticker':
            this.processTicker(streamData);
            break;
          case 'depth':
            this.processOrderBook(streamData);
            break;
          case 'trade':
            this.processTrade(streamData);
            break;
          default:
            this.log('debug', 'Unknown stream type', { type: streamType });
        }
      }
      
      // Buffer messages for batch processing
      this.bufferMessage(message);
      
      // Emit telemetry
      this.emit('telemetry:message_processed', {
        type: 'market_data',
        exchange: 'binance',
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
  
  private getStreamType(stream: string): string {
    if (stream.includes('@ticker')) return 'ticker';
    if (stream.includes('@depth')) return 'depth';
    if (stream.includes('@trade')) return 'trade';
    return 'unknown';
  }
  
  private processTicker(data: any): void {
    const marketData: MarketData = {
      symbol: data.s,
      price: parseFloat(data.c),
      volume: parseFloat(data.v),
      timestamp: data.E,
      bid: parseFloat(data.b),
      ask: parseFloat(data.a),
      spread: parseFloat(data.a) - parseFloat(data.b)
    };
    
    this.emit('market-data', marketData);
    
    // Update telemetry
    this.emit('telemetry:market_data', {
      symbol: marketData.symbol,
      price: marketData.price,
      spread: marketData.spread,
      latency: Date.now() - marketData.timestamp,
      timestamp: Date.now()
    });
  }
  
  private processOrderBook(data: any): void {
    const orderBook: OrderBookUpdate = {
      symbol: this.extractSymbolFromStream(data),
      bids: data.bids || [],
      asks: data.asks || [],
      lastUpdateId: data.lastUpdateId || data.u,
      timestamp: Date.now()
    };
    
    this.emit('orderbook-update', orderBook);
    
    // Telemetry for order book depth
    this.emit('telemetry:orderbook_depth', {
      symbol: orderBook.symbol,
      bidLevels: orderBook.bids.length,
      askLevels: orderBook.asks.length,
      timestamp: Date.now()
    });
  }
  
  private processTrade(data: any): void {
    const trade: TradeUpdate = {
      symbol: data.s,
      price: data.p,
      quantity: data.q,
      time: data.T,
      isBuyerMaker: data.m,
      tradeId: data.t
    };
    
    this.emit('trade', trade);
    
    // Trade flow telemetry
    this.emit('telemetry:trade', {
      symbol: trade.symbol,
      price: parseFloat(trade.price),
      quantity: parseFloat(trade.quantity),
      side: trade.isBuyerMaker ? 'sell' : 'buy',
      timestamp: Date.now()
    });
  }
  
  private extractSymbolFromStream(data: any): string {
    return data.s || data.symbol || 'UNKNOWN';
  }
  
  private bufferMessage(message: any): void {
    this.messageBuffer.push(message);
    
    // Process buffer periodically
    if (!this.bufferTimer) {
      this.bufferTimer = setTimeout(() => {
        this.processMessageBuffer();
        this.bufferTimer = null;
      }, 100); // Process every 100ms
    }
  }
  
  private processMessageBuffer(): void {
    if (this.messageBuffer.length === 0) return;
    
    const bufferSize = this.messageBuffer.length;
    const messages = [...this.messageBuffer];
    this.messageBuffer = [];
    
    this.emit('batch-update', {
      messages,
      count: bufferSize,
      timestamp: Date.now()
    });
    
    // Batch processing telemetry
    this.emit('telemetry:batch_processed', {
      messageCount: bufferSize,
      timestamp: Date.now()
    });
  }
  
  public async addSymbol(symbol: string): Promise<void> {
    if (this.subscriptions.has(symbol)) {
      this.log('warn', `Already subscribed to ${symbol}`);
      return;
    }
    
    this.log('info', `Adding symbol: ${symbol}`);
    
    // For Binance, we need to reconnect with new stream list
    this.config.symbols.push(symbol);
    
    // Disconnect and reconnect with new symbol list
    await this.disconnect();
    await this.connect();
    
    this.emit('symbol-added', { symbol, timestamp: Date.now() });
  }
  
  public async removeSymbol(symbol: string): Promise<void> {
    if (!this.subscriptions.has(symbol)) {
      this.log('warn', `Not subscribed to ${symbol}`);
      return;
    }
    
    this.log('info', `Removing symbol: ${symbol}`);
    
    // For Binance, we need to reconnect with new stream list
    this.config.symbols = this.config.symbols.filter(s => s !== symbol);
    this.subscriptions.delete(symbol);
    
    // Disconnect and reconnect with new symbol list
    await this.disconnect();
    await this.connect();
    
    this.emit('symbol-removed', { symbol, timestamp: Date.now() });
  }
  
  /**
   * Override disconnect to clean up Binance-specific resources
   */
  public async disconnect(): Promise<void> {
    // Process any remaining buffered messages
    if (this.bufferTimer) {
      clearTimeout(this.bufferTimer);
      this.bufferTimer = null;
    }
    this.processMessageBuffer();
    
    // Clear subscriptions
    this.subscriptions.clear();
    
    // Call parent disconnect
    await super.disconnect();
  }
  
  /**
   * Get active subscriptions
   */
  public getActiveSymbols(): string[] {
    return Array.from(this.subscriptions);
  }
  
  /**
   * Get exchange-specific status
   */
  public getExchangeStatus(): {
    exchange: string;
    symbols: string[];
    messageBufferSize: number;
    subscriptionCount: number;
  } {
    return {
      exchange: 'binance',
      symbols: this.config.symbols,
      messageBufferSize: this.messageBuffer.length,
      subscriptionCount: this.subscriptions.size
    };
  }
} 