/**
 * RecoveryManager - Module failure recovery and resilience management
 * 
 * Handles module failures with configurable recovery strategies,
 * circuit breakers, and automated failover mechanisms.
 */

import { EventEmitter } from 'events';
import { Logger } from 'winston';
import {
  RecoveryAction,
  RecoveryActionType,
  RecoveryStrategy,
  RecoveryTrigger,
  RecoveryActionConfig,
  Message,
  MessageType,
  MessageFactory
} from '@noderr/types/src';
import { MessageBus } from '../bus/MessageBus';
import { SystemOrchestrator } from '../core/SystemOrchestrator';

interface ModuleRecoveryState {
  moduleId: string;
  failureCount: number;
  lastFailure?: number;
  recoveryAttempts: number;
  lastRecovery?: number;
  circuitBreakerState: 'closed' | 'open' | 'half-open';
  circuitBreakerOpenedAt?: number;
  backoffDelay: number;
}

interface RecoveryManagerState {
  started: boolean;
  moduleStates: Map<string, ModuleRecoveryState>;
  activeRecoveries: Map<string, RecoveryAction>;
  strategies: Map<string, RecoveryStrategy>;
  defaultStrategy?: RecoveryStrategy;
}

interface RecoveryMetrics {
  totalRecoveries: number;
  successfulRecoveries: number;
  failedRecoveries: number;
  circuitBreakersOpen: number;
  averageRecoveryTime: number;
}

export class RecoveryManager extends EventEmitter {
  private logger: Logger;
  private messageBus: MessageBus;
  private orchestrator?: SystemOrchestrator;
  private state: RecoveryManagerState = {
    started: false,
    moduleStates: new Map(),
    activeRecoveries: new Map(),
    strategies: new Map()
  };
  
  private metrics: RecoveryMetrics = {
    totalRecoveries: 0,
    successfulRecoveries: 0,
    failedRecoveries: 0,
    circuitBreakersOpen: 0,
    averageRecoveryTime: 0
  };
  
  private config = {
    defaultMaxAttempts: 3,
    defaultBackoffMultiplier: 2,
    defaultCooldownPeriod: 60000, // 1 minute
    circuitBreakerThreshold: 5,
    circuitBreakerTimeout: 300000, // 5 minutes
    halfOpenTestPeriod: 30000 // 30 seconds
  };
  
  constructor(
    logger: Logger,
    messageBus: MessageBus,
    config?: Partial<typeof RecoveryManager.prototype.config>
  ) {
    super();
    this.logger = logger;
    this.messageBus = messageBus;
    
    if (config) {
      this.config = { ...this.config, ...config };
    }
    
    this.setupDefaultStrategies();
  }
  
  /**
   * Set the system orchestrator reference
   */
  setOrchestrator(orchestrator: SystemOrchestrator): void {
    this.orchestrator = orchestrator;
  }
  
  /**
   * Start the recovery manager
   */
  async start(): Promise<void> {
    if (this.state.started) {
      this.logger.warn('RecoveryManager already started');
      return;
    }
    
    this.logger.info('Starting RecoveryManager');
    this.state.started = true;
    
    // Subscribe to module error messages
    this.messageBus.subscribe(
      'recovery.*',
      this.handleModuleError.bind(this),
      { module: 'recovery-manager' }
    );
    
    this.logger.info('RecoveryManager started');
  }
  
  /**
   * Stop the recovery manager
   */
  async stop(): Promise<void> {
    if (!this.state.started) return;
    
    this.logger.info('Stopping RecoveryManager');
    this.state.started = false;
    
    // Cancel active recoveries
    for (const [moduleId, recovery] of this.state.activeRecoveries) {
      this.logger.warn(`Cancelling active recovery for module: ${moduleId}`);
      recovery.success = false;
      this.emit('recovery:cancelled', recovery);
    }
    
    this.state.activeRecoveries.clear();
    
    this.logger.info('RecoveryManager stopped');
  }
  
