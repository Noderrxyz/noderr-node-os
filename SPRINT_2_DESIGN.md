# Sprint 2: Packaging & Staging - Design Document

**Date:** November 28, 2025  
**Status:** 🔄 **IN PROGRESS**  
**Quality Standard:** PhD-Level Excellence

---

## Executive Summary

Sprint 2 focuses on creating the **packaging and deployment infrastructure** for the Noderr Node OS. This sprint delivers:

1. **Three Tier-Specific Docker Images** - Optimized containers for ALL, ORACLE, and GUARDIAN nodes
2. **Deployment Engine Microservice** - Intelligent cohort selection and staged rollout orchestration

---

## 1. Docker Image Architecture

### 1.1 Tier Specifications

#### Tier 1: ALL Nodes (Base Tier)
**Purpose:** Lightweight nodes for basic network participation

**Included Packages:**
- `@noderr/types` - Core type definitions
- `@noderr/utils` - Utility functions
- `@noderr/telemetry` - Monitoring and metrics
- `@noderr/market-data` - Market data ingestion
- `@noderr/exchanges` - Exchange connectivity
- `@noderr/data-connectors` - Data source integration

**Resource Requirements:**
- CPU: 2 cores minimum
- RAM: 4GB minimum
- Disk: 20GB minimum
- Network: 10 Mbps minimum

**Docker Image Size Target:** < 500MB

---

#### Tier 2: ORACLE Nodes (Enhanced Tier)
**Purpose:** Advanced nodes with ML capabilities and market intelligence

**Included Packages:**
- All packages from ALL tier
- `@noderr/ml` - Machine learning models
- `@noderr/quant-research` - Quantitative research tools
- `@noderr/market-intel` - Advanced market intelligence
- `@noderr/strategy` - Trading strategy execution
- `@noderr/capital-ai` - AI-powered capital allocation

**Resource Requirements:**
- CPU: 4 cores minimum
- RAM: 8GB minimum
- Disk: 50GB minimum
- Network: 25 Mbps minimum
- GPU: Optional (for ML acceleration)

**Docker Image Size Target:** < 1.5GB

---

#### Tier 3: GUARDIAN Nodes (Premium Tier)
**Purpose:** Full-featured nodes with risk management and execution capabilities

**Included Packages:**
- All packages from ORACLE tier
- `@noderr/risk-engine` - Risk management
- `@noderr/floor-engine` - Floor price protection
- `@noderr/execution` - Trade execution
- `@noderr/safety-control` - Safety mechanisms
- `@noderr/integration-layer` - System integration
- `@noderr/system-orchestrator` - System coordination
- `@noderr/core` - Core system functionality

**Resource Requirements:**
- CPU: 8 cores minimum
- RAM: 16GB minimum
- Disk: 100GB minimum
- Network: 50 Mbps minimum
- GPU: Recommended (for ML acceleration)

**Docker Image Size Target:** < 2.5GB

---

### 1.2 Docker Image Design Principles

#### Multi-Stage Builds
- **Stage 1: Builder** - Compile TypeScript, install dependencies
- **Stage 2: Production** - Copy only production artifacts, minimal runtime

#### Layer Optimization
- Base layer: Node.js runtime + system dependencies
- Dependencies layer: node_modules (cached)
- Application layer: Compiled code
- Configuration layer: Environment-specific configs

#### Security Hardening
- Non-root user execution
- Minimal attack surface (distroless base)
- No unnecessary tools or utilities
- Read-only root filesystem where possible
- Security scanning with Trivy

#### Performance Optimization
- PNPM for efficient dependency management
- Production-only dependencies
- Compressed layers
- Optimized startup time

---

## 2. Deployment Engine Architecture

### 2.1 Purpose

The Deployment Engine is a microservice that orchestrates staged rollouts of Node OS updates across the decentralized network.

### 2.2 Core Responsibilities

1. **Version Management**
   - Query VersionBeacon contract for current versions
   - Determine applicable version for each node based on tier
   - Track version deployment status

2. **Cohort Selection**
   - Assign nodes to cohorts (canary, cohort 1, cohort 2, cohort 3, cohort 4)
   - Implement deterministic cohort assignment algorithm
   - Respect rollout configuration from VersionBeacon

3. **Staged Rollout Orchestration**
   - Execute phased deployments
   - Monitor health metrics during rollout
   - Trigger automatic rollback on failure
   - Coordinate with VersionBeacon for emergency rollback

