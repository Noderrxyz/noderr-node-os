import { Logger } from '@noderr/utils';
import * as winston from 'winston';

const logger = new Logger('LazyRiskMetrics');
export interface Position {
  symbol: string;
  quantity: number;
  avgPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
}

export interface RiskMetrics {
  totalExposure: number;
  var95: number;
  var99: number;
  sharpeRatio: number;
  maxDrawdown: number;
  beta: number;
  correlation: number;
}

export interface LazyMetric<T> {
  isDirty: boolean;
  value: T | null;
  lastComputed: number;
  computeTime: number;
}

/**
 * Lazy evaluation system for risk metrics
 * Only computes metrics when accessed and data has changed
 * Target: -2ms per risk check
 */
export class LazyRiskMetrics {
  private logger: winston.Logger;
  private positions: Map<string, Position> = new Map();
  private marketData: Map<string, number> = new Map();
  
  // Lazy computed metrics
  private metrics: {
    totalExposure: LazyMetric<number>;
    var95: LazyMetric<number>;
    var99: LazyMetric<number>;
    sharpeRatio: LazyMetric<number>;
    maxDrawdown: LazyMetric<number>;
    beta: LazyMetric<number>;
    correlation: LazyMetric<number>;
  };
  
  // Dependency tracking
  private positionsVersion: number = 0;
  private marketDataVersion: number = 0;
  private lastComputedVersions: Map<string, number> = new Map();
  
  // Performance tracking
  private computeCount: number = 0;
  private cacheHits: number = 0;
  private totalComputeTime: number = 0;
  
  constructor(logger: winston.Logger) {
    this.logger = logger;
    
    // Initialize lazy metrics
    this.metrics = {
      totalExposure: this.createLazyMetric(),
      var95: this.createLazyMetric(),
      var99: this.createLazyMetric(),
      sharpeRatio: this.createLazyMetric(),
      maxDrawdown: this.createLazyMetric(),
      beta: this.createLazyMetric(),
      correlation: this.createLazyMetric()
    };
  }
  
  /**
   * Update position data
   */
  updatePosition(symbol: string, position: Position): void {
    this.positions.set(symbol, position);
    this.positionsVersion++;
    this.invalidateMetrics();
  }
  
  /**
   * Update market data
   */
  updateMarketData(symbol: string, price: number): void {
    this.marketData.set(symbol, price);
    this.marketDataVersion++;
    // Only invalidate metrics that depend on market data
    this.invalidateMarketDependentMetrics();
  }
  
  /**
   * Get total exposure (lazy computed)
   */
  getTotalExposure(): number {
    return this.getOrCompute('totalExposure', () => {
      let exposure = 0;
      for (const [symbol, position] of this.positions) {
        const price = this.marketData.get(symbol) || position.currentPrice;
        exposure += Math.abs(position.quantity * price);
      }
      return exposure;
    });
  }
  
  /**
   * Get VaR 95% (lazy computed)
   */
  getVaR95(): number {
    return this.getOrCompute('var95', () => {
      // Simplified VaR calculation
      const returns = this.calculateReturns();
      if (returns.length === 0) return 0;
      
      returns.sort((a, b) => a - b);
      const index = Math.floor(returns.length * 0.05);
      return -returns[index] * this.getTotalExposure();
    });
  }
  
  /**
   * Get VaR 99% (lazy computed)
   */
  getVaR99(): number {
    return this.getOrCompute('var99', () => {
      const returns = this.calculateReturns();
      if (returns.length === 0) return 0;
      
      returns.sort((a, b) => a - b);
      const index = Math.floor(returns.length * 0.01);
      return -returns[index] * this.getTotalExposure();
    });
  }
  
  /**
   * Get Sharpe ratio (lazy computed)
   */
  getSharpeRatio(): number {
    return this.getOrCompute('sharpeRatio', () => {
      const returns = this.calculateReturns();
      if (returns.length === 0) return 0;
      
      const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
      const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
      const stdDev = Math.sqrt(variance);
      
      const riskFreeRate = 0.02 / 252; // 2% annual, daily
      return stdDev === 0 ? 0 : (avgReturn - riskFreeRate) / stdDev * Math.sqrt(252);
    });
  }
  
