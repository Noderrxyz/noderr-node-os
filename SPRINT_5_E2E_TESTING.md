# Sprint 5: End-to-End Testing Guide

Comprehensive testing procedures for Updates & Monitoring systems.

## Test Environment Setup

### Prerequisites

```bash
# 1. Ensure all repositories are up to date
cd /home/ubuntu/noderr-node-os && git pull
cd /home/ubuntu/noderr-protocol && git pull
cd /home/ubuntu/noderr-dapp && git pull

# 2. Verify Docker is running
docker ps

# 3. Check available resources
free -h
df -h
```

### Test Data Preparation

```bash
# Create test node registration
export TEST_NODE_ID="test-node-$(date +%s)"
export TEST_WALLET="0x1234567890123456789012345678901234567890"
export TEST_TIER="ALL"
```

## Test Suite 1: Auto-Updater Package

### Test 1.1: VersionBeacon Integration

**Objective:** Verify auto-updater can query VersionBeacon contract

```bash
cd /home/ubuntu/noderr-node-os/packages/auto-updater

# Install dependencies
pnpm install

# Build package
pnpm build

# Test VersionBeacon query
node -e "
const { VersionBeaconClient } = require('./dist/version-beacon');
const client = new VersionBeaconClient({
  contractAddress: '0xA5Be5522bb3C748ea262a2A7d877d00AE387FDa6',
  rpcUrl: 'https://base-sepolia.g.alchemy.com/v2/Z6Vsdc0TcuwUWBvlIzOqT',
  tier: 'ALL'
});

client.getCurrentVersion().then(version => {
  console.log('Current version:', version);
  process.exit(version ? 0 : 1);
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
"
```

**Expected Result:**
```
Current version: { versionId: 0, semver: '0.0.0', ... }
Exit code: 0
```

**Status:** ⬜ PASS / ⬜ FAIL

---

### Test 1.2: Cohort Determination

**Objective:** Verify deterministic cohort assignment

```bash
node -e "
const { CohortDeterminer } = require('./dist/cohort');

const determiner = new CohortDeterminer({
  nodeId: '${TEST_NODE_ID}',
  totalCohorts: 4
});

const cohort = determiner.getCohort();
console.log('Assigned cohort:', cohort);

// Verify determinism
const cohort2 = determiner.getCohort();
if (cohort === cohort2) {
  console.log('✓ Cohort assignment is deterministic');
  process.exit(0);
} else {
  console.error('✗ Cohort assignment is not deterministic');
  process.exit(1);
}
"
```

**Expected Result:**
```
Assigned cohort: 0-3
✓ Cohort assignment is deterministic
Exit code: 0
```

**Status:** ⬜ PASS / ⬜ FAIL

---

### Test 1.3: Docker Operations

**Objective:** Verify Docker image pull and container management

```bash
node -e "
const { DockerManager } = require('./dist/docker');

const manager = new DockerManager({
  imageName: 'noderr/node-os',
  containerName: 'noderr-test',
  tier: 'ALL'
});

(async () => {
  try {
    // Test image pull
    console.log('Testing image pull...');
    await manager.pullImage('0.1.0');
    console.log('✓ Image pull successful');
    
    // Test container start
    console.log('Testing container start...');
    await manager.startContainer('0.1.0');
    console.log('✓ Container start successful');
    
    // Test health check
    console.log('Testing health check...');
    const healthy = await manager.checkHealth();
    console.log('✓ Health check:', healthy ? 'PASS' : 'FAIL');
    
    // Cleanup
    await manager.stopContainer();
    await manager.removeContainer();
    
    process.exit(healthy ? 0 : 1);
  } catch (err) {
    console.error('✗ Error:', err.message);
    process.exit(1);
  }
})();
"
```

**Expected Result:**
```
Testing image pull...
✓ Image pull successful
Testing container start...
✓ Container start successful
Testing health check...
✓ Health check: PASS
Exit code: 0
```

**Status:** ⬜ PASS / ⬜ FAIL

---

### Test 1.4: Health Validation

**Objective:** Verify health check metrics validation

```bash
node -e "
const { HealthValidator } = require('./dist/health');

const validator = new HealthValidator({
  thresholds: {
    errorRate: 0.01,
    latency: 1000,
    memoryUsage: 0.9
  }
});

// Test with good metrics
const goodMetrics = {
  errorRate: 0.005,
  latency: 500,
  memoryUsage: 0.7
};

const result1 = validator.validate(goodMetrics);
console.log('Good metrics validation:', result1.healthy ? 'PASS' : 'FAIL');

// Test with bad metrics
const badMetrics = {
  errorRate: 0.02,
  latency: 2000,
  memoryUsage: 0.95
};

const result2 = validator.validate(badMetrics);
console.log('Bad metrics validation:', !result2.healthy ? 'PASS' : 'FAIL');

process.exit((result1.healthy && !result2.healthy) ? 0 : 1);
"
```

