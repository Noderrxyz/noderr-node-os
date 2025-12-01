/**
 * DeadLetterQueue - Failed message handling and recovery
 * 
 * Manages messages that failed processing with configurable retry
 * strategies and eventual recovery or permanent failure handling.
 */

import { EventEmitter } from 'events';
import { Logger } from 'winston';
import {
  Message
} from '@noderr/types';

interface DeadLetterEntry {
  message: Message;
  error: Error;
  retries: number;
  firstAttempt: number;
  lastAttempt: number;
}

type MessageHandler = (message: Message) => Promise<void>;

interface RetryStrategy {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  retryableErrors?: string[];
}

interface DLQConfig {
  maxSize: number;
  ttl: number; // Time to live in ms
  processInterval: number;
  retryStrategy: RetryStrategy;
  persistToFile?: boolean;
  filePath?: string;
}

interface DLQStats {
  totalMessages: number;
  retriedMessages: number;
  recoveredMessages: number;
  expiredMessages: number;
  permanentFailures: number;
  oldestMessage?: Date;
  avgRetries: number;
}

export class DeadLetterQueue extends EventEmitter {
  private logger: Logger;
  private queue: Map<string, DeadLetterEntry> = new Map();
  private config: DLQConfig;
  private processTimer?: NodeJS.Timeout;
  private stats: DLQStats = {
    totalMessages: 0,
    retriedMessages: 0,
    recoveredMessages: 0,
    expiredMessages: 0,
    permanentFailures: 0,
    avgRetries: 0
  };
  
  private retryHandlers: Map<string, MessageHandler> = new Map();
  private started: boolean = false;
  
  constructor(logger: Logger, config: DLQConfig) {
    super();
    this.logger = logger;
    this.config = config;
  }
  
  /**
   * Start the dead letter queue processor
   */
  start(): void {
    if (this.started) return;
    
    this.logger.info('Starting DeadLetterQueue processor');
    this.started = true;
    
    // Start processing timer
    this.processTimer = setInterval(
      () => this.processQueue(),
      this.config.processInterval
    );
    
    // Load persisted messages if configured
    if (this.config.persistToFile) {
      this.loadPersistedMessages();
    }
  }
  
  /**
   * Stop the dead letter queue processor
   */
  stop(): void {
    if (!this.started) return;
    
    this.logger.info('Stopping DeadLetterQueue processor');
    this.started = false;
    
    if (this.processTimer) {
      clearInterval(this.processTimer);
      this.processTimer = undefined;
    }
    
    // Persist messages if configured
    if (this.config.persistToFile) {
      this.persistMessages();
    }
  }
  
  /**
   * Add a failed message to the queue
   */
  add(message: Message, reason: string, error?: Error): void {
    const messageId = message.header.id;
    
    // Check if message already exists
    if (this.queue.has(messageId)) {
      const entry = this.queue.get(messageId)!;
      entry.retries++;
      entry.lastFailure = Date.now();
      entry.reason = reason;
      entry.error = error;
      
      this.logger.debug(`Updated DLQ entry for message ${messageId}, retries: ${entry.retries}`);
    } else {
      // Check queue size limit
      if (this.queue.size >= this.config.maxSize) {
        this.evictOldestMessage();
      }
      
      // Create new entry
      const entry: DeadLetterEntry = {
        message,
        reason,
        retries: 0,
        firstFailure: Date.now(),
        lastFailure: Date.now(),
        error
      };
      
      this.queue.set(messageId, entry);
      this.stats.totalMessages++;
      
      this.logger.warn(`Added message to DLQ: ${messageId}`, {
        type: message.header.type,
        source: message.header.source,
        reason
      });
    }
    
    this.emit('message:added', message, reason);
  }
  
  /**
   * Remove a message from the queue
   */
  remove(messageId: string): boolean {
    const removed = this.queue.delete(messageId);
    
    if (removed) {
      this.logger.debug(`Removed message from DLQ: ${messageId}`);
      this.emit('message:removed', messageId);
    }
    
    return removed;
  }
  
