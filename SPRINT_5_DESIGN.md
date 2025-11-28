# Sprint 5: Updates & Monitoring - Design Document

**Date:** November 28, 2025  
**Sprint:** 5 of 7  
**Quality Standard:** PhD-Level Excellence  
**Status:** In Progress

---

## Executive Summary

Sprint 5 implements the **automated update system** and **comprehensive monitoring infrastructure** for the Noderr Node OS. This sprint focuses on operational excellence, ensuring nodes stay up-to-date and healthy without manual intervention.

### Key Deliverables

1. **Auto-Update Agent** - Node-side service that queries VersionBeacon and updates automatically
2. **Grafana/Loki Stack** - Centralized logging and monitoring infrastructure
3. **Telemetry System** - Performance metrics and error tracking
4. **Alert System** - Automated notifications for failures and anomalies
5. **Metrics Dashboard** - Real-time visualization of network health

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     Noderr Node OS Network                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ├─── Node 1 (ALL Tier)
                              │    ├─ Auto-Update Agent
                              │    ├─ Telemetry Collector
                              │    └─ Health Monitor
                              │
                              ├─ Node 2 (ORACLE Tier)
                              │    ├─ Auto-Update Agent
                              │    ├─ Telemetry Collector
                              │    └─ Health Monitor
                              │
                              └─── Node N (GUARDIAN Tier)
                                   ├─ Auto-Update Agent
                                   ├─ Telemetry Collector
                                   └─ Health Monitor
                                          │
                                          ▼
                    ┌────────────────────────────────────┐
                    │   Centralized Monitoring Stack     │
                    ├────────────────────────────────────┤
                    │  Loki (Log Aggregation)            │
                    │  Prometheus (Metrics)              │
                    │  Grafana (Visualization)           │
                    │  Alertmanager (Notifications)      │
                    └────────────────────────────────────┘
                                          │
                                          ▼
                    ┌────────────────────────────────────┐
                    │      Admin Dashboard               │
                    │  - Real-time metrics               │
                    │  - Alert management                │
                    │  - Performance graphs              │
                    └────────────────────────────────────┘
```

---

## Component 1: Auto-Update Agent

### Purpose

Automatically update nodes to the latest version based on VersionBeacon contract state and cohort assignment.

### Architecture

**Location:** `noderr-node-os/packages/auto-updater/`

**Key Components:**
1. **VersionBeacon Client** - Queries smart contract for version info
2. **Cohort Checker** - Determines if node is in active cohort
3. **Update Orchestrator** - Manages update process
4. **Rollback Handler** - Reverts on failure
5. **Health Validator** - Ensures node is healthy post-update

### Update Flow

```
1. Check VersionBeacon every 5 minutes
   ├─ Query current version for tier
   ├─ Check if new version available
   └─ Determine cohort assignment

2. If update available and node in active cohort:
   ├─ Download new Docker image
   ├─ Verify image signature
   ├─ Create backup of current state
   ├─ Stop current container
   ├─ Start new container
   └─ Validate health

3. Post-update validation:
   ├─ Check all services running
   ├─ Verify API endpoints responding
   ├─ Confirm data integrity
   └─ Report status to backend

4. If validation fails:
   ├─ Stop new container
   ├─ Restore backup
   ├─ Start previous version
   └─ Report failure to backend
```

### Configuration

**File:** `auto-updater/config.ts`

```typescript
export interface AutoUpdaterConfig {
  // VersionBeacon contract address
  versionBeaconAddress: string;
  
  // RPC endpoint for blockchain queries
  rpcEndpoint: string;
  
  // Check interval (milliseconds)
  checkInterval: number; // Default: 300000 (5 minutes)
  
  // Node tier (ALL, ORACLE, GUARDIAN)
  nodeTier: 'ALL' | 'ORACLE' | 'GUARDIAN';
  
  // Node ID (from registration)
  nodeId: string;
  
  // Docker registry URL
  dockerRegistry: string;
  
  // Health check endpoint
  healthCheckUrl: string;
  
  // Rollback timeout (milliseconds)
  rollbackTimeout: number; // Default: 300000 (5 minutes)
  
