import { MarketSnapshot, ValidatorMetrics } from '@noderr/types';

/**
 * ValidatorNode - Market data feed validation
 * 
 * Validates individual market data feeds from exchanges by tracking latency,
 * detecting corruption, and automatically quarantining bad feeds.
 */
export class ValidatorNode {
  private metrics: ValidatorMetrics;
  private latencyHistory: number[];
  private readonly maxHistorySize: number;
  private readonly quarantineThresholdMs: number;
  private isQuarantined: boolean;
  private quarantineStartTime: number | null;

  constructor(
    public source: string,
    config: {
      maxHistorySize?: number;
      quarantineThresholdMs?: number;
    } = {}
  ) {
    this.maxHistorySize = config.maxHistorySize || 100;
    this.quarantineThresholdMs = config.quarantineThresholdMs || 3000;
    this.latencyHistory = [];
    this.isQuarantined = false;
    this.quarantineStartTime = null;

    this.metrics = {
      latencyMs: 0,
      lastUpdate: 0,
      errorCount: 0,
      quarantineCount: 0,
      score: 1.0
    };
  }

  public registerSnapshot(snapshot: MarketSnapshot): void {
    try {
      const latency = Date.now() - snapshot.timestamp;
      this.updateLatencyHistory(latency);
      this.updateMetrics(snapshot);
      this.checkQuarantineStatus();
    } catch (error) {
      console.error(`[ValidatorNode] Error validating snapshot for ${this.source}:`, error);
      this.metrics.errorCount++;
    }
  }

  public isDelayed(thresholdMs: number): boolean {
    return this.metrics.latencyMs > thresholdMs;
  }

  public isCorrupted(): boolean {
    return this.metrics.errorCount > 0 || this.hasInvalidData();
  }

  public score(): number {
    return this.metrics.score;
  }

  public isInQuarantine(): boolean {
    return this.isQuarantined;
  }

  public getMetrics(): ValidatorMetrics {
    return { ...this.metrics };
  }

  private updateLatencyHistory(latency: number): void {
    this.latencyHistory.push(latency);
    if (this.latencyHistory.length > this.maxHistorySize) {
      this.latencyHistory.shift();
    }
  }

  private updateMetrics(snapshot: MarketSnapshot): void {
    const latency = Date.now() - snapshot.timestamp;
    this.metrics.latencyMs = this.calculateRollingAverage();
    this.metrics.lastUpdate = Date.now();

    // Update score based on latency and data quality
    const latencyScore = Math.max(0, 1 - (latency / this.quarantineThresholdMs));
    const dataQualityScore = this.hasInvalidData() ? 0 : 1;
    this.metrics.score = (latencyScore + dataQualityScore) / 2;
  }

  private calculateRollingAverage(): number {
    if (this.latencyHistory.length === 0) return 0;
    const sum = this.latencyHistory.reduce((a, b) => a + b, 0);
    return sum / this.latencyHistory.length;
  }

  private hasInvalidData(): boolean {
    // Check for common data corruption patterns
    return this.latencyHistory.some(latency => 
      isNaN(latency) || 
      latency < 0 || 
      latency > this.quarantineThresholdMs * 2
    );
  }

  private checkQuarantineStatus(): void {
    const shouldQuarantine = 
      this.metrics.latencyMs > this.quarantineThresholdMs || 
      this.isCorrupted();

    if (shouldQuarantine && !this.isQuarantined) {
      this.quarantine();
    } else if (!shouldQuarantine && this.isQuarantined) {
      this.releaseFromQuarantine();
    }
  }

  private quarantine(): void {
    this.isQuarantined = true;
    this.quarantineStartTime = Date.now();
    this.metrics.quarantineCount++;
    console.warn(`[ValidatorNode] Feed ${this.source} quarantined due to high latency or data corruption`);
  }

  private releaseFromQuarantine(): void {
    this.isQuarantined = false;
    this.quarantineStartTime = null;
    console.info(`[ValidatorNode] Feed ${this.source} released from quarantine`);
  }
}
