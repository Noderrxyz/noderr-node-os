import { Logger } from '.';
import { EventEmitter } from 'events';

const logger = new Logger('TimeLock');
const createLogger = (name: string) => ({
  info: (message: string, meta?: any) => logger.info(`[${name}] INFO: ${message}`, meta),
  error: (message: string, error?: any) => logger.error(`[${name}] ERROR: ${message}`, error),
  debug: (message: string, meta?: any) => logger.debug(`[${name}] DEBUG: ${message}`, meta),
  warn: (message: string, meta?: any) => logger.warn(`[${name}] WARN: ${message}`, meta)
});

export interface TimeLockOperation {
  id: string;
  type: string;
  payload: any;
  description: string;
  initiatedBy: string;
  initiatedAt: Date;
  executeAt: Date;
  status: 'PENDING' | 'CANCELLED' | 'EXECUTED' | 'FAILED';
  delayMs: number;
  cancellable: boolean;
  executionResult?: any;
  error?: string;
}

export interface TimeLockConfig {
  defaultDelayMs: number;
  minDelayMs: number;
  maxDelayMs: number;
  allowCancellation: boolean;
}

export class TimeLock extends EventEmitter {
  private logger: ReturnType<typeof createLogger>;
  private config: TimeLockConfig;
  private operations: Map<string, TimeLockOperation> = new Map();
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private executors: Map<string, (operation: TimeLockOperation) => Promise<any>> = new Map();
  
  constructor(config: TimeLockConfig) {
    super();
    this.logger = createLogger('TimeLock');
    this.config = config;
    
    this.logger.info('TimeLock initialized', config);
  }
  
  /**
   * Schedule an operation with a time delay
   */
  public scheduleOperation(
    type: string,
    payload: any,
    description: string,
    initiatedBy: string,
    delayMs?: number,
    executor?: (operation: TimeLockOperation) => Promise<any>
  ): TimeLockOperation {
    const operationId = this.generateOperationId();
    const delay = this.validateDelay(delayMs || this.config.defaultDelayMs);
    
    const operation: TimeLockOperation = {
      id: operationId,
      type,
      payload,
      description,
      initiatedBy,
      initiatedAt: new Date(),
      executeAt: new Date(Date.now() + delay),
      status: 'PENDING',
      delayMs: delay,
      cancellable: this.config.allowCancellation
    };
    
    this.operations.set(operationId, operation);
    
    if (executor) {
      this.executors.set(operationId, executor);
    }
    
    // Schedule execution
    const timer = setTimeout(() => {
      this.executeOperation(operationId);
    }, delay);
    
    this.timers.set(operationId, timer);
    
    this.logger.info('Operation scheduled', {
      operationId,
      type,
      description,
      executeAt: operation.executeAt.toISOString(),
      delayMs: delay
    });
    
    this.emit('operation-scheduled', operation);
    
    return operation;
  }
  
  /**
   * Cancel a pending operation
   */
  public cancelOperation(operationId: string, reason: string): void {
    const operation = this.operations.get(operationId);
    if (!operation) {
      throw new Error(`Operation ${operationId} not found`);
    }
    
    if (operation.status !== 'PENDING') {
      throw new Error(`Operation ${operationId} is not pending (status: ${operation.status})`);
    }
    
    if (!operation.cancellable) {
      throw new Error(`Operation ${operationId} is not cancellable`);
    }
    
    // Clear timer
    const timer = this.timers.get(operationId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(operationId);
    }
    
    operation.status = 'CANCELLED';
    
    this.logger.info('Operation cancelled', {
      operationId,
      reason
    });
    
    this.emit('operation-cancelled', { operation, reason });
  }
  
  /**
   * Get all operations
   */
  public getOperations(filter?: { status?: string; type?: string }): TimeLockOperation[] {
    let operations = Array.from(this.operations.values());
    
    if (filter?.status) {
      operations = operations.filter(op => op.status === filter.status);
    }
    
    if (filter?.type) {
      operations = operations.filter(op => op.type === filter.type);
    }
    
    return operations;
  }
  
  /**
   * Get operation by ID
   */
  public getOperation(operationId: string): TimeLockOperation | undefined {
    return this.operations.get(operationId);
  }
  
