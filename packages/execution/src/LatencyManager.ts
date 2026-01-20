import {
  ExecutionRoute,
  Exchange,
  RateLimit,
  ExecutionUrgency
} from '@noderr/types/src';
import { Logger } from 'winston';
import EventEmitter from 'events';

interface LatencyMetrics {
  exchange: string;
  averageLatency: number;
  minLatency: number;
  maxLatency: number;
  p50: number;
  p95: number;
  p99: number;
  successRate: number;
  samples: number;
  lastUpdate: number;
}

interface NetworkRoute {
  exchange: string;
  endpoint: string;
  region: string;
  latency: number;
  reliability: number;
  priority: number;
}

interface LatencyOptimizationResult {
  routes: ExecutionRoute[];
  expectedLatency: number;
  improvements: LatencyImprovement[];
}

interface LatencyImprovement {
  exchange: string;
  originalLatency: number;
  optimizedLatency: number;
  improvement: number;
  method: string;
}

export class LatencyManager extends EventEmitter {
  private logger: Logger;
  private metricsCache: Map<string, LatencyMetrics>;
  private networkRoutes: Map<string, NetworkRoute[]>;
  private rateLimits: Map<string, RateLimit>;
  private pingInterval?: NodeJS.Timeout;

  constructor(logger: Logger) {
    super();
    this.logger = logger;
    this.metricsCache = new Map();
    this.networkRoutes = new Map();
    this.rateLimits = new Map();
    
    // Initialize with default routes
    this.initializeNetworkRoutes();
    
    // Start latency monitoring
    this.startLatencyMonitoring();
  }

  /**
   * Optimize routes for minimum latency
   */
  async optimizeForLatency(
    routes: ExecutionRoute[]
  ): Promise<ExecutionRoute[]> {
    this.logger.debug('Optimizing routes for latency');
    
    const optimized: ExecutionRoute[] = [];
    
    for (const route of routes) {
      const optimalRoute = await this.findOptimalNetworkRoute(route);
      
      optimized.push({
        ...route,
        latency: optimalRoute.latency,
        priority: this.calculateLatencyPriority(optimalRoute.latency)
      });
    }
    
    // Sort by latency for parallel execution ordering
    return optimized.sort((a, b) => a.latency - b.latency);
  }

  /**
   * Measure real-time latency to exchanges
   */
  async measureLatency(exchange: string): Promise<number> {
    const start = Date.now();
    
    try {
      // Simulate API ping - in production, use actual endpoint
      await this.pingExchange(exchange);
      
      const latency = Date.now() - start;
      this.updateLatencyMetrics(exchange, latency, true);
      
      return latency;
    } catch (error) {
      this.logger.error(`Latency measurement failed for ${exchange}`, error);
      this.updateLatencyMetrics(exchange, -1, false);
      return 999999; // High penalty for failed connections
    }
  }

  /**
   * Get latency statistics for an exchange
   */
  getLatencyStats(exchange: string): LatencyMetrics | null {
    return this.metricsCache.get(exchange) || null;
  }

  /**
   * Predict latency based on historical data
   */
  predictLatency(
    exchange: string,
    timeOfDay?: number
  ): number {
    const metrics = this.metricsCache.get(exchange);
    
    if (!metrics) {
      return 100; // Default 100ms
    }
    
    // Simple prediction - could use ML model in production
    if (timeOfDay !== undefined) {
      // Adjust for time of day patterns
      const hour = new Date(timeOfDay).getHours();
      const peakHours = hour >= 9 && hour <= 17;
      
      return peakHours 
        ? metrics.p95 
        : metrics.averageLatency;
    }
    
    return metrics.averageLatency;
  }

  /**
   * Optimize network path selection
   */
  async selectOptimalPath(
    exchange: string,
    urgency: ExecutionUrgency
  ): Promise<NetworkRoute> {
    const routes = this.networkRoutes.get(exchange) || [];
    
    if (routes.length === 0) {
      return this.createDefaultRoute(exchange);
    }
    
    // Sort by optimization criteria
    const sorted = [...routes].sort((a, b) => {
      if (urgency === ExecutionUrgency.CRITICAL) {
        // Prioritize lowest latency
        return a.latency - b.latency;
      } else {
        // Balance latency and reliability
        const scoreA = a.latency * (2 - a.reliability);
        const scoreB = b.latency * (2 - b.reliability);
        return scoreA - scoreB;
      }
    });
    
    return sorted[0];
  }

