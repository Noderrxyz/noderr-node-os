import { EventEmitter } from 'events';
import axios from 'axios';

const createLogger = (name: string) => ({
  info: (message: string, meta?: any) => console.log(`[${name}] INFO:`, message, meta || ''),
  error: (message: string, error?: any) => console.error(`[${name}] ERROR:`, message, error || ''),
  debug: (message: string, meta?: any) => console.debug(`[${name}] DEBUG:`, message, meta || ''),
  warn: (message: string, meta?: any) => console.warn(`[${name}] WARN:`, message, meta || '')
});

interface OraclePrice {
  symbol: string;
  price: number;
  timestamp: number;
  roundId: string;
  aggregatorAddress?: string;
  confidence: number;
  source: 'chainlink' | 'fallback';
}

interface OracleConfig {
  url: string;
  apiKey?: string;
  network: 'mainnet' | 'polygon' | 'arbitrum' | 'optimism';
  symbols: string[];
  updateInterval: number;
  fallbackOracles?: string[];
  priceDeviationThreshold: number;
}

interface FeedMapping {
  symbol: string;
  feedAddress: string;
  decimals: number;
  heartbeat: number; // Expected update frequency in seconds
  description: string;
}

export class ChainlinkOracle extends EventEmitter {
  private logger: ReturnType<typeof createLogger>;
  private config: OracleConfig;
  private updateTimer: NodeJS.Timeout | null = null;
  private feedMappings: Map<string, FeedMapping> = new Map();
  private lastPrices: Map<string, OraclePrice> = new Map();
  private metrics = {
    updates: 0,
    errors: 0,
    lastUpdate: 0,
    stalePrices: 0,
    deviations: 0
  };
  
  constructor(config: OracleConfig) {
    super();
    this.logger = createLogger('ChainlinkOracle');
    this.config = {
      ...config,
      updateInterval: config.updateInterval || 10000, // 10 seconds default
      priceDeviationThreshold: config.priceDeviationThreshold || 0.02 // 2% deviation threshold
    };
    
    this.initializeFeedMappings();
  }
  
  private initializeFeedMappings(): void {
    // Common Chainlink price feed addresses (mainnet)
    const feeds: FeedMapping[] = [
      {
        symbol: 'BTC/USD',
        feedAddress: '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c',
        decimals: 8,
        heartbeat: 3600,
        description: 'BTC / USD'
      },
      {
        symbol: 'ETH/USD',
        feedAddress: '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419',
        decimals: 8,
        heartbeat: 3600,
        description: 'ETH / USD'
      },
      {
        symbol: 'SOL/USD',
        feedAddress: '0x4ffC43a60e009B551865A93d232E33Fce9f01507',
        decimals: 8,
        heartbeat: 3600,
        description: 'SOL / USD'
      },
      {
        symbol: 'BNB/USD',
        feedAddress: '0x14e613AC84a31f709eadbdF89C6CC390fDc9540A',
        decimals: 8,
        heartbeat: 3600,
        description: 'BNB / USD'
      },
      {
        symbol: 'MATIC/USD',
        feedAddress: '0x7bAC85A8a13A4BcD8abb3eB7d6b4d632c5a57676',
        decimals: 8,
        heartbeat: 3600,
        description: 'MATIC / USD'
      }
    ];
    
    // Add network-specific mappings
    if (this.config.network === 'polygon') {
      // Override with Polygon addresses
      feeds.forEach(feed => {
        feed.feedAddress = this.getPolygonAddress(feed.symbol);
      });
    }
    
    // Store mappings
    feeds.forEach(feed => {
      if (this.config.symbols.includes(feed.symbol)) {
        this.feedMappings.set(feed.symbol, feed);
      }
    });
    
    this.logger.info('Initialized feed mappings', {
      network: this.config.network,
      feeds: Array.from(this.feedMappings.keys())
    });
  }
  
  private getPolygonAddress(symbol: string): string {
    // Polygon mainnet Chainlink addresses
    const polygonFeeds: Record<string, string> = {
      'BTC/USD': '0xc907E116054Ad103354f2D350FD2514433D57F6f',
      'ETH/USD': '0xF9680D99D6C9589e2a93a78A04A279e509205945',
      'MATIC/USD': '0xAB594600376Ec9fD91F8e885dADF0CE036862dE0'
    };
    
    return polygonFeeds[symbol] || '';
  }
  
