/**
 * SystemOrchestrator - Central command and control for all modules
 * 
 * Manages module lifecycle, dependency resolution, startup/shutdown
 * sequencing, and system-wide coordination for the Noderr Protocol.
 */

import { EventEmitter } from 'events';
import { Logger } from 'winston';
import { MessageBus } from '../bus/MessageBus';
import { HealthMonitor } from '../health/HealthMonitor';
import { RecoveryManager } from '../recovery/RecoveryManager';
// import { ConfigurationService } from '@noderr/config'; // TODO: Fix config package exports
import {
  ModuleStatus,
  HealthStatus,
  Message,
  MessageType,
  MessageFactory,
  MessagePriority,
  ModuleRegistration
} from '@noderr/types';

// Phase 4: Meta-Governance Intelligence (TODO: Sprint 2+)
// import { MetaGovernanceOrchestrator } from '../../../meta-governance/src/MetaGovernanceOrchestrator';
// import { StrategyVotingEngine } from '../../../meta-governance/src/StrategyVotingEngine';
// import { SignalElection } from '../../../meta-governance/src/SignalElection';
// import { RiskPolicyManager } from '../../../meta-governance/src/RiskPolicyManager';
// import { GovernanceAuditLog } from '../../../meta-governance/src/GovernanceAuditLog';

// Phase 5: Autonomous Deployment Pipeline (TODO: Sprint 2+)
// import { DeploymentOrchestrator } from '../../../deployment-pipeline/src/DeploymentOrchestrator';
// import { CIValidator } from '../../../deployment-pipeline/src/CIValidator';
// import { CanaryLauncher } from '../../../deployment-pipeline/src/CanaryLauncher';
// import { LivePromoter } from '../../../deployment-pipeline/src/LivePromoter';
// import { RollbackEngine } from '../../../deployment-pipeline/src/RollbackEngine';
// import { DeploymentDashboardHook } from '../../../deployment-pipeline/src/DeploymentDashboardHook';

// Phase 6: Adaptive Capital Allocation AI
import { DynamicWeightAllocator } from '@noderr/capital-ai';
import { CapitalFlowOptimizer } from '@noderr/capital-ai';
import { PortfolioSentinel } from '@noderr/capital-ai';
import { CapitalStrategyDashboard } from '@noderr/capital-ai';

// Existing module imports
// import { AIModuleService } from '../../../ai-core/src';
// import { AlphaExploitationService } from '../../../alpha-exploitation/src';
// import { RiskEngineService } from '../../../risk-engine/src';
// import { ExecutionOptimizer } from '../../../execution-optimizer/src';

export interface Module {
  id: string;
  name: string;
  version: string;
  instance: any;
  status: ModuleStatus;
  dependencies: string[];
  startTime?: number;
  lastActivity?: number;
  errorCount: number;
  metadata?: Record<string, any>;
}

interface SystemState {
  status: 'initializing' | 'starting' | 'running' | 'stopping' | 'stopped' | 'error';
  startTime?: number;
  modules: Map<string, Module>;
  readyModules: Set<string>;
  failedModules: Set<string>;
}

interface StartupOptions {
  parallel?: boolean;
  timeout?: number;
  retryFailedModules?: boolean;
  continueOnError?: boolean;
}

interface ShutdownOptions {
  graceful?: boolean;
  timeout?: number;
  force?: boolean;
}

export class SystemOrchestrator extends EventEmitter {
  private logger: Logger;
  private messageBus: MessageBus;
  private healthMonitor: HealthMonitor;
  private recoveryManager: RecoveryManager;
  private configService: ConfigurationService;
  
  private state: SystemState = {
    status: 'stopped',
    modules: new Map(),
    readyModules: new Set(),
    failedModules: new Set()
  };
  
  private moduleRegistry: Map<string, any> = new Map();
  private startupOrder: string[] = [];
  private shutdownOrder: string[] = [];
  
  constructor(
    logger: Logger,
    messageBus: MessageBus,
    healthMonitor: HealthMonitor,
    recoveryManager: RecoveryManager,
    configService: ConfigurationService
  ) {
    super();
    this.logger = logger;
    this.messageBus = messageBus;
    this.healthMonitor = healthMonitor;
    this.recoveryManager = recoveryManager;
    this.configService = configService;
    
    this.setupInternalHandlers();
  }
  
