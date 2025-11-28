import Redis from 'ioredis';
import * as winston from 'winston';
import { VolumeTracker } from '../VolumeTracker';
import { ComplianceEngine } from '../../compliance/src/ComplianceEngine';
import { DistributedStateManager } from '../DistributedStateManager';

interface BenchmarkResult {
  operation: string;
  iterations: number;
  totalTime: number;
  avgLatency: number;
  p50Latency: number;
  p95Latency: number;
  p99Latency: number;
  throughput: number;
}

export class VolumeTrackerPerformanceBenchmark {
  private redis: Redis;
  private logger: winston.Logger;
  
  constructor() {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      lazyConnect: true
    });
    
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.simple(),
      transports: [new winston.transports.Console()]
    });
  }
  
  async run(): Promise<void> {
    console.log('🚀 Volume Tracker Performance Benchmark\n');
    console.log('Target: -5ms latency improvement for daily volume checks\n');
    
    await this.redis.connect();
    
    try {
      // Benchmark old implementation
      console.log('📊 Benchmarking OLD implementation (async state lookup)...');
      const oldResults = await this.benchmarkOldImplementation();
      this.printResults('OLD Implementation', oldResults);
      
      // Benchmark new implementation
      console.log('\n📊 Benchmarking NEW implementation (Redis atomic ops)...');
      const newResults = await this.benchmarkNewImplementation();
      this.printResults('NEW Implementation', newResults);
      
      // Compare results
      console.log('\n🎯 PERFORMANCE COMPARISON:');
      this.compareResults(oldResults, newResults);
      
    } finally {
      await this.redis.quit();
    }
  }
  
  private async benchmarkOldImplementation(): Promise<BenchmarkResult> {
    // Simulate the old distributed state manager approach
    const stateManager = new DistributedStateManager(this.logger, this.redis);
    const latencies: number[] = [];
    const iterations = 1000;
    
    // Warm up
    for (let i = 0; i < 100; i++) {
      await this.simulateOldVolumeCheck(stateManager, `warmup-${i}`);
    }
    
    // Actual benchmark
    const startTime = process.hrtime.bigint();
    
    for (let i = 0; i < iterations; i++) {
      const iterStart = process.hrtime.bigint();
      await this.simulateOldVolumeCheck(stateManager, `user-${i % 100}`);
      const iterTime = Number(process.hrtime.bigint() - iterStart) / 1_000_000;
      latencies.push(iterTime);
    }
    
    const totalTime = Number(process.hrtime.bigint() - startTime) / 1_000_000;
    
    return this.calculateMetrics('Old Volume Check', iterations, totalTime, latencies);
  }
  
  private async benchmarkNewImplementation(): Promise<BenchmarkResult> {
    const volumeTracker = new VolumeTracker(this.logger, {
      redis: this.redis,
      ttl: 86400,
      namespace: 'benchmark'
    });
    
    const latencies: number[] = [];
    const iterations = 1000;
    
    // Warm up
    for (let i = 0; i < 100; i++) {
      await volumeTracker.incrementDailyVolume(`warmup-${i}`, Math.random() * 1000);
    }
    
    // Actual benchmark
    const startTime = process.hrtime.bigint();
    
    for (let i = 0; i < iterations; i++) {
      const iterStart = process.hrtime.bigint();
      await volumeTracker.checkAndIncrementVolume(
        `user-${i % 100}`,
        Math.random() * 1000,
        100000
      );
      const iterTime = Number(process.hrtime.bigint() - iterStart) / 1_000_000;
      latencies.push(iterTime);
    }
    
    const totalTime = Number(process.hrtime.bigint() - startTime) / 1_000_000;
    
    return this.calculateMetrics('New Volume Check', iterations, totalTime, latencies);
  }
  
  private async simulateOldVolumeCheck(stateManager: DistributedStateManager, userId: string): Promise<number> {
    // Simulate the old getUserDailyVolume method
    const today = new Date().toISOString().split('T')[0];
    const key = `daily-volume:${userId}:${today}`;
    
    // First, get current volume (network round trip)
    const currentVolume = await stateManager.getState<number>(key, { namespace: 'compliance' }) || 0;
    
    // Then, update it (another network round trip)
    const newVolume = currentVolume + Math.random() * 1000;
    await stateManager.setState(key, newVolume, { namespace: 'compliance', ttl: 86400 });
    
    return newVolume;
  }
  
  private calculateMetrics(
    operation: string,
    iterations: number,
    totalTime: number,
    latencies: number[]
  ): BenchmarkResult {
    latencies.sort((a, b) => a - b);
    
    const avgLatency = totalTime / iterations;
    const p50Latency = latencies[Math.floor(iterations * 0.50)];
    const p95Latency = latencies[Math.floor(iterations * 0.95)];
    const p99Latency = latencies[Math.floor(iterations * 0.99)];
    const throughput = iterations / (totalTime / 1000);
    
    return {
      operation,
      iterations,
      totalTime,
      avgLatency,
      p50Latency,
      p95Latency,
      p99Latency,
      throughput
    };
  }
  
  private printResults(title: string, result: BenchmarkResult): void {
    console.log(`\n${title}:`);
    console.log(`  Total iterations: ${result.iterations}`);
    console.log(`  Total time: ${result.totalTime.toFixed(2)}ms`);
    console.log(`  Average latency: ${result.avgLatency.toFixed(3)}ms`);
    console.log(`  P50 latency: ${result.p50Latency.toFixed(3)}ms`);
    console.log(`  P95 latency: ${result.p95Latency.toFixed(3)}ms`);
    console.log(`  P99 latency: ${result.p99Latency.toFixed(3)}ms`);
    console.log(`  Throughput: ${result.throughput.toFixed(0)} ops/sec`);
  }
  
  private compareResults(oldResult: BenchmarkResult, newResult: BenchmarkResult): void {
    const avgImprovement = oldResult.avgLatency - newResult.avgLatency;
    const p99Improvement = oldResult.p99Latency - newResult.p99Latency;
    const throughputImprovement = (newResult.throughput / oldResult.throughput - 1) * 100;
    
    console.log(`  Average latency improvement: ${avgImprovement.toFixed(3)}ms (${(avgImprovement / oldResult.avgLatency * 100).toFixed(1)}%)`);
    console.log(`  P99 latency improvement: ${p99Improvement.toFixed(3)}ms (${(p99Improvement / oldResult.p99Latency * 100).toFixed(1)}%)`);
    console.log(`  Throughput improvement: ${throughputImprovement.toFixed(1)}%`);
    
    if (avgImprovement >= 5) {
      console.log('\n✅ SUCCESS: Achieved target -5ms latency improvement!');
    } else {
      console.log(`\n⚠️  WARNING: Only achieved -${avgImprovement.toFixed(3)}ms improvement (target: -5ms)`);
    }
  }
}

// Run benchmark if executed directly
if (require.main === module) {
  const benchmark = new VolumeTrackerPerformanceBenchmark();
  benchmark.run().catch(console.error);
} 