**Expected Result:**
```
Good metrics validation: PASS
Bad metrics validation: PASS
Exit code: 0
```

**Status:** ⬜ PASS / ⬜ FAIL

---

### Test 1.5: Rollback Handler

**Objective:** Verify automatic rollback on failure

```bash
node -e "
const { RollbackHandler } = require('./dist/rollback');
const { DockerManager } = require('./dist/docker');

const docker = new DockerManager({
  imageName: 'noderr/node-os',
  containerName: 'noderr-test',
  tier: 'ALL'
});

const rollback = new RollbackHandler(docker, {
  previousVersion: '0.1.0',
  maxAttempts: 3
});

(async () => {
  try {
    console.log('Testing rollback...');
    await rollback.execute('Failed health check');
    console.log('✓ Rollback successful');
    process.exit(0);
  } catch (err) {
    console.error('✗ Rollback failed:', err.message);
    process.exit(1);
  }
})();
"
```

**Expected Result:**
```
Testing rollback...
✓ Rollback successful
Exit code: 0
```

**Status:** ⬜ PASS / ⬜ FAIL

---

## Test Suite 2: Monitoring Stack

### Test 2.1: Docker Compose Stack

**Objective:** Verify all monitoring services start successfully

```bash
cd /home/ubuntu/noderr-node-os/monitoring

# Copy environment file
cp .env.example .env

# Start stack
docker-compose up -d

# Wait for services to be healthy
sleep 30

# Check all services
docker-compose ps
```

**Expected Result:**
```
NAME                STATUS              PORTS
loki                Up (healthy)        0.0.0.0:3100->3100/tcp
promtail            Up                  0.0.0.0:9080->9080/tcp
prometheus          Up (healthy)        0.0.0.0:9090->9090/tcp
node-exporter       Up                  0.0.0.0:9100->9100/tcp
cadvisor            Up (healthy)        0.0.0.0:8080->8080/tcp
grafana             Up (healthy)        0.0.0.0:3000->3000/tcp
alertmanager        Up (healthy)        0.0.0.0:9093->9093/tcp
```

**Status:** ⬜ PASS / ⬜ FAIL

---

### Test 2.2: Loki Log Ingestion

**Objective:** Verify Loki can receive and query logs

```bash
# Send test log
curl -X POST http://localhost:3100/loki/api/v1/push \
  -H "Content-Type: application/json" \
  -d '{
    "streams": [
      {
        "stream": {
          "job": "test",
          "level": "info"
        },
        "values": [
          ["'$(date +%s)000000000'", "Test log message from Sprint 5 E2E testing"]
        ]
      }
    ]
  }'

# Wait for ingestion
sleep 5

# Query logs
curl -G -s "http://localhost:3100/loki/api/v1/query_range" \
  --data-urlencode 'query={job="test"}' \
  --data-urlencode 'start='$(date -d '1 minute ago' +%s)000000000 \
  --data-urlencode 'end='$(date +%s)000000000 \
  | jq '.data.result[0].values'
```

**Expected Result:**
```json
[
  [
    "timestamp",
    "Test log message from Sprint 5 E2E testing"
  ]
]
```

**Status:** ⬜ PASS / ⬜ FAIL

---

### Test 2.3: Prometheus Metrics Collection

**Objective:** Verify Prometheus is scraping targets

```bash
# Check targets
curl -s http://localhost:9090/api/v1/targets | jq '.data.activeTargets[] | {job: .labels.job, health: .health}'

# Query a metric
curl -s 'http://localhost:9090/api/v1/query?query=up' | jq '.data.result[] | {instance: .metric.instance, value: .value[1]}'
```

**Expected Result:**
```json
{
  "job": "prometheus",
  "health": "up"
}
{
  "job": "node-exporter",
  "health": "up"
}
...
```

**Status:** ⬜ PASS / ⬜ FAIL

---

### Test 2.4: Grafana Datasources

**Objective:** Verify Grafana can connect to Prometheus and Loki

```bash
# Login to Grafana
GRAFANA_TOKEN=$(curl -s -X POST \
  -H "Content-Type: application/json" \
  -d '{"user":"admin","password":"admin"}' \
  http://localhost:3000/login | jq -r '.token')

# Check datasources
curl -s -H "Authorization: Bearer ${GRAFANA_TOKEN}" \
  http://localhost:3000/api/datasources | jq '.[] | {name: .name, type: .type, url: .url}'
```

**Expected Result:**
```json
{
  "name": "Prometheus",
  "type": "prometheus",
  "url": "http://prometheus:9090"
}
{
  "name": "Loki",
  "type": "loki",
  "url": "http://loki:3100"
}
```