  /**
   * Get a message from the queue
   */
  get(messageId: string): DeadLetterEntry | undefined {
    return this.queue.get(messageId);
  }
  
  /**
   * Get all messages in the queue
   */
  getAll(): DeadLetterEntry[] {
    return Array.from(this.queue.values());
  }
  
  /**
   * Get queue statistics
   */
  getStats(): DLQStats {
    const entries = Array.from(this.queue.values());
    
    return {
      ...this.stats,
      oldestMessage: entries.length > 0
        ? new Date(Math.min(...entries.map(e => e.firstFailure)))
        : undefined,
      avgRetries: entries.length > 0
        ? entries.reduce((sum, e) => sum + e.retries, 0) / entries.length
        : 0
    };
  }
  
  /**
   * Register a retry handler for a specific message type or pattern
   */
  registerRetryHandler(pattern: string, handler: MessageHandler): void {
    this.retryHandlers.set(pattern, handler);
    this.logger.debug(`Registered retry handler for pattern: ${pattern}`);
  }
  
  /**
   * Manually retry a specific message
   */
  async retryMessage(messageId: string): Promise<boolean> {
    const entry = this.queue.get(messageId);
    if (!entry) return false;
    
    return await this.attemptRetry(entry);
  }
  
  /**
   * Clear expired messages
   */
  clearExpired(): number {
    const now = Date.now();
    let cleared = 0;
    
    for (const [messageId, entry] of this.queue) {
      if (now - entry.firstFailure > this.config.ttl) {
        this.queue.delete(messageId);
        cleared++;
        this.stats.expiredMessages++;
        
        this.logger.info(`Expired DLQ message: ${messageId}`, {
          age: now - entry.firstFailure,
          retries: entry.retries
        });
        
        this.emit('message:expired', entry);
      }
    }
    
    return cleared;
  }
  
  /**
   * Private: Process the queue
   */
  private async processQueue(): Promise<void> {
    // Clear expired messages first
    this.clearExpired();
    
    // Process messages eligible for retry
    const now = Date.now();
    const entries = Array.from(this.queue.values());
    
    for (const entry of entries) {
      if (this.shouldRetry(entry, now)) {
        await this.attemptRetry(entry);
      }
    }
  }
  
  /**
   * Private: Check if message should be retried
   */
  private shouldRetry(entry: DeadLetterEntry, now: number): boolean {
    // Check if max retries exceeded
    if (entry.retries >= this.config.retryStrategy.maxRetries) {
      return false;
    }
    
    // Check if error is retryable
    if (this.config.retryStrategy.retryableErrors && entry.error) {
      const errorName = entry.error.name || entry.error.constructor.name;
      if (!this.config.retryStrategy.retryableErrors.includes(errorName)) {
        return false;
      }
    }
    
    // Calculate next retry time
    const delay = this.calculateRetryDelay(entry.retries);
    const nextRetry = entry.lastFailure + delay;
    
    return now >= nextRetry;
  }
  
  /**
   * Private: Calculate retry delay with exponential backoff
   */
  private calculateRetryDelay(retries: number): number {
    const { initialDelay, maxDelay, backoffMultiplier } = this.config.retryStrategy;
    
    const delay = initialDelay * Math.pow(backoffMultiplier, retries);
    return Math.min(delay, maxDelay);
  }
  