  /**
   * Get max drawdown (lazy computed)
   */
  getMaxDrawdown(): number {
    return this.getOrCompute('maxDrawdown', () => {
      const values = this.calculatePortfolioValues();
      if (values.length === 0) return 0;
      
      let maxDrawdown = 0;
      let peak = values[0];
      
      for (const value of values) {
        if (value > peak) {
          peak = value;
        }
        const drawdown = (peak - value) / peak;
        if (drawdown > maxDrawdown) {
          maxDrawdown = drawdown;
        }
      }
      
      return maxDrawdown;
    });
  }
  
  /**
   * Get all metrics at once
   */
  getAllMetrics(): RiskMetrics {
    return {
      totalExposure: this.getTotalExposure(),
      var95: this.getVaR95(),
      var99: this.getVaR99(),
      sharpeRatio: this.getSharpeRatio(),
      maxDrawdown: this.getMaxDrawdown(),
      beta: this.getBeta(),
      correlation: this.getCorrelation()
    };
  }
  
  /**
   * Get beta (lazy computed)
   */
  private getBeta(): number {
    return this.getOrCompute('beta', () => {
      // Simplified beta calculation
      return 1.0; // Placeholder
    });
  }
  
  /**
   * Get correlation (lazy computed)
   */
  private getCorrelation(): number {
    return this.getOrCompute('correlation', () => {
      // Simplified correlation calculation
      return 0.8; // Placeholder
    });
  }
  
  /**
   * Generic lazy computation
   */
  private getOrCompute<K extends keyof typeof this.metrics>(
    metricName: K,
    computeFn: () => number
  ): number {
    const metric = this.metrics[metricName];
    const currentVersion = this.positionsVersion + this.marketDataVersion;
    const lastVersion = this.lastComputedVersions.get(metricName) || -1;
    
    // Check if cached value is still valid
    if (!metric.isDirty && metric.value !== null && lastVersion === currentVersion) {
      this.cacheHits++;
      return metric.value;
    }
    
    // Compute new value
    const startTime = process.hrtime.bigint();
    const value = computeFn();
    const computeTime = Number(process.hrtime.bigint() - startTime) / 1_000_000; // ms
    
    // Update metric
    metric.value = value;
    metric.isDirty = false;
    metric.lastComputed = Date.now();
    metric.computeTime = computeTime;
    
    // Update tracking
    this.lastComputedVersions.set(metricName, currentVersion);
    this.computeCount++;
    this.totalComputeTime += computeTime;
    
    return value;
  }
  
  /**
   * Create a new lazy metric
   */
  private createLazyMetric<T>(): LazyMetric<T> {
    return {
      isDirty: true,
      value: null,
      lastComputed: 0,
      computeTime: 0
    };
  }
  
  /**
   * Invalidate all metrics
   */
  private invalidateMetrics(): void {
    for (const key in this.metrics) {
      this.metrics[key as keyof typeof this.metrics].isDirty = true;
    }
  }
  
  /**
   * Invalidate only market-dependent metrics
   */
  private invalidateMarketDependentMetrics(): void {
    this.metrics.totalExposure.isDirty = true;
    this.metrics.var95.isDirty = true;
    this.metrics.var99.isDirty = true;
  }
  
  /**
   * Calculate returns (simplified)
   */
  private calculateReturns(): number[] {
    // In production, this would use historical data
    const returns: number[] = [];
    for (let i = 0; i < 252; i++) { // 1 year of daily returns
      returns.push((Math.random() - 0.5) * 0.02); // ±2% daily
    }
    return returns;
  }
  
  /**
   * Calculate portfolio values (simplified)
   */
  private calculatePortfolioValues(): number[] {
    // In production, this would use historical data
    const values: number[] = [];
    let value = this.getTotalExposure();
    
    for (let i = 0; i < 252; i++) {
      value *= (1 + (Math.random() - 0.5) * 0.02);
      values.push(value);
    }
    
    return values;
  }
  
  /**
   * Get performance statistics
   */
  getPerformanceStats(): {
    computeCount: number;
    cacheHits: number;
    cacheHitRate: number;
    avgComputeTime: number;
  } {
    const totalAccesses = this.computeCount + this.cacheHits;
    return {
      computeCount: this.computeCount,
      cacheHits: this.cacheHits,
      cacheHitRate: totalAccesses > 0 ? this.cacheHits / totalAccesses : 0,
      avgComputeTime: this.computeCount > 0 ? this.totalComputeTime / this.computeCount : 0
    };
  }
}

