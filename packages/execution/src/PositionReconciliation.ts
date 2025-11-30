import { EventEmitter } from 'events';
import * as winston from 'winston';
import { ExchangeBatcher, ExchangeBatcherFactory } from './ExchangeBatcher';
import { CircuitBreakerFactory } from '../../core/src/CircuitBreaker';
import { DistributedStateManager } from '../../core/src/DistributedStateManager';

// Circular buffer for bounded memory usage
class CircularBuffer<T> {
  private buffer: T[];
  private pointer: number = 0;
  private size: number = 0;
  
  constructor(private capacity: number) {
    this.buffer = new Array(capacity);
  }
  
  push(item: T): void {
    this.buffer[this.pointer] = item;
    this.pointer = (this.pointer + 1) % this.capacity;
    this.size = Math.min(this.size + 1, this.capacity);
  }
  
  getAll(): T[] {
    if (this.size < this.capacity) {
      return this.buffer.slice(0, this.size);
    }
    return [...this.buffer.slice(this.pointer), ...this.buffer.slice(0, this.pointer)];
  }
  
  clear(): void {
    this.buffer = new Array(this.capacity);
    this.pointer = 0;
    this.size = 0;
  }
}

export interface Position {
  symbol: string;
  quantity: number;
  avgPrice: number;
  unrealizedPnl: number;
  realizedPnl: number;
  lastUpdate: Date;
}

export interface ExchangeBalance {
  asset: string;
  free: number;
  locked: number;
  total: number;
}

export interface ReconciliationResult {
  timestamp: Date;
  discrepancies: Discrepancy[];
  internalPositions: Map<string, Position>;
  exchangePositions: Map<string, Position>;
  driftPercentage: number;
  action: 'none' | 'alert' | 'pause' | 'correct';
}

export interface Discrepancy {
  symbol: string;
  field: string;
  internal: number;
  exchange: number;
  difference: number;
  percentage: number;
}

export class PositionReconciliation extends EventEmitter {
  private logger: winston.Logger;
  private internalPositions: Map<string, Position> = new Map();
  private reconciliationInterval: NodeJS.Timeout | null = null;
  private isPaused: boolean = false;
  private reconciliationHistory: CircularBuffer<ReconciliationResult>;
  private stateManager?: DistributedStateManager;
  private batcherFactory: ExchangeBatcherFactory;
  
  // Configurable thresholds
  private readonly ALERT_DRIFT_THRESHOLD = 0.001; // 0.1%
  private readonly PAUSE_DRIFT_THRESHOLD = 0.01;  // 1%
  private readonly RECONCILIATION_INTERVAL = 30000; // 30 seconds
  private readonly MAX_RECONCILIATION_ATTEMPTS = 3;
  private readonly MAX_HISTORY_SIZE = 1000;
  
  constructor(logger: winston.Logger, stateManager?: DistributedStateManager) {
    super();
    this.logger = logger;
    this.stateManager = stateManager;
    this.reconciliationHistory = new CircularBuffer<ReconciliationResult>(this.MAX_HISTORY_SIZE);
    this.batcherFactory = new ExchangeBatcherFactory(logger);
  }
  
  start(): void {
    if (this.reconciliationInterval) {
      return;
    }
    
    this.logger.info('Starting position reconciliation service');
    
    // Initial reconciliation
    this.reconcile().catch(err => 
      this.logger.error('Initial reconciliation failed', err)
    );
    
    // Schedule periodic reconciliation
    this.reconciliationInterval = setInterval(() => {
      if (!this.isPaused) {
        this.reconcile().catch(err => 
          this.logger.error('Periodic reconciliation failed', err)
        );
      }
    }, this.RECONCILIATION_INTERVAL);
  }
  
  stop(): void {
    if (this.reconciliationInterval) {
      clearInterval(this.reconciliationInterval);
      this.reconciliationInterval = null;
    }
    this.logger.info('Stopped position reconciliation service');
  }
  