**Status:** ⬜ PASS / ⬜ FAIL

---

### Test 2.5: Alert Rules

**Objective:** Verify Prometheus alert rules are loaded

```bash
# Check alert rules
curl -s http://localhost:9090/api/v1/rules | jq '.data.groups[] | {name: .name, rules: .rules | length}'
```

**Expected Result:**
```json
{
  "name": "node_health",
  "rules": 9
}
{
  "name": "container_health",
  "rules": 3
}
{
  "name": "update_alerts",
  "rules": 3
}
{
  "name": "application_alerts",
  "rules": 3
}
```

**Status:** ⬜ PASS / ⬜ FAIL

---

### Test 2.6: Alertmanager

**Objective:** Verify Alertmanager is configured and can route alerts

```bash
# Check Alertmanager config
curl -s http://localhost:9093/api/v2/status | jq '.config.route'

# Send test alert
curl -X POST http://localhost:9093/api/v2/alerts \
  -H "Content-Type: application/json" \
  -d '[{
    "labels": {
      "alertname": "TestAlert",
      "severity": "warning",
      "category": "test"
    },
    "annotations": {
      "summary": "Test alert from Sprint 5 E2E testing",
      "description": "This is a test alert to verify Alertmanager routing."
    }
  }]'

# Check alerts
sleep 5
curl -s http://localhost:9093/api/v2/alerts | jq '.[] | {alertname: .labels.alertname, state: .status.state}'
```

**Expected Result:**
```json
{
  "alertname": "TestAlert",
  "state": "active"
}
```

**Status:** ⬜ PASS / ⬜ FAIL

---

## Test Suite 3: Telemetry Package

### Test 3.1: Metrics Export

**Objective:** Verify telemetry package exports metrics to Prometheus

```bash
cd /home/ubuntu/noderr-node-os/packages/telemetry

# Build package
pnpm build

# Start metrics server
node -e "
const { TelemetryService } = require('./dist');
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [new winston.transports.Console()]
});

const telemetry = new TelemetryService(logger, {
  serviceName: 'test-service',
  environment: 'test',
  version: '1.0.0',
  metrics: {
    enabled: true,
    port: 9091
  }
});

(async () => {
  await telemetry.initialize();
  await telemetry.start();
  
  // Register test metric
  telemetry.registerMetric({
    name: 'test_counter',
    type: 'counter',
    help: 'Test counter metric'
  });
  
  // Record metric
  telemetry.recordMetric({
    name: 'test_counter',
    value: 1,
    labels: { test: 'true' }
  });
  
  console.log('✓ Metrics server started on port 9091');
  console.log('Press Ctrl+C to stop');
})();
" &

# Wait for server to start
sleep 5

# Query metrics
curl -s http://localhost:9091/metrics | grep test_counter
```

**Expected Result:**
```
# HELP test_counter Test counter metric
# TYPE test_counter counter
test_counter{test="true"} 1
```

**Status:** ⬜ PASS / ⬜ FAIL

---

### Test 3.2: Log Shipping to Loki

**Objective:** Verify telemetry package ships logs to Loki

```bash
node -e "
const { TelemetryService } = require('./dist');
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [new winston.transports.Console()]
});

const telemetry = new TelemetryService(logger, {
  serviceName: 'test-service',
  environment: 'test',
  version: '1.0.0',
  logging: {
    enabled: true,
    level: 'info',
    outputs: [{
      type: 'loki',
      config: {
        host: 'http://localhost:3100'
      }
    }]
  }
});

(async () => {
  await telemetry.initialize();
  await telemetry.start();
  
  // Send test logs
  telemetry.info('test-module', 'Test log from Sprint 5 E2E testing', {
    test: true,
    timestamp: new Date().toISOString()
  });
  
  console.log('✓ Log sent to Loki');
  
  await telemetry.stop();
  process.exit(0);
})();
"

# Wait for log ingestion
sleep 5

# Query Loki for test log
curl -G -s "http://localhost:3100/loki/api/v1/query_range" \
  --data-urlencode 'query={service="test-service"}' \
  --data-urlencode 'start='$(date -d '1 minute ago' +%s)000000000 \
  --data-urlencode 'end='$(date +%s)000000000 \
  | jq '.data.result[0].values'
```

**Expected Result:**
```json
[
  [
    "timestamp",
    "Test log from Sprint 5 E2E testing"
  ]
]
```

**Status:** ⬜ PASS / ⬜ FAIL

---

### Test 3.3: Alert Routing

**Objective:** Verify telemetry package routes alerts correctly

