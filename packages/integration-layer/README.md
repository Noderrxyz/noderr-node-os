# Integration Layer - Noderr Protocol

The Integration Layer provides a production-ready orchestration system for the Noderr Protocol, managing all modules with ultra-low latency messaging, comprehensive health monitoring, and automated recovery mechanisms.

## 🚀 Features

### Core Capabilities
- **System Orchestration**: Centralized module lifecycle management with dependency resolution
- **Message Bus**: 10K+ msg/sec with <100μs average latency
- **Health Monitoring**: Real-time health checks with Prometheus integration
- **Recovery Management**: Automated failure recovery with circuit breakers
- **Configuration Service**: Hot-reload configuration with validation

### Performance Metrics
- **Message Latency**: <100μs average, <1ms P99
- **Throughput**: 10,000+ messages/second
- **CPU Overhead**: <1% for monitoring
- **Recovery Time**: <5 seconds for module restart
- **Uptime Target**: 99.9%

## 📦 Installation

```bash
npm install @noderr/integration-layer
```

## 🔧 Usage

### Basic Setup

```typescript
import {
  SystemOrchestrator,
  MessageBus,
  HealthMonitor,
  RecoveryManager,
  ConfigurationService
} from '@noderr/integration-layer';
import winston from 'winston';

// Create logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [new winston.transports.Console()]
});

// Initialize components
const messageBus = new MessageBus(logger);
const healthMonitor = new HealthMonitor(logger, messageBus);
const recoveryManager = new RecoveryManager(logger, messageBus);
const configService = new ConfigurationService(logger, messageBus);

// Create orchestrator
const orchestrator = new SystemOrchestrator(
  logger,
  messageBus,
  healthMonitor,
  recoveryManager,
  configService
);

// Set orchestrator reference for recovery
recoveryManager.setOrchestrator(orchestrator);

// Register modules
orchestrator.registerModule('risk-engine', 'Risk Engine', RiskEngineModule, {
  dependencies: [],
  config: { /* module config */ }
});

orchestrator.registerModule('market-intel', 'Market Intelligence', MarketIntelModule, {
  dependencies: ['risk-engine'],
  config: { /* module config */ }
});

// Start system
await orchestrator.start({
  parallel: true,
  timeout: 30000,
  continueOnError: false
});
```

### Message Bus Usage

```typescript
// Subscribe to messages
messageBus.subscribe('trade.*', async (message) => {
  console.log('Received trade message:', message);
}, {
  module: 'my-module',
  priority: MessagePriority.HIGH
});

// Send messages
await messageBus.send(MessageFactory.create(
  MessageType.TRADE_SIGNAL,
  'my-module',
  'execution-optimizer',
  {
    symbol: 'BTC/USDT',
    action: 'BUY',
    quantity: 0.1
  }
));

// Get performance metrics
const metrics = messageBus.getPerformanceMetrics();
console.log('Message bus metrics:', metrics);
```

### Health Monitoring

```typescript
// Register module health check
healthMonitor.registerModule('my-module', {
  name: 'My Module',
  healthCheck: async () => ({
    moduleId: 'my-module',
    moduleName: 'My Module',
    status: HealthStatus.HEALTHY,
    moduleStatus: ModuleStatus.READY,
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
        available: os.freemem(),
        percentUsed: 20
      }
    }
  })
});

// Get system health
const health = healthMonitor.getSystemHealth();
```

### Recovery Configuration

```typescript
// Register custom recovery strategy
recoveryManager.registerStrategy({
  module: 'critical-module',
  triggers: [
    {
      type: 'error_rate',
      threshold: 0.1,
      duration: 30000,
      comparison: 'gt'
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
  maxAttempts: 5,
  backoffMultiplier: 1.5,
  cooldownPeriod: 30000
});
```

### Configuration Management

```typescript
// Load configuration
await configService.load('./config/production.json');

// Get configuration
const config = configService.getConfig();
const moduleConfig = configService.getModuleConfig('risk-engine');

// Update configuration at runtime
await configService.updateConfig('health.interval', 60000, {
  validate: true,
  persist: true,
  broadcast: true
});

// Handle configuration updates
configService.on('config:updated', (update) => {
  console.log('Config updated:', update);
});
```