  // Enable automatic updates
  autoUpdateEnabled: boolean; // Default: true
}
```

### Implementation Details

**Package Structure:**
```
packages/auto-updater/
├── src/
│   ├── index.ts              # Main entry point
│   ├── config.ts             # Configuration
│   ├── version-beacon.ts     # VersionBeacon client
│   ├── cohort.ts             # Cohort determination
│   ├── updater.ts            # Update orchestration
│   ├── docker.ts             # Docker operations
│   ├── health.ts             # Health validation
│   ├── rollback.ts           # Rollback logic
│   └── telemetry.ts          # Telemetry reporting
├── tests/
│   ├── version-beacon.test.ts
│   ├── cohort.test.ts
│   ├── updater.test.ts
│   └── rollback.test.ts
├── package.json
└── tsconfig.json
```

### Security Considerations

1. **Image Verification**
   - Verify Docker image signatures before pulling
   - Use content-addressable storage (SHA256)
   - Reject unsigned or tampered images

2. **Backup Strategy**
   - Create full state backup before update
   - Store last 3 versions for rollback
   - Encrypt sensitive data in backups

3. **Network Security**
   - Use HTTPS for all API calls
   - Verify TLS certificates
   - Rate limit update checks

4. **Access Control**
   - Run updater as non-root user
   - Limit Docker socket access
   - Use read-only mounts where possible

---

## Component 2: Grafana/Loki Monitoring Stack

### Purpose

Centralized logging and monitoring for all nodes in the network.

### Architecture

**Location:** `noderr-node-os/monitoring/`

**Components:**
1. **Loki** - Log aggregation and storage
2. **Promtail** - Log shipping agent (runs on each node)
3. **Prometheus** - Metrics collection and storage
4. **Grafana** - Visualization and dashboards
5. **Alertmanager** - Alert routing and notification

### Docker Compose Stack

**File:** `monitoring/docker-compose.yml`

```yaml
version: '3.8'

services:
  loki:
    image: grafana/loki:2.9.0
    ports:
      - "3100:3100"
    volumes:
      - ./loki-config.yml:/etc/loki/local-config.yaml
      - loki-data:/loki
    command: -config.file=/etc/loki/local-config.yaml
    networks:
      - monitoring

  promtail:
    image: grafana/promtail:2.9.0
    volumes:
      - /var/log:/var/log:ro
      - /var/lib/docker/containers:/var/lib/docker/containers:ro
      - ./promtail-config.yml:/etc/promtail/config.yml
    command: -config.file=/etc/promtail/config.yml
    networks:
      - monitoring

  prometheus:
    image: prom/prometheus:v2.45.0
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus-data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
      - '--storage.tsdb.retention.time=30d'
    networks:
      - monitoring

  grafana:
    image: grafana/grafana:10.0.0
    ports:
      - "3000:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=${GRAFANA_ADMIN_PASSWORD}
      - GF_INSTALL_PLUGINS=grafana-clock-panel
    volumes:
      - grafana-data:/var/lib/grafana
      - ./grafana/dashboards:/etc/grafana/provisioning/dashboards
      - ./grafana/datasources:/etc/grafana/provisioning/datasources
    networks:
      - monitoring

  alertmanager:
    image: prom/alertmanager:v0.26.0
    ports:
      - "9093:9093"
    volumes:
      - ./alertmanager.yml:/etc/alertmanager/alertmanager.yml
      - alertmanager-data:/alertmanager
    command:
      - '--config.file=/etc/alertmanager/alertmanager.yml'
      - '--storage.path=/alertmanager'
    networks:
      - monitoring

networks:
  monitoring:
    driver: bridge

volumes:
  loki-data:
  prometheus-data:
  grafana-data:
  alertmanager-data:
```

### Loki Configuration

**File:** `monitoring/loki-config.yml`

```yaml
auth_enabled: false

server:
  http_listen_port: 3100
  grpc_listen_port: 9096

common:
  path_prefix: /loki
  storage:
    filesystem:
      chunks_directory: /loki/chunks
      rules_directory: /loki/rules
  replication_factor: 1
  ring:
    instance_addr: 127.0.0.1
    kvstore:
      store: inmemory

schema_config:
  configs:
    - from: 2023-01-01
      store: boltdb-shipper
      object_store: filesystem
      schema: v11
      index:
        prefix: index_
        period: 24h

ruler:
  alertmanager_url: http://alertmanager:9093

limits_config:
  retention_period: 30d
  ingestion_rate_mb: 10
  ingestion_burst_size_mb: 20
```

### Prometheus Configuration

**File:** `monitoring/prometheus.yml`

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

alerting:
  alertmanagers:
    - static_configs:
        - targets:
            - alertmanager:9093

rule_files:
  - "alerts/*.yml"

scrape_configs:
  # Prometheus self-monitoring
  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']

  # Node exporter (system metrics)
  - job_name: 'node-exporter'
    static_configs:
      - targets: ['node-exporter:9100']

  # Application metrics
  - job_name: 'noderr-nodes'
    scrape_interval: 10s
    static_configs:
      - targets: []  # Dynamically populated by service discovery

  # Docker metrics
  - job_name: 'docker'
    static_configs:
      - targets: ['docker-exporter:9323']
```