  /**
   * Check rate limits and adjust routing
   */
  checkRateLimits(exchange: string): boolean {
    const limit = this.rateLimits.get(exchange);
    
    if (!limit) {
      return true; // No limit configured
    }
    
    const now = Date.now();
    
    // Reset if period elapsed
    if (limit.reset && now >= limit.reset) {
      limit.remaining = limit.requests;
      limit.reset = now + limit.period * 1000;
    }
    
    if (limit.remaining && limit.remaining > 0) {
      limit.remaining--;
      return true;
    }
    
    return false;
  }

  /**
   * Batch optimize multiple routes
   */
  async batchOptimize(
    routes: ExecutionRoute[],
    maxParallel: number = 5
  ): Promise<LatencyOptimizationResult> {
    const optimized: ExecutionRoute[] = [];
    const improvements: LatencyImprovement[] = [];
    
    // Group by exchange
    const byExchange = new Map<string, ExecutionRoute[]>();
    
    for (const route of routes) {
      const existing = byExchange.get(route.exchange) || [];
      existing.push(route);
      byExchange.set(route.exchange, existing);
    }
    
    // Optimize each exchange group
    for (const [exchange, exchangeRoutes] of byExchange) {
      const optimalPath = await this.selectOptimalPath(
        exchange,
        ExecutionUrgency.HIGH
      );
      
      for (const route of exchangeRoutes) {
        const originalLatency = route.latency;
        const optimizedLatency = optimalPath.latency;
        
        optimized.push({
          ...route,
          latency: optimizedLatency
        });
        
        improvements.push({
          exchange,
          originalLatency,
          optimizedLatency,
          improvement: originalLatency - optimizedLatency,
          method: 'optimal_path_selection'
        });
      }
    }
    
    // Calculate expected latency
    const expectedLatency = Math.max(...optimized.map(r => r.latency));
    
    return {
      routes: optimized,
      expectedLatency,
      improvements
    };
  }

  // Private methods

  private initializeNetworkRoutes(): void {
    // Mock network routes - in production, use actual endpoints
    const exchanges = ['binance', 'coinbase', 'kraken'];
    
    for (const exchange of exchanges) {
      this.networkRoutes.set(exchange, [
        {
          exchange,
          endpoint: `https://api.${exchange}.com`,
          region: 'us-east-1',
          latency: 20,
          reliability: 0.99,
          priority: 1
        },
        {
          exchange,
          endpoint: `https://api-eu.${exchange}.com`,
          region: 'eu-west-1',
          latency: 50,
          reliability: 0.98,
          priority: 2
        },
        {
          exchange,
          endpoint: `https://api-asia.${exchange}.com`,
          region: 'ap-southeast-1',
          latency: 100,
          reliability: 0.97,
          priority: 3
        }
      ]);
    }
  }

  private startLatencyMonitoring(): void {
    // Periodic latency checks
    this.pingInterval = setInterval(async () => {
      for (const exchange of this.networkRoutes.keys()) {
        await this.measureLatency(exchange);
      }
    }, 30000); // Every 30 seconds
    
    // Initial measurement
    this.performInitialMeasurements();
  }

  private async performInitialMeasurements(): Promise<void> {
    const exchanges = Array.from(this.networkRoutes.keys());
    
    await Promise.all(
      exchanges.map(exchange => this.measureLatency(exchange))
    );
  }

  private async pingExchange(exchange: string): Promise<void> {
    // Mock ping - in production, use actual health endpoint
    const delay = 10 + Math.random() * 90; // 10-100ms
    
    await new Promise((resolve, reject) => {
      setTimeout(() => {
        if (Math.random() > 0.95) {
          reject(new Error('Connection timeout'));
        } else {
          resolve(undefined);
        }
      }, delay);
    });
  }

