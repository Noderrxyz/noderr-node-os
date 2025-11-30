import { parentPort, workerData } from 'worker_threads';

/**
 * Base Strategy Worker Template
 * This file serves as a template for strategy implementations
 * that run in isolated worker threads
 */

// Extract worker configuration
const {
  strategyId,
  strategyName,
  parameters,
  marketDataBuffer,
  signalBuffer,
  memoryLimit
} = workerData;

// Set up shared memory views
const marketData = new Float64Array(marketDataBuffer);
const signals = new Float64Array(signalBuffer);

// Strategy state
let isRunning = false;
let lastProcessedIndex = -1;
let signalCount = 0;
let lastSignalIndex = 0;

// Performance tracking
let lastPerformanceReport = Date.now();
const performanceInterval = 5000; // Report every 5 seconds

/**
 * Base strategy class that all strategies should extend
 */
abstract class BaseStrategy {
  protected parameters: any;
  protected state: any = {};
  
  constructor(parameters: any) {
    this.parameters = parameters;
    this.initialize();
  }
  
  /**
   * Initialize strategy state
   */
  abstract initialize(): void;
  
  /**
   * Process market data and generate signals
   */
  abstract processMarketData(data: MarketDataPoint): TradingSignal | null;
  
  /**
   * Update strategy parameters
   */
  updateParameters(newParams: any): void {
    this.parameters = { ...this.parameters, ...newParams };
  }
  
  /**
   * Clean up strategy resources
   */
  cleanup(): void {
    // Override if needed
  }
}

/**
 * Example momentum strategy implementation
 */
class MomentumStrategy extends BaseStrategy {
  private priceHistory: number[] = [];
  private lookback: number = 20;
  private threshold: number = 0.02;
  
  initialize(): void {
    this.lookback = this.parameters.lookback || 20;
    this.threshold = this.parameters.threshold || 0.02;
  }
  
  processMarketData(data: MarketDataPoint): TradingSignal | null {
    // Update price history
    this.priceHistory.push(data.lastPrice);
    if (this.priceHistory.length > this.lookback) {
      this.priceHistory.shift();
    }
    
    // Need enough history
    if (this.priceHistory.length < this.lookback) {
      return null;
    }
    
    // Calculate momentum
    const oldPrice = this.priceHistory[0];
    const currentPrice = data.lastPrice;
    const momentum = (currentPrice - oldPrice) / oldPrice;
    
    // Generate signal based on momentum
    if (Math.abs(momentum) > this.threshold) {
      return {
        strategyId,
        symbol: data.symbol,
        action: momentum > 0 ? 'BUY' : 'SELL',
        quantity: this.calculatePositionSize(data),
        confidence: Math.min(Math.abs(momentum) / this.threshold, 1),
        timestamp: Date.now(),
        metadata: {
          momentum,
          lookback: this.lookback
        }
      };
    }
    
    return null;
  }
  
  private calculatePositionSize(data: MarketDataPoint): number {
    // Simple position sizing based on available liquidity
    const avgSize = (data.bidSize + data.askSize) / 2;
    return Math.floor(avgSize * 0.1); // Take 10% of average size
  }
}

/**
 * Example mean reversion strategy
 */
class MeanReversionStrategy extends BaseStrategy {
  private priceMA: number = 0;
  private priceCount: number = 0;
  private window: number = 50;
  private deviation: number = 2;
  
  initialize(): void {
    this.window = this.parameters.window || 50;
    this.deviation = this.parameters.deviation || 2;
  }
  
  processMarketData(data: MarketDataPoint): TradingSignal | null {
    // Update moving average
    this.priceMA = (this.priceMA * this.priceCount + data.lastPrice) / (this.priceCount + 1);
    this.priceCount = Math.min(this.priceCount + 1, this.window);
    
    // Need enough data
    if (this.priceCount < this.window) {
      return null;
    }
    
    // Calculate deviation from mean
    const deviation = (data.lastPrice - this.priceMA) / this.priceMA;
    const absDeviation = Math.abs(deviation);
    
    // Generate signal if price deviates significantly
    if (absDeviation > this.deviation * 0.01) {
      return {
        strategyId,
        symbol: data.symbol,
        action: deviation < 0 ? 'BUY' : 'SELL', // Buy when below mean, sell when above
        quantity: this.calculatePositionSize(absDeviation),
        confidence: Math.min(absDeviation / (this.deviation * 0.01), 1),
        timestamp: Date.now(),
        metadata: {
          priceMA: this.priceMA,
          deviation: deviation
        }
      };
    }
    
    return null;
  }
  
