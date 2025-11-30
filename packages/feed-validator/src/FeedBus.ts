import { EventEmitter } from 'events';
import { MarketSnapshot, FeedStats } from '@noderr/types';

export class FeedBus {
  private static instance: FeedBus;
  private emitter: EventEmitter;
  private stats: Map<string, FeedStats>;

  private constructor() {
    this.emitter = new EventEmitter();
    this.stats = new Map();
  }

  public static getInstance(): FeedBus {
    if (!FeedBus.instance) {
      FeedBus.instance = new FeedBus();
    }
    return FeedBus.instance;
  }

  public subscribe(callback: (snapshot: MarketSnapshot) => void): void {
    this.emitter.on('marketSnapshot', callback);
  }

  public unsubscribe(callback: (snapshot: MarketSnapshot) => void): void {
    this.emitter.off('marketSnapshot', callback);
  }

  public publish(snapshot: MarketSnapshot): void {
    const key = `${snapshot.source}:${snapshot.symbol}`;
    const now = Date.now();
    
    // Update stats
    const currentStats = this.stats.get(key) || {
      source: snapshot.source,
      symbol: snapshot.symbol,
      lastUpdate: now,
      latencyMs: snapshot.latencyMs || 0,
      uptimePct: 100,
      errorCount: 0,
      messageCount: 0
    };

    currentStats.lastUpdate = now;
    currentStats.latencyMs = snapshot.latencyMs || currentStats.latencyMs;
    currentStats.messageCount++;
    
    this.stats.set(key, currentStats);
    
    // Emit event
    this.emitter.emit('marketSnapshot', snapshot);
  }

  public getStats(source: string, symbol: string): FeedStats | undefined {
    return this.stats.get(`${source}:${symbol}`);
  }

  public getAllStats(): FeedStats[] {
    return Array.from(this.stats.values());
  }

  public resetStats(source: string, symbol: string): void {
    this.stats.delete(`${source}:${symbol}`);
  }
} 