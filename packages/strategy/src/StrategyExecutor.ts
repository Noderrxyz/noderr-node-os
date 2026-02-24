import { Logger } from '@noderr/utils';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { EventEmitter } from 'events';
import * as os from 'os';
// TODO: Import from @noderr/core once it builds
export interface MarketDataUpdate {
  symbol: string;
  sequence?: number;
  timestamp?: bigint;
  bidPrice?: number;
  bidSize?: number;
  askPrice?: number;
  askSize?: number;
  lastPrice?: number;
  volume?: number;
  isSnapshot?: boolean;
  isTrade?: boolean;
  isQuote?: boolean;
}

/**
 * Concurrent Strategy Executor
 * Features:
 * - 100+ concurrent strategy threads
 * - Isolated memory per strategy
 * - Zero-copy market data sharing
 * - Dynamic strategy loading
 * - Performance monitoring
 */
export class StrategyExecutor extends EventEmitter {
  private strategies: Map<string, StrategyWorker> = new Map();
  private marketDataBuffer: SharedArrayBuffer;
  private signalBuffer: SharedArrayBuffer;
  private maxStrategies: number;
  private activeStrategies: number = 0;
  private totalSignals: number = 0;
  private performanceMonitor: PerformanceMonitor;
  
  constructor(options: ExecutorOptions = {}) {
    super();
    
    this.maxStrategies = options.maxStrategies || 128;
    
    // Allocate shared buffers
    this.marketDataBuffer = new SharedArrayBuffer(options.marketDataSize || 50 * 1024 * 1024); // 50MB
    this.signalBuffer = new SharedArrayBuffer(options.signalBufferSize || 10 * 1024 * 1024); // 10MB
    
    // Initialize performance monitor
    this.performanceMonitor = new PerformanceMonitor();
    
    // Set up market data distribution
    this.setupMarketDataDistribution();
  }
  
  private setupMarketDataDistribution(): void {
    // Market data writer for zero-copy distribution
    const marketDataView = new Float64Array(this.marketDataBuffer);
    let writeIndex = 0;
    
    // Circular buffer for market data
    this.on('marketData', (data: MarketDataUpdate) => {
      const offset = (writeIndex % 10000) * 10; // 10 values per update
      
      marketDataView[offset] = Date.now();
      marketDataView[offset + 1] = this.hashSymbol(data.symbol);
      marketDataView[offset + 2] = data.bidPrice || 0;
      marketDataView[offset + 3] = data.bidSize || 0;
      marketDataView[offset + 4] = data.askPrice || 0;
      marketDataView[offset + 5] = data.askSize || 0;
      marketDataView[offset + 6] = data.lastPrice || 0;
      marketDataView[offset + 7] = data.volume || 0;
      marketDataView[offset + 8] = data.sequence || 0;
      marketDataView[offset + 9] = writeIndex;
      
      writeIndex++;
      
      // Notify all strategies of new data
      for (const strategy of this.strategies.values()) {
        strategy.notifyMarketData(writeIndex - 1);
      }
    });
  }
  
  /**
   * Load and start a strategy
   */
  async loadStrategy(config: StrategyConfig): Promise<string> {
    if (this.strategies.size >= this.maxStrategies) {
      throw new Error(`Maximum strategies (${this.maxStrategies}) reached`);
    }
    
    const strategyId = config.id || this.generateStrategyId();
    
    // Create strategy worker
    const worker = new StrategyWorker({
      id: strategyId,
      name: config.name,
      script: config.script,
      parameters: config.parameters,
      marketDataBuffer: this.marketDataBuffer,
      signalBuffer: this.signalBuffer,
      memoryLimit: config.memoryLimit || 256 * 1024 * 1024, // 256MB default
      cpuAffinity: config.cpuAffinity
    });
    
    // Set up event handlers
    this.setupStrategyHandlers(worker);
    
    // Start the strategy
    await worker.start();
    
    this.strategies.set(strategyId, worker);
    this.activeStrategies++;
    
    this.emit('strategyLoaded', { strategyId, name: config.name });
    
    return strategyId;
  }
  
