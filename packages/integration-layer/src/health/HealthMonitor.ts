/**
 * HealthMonitor - System-wide health monitoring and alerting
 * 
 * Monitors the health of all modules, tracks metrics, and triggers
 * alerts when health degradation is detected.
 */

import { EventEmitter } from 'events';
import { Logger } from 'winston';
import * as os from 'os';
import { performance } from 'perf_hooks';
import {
  HealthStatus,
  HealthCheckResult,
  HealthMetrics,
  SystemHealth,
  HealthAlert,
  HealthCheckConfig,
  ModuleHealthConfig,
  HealthHistory,
  HealthUtils,
  Message,
  MessageType,
  MessageFactory
} from '@noderr/types/src';
import { MessageBus } from '../bus/MessageBus';

interface RegisteredModule {
  id: string;
  name: string;
  healthCheck?: () => Promise<HealthCheckResult>;
  config: ModuleHealthConfig;
  lastCheck?: HealthCheckResult;
  checkInProgress: boolean;
  history: HealthHistory;
}

interface HealthMonitorState {
  started: boolean;
  modules: Map<string, RegisteredModule>;
  alerts: Map<string, HealthAlert>;
  checkTimer?: NodeJS.Timer;
  metricsTimer?: NodeJS.Timer;
}

export class HealthMonitor extends EventEmitter {
  private logger: Logger;
  private messageBus: MessageBus;
  private config: HealthCheckConfig;
  private state: HealthMonitorState = {
    started: false,
    modules: new Map(),
    alerts: new Map()
  };
  
  private systemStartTime: number = Date.now();
  private lastSystemHealth?: SystemHealth;
  
  constructor(logger: Logger, messageBus: MessageBus, config?: HealthCheckConfig) {
    super();
    this.logger = logger;
    this.messageBus = messageBus;
    this.config = config || this.getDefaultConfig();
  }
  
  /**
   * Start health monitoring
   */
  async start(): Promise<void> {
    if (this.state.started) {
      this.logger.warn('HealthMonitor already started');
      return;
    }
    
    this.logger.info('Starting HealthMonitor');
    this.state.started = true;
    
    // Start health check timer
    this.state.checkTimer = setInterval(
      () => this.performHealthChecks(),
      this.config.interval
    );
    
    // Start metrics collection timer
    this.state.metricsTimer = setInterval(
      () => this.collectSystemMetrics(),
      5000 // Every 5 seconds
    );
    
    // Perform initial health check
    await this.performHealthChecks();
    
    this.logger.info('HealthMonitor started');
  }
  
  /**
   * Stop health monitoring
   */
  async stop(): Promise<void> {
    if (!this.state.started) return;
    
    this.logger.info('Stopping HealthMonitor');
    this.state.started = false;
    
    // Clear timers
    if (this.state.checkTimer) {
      clearInterval(this.state.checkTimer);
      this.state.checkTimer = undefined;
    }
    
    if (this.state.metricsTimer) {
      clearInterval(this.state.metricsTimer);
      this.state.metricsTimer = undefined;
    }
    
    this.logger.info('HealthMonitor stopped');
  }
  
  /**
   * Register a module for health monitoring
   */
  registerModule(
    moduleId: string,
    options: {
      name: string;
      healthCheck?: () => Promise<HealthCheckResult>;
      config?: Partial<ModuleHealthConfig>;
    }
  ): void {
    const config: ModuleHealthConfig = {
      moduleId,
      enabled: true,
      interval: this.config.interval,
      timeout: this.config.timeout,
      checks: ['basic', 'metrics'],
      ...options.config
    };
    
    const module: RegisteredModule = {
      id: moduleId,
      name: options.name,
      healthCheck: options.healthCheck,
      config,
      checkInProgress: false,
      history: {
        moduleId,
        entries: [],
        summary: {
          period: 0,
          uptime: 100,
          avgCpu: 0,
          avgMemory: 0,
          errorCount: 0,
          statusChanges: 0,
          mttr: 0,
          mtbf: 0
        }
      }
    };
    
    this.state.modules.set(moduleId, module);
    this.logger.info(`Registered module for health monitoring: ${options.name}`);
  }
  
  /**
   * Unregister a module from health monitoring
   */
  unregisterModule(moduleId: string): void {
    const module = this.state.modules.get(moduleId);
    if (module) {
      this.state.modules.delete(moduleId);
      this.logger.info(`Unregistered module from health monitoring: ${module.name}`);
    }
  }
  
