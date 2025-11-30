import { EventEmitter } from 'events';
import * as winston from 'winston';
// TODO: Sprint 2+ - Re-enable when packages are migrated
// import { PositionReconciliation } from '../../execution-engine/src/PositionReconciliation';
// import { OrderLifecycleManager } from '../../execution-engine/src/OrderLifecycleManager';
// import { DynamicRiskLimits } from '@noderr/risk-engine';
// import { ComplianceEngine } from '../../compliance/src/ComplianceEngine';
// import { MultiAssetManager } from '../../multi-asset/src/MultiAssetManager';
// import { ModelVersioningSystem } from '../../ml-enhanced/src/ModelVersioning';
// import { NetworkPartitionSafety } from '@noderr/decentralized-core';

export interface SystemConfig {
  name: string;
  version: string;
  environment: 'development' | 'staging' | 'production';
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  components: ComponentConfig[];
}

export interface ComponentConfig {
  name: string;
  enabled: boolean;
  config: Record<string, any>;
}

export interface SystemStatus {
  status: 'initializing' | 'running' | 'degraded' | 'stopping' | 'stopped' | 'error';
  uptime: number;
  components: Map<string, ComponentStatus>;
  metrics: SystemMetrics;
  alerts: SystemAlert[];
}

export interface ComponentStatus {
  name: string;
  status: 'running' | 'stopped' | 'error';
  health: 'healthy' | 'degraded' | 'unhealthy';
  lastUpdate: Date;
  metrics?: Record<string, any>;
}

export interface SystemMetrics {
  ordersProcessed: number;
  positionsHeld: number;
  totalVolume: number;
  activeAlerts: number;
  systemLoad: number;
  memoryUsage: number;
  latencyP95: number;
}

export interface SystemAlert {
  id: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  component: string;
  message: string;
  timestamp: Date;
  resolved: boolean;
}

interface ComponentState {
  name: string;
  status: 'running' | 'stopped' | 'error' | 'restarting' | 'failed';
  restartHistory: number[];
  lastHealthCheck?: Date;
  healthCheckFailures: number;
}

export class SystemOrchestrator extends EventEmitter {
  private logger: winston.Logger;
  private config: SystemConfig;
  private components: Map<string, any> = new Map();
  private status: SystemStatus;
  private startTime: Date;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private metricsInterval: NodeJS.Timeout | null = null;
  
  // Self-healing configuration
  private componentStates: Map<string, ComponentState> = new Map();
  private readonly MAX_RESTART_ATTEMPTS = 3;
  private readonly RESTART_WINDOW = 300000; // 5 minutes
  private readonly INITIAL_BACKOFF = 1000; // 1 second
  private readonly MAX_BACKOFF = 30000; // 30 seconds
  private readonly COMPONENT_TIMEOUT = 30000; // 30 seconds
  