  private calculatePositionSize(deviation: number): number {
    // Size based on deviation strength
    return Math.floor(100 * (1 + deviation));
  }
}

// Strategy factory
function createStrategy(name: string, parameters: any): BaseStrategy {
  switch (name) {
    case 'momentum':
      return new MomentumStrategy(parameters);
    case 'meanReversion':
      return new MeanReversionStrategy(parameters);
    default:
      throw new Error(`Unknown strategy: ${name}`);
  }
}

// Initialize strategy
let strategy: BaseStrategy | null = null;

// Message handler
parentPort!.on('message', (msg: any) => {
  switch (msg.type) {
    case 'start':
      isRunning = true;
      strategy = createStrategy(parameters.type || 'momentum', parameters);
      parentPort!.postMessage({ type: 'ready' });
      break;
      
    case 'stop':
      isRunning = false;
      if (strategy) {
        strategy.cleanup();
      }
      break;
      
    case 'marketData':
      if (isRunning && strategy && msg.index > lastProcessedIndex) {
        lastProcessedIndex = msg.index;
        
        // Read market data from shared buffer
        const offset = (msg.index % 10000) * 10;
        const data: MarketDataPoint = {
          timestamp: marketData[offset],
          symbolHash: marketData[offset + 1],
          symbol: 'UNKNOWN', // Would need symbol mapping
          bidPrice: marketData[offset + 2],
          bidSize: marketData[offset + 3],
          askPrice: marketData[offset + 4],
          askSize: marketData[offset + 5],
          lastPrice: marketData[offset + 6],
          volume: marketData[offset + 7],
          sequence: marketData[offset + 8],
          index: marketData[offset + 9]
        };
        
        // Process data and check for signal
        const signal = strategy.processMarketData(data);
        if (signal) {
          // Write signal to shared buffer
          const signalOffset = (lastSignalIndex % 1000) * 10;
          signals[signalOffset] = Date.now();
          signals[signalOffset + 1] = signal.action === 'BUY' ? 1 : signal.action === 'SELL' ? -1 : 0;
          signals[signalOffset + 2] = signal.quantity;
          signals[signalOffset + 3] = signal.confidence;
          // ... more signal data
          
          lastSignalIndex++;
          signalCount++;
          
          // Send signal notification
          parentPort!.postMessage({ type: 'signal', signal });
        }
        
        // Report performance periodically
        const now = Date.now();
        if (now - lastPerformanceReport > performanceInterval) {
          reportPerformance();
          lastPerformanceReport = now;
        }
      }
      break;
      
    case 'updateParameters':
      if (strategy) {
        strategy.updateParameters(msg.parameters);
      }
      break;
  }
});

// Performance reporting
function reportPerformance(): void {
  const usage = process.cpuUsage();
  const memory = process.memoryUsage();
  
  parentPort!.postMessage({
    type: 'performance',
    metrics: {
      strategyId,
      totalSignals: signalCount,
      cpuUsage: usage.user + usage.system,
      memoryUsage: memory.heapUsed,
      lastProcessedIndex,
      signalsPerSecond: signalCount / ((Date.now() - lastPerformanceReport) / 1000)
    }
  });
}

// Error handling
process.on('uncaughtException', (error) => {
  parentPort!.postMessage({ type: 'error', error });
});

process.on('unhandledRejection', (reason) => {
  parentPort!.postMessage({ type: 'error', error: new Error(String(reason)) });
});

// Types
interface MarketDataPoint {
  timestamp: number;
  symbolHash: number;
  symbol: string;
  bidPrice: number;
  bidSize: number;
  askPrice: number;
  askSize: number;
  lastPrice: number;
  volume: number;
  sequence: number;
  index: number;
}

interface TradingSignal {
  strategyId: string;
  symbol: string;
  action: 'BUY' | 'SELL' | 'HOLD';
  quantity: number;
  confidence: number;
  timestamp: number;
  metadata?: any;
}

// Export types for TypeScript
export { BaseStrategy, MarketDataPoint, TradingSignal }; 