  /**
   * Register a module with the orchestrator
   */
  registerModule(
    id: string,
    name: string,
    moduleClass: any,
    options?: {
      dependencies?: string[];
      config?: any;
      autoStart?: boolean;
    }
  ): void {
    this.logger.info(`Registering module: ${name} (${id})`);
    
    // Store module class
    this.moduleRegistry.set(id, {
      class: moduleClass,
      config: options?.config || {},
      dependencies: options?.dependencies || [],
      autoStart: options?.autoStart ?? true
    });
    
    // Add to startup order (will be sorted by dependencies)
    if (!this.startupOrder.includes(id)) {
      this.startupOrder.push(id);
    }
    
    this.emit('module:registered', { id, name });
  }
  
  /**
   * Start the system
   */
  async start(options?: StartupOptions): Promise<void> {
    if (this.state.status !== 'stopped') {
      throw new Error(`Cannot start system in ${this.state.status} state`);
    }
    
    this.logger.info('Starting Noderr Protocol system');
    this.state.status = 'initializing';
    this.state.startTime = Date.now();
    
    try {
      // Load configuration
      await this.configService.load();
      
      // Start core services
      await this.startCoreServices();
      
      // Sort modules by dependencies
      const sortedModules = this.sortModulesByDependencies();
      
      // Initialize modules
      this.state.status = 'starting';
      
      if (options?.parallel) {
        await this.startModulesParallel(sortedModules, options);
      } else {
        await this.startModulesSequential(sortedModules, options);
      }
      
      // Verify all required modules are ready
      this.verifySystemReady();
      
      this.state.status = 'running';
      this.logger.info('Noderr Protocol system started successfully', {
        totalModules: this.state.modules.size,
        readyModules: this.state.readyModules.size,
        startupTime: Date.now() - this.state.startTime!
      });
      
      // Send system ready notification
      await this.broadcastSystemEvent(MessageType.SYSTEM_STARTUP, {
        timestamp: Date.now(),
        modules: Array.from(this.state.readyModules)
      });
      
      this.emit('system:ready');
    } catch (error) {
      this.state.status = 'error';
      this.logger.error('System startup failed', { error });
      
      // Attempt cleanup
      await this.emergencyShutdown();
      
      throw error;
    }
  }
  
  /**
   * Stop the system
   */
  async stop(options?: ShutdownOptions): Promise<void> {
    if (this.state.status === 'stopped' || this.state.status === 'stopping') {
      this.logger.warn('System already stopped or stopping');
      return;
    }
    
    this.logger.info('Stopping Noderr Protocol system');
    this.state.status = 'stopping';
    
    try {
      // Send shutdown notification
      await this.broadcastSystemEvent(MessageType.SYSTEM_SHUTDOWN, {
        timestamp: Date.now(),
        graceful: options?.graceful ?? true
      });
      
      // Stop modules in reverse order
      if (options?.graceful !== false) {
        await this.stopModulesGraceful(options);
      } else {
        await this.stopModulesForced();
      }
      
      // Stop core services
      await this.stopCoreServices();
      
      this.state.status = 'stopped';
      this.state.modules.clear();
      this.state.readyModules.clear();
      this.state.failedModules.clear();
      
      this.logger.info('Noderr Protocol system stopped');
      this.emit('system:stopped');
    } catch (error) {
      this.logger.error('Error during system shutdown', { error });
      
      if (options?.force) {
        await this.emergencyShutdown();
      }
      
      throw error;
    }
  }
  
  /**
   * Get system status
   */
  getStatus(): {
    status: string;
    uptime: number;
    modules: {
      total: number;
      ready: number;
      failed: number;
      starting: number;
    };
    health: HealthStatus;
  } {
    const moduleStatuses = Array.from(this.state.modules.values());
    
    return {
      status: this.state.status,
      uptime: this.state.startTime ? Date.now() - this.state.startTime : 0,
      modules: {
        total: this.state.modules.size,
        ready: this.state.readyModules.size,
        failed: this.state.failedModules.size,
        starting: moduleStatuses.filter(m => m.status === ModuleStatus.STARTING).length
      },
      health: this.calculateSystemHealth()
    };
  }
  
  /**
   * Get module information
   */
  getModule(moduleId: string): Module | undefined {
    return this.state.modules.get(moduleId);
  }
  
  /**
   * Get all modules
   */
  getAllModules(): Module[] {
    return Array.from(this.state.modules.values());
  }
  
  /**
   * Restart a specific module
   */
  async restartModule(moduleId: string): Promise<void> {
    const module = this.state.modules.get(moduleId);
    if (!module) {
      throw new Error(`Module not found: ${moduleId}`);
    }
    
    this.logger.info(`Restarting module: ${module.name}`);
    
    // Stop module
    await this.stopModule(module);
    
    // Start module
    await this.startModule(moduleId);
    
    this.logger.info(`Module restarted: ${module.name}`);
  }
  