  /**
   * Private: Attempt to retry a message
   */
  private async attemptRetry(entry: DeadLetterEntry): Promise<boolean> {
    const messageId = entry.message.header.id;
    
    try {
      // Find appropriate handler
      const handler = this.findRetryHandler(entry.message);
      
      if (!handler) {
        this.logger.warn(`No retry handler found for message: ${messageId}`);
        return false;
      }
      
      // Attempt retry
      this.logger.info(`Retrying message: ${messageId}, attempt ${entry.retries + 1}`);
      await handler(entry.message);
      
      // Success - remove from queue
      this.queue.delete(messageId);
      this.stats.recoveredMessages++;
      
      this.logger.info(`Message recovered from DLQ: ${messageId}`);
      this.emit('message:recovered', entry.message);
      
      return true;
    } catch (error) {
      // Update retry count and failure info
      entry.retries++;
      entry.lastFailure = Date.now();
      entry.error = error as Error;
      
      this.stats.retriedMessages++;
      
      this.logger.error(`Retry failed for message: ${messageId}`, {
        retries: entry.retries,
        error
      });
      
      // Check if max retries exceeded
      if (entry.retries >= this.config.retryStrategy.maxRetries) {
        this.stats.permanentFailures++;
        this.emit('message:failed', entry);
        
        this.logger.error(`Message permanently failed: ${messageId}`, {
          totalRetries: entry.retries,
          firstFailure: new Date(entry.firstFailure),
          lastFailure: new Date(entry.lastFailure)
        });
      }
      
      return false;
    }
  }
  
  /**
   * Private: Find retry handler for message
   */
  private findRetryHandler(message: Message): MessageHandler | undefined {
    // Check for exact match on destination
    const destination = Array.isArray(message.header.destination)
      ? message.header.destination[0]
      : message.header.destination;
    
    if (this.retryHandlers.has(destination)) {
      return this.retryHandlers.get(destination);
    }
    
    // Check for pattern match
    for (const [pattern, handler] of this.retryHandlers) {
      if (pattern.includes('*') || pattern.includes('?')) {
        const regex = new RegExp(
          pattern.replace(/\*/g, '.*').replace(/\?/g, '.')
        );
        if (regex.test(destination)) {
          return handler;
        }
      }
    }
    
    // Check for message type handler
    if (this.retryHandlers.has(message.header.type)) {
      return this.retryHandlers.get(message.header.type);
    }
    
    // Default handler
    return this.retryHandlers.get('*');
  }
  
  /**
   * Private: Evict oldest message when queue is full
   */
  private evictOldestMessage(): void {
    let oldestEntry: [string, DeadLetterEntry] | undefined;
    let oldestTime = Infinity;
    
    for (const entry of this.queue.entries()) {
      if (entry[1].firstFailure < oldestTime) {
        oldestTime = entry[1].firstFailure;
        oldestEntry = entry;
      }
    }
    
    if (oldestEntry) {
      this.queue.delete(oldestEntry[0]);
      this.logger.warn(`Evicted oldest message from DLQ: ${oldestEntry[0]}`);
      this.emit('message:evicted', oldestEntry[1]);
    }
  }
  
  /**
   * Private: Load persisted messages
   */
  private async loadPersistedMessages(): Promise<void> {
    if (!this.config.filePath) return;
    
    try {
      const fs = await import('fs/promises');
      const data = await fs.readFile(this.config.filePath, 'utf-8');
      const entries: DeadLetterEntry[] = JSON.parse(data);
      
      for (const entry of entries) {
        // Reconstruct error if present
        if (entry.error && typeof entry.error === 'object') {
          const error = new Error((entry.error as any).message);
          error.name = (entry.error as any).name;
          error.stack = (entry.error as any).stack;
          entry.error = error;
        }
        
        this.queue.set(entry.message.header.id, entry);
      }
      
      this.logger.info(`Loaded ${entries.length} messages from DLQ persistence`);
    } catch (error) {
      this.logger.error('Failed to load persisted DLQ messages', { error });
    }
  }
  
  /**
   * Private: Persist messages to file
   */
  private async persistMessages(): Promise<void> {
    if (!this.config.filePath) return;
    
    try {
      const fs = await import('fs/promises');
      const entries = Array.from(this.queue.values()).map(entry => ({
        ...entry,
        error: entry.error ? {
          name: entry.error.name,
          message: entry.error.message,
          stack: entry.error.stack
        } : undefined
      }));
      
      await fs.writeFile(
        this.config.filePath,
        JSON.stringify(entries, null, 2),
        'utf-8'
      );
      
      this.logger.info(`Persisted ${entries.length} messages to DLQ file`);
    } catch (error) {
      this.logger.error('Failed to persist DLQ messages', { error });
    }
  }
} 