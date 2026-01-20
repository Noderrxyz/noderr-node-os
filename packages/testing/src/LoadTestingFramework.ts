import { Logger } from '@noderr/utils/src';
import { EventEmitter } from 'events';
import * as winston from 'winston';
import { performance } from 'perf_hooks';

const logger = new Logger('LoadTestingFramework');
export interface LoadTestConfig {
  name: string;
  duration: number; // seconds
  rampUpTime: number; // seconds
  targetRPS: number; // requests per second
  scenarios: TestScenario[];
  thresholds: PerformanceThresholds;
  dataGenerator: DataGenerator;
}

export interface TestScenario {
  name: string;
  weight: number; // percentage of traffic
  steps: TestStep[];
  thinkTime: number; // milliseconds between steps
}

export interface TestStep {
  action: 'placeOrder' | 'cancelOrder' | 'getPositions' | 'getMarketData' | 'custom';
  params: Record<string, any>;
  validation?: (response: any) => boolean;
}

export interface PerformanceThresholds {
  maxLatencyP95: number;
  maxLatencyP99: number;
  minThroughput: number;
  maxErrorRate: number;
  maxCpuUsage: number;
  maxMemoryUsage: number;
}

export interface DataGenerator {
  generateOrder(): any;
  generateSymbol(): string;
  generatePrice(symbol: string): number;
  generateQuantity(): number;
}

export interface LoadTestResult {
  config: LoadTestConfig;
  startTime: Date;
  endTime: Date;
  duration: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  metrics: PerformanceMetrics;
  violations: ThresholdViolation[];
  summary: TestSummary;
}

export interface PerformanceMetrics {
  throughput: ThroughputMetrics;
  latency: LatencyMetrics;
  errors: ErrorMetrics;
  resources: ResourceMetrics;
  custom: Map<string, number>;
}

export interface ThroughputMetrics {
  avgRPS: number;
  peakRPS: number;
  totalRequests: number;
  requestsPerScenario: Map<string, number>;
}

export interface LatencyMetrics {
  min: number;
  max: number;
  mean: number;
  median: number;
  p90: number;
  p95: number;
  p99: number;
  histogram: number[];
}

export interface ErrorMetrics {
  totalErrors: number;
  errorRate: number;
  errorsByType: Map<string, number>;
  errorsByScenario: Map<string, number>;
}

export interface ResourceMetrics {
  avgCpuUsage: number;
  peakCpuUsage: number;
  avgMemoryUsage: number;
  peakMemoryUsage: number;
  networkIO: {
    bytesIn: number;
    bytesOut: number;
  };
}

export interface ThresholdViolation {
  metric: string;
  threshold: number;
  actual: number;
  timestamp: Date;
  severity: 'warning' | 'critical';
}

export interface TestSummary {
  passed: boolean;
  score: number; // 0-100
  recommendations: string[];
  bottlenecks: string[];
}

export class LoadTestingFramework extends EventEmitter {
  private logger: winston.Logger;
  private config!: LoadTestConfig;
  private virtualUsers: VirtualUser[] = [];
  private metrics: MetricsCollector;
  private isRunning: boolean = false;
  private startTime!: Date;
  private stopRequested: boolean = false;
  
  constructor(logger: winston.Logger) {
    super();
    this.logger = logger;
    this.metrics = new MetricsCollector();
  }
  
  async runTest(config: LoadTestConfig, target: any): Promise<LoadTestResult> {
    this.config = config;
    this.startTime = new Date();
    this.isRunning = true;
    this.stopRequested = false;
    
    this.logger.info('Starting load test', {
      name: config.name,
      duration: config.duration,
      targetRPS: config.targetRPS
    });
    
    try {
      // Initialize metrics collection
      this.metrics.reset();
      this.startResourceMonitoring();
      
      // Ramp up virtual users
      await this.rampUp(target);
      
      // Run test for specified duration
      const testPromise = this.runTestDuration();
      
      // Wait for test completion or timeout
      await Promise.race([
        testPromise,
        new Promise(resolve => setTimeout(resolve, (config.duration + 10) * 1000))
      ]);
      
      // Ramp down
      await this.rampDown();
      
      // Collect final metrics
      const result = this.generateResult();
      
      this.logger.info('Load test completed', {
        name: config.name,
        passed: result.summary.passed,
        score: result.summary.score
      });
      
      return result;
      
    } finally {
      this.isRunning = false;
      this.stopResourceMonitoring();
    }
  }
  