  /**
   * Get current system health
   */
  getSystemHealth(): SystemHealth | undefined {
    return this.lastSystemHealth;
  }
  
  /**
   * Get module health
   */
  getModuleHealth(moduleId: string): HealthCheckResult | undefined {
    return this.state.modules.get(moduleId)?.lastCheck;
  }
  
  /**
   * Get all health alerts
   */
  getAlerts(): HealthAlert[] {
    return Array.from(this.state.alerts.values());
  }
  
  /**
   * Get active alerts (unresolved)
   */
  getActiveAlerts(): HealthAlert[] {
    return Array.from(this.state.alerts.values()).filter(a => !a.resolved);
  }
  
  /**
   * Force health check for specific module
   */
  async checkModuleHealth(moduleId: string): Promise<HealthCheckResult | undefined> {
    const module = this.state.modules.get(moduleId);
    if (!module) return undefined;
    
    return await this.performModuleHealthCheck(module);
  }
  
  /**
   * Private: Get default configuration
   */
  private getDefaultConfig(): HealthCheckConfig {
    return {
      interval: 30000, // 30 seconds
      timeout: 5000, // 5 seconds
      retries: 3,
      enabled: true,
      modules: []
    };
  }
  
  /**
   * Private: Perform health checks for all modules
   */
  private async performHealthChecks(): Promise<void> {
    const checks: Promise<void>[] = [];
    
    for (const module of this.state.modules.values()) {
      if (module.config.enabled && !module.checkInProgress) {
        checks.push(this.performModuleHealthCheck(module).then(result => {
          if (result) {
            this.processHealthCheckResult(module, result);
          }
        }).catch(error => {
          this.logger.error(`Health check failed for module ${module.name}`, { error });
        }));
      }
    }
    
    await Promise.all(checks);
    
    // Update system health
    await this.updateSystemHealth();
  }
  
  /**
   * Private: Perform health check for a single module
   */
  private async performModuleHealthCheck(module: RegisteredModule): Promise<HealthCheckResult | null> {
    module.checkInProgress = true;
    const startTime = performance.now();
    
    try {
      let result: HealthCheckResult;
      
      if (module.healthCheck) {
        // Use custom health check
        result = await Promise.race([
          module.healthCheck(),
          new Promise<HealthCheckResult>((_, reject) => 
            setTimeout(() => reject(new Error('Health check timeout')), module.config.timeout)
          )
        ]);
      } else {
        // Use default health check
        result = await this.performDefaultHealthCheck(module);
      }
      
      // Add latency
      result.latency = performance.now() - startTime;
      
      // Send health check response
      await this.messageBus.send(
        MessageFactory.create(
          MessageType.HEALTH_RESPONSE,
          module.id,
          'system.health',
          result
        )
      );
      
      return result;
    } catch (error) {
      return {
        moduleId: module.id,
        moduleName: module.name,
        status: HealthStatus.UNHEALTHY,
        moduleStatus: 'error' as any,
        timestamp: Date.now(),
        latency: performance.now() - startTime,
        uptime: 0,
        lastError: error instanceof Error ? error.message : 'Unknown error',
        metrics: this.getEmptyMetrics()
      };
    } finally {
      module.checkInProgress = false;
    }
  }
  
  /**
   * Private: Perform default health check
   */
  private async performDefaultHealthCheck(module: RegisteredModule): Promise<HealthCheckResult> {
    const metrics = await this.collectModuleMetrics(module);
    
    return {
      moduleId: module.id,
      moduleName: module.name,
      status: HealthStatus.HEALTHY,
      moduleStatus: 'ready' as any,
      timestamp: Date.now(),
      latency: 0,
      uptime: Date.now() - this.systemStartTime,
      metrics
    };
  }
  
  /**
   * Private: Collect module metrics
   */
  private async collectModuleMetrics(module: RegisteredModule): Promise<HealthMetrics> {
    const cpuUsage = process.cpuUsage();
    const memUsage = process.memoryUsage();
    
    return {
      cpu: {
        usage: os.loadavg()[0] * 100 / os.cpus().length,
        system: cpuUsage.system / 1000000,
        user: cpuUsage.user / 1000000,
        idle: 100 - (os.loadavg()[0] * 100 / os.cpus().length)
      },
      memory: {
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        external: memUsage.external,
        rss: memUsage.rss,
        available: os.freemem(),
        percentUsed: (memUsage.rss / os.totalmem()) * 100
      }
    };
  }
  