  public async start(): Promise<void> {
    this.logger.info('Starting Chainlink Oracle', {
      network: this.config.network,
      symbols: this.config.symbols,
      updateInterval: this.config.updateInterval
    });
    
    try {
      // Initial price fetch
      await this.updateAllPrices();
      
      // Start periodic updates
      this.updateTimer = setInterval(async () => {
        await this.updateAllPrices();
      }, this.config.updateInterval);
      
      this.emit('started', { timestamp: Date.now() });
      
    } catch (error) {
      this.logger.error('Failed to start oracle', error);
      throw error;
    }
  }
  
  private async updateAllPrices(): Promise<void> {
    const updatePromises = this.config.symbols.map(symbol => 
      this.updatePrice(symbol).catch(err => {
        this.logger.error(`Failed to update ${symbol}`, err);
        this.metrics.errors++;
      })
    );
    
    await Promise.all(updatePromises);
    
    // Check for stale prices
    this.checkStalePrices();
    
    // Check for price deviations
    this.checkPriceDeviations();
    
    this.metrics.lastUpdate = Date.now();
    this.emit('update-complete', {
      timestamp: Date.now(),
      prices: Array.from(this.lastPrices.values())
    });
  }
  
  private async updatePrice(symbol: string): Promise<void> {
    const feed = this.feedMappings.get(symbol);
    if (!feed) {
      this.logger.warn(`No feed mapping for ${symbol}`);
      return;
    }
    
    try {
      // In production, would call actual Chainlink node or contract
      const price = await this.fetchChainlinkPrice(feed);
      
      // Validate price
      if (!this.validatePrice(price)) {
        throw new Error('Invalid price data');
      }
      
      // Check against last price
      const lastPrice = this.lastPrices.get(symbol);
      if (lastPrice) {
        const deviation = Math.abs(price.price - lastPrice.price) / lastPrice.price;
        if (deviation > this.config.priceDeviationThreshold) {
          this.logger.warn('Large price deviation detected', {
            symbol,
            oldPrice: lastPrice.price,
            newPrice: price.price,
            deviation: (deviation * 100).toFixed(2) + '%'
          });
          
          this.metrics.deviations++;
          
          // Use fallback oracle if available
          if (this.config.fallbackOracles?.length) {
            price.price = await this.fetchFallbackPrice(symbol);
            price.source = 'fallback';
          }
        }
      }
      
      // Store price
      this.lastPrices.set(symbol, price);
      this.metrics.updates++;
      
      // Emit price update
      this.emit('price-update', price);
      
      // Update telemetry
      this.emit('metrics', {
        type: 'oracle_price',
        symbol,
        price: price.price,
        confidence: price.confidence,
        source: price.source
      });
      
    } catch (error) {
      this.logger.error(`Failed to update price for ${symbol}`, error);
      
      // Try fallback
      if (this.config.fallbackOracles?.length) {
        try {
          const fallbackPrice = await this.fetchFallbackPrice(symbol);
          this.lastPrices.set(symbol, {
            symbol,
            price: fallbackPrice,
            timestamp: Date.now(),
            roundId: 'fallback',
            confidence: 0.8,
            source: 'fallback'
          });
        } catch (fallbackError) {
          this.logger.error(`Fallback also failed for ${symbol}`, fallbackError);
        }
      }
    }
  }
  
  private async fetchChainlinkPrice(feed: FeedMapping): Promise<OraclePrice> {
    // Mock implementation - in production would use web3.js or ethers.js
    // to call the Chainlink aggregator contract
    
    const mockPrice = this.generateMockPrice(feed.symbol);
    
    return {
      symbol: feed.symbol,
      price: mockPrice,
      timestamp: Date.now(),
      roundId: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      aggregatorAddress: feed.feedAddress,
      confidence: 0.99,
      source: 'chainlink'
    };
  }
  
  private generateMockPrice(symbol: string): number {
    const basePrices: Record<string, number> = {
      'BTC/USD': 50000,
      'ETH/USD': 3000,
      'SOL/USD': 100,
      'BNB/USD': 300,
      'MATIC/USD': 1
    };
    
    const base = basePrices[symbol] || 100;
    const variation = (Math.random() - 0.5) * 0.02; // +/- 1% variation
    
    return base * (1 + variation);
  }
  
