/**
 * Example Setup - Shows how to wire up the Integration Layer
 * 
 * This script demonstrates how to initialize and start the
 * complete Noderr Protocol system using the Integration Layer.
 */

import winston from 'winston';
import {
  SystemOrchestrator,
  MessageBus,
  HealthMonitor,
  RecoveryManager,
  ConfigurationService,
  MessageType,
  MessageFactory,
  MessagePriority,
  HealthStatus,
  ModuleStatus
} from '../src';

// Example module class
class ExampleModule {
  name = 'Example Module';
  version = '1.0.0';
  private logger: winston.Logger;
  private started = false;
  
  constructor(logger: winston.Logger, config: any) {
    this.logger = logger;
  }
  
  async initialize(): Promise<void> {
    this.logger.info(`Initializing ${this.name}`);
    // Initialization logic
  }
  
  async start(): Promise<void> {
    this.logger.info(`Starting ${this.name}`);
    this.started = true;
    // Startup logic
  }
  
  async stop(): Promise<void> {
    this.logger.info(`Stopping ${this.name}`);
    this.started = false;
    // Shutdown logic
  }
  
  async healthCheck(): Promise<any> {
    return {
      moduleId: 'example-module',
      moduleName: this.name,
      status: this.started ? HealthStatus.HEALTHY : HealthStatus.UNHEALTHY,
      moduleStatus: this.started ? ModuleStatus.READY : ModuleStatus.STOPPED,
      timestamp: Date.now(),
      latency: 0,
      uptime: process.uptime() * 1000,
      metrics: {
        cpu: { usage: 10, system: 5, user: 5, idle: 90 },
        memory: {
          heapUsed: process.memoryUsage().heapUsed,
          heapTotal: process.memoryUsage().heapTotal,
          external: process.memoryUsage().external,
          rss: process.memoryUsage().rss,
          available: 1000000000,
          percentUsed: 20
        }
      }
    };
  }
}

async function setupSystem() {
  // 1. Create logger
  const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.json()
    ),
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.simple()
        )
      })
    ]
  });
  
  logger.info('🚀 Starting Noderr Protocol System');
  
  // 2. Initialize core components
  const messageBus = new MessageBus(logger, {
    maxQueueSize: 10000,
    enableMetrics: true
  });
  
  const healthMonitor = new HealthMonitor(logger, messageBus, {
    interval: 30000,
    timeout: 5000,
    retries: 3,
    modules: []
  });
  
  const recoveryManager = new RecoveryManager(logger, messageBus, {
    defaultMaxAttempts: 3,
    circuitBreakerThreshold: 5
  });
  
  const configService = new ConfigurationService(logger, messageBus);
  
  // 3. Create system orchestrator
  const orchestrator = new SystemOrchestrator(
    logger,
    messageBus,
    healthMonitor,
    recoveryManager,
    configService
  );
  
  // Link recovery manager with orchestrator
  recoveryManager.setOrchestrator(orchestrator);
  
  // 4. Register modules
  logger.info('📦 Registering modules...');
  
  // In production, these would be your actual trading modules
  orchestrator.registerModule('risk-engine', 'Risk Engine', ExampleModule, {
    dependencies: [],
    config: { maxRisk: 0.02 }
  });
  
  orchestrator.registerModule('market-intel', 'Market Intelligence', ExampleModule, {
    dependencies: [],
    config: { updateInterval: 1000 }
  });
  
  orchestrator.registerModule('ai-core', 'AI Core', ExampleModule, {
    dependencies: ['market-intel'],
    config: { modelPath: './models' }
  });
  
  orchestrator.registerModule('execution-optimizer', 'Execution Optimizer', ExampleModule, {
    dependencies: ['risk-engine', 'ai-core'],
    config: { maxSlippage: 0.001 }
  });
  
  // 5. Set up message handlers
  logger.info('📨 Setting up message handlers...');
  
  // Example: Listen for trade signals
  messageBus.subscribe('ai-core', async (message) => {
    if (message.header.type === MessageType.TRADE_SIGNAL) {
      logger.info('Received trade signal:', message.payload);
      
      // Forward to execution optimizer
      await messageBus.send(
        MessageFactory.create(
          MessageType.ORDER_REQUEST,
          'system',
          'execution-optimizer',
          {
            ...message.payload,
            timestamp: Date.now()
          },
          { priority: MessagePriority.HIGH }
        )
      );
    }
  });
  
  // Example: Listen for health alerts
  healthMonitor.on('health:alert', (alert) => {
    logger.warn('Health alert:', alert);
  });
  
  // Example: Listen for recovery events
  recoveryManager.on('recovery:started', (action) => {
    logger.info('Recovery started:', action);
  });
  
  // 6. Start the system
  logger.info('🔧 Starting system...');
  
  try {
    await orchestrator.start({
      parallel: true,
      timeout: 30000,
      continueOnError: false
    });
    
    logger.info('✅ System started successfully!');
    
    // 7. Display system status
    const status = orchestrator.getStatus();
    logger.info('System Status:', {
      status: status.status,
      uptime: status.uptime,
      modules: status.modules,
      health: status.health
    });
    
    // 8. Example: Send a test message
    await messageBus.send(
      MessageFactory.create(
        MessageType.MARKET_DATA,
        'test',
        'market-intel',
        {
          symbol: 'BTC/USDT',
          price: 45000,
          volume: 1000,
          bid: 44999,
          ask: 45001,
          timestamp: Date.now()
        }
      )
    );
    
    // 9. Get performance metrics
    const metrics = messageBus.getPerformanceMetrics();
    logger.info('Message Bus Metrics:', metrics);
    
  } catch (error) {
    logger.error('Failed to start system:', error);
    process.exit(1);
  }
  
  // 10. Handle shutdown
  process.on('SIGINT', async () => {
    logger.info('🛑 Shutting down system...');
    
    try {
      await orchestrator.stop({
        graceful: true,
        timeout: 10000
      });
      
      logger.info('✅ System shutdown complete');
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown:', error);
      process.exit(1);
    }
  });
  
  // Keep process alive
  process.stdin.resume();
}

// Run the setup
setupSystem().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
}); 