  /**
   * Private: Process health check result
   */
  private processHealthCheckResult(module: RegisteredModule, result: HealthCheckResult): void {
    const previousStatus = module.lastCheck?.status;
    module.lastCheck = result;
    
    // Update history
    module.history.entries.push({
      timestamp: result.timestamp,
      status: result.status,
      metrics: result.metrics,
      alerts: result.lastError ? [result.lastError] : undefined
    });
    
    // Limit history size
    if (module.history.entries.length > 1000) {
      module.history.entries.shift();
    }
    
    // Check for status change
    if (previousStatus && previousStatus !== result.status) {
      this.handleStatusChange(module, previousStatus, result.status);
    }
    
    // Check thresholds
    this.checkThresholds(module, result);
    
    // Emit health update
    this.emit('health:updated', result);
  }
  
  /**
   * Private: Handle module status change
   */
  private handleStatusChange(
    module: RegisteredModule,
    previousStatus: HealthStatus,
    newStatus: HealthStatus
  ): void {
    this.logger.info(`Module ${module.name} status changed: ${previousStatus} -> ${newStatus}`);
    
    if (newStatus === HealthStatus.UNHEALTHY) {
      this.createAlert(module.id, 'error', `Module ${module.name} is unhealthy`);
      this.emit('module:unhealthy', module.id);
    } else if (newStatus === HealthStatus.DEGRADED) {
      this.createAlert(module.id, 'warning', `Module ${module.name} is degraded`);
      this.emit('module:degraded', module.id);
    } else if (newStatus === HealthStatus.HEALTHY && previousStatus !== HealthStatus.HEALTHY) {
      this.resolveAlert(module.id);
      this.emit('module:recovered', module.id);
    }
    
    module.history.summary.statusChanges++;
  }
  
  /**
   * Private: Check thresholds
   */
  private checkThresholds(module: RegisteredModule, result: HealthCheckResult): void {
    const thresholds = module.config.thresholds;
    if (!thresholds) return;
    
    // Check CPU thresholds
    if (thresholds.cpu) {
      const cpuUsage = result.metrics.cpu.usage;
      if (cpuUsage > thresholds.cpu.critical) {
        this.createAlert(module.id, 'critical', `CPU usage critical: ${cpuUsage.toFixed(1)}%`);
      } else if (cpuUsage > thresholds.cpu.warning) {
        this.createAlert(module.id, 'warning', `CPU usage high: ${cpuUsage.toFixed(1)}%`);
      }
    }
    
    // Check memory thresholds
    if (thresholds.memory) {
      const memUsage = result.metrics.memory.percentUsed;
      if (memUsage > thresholds.memory.critical) {
        this.createAlert(module.id, 'critical', `Memory usage critical: ${memUsage.toFixed(1)}%`);
      } else if (memUsage > thresholds.memory.warning) {
        this.createAlert(module.id, 'warning', `Memory usage high: ${memUsage.toFixed(1)}%`);
      }
    }
    
    // Check latency thresholds
    if (thresholds.latency) {
      const latency = result.latency;
      if (latency > thresholds.latency.critical) {
        this.createAlert(module.id, 'critical', `Health check latency critical: ${latency.toFixed(0)}ms`);
      } else if (latency > thresholds.latency.warning) {
        this.createAlert(module.id, 'warning', `Health check latency high: ${latency.toFixed(0)}ms`);
      }
    }
  }
  
  /**
   * Private: Create alert
   */
  private createAlert(
    moduleId: string,
    severity: 'info' | 'warning' | 'error' | 'critical',
    message: string
  ): void {
    const alertId = `alert_${moduleId}_${Date.now()}`;
    
    const alert: HealthAlert = {
      id: alertId,
      severity,
      module: moduleId,
      message,
      timestamp: Date.now(),
      acknowledged: false,
      resolved: false
    };
    
    this.state.alerts.set(moduleId, alert);
    this.emit('health:alert', alert);
    
    this.logger.warn(`Health alert created: ${message}`, { severity, module: moduleId });
  }
  
  /**
   * Private: Resolve alert
   */
  private resolveAlert(moduleId: string): void {
    const alert = this.state.alerts.get(moduleId);
    if (alert && !alert.resolved) {
      alert.resolved = true;
      alert.resolvedAt = Date.now();
      
      this.logger.info(`Health alert resolved for module: ${moduleId}`);
    }
  }
  