  private updateLatencyMetrics(
    exchange: string,
    latency: number,
    success: boolean
  ): void {
    let metrics = this.metricsCache.get(exchange);
    
    if (!metrics) {
      metrics = {
        exchange,
        averageLatency: latency,
        minLatency: latency,
        maxLatency: latency,
        p50: latency,
        p95: latency,
        p99: latency,
        successRate: success ? 1 : 0,
        samples: 1,
        lastUpdate: Date.now()
      };
    } else {
      // Update metrics with exponential moving average
      const alpha = 0.1;
      
      if (success) {
        metrics.averageLatency = alpha * latency + (1 - alpha) * metrics.averageLatency;
        metrics.minLatency = Math.min(metrics.minLatency, latency);
        metrics.maxLatency = Math.max(metrics.maxLatency, latency);
        
        // Simplified percentile tracking
        metrics.p50 = metrics.averageLatency;
        metrics.p95 = metrics.averageLatency + (metrics.maxLatency - metrics.averageLatency) * 0.5;
        metrics.p99 = metrics.averageLatency + (metrics.maxLatency - metrics.averageLatency) * 0.9;
      }
      
      metrics.successRate = alpha * (success ? 1 : 0) + (1 - alpha) * metrics.successRate;
      metrics.samples++;
      metrics.lastUpdate = Date.now();
    }
    
    this.metricsCache.set(exchange, metrics);
    
    // Emit metrics update
    this.emit('latencyUpdate', metrics);
  }

  private async findOptimalNetworkRoute(
    route: ExecutionRoute
  ): Promise<ExecutionRoute> {
    const networkRoutes = this.networkRoutes.get(route.exchange) || [];
    
    if (networkRoutes.length === 0) {
      return route;
    }
    
    // Test current latency to each route
    const latencyTests = await Promise.all(
      networkRoutes.map(async (netRoute) => {
        try {
          const start = Date.now();
          await this.testEndpoint(netRoute.endpoint);
          const latency = Date.now() - start;
          
          return {
            ...netRoute,
            latency
          };
        } catch {
          return {
            ...netRoute,
            latency: 999999
          };
        }
      })
    );
    
    // Select best route
    const best = latencyTests.sort((a, b) => a.latency - b.latency)[0];
    
    return {
      ...route,
      latency: best.latency
    };
  }

  private async testEndpoint(endpoint: string): Promise<void> {
    // Mock endpoint test
    const delay = 10 + Math.random() * 50;
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  private calculateLatencyPriority(latency: number): number {
    // Convert latency to priority score (0-100)
    if (latency < 10) return 100;
    if (latency < 50) return 90;
    if (latency < 100) return 70;
    if (latency < 200) return 50;
    if (latency < 500) return 30;
    return 10;
  }

  private createDefaultRoute(exchange: string): NetworkRoute {
    return {
      exchange,
      endpoint: `https://api.${exchange}.com`,
      region: 'default',
      latency: 100,
      reliability: 0.95,
      priority: 50
    };
  }

  /**
   * Update rate limits for an exchange
   */
  updateRateLimit(exchange: string, limit: RateLimit): void {
    this.rateLimits.set(exchange, {
      ...limit,
      remaining: limit.remaining || limit.requests,
      reset: limit.reset || Date.now() + limit.period * 1000
    });
  }

  /**
   * Get network diagnostics
   */
  getNetworkDiagnostics(): {
    exchanges: Map<string, LatencyMetrics>;
    routes: Map<string, NetworkRoute[]>;
    issues: NetworkIssue[];
  } {
    const issues: NetworkIssue[] = [];
    
    // Check for high latency
    for (const [exchange, metrics] of this.metricsCache) {
      if (metrics.averageLatency > 200) {
        issues.push({
          exchange,
          type: 'high_latency',
          severity: 'warning',
          message: `High average latency: ${metrics.averageLatency}ms`
        });
      }
      
      if (metrics.successRate < 0.95) {
        issues.push({
          exchange,
          type: 'low_reliability',
          severity: 'error',
          message: `Low success rate: ${(metrics.successRate * 100).toFixed(1)}%`
        });
      }
    }
    
    return {
      exchanges: this.metricsCache,
      routes: this.networkRoutes,
      issues
    };
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = undefined;
    }
    
    this.removeAllListeners();
  }
}

interface NetworkIssue {
  exchange: string;
  type: 'high_latency' | 'low_reliability' | 'rate_limited';
  severity: 'warning' | 'error';
  message: string;
} 