  /**
   * Private: Setup internal message handlers
   */
  private setupInternalHandlers(): void {
    // Handle module registration messages
    this.messageBus.subscribe(
      'system.orchestrator',
      async (message: Message<ModuleRegistration>) => {
        if (message.header.type === MessageType.MODULE_REGISTER) {
          await this.handleModuleRegistration(message.payload);
        }
      },
      { module: 'orchestrator', priority: MessagePriority.HIGH }
    );
    
    // Handle module ready notifications
    this.messageBus.subscribe(
      'system.orchestrator',
      async (message: Message) => {
        if (message.header.type === MessageType.MODULE_READY) {
          await this.handleModuleReady(message.header.source);
        }
      },
      { module: 'orchestrator', priority: MessagePriority.HIGH }
    );
    
    // Handle module errors
    this.messageBus.subscribe(
      'system.orchestrator',
      async (message: Message) => {
        if (message.header.type === MessageType.MODULE_ERROR) {
          await this.handleModuleError(message.header.source, message.payload);
        }
      },
      { module: 'orchestrator', priority: MessagePriority.CRITICAL }
    );
    
    // Subscribe to health updates
    this.healthMonitor.on('module:unhealthy', (moduleId: string) => {
      this.handleModuleUnhealthy(moduleId);
    });
    
    // Subscribe to recovery actions
    this.recoveryManager.on('recovery:needed', (moduleId: string) => {
      this.initiateModuleRecovery(moduleId);
    });
  }
  
  /**
   * Private: Start core services
   */
  private async startCoreServices(): Promise<void> {
    this.logger.info('Starting core services');
    
    // Start message bus
    await this.messageBus.start();
    
    // Start health monitor
    await this.healthMonitor.start();
    
    // Start recovery manager
    await this.recoveryManager.start();
    
    this.logger.info('Core services started');
  }
  
  /**
   * Private: Stop core services
   */
  private async stopCoreServices(): Promise<void> {
    this.logger.info('Stopping core services');
    
    await this.recoveryManager.stop();
    await this.healthMonitor.stop();
    await this.messageBus.stop();
    
    this.logger.info('Core services stopped');
  }
  
  /**
   * Private: Sort modules by dependencies
   */
  private sortModulesByDependencies(): string[] {
    const sorted: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();
    
    const visit = (moduleId: string) => {
      if (visited.has(moduleId)) return;
      if (visiting.has(moduleId)) {
        throw new Error(`Circular dependency detected involving module: ${moduleId}`);
      }
      
      visiting.add(moduleId);
      
      const moduleInfo = this.moduleRegistry.get(moduleId);
      if (moduleInfo) {
        for (const dep of moduleInfo.dependencies) {
          if (this.moduleRegistry.has(dep)) {
            visit(dep);
          }
        }
      }
      
      visiting.delete(moduleId);
      visited.add(moduleId);
      sorted.push(moduleId);
    };
    
    for (const moduleId of this.startupOrder) {
      visit(moduleId);
    }
    
    return sorted;
  }
  
  /**
   * Private: Start modules sequentially
   */
  private async startModulesSequential(
    moduleIds: string[],
    options: StartupOptions
  ): Promise<void> {
    for (const moduleId of moduleIds) {
      const moduleInfo = this.moduleRegistry.get(moduleId);
      if (!moduleInfo || !moduleInfo.autoStart) continue;
      
      try {
        await this.startModule(moduleId, options);
      } catch (error) {
        this.logger.error(`Failed to start module: ${moduleId}`, { error });
        
        if (!options.continueOnError) {
          throw error;
        }
      }
    }
  }
  
