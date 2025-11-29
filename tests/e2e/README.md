# End-to-End Integration Tests

Comprehensive test suite for the complete autonomous trading pipeline.

## Test Coverage

### Full Trading Pipeline Tests

1. **Happy Path** - Complete trading pipeline from ML prediction to settlement
2. **Risk Rejection** - High-risk trade rejection by risk management
3. **Consensus Failure** - Graceful handling of consensus failures
4. **Human Oversight** - Alert generation and acknowledgment
5. **Trade Approval** - Trade approval workflow for large trades
6. **Emergency Stop** - Emergency stop and resume mechanism
7. **Oracle Consensus** - Multi-oracle consensus on trading signals
8. **Concurrent Trades** - Multiple concurrent trade execution
9. **Performance Metrics** - Accurate tracking of performance metrics
10. **Error Recovery** - Graceful error recovery

### Performance Benchmarks

1. **Submission Latency** - Trade submission in <100ms
2. **Concurrent Load** - 100 concurrent trades

## Running Tests

### Prerequisites

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build
```

### Run All Tests

```bash
pnpm test
```

### Run E2E Tests Only

```bash
pnpm test tests/e2e
```

### Run with Coverage

```bash
pnpm test --coverage
```

### Run Specific Test

```bash
pnpm test tests/e2e/full-trading-pipeline.test.ts
```

## Test Environment

### Required Environment Variables

```bash
# Blockchain RPC
export RPC_URL="http://localhost:8545"

# Oracle Verifier Contract
export ORACLE_VERIFIER_ADDRESS="0x5FbDB2315678afecb367f032d93F642f64180aa3"

# Private Key (for testing only)
export PRIVATE_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
```

### Local Blockchain Setup

For testing, you can use Hardhat local network:

```bash
# Terminal 1: Start Hardhat node
npx hardhat node

# Terminal 2: Deploy contracts
npx hardhat run scripts/deploy-oracle-verifier.ts --network localhost

# Terminal 3: Run tests
pnpm test tests/e2e
```

## Test Architecture

### Component Integration

```
ML Prediction
    ↓
Autonomous Execution Orchestrator
    ↓
Risk Management
    ↓
Oracle Consensus (BFT)
    ↓
Trade Execution
    ↓
On-Chain Settlement
    ↓
Human Oversight (Notifications)
```

### Test Flow

1. **Initialize** - Set up all components
2. **Submit** - Submit ML prediction
3. **Risk Check** - Verify risk management
4. **Consensus** - Reach Oracle consensus
5. **Execute** - Execute trade
6. **Settle** - Settle on-chain
7. **Notify** - Send notifications
8. **Verify** - Verify final state
9. **Cleanup** - Shutdown components

## Success Criteria

### Functional Requirements

- [x] Complete pipeline execution
- [x] Risk management rejection
- [x] Consensus validation
- [x] Alert generation
- [x] Trade approval workflow
- [x] Emergency stop mechanism
- [x] Concurrent trade handling
- [x] Error recovery

### Performance Requirements

- [x] Trade submission <100ms
- [x] 100 concurrent trades
- [x] 95%+ success rate
- [x] Graceful error handling

### Quality Requirements

- [x] Zero TypeScript errors
- [x] Comprehensive test coverage
- [x] Production-ready reliability
- [x] Institutional-grade quality

## Troubleshooting

### Common Issues

**Issue:** Tests timeout  
**Solution:** Increase timeout in jest.config.js or test file

**Issue:** Contract not found  
**Solution:** Deploy contracts to local network first

**Issue:** Insufficient gas  
**Solution:** Ensure test wallet has sufficient ETH

**Issue:** Consensus fails  
**Solution:** Check Oracle registration and network connectivity

## Contributing

When adding new tests:

1. Follow existing test structure
2. Use descriptive test names
3. Add comments for complex logic
4. Update this README
5. Ensure all tests pass

## License

MIT