### Alertmanager Configuration

**File:** `monitoring/alertmanager.yml`

```yaml
global:
  resolve_timeout: 5m

route:
  group_by: ['alertname', 'cluster', 'service']
  group_wait: 10s
  group_interval: 10s
  repeat_interval: 12h
  receiver: 'default'
  routes:
    - match:
        severity: critical
      receiver: 'critical'
      continue: true
    - match:
        severity: warning
      receiver: 'warning'

receivers:
  - name: 'default'
    webhook_configs:
      - url: 'http://webhook-receiver:8080/alerts'

  - name: 'critical'
    webhook_configs:
      - url: 'http://webhook-receiver:8080/alerts/critical'
    # Add email, Slack, PagerDuty, etc. as needed

  - name: 'warning'
    webhook_configs:
      - url: 'http://webhook-receiver:8080/alerts/warning'

inhibit_rules:
  - source_match:
      severity: 'critical'
    target_match:
      severity: 'warning'
    equal: ['alertname', 'cluster', 'service']
```

---

## Component 3: Telemetry Collection System

### Purpose

Collect performance metrics, error logs, and operational data from all nodes.

### Metrics to Collect

**System Metrics:**
- CPU usage (%)
- Memory usage (MB / %)
- Disk I/O (MB/s)
- Network I/O (MB/s)
- Disk space (GB / %)

**Application Metrics:**
- Request rate (req/s)
- Response time (ms, p50/p95/p99)
- Error rate (errors/s, %)
- Active connections
- Queue depth

**Trading Metrics:**
- Orders placed (count/s)
- Orders filled (count/s)
- Order latency (ms)
- PnL (USD)
- Position size (USD)
- Risk metrics

**Node Health:**
- Uptime (seconds)
- Last heartbeat (timestamp)
- Version (semver)
- Tier (ALL/ORACLE/GUARDIAN)
- Status (active/inactive/suspended)

### Telemetry Package

**Location:** `packages/telemetry/` (already exists, enhance it)

**Enhancements:**
1. Add Prometheus metrics export
2. Add structured logging for Loki
3. Add performance profiling
4. Add error tracking with stack traces
5. Add custom business metrics

**File:** `packages/telemetry/src/prometheus.ts`

```typescript
import { Registry, Counter, Gauge, Histogram } from 'prom-client';

export class PrometheusMetrics {
  private registry: Registry;
  
  // System metrics
  public cpuUsage: Gauge;
  public memoryUsage: Gauge;
  public diskUsage: Gauge;
  
  // Application metrics
  public httpRequestsTotal: Counter;
  public httpRequestDuration: Histogram;
  public httpErrorsTotal: Counter;
  
  // Trading metrics
  public ordersPlaced: Counter;
  public ordersFilled: Counter;
  public orderLatency: Histogram;
  public currentPnL: Gauge;
  
  constructor() {
    this.registry = new Registry();
    
    // Initialize metrics...
  }
  
  public getMetrics(): Promise<string> {
    return this.registry.metrics();
  }
}
```

---

## Component 4: Alert System

### Purpose

Automatically detect and notify about node failures, performance degradation, and anomalies.

### Alert Rules

**File:** `monitoring/alerts/node-alerts.yml`

```yaml
groups:
  - name: node_health
    interval: 30s
    rules:
      # Node down
      - alert: NodeDown
        expr: up{job="noderr-nodes"} == 0
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "Node {{ $labels.instance }} is down"
          description: "Node has been down for more than 2 minutes"

      # High CPU usage
      - alert: HighCPUUsage
        expr: node_cpu_usage > 90
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High CPU usage on {{ $labels.instance }}"
          description: "CPU usage is {{ $value }}%"

      # High memory usage
      - alert: HighMemoryUsage
        expr: node_memory_usage > 90
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High memory usage on {{ $labels.instance }}"
          description: "Memory usage is {{ $value }}%"

      # Disk space low
      - alert: DiskSpaceLow
        expr: node_disk_usage > 85
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Low disk space on {{ $labels.instance }}"
          description: "Disk usage is {{ $value }}%"

      # High error rate
      - alert: HighErrorRate
        expr: rate(http_errors_total[5m]) > 0.05
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "High error rate on {{ $labels.instance }}"
          description: "Error rate is {{ $value }} errors/s"

      # Slow response time
      - alert: SlowResponseTime
        expr: histogram_quantile(0.95, http_request_duration_seconds) > 1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Slow response time on {{ $labels.instance }}"
          description: "P95 response time is {{ $value }}s"

      # Update failed
      - alert: UpdateFailed
        expr: node_update_failed == 1
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Update failed on {{ $labels.instance }}"
          description: "Node failed to update to version {{ $labels.version }}"

      # Version mismatch
      - alert: VersionMismatch
        expr: count(count by (version) (node_version)) > 2
        for: 30m
        labels:
          severity: warning
        annotations:
          summary: "Multiple versions running"
          description: "More than 2 versions detected in the network"
```