  /**
   * Get time remaining for an operation
   */
  public getTimeRemaining(operationId: string): number {
    const operation = this.operations.get(operationId);
    if (!operation || operation.status !== 'PENDING') {
      return 0;
    }
    
    const remaining = operation.executeAt.getTime() - Date.now();
    return Math.max(0, remaining);
  }
  
  /**
   * Register a default executor for a type
   */
  public registerExecutor(
    type: string,
    executor: (operation: TimeLockOperation) => Promise<any>
  ): void {
    this.executors.set(type, executor);
    this.logger.info(`Executor registered for type: ${type}`);
  }
  
  /**
   * Update configuration
   */
  public updateConfig(updates: Partial<TimeLockConfig>): void {
    this.config = { ...this.config, ...updates };
    this.logger.info('TimeLock config updated', this.config);
    this.emit('config-updated', this.config);
  }
  
  // Private methods
  
  private generateOperationId(): string {
    return `timelock-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  }
  
  private validateDelay(delayMs: number): number {
    if (delayMs < this.config.minDelayMs) {
      this.logger.warn(`Delay ${delayMs}ms is below minimum, using ${this.config.minDelayMs}ms`);
      return this.config.minDelayMs;
    }
    
    if (delayMs > this.config.maxDelayMs) {
      this.logger.warn(`Delay ${delayMs}ms is above maximum, using ${this.config.maxDelayMs}ms`);
      return this.config.maxDelayMs;
    }
    
    return delayMs;
  }
  
  private async executeOperation(operationId: string): Promise<void> {
    const operation = this.operations.get(operationId);
    if (!operation || operation.status !== 'PENDING') {
      return;
    }
    
    this.logger.info('Executing time-locked operation', {
      operationId,
      type: operation.type
    });
    
    try {
      // Find executor
      let executor = this.executors.get(operationId);
      if (!executor) {
        executor = this.executors.get(operation.type);
      }
      
      if (!executor) {
        throw new Error(`No executor found for operation ${operationId} of type ${operation.type}`);
      }
      
      // Execute
      const result = await executor(operation);
      
      operation.status = 'EXECUTED';
      operation.executionResult = result;
      
      this.logger.info('Operation executed successfully', {
        operationId,
        type: operation.type
      });
      
      this.emit('operation-executed', { operation, result });
      
    } catch (error: unknown) {
      operation.status = 'FAILED';
      operation.error = error.message;
      
      this.logger.error(`Failed to execute operation ${operationId}`, error);
      this.emit('operation-failed', { operation, error });
    } finally {
      // Clean up timer
      this.timers.delete(operationId);
    }
  }
  
  /**
   * Get statistics
   */
  public getStatistics(): {
    total: number;
    pending: number;
    executed: number;
    cancelled: number;
    failed: number;
    averageDelayMs: number;
  } {
    const operations = Array.from(this.operations.values());
    
    return {
      total: operations.length,
      pending: operations.filter(op => op.status === 'PENDING').length,
      executed: operations.filter(op => op.status === 'EXECUTED').length,
      cancelled: operations.filter(op => op.status === 'CANCELLED').length,
      failed: operations.filter(op => op.status === 'FAILED').length,
      averageDelayMs: operations.reduce((sum, op) => sum + op.delayMs, 0) / (operations.length || 1)
    };
  }
  
  /**
   * Clean up old operations
   */
  public cleanup(olderThanMs: number = 24 * 60 * 60 * 1000): number {
    const cutoff = Date.now() - olderThanMs;
    let cleaned = 0;
    
    for (const [operationId, operation] of this.operations) {
      if (operation.status !== 'PENDING' && operation.initiatedAt.getTime() < cutoff) {
        this.operations.delete(operationId);
        this.executors.delete(operationId);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      this.logger.info(`Cleaned up ${cleaned} old operations`);
    }
    
    return cleaned;
  }
  
  /**
   * Destroy and clean up
   */
  public destroy(): void {
    // Cancel all pending operations
    for (const [operationId, timer] of this.timers) {
      clearTimeout(timer);
      const operation = this.operations.get(operationId);
      if (operation) {
        operation.status = 'CANCELLED';
      }
    }
    
    this.timers.clear();
    this.removeAllListeners();
    this.logger.info('TimeLock destroyed');
  }
} 