4. **Health Monitoring**
   - Collect node health metrics
   - Detect deployment failures
   - Calculate success rates per cohort
   - Trigger alerts on anomalies

### 2.3 Technology Stack

- **Runtime:** Node.js 20.x (TypeScript)
- **Framework:** Fastify (high-performance HTTP server)
- **Blockchain:** ethers.js v6 (VersionBeacon integration)
- **Database:** PostgreSQL (deployment state tracking)
- **Caching:** Redis (node cohort assignments)
- **Monitoring:** Prometheus metrics export
- **Logging:** Structured JSON logging

### 2.4 API Endpoints

#### `GET /api/v1/version/:nodeId`
**Purpose:** Get applicable version for a specific node

**Input:**
```typescript
{
  nodeId: string;        // Unique node identifier
  tier: 'ALL' | 'ORACLE' | 'GUARDIAN';
  currentVersion?: string;
}
```

**Output:**
```typescript
{
  versionId: number;
  versionString: string;
  dockerImageTag: string;
  configHash: string;
  cohort: 'canary' | 'cohort1' | 'cohort2' | 'cohort3' | 'cohort4';
  shouldUpdate: boolean;
  updatePriority: 'normal' | 'high' | 'emergency';
}
```

#### `POST /api/v1/health`
**Purpose:** Report node health status

**Input:**
```typescript
{
  nodeId: string;
  version: string;
  metrics: {
    uptime: number;
    cpu: number;
    memory: number;
    errors: number;
  };
  timestamp: string;
}
```

**Output:**
```typescript
{
  acknowledged: boolean;
  healthStatus: 'healthy' | 'degraded' | 'unhealthy';
}
```

#### `GET /api/v1/rollout/status`
**Purpose:** Get current rollout status

**Output:**
```typescript
{
  currentVersion: string;
  targetVersion: string;
  rolloutPhase: 'canary' | 'cohort1' | 'cohort2' | 'cohort3' | 'cohort4' | 'complete';
  nodesUpdated: number;
  totalNodes: number;
  successRate: number;
  errors: number;
}
```

### 2.5 Cohort Selection Algorithm

#### Deterministic Assignment
```typescript
function assignCohort(nodeId: string, rolloutConfig: RolloutConfig): Cohort {
  // Use hash of nodeId for deterministic assignment
  const hash = keccak256(nodeId);
  const hashNumber = BigInt(hash) % 100n;
  
  const canaryThreshold = rolloutConfig.canaryPercentage;
  const cohortSize = rolloutConfig.cohortPercentage;
  
  if (hashNumber < canaryThreshold) {
    return 'canary';
  } else if (hashNumber < canaryThreshold + cohortSize) {
    return 'cohort1';
  } else if (hashNumber < canaryThreshold + cohortSize * 2) {
    return 'cohort2';
  } else if (hashNumber < canaryThreshold + cohortSize * 3) {
    return 'cohort3';
  } else {
    return 'cohort4';
  }
}
```

#### Cohort Activation Logic
```typescript
function isCohortActive(
  cohort: Cohort,
  versionPublishTime: number,
  rolloutConfig: RolloutConfig
): boolean {
  const now = Date.now() / 1000;
  const hoursSincePublish = (now - versionPublishTime) / 3600;
  
  const cohortDelayHours = rolloutConfig.cohortDelayHours;
  
  switch (cohort) {
    case 'canary':
      return true; // Always active immediately
    case 'cohort1':
      return hoursSincePublish >= cohortDelayHours;
    case 'cohort2':
      return hoursSincePublish >= cohortDelayHours * 2;
    case 'cohort3':
      return hoursSincePublish >= cohortDelayHours * 3;
    case 'cohort4':
      return hoursSincePublish >= cohortDelayHours * 4;
  }
}
```

### 2.6 Automatic Rollback Logic

#### Failure Detection
```typescript
interface HealthMetrics {
  cohort: Cohort;
  totalNodes: number;
  healthyNodes: number;
  unhealthyNodes: number;
  errorRate: number;
}

function shouldTriggerRollback(metrics: HealthMetrics): boolean {
  const UNHEALTHY_THRESHOLD = 0.1; // 10% unhealthy nodes
  const ERROR_RATE_THRESHOLD = 0.05; // 5% error rate
  
  const unhealthyRatio = metrics.unhealthyNodes / metrics.totalNodes;
  
  return (
    unhealthyRatio > UNHEALTHY_THRESHOLD ||
    metrics.errorRate > ERROR_RATE_THRESHOLD
  );
}
```