### Notification Channels

1. **Webhook** - POST to admin dashboard API
2. **Email** - Send to admin team
3. **Slack** - Post to #alerts channel
4. **PagerDuty** - For critical alerts (optional)

---

## Component 5: Grafana Dashboards

### Dashboard 1: Network Overview

**Panels:**
1. Total nodes (gauge)
2. Active nodes (gauge)
3. Inactive nodes (gauge)
4. Suspended nodes (gauge)
5. Node distribution by tier (pie chart)
6. Node distribution by version (pie chart)
7. Network uptime (%) (gauge)
8. Total requests/s (graph)
9. Average response time (graph)
10. Error rate (graph)

### Dashboard 2: Node Details

**Panels:**
1. Node list (table)
2. CPU usage per node (heatmap)
3. Memory usage per node (heatmap)
4. Disk usage per node (bar chart)
5. Network I/O per node (graph)
6. Request rate per node (graph)
7. Error rate per node (graph)
8. Uptime per node (table)

### Dashboard 3: Trading Performance

**Panels:**
1. Total orders placed (counter)
2. Total orders filled (counter)
3. Fill rate (%) (gauge)
4. Average order latency (gauge)
5. Orders per second (graph)
6. Order latency distribution (histogram)
7. PnL by node (table)
8. Total network PnL (graph)

### Dashboard 4: Updates & Deployments

**Panels:**
1. Current version by tier (stat)
2. Active deployments (table)
3. Deployment progress (gauge)
4. Update success rate (gauge)
5. Update history (timeline)
6. Rollback events (table)
7. Version distribution (pie chart)

---

## Implementation Plan

### Day 1-2: Auto-Update Agent
- [ ] Create auto-updater package
- [ ] Implement VersionBeacon client
- [ ] Implement cohort checker
- [ ] Implement update orchestrator
- [ ] Implement rollback handler
- [ ] Write comprehensive tests

### Day 3-4: Monitoring Stack
- [ ] Set up Docker Compose stack
- [ ] Configure Loki for log aggregation
- [ ] Configure Prometheus for metrics
- [ ] Configure Grafana datasources
- [ ] Set up Alertmanager

### Day 5-6: Telemetry & Alerts
- [ ] Enhance telemetry package
- [ ] Add Prometheus metrics export
- [ ] Create alert rules
- [ ] Set up notification channels
- [ ] Test alert delivery

### Day 7-8: Dashboards & Testing
- [ ] Create Grafana dashboards
- [ ] Test end-to-end monitoring
- [ ] Test auto-update flow
- [ ] Load testing
- [ ] Documentation

---

## Quality Gates

### Auto-Update Agent
- [ ] 100% test coverage for critical paths
- [ ] Rollback works in <30 seconds
- [ ] Zero data loss during updates
- [ ] Handles network failures gracefully
- [ ] Verifies image signatures

### Monitoring Stack
- [ ] Handles 1000+ nodes
- [ ] <1s query latency (p95)
- [ ] 30-day retention
- [ ] 99.9% uptime
- [ ] Secure authentication

### Telemetry System
- [ ] <1% CPU overhead
- [ ] <50MB memory overhead
- [ ] Batched metric submission
- [ ] Handles offline periods
- [ ] No data loss

### Alert System
- [ ] <1 minute detection time
- [ ] <30 second notification time
- [ ] Zero false positives
- [ ] Proper alert grouping
- [ ] Alert fatigue prevention

---

## Success Criteria

- [ ] Nodes update automatically within 24 hours of version release
- [ ] 100% of nodes monitored in real-time
- [ ] Alerts delivered within 1 minute of issue
- [ ] Dashboards load in <2 seconds
- [ ] Zero manual intervention required for updates
- [ ] All metrics collected with <1% overhead
- [ ] 30-day log and metric retention
- [ ] Comprehensive documentation

---

**Status:** ✅ DESIGN COMPLETE - READY FOR IMPLEMENTATION  
**Next Phase:** Implementation (Day 1-2: Auto-Update Agent)