  /**
   * Private: Update system health
   */
  private async updateSystemHealth(): Promise<void> {
    const modules = Array.from(this.state.modules.values());
    const results = modules.map(m => m.lastCheck).filter(r => r !== undefined) as HealthCheckResult[];
    
    if (results.length === 0) return;
    
    // Calculate aggregate metrics
    const aggregateMetrics = this.calculateAggregateMetrics(results);
    
    // Get module summaries
    const moduleSummaries = modules.map(m => ({
      moduleId: m.id,
      moduleName: m.name,
      status: m.lastCheck?.status || HealthStatus.UNKNOWN,
      uptime: m.lastCheck?.uptime || 0,
      errorCount: m.history.summary.errorCount,
      lastCheck: m.lastCheck?.timestamp || 0
    }));
    
    // Get active alerts
    const alerts = this.getActiveAlerts();
    
    // Generate recommendations
    const recommendations = this.generateRecommendations(results, alerts);
    
    this.lastSystemHealth = {
      status: HealthUtils.calculateOverallStatus(results),
      timestamp: Date.now(),
      modules: moduleSummaries,
      aggregateMetrics,
      alerts,
      recommendations
    };
    
    this.emit('system:health:updated', this.lastSystemHealth);
  }
  
  /**
   * Private: Calculate aggregate metrics
   */
  private calculateAggregateMetrics(results: HealthCheckResult[]): any {
    const totalModules = results.length;
    const healthyModules = results.filter(r => r.status === HealthStatus.HEALTHY).length;
    const degradedModules = results.filter(r => r.status === HealthStatus.DEGRADED).length;
    const unhealthyModules = results.filter(r => r.status === HealthStatus.UNHEALTHY).length;
    
    const avgCpuUsage = results.reduce((sum, r) => sum + r.metrics.cpu.usage, 0) / totalModules;
    const avgMemoryUsage = results.reduce((sum, r) => sum + r.metrics.memory.percentUsed, 0) / totalModules;
    const totalMemoryUsed = results.reduce((sum, r) => sum + r.metrics.memory.rss, 0);
    
    return {
      totalModules,
      healthyModules,
      degradedModules,
      unhealthyModules,
      avgCpuUsage,
      avgMemoryUsage,
      totalMemoryUsed,
      totalConnections: 0, // Would be tracked separately
      totalRequestsPerSecond: 0 // Would be tracked separately
    };
  }
  
  /**
   * Private: Generate recommendations
   */
  private generateRecommendations(results: HealthCheckResult[], alerts: HealthAlert[]): string[] {
    const recommendations: string[] = [];
    
    // Check for high CPU usage
    const highCpuModules = results.filter(r => r.metrics.cpu.usage > 80);
    if (highCpuModules.length > 0) {
      recommendations.push(`High CPU usage detected in ${highCpuModules.length} modules. Consider scaling or optimization.`);
    }
    
    // Check for memory issues
    const highMemModules = results.filter(r => r.metrics.memory.percentUsed > 80);
    if (highMemModules.length > 0) {
      recommendations.push(`High memory usage in ${highMemModules.length} modules. Monitor for memory leaks.`);
    }
    
    // Check for critical alerts
    const criticalAlerts = alerts.filter(a => a.severity === 'critical');
    if (criticalAlerts.length > 0) {
      recommendations.push(`${criticalAlerts.length} critical alerts require immediate attention.`);
    }
    
    // Check for degraded modules
    const degradedModules = results.filter(r => r.status === HealthStatus.DEGRADED);
    if (degradedModules.length > 0) {
      recommendations.push(`${degradedModules.length} modules are degraded. Review logs and metrics.`);
    }
    
    return recommendations;
  }
  
  /**
   * Private: Collect system metrics
   */
  private async collectSystemMetrics(): Promise<void> {
    const metrics = {
      cpu: os.loadavg(),
      memory: {
        total: os.totalmem(),
        free: os.freemem(),
        used: os.totalmem() - os.freemem()
      },
      uptime: os.uptime()
    };
    
    this.emit('metrics:collected', metrics);
  }
  
  /**
   * Private: Get empty metrics
   */
  private getEmptyMetrics(): HealthMetrics {
    return {
      cpu: { usage: 0, system: 0, user: 0, idle: 100 },
      memory: {
        heapUsed: 0,
        heapTotal: 0,
        external: 0,
        rss: 0,
        available: 0,
        percentUsed: 0
      }
    };
  }
} 