## 🏗️ Architecture

### Component Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      System Orchestrator                         │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │   Module    │  │   Lifecycle  │  │    Dependency         │  │
│  │  Registry   │  │   Manager    │  │     Resolver          │  │
│  └─────────────┘  └──────────────┘  └───────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        │                       │                       │
┌───────▼────────┐     ┌────────▼────────┐    ┌────────▼────────┐
│  Message Bus   │     │ Health Monitor  │    │Recovery Manager │
│                │     │                 │    │                 │
│ • 10K+ msg/sec │     │ • Health Checks │    │ • Auto Recovery │
│ • <100μs P50   │     │ • Metrics       │    │ • Circuit Break │
│ • Priority Q   │     │ • Alerts        │    │ • Failover      │
└────────────────┘     └─────────────────┘    └─────────────────┘
```

### Message Flow

1. **Module Registration**: Modules register with orchestrator
2. **Dependency Resolution**: Orchestrator resolves startup order
3. **Message Routing**: MessageBus handles inter-module communication
4. **Health Monitoring**: Continuous health checks and metrics
5. **Failure Recovery**: Automatic recovery on failure detection

## 🔐 Production Deployment

### Environment Variables

```bash
# Configuration
NODERR_CONFIG_PATH=/path/to/config.json
NODE_ENV=production

# Health Monitoring
HEALTH_PORT=3000
HEALTH_CHECK_INTERVAL=30000

# Metrics
METRICS_ENDPOINT=http://prometheus:9090
LOG_LEVEL=info

# Secrets
NODERR_SECRET_API_KEY=your-api-key
NODERR_SECRET_DB_PASSWORD=your-password
```

### Health Endpoint

The health endpoint provides comprehensive system status:

```bash
GET /health

{
  "status": "healthy",
  "timestamp": 1703123456789,
  "modules": [
    {
      "moduleId": "risk-engine",
      "status": "healthy",
      "uptime": 3600000,
      "metrics": {
        "cpu": 15.2,
        "memory": 23.5
      }
    }
  ],
  "aggregateMetrics": {
    "totalModules": 8,
    "healthyModules": 8,
    "avgCpuUsage": 18.7,
    "avgMemoryUsage": 31.2
  }
}
```

### Monitoring Integration

```yaml
# Prometheus scrape config
scrape_configs:
  - job_name: 'noderr-protocol'
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: '/metrics'
```

## 🧪 Testing

```bash
# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Run integration tests
npm run test:integration
```

## 📊 Performance Tuning

### Message Bus Optimization
```typescript
const messageBus = new MessageBus(logger, {
  maxQueueSize: 50000,           // Increase for high load
  processingInterval: 0,         // Use setImmediate
  latencyWarningThreshold: 500,  // Alert on slow messages
  enableMetrics: true,
  enableTracing: false           // Disable in production
});
```

### Health Check Tuning
```typescript
const healthConfig = {
  interval: 60000,    // Check every minute
  timeout: 5000,      // 5 second timeout
  retries: 3,         // Retry failed checks
  modules: [
    {
      moduleId: 'critical-module',
      interval: 30000,  // More frequent for critical
      thresholds: {
        cpu: { warning: 60, critical: 80 },
        memory: { warning: 70, critical: 90 }
      }
    }
  ]
};
```

## 🚨 Troubleshooting

### Common Issues

1. **High Message Latency**
   - Check queue sizes: `messageBus.getPerformanceMetrics()`
   - Reduce message size or increase processing threads
   - Enable message compression for large payloads

2. **Module Recovery Loops**
   - Check circuit breaker status
   - Increase cooldown period
   - Review error logs for root cause

3. **Memory Leaks**
   - Monitor heap usage over time
   - Check for event listener leaks
   - Review message retention policies

## 📝 License

MIT License - See LICENSE file for details

## 🤝 Contributing

Contributions welcome! Please read CONTRIBUTING.md first.

## 📞 Support

- Documentation: https://docs.noderr.io
- Issues: https://github.com/noderr/protocol/issues
- Discord: https://discord.gg/noderr 