  /**
   * Register a recovery strategy
   */
  registerStrategy(strategy: RecoveryStrategy): void {
    this.state.strategies.set(strategy.module, strategy);
    this.logger.info(`Registered recovery strategy for module: ${strategy.module}`);
  }
  
  /**
   * Recover a specific module
   */
  async recoverModule(
    moduleId: string,
    context?: {
      errorCount?: number;
      lastError?: string;
      triggerType?: string;
    }
  ): Promise<void> {
    // Check if recovery already in progress
    if (this.state.activeRecoveries.has(moduleId)) {
      this.logger.warn(`Recovery already in progress for module: ${moduleId}`);
      return;
    }
    
    // Get or create module state
    const moduleState = this.getOrCreateModuleState(moduleId);
    
    // Check circuit breaker
    if (moduleState.circuitBreakerState === 'open') {
      const elapsed = Date.now() - moduleState.circuitBreakerOpenedAt!;
      if (elapsed < this.config.circuitBreakerTimeout) {
        this.logger.warn(`Circuit breaker open for module: ${moduleId}`);
        return;
      } else {
        // Transition to half-open
        moduleState.circuitBreakerState = 'half-open';
        this.logger.info(`Circuit breaker half-open for module: ${moduleId}`);
      }
    }
    
    // Update failure count
    if (context?.errorCount) {
      moduleState.failureCount = context.errorCount;
    }
    moduleState.lastFailure = Date.now();
    
    // Get recovery strategy
    const strategy = this.getStrategyForModule(moduleId);
    
    // Check if max attempts exceeded
    if (moduleState.recoveryAttempts >= strategy.maxAttempts) {
      this.openCircuitBreaker(moduleState);
      return;
    }
    
    // Create recovery action
    const action: RecoveryAction = {
      id: `recovery_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: this.determineRecoveryAction(moduleState, strategy),
      module: moduleId,
      reason: context?.lastError || 'Module failure detected',
      config: {},
      timestamp: Date.now(),
      attempts: moduleState.recoveryAttempts + 1,
      status: 'pending'
    };
    
    this.state.activeRecoveries.set(moduleId, action);
    moduleState.recoveryAttempts++;
    
    this.emit('recovery:started', action);
    this.logger.info(`Starting recovery for module ${moduleId}`, {
      action: action.action,
      attempt: action.attempts
    });
    
    // Execute recovery
    try {
      await this.executeRecoveryAction(action, strategy);
      
      // Success
      action.success = true;
      moduleState.lastRecovery = Date.now();
      
      // Reset state on successful recovery
      if (moduleState.circuitBreakerState === 'half-open') {
        moduleState.circuitBreakerState = 'closed';
        this.metrics.circuitBreakersOpen--;
      }
      moduleState.failureCount = 0;
      moduleState.recoveryAttempts = 0;
      moduleState.backoffDelay = 0;
      
      this.metrics.successfulRecoveries++;
      
      this.logger.info(`Recovery successful for module: ${moduleId}`);
      this.emit('recovery:completed', action);
    } catch (error) {
      // Failure
      action.success = false;
      action.error = error instanceof Error ? error.message : 'Recovery failed';
      
      // Update backoff delay
      moduleState.backoffDelay = Math.min(
        moduleState.backoffDelay * strategy.backoffMultiplier,
        strategy.cooldownPeriod
      );
      
      this.metrics.failedRecoveries++;
      
      this.logger.error(`Recovery failed for module: ${moduleId}`, { error });
      this.emit('recovery:failed', action);
      
      // Check if circuit breaker should open
      if (moduleState.circuitBreakerState === 'half-open' ||
          moduleState.failureCount >= this.config.circuitBreakerThreshold) {
        this.openCircuitBreaker(moduleState);
      }
    } finally {
      this.state.activeRecoveries.delete(moduleId);
      this.metrics.totalRecoveries++;
      
      // Update average recovery time
      const recoveryTime = Date.now() - action.timestamp;
      this.metrics.averageRecoveryTime = 
        (this.metrics.averageRecoveryTime * (this.metrics.totalRecoveries - 1) + recoveryTime) /
        this.metrics.totalRecoveries;
    }
  }
  
  /**
   * Get recovery metrics
   */
  getMetrics(): RecoveryMetrics {
    return { ...this.metrics };
  }
  
  /**
   * Get module recovery state
   */
  getModuleState(moduleId: string): ModuleRecoveryState | undefined {
    return this.state.moduleStates.get(moduleId);
  }
  
  /**
   * Private: Setup default recovery strategies
   */
  private setupDefaultStrategies(): void {
    // Default strategy for all modules
    this.state.defaultStrategy = {
      module: '*',
      triggers: [
        {
          type: 'error_rate',
          threshold: 0.5,
          duration: 60000,
          comparison: '>'
        }
      ],
      actions: [
        {
          type: RecoveryActionType.RESTART,
          priority: 1,
          delay: 1000,
          timeout: 30000
        },
        {
          type: RecoveryActionType.RESET,
          priority: 2,
          delay: 5000,
          timeout: 60000
        },
        {
          type: RecoveryActionType.ALERT_ONLY,
          priority: 3,
          delay: 0
        }
      ],
      maxAttempts: this.config.defaultMaxAttempts,
      backoffMultiplier: this.config.defaultBackoffMultiplier,
      cooldownPeriod: this.config.defaultCooldownPeriod
    };
    
    // Critical module strategies
    const criticalModules = ['risk-engine', 'execution-optimizer'];
    
    for (const moduleId of criticalModules) {
      this.registerStrategy({
        module: moduleId,
        triggers: [
          {
            type: 'error_rate',
            threshold: 0.1, // More sensitive
            duration: 30000,
            comparison: '>'
          }
        ],
        actions: [
          {
            type: RecoveryActionType.RESTART,
            priority: 1,
            delay: 500,
            timeout: 15000
          },
          {
            type: RecoveryActionType.FAILOVER,
            priority: 2,
            delay: 1000,
            timeout: 30000
          }
        ],
        maxAttempts: 5, // More attempts for critical modules
        backoffMultiplier: 1.5,
        cooldownPeriod: 30000
      });
    }
  }
  
  /**
   * Private: Get or create module state
   */
  private getOrCreateModuleState(moduleId: string): ModuleRecoveryState {
    let state = this.state.moduleStates.get(moduleId);
    
    if (!state) {
      state = {
        moduleId,
        failureCount: 0,
        recoveryAttempts: 0,
        circuitBreakerState: 'closed',
        backoffDelay: 1000
      };
      
      this.state.moduleStates.set(moduleId, state);
    }
    
    return state;
  }
  
  /**
   * Private: Get strategy for module
   */
  private getStrategyForModule(moduleId: string): RecoveryStrategy {
    return this.state.strategies.get(moduleId) || this.state.defaultStrategy!;
  }
  
  /**
   * Private: Determine recovery action
   */
  private determineRecoveryAction(
    moduleState: ModuleRecoveryState,
    strategy: RecoveryStrategy
  ): RecoveryActionType {
    // Sort actions by priority
    const sortedActions = [...strategy.actions].sort((a, b) => {
      const aPriority = typeof a === 'object' ? (a.priority || 0) : 0;
      const bPriority = typeof b === 'object' ? (b.priority || 0) : 0;
      return aPriority - bPriority;
    });
    
    // Find appropriate action based on attempt number
    const actionIndex = Math.min(moduleState.recoveryAttempts, sortedActions.length - 1);
    const action = sortedActions[actionIndex];
    
    return typeof action === 'object' ? action.type : action;
  }
  
  /**
   * Private: Execute recovery action
   */
  private async executeRecoveryAction(
    action: RecoveryAction,
    strategy: RecoveryStrategy
  ): Promise<void> {
    const actionConfig = strategy.actions.find(a => {
      const actionType = typeof a === 'object' ? a.type : a;
      return actionType === action.type;
    });
    if (!actionConfig) {
      throw new Error(`No configuration for action: ${action.type}`);
    }
    
    // Apply delay
    const delay = typeof actionConfig === 'object' ? actionConfig.delay : undefined;
    if (delay) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    // Execute with timeout
    const timeout = (typeof actionConfig === 'object' ? actionConfig.timeout : undefined) || 30000;
    
    await Promise.race([
      this.executeAction(action.module, action.action, actionConfig),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Recovery action timeout')), timeout)
      )
    ]);
  }
  
  /**
   * Private: Execute specific recovery action
   */
  private async executeAction(
    moduleId: string,
    actionType: RecoveryActionType,
    config: RecoveryActionConfig
  ): Promise<void> {
    switch (actionType) {
      case RecoveryActionType.RESTART:
        await this.restartModule(moduleId);
        break;
        
      case RecoveryActionType.RELOAD:
        await this.reloadModule(moduleId);
        break;
        
      case RecoveryActionType.RESET:
        await this.resetModule(moduleId);
        break;
        
      case RecoveryActionType.FAILOVER:
        await this.failoverModule(moduleId);
        break;
        
      case RecoveryActionType.CIRCUIT_BREAK:
        await this.circuitBreakModule(moduleId);
        break;
        
      case RecoveryActionType.ROLLBACK:
        await this.rollbackModule(moduleId);
        break;
        
      case RecoveryActionType.SCALE_DOWN:
        await this.scaleDownModule(moduleId);
        break;
        
      case RecoveryActionType.ALERT_ONLY:
        await this.alertOnly(moduleId);
        break;
        
      default:
        throw new Error(`Unknown recovery action: ${actionType}`);
    }
  }
  
  /**
   * Private: Restart module
   */
  private async restartModule(moduleId: string): Promise<void> {
    if (!this.orchestrator) {
      throw new Error('Orchestrator not available');
    }
    
    this.logger.info(`Restarting module: ${moduleId}`);
    await this.orchestrator.restartModule(moduleId);
  }
  
  /**
   * Private: Reload module configuration
   */
  private async reloadModule(moduleId: string): Promise<void> {
    this.logger.info(`Reloading module configuration: ${moduleId}`);
    
    // Send reload message
    await this.messageBus.send(
      MessageFactory.create(
        MessageType.CONFIG_UPDATE,
        'recovery.manager',
        moduleId,
        { action: 'reload' }
      )
    );
  }
  
  /**
   * Private: Reset module state
   */
  private async resetModule(moduleId: string): Promise<void> {
    this.logger.info(`Resetting module state: ${moduleId}`);
    
    // Send reset message
    await this.messageBus.send(
      MessageFactory.create(
        MessageType.MODULE_RESET as any,
        'recovery.manager',
        moduleId,
        { action: 'reset', clearState: true }
      )
    );
  }
  
  /**
   * Private: Failover to backup module
   */
  private async failoverModule(moduleId: string): Promise<void> {
    this.logger.info(`Initiating failover for module: ${moduleId}`);
    
    // In production, this would switch to a backup instance
    // For now, just restart with different configuration
    await this.messageBus.send(
      MessageFactory.create(
        MessageType.MODULE_FAILOVER as any,
        'recovery.manager',
        `${moduleId}.backup`,
        { primaryModule: moduleId }
      )
    );
  }
  
  /**
   * Private: Circuit break module
   */
  private async circuitBreakModule(moduleId: string): Promise<void> {
    this.logger.info(`Circuit breaking module: ${moduleId}`);
    
    const moduleState = this.getOrCreateModuleState(moduleId);
    this.openCircuitBreaker(moduleState);
  }
  
  /**
   * Private: Rollback module to previous version
   */
  private async rollbackModule(moduleId: string): Promise<void> {
    this.logger.info(`Rolling back module: ${moduleId}`);
    
    // Send rollback message
    await this.messageBus.send(
      MessageFactory.create(
        MessageType.MODULE_ROLLBACK as any,
        'recovery.manager',
        moduleId,
        { action: 'rollback' }
      )
    );
  }
  
  /**
   * Private: Scale down module resources
   */
  private async scaleDownModule(moduleId: string): Promise<void> {
    this.logger.info(`Scaling down module: ${moduleId}`);
    
    // Send scale down message
    await this.messageBus.send(
      MessageFactory.create(
        MessageType.MODULE_SCALE as any,
        'recovery.manager',
        moduleId,
        { action: 'scale_down', factor: 0.5 }
      )
    );
  }
  
  /**
   * Private: Alert only (no recovery action)
   */
  private async alertOnly(moduleId: string): Promise<void> {
    this.logger.warn(`Module ${moduleId} requires manual intervention`);
    
    // Send alert
    await this.messageBus.send(
      MessageFactory.create(
        MessageType.MODULE_ALERT as any,
        'recovery.manager',
        'alerting.system',
        {
          module: moduleId,
          severity: 'critical',
          message: `Module ${moduleId} failed recovery - manual intervention required`
        }
      )
    );
  }
  
  /**
   * Private: Open circuit breaker
   */
  private openCircuitBreaker(moduleState: ModuleRecoveryState): void {
    moduleState.circuitBreakerState = 'open';
    moduleState.circuitBreakerOpenedAt = Date.now();
    this.metrics.circuitBreakersOpen++;
    
    this.logger.warn(`Circuit breaker opened for module: ${moduleState.moduleId}`);
    this.emit('circuit-breaker:opened', moduleState.moduleId);
    
    // Schedule circuit breaker check
    setTimeout(() => {
      if (moduleState.circuitBreakerState === 'open') {
        moduleState.circuitBreakerState = 'half-open';
        this.logger.info(`Circuit breaker half-open for module: ${moduleState.moduleId}`);
      }
    }, this.config.circuitBreakerTimeout);
  }
  
  /**
   * Private: Handle module error messages
   */
  private async handleModuleError(message: Message): Promise<void> {
    if (message.header.type !== MessageType.MODULE_ERROR) return;
    
    const moduleId = message.header.source;
    const error = message.payload;
    
    this.logger.debug(`Received error from module ${moduleId}`, { error });
    
    // Check if recovery is needed
    const moduleState = this.getOrCreateModuleState(moduleId);
    const strategy = this.getStrategyForModule(moduleId);
    
    // Check triggers
    for (const trigger of strategy.triggers) {
      if (this.evaluateTrigger(trigger, moduleState, error)) {
        this.emit('recovery:needed', moduleId);
        await this.recoverModule(moduleId, {
          lastError: error.message || 'Unknown error'
        });
        break;
      }
    }
  }
  
  /**
   * Private: Evaluate recovery trigger
   */
  private evaluateTrigger(
    trigger: RecoveryTrigger,
    moduleState: ModuleRecoveryState,
    error: any
  ): boolean {
    switch (trigger.type) {
      case 'error_rate':
        // Simple error rate check
        moduleState.failureCount++;
        const errorRate = moduleState.failureCount / Math.max(1, trigger.duration / 1000);
        return this.compareValue(errorRate, trigger.threshold, trigger.comparison);
        
      case 'latency':
        // Would check latency metrics
        return false;
        
      case 'memory':
        // Would check memory usage
        return false;
        
      case 'cpu':
        // Would check CPU usage
        return false;
        
      case 'custom':
        // Would evaluate custom condition
        return false;
        
      default:
        return false;
    }
  }
  
  /**
   * Private: Compare values based on comparison operator
   */
  private compareValue(value: number, threshold: number, comparison: 'gt' | 'lt' | 'eq'): boolean {
    switch (comparison) {
      case 'gt':
        return value > threshold;
      case 'lt':
        return value < threshold;
      case 'eq':
        return value === threshold;
      default:
        return false;
    }
  }
} 