---

## 3. Database Schema

### 3.1 Tables

#### `deployments`
```sql
CREATE TABLE deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id INTEGER NOT NULL,
  version_string VARCHAR(50) NOT NULL,
  docker_image_tag VARCHAR(255) NOT NULL,
  tier VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL, -- 'pending', 'active', 'paused', 'completed', 'rolled_back'
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP,
  rollback_reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

#### `node_versions`
```sql
CREATE TABLE node_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id VARCHAR(255) NOT NULL UNIQUE,
  tier VARCHAR(20) NOT NULL,
  current_version VARCHAR(50) NOT NULL,
  target_version VARCHAR(50),
  cohort VARCHAR(20) NOT NULL,
  last_health_check TIMESTAMP,
  health_status VARCHAR(20), -- 'healthy', 'degraded', 'unhealthy'
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_node_versions_tier ON node_versions(tier);
CREATE INDEX idx_node_versions_cohort ON node_versions(cohort);
CREATE INDEX idx_node_versions_health ON node_versions(health_status);
```

#### `health_reports`
```sql
CREATE TABLE health_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id VARCHAR(255) NOT NULL,
  version VARCHAR(50) NOT NULL,
  uptime BIGINT NOT NULL,
  cpu_usage DECIMAL(5,2),
  memory_usage DECIMAL(5,2),
  error_count INTEGER DEFAULT 0,
  reported_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_health_reports_node ON health_reports(node_id);
CREATE INDEX idx_health_reports_time ON health_reports(reported_at DESC);
```

---

## 4. Implementation Plan

### Phase 1: Docker Images (Days 1-2)
1. Create base Dockerfile with multi-stage build
2. Implement tier-specific package selection
3. Optimize layer caching and image size
4. Add security hardening
5. Set up automated builds in CI/CD
6. Test images locally and in CI

### Phase 2: Deployment Engine Core (Days 3-4)
1. Set up Fastify server with TypeScript
2. Implement VersionBeacon contract integration
3. Create cohort selection algorithm
4. Build version query endpoint
5. Add health reporting endpoint
6. Implement rollout status endpoint

### Phase 3: Database & State Management (Day 5)
1. Create PostgreSQL schema
2. Implement database migrations
3. Add Redis caching layer
4. Build state management logic
5. Create data access layer

### Phase 4: Rollback & Monitoring (Day 6)
1. Implement automatic rollback logic
2. Add health metric aggregation
3. Create Prometheus metrics export
4. Build alerting system
5. Add structured logging

### Phase 5: Testing (Day 7)
1. Unit tests for all components
2. Integration tests for API endpoints
3. End-to-end rollout simulation
4. Load testing
5. Security testing

### Phase 6: Documentation (Day 8)
1. API documentation
2. Deployment guide
3. Operations runbook
4. Architecture diagrams
5. Sprint 2 completion report

---

## 5. Quality Gates

### Docker Images
- ✅ All three tier images build successfully
- ✅ Image sizes within targets
- ✅ Security scan passes (no critical vulnerabilities)
- ✅ Images start and run correctly
- ✅ Health checks pass

### Deployment Engine
- ✅ All API endpoints functional
- ✅ VersionBeacon integration working
- ✅ Cohort selection deterministic and correct
- ✅ Automatic rollback triggers properly
- ✅ Database schema validated

### Testing
- ✅ >90% code coverage
- ✅ All unit tests passing
- ✅ Integration tests passing
- ✅ Load tests meet performance targets
- ✅ Security tests pass

### Documentation
- ✅ API documentation complete
- ✅ Architecture documented
- ✅ Operations runbook created
- ✅ Sprint completion report written

---

## 6. Success Criteria

Sprint 2 is considered complete when:

1. ✅ Three Docker images (ALL, ORACLE, GUARDIAN) are built and tested
2. ✅ Deployment Engine microservice is operational
3. ✅ Cohort selection algorithm is implemented and tested
4. ✅ VersionBeacon integration is working
5. ✅ Automatic rollback logic is functional
6. ✅ All tests pass with >90% coverage
7. ✅ Documentation is comprehensive and complete

---

**Prepared by:** Manus AI Agent  
**Sprint:** 2 - Packaging & Staging  
**Status:** 🔄 Design Phase Complete - Ready for Implementation  
**Next:** Begin Docker image implementation
