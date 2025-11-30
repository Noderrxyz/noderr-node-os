# Deep Architecture Analysis - Work in Progress

## Key Findings So Far

### 1. System Orchestrator (Central Coordinator)

The `system-orchestrator` package is the main entry point that coordinates:
- **SafetyController**: Trading mode management
- **AlphaOrchestrator**: Signal generation and strategy management
- **CapitalManager**: Capital allocation across strategies
- **ExecutionOptimizer**: Order execution across exchanges
- **PerformanceRegistry**: Strategy performance tracking

### 2. P2P Network (Decentralized Communication)

The `decentralized-core` package provides:
- **libp2p** for P2P networking
- **gossipsub** for pub/sub messaging
- **Topics**:
  - `/noderr/signals/1.0.0` - Trading signals
  - `/noderr/executions/1.0.0` - Execution results
  - `/noderr/metrics/1.0.0` - Performance metrics
  - `/noderr/consensus/1.0.0` - Consensus messages

### 3. Node Runtime (Task Execution)

The `node-runtime` package:
- Loads ML models from Supabase
- Runs inference using TensorFlow.js
- Reports results back to backend
- Collects telemetry

### 4. Operator Onboarding (Supabase)

The system uses Supabase for:
- **operator_applications**: Store applications from Typeform
- **operator_credentials**: API keys and node IDs
- **operator_downloads**: Track software downloads
- **operator_notifications**: Email notifications

### 5. Node Tiers

- **ALL**: 1,000 NODERR stake, 1.0x reward, general operations
- **ORACLE**: 5,000 NODERR stake, 2.0x reward, price feeds and data
- **GUARDIAN**: 10,000 NODERR stake, 5.0x reward, security and governance

## Questions to Answer

1. **What specific tasks does each node tier perform?**
2. **How does the ML inference fit into the workflow?**
3. **Where does signal generation happen?** (AlphaOrchestrator? ML models?)
4. **How do nodes coordinate on consensus?**
5. **Is ML only on ORACLE nodes, or all nodes?**

## Next Steps

- Read AlphaOrchestrator to understand signal generation
- Read oracle-consensus to understand how ORACLE nodes work
- Find the actual task definitions for each tier
- Understand the complete workflow from data → signal → execution


## CRITICAL FINDING: Complete Workflow Discovered!

### The Autonomous Trading Pipeline

The system follows this workflow:

**1. ML Signal Generation** (ORACLE nodes)
- ORACLE nodes run ML models via `node-runtime`
- Models generate `MLPrediction` objects with:
  - symbol, action, confidence, price
  - features, modelId, timestamp

**2. Risk Management**
- `AutonomousExecutionOrchestrator` receives predictions
- Risk engine assesses: position size, leverage, max loss
- Approved predictions move to consensus

**3. Oracle Consensus**
- `OracleCoordinator` collects signals from multiple ORACLE nodes
- `BFTConsensusEngine` coordinates Byzantine Fault Tolerant consensus
- Requires 67% agreement (configurable)
- Consensus signal broadcast via P2P network

**4. Execution**
- Execution engine receives consensus signal
- Splits orders using TWAP/VWAP/POV algorithms
- Executes across multiple exchanges
- Reports results back to network

### Where Our PyTorch ML Service Fits

**ORACLE nodes** are the ones running ML inference!

The current system uses:
- `node-runtime` with TensorFlow.js
- Models downloaded from Supabase
- Local inference on each ORACLE node

**Our integration strategy**:
1. Replace TensorFlow.js with our PyTorch gRPC service
2. ORACLE nodes run both Node.js runtime AND Python ML service
3. Node.js calls Python via gRPC for predictions
4. Results flow through the same consensus pipeline

### Node Tier Responsibilities (CONFIRMED)

- **ALL nodes**: Basic network participation, relay messages
- **ORACLE nodes**: Run ML models, generate trading signals, participate in consensus
- **GUARDIAN nodes**: Validate consensus, enforce slashing, governance

**ONLY ORACLE NODES RUN ML MODELS** ✓

This confirms your intuition!