```bash
node -e "
const { TelemetryService } = require('./dist');
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [new winston.transports.Console()]
});

const telemetry = new TelemetryService(logger, {
  serviceName: 'test-service',
  environment: 'test',
  version: '1.0.0',
  alerting: {
    enabled: true,
    channels: [{
      type: 'webhook',
      url: 'http://localhost:9093/api/v2/alerts'
    }]
  }
});

(async () => {
  await telemetry.initialize();
  await telemetry.start();
  
  // Trigger test alert
  await telemetry.triggerAlert({
    id: 'test-alert-' + Date.now(),
    module: 'test-module',
    severity: 'warning',
    message: 'Test alert from Sprint 5 E2E testing',
    timestamp: Date.now(),
    metadata: { test: true }
  });
  
  console.log('✓ Alert sent');
  
  await telemetry.stop();
  process.exit(0);
})();
"
```

**Expected Result:**
```
✓ Alert sent
Exit code: 0
```

**Status:** ⬜ PASS / ⬜ FAIL

---

## Test Suite 4: Integration Tests

### Test 4.1: Full Update Flow

**Objective:** Simulate complete version update with monitoring

```bash
# This test requires:
# 1. VersionBeacon contract with published version
# 2. Docker images built and pushed
# 3. Monitoring stack running
# 4. Test node registered

# TODO: Implement when Docker images are built
```

**Status:** ⬜ PASS / ⬜ FAIL / ⬜ SKIP

---

### Test 4.2: Rollback on Failure

**Objective:** Verify automatic rollback when update fails health check

```bash
# This test requires:
# 1. Simulated unhealthy version
# 2. Previous healthy version available
# 3. Monitoring capturing rollback events

# TODO: Implement when Docker images are built
```

**Status:** ⬜ PASS / ⬜ FAIL / ⬜ SKIP

---

### Test 4.3: Alert on Update Failure

**Objective:** Verify alerts are sent when update fails

```bash
# This test requires:
# 1. Failed update scenario
# 2. Alertmanager configured
# 3. Alert channel (webhook/email) configured

# TODO: Implement when alert channels are configured
```

**Status:** ⬜ PASS / ⬜ FAIL / ⬜ SKIP

---

## Test Results Summary

### Auto-Updater Package
- Test 1.1: VersionBeacon Integration - ⬜ PASS / ⬜ FAIL
- Test 1.2: Cohort Determination - ⬜ PASS / ⬜ FAIL
- Test 1.3: Docker Operations - ⬜ PASS / ⬜ FAIL
- Test 1.4: Health Validation - ⬜ PASS / ⬜ FAIL
- Test 1.5: Rollback Handler - ⬜ PASS / ⬜ FAIL

### Monitoring Stack
- Test 2.1: Docker Compose Stack - ⬜ PASS / ⬜ FAIL
- Test 2.2: Loki Log Ingestion - ⬜ PASS / ⬜ FAIL
- Test 2.3: Prometheus Metrics Collection - ⬜ PASS / ⬜ FAIL
- Test 2.4: Grafana Datasources - ⬜ PASS / ⬜ FAIL
- Test 2.5: Alert Rules - ⬜ PASS / ⬜ FAIL
- Test 2.6: Alertmanager - ⬜ PASS / ⬜ FAIL

### Telemetry Package
- Test 3.1: Metrics Export - ⬜ PASS / ⬜ FAIL
- Test 3.2: Log Shipping to Loki - ⬜ PASS / ⬜ FAIL
- Test 3.3: Alert Routing - ⬜ PASS / ⬜ FAIL

### Integration Tests
- Test 4.1: Full Update Flow - ⬜ PASS / ⬜ FAIL / ⬜ SKIP
- Test 4.2: Rollback on Failure - ⬜ PASS / ⬜ FAIL / ⬜ SKIP
- Test 4.3: Alert on Update Failure - ⬜ PASS / ⬜ FAIL / ⬜ SKIP

**Overall Status:** ⬜ ALL PASS / ⬜ SOME FAIL / ⬜ INCOMPLETE

## Cleanup

```bash
# Stop monitoring stack
cd /home/ubuntu/noderr-node-os/monitoring
docker-compose down -v

# Remove test containers
docker rm -f $(docker ps -a | grep noderr-test | awk '{print $1}')

# Remove test images
docker rmi $(docker images | grep noderr-test | awk '{print $3}')
```

## Notes

- Tests marked as SKIP require additional infrastructure (Docker images, alert channels)
- These will be completed in Sprint 6 when infrastructure is deployed
- All unit-level tests should PASS before proceeding to integration tests
- Document any failures with error messages and stack traces

## Sign-off

**Tested by:** _______________  
**Date:** _______________  
**Sprint 5 Status:** ⬜ APPROVED / ⬜ NEEDS WORK  
**Notes:** _______________________________________________
