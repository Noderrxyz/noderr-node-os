# Noderr Architecture Reality Check

**Date**: December 11, 2025  
**Status**: Engineering Team Reference

---

## Purpose

This document serves as a **reality check** for the Noderr Protocol architecture. It clarifies what is actually implemented in the codebase versus what may be described in older design documents or white papers.

---

## ✅ What IS Implemented

### 1. Three-Node Architecture

The system is built on three distinct node types:

- **Oracle Nodes** (`packages/oracle-consensus`): BFT consensus on trading signals
- **Guardian Nodes** (`packages/guardian-consensus`): Majority voting on risk approvals
- **Validator Nodes** (`packages/execution`): Smart order routing and trade execution

### 2. Autonomous Trading Pipeline

The `AutonomousExecutionOrchestrator` (`packages/autonomous-execution`) coordinates:

1. ML Signal Generation
2. Risk Assessment
3. Oracle Consensus
4. Trade Execution

### 3. Floor Engine

The Floor Engine (`packages/floor-engine`) is a **separate, low-risk yield generation system**. It is NOT part of the active trading (ATS/ATE) pipeline.

### 4. Core Infrastructure

- **Risk Engine** (`packages/risk-engine`): Portfolio risk management
- **Market Data** (`packages/market-data`): Real-time market data feeds
- **Telemetry** (`packages/telemetry`): Monitoring and metrics
- **On-Chain Service** (`packages/on-chain-service`): Blockchain interaction

---

## ❌ What is NOT Implemented

### 1. Micro Nodes

**Status**: Not present in the codebase.

The white paper mentions "Micro Nodes" as a fourth node type, but this concept does not exist in the current implementation. All references to Micro Nodes should be removed from documentation.

### 2. Shadow Data Swarm

**Status**: Not present in the codebase.

The white paper describes a "Shadow Data Swarm" for strategy submission and validation, but this is not implemented. The current system is designed for **internal strategy generation only**.

### 3. External Strategy Submission Flow

**Status**: Not implemented.

There is no mechanism for external users to submit strategies. The `OracleCoordinator` is designed to receive signals from an internal `mlService`, not from an external API.

**What needs to be built**:
- A decentralized submission gateway
- Oracle discovery mechanism (query `NodeRegistry` contract)
- External strategy validation module for Oracle nodes

---

## 🔧 What Needs to Be Fixed

### 1. Documentation Updates

All documentation that references "Micro Nodes" or "Shadow Data Swarm" must be updated to reflect the actual 3-node architecture.

**Files to update**:
- White papers
- Architecture diagrams
- API documentation
- User-facing guides

### 2. Strategy Submission Implementation

The strategy submission flow described in the white paper (user → dApp → Oracle → Guardian → approval) needs to be implemented from scratch.

**Required components**:
1. **Submission Gateway**: A service that receives strategy submissions and routes them to the Oracle network
2. **Oracle Discovery**: dApp queries `NodeRegistry` contract for active Oracle endpoints
3. **External Strategy Handler**: Oracle nodes validate, backtest, and convert external strategies
4. **Guardian Review**: Guardian nodes vote on the risk profile of new strategies
5. **On-Chain Registration**: Approved strategies are registered in the `StrategyRegistry` contract

### 3. dApp Integration

The dApp currently has a mock submission flow. It needs to be updated to:
- Query the `NodeRegistry` contract for Oracle endpoints
- Submit strategies to multiple Oracle nodes (for redundancy)
- Poll for submission status
- Display approval/rejection reasons

---

## 📋 Correct Information Flow

### For Internal Trading (Currently Working)

```
ML Service → Autonomous Orchestrator → Oracle Consensus → Guardian Approval → Validator Execution
```

### For External Strategy Submission (Needs to Be Built)

```
User (dApp) → NodeRegistry (discover Oracles) → Oracle Nodes (validate & backtest) 
→ Guardian Nodes (risk review) → StrategyRegistry (on-chain approval) → User (stake NODR)
```

---

## 🎯 Action Items

1. **Update all documentation** to remove references to Micro Nodes and Shadow Data Swarm
2. **Implement Oracle API** for external strategy submissions
3. **Build External Strategy Handler** module for Oracle nodes
4. **Update dApp** to query `NodeRegistry` and submit to decentralized Oracle network
5. **Test end-to-end** submission flow on testnet

---

## Conclusion

This document is the **source of truth** for the Noderr Protocol architecture as of December 11, 2025. All future development and documentation should align with this reality.

Any discrepancies between this document and other materials should be resolved in favor of this document, which is based on the actual codebase.