  /**
   * Load multiple strategies concurrently
   */
  async loadStrategies(configs: StrategyConfig[]): Promise<string[]> {
    const loadPromises = configs.map(config => this.loadStrategy(config));
    return Promise.all(loadPromises);
  }
  
  private setupStrategyHandlers(worker: StrategyWorker): void {
    worker.on('signal', (signal: TradingSignal) => {
      this.totalSignals++;
      this.emit('signal', signal);
      this.performanceMonitor.recordSignal(signal);
    });
    
    worker.on('error', (error: Error) => {
      this.emit('strategyError', {
        strategyId: worker.id,
        error
      });
    });
    
    worker.on('performance', (metrics: StrategyMetrics) => {
      this.performanceMonitor.updateMetrics(worker.id, metrics);
    });
    
    worker.on('exit', (code: number) => {
      this.strategies.delete(worker.id);
      this.activeStrategies--;
      this.emit('strategyExit', {
        strategyId: worker.id,
        code
      });
    });
  }
  
  /**
   * Stop a strategy
   */
  async stopStrategy(strategyId: string): Promise<void> {
    const worker = this.strategies.get(strategyId);
    if (!worker) {
      throw new Error(`Strategy ${strategyId} not found`);
    }
    
    await worker.stop();
    this.strategies.delete(strategyId);
    this.activeStrategies--;
    
    this.emit('strategyStopped', { strategyId });
  }
  
  /**
   * Stop all strategies
   */
  async stopAll(): Promise<void> {
    const stopPromises = Array.from(this.strategies.keys()).map(id => 
      this.stopStrategy(id)
    );
    await Promise.all(stopPromises);
  }
  
  /**
   * Update strategy parameters
   */
  async updateParameters(strategyId: string, parameters: any): Promise<void> {
    const worker = this.strategies.get(strategyId);
    if (!worker) {
      throw new Error(`Strategy ${strategyId} not found`);
    }
    
    await worker.updateParameters(parameters);
  }
  
  /**
   * Get strategy performance metrics
   */
  getPerformance(strategyId?: string): any {
    if (strategyId) {
      return this.performanceMonitor.getStrategyMetrics(strategyId);
    }
    return this.performanceMonitor.getAllMetrics();
  }
  
  /**
   * Get executor statistics
   */
  getStats(): ExecutorStats {
    const strategyStats = Array.from(this.strategies.values()).map(s => s.getStats());
    
    return {
      activeStrategies: this.activeStrategies,
      maxStrategies: this.maxStrategies,
      totalSignals: this.totalSignals,
      strategyStats,
      performance: this.performanceMonitor.getSummary(),
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage()
    };
  }
  
  private hashSymbol(symbol: string): number {
    let hash = 0;
    for (let i = 0; i < symbol.length; i++) {
      hash = ((hash << 5) - hash) + symbol.charCodeAt(i);
      hash = hash & hash;
    }
    return hash;
  }
  