  async reconcile(): Promise<ReconciliationResult> {
    const startTime = Date.now();
    
    try {
      // Fetch positions from all sources
      const [internalPositions, exchangePositions] = await Promise.all([
        this.getInternalPositions(),
        this.getExchangePositions()
      ]);
      
      // Compare positions
      const discrepancies = this.comparePositions(internalPositions, exchangePositions);
      
      // Calculate overall drift
      const driftPercentage = this.calculateDrift(discrepancies);
      
      // Determine action based on drift
      const action = this.determineAction(driftPercentage);
      
      const result: ReconciliationResult = {
        timestamp: new Date(),
        discrepancies,
        internalPositions,
        exchangePositions,
        driftPercentage,
        action
      };
      
      // Execute action
      await this.executeAction(result);
      
      // Store in history
      this.reconciliationHistory.push(result);
      
      // Persist to distributed state
      if (this.stateManager) {
        await this.stateManager.setState(
          `reconciliation-result-${Date.now()}`,
          result,
          { namespace: 'reconciliation-history', ttl: 86400 } // 24 hours
        );
      }
      
      // Emit reconciliation event
      this.emit('reconciliation', result);
      
      // Log metrics
      const duration = Date.now() - startTime;
      this.logger.info('Position reconciliation completed', {
        duration,
        discrepancies: discrepancies.length,
        driftPercentage,
        action
      });
      
      return result;
      
    } catch (error) {
      this.logger.error('Reconciliation failed', error);
      throw error;
    }
  }
  
  private async getInternalPositions(): Promise<Map<string, Position>> {
    // In production, this would fetch from internal state management
    return new Map(this.internalPositions);
  }
  
  private async getExchangePositions(): Promise<Map<string, Position>> {
    // Fetch from distributed state if available
    if (this.stateManager) {
      const cached = await this.stateManager.getState<Map<string, Position>>(
        'exchange-positions',
        { namespace: 'reconciliation', ttl: 60 }
      );
      if (cached) {
        return new Map(cached);
      }
    }
    
    const positions = new Map<string, Position>();
    const exchanges = ['binance', 'coinbase', 'kraken'];
    
    // Use batched API calls for each exchange
    const exchangePromises = exchanges.map(async exchange => {
      try {
        // Get batcher for this exchange
        const batcher = this.batcherFactory.getBatcher<string, Position[]>(
          exchange,
          async (symbols: string[]) => {
            // Batch processor - fetch multiple positions at once
            return this.fetchBatchedExchangePositions(exchange, symbols);
          },
          {
            minBatchSize: 10,
            maxBatchSize: 50,
            maxWaitTime: 5,
            targetP99Latency: 30
          }
        );
        
        // Get all symbols we care about
        const symbols = Array.from(this.internalPositions.keys());
        
        // Request positions for all symbols (will be batched automatically)
        const positionPromises = symbols.map(symbol => 
          batcher.addRequest(symbol)
        );
        
        const results = await Promise.all(positionPromises);
        const exchangePositions = new Map<string, Position>();
        
        // Process results
        results.forEach((positionArray, index) => {
          const symbol = symbols[index];
          if (positionArray && positionArray.length > 0) {
            exchangePositions.set(symbol, positionArray[0]);
          }
        });
        
        return { exchange, positions: exchangePositions, error: null };
      } catch (error) {
        return { exchange, positions: new Map<string, Position>(), error };
      }
    });
    
    const results = await Promise.all(exchangePromises);
    
    // Process results
    for (const { exchange, positions: exchangePositions, error } of results) {
      if (error) {
        this.logger.error(`Failed to fetch positions from ${exchange}`, error);
        continue;
      }
      
      // Merge positions
      for (const [symbol, position] of exchangePositions) {
        if (positions.has(symbol)) {
          const existing = positions.get(symbol)!;
          positions.set(symbol, {
            symbol,
            quantity: existing.quantity + position.quantity,
            avgPrice: existing.quantity + position.quantity === 0 ? 0 :
                     (existing.avgPrice * existing.quantity + position.avgPrice * position.quantity) / 
                     (existing.quantity + position.quantity),
            unrealizedPnl: existing.unrealizedPnl + position.unrealizedPnl,
            realizedPnl: existing.realizedPnl + position.realizedPnl,
            lastUpdate: new Date()
          });
        } else {
          positions.set(symbol, position);
        }
      }
    }
    
    // Cache the result
    if (this.stateManager) {
      await this.stateManager.setState(
        'exchange-positions',
        Array.from(positions.entries()),
        { namespace: 'reconciliation', ttl: 60 }
      );
    }
    
    return positions;
  }
  