  constructor(config: SystemConfig) {
    super();
    
    // Initialize logger
    this.logger = winston.createLogger({
      level: config.logLevel,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'noderr-system.log' })
      ]
    });
    
    this.config = config;
    this.startTime = new Date();
    
    this.status = {
      status: 'stopped',
      uptime: 0,
      components: new Map(),
      metrics: {
        ordersProcessed: 0,
        positionsHeld: 0,
        totalVolume: 0,
        activeAlerts: 0,
        systemLoad: 0,
        memoryUsage: 0,
        latencyP95: 0
      },
      alerts: []
    };
  }
  
  async initialize(): Promise<void> {
    this.status.status = 'initializing';
    
    this.logger.info('Initializing Noderr Trading System', {
      name: this.config.name,
      version: this.config.version,
      environment: this.config.environment
    });
    
    try {
      // Initialize components based on configuration
      for (const componentConfig of this.config.components) {
        if (componentConfig.enabled) {
          await this.initializeComponent(componentConfig);
        }
      }
      
      // Set up inter-component communication
      this.setupComponentCommunication();
      
      // Start health monitoring
      this.startHealthMonitoring();
      
      // Start metrics collection
      this.startMetricsCollection();
      
      this.status.status = 'running';
      
      this.logger.info('System initialization complete', {
        components: Array.from(this.components.keys())
      });
      
      this.emit('system-ready');
      
    } catch (error) {
      this.status.status = 'error';
      this.logger.error('System initialization failed', error);
      throw error;
    }
  }
  
  private async initializeComponent(config: ComponentConfig): Promise<void> {
    this.logger.info(`Initializing component: ${config.name}`);
    
    try {
      let component: any;
      
      switch (config.name) {
        case 'positionReconciliation':
          component = new PositionReconciliation(this.logger);
          component.start();
          break;
          
        case 'orderManager':
          component = new OrderLifecycleManager(this.logger);
          break;
          
                 case 'riskLimits':
           component = new DynamicRiskLimits(this.logger, config.config as any);
           component.start();
           break;
           
         case 'compliance':
           component = new ComplianceEngine(this.logger, config.config as any);
           component.start();
           break;
          
        case 'multiAsset':
          component = new MultiAssetManager(this.logger);
          await component.initialize();
          break;
          
        case 'modelVersioning':
          component = new ModelVersioningSystem(this.logger, config.config.basePath);
          await component.initialize();
          break;
          
        case 'networkSafety':
          component = new NetworkPartitionSafety(
            this.logger,
            config.config.nodeId,
            config.config.peers
          );
          component.start();
          break;
          
        default:
          throw new Error(`Unknown component: ${config.name}`);
      }
      
      this.components.set(config.name, component);
      
      this.status.components.set(config.name, {
        name: config.name,
        status: 'running',
        health: 'healthy',
        lastUpdate: new Date()
      });
      
      // Initialize component state for self-healing
      this.componentStates.set(config.name, {
        name: config.name,
        status: 'running',
        restartHistory: [],
        lastHealthCheck: new Date(),
        healthCheckFailures: 0
      });
      
      // Set up component event handlers
      this.setupComponentEventHandlers(config.name, component);
      
    } catch (error) {
      this.logger.error(`Failed to initialize component: ${config.name}`, error);
      
      this.status.components.set(config.name, {
        name: config.name,
        status: 'error',
        health: 'unhealthy',
        lastUpdate: new Date()
      });
      
      throw error;
    }
  }
  
  private setupComponentEventHandlers(name: string, component: any): void {
    // Position Reconciliation events
    if (name === 'positionReconciliation') {
      component.on('reconciliation', (result: any) => {
        this.handleReconciliationResult(result);
      });
      
      component.on('trading-paused', (data: any) => {
        this.handleTradingPaused(data);
      });
      
      component.on('drift-alert', (data: any) => {
        this.createAlert('warning', 'positionReconciliation', 
          `Position drift detected: ${data.drift.toFixed(2)}%`);
      });
    }
    
    // Order Manager events
    if (name === 'orderManager') {
      component.on('order-created', (order: any) => {
        this.status.metrics.ordersProcessed++;
      });
      
      component.on('order-update', (update: any) => {
        if (update.order.status === 'STUCK') {
          this.createAlert('error', 'orderManager', 
            `Order stuck: ${update.order.id}`);
        }
      });
    }
    
    // Risk Limits events
    if (name === 'riskLimits') {
      component.on('violation', (violation: any) => {
        this.handleRiskViolation(violation);
      });
      
      component.on('regime-change', (data: any) => {
        this.createAlert('warning', 'riskLimits', 
          `Market regime changed to: ${data.regime}`);
      });
    }
    
    // Compliance events
    if (name === 'compliance') {
      component.on('compliance-check', (check: any) => {
        if (check.result === 'fail') {
          this.createAlert('critical', 'compliance', 
            `Compliance check failed: ${check.violations.length} violations`);
        }
      });
      
      component.on('aml-alert', (alert: any) => {
        this.createAlert('critical', 'compliance', 
          `AML alert for user ${alert.userId}: ${alert.result}`);
      });
    }
    
    // Network Safety events
    if (name === 'networkSafety') {
      component.on('partition-detected', (partition: any) => {
        this.handleNetworkPartition(partition);
      });
      
      component.on('leader-elected', (data: any) => {
        this.logger.info('New leader elected', data);
      });
    }
  }
  
  private setupComponentCommunication(): void {
    // Connect order manager to risk limits
    const orderManager = this.components.get('orderManager');
    const riskLimits = this.components.get('riskLimits');
    const compliance = this.components.get('compliance');
    
    if (orderManager && riskLimits && compliance) {
      // Pre-trade checks
      orderManager.on('order-created', async (order: any) => {
        // Check risk limits
        const canTrade = riskLimits.canTakePosition(
          order.symbol,
          order.quantity,
          new Map() // Current positions
        );
        
        if (!canTrade) {
          await orderManager.cancelOrder(order.id, 'Risk limit exceeded');
          return;
        }
        
        // Check compliance
        const complianceCheck = await compliance.checkPreTrade({
          id: order.id,
          userId: order.metadata?.userId || 'system',
          symbol: order.symbol,
          side: order.side,
          quantity: order.quantity,
          price: order.price,
          orderType: order.type
        });
        
        if (complianceCheck.result === 'fail') {
          await orderManager.cancelOrder(order.id, 'Compliance check failed');
        }
      });
    }
    
    // Connect position reconciliation to order manager
    const positionReconciliation = this.components.get('positionReconciliation');
    if (positionReconciliation && orderManager) {
      orderManager.on('fill', (data: any) => {
        positionReconciliation.updateInternalPosition(data.order.symbol, {
          symbol: data.order.symbol,
          quantity: data.order.filledQuantity,
          avgPrice: data.order.avgFillPrice,
          unrealizedPnl: 0,
          realizedPnl: 0,
          lastUpdate: new Date()
        });
      });
    }
  }
  
  private startHealthMonitoring(): void {
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, 30000); // Every 30 seconds
    
    // Initial health check
    this.performHealthCheck();
  }
  
  private startMetricsCollection(): void {
    this.metricsInterval = setInterval(() => {
      this.collectMetrics();
    }, 5000); // Every 5 seconds
  }
  
  private async performHealthCheck(): Promise<void> {
    for (const [name, component] of this.components) {
      const componentStatus = this.status.components.get(name);
      const componentState = this.componentStates.get(name);
      if (!componentStatus || !componentState) continue;
      
      try {
        // Check component health
        let health: ComponentStatus['health'] = 'healthy';
        
        // Component-specific health checks
        if (name === 'positionReconciliation') {
          if (component.isPausedForReconciliation()) {
            health = 'degraded';
          }
        }
        
        if (name === 'networkSafety') {
          if (!component.isHealthy()) {
            health = 'unhealthy';
          }
        }
        
        // Generic health check if component supports it
        if (typeof component.healthCheck === 'function') {
          const healthResult = await component.healthCheck();
          if (!healthResult.healthy) {
            health = 'unhealthy';
          }
        }
        
        componentStatus.health = health;
        componentStatus.lastUpdate = new Date();
        componentState.lastHealthCheck = new Date();
        
        // Handle unhealthy components
        if (health === 'unhealthy') {
          componentState.healthCheckFailures++;
          
          if (componentState.healthCheckFailures >= 3) {
            this.logger.warn(`Component ${name} failed multiple health checks`, {
              failures: componentState.healthCheckFailures
            });
            
            // Attempt self-healing
            await this.attemptComponentRecovery(name, component);
          }
        } else {
          // Reset failure count on successful health check
          componentState.healthCheckFailures = 0;
        }
        
      } catch (error) {
        this.logger.error(`Health check failed for ${name}`, error);
        componentState.healthCheckFailures++;
        
        // Component is critically failed, attempt recovery
        if (componentState.healthCheckFailures >= 3) {
          await this.attemptComponentRecovery(name, component);
        }
      }
    }
    
    // Update overall system status
    const unhealthyComponents = Array.from(this.status.components.values())
      .filter(c => c.health === 'unhealthy');
    
    if (unhealthyComponents.length > 0) {
      this.status.status = 'degraded';
    } else if (this.status.status === 'degraded') {
      this.status.status = 'running';
    }
    
    this.emit('health-check', {
      status: this.status.status,
      components: Array.from(this.status.components.values())
    });
  }
  
  private collectMetrics(): void {
    // Update uptime
    this.status.uptime = Date.now() - this.startTime.getTime();
    
    // Collect component metrics
    const orderManager = this.components.get('orderManager');
    if (orderManager) {
      const activeOrders = orderManager.getActiveOrders();
      // Update metrics based on active orders
    }
    
    const positionReconciliation = this.components.get('positionReconciliation');
    if (positionReconciliation) {
      const positions = positionReconciliation.getAllPositions();
      this.status.metrics.positionsHeld = positions.size;
    }
    
    // System metrics
    const memUsage = process.memoryUsage();
    this.status.metrics.memoryUsage = memUsage.heapUsed / 1024 / 1024; // MB
    this.status.metrics.systemLoad = process.cpuUsage().user / 1000000; // seconds
    
    // Active alerts
    this.status.metrics.activeAlerts = this.status.alerts
      .filter(a => !a.resolved).length;
    
    this.emit('metrics-update', this.status.metrics);
  }
  
  private handleReconciliationResult(result: any): void {
    if (result.action === 'pause') {
      this.createAlert('critical', 'positionReconciliation',
        `Trading paused due to position drift: ${result.driftPercentage.toFixed(2)}%`);
      
      // Notify other components
      this.emit('trading-pause', {
        reason: 'position-drift',
        drift: result.driftPercentage
      });
    }
  }
  
  private handleTradingPaused(data: any): void {
    this.status.status = 'degraded';
    
    // Pause order manager
    const orderManager = this.components.get('orderManager');
    if (orderManager) {
      // Cancel all active orders
      const activeOrders = orderManager.getActiveOrders();
             for (const order of activeOrders) {
         orderManager.cancelOrder(order.id, 'Trading paused').catch((err: any) => {
           this.logger.error('Failed to cancel order during trading pause', err);
         });
       }
    }
  }
  
  private handleRiskViolation(violation: any): void {
    this.createAlert(
      violation.severity === 'critical' ? 'critical' : 'warning',
      'riskLimits',
      `Risk limit violation: ${violation.type} (${violation.current} > ${violation.limit})`
    );
    
    if (violation.action === 'block') {
      // Prevent new orders
      this.emit('risk-block', violation);
    }
  }
  
  private handleNetworkPartition(partition: any): void {
    if (partition.action === 'readonly') {
      this.createAlert('critical', 'networkSafety',
        'Network partition detected - entering read-only mode');
      
      this.status.status = 'degraded';
      
      // Switch to read-only mode
      this.emit('readonly-mode', {
        reason: 'network-partition',
        partition
      });
    }
  }
  
  private createAlert(
    severity: SystemAlert['severity'],
    component: string,
    message: string
  ): void {
    const alert: SystemAlert = {
      id: `ALERT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      severity,
      component,
      message,
      timestamp: new Date(),
      resolved: false
    };
    
    this.status.alerts.push(alert);
    
    this.logger[severity === 'critical' ? 'error' : severity](
      `System alert: ${message}`,
      { component, severity }
    );
    
    this.emit('alert', alert);
    
    // Auto-resolve info alerts after 5 minutes
    if (severity === 'info') {
      setTimeout(() => {
        alert.resolved = true;
      }, 300000);
    }
  }
  
  async shutdown(): Promise<void> {
    this.logger.info('Initiating system shutdown');
    this.status.status = 'stopping';
    
    // Stop health monitoring
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }
    
    // Shutdown components in reverse order
    const componentNames = Array.from(this.components.keys()).reverse();
    
    for (const name of componentNames) {
      try {
        this.logger.info(`Shutting down component: ${name}`);
        const component = this.components.get(name);
        
        if (component.stop) {
          await component.stop();
        } else if (component.shutdown) {
          await component.shutdown();
        }
        
        this.status.components.get(name)!.status = 'stopped';
        
      } catch (error) {
        this.logger.error(`Error shutting down component: ${name}`, error);
      }
    }
    
    this.status.status = 'stopped';
    this.logger.info('System shutdown complete');
    
    this.emit('shutdown');
  }
  
  // Public API methods
  getStatus(): SystemStatus {
    return { ...this.status };
  }
  
  getComponent(name: string): any {
    return this.components.get(name);
  }
  
  resolveAlert(alertId: string): boolean {
    const alert = this.status.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.resolved = true;
      return true;
    }
    return false;
  }
  
  async executeCommand(command: string, params: any): Promise<any> {
    this.logger.info('Executing system command', { command, params });
    
    switch (command) {
      case 'pause-trading':
        return this.pauseTrading(params.reason);
        
      case 'resume-trading':
        return this.resumeTrading();
        
      case 'emergency-stop':
        return this.emergencyStop();
        
      case 'reset-risk-limits':
        return this.resetRiskLimits();
        
      default:
        throw new Error(`Unknown command: ${command}`);
    }
  }
  
  private async pauseTrading(reason: string): Promise<void> {
    this.logger.warn('Pausing trading', { reason });
    
    const orderManager = this.components.get('orderManager');
    if (orderManager) {
      const activeOrders = orderManager.getActiveOrders();
      for (const order of activeOrders) {
        await orderManager.cancelOrder(order.id, reason);
      }
    }
    
    this.emit('trading-pause', { reason, manual: true });
  }
  
  private async resumeTrading(): Promise<void> {
    this.logger.info('Resuming trading');
    
    const positionReconciliation = this.components.get('positionReconciliation');
    if (positionReconciliation) {
      positionReconciliation.resumeTrading();
    }
    
    this.emit('trading-resume');
  }
  
  private async emergencyStop(): Promise<void> {
    this.logger.error('EMERGENCY STOP INITIATED');
    
    // Cancel all orders
    const orderManager = this.components.get('orderManager');
    if (orderManager) {
      const activeOrders = orderManager.getActiveOrders();
      await Promise.all(
        activeOrders.map((order: any) => 
          orderManager.cancelOrder(order.id, 'EMERGENCY STOP')
            .catch((err: any) => this.logger.error('Failed to cancel order', err))
        )
      );
    }
    
    // Reduce risk limits to zero
    const riskLimits = this.components.get('riskLimits');
    if (riskLimits) {
      riskLimits.emergencyReduceLimits(0);
    }
    
    this.status.status = 'stopped';
    this.emit('emergency-stop');
  }
  
  private async resetRiskLimits(): Promise<void> {
    const riskLimits = this.components.get('riskLimits');
    if (riskLimits) {
      riskLimits.resetToBaseLimits();
      this.logger.info('Risk limits reset to base values');
    }
  }
  
  private async attemptComponentRecovery(name: string, component: any): Promise<void> {
    const componentState = this.componentStates.get(name);
    if (!componentState) return;
    
    // Check if we've exceeded max restart attempts
    const now = Date.now();
    const recentRestarts = componentState.restartHistory.filter(
      time => now - time < this.RESTART_WINDOW
    );
    
    if (recentRestarts.length >= this.MAX_RESTART_ATTEMPTS) {
      this.logger.error(`Component ${name} exceeded max restart attempts`, {
        attempts: recentRestarts.length,
        window: this.RESTART_WINDOW
      });
      
      componentState.status = 'failed';
      this.emit('component-failed', { name, reason: 'max-restarts-exceeded' });
      return;
    }
    
    // Attempt restart with exponential backoff
    const backoffDelay = Math.min(
      this.INITIAL_BACKOFF * Math.pow(2, recentRestarts.length),
      this.MAX_BACKOFF
    );
    
    this.logger.info(`Attempting to restart component ${name} after ${backoffDelay}ms`, {
      attempt: recentRestarts.length + 1,
      maxAttempts: this.MAX_RESTART_ATTEMPTS
    });
    
    componentState.status = 'restarting';
    componentState.restartHistory.push(now);
    
    // Wait for backoff period
    await new Promise(resolve => setTimeout(resolve, backoffDelay));
    
    try {
      // Stop the component gracefully
      if (typeof component.stop === 'function') {
        await this.withTimeout(component.stop(), this.COMPONENT_TIMEOUT, `${name}.stop()`);
      }
      
      // Re-initialize the component
      if (typeof component.initialize === 'function') {
        await this.withTimeout(component.initialize(), this.COMPONENT_TIMEOUT, `${name}.initialize()`);
      } else if (typeof component.start === 'function') {
        await this.withTimeout(component.start(), this.COMPONENT_TIMEOUT, `${name}.start()`);
      }
      
      // Verify health after restart
      let healthy = true;
      if (typeof component.healthCheck === 'function') {
        const health = await component.healthCheck();
        healthy = health.healthy;
      } else if (typeof component.isHealthy === 'function') {
        healthy = component.isHealthy();
      }
      
      if (healthy) {
        componentState.status = 'running';
        componentState.lastHealthCheck = new Date();
        componentState.healthCheckFailures = 0;
        
        const componentStatus = this.status.components.get(name);
        if (componentStatus) {
          componentStatus.status = 'running';
          componentStatus.health = 'healthy';
        }
        
        this.logger.info(`Component ${name} successfully restarted`);
        this.emit('component-restarted', { name });
      } else {
        throw new Error(`Component unhealthy after restart`);
      }
      
    } catch (error) {
      this.logger.error(`Failed to restart component ${name}`, error);
      componentState.status = 'error';
      
      const componentStatus = this.status.components.get(name);
      if (componentStatus) {
        componentStatus.status = 'error';
        componentStatus.health = 'unhealthy';
      }
      
      // Will retry on next health check cycle
      this.emit('component-restart-failed', { name, error, attempt: recentRestarts.length });
    }
  }
  
  private async withTimeout<T>(promise: Promise<T>, timeout: number, operation: string): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`${operation} timed out after ${timeout}ms`)), timeout);
    });
    
    return Promise.race([promise, timeoutPromise]);
  }
} 