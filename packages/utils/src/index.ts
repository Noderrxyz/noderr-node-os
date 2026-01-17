/**
 * @noderr/utils - Shared utilities for Noderr Protocol
 */

import winston from 'winston';
import { v4 as uuidv4 } from 'uuid';

// Logger
export class Logger {
  private logger: winston.Logger;

  constructor(name: string, options?: winston.LoggerOptions) {
    this.logger = winston.createLogger({
      level: options?.level || 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      defaultMeta: { service: name },
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          )
        })
      ],
      ...options
    });
  }

  debug(message: string, meta?: any): void {
    this.logger.debug(message, meta);
  }

  info(message: string, meta?: any): void {
    this.logger.info(message, meta);
  }

  warn(message: string, meta?: any): void {
    this.logger.warn(message, meta);
  }

  error(message: string, error?: Error | any, meta?: any): void {
    if (error instanceof Error) {
      this.logger.error(message, { error: error.message, stack: error.stack, ...meta });
    } else {
      this.logger.error(message, { error, ...meta });
    }
  }

  child(name: string): Logger {
    return new Logger(`${this.logger.defaultMeta?.service}.${name}`);
  }

  // Get the underlying winston logger instance for compatibility
  getWinstonLogger(): winston.Logger {
    return this.logger;
  }
}

// Retry Manager
export interface RetryOptions {
  maxAttempts: number;
  backoff: 'linear' | 'exponential';
  initialDelay: number;
  maxDelay?: number;
  factor?: number;
  jitter?: boolean;
}

export class RetryManager {
  constructor(private options: RetryOptions) {}

  async execute<T>(
    operation: () => Promise<T>,
    shouldRetry?: (error: Error) => boolean
  ): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 1; attempt <= this.options.maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        
        if (attempt === this.options.maxAttempts) {
          throw lastError;
        }
        
        if (shouldRetry && !shouldRetry(lastError)) {
          throw lastError;
        }
        
        const delay = this.calculateDelay(attempt);
        await this.sleep(delay);
      }
    }
    
    throw lastError!;
  }

  private calculateDelay(attempt: number): number {
    let delay: number;
    
    if (this.options.backoff === 'exponential') {
      const factor = this.options.factor || 2;
      delay = this.options.initialDelay * Math.pow(factor, attempt - 1);
    } else {
      delay = this.options.initialDelay * attempt;
    }
    
    if (this.options.maxDelay) {
      delay = Math.min(delay, this.options.maxDelay);
    }
    
    if (this.options.jitter) {
      delay = delay * (0.5 + Math.random() * 0.5);
    }
    
    return delay;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Circular Buffer
export class CircularBuffer<T> {
  private buffer: (T | undefined)[];
  private head: number = 0;
  private tail: number = 0;
  private count: number = 0;

  constructor(private capacity: number) {
    this.buffer = new Array(capacity);
  }

  push(item: T): void {
    this.buffer[this.tail] = item;
    this.tail = (this.tail + 1) % this.capacity;
    
    if (this.count < this.capacity) {
      this.count++;
    } else {
      this.head = (this.head + 1) % this.capacity;
    }
  }

  pop(): T | undefined {
    if (this.count === 0) {
      return undefined;
    }
    
    const item = this.buffer[this.head];
    this.buffer[this.head] = undefined;
    this.head = (this.head + 1) % this.capacity;
    this.count--;
    
    return item;
  }

  peek(): T | undefined {
    if (this.count === 0) {
      return undefined;
    }
    return this.buffer[this.head];
  }

  toArray(): T[] {
    const result: T[] = [];
    let index = this.head;
    
    for (let i = 0; i < this.count; i++) {
      result.push(this.buffer[index]!);
      index = (index + 1) % this.capacity;
    }
    
    return result;
  }

  clear(): void {
    this.buffer = new Array(this.capacity);
    this.head = 0;
    this.tail = 0;
    this.count = 0;
  }

  get size(): number {
    return this.count;
  }

  get isFull(): boolean {
    return this.count === this.capacity;
  }

  get isEmpty(): boolean {
    return this.count === 0;
  }
}

// ID Generator
export function generateId(prefix?: string): string {
  const id = uuidv4();
  return prefix ? `${prefix}_${id}` : id;
}

// Sleep utility
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Deep clone utility
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

// Export default logger instance
export const logger = new Logger('noderr');

// Export graceful shutdown utilities
export * from './graceful-shutdown';

// Export state persistence utilities
export * from './state-persistence';

// Export NFT verification utilities
export * from './nft-verification'; 