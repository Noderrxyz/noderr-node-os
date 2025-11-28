import { OptimizedTcpClient, OptimizedTcpServer } from './TcpOptimizer';
import { OptimizedUdpClient, OptimizedUdpServer } from './UdpOptimizer';
import { EventEmitter } from 'events';

/**
 * Benchmark configuration
 */
export interface BenchmarkConfig {
  protocol: 'tcp' | 'udp';
  messageSize: number;
  messageCount: number;
  warmupCount: number;
  concurrentConnections: number;
  targetHost: string;
  targetPort: number;
}

/**
 * Benchmark results
 */
export interface BenchmarkResults {
  protocol: string;
  messageSize: number;
  messageCount: number;
  totalTimeMs: number;
  throughputMbps: number;
  messagesPerSecond: number;
  latencyStats: LatencyStats;
  errors: number;
}

/**
 * Latency statistics
 */
export interface LatencyStats {
  min: number;
  max: number;
  mean: number;
  median: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  p999: number;
  stdDev: number;
}

/**
 * Network performance benchmark tool
 */
export class NetworkBenchmark extends EventEmitter {
  private config: BenchmarkConfig;
  private latencies: number[] = [];
  private errors: number = 0;
  
  constructor(config: BenchmarkConfig) {
    super();
    this.config = config;
  }
  
  /**
   * Run the benchmark
   */
  async run(): Promise<BenchmarkResults> {
    this.latencies = [];
    this.errors = 0;
    
    // Warmup
    await this.warmup();
    
    // Run benchmark
    const startTime = process.hrtime.bigint();
    
    if (this.config.protocol === 'tcp') {
      await this.runTcpBenchmark();
    } else {
      await this.runUdpBenchmark();
    }
    
    const endTime = process.hrtime.bigint();
    const totalTimeNs = Number(endTime - startTime);
    const totalTimeMs = totalTimeNs / 1_000_000;
    
    // Calculate results
    return this.calculateResults(totalTimeMs);
  }
  
  /**
   * Warmup phase
   */
  private async warmup(): Promise<void> {
    this.emit('warmupStart', this.config.warmupCount);
    
    if (this.config.protocol === 'tcp') {
      const client = new OptimizedTcpClient();
      await client.connect(this.config.targetHost, this.config.targetPort);
      
      const message = Buffer.alloc(this.config.messageSize);
      for (let i = 0; i < this.config.warmupCount; i++) {
        client.send(message);
      }
      
      await new Promise(resolve => setTimeout(resolve, 100));
      client.disconnect();
    }
    
    this.emit('warmupComplete');
  }
  
  /**
   * Run TCP benchmark
   */
  private async runTcpBenchmark(): Promise<void> {
    const clients: OptimizedTcpClient[] = [];
    const messageBuffer = Buffer.alloc(this.config.messageSize);
    
    // Create connections
    for (let i = 0; i < this.config.concurrentConnections; i++) {
      const client = new OptimizedTcpClient();
      await client.connect(this.config.targetHost, this.config.targetPort);
      clients.push(client);
    }
    
    // Prepare for latency measurement
    const messagesPerClient = Math.floor(this.config.messageCount / this.config.concurrentConnections);
    const pendingResponses = new Map<number, bigint>();
    let messageId = 0;
    let responsesReceived = 0;
    
    // Set up response handlers
    clients.forEach(client => {
      client.on('data', (data: Buffer) => {
        const id = data.readUInt32LE(0);
        const sendTime = pendingResponses.get(id);
        if (sendTime) {
          const latencyNs = Number(process.hrtime.bigint() - sendTime);
          this.latencies.push(latencyNs / 1000); // Convert to microseconds
          pendingResponses.delete(id);
          responsesReceived++;
        }
      });
    });
    
    // Send messages
    const sendPromises: Promise<void>[] = [];
    
    for (let i = 0; i < messagesPerClient; i++) {
      for (const client of clients) {
        const id = messageId++;
        messageBuffer.writeUInt32LE(id, 0);
        
        const sendTime = process.hrtime.bigint();
        pendingResponses.set(id, sendTime);
        
        const promise = new Promise<void>((resolve) => {
          client.sendWithCallback(messageBuffer)
            .then(() => resolve())
            .catch(() => {
              this.errors++;
              resolve();
            });
        });
        
        sendPromises.push(promise);
      }
    }
    
    // Wait for all sends to complete
    await Promise.all(sendPromises);
    
    // Wait for responses (with timeout)
    const responseTimeout = 5000;
    const startWait = Date.now();
    
    while (responsesReceived < messageId && Date.now() - startWait < responseTimeout) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    // Clean up
    for (const client of clients) {
      client.disconnect();
    }
    
    // Count timeouts as errors
    this.errors += pendingResponses.size;
  }
  