  /**
   * Private: Start modules in parallel
   */
  private async startModulesParallel(
    moduleIds: string[],
    options: StartupOptions
  ): Promise<void> {
    // Group modules by dependency level
    const levels: string[][] = [];
    const moduleLevel = new Map<string, number>();
    
    const calculateLevel = (moduleId: string): number => {
      if (moduleLevel.has(moduleId)) {
        return moduleLevel.get(moduleId)!;
      }
      
      const moduleInfo = this.moduleRegistry.get(moduleId);
      if (!moduleInfo) return 0;
      
      let maxDepLevel = -1;
      for (const dep of moduleInfo.dependencies) {
        if (this.moduleRegistry.has(dep)) {
          maxDepLevel = Math.max(maxDepLevel, calculateLevel(dep));
        }
      }
      
      const level = maxDepLevel + 1;
      moduleLevel.set(moduleId, level);
      
      if (!levels[level]) {
        levels[level] = [];
      }
      levels[level].push(moduleId);
      
      return level;
    };
    
    // Calculate levels for all modules
    for (const moduleId of moduleIds) {
      calculateLevel(moduleId);
    }
    
    // Start modules level by level
    for (const levelModules of levels) {
      if (!levelModules) continue;
      
      const promises = levelModules
        .filter(id => {
          const info = this.moduleRegistry.get(id);
          return info && info.autoStart;
        })
        .map(id => this.startModule(id, options).catch(error => {
          this.logger.error(`Failed to start module: ${id}`, { error });
          if (!options.continueOnError) {
            throw error;
          }
        }));
      
      await Promise.all(promises);
    }
  }
  
  /**
   * Private: Start a single module
   */
  private async startModule(
    moduleId: string,
    options?: StartupOptions
  ): Promise<void> {
    this.logger.info(`Starting module: ${moduleId}`);
    
    const moduleInfo = this.moduleRegistry.get(moduleId);
    if (!moduleInfo) {
      throw new Error(`Module not registered: ${moduleId}`);
    }
    
    // Check dependencies
    for (const dep of moduleInfo.dependencies) {
      if (!this.state.readyModules.has(dep)) {
        throw new Error(`Dependency not ready: ${dep} (required by ${moduleId})`);
      }
    }
    
    try {
      // Create module instance
      const instance = new moduleInfo.class(this.logger, moduleInfo.config);
      
      // Create module record
      const module: Module = {
        id: moduleId,
        name: instance.name || moduleId,
        version: instance.version || '1.0.0',
        instance,
        status: ModuleStatus.STARTING,
        dependencies: moduleInfo.dependencies,
        errorCount: 0
      };
      
      this.state.modules.set(moduleId, module);
      
      // Initialize module
      if (instance.initialize) {
        await instance.initialize();
      }
      
      // Start module
      if (instance.start) {
        const timeout = options?.timeout || 30000;
        await Promise.race([
          instance.start(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Module startup timeout')), timeout)
          )
        ]);
      }
      
      // Update status
      module.status = ModuleStatus.READY;
      module.startTime = Date.now();
      this.state.readyModules.add(moduleId);
      
      // Register with health monitor
      this.healthMonitor.registerModule(moduleId, {
        name: module.name,
        healthCheck: instance.healthCheck?.bind(instance)
      });
      
      this.logger.info(`Module started: ${module.name}`);
      this.emit('module:started', module);
    } catch (error) {
      const module = this.state.modules.get(moduleId);
      if (module) {
        module.status = ModuleStatus.ERROR;
        module.errorCount++;
      }
      
      this.state.failedModules.add(moduleId);
      
      throw error;
    }
  }
  