  stop(): void {
    this.logger.info('Stopping load test');
    this.stopRequested = true;
  }
  
  private async rampUp(target: any): Promise<void> {
    const rampUpSteps = 10;
    const stepDuration = (this.config.rampUpTime * 1000) / rampUpSteps;
    const usersPerStep = Math.ceil(this.config.targetRPS / rampUpSteps);
    
    for (let step = 0; step < rampUpSteps && !this.stopRequested; step++) {
      const usersToAdd = Math.min(usersPerStep, this.config.targetRPS - this.virtualUsers.length);
      
      for (let i = 0; i < usersToAdd; i++) {
        const user = new VirtualUser(
          `user-${this.virtualUsers.length}`,
          this.config,
          target,
          this.metrics
        );
        
        this.virtualUsers.push(user);
        user.start();
      }
      
      this.logger.debug(`Ramp up step ${step + 1}/${rampUpSteps}`, {
        activeUsers: this.virtualUsers.length
      });
      
      await new Promise(resolve => setTimeout(resolve, stepDuration));
    }
  }
  
  private async runTestDuration(): Promise<void> {
    const endTime = Date.now() + (this.config.duration * 1000);
    
    while (Date.now() < endTime && !this.stopRequested) {
      // Emit progress
      const elapsed = (Date.now() - this.startTime.getTime()) / 1000;
      const progress = (elapsed / this.config.duration) * 100;
      
      this.emit('progress', {
        elapsed,
        progress,
        activeUsers: this.virtualUsers.filter(u => u.isActive()).length,
        currentRPS: this.metrics.getCurrentRPS(),
        errors: this.metrics.getErrorCount()
      });
      
      // Check thresholds
      this.checkThresholds();
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  private async rampDown(): Promise<void> {
    this.logger.info('Ramping down virtual users');
    
    // Stop all virtual users
    for (const user of this.virtualUsers) {
      user.stop();
    }
    
    // Wait for users to complete current operations
    const timeout = Date.now() + 10000; // 10 second timeout
    while (this.virtualUsers.some(u => u.isActive()) && Date.now() < timeout) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  private startResourceMonitoring(): void {
    // In production, use actual system metrics
    // For demo, simulate resource usage
    const monitoringInterval = setInterval(() => {
      if (!this.isRunning) {
        clearInterval(monitoringInterval);
        return;
      }
      
      const cpuUsage = 20 + Math.random() * 60; // 20-80%
      const memoryUsage = 30 + Math.random() * 50; // 30-80%
      
      this.metrics.recordResourceUsage({
        cpu: cpuUsage,
        memory: memoryUsage,
        timestamp: Date.now()
      });
    }, 1000);
  }
  
  private stopResourceMonitoring(): void {
    // Cleanup handled by interval
  }
  
  private checkThresholds(): void {
    const currentMetrics = this.metrics.getCurrentMetrics();
    const violations: ThresholdViolation[] = [];
    
    // Check latency thresholds
    if (currentMetrics.latencyP95 > this.config.thresholds.maxLatencyP95) {
      violations.push({
        metric: 'latencyP95',
        threshold: this.config.thresholds.maxLatencyP95,
        actual: currentMetrics.latencyP95,
        timestamp: new Date(),
        severity: 'warning'
      });
    }
    
    if (currentMetrics.latencyP99 > this.config.thresholds.maxLatencyP99) {
      violations.push({
        metric: 'latencyP99',
        threshold: this.config.thresholds.maxLatencyP99,
        actual: currentMetrics.latencyP99,
        timestamp: new Date(),
        severity: 'critical'
      });
    }
    
    // Check error rate
    if (currentMetrics.errorRate > this.config.thresholds.maxErrorRate) {
      violations.push({
        metric: 'errorRate',
        threshold: this.config.thresholds.maxErrorRate,
        actual: currentMetrics.errorRate,
        timestamp: new Date(),
        severity: 'critical'
      });
    }
    
    // Emit violations
    for (const violation of violations) {
      this.logger.warn('Threshold violation', violation);
      this.emit('threshold-violation', violation);
      this.metrics.recordViolation(violation);
    }
  }
  
  private generateResult(): LoadTestResult {
    const endTime = new Date();
    const duration = (endTime.getTime() - this.startTime.getTime()) / 1000;
    const metrics = this.metrics.getAggregatedMetrics();
    const violations = this.metrics.getViolations();
    
    const summary = this.generateSummary(metrics, violations);
    
    return {
      config: this.config,
      startTime: this.startTime,
      endTime,
      duration,
      totalRequests: metrics.throughput.totalRequests,
      successfulRequests: metrics.throughput.totalRequests - metrics.errors.totalErrors,
      failedRequests: metrics.errors.totalErrors,
      metrics,
      violations,
      summary
    };
  }
  
  private generateSummary(metrics: PerformanceMetrics, violations: ThresholdViolation[]): TestSummary {
    const score = this.calculateScore(metrics, violations);
    const passed = violations.filter(v => v.severity === 'critical').length === 0 && score >= 70;
    
    const recommendations: string[] = [];
    const bottlenecks: string[] = [];
    
    // Analyze results and generate recommendations
    if (metrics.latency.p95 > this.config.thresholds.maxLatencyP95 * 0.8) {
      recommendations.push('Consider optimizing request processing to reduce latency');
      bottlenecks.push('High latency detected in 95th percentile');
    }
    
    if (metrics.errors.errorRate > 0.01) {
      recommendations.push('Investigate and fix errors to improve reliability');
      bottlenecks.push(`Error rate of ${(metrics.errors.errorRate * 100).toFixed(2)}% is concerning`);
    }
    
    if (metrics.resources.peakCpuUsage > 80) {
      recommendations.push('CPU usage is high, consider scaling horizontally');
      bottlenecks.push('CPU appears to be a bottleneck');
    }
    
    if (metrics.throughput.avgRPS < this.config.targetRPS * 0.9) {
      recommendations.push('System unable to achieve target throughput');
      bottlenecks.push('Throughput below target');
    }
    
    return {
      passed,
      score,
      recommendations,
      bottlenecks
    };
  }
  
  private calculateScore(metrics: PerformanceMetrics, violations: ThresholdViolation[]): number {
    let score = 100;
    
    // Deduct points for violations
    score -= violations.filter(v => v.severity === 'critical').length * 20;
    score -= violations.filter(v => v.severity === 'warning').length * 10;
    
    // Deduct points for poor performance
    if (metrics.errors.errorRate > 0.01) {
      score -= Math.min(20, metrics.errors.errorRate * 1000);
    }
    
    if (metrics.latency.p95 > this.config.thresholds.maxLatencyP95) {
      const excess = (metrics.latency.p95 - this.config.thresholds.maxLatencyP95) / this.config.thresholds.maxLatencyP95;
      score -= Math.min(15, excess * 50);
    }
    
    if (metrics.throughput.avgRPS < this.config.targetRPS * 0.9) {
      const deficit = 1 - (metrics.throughput.avgRPS / this.config.targetRPS);
      score -= Math.min(15, deficit * 50);
    }
    
    return Math.max(0, Math.round(score));
  }
}

class VirtualUser {
  private id: string;
  private config: LoadTestConfig;
  private target: any;
  private metrics: MetricsCollector;
  private active: boolean = false;
  private currentScenario: TestScenario | null = null;
  
  constructor(id: string, config: LoadTestConfig, target: any, metrics: MetricsCollector) {
    this.id = id;
    this.config = config;
    this.target = target;
    this.metrics = metrics;
  }
  
  start(): void {
    this.active = true;
    this.runScenarios().catch(err => {
      logger.error(`Virtual user ${this.id} error:`, err);
    });
  }
  
  stop(): void {
    this.active = false;
  }
  
  isActive(): boolean {
    return this.active;
  }
  
  private async runScenarios(): Promise<void> {
    while (this.active) {
      // Select scenario based on weights
      const scenario = this.selectScenario();
      this.currentScenario = scenario;
      
      // Execute scenario steps
      for (const step of scenario.steps) {
        if (!this.active) break;
        
        await this.executeStep(step, scenario.name);
        
        // Think time between steps
        if (scenario.thinkTime > 0) {
          await new Promise(resolve => setTimeout(resolve, scenario.thinkTime));
        }
      }
    }
  }
  
  private selectScenario(): TestScenario {
    const random = Math.random() * 100;
    let cumulative = 0;
    
    for (const scenario of this.config.scenarios) {
      cumulative += scenario.weight;
      if (random <= cumulative) {
        return scenario;
      }
    }
    
    return this.config.scenarios[0];
  }
  
  private async executeStep(step: TestStep, scenarioName: string): Promise<void> {
    const startTime = performance.now();
    let success = false;
    let error: Error | null = null;
    
    try {
      // Execute action based on step type
      let response: any;
      
      switch (step.action) {
        case 'placeOrder':
          response = await this.target.placeOrder(this.generateOrder(step.params));
          break;
          
        case 'cancelOrder':
          response = await this.target.cancelOrder(step.params.orderId);
          break;
          
        case 'getPositions':
          response = await this.target.getPositions();
          break;
          
        case 'getMarketData':
          response = await this.target.getMarketData(step.params.symbol);
          break;
          
        case 'custom':
          response = await step.params.handler(this.target);
          break;
      }
      
      // Validate response if validator provided
      if (step.validation) {
        success = step.validation(response);
      } else {
        success = true;
      }
      
    } catch (err) {
      error = err as Error;
      success = false;
    }
    
    const latency = performance.now() - startTime;
    
    // Record metrics
    this.metrics.recordRequest({
      scenario: scenarioName,
      action: step.action,
      success,
      latency,
      error: error?.message,
      timestamp: Date.now()
    });
  }
  
  private generateOrder(params: Record<string, any>): any {
    return this.config.dataGenerator.generateOrder();
  }
}

class MetricsCollector {
  private requests: any[] = [];
  private resourceUsage: any[] = [];
  private violations: ThresholdViolation[] = [];
  private windowSize = 60000; // 1 minute window
  
  reset(): void {
    this.requests = [];
    this.resourceUsage = [];
    this.violations = [];
  }
  
  recordRequest(request: any): void {
    this.requests.push(request);
    
    // Clean old data
    const cutoff = Date.now() - this.windowSize;
    this.requests = this.requests.filter(r => r.timestamp > cutoff);
  }
  
  recordResourceUsage(usage: any): void {
    this.resourceUsage.push(usage);
    
    // Clean old data
    const cutoff = Date.now() - this.windowSize;
    this.resourceUsage = this.resourceUsage.filter(u => u.timestamp > cutoff);
  }
  
  recordViolation(violation: ThresholdViolation): void {
    this.violations.push(violation);
  }
  
  getCurrentRPS(): number {
    const now = Date.now();
    const oneSecondAgo = now - 1000;
    const recentRequests = this.requests.filter(r => r.timestamp > oneSecondAgo);
    return recentRequests.length;
  }
  
  getErrorCount(): number {
    return this.requests.filter(r => !r.success).length;
  }
  
  getCurrentMetrics(): any {
    const latencies = this.requests.map(r => r.latency).sort((a, b) => a - b);
    const errors = this.requests.filter(r => !r.success);
    
    return {
      latencyP95: this.percentile(latencies, 0.95),
      latencyP99: this.percentile(latencies, 0.99),
      errorRate: errors.length / Math.max(1, this.requests.length),
      currentRPS: this.getCurrentRPS()
    };
  }
  
  getAggregatedMetrics(): PerformanceMetrics {
    const latencies = this.requests.map(r => r.latency).sort((a, b) => a - b);
    const successfulRequests = this.requests.filter(r => r.success);
    const failedRequests = this.requests.filter(r => !r.success);
    
    // Throughput metrics
    const throughput: ThroughputMetrics = {
      avgRPS: this.requests.length / (this.windowSize / 1000),
      peakRPS: this.calculatePeakRPS(),
      totalRequests: this.requests.length,
      requestsPerScenario: this.groupByScenario()
    };
    
    // Latency metrics
    const latency: LatencyMetrics = {
      min: Math.min(...latencies),
      max: Math.max(...latencies),
      mean: latencies.reduce((a, b) => a + b, 0) / latencies.length,
      median: this.percentile(latencies, 0.5),
      p90: this.percentile(latencies, 0.9),
      p95: this.percentile(latencies, 0.95),
      p99: this.percentile(latencies, 0.99),
      histogram: this.createHistogram(latencies)
    };
    
    // Error metrics
    const errors: ErrorMetrics = {
      totalErrors: failedRequests.length,
      errorRate: failedRequests.length / Math.max(1, this.requests.length),
      errorsByType: this.groupErrorsByType(failedRequests),
      errorsByScenario: this.groupErrorsByScenario(failedRequests)
    };
    
    // Resource metrics
    const resources: ResourceMetrics = {
      avgCpuUsage: this.calculateAvgResource('cpu'),
      peakCpuUsage: this.calculatePeakResource('cpu'),
      avgMemoryUsage: this.calculateAvgResource('memory'),
      peakMemoryUsage: this.calculatePeakResource('memory'),
      networkIO: {
        bytesIn: 0, // Would be calculated from actual network metrics
        bytesOut: 0
      }
    };
    
    return {
      throughput,
      latency,
      errors,
      resources,
      custom: new Map()
    };
  }
  
  getViolations(): ThresholdViolation[] {
    return this.violations;
  }
  
  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.ceil(sorted.length * p) - 1;
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
  }
  
  private calculatePeakRPS(): number {
    let peakRPS = 0;
    const buckets = new Map<number, number>();
    
    // Group requests by second
    for (const request of this.requests) {
      const second = Math.floor(request.timestamp / 1000);
      buckets.set(second, (buckets.get(second) || 0) + 1);
    }
    
    // Find peak
    for (const count of buckets.values()) {
      peakRPS = Math.max(peakRPS, count);
    }
    
    return peakRPS;
  }
  
  private groupByScenario(): Map<string, number> {
    const groups = new Map<string, number>();
    
    for (const request of this.requests) {
      groups.set(request.scenario, (groups.get(request.scenario) || 0) + 1);
    }
    
    return groups;
  }
  
  private groupErrorsByType(errors: any[]): Map<string, number> {
    const groups = new Map<string, number>();
    
    for (const error of errors) {
      const type = error.error || 'unknown';
      groups.set(type, (groups.get(type) || 0) + 1);
    }
    
    return groups;
  }
  
  private groupErrorsByScenario(errors: any[]): Map<string, number> {
    const groups = new Map<string, number>();
    
    for (const error of errors) {
      groups.set(error.scenario, (groups.get(error.scenario) || 0) + 1);
    }
    
    return groups;
  }
  
  private createHistogram(latencies: number[]): number[] {
    const buckets = 20;
    const histogram = new Array(buckets).fill(0);
    
    if (latencies.length === 0) return histogram;
    
    const min = Math.min(...latencies);
    const max = Math.max(...latencies);
    const bucketSize = (max - min) / buckets;
    
    for (const latency of latencies) {
      const bucket = Math.min(Math.floor((latency - min) / bucketSize), buckets - 1);
      histogram[bucket]++;
    }
    
    return histogram;
  }
  
  private calculateAvgResource(type: string): number {
    const values = this.resourceUsage.map(u => u[type]);
    return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  }
  
  private calculatePeakResource(type: string): number {
    const values = this.resourceUsage.map(u => u[type]);
    return values.length > 0 ? Math.max(...values) : 0;
  }
} 