  private async fetchExchangePositions(exchange: string): Promise<Map<string, Position>> {
    // Mock exchange API call
    const positions = new Map<string, Position>();
    
    // In production, this would be actual API calls
    if (this.internalPositions.size > 0) {
      for (const [symbol, internalPos] of this.internalPositions) {
        // Simulate slight drift
        const drift = 1 + (Math.random() - 0.5) * 0.002; // ±0.1% drift
        positions.set(symbol, {
          symbol,
          quantity: internalPos.quantity * drift,
          avgPrice: internalPos.avgPrice,
          unrealizedPnl: internalPos.unrealizedPnl * drift,
          realizedPnl: internalPos.realizedPnl,
          lastUpdate: new Date()
        });
      }
    }
    
    return positions;
  }
  
  private async fetchBatchedExchangePositions(exchange: string, symbols: string[]): Promise<Position[][]> {
    // Simulate batched API call with latency reduction
    const baseLatency = 20; // Base API latency
    const perSymbolLatency = 1; // Additional latency per symbol
    const totalLatency = baseLatency + (symbols.length * perSymbolLatency);
    
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, totalLatency));
    
    // Return positions for each symbol
    return symbols.map(symbol => {
      const internalPos = this.internalPositions.get(symbol);
      if (!internalPos) {
        return [];
      }
      
      // Simulate slight drift
      const drift = 1 + (Math.random() - 0.5) * 0.002; // ±0.1% drift
      return [{
        symbol,
        quantity: internalPos.quantity * drift,
        avgPrice: internalPos.avgPrice,
        unrealizedPnl: internalPos.unrealizedPnl * drift,
        realizedPnl: internalPos.realizedPnl,
        lastUpdate: new Date()
      }];
    });
  }
  
  private comparePositions(
    internal: Map<string, Position>,
    exchange: Map<string, Position>
  ): Discrepancy[] {
    const discrepancies: Discrepancy[] = [];
    
    // Check all internal positions
    for (const [symbol, internalPos] of internal) {
      const exchangePos = exchange.get(symbol);
      
      if (!exchangePos) {
        // Position exists internally but not on exchange
        discrepancies.push({
          symbol,
          field: 'existence',
          internal: internalPos.quantity,
          exchange: 0,
          difference: internalPos.quantity,
          percentage: 1.0
        });
        continue;
      }
      
      // Compare quantities
      const qtyDiff = Math.abs(internalPos.quantity - exchangePos.quantity);
      const qtyPct = qtyDiff / Math.max(Math.abs(internalPos.quantity), 0.000001);
      
      if (qtyPct > 0.0001) { // 0.01% threshold
        discrepancies.push({
          symbol,
          field: 'quantity',
          internal: internalPos.quantity,
          exchange: exchangePos.quantity,
          difference: qtyDiff,
          percentage: qtyPct
        });
      }
      
      // Compare unrealized PnL
      const pnlDiff = Math.abs(internalPos.unrealizedPnl - exchangePos.unrealizedPnl);
      const pnlPct = pnlDiff / Math.max(Math.abs(internalPos.unrealizedPnl), 1);
      
      if (pnlPct > 0.01) { // 1% threshold for PnL
        discrepancies.push({
          symbol,
          field: 'unrealizedPnl',
          internal: internalPos.unrealizedPnl,
          exchange: exchangePos.unrealizedPnl,
          difference: pnlDiff,
          percentage: pnlPct
        });
      }
    }
    
    // Check for positions on exchange but not internally
    for (const [symbol, exchangePos] of exchange) {
      if (!internal.has(symbol)) {
        discrepancies.push({
          symbol,
          field: 'existence',
          internal: 0,
          exchange: exchangePos.quantity,
          difference: exchangePos.quantity,
          percentage: 1.0
        });
      }
    }
    
    return discrepancies;
  }
  
  private calculateDrift(discrepancies: Discrepancy[]): number {
    if (discrepancies.length === 0) {
      return 0;
    }
    
    // Calculate weighted average drift
    let totalWeight = 0;
    let weightedDrift = 0;
    
    for (const discrepancy of discrepancies) {
      // Weight by position size
      const weight = Math.abs(discrepancy.internal) + Math.abs(discrepancy.exchange);
      totalWeight += weight;
      weightedDrift += discrepancy.percentage * weight;
    }
    
    return totalWeight > 0 ? weightedDrift / totalWeight : 0;
  }
  
  private determineAction(driftPercentage: number): ReconciliationResult['action'] {
    if (driftPercentage >= this.PAUSE_DRIFT_THRESHOLD) {
      return 'pause';
    } else if (driftPercentage >= this.ALERT_DRIFT_THRESHOLD) {
      return 'alert';
    } else {
      return 'none';
    }
  }
  
  private async executeAction(result: ReconciliationResult): Promise<void> {
    switch (result.action) {
      case 'pause':
        await this.pauseTrading(result);
        break;
        
      case 'alert':
        await this.sendAlert(result);
        break;
        
      case 'correct':
        await this.correctPositions(result);
        break;
        
      case 'none':
        // No action needed
        break;
    }
  }
  
  private async pauseTrading(result: ReconciliationResult): Promise<void> {
    this.isPaused = true;
    
    this.logger.error('CRITICAL: Trading paused due to position drift', {
      driftPercentage: result.driftPercentage,
      discrepancies: result.discrepancies
    });
    
    this.emit('trading-paused', {
      reason: 'position-drift',
      drift: result.driftPercentage,
      timestamp: new Date()
    });
    
    // Attempt automatic correction
    const corrected = await this.attemptAutoCorrection(result);
    
    if (corrected) {
      this.isPaused = false;
      this.logger.info('Trading resumed after successful auto-correction');
      this.emit('trading-resumed', {
        reason: 'auto-correction',
        timestamp: new Date()
      });
    }
  }
  
  private async sendAlert(result: ReconciliationResult): Promise<void> {
    this.logger.warn('Position drift detected', {
      driftPercentage: result.driftPercentage,
      discrepancies: result.discrepancies.slice(0, 5) // Top 5 discrepancies
    });
    
    this.emit('drift-alert', {
      level: 'warning',
      drift: result.driftPercentage,
      discrepancies: result.discrepancies,
      timestamp: new Date()
    });
  }
  
  private async correctPositions(result: ReconciliationResult): Promise<void> {
    // Implement position correction logic
    for (const discrepancy of result.discrepancies) {
      if (discrepancy.field === 'quantity' && discrepancy.percentage > 0.001) {
        this.logger.info('Correcting position', {
          symbol: discrepancy.symbol,
          internal: discrepancy.internal,
          exchange: discrepancy.exchange
        });
        
        // Update internal state to match exchange
        const exchangePos = result.exchangePositions.get(discrepancy.symbol);
        if (exchangePos) {
          this.updateInternalPosition(discrepancy.symbol, exchangePos);
        }
      }
    }
  }
  
  private async attemptAutoCorrection(result: ReconciliationResult): Promise<boolean> {
    let attempts = 0;
    
    while (attempts < this.MAX_RECONCILIATION_ATTEMPTS) {
      attempts++;
      
      this.logger.info(`Auto-correction attempt ${attempts}/${this.MAX_RECONCILIATION_ATTEMPTS}`);
      
      // Correct positions
      await this.correctPositions(result);
      
      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Re-reconcile
      const newResult = await this.reconcile();
      
      if (newResult.driftPercentage < this.ALERT_DRIFT_THRESHOLD) {
        this.logger.info('Auto-correction successful', {
          attempts,
          finalDrift: newResult.driftPercentage
        });
        return true;
      }
    }
    
    this.logger.error('Auto-correction failed after maximum attempts');
    return false;
  }
  
  updateInternalPosition(symbol: string, position: Position): void {
    this.internalPositions.set(symbol, {
      ...position,
      lastUpdate: new Date()
    });
    
    this.emit('position-updated', {
      symbol,
      position,
      source: 'reconciliation'
    });
  }
  
  getPosition(symbol: string): Position | undefined {
    return this.internalPositions.get(symbol);
  }
  
  getAllPositions(): Map<string, Position> {
    return new Map(this.internalPositions);
  }
  
  isPausedForReconciliation(): boolean {
    return this.isPaused;
  }
  
  resumeTrading(): void {
    this.isPaused = false;
    this.logger.info('Trading manually resumed');
    this.emit('trading-resumed', {
      reason: 'manual',
      timestamp: new Date()
    });
  }
} 