  /**
   * Private: Stop modules gracefully
   */
  private async stopModulesGraceful(options?: ShutdownOptions): Promise<void> {
    const timeout = options?.timeout || 30000;
    const moduleIds = Array.from(this.state.modules.keys()).reverse();
    
    for (const moduleId of moduleIds) {
      const module = this.state.modules.get(moduleId);
      if (!module) continue;
      
      try {
        await Promise.race([
          this.stopModule(module),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Module shutdown timeout')), timeout)
          )
        ]);
      } catch (error) {
        this.logger.error(`Error stopping module ${module.name}`, { error });
      }
    }
  }
  
  /**
   * Private: Force stop all modules
   */
  private async stopModulesForced(): Promise<void> {
    const promises = Array.from(this.state.modules.values()).map(module => 
      this.stopModule(module).catch(error => 
        this.logger.error(`Error force stopping module ${module.name}`, { error })
      )
    );
    
    await Promise.all(promises);
  }
  
  /**
   * Private: Stop a single module
   */
  private async stopModule(module: Module): Promise<void> {
    this.logger.info(`Stopping module: ${module.name}`);
    
    module.status = ModuleStatus.STOPPING;
    
    try {
      // Unregister from health monitor
      this.healthMonitor.unregisterModule(module.id);
      
      // Stop module
      if (module.instance.stop) {
        await module.instance.stop();
      }
      
      // Cleanup
      if (module.instance.cleanup) {
        await module.instance.cleanup();
      }
      
      module.status = ModuleStatus.STOPPED;
      this.state.readyModules.delete(module.id);
      
      this.logger.info(`Module stopped: ${module.name}`);
      this.emit('module:stopped', module);
    } catch (error) {
      this.logger.error(`Error stopping module ${module.name}`, { error });
      throw error;
    }
  }
  
  /**
   * Private: Emergency shutdown
   */
  private async emergencyShutdown(): Promise<void> {
    this.logger.warn('Performing emergency shutdown');
    
    // Force stop all modules
    await this.stopModulesForced();
    
    // Stop core services
    try {
      await this.stopCoreServices();
    } catch (error) {
      this.logger.error('Error during emergency shutdown', { error });
    }
    
    this.state.status = 'stopped';
  }
  
  /**
   * Private: Verify system ready
   */
  private verifySystemReady(): void {
    const failed = Array.from(this.state.failedModules);
    
    if (failed.length > 0) {
      this.logger.warn(`System started with failed modules: ${failed.join(', ')}`);
    }
    
    // Check critical modules
    const criticalModules = ['risk-engine', 'execution-optimizer'];
    const missingCritical = criticalModules.filter(id => !this.state.readyModules.has(id));
    
    if (missingCritical.length > 0) {
      throw new Error(`Critical modules not ready: ${missingCritical.join(', ')}`);
    }
  }
  
  /**
   * Private: Calculate system health
   */
  private calculateSystemHealth(): HealthStatus {
    const totalModules = this.state.modules.size;
    const readyModules = this.state.readyModules.size;
    const failedModules = this.state.failedModules.size;
    
    if (failedModules > 0) {
      return HealthStatus.DEGRADED;
    }
    
    if (readyModules === totalModules) {
      return HealthStatus.HEALTHY;
    }
    
    if (readyModules / totalModules < 0.5) {
      return HealthStatus.UNHEALTHY;
    }
    
    return HealthStatus.DEGRADED;
  }
  
  /**
   * Private: Handle module registration
   */
  private async handleModuleRegistration(registration: ModuleRegistration): Promise<void> {
    const module = this.state.modules.get(registration.moduleId);
    if (!module) return;
    
    module.metadata = {
      ...module.metadata,
      capabilities: registration.capabilities,
      endpoints: registration.endpoints
    };
    
    this.logger.info(`Module registered capabilities: ${module.name}`, {
      capabilities: registration.capabilities
    });
  }
  
  /**
   * Private: Handle module ready
   */
  private async handleModuleReady(moduleId: string): Promise<void> {
    const module = this.state.modules.get(moduleId);
    if (!module) return;
    
    module.status = ModuleStatus.READY;
    module.lastActivity = Date.now();
    this.state.readyModules.add(moduleId);
    this.state.failedModules.delete(moduleId);
    
    this.logger.info(`Module ready: ${module.name}`);
    this.emit('module:ready', module);
  }
  
  /**
   * Private: Handle module error
   */
  private async handleModuleError(moduleId: string, error: any): Promise<void> {
    const module = this.state.modules.get(moduleId);
    if (!module) return;
    
    module.errorCount++;
    module.lastActivity = Date.now();
    
    this.logger.error(`Module error: ${module.name}`, { error });
    
    // Trigger recovery if needed
    if (module.errorCount > 3) {
      await this.initiateModuleRecovery(moduleId);
    }
  }
  
  /**
   * Private: Handle module unhealthy
   */
  private async handleModuleUnhealthy(moduleId: string): Promise<void> {
    const module = this.state.modules.get(moduleId);
    if (!module) return;
    
    module.status = ModuleStatus.ERROR;
    this.state.readyModules.delete(moduleId);
    this.state.failedModules.add(moduleId);
    
    this.logger.warn(`Module unhealthy: ${module.name}`);
    
    // Initiate recovery
    await this.initiateModuleRecovery(moduleId);
  }
  
  /**
   * Private: Initiate module recovery
   */
  private async initiateModuleRecovery(moduleId: string): Promise<void> {
    const module = this.state.modules.get(moduleId);
    if (!module) return;
    
    this.logger.info(`Initiating recovery for module: ${module.name}`);
    
    try {
      await this.recoveryManager.recoverModule(moduleId, {
        errorCount: module.errorCount,
        lastError: module.metadata?.lastError
      });
    } catch (error) {
      this.logger.error(`Recovery failed for module: ${module.name}`, { error });
    }
  }
  
  /**
   * Private: Broadcast system event
   */
  private async broadcastSystemEvent(type: MessageType, payload: any): Promise<void> {
    const message = MessageFactory.create(
      type,
      'system.orchestrator',
      '*',
      payload,
      { priority: MessagePriority.HIGH }
    );
    
    await this.messageBus.send(message);
  }
} 