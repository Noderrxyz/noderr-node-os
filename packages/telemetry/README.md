# @noderr/telemetry

Unified telemetry system for the Noderr Protocol, providing comprehensive observability through metrics, monitoring, alerts, and dashboards.

## Overview

This package consolidates all telemetry functionality from:
- `telemetry-layer`: Comprehensive telemetry infrastructure
- `telemetry-enhanced`: Advanced monitoring and aggregation

## Features

### Core Telemetry
- **Metrics Collection**: Real-time performance metrics
- **Distributed Tracing**: End-to-end request tracking
- **Structured Logging**: Centralized log management
- **Error Tracking**: Automatic error capture and analysis

### Monitoring Systems
- **System Monitoring**: CPU, memory, network metrics
- **Application Monitoring**: Request rates, latencies, errors
- **Business Monitoring**: Trade volumes, success rates, P&L
- **Infrastructure Monitoring**: Service health, dependencies

### Alert Management
- **Smart Alerts**: ML-powered anomaly detection
- **Alert Routing**: Channel-based alert distribution
- **Alert Suppression**: Intelligent deduplication
- **Escalation Policies**: Tiered alert handling

### Dashboards
- **Real-time Dashboards**: Live metric visualization
- **Historical Analysis**: Trend analysis and reporting
- **Custom Dashboards**: Configurable views
- **Mobile Support**: Responsive design

## Installation

```bash
npm install @noderr/telemetry
```

## Usage

```typescript
import { 
  TelemetrySystem,
  MetricsCollector,
  AlertManager,
  Dashboard 
} from '@noderr/telemetry';

// Initialize telemetry system
const telemetry = new TelemetrySystem({
  serviceName: 'trading-engine',
  environment: 'production',
  exporters: ['prometheus', 'jaeger']
});

// Collect metrics
const metrics = telemetry.getMetrics();
metrics.counter('trades.executed').increment();
metrics.histogram('trade.latency').record(45);
metrics.gauge('portfolio.value').set(1000000);

// Set up alerts
const alerts = new AlertManager();
alerts.createAlert({
  name: 'high-latency',
  condition: 'trade.latency > 100',
  severity: 'warning',
  channels: ['slack', 'email']
});

// Create dashboard
const dashboard = new Dashboard({
  title: 'Trading Performance',
  refresh: '5s'
});

dashboard.addPanel({
  title: 'Trade Volume',
  metric: 'trades.executed',
  visualization: 'timeseries'
});
```

## Architecture

```
telemetry/
├── core/              # Core telemetry infrastructure
│   ├── TelemetrySystem.ts
│   ├── MetricsRegistry.ts
│   ├── TraceProvider.ts
│   └── LogManager.ts
├── collectors/        # Data collectors
│   ├── SystemCollector.ts
│   ├── ProcessCollector.ts
│   ├── CustomCollector.ts
│   └── AggregationCollector.ts
├── exporters/         # Data exporters
│   ├── PrometheusExporter.ts
│   ├── JaegerExporter.ts
│   ├── ElasticsearchExporter.ts
│   └── CustomExporter.ts
├── alerts/           # Alert system
│   ├── AlertManager.ts
│   ├── AlertRouter.ts
│   ├── AlertSuppressor.ts
│   └── EscalationPolicy.ts
└── dashboards/       # Dashboard components
    ├── DashboardServer.ts
    ├── RealtimeUpdater.ts
    ├── VisualizationEngine.ts
    └── MobileAdapter.ts
```

## Metrics

### System Metrics
- `system.cpu.usage`: CPU utilization percentage
- `system.memory.used`: Memory usage in bytes
- `system.disk.io`: Disk I/O operations
- `system.network.throughput`: Network bytes in/out

### Application Metrics
- `app.requests.total`: Total request count
- `app.requests.duration`: Request duration histogram
- `app.errors.total`: Error count by type
- `app.active.connections`: Current connection count

### Trading Metrics
- `trades.executed.total`: Total trades executed
- `trades.success.rate`: Trade success percentage
- `trades.latency`: Trade execution latency
- `portfolio.value`: Current portfolio value
- `pnl.realized`: Realized profit/loss

## Alerts

### Pre-configured Alerts
- **High Latency**: Trade execution > 100ms
- **Error Rate**: Error rate > 1%
- **System Resources**: CPU/Memory > 80%
- **Trading Anomalies**: Unusual trading patterns
- **Service Health**: Service degradation

### Alert Channels
- Slack
- Email
- PagerDuty
- Webhook
- SMS (via Twilio)

## Configuration

```typescript
{
  // Telemetry configuration
  telemetry: {
    serviceName: 'noderr-trading',
    environment: 'production',
    samplingRate: 0.1, // 10% sampling
    
    // Metrics configuration
    metrics: {
      interval: 10000, // 10 seconds
      histogramBuckets: [0.1, 0.5, 1, 5, 10, 50, 100, 500],
      defaultLabels: {
        service: 'trading',
        version: '1.0.0'
      }
    },
    
    // Tracing configuration
    tracing: {
      enabled: true,
      propagators: ['w3c', 'jaeger'],
      exporter: 'jaeger',
      endpoint: 'http://jaeger:14268/api/traces'
    },
    
    // Logging configuration
    logging: {
      level: 'info',
      format: 'json',
      outputs: ['console', 'file'],
      rotation: {
        maxSize: '100m',
        maxFiles: 10
      }
    },
    
    // Alert configuration
    alerts: {
      enabled: true,
      evaluationInterval: 60000, // 1 minute
      channels: {
        slack: {
          webhook: process.env.SLACK_WEBHOOK
        },
        email: {
          smtp: process.env.SMTP_SERVER,
          from: 'alerts@noderr.io'
        }
      }
    }
  }
}
```

## Performance

- **Metric Collection**: < 1ms overhead per metric
- **Trace Sampling**: Configurable sampling rate
- **Log Processing**: 100,000+ logs/second
- **Alert Evaluation**: < 100ms per rule

## Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Test specific module
npm test -- alerts
```

## Contributing

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for development guidelines.

## License

MIT 