/**
 * Benchmark for lazy risk metrics
 */
export class LazyRiskMetricsBenchmark {
  static async runBenchmark(logger: winston.Logger): Promise<void> {
    logger.info('\n⚡ Lazy Risk Metrics Performance Benchmark');
    logger.info('Target: -2ms per risk check\n');
    
    // Create positions
    const positions: Position[] = [];
    for (let i = 0; i < 100; i++) {
      positions.push({
        symbol: `SYMBOL${i}`,
        quantity: Math.random() * 1000 - 500,
        avgPrice: 100 + Math.random() * 50,
        currentPrice: 100 + Math.random() * 50,
        unrealizedPnl: Math.random() * 1000 - 500
      });
    }
    
    // Test eager computation
    logger.info('📊 Eager computation (always recalculate):');
    const eagerStart = process.hrtime.bigint();
    let eagerSum = 0;
    
    for (let i = 0; i < 1000; i++) {
      // Simulate eager computation
      let exposure = 0;
      for (const position of positions) {
        exposure += Math.abs(position.quantity * position.currentPrice);
      }
      
      // Simulate VaR calculation
      const returns: number[] = [];
      for (let j = 0; j < 252; j++) {
        returns.push((Math.random() - 0.5) * 0.02);
      }
      returns.sort((a, b) => a - b);
      const var95 = -returns[Math.floor(returns.length * 0.05)] * exposure;
      
      eagerSum += exposure + var95;
    }
    
    const eagerTime = Number(process.hrtime.bigint() - eagerStart) / 1_000_000;
    
    // Test lazy computation
    logger.info('\n📊 Lazy computation (cache when possible):');
    const lazyMetrics = new LazyRiskMetrics(logger);
    
    // Initialize positions
    for (const position of positions) {
      lazyMetrics.updatePosition(position.symbol, position);
    }
    
    const lazyStart = process.hrtime.bigint();
    let lazySum = 0;
    
    for (let i = 0; i < 1000; i++) {
      // Only update some positions occasionally
      if (i % 100 === 0) {
        const randomIndex = Math.floor(Math.random() * positions.length);
        positions[randomIndex].currentPrice += Math.random() - 0.5;
        lazyMetrics.updatePosition(positions[randomIndex].symbol, positions[randomIndex]);
      }
      
      // Get metrics (will use cache when possible)
      const exposure = lazyMetrics.getTotalExposure();
      const var95 = lazyMetrics.getVaR95();
      
      lazySum += exposure + var95;
    }
    
    const lazyTime = Number(process.hrtime.bigint() - lazyStart) / 1_000_000;
    
    // Results
    logger.info('\nResults:');
    logger.info(`Eager computation: ${eagerTime.toFixed(2)}ms (${(eagerTime / 1000).toFixed(3)}ms per check)`);
    logger.info(`Lazy computation: ${lazyTime.toFixed(2)}ms (${(lazyTime / 1000).toFixed(3)}ms per check)`);
    
    const improvement = (eagerTime - lazyTime) / 1000;
    logger.info(`\n🎯 Improvement: ${improvement.toFixed(3)}ms per check`);
    
    const stats = lazyMetrics.getPerformanceStats();
    logger.info('\nLazy metrics stats:');
    logger.info(`  Compute count: ${stats.computeCount}`);
    logger.info(`  Cache hits: ${stats.cacheHits}`);
    logger.info(`  Cache hit rate: ${(stats.cacheHitRate * 100).toFixed(1)}%`);
    logger.info(`  Avg compute time: ${stats.avgComputeTime.toFixed(3)}ms`);
    
    if (improvement >= 2) {
      logger.info('\n✅ SUCCESS: Achieved target -2ms improvement!');
    } else {
      logger.info(`\n⚠️  WARNING: Only achieved ${improvement.toFixed(3)}ms improvement (target: 2ms)`);
    }
  }
}

// Run benchmark if executed directly
if (require.main === module) {
  const logger = winston.createLogger({
    level: 'info',
    format: winston.format.simple(),
    transports: [new winston.transports.Console()]
  });
  
  LazyRiskMetricsBenchmark.runBenchmark(logger).catch((err) => logger.error("Unhandled error", err));
} 