  /**
   * Run UDP benchmark
   */
  private async runUdpBenchmark(): Promise<void> {
    const client = new OptimizedUdpClient();
    await client.listen(0); // Random port
    
    const messageBuffer = Buffer.alloc(this.config.messageSize);
    const pendingResponses = new Map<number, bigint>();
    let responsesReceived = 0;
    
    // Set up response handler
    client.on('data', (packet: any) => {
      const id = packet.sequenceNumber;
      const sendTime = pendingResponses.get(id);
      if (sendTime) {
        const latencyNs = Number(process.hrtime.bigint() - sendTime);
        this.latencies.push(latencyNs / 1000); // Convert to microseconds
        pendingResponses.delete(id);
        responsesReceived++;
      }
    });
    
    // Create UDP server for sending
    const server = new OptimizedUdpServer();
    await server.start(0); // Random port
    
    // Send messages
    for (let i = 0; i < this.config.messageCount; i++) {
      const sendTime = process.hrtime.bigint();
      pendingResponses.set(i, sendTime);
      
      server.broadcast({
        sequenceNumber: i,
        timestamp: sendTime,
        symbol: 'TEST',
        bidPrice: 100,
        askPrice: 100.01,
        bidSize: 1000,
        askSize: 1000
      }, this.config.targetHost, this.config.targetPort);
      
      // Small delay to prevent overwhelming
      if (i % 100 === 0) {
        await new Promise(resolve => setImmediate(resolve));
      }
    }
    
    // Wait for responses
    const responseTimeout = 5000;
    const startWait = Date.now();
    
    while (responsesReceived < this.config.messageCount && Date.now() - startWait < responseTimeout) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    // Clean up
    client.close();
    server.stop();
    
    // Count lost packets as errors
    this.errors += pendingResponses.size;
  }
  
  /**
   * Calculate benchmark results
   */
  private calculateResults(totalTimeMs: number): BenchmarkResults {
    // Sort latencies for percentile calculation
    this.latencies.sort((a, b) => a - b);
    
    // Calculate statistics
    const latencyStats = this.calculateLatencyStats();
    
    // Calculate throughput
    const totalBytes = this.config.messageSize * this.config.messageCount;
    const totalMegabits = (totalBytes * 8) / 1_000_000;
    const throughputMbps = totalMegabits / (totalTimeMs / 1000);
    
    const messagesPerSecond = this.config.messageCount / (totalTimeMs / 1000);
    
    return {
      protocol: this.config.protocol,
      messageSize: this.config.messageSize,
      messageCount: this.config.messageCount,
      totalTimeMs,
      throughputMbps,
      messagesPerSecond,
      latencyStats,
      errors: this.errors
    };
  }
  
  /**
   * Calculate latency statistics
   */
  private calculateLatencyStats(): LatencyStats {
    if (this.latencies.length === 0) {
      return {
        min: 0,
        max: 0,
        mean: 0,
        median: 0,
        p50: 0,
        p90: 0,
        p95: 0,
        p99: 0,
        p999: 0,
        stdDev: 0
      };
    }
    
    const n = this.latencies.length;
    
    // Basic stats
    const min = this.latencies[0];
    const max = this.latencies[n - 1];
    const sum = this.latencies.reduce((a, b) => a + b, 0);
    const mean = sum / n;
    
    // Percentiles
    const p50 = this.getPercentile(50);
    const p90 = this.getPercentile(90);
    const p95 = this.getPercentile(95);
    const p99 = this.getPercentile(99);
    const p999 = this.getPercentile(99.9);
    
    // Standard deviation
    const squaredDiffs = this.latencies.map(x => Math.pow(x - mean, 2));
    const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / n;
    const stdDev = Math.sqrt(avgSquaredDiff);
    
    return {
      min,
      max,
      mean,
      median: p50,
      p50,
      p90,
      p95,
      p99,
      p999,
      stdDev
    };
  }
  
  /**
   * Get percentile value
   */
  private getPercentile(percentile: number): number {
    const index = Math.ceil((percentile / 100) * this.latencies.length) - 1;
    return this.latencies[Math.max(0, Math.min(index, this.latencies.length - 1))];
  }
}

/**
 * Run a quick benchmark
 */
export async function runQuickBenchmark(
  protocol: 'tcp' | 'udp',
  host: string,
  port: number
): Promise<BenchmarkResults> {
  const benchmark = new NetworkBenchmark({
    protocol,
    messageSize: 1024,
    messageCount: 10000,
    warmupCount: 1000,
    concurrentConnections: protocol === 'tcp' ? 4 : 1,
    targetHost: host,
    targetPort: port
  });
  
  return benchmark.run();
} 