  private async fetchFallbackPrice(symbol: string): Promise<number> {
    // Mock fallback implementation
    // In production, would call alternative oracle services
    
    this.logger.info(`Using fallback oracle for ${symbol}`);
    
    // Simulate API call to fallback oracle
    await new Promise(resolve => setTimeout(resolve, 100));
    
    return this.generateMockPrice(symbol) * 0.99; // Slightly different price
  }
  
  private validatePrice(price: OraclePrice): boolean {
    // Validate price data
    if (price.price <= 0) return false;
    if (price.timestamp > Date.now() + 60000) return false; // Future timestamp
    if (price.timestamp < Date.now() - 3600000) return false; // Too old
    if (price.confidence < 0 || price.confidence > 1) return false;
    
    return true;
  }
  
  private checkStalePrices(): void {
    const now = Date.now();
    let staleCount = 0;
    
    for (const [symbol, price] of this.lastPrices) {
      const feed = this.feedMappings.get(symbol);
      if (!feed) continue;
      
      const age = now - price.timestamp;
      const maxAge = feed.heartbeat * 1000 * 1.5; // 1.5x heartbeat
      
      if (age > maxAge) {
        this.logger.warn('Stale price detected', {
          symbol,
          age: Math.floor(age / 1000) + 's',
          maxAge: Math.floor(maxAge / 1000) + 's'
        });
        
        staleCount++;
        
        this.emit('stale-price', {
          symbol,
          lastUpdate: price.timestamp,
          age
        });
      }
    }
    
    this.metrics.stalePrices = staleCount;
  }
  
  private checkPriceDeviations(): void {
    // Check for unusual price movements across feeds
    const prices = Array.from(this.lastPrices.values());
    
    if (prices.length < 2) return;
    
    // Example: Check BTC/ETH ratio
    const btc = this.lastPrices.get('BTC/USD');
    const eth = this.lastPrices.get('ETH/USD');
    
    if (btc && eth) {
      const ratio = btc.price / eth.price;
      const expectedRatio = 16.67; // Approximate historical ratio
      const deviation = Math.abs(ratio - expectedRatio) / expectedRatio;
      
      if (deviation > 0.2) { // 20% deviation
        this.logger.warn('Unusual BTC/ETH ratio detected', {
          ratio: ratio.toFixed(2),
          expected: expectedRatio.toFixed(2),
          deviation: (deviation * 100).toFixed(2) + '%'
        });
      }
    }
  }
  
  public getPrice(symbol: string): OraclePrice | null {
    return this.lastPrices.get(symbol) || null;
  }
  
  public getAllPrices(): OraclePrice[] {
    return Array.from(this.lastPrices.values());
  }
  
  public getPriceWithConfidence(symbol: string, minConfidence: number = 0.9): OraclePrice | null {
    const price = this.lastPrices.get(symbol);
    
    if (!price || price.confidence < minConfidence) {
      return null;
    }
    
    return price;
  }
  
  public async stop(): Promise<void> {
    this.logger.info('Stopping Chainlink Oracle');
    
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
    
    this.emit('stopped', { timestamp: Date.now() });
  }
  
  public getMetrics() {
    return {
      ...this.metrics,
      priceCount: this.lastPrices.size,
      avgConfidence: this.calculateAverageConfidence(),
      lastUpdateAge: Date.now() - this.metrics.lastUpdate
    };
  }
  
  private calculateAverageConfidence(): number {
    const prices = Array.from(this.lastPrices.values());
    if (prices.length === 0) return 0;
    
    const sum = prices.reduce((acc, p) => acc + p.confidence, 0);
    return sum / prices.length;
  }
  
  public isHealthy(): boolean {
    const metrics = this.getMetrics();
    
    return metrics.stalePrices === 0 &&
           metrics.errors < 5 &&
           metrics.lastUpdateAge < this.config.updateInterval * 2 &&
           metrics.avgConfidence > 0.8;
  }
  
  public async aggregatePrices(symbols: string[]): Promise<{ [key: string]: number }> {
    // Get multiple prices and return as object
    const result: { [key: string]: number } = {};
    
    for (const symbol of symbols) {
      const price = this.getPrice(symbol);
      if (price) {
        result[symbol] = price.price;
      }
    }
    
    return result;
  }
} 