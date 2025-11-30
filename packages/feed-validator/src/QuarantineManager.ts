import { ValidatorNode } from './ValidatorNode';
import { MarketSnapshot } from '@noderr/types';
import { FeedBus } from './FeedBus';
import fs from 'fs';
import path from 'path';

interface QuarantineLogEntry {
  source: string;
  timestamp: number;
  reason: string;
  metrics: {
    latencyMs: number;
    errorCount: number;
    score: number;
  };
}

export class QuarantineManager {
  private static instance: QuarantineManager;
  private validators: Map<string, ValidatorNode>;
  private logStream: fs.WriteStream;
  private readonly logPath: string;

  private constructor() {
    this.validators = new Map();
    this.logPath = path.join(process.cwd(), 'logs', 'feed_quarantine.jsonl');
    
    // Ensure logs directory exists
    const logsDir = path.dirname(this.logPath);
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    
    this.logStream = fs.createWriteStream(this.logPath, { flags: 'a' });
    this.setupFeedBusInterception();
  }

  public static getInstance(): QuarantineManager {
    if (!QuarantineManager.instance) {
      QuarantineManager.instance = new QuarantineManager();
    }
    return QuarantineManager.instance;
  }

  public registerValidator(source: string, validator: ValidatorNode): void {
    this.validators.set(source, validator);
    console.info(`[QuarantineManager] Registered validator for ${source}`);
  }

  public isQuarantined(source: string): boolean {
    const validator = this.validators.get(source);
    return validator?.isInQuarantine() || false;
  }

  public getQuarantineStatus(): Array<{
    source: string;
    isQuarantined: boolean;
    metrics: any;
  }> {
    return Array.from(this.validators.entries()).map(([source, validator]) => ({
      source,
      isQuarantined: validator.isInQuarantine(),
      metrics: validator.getMetrics()
    }));
  }

  private setupFeedBusInterception(): void {
    const feedBus = FeedBus.getInstance();
    
    // Intercept all feed events
    feedBus.subscribe((snapshot: MarketSnapshot) => {
      const validator = this.validators.get(snapshot.source);
      if (validator) {
        validator.registerSnapshot(snapshot);
        
        if (validator.isInQuarantine()) {
          this.logQuarantine(validator);
        }
      }
    });
  }

  private logQuarantine(validator: ValidatorNode): void {
    const logEntry: QuarantineLogEntry = {
      source: validator.source,
      timestamp: Date.now(),
      reason: validator.isCorrupted() ? 'data_corruption' : 'high_latency',
      metrics: validator.getMetrics()
    };

    this.logStream.write(JSON.stringify(logEntry) + '\n');
  }

  public cleanup(): void {
    this.logStream.end();
  }
} 