  private generateStrategyId(): string {
    return `strategy-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

/**
 * Individual strategy worker
 */
class StrategyWorker extends EventEmitter {
  public readonly id: string;
  private name: string;
  private worker: Worker;
  private marketDataBuffer: SharedArrayBuffer;
  private signalBuffer: SharedArrayBuffer;
  private lastMarketDataIndex: number = -1;
  private signalsGenerated: number = 0;
  private startTime: number = Date.now();
  
  constructor(options: StrategyWorkerOptions) {
    super();
    
    this.id = options.id;
    this.name = options.name;
    this.marketDataBuffer = options.marketDataBuffer;
    this.signalBuffer = options.signalBuffer;
    
    // Create worker with resource limits
    this.worker = new Worker(options.script, {
      workerData: {
        strategyId: this.id,
        strategyName: this.name,
        parameters: options.parameters,
        marketDataBuffer: this.marketDataBuffer,
        signalBuffer: this.signalBuffer,
        memoryLimit: options.memoryLimit
      },
      resourceLimits: {
        maxOldGenerationSizeMb: Math.floor(options.memoryLimit / 1024 / 1024),
        maxYoungGenerationSizeMb: 64,
        codeRangeSizeMb: 16
      }
    });
    
    this.setupHandlers();
  }
  
  private setupHandlers(): void {
    this.worker.on('message', (msg: WorkerMessage) => {
      switch (msg.type) {
        case 'signal':
          this.signalsGenerated++;
          this.emit('signal', msg.signal);
          break;
          
        case 'performance':
          this.emit('performance', msg.metrics);
          break;
          
        case 'error':
          this.emit('error', msg.error);
          break;
          
        case 'ready':
          this.emit('ready');
          break;
      }
    });
    
    this.worker.on('error', (error) => {
      this.emit('error', error);
    });
    
    this.worker.on('exit', (code) => {
      this.emit('exit', code);
    });
  }
  
  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.once('ready', resolve);
      this.worker.postMessage({ type: 'start' });
    });
  }
  
  async stop(): Promise<void> {
    await this.worker.terminate();
  }
  
  notifyMarketData(index: number): void {
    if (index > this.lastMarketDataIndex) {
      this.lastMarketDataIndex = index;
      this.worker.postMessage({ type: 'marketData', index });
    }
  }
  
  async updateParameters(parameters: any): Promise<void> {
    this.worker.postMessage({ type: 'updateParameters', parameters });
  }
  
  getStats(): StrategyStats {
    const uptime = Date.now() - this.startTime;
    return {
      id: this.id,
      name: this.name,
      signalsGenerated: this.signalsGenerated,
      uptime,
      signalsPerSecond: this.signalsGenerated / (uptime / 1000)
    };
  }
}

/**
 * Performance monitoring for strategies
 */
class PerformanceMonitor {
  private metrics: Map<string, StrategyMetrics> = new Map();
  private signalHistory: TradingSignal[] = [];
  private maxHistorySize: number = 10000;
  
  recordSignal(signal: TradingSignal): void {
    this.signalHistory.push(signal);
    if (this.signalHistory.length > this.maxHistorySize) {
      this.signalHistory.shift();
    }
    
    // Update strategy metrics
    let metrics = this.metrics.get(signal.strategyId);
    if (!metrics) {
      metrics = this.createEmptyMetrics(signal.strategyId);
      this.metrics.set(signal.strategyId, metrics);
    }
    
    metrics.totalSignals++;
    metrics.lastSignalTime = Date.now();
    
    // Track signal distribution
    if (signal.action === 'BUY') metrics.buySignals++;
    else if (signal.action === 'SELL') metrics.sellSignals++;
    else metrics.holdSignals++;
    
    // Update confidence stats
    metrics.avgConfidence = (metrics.avgConfidence * (metrics.totalSignals - 1) + signal.confidence) / metrics.totalSignals;
    metrics.minConfidence = Math.min(metrics.minConfidence, signal.confidence);
    metrics.maxConfidence = Math.max(metrics.maxConfidence, signal.confidence);
  }
  
  updateMetrics(strategyId: string, metrics: Partial<StrategyMetrics>): void {
    const existing = this.metrics.get(strategyId) || this.createEmptyMetrics(strategyId);
    Object.assign(existing, metrics);
    this.metrics.set(strategyId, existing);
  }
  
  getStrategyMetrics(strategyId: string): StrategyMetrics | null {
    return this.metrics.get(strategyId) || null;
  }
  
  getAllMetrics(): Map<string, StrategyMetrics> {
    return new Map(this.metrics);
  }
  
  getSummary(): PerformanceSummary {
    const strategies = Array.from(this.metrics.values());
    const totalSignals = strategies.reduce((sum, s) => sum + s.totalSignals, 0);
    const avgConfidence = strategies.reduce((sum, s) => sum + s.avgConfidence, 0) / strategies.length || 0;
    
    return {
      totalStrategies: strategies.length,
      totalSignals,
      avgConfidence,
      signalRate: this.calculateSignalRate(),
      topPerformers: this.getTopPerformers(5)
    };
  }
  
  private createEmptyMetrics(strategyId: string): StrategyMetrics {
    return {
      strategyId,
      totalSignals: 0,
      buySignals: 0,
      sellSignals: 0,
      holdSignals: 0,
      avgConfidence: 0,
      minConfidence: 1,
      maxConfidence: 0,
      lastSignalTime: 0,
      cpuUsage: 0,
      memoryUsage: 0
    };
  }
  
  private calculateSignalRate(): number {
    if (this.signalHistory.length < 2) return 0;
    
    const timeRange = this.signalHistory[this.signalHistory.length - 1].timestamp - 
                     this.signalHistory[0].timestamp;
    return this.signalHistory.length / (timeRange / 1000);
  }
  
  private getTopPerformers(count: number): string[] {
    return Array.from(this.metrics.entries())
      .sort((a, b) => b[1].totalSignals - a[1].totalSignals)
      .slice(0, count)
      .map(([id]) => id);
  }
}

// Types
export interface ExecutorOptions {
  maxStrategies?: number;
  marketDataSize?: number;
  signalBufferSize?: number;
}

const logger = new Logger('StrategyExecutor');
export interface StrategyConfig {
  id?: string;
  name: string;
  script: string;
  parameters?: any;
  memoryLimit?: number;
  cpuAffinity?: number;
}

export interface StrategyWorkerOptions {
  id: string;
  name: string;
  script: string;
  parameters?: any;
  marketDataBuffer: SharedArrayBuffer;
  signalBuffer: SharedArrayBuffer;
  memoryLimit: number;
  cpuAffinity?: number;
}

export interface TradingSignal {
  strategyId: string;
  symbol: string;
  action: 'BUY' | 'SELL' | 'HOLD';
  quantity: number;
  confidence: number;
  timestamp: number;
  metadata?: any;
}

export interface StrategyMetrics {
  strategyId: string;
  totalSignals: number;
  buySignals: number;
  sellSignals: number;
  holdSignals: number;
  avgConfidence: number;
  minConfidence: number;
  maxConfidence: number;
  lastSignalTime: number;
  cpuUsage: number;
  memoryUsage: number;
}

export interface StrategyStats {
  id: string;
  name: string;
  signalsGenerated: number;
  uptime: number;
  signalsPerSecond: number;
}

export interface ExecutorStats {
  activeStrategies: number;
  maxStrategies: number;
  totalSignals: number;
  strategyStats: StrategyStats[];
  performance: PerformanceSummary;
  memoryUsage: NodeJS.MemoryUsage;
  cpuUsage: NodeJS.CpuUsage;
}

export interface PerformanceSummary {
  totalStrategies: number;
  totalSignals: number;
  avgConfidence: number;
  signalRate: number;
  topPerformers: string[];
}

export interface WorkerMessage {
  type: string;
  signal?: TradingSignal;
  metrics?: StrategyMetrics;
  error?: Error;
  index?: number;
  parameters?: any;
}

/**
 * Benchmark for concurrent strategy executor
 */
export class StrategyExecutorBenchmark {
  static async runBenchmark(): Promise<void> {
    logger.info('\n🚀 Concurrent Strategy Executor Benchmark');
    logger.info('Target: 100+ concurrent strategies\n');
    
    const executor = new StrategyExecutor({
      maxStrategies: 128,
      marketDataSize: 100 * 1024 * 1024 // 100MB
    });
    
    // Create sample strategy script
    const strategyScript = `
      const { parentPort, workerData } = require('worker_threads');
      
      const { strategyId, parameters, marketDataBuffer } = workerData;
      const marketData = new Float64Array(marketDataBuffer);
      
      let lastIndex = -1;
      let signalCount = 0;
      
      parentPort.on('message', (msg) => {
        if (msg.type === 'start') {
          parentPort.postMessage({ type: 'ready' });
        } else if (msg.type === 'marketData') {
          // Process new market data
          const index = msg.index;
          if (index > lastIndex) {
            lastIndex = index;
            
            const offset = (index % 10000) * 10;
            const price = marketData[offset + 6]; // lastPrice
            
            // Simple strategy logic
            if (Math.random() > 0.95) {
              const signal = {
                strategyId,
                symbol: 'TEST',
                action: Math.random() > 0.5 ? 'BUY' : 'SELL',
                quantity: Math.floor(Math.random() * 100) + 1,
                confidence: Math.random(),
                timestamp: Date.now()
              };
              
              parentPort.postMessage({ type: 'signal', signal });
              signalCount++;
              
              // Report performance every 100 signals
              if (signalCount % 100 === 0) {
                parentPort.postMessage({
                  type: 'performance',
                  metrics: {
                    strategyId,
                    totalSignals: signalCount,
                    cpuUsage: process.cpuUsage().user,
                    memoryUsage: process.memoryUsage().heapUsed
                  }
                });
              }
            }
          }
        }
      });
    `;
    
    // Write strategy script to temp file
    const fs = require('fs');
    const path = require('path');
    const tmpDir = os.tmpdir();
    const scriptPath = path.join(tmpDir, 'test-strategy.js');
    fs.writeFileSync(scriptPath, strategyScript);
    
    // Load strategies
    logger.info('Loading strategies...');
    const numStrategies = 100;
    const strategies: StrategyConfig[] = [];
    
    for (let i = 0; i < numStrategies; i++) {
      strategies.push({
        id: `strategy-${i}`,
        name: `Test Strategy ${i}`,
        script: scriptPath,
        parameters: {
          threshold: Math.random() * 0.1,
          lookback: Math.floor(Math.random() * 100) + 10
        },
        memoryLimit: 128 * 1024 * 1024 // 128MB per strategy
      });
    }
    
    const loadStart = process.hrtime.bigint();
    const strategyIds = await executor.loadStrategies(strategies);
    const loadEnd = process.hrtime.bigint();
    const loadTime = Number(loadEnd - loadStart) / 1_000_000;
    
    logger.info(`✅ Loaded ${strategyIds.length} strategies in ${loadTime.toFixed(2)}ms`);
    logger.info(`   Average load time: ${(loadTime / numStrategies).toFixed(2)}ms per strategy`);
    
    // Simulate market data
    logger.info('\nSimulating market data stream...');
    let marketDataCount = 0;
    let signalCount = 0;
    
    executor.on('signal', (signal) => {
      signalCount++;
    });
    
    const marketDataInterval = setInterval(() => {
      executor.emit('marketData', {
        symbol: 'TEST',
        bidPrice: 100 + Math.random() * 10,
        askPrice: 100 + Math.random() * 10,
        lastPrice: 100 + Math.random() * 10,
        volume: Math.random() * 1000
      });
      marketDataCount++;
    }, 10); // 100 updates/second
    
    // Run for 10 seconds
    await new Promise(resolve => setTimeout(resolve, 10000));
    clearInterval(marketDataInterval);
    
    // Get final statistics
    const stats = executor.getStats();
    
    logger.info('\n📊 Results:');
    logger.info(`  Active Strategies: ${stats.activeStrategies}`);
    logger.info(`  Market Data Updates: ${marketDataCount.toLocaleString()}`);
    logger.info(`  Total Signals: ${signalCount.toLocaleString()}`);
    logger.info(`  Signals/Second: ${(signalCount / 10).toFixed(2)}`);
    logger.info(`  Memory Usage: ${(stats.memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`);
    logger.info(`  CPU Usage: ${JSON.stringify(stats.cpuUsage)}`);
    
    logger.info('\nTop 5 Performers:');
    stats.performance.topPerformers.forEach((id, i) => {
      const metrics = executor.getPerformance(id);
      logger.info(`  ${i + 1}. ${id}: ${metrics.totalSignals} signals`);
    });
    
    // Cleanup
    await executor.stopAll();
    fs.unlinkSync(scriptPath);
    
    logger.info('\n📊 Performance Summary:');
    logger.info(`  Strategies/Core: ${(numStrategies / os.cpus().length).toFixed(1)}`);
    logger.info(`  Total Memory/Strategy: ${(stats.memoryUsage.heapUsed / numStrategies / 1024 / 1024).toFixed(2)} MB`);
    logger.info(`  Signal Generation Rate: ${stats.performance.signalRate.toFixed(2)} signals/sec`);
    
    if (stats.activeStrategies >= 100) {
      logger.info('\n✅ SUCCESS: Running 100+ concurrent strategies!');
    } else {
      logger.info(`\n⚠️  Only ${stats.activeStrategies} strategies running`);
    }
  }
}

// Export for use in other modules
export default StrategyExecutor; 