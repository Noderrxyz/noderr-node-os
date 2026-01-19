# Network Testing Guide

## Overview

This guide covers comprehensive testing of the Noderr P2P network, from bootstrap nodes to full Oracle/Guardian/Validator node operation.

## Prerequisites

- 3+ bootstrap nodes deployed and running
- Bootstrap multiaddrs collected and documented
- Docker images built and pushed to registry
- Test NODR tokens available on Base Sepolia
- Test wallet with Base Sepolia ETH for gas

## Phase 1: Bootstrap Network Testing

### 1.1 Verify Bootstrap Nodes

Test each bootstrap node individually:

```bash
# SSH into bootstrap node
ssh ubuntu@<bootstrap-ip>

# Check PM2 status
pm2 status

# Expected output:
# ┌─────┬──────────────────┬─────────────┬─────────┬─────────┬──────────┐
# │ id  │ name             │ mode        │ ↺       │ status  │ cpu      │
# ├─────┼──────────────────┼─────────────┼─────────┼─────────┼──────────┤
# │ 0   │ p2p-bootstrap    │ fork        │ 0       │ online  │ 0%       │
# │ 1   │ telemetry        │ fork        │ 0       │ online  │ 0%       │
# └─────┴──────────────────┴─────────────┴─────────┴─────────┴──────────┘

# Check logs for Peer ID
pm2 logs p2p-bootstrap --lines 50 | grep "Peer ID"

# Test health endpoint
curl http://localhost:8080/health

# Expected: {"status":"healthy","timestamp":"..."}

# Check metrics
curl http://localhost:8080/metrics

# Test P2P ports
sudo netstat -tuln | grep 4001
sudo netstat -tuln | grep 4002
```

### 1.2 Test Bootstrap Connectivity

From a different machine:

```bash
# Test TCP connectivity
telnet <bootstrap-ip> 4001

# Test WebSocket connectivity
curl -i -N -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: test" \
  http://<bootstrap-ip>:4002/
```

### 1.3 Collect Bootstrap Multiaddrs

Create a file with all bootstrap multiaddrs:

```bash
# bootstrap-nodes.txt
/ip4/1.2.3.4/tcp/4001/p2p/12D3KooWBhAwkzLRBkAzzjJQ4kMJTh4RhDKYQCvYN2Xb5V6W8XYZ
/ip4/5.6.7.8/tcp/4001/p2p/12D3KooWCvXzDqN9Qj7nRkBvYZQCxYNbVwXb5V6W8XYZ9AbCdEf
/ip4/9.10.11.12/tcp/4001/p2p/12D3KooWDfGhIjKlMnOpQrStUvWxYzAbCdEfGhIjKlMnOpQrSt
```

## Phase 2: Validator Node Testing

### 2.1 Deploy Test Validator

```bash
# Pull Docker image
docker pull ghcr.io/noderrxyz/noderr-validator:latest

# Create .env file
cat > validator.env << 'EOF'
NODE_ENV=production
NODE_TYPE=validator
NODE_ID=test-validator-1

# Wallet Configuration
PRIVATE_KEY=<your-test-private-key>
WALLET_ADDRESS=<your-test-wallet-address>

# RPC Endpoints (operator-provided)
BASE_SEPOLIA_RPC=https://sepolia.base.org
ETHEREUM_RPC=https://eth-sepolia.g.alchemy.com/v2/<your-key>

# P2P Configuration
P2P_LISTEN_PORT=4001
P2P_WS_PORT=4002
BOOTSTRAP_NODES=/ip4/1.2.3.4/tcp/4001/p2p/12D3KooW...,/ip4/5.6.7.8/tcp/4001/p2p/12D3KooW...

# Contract Addresses (Base Sepolia)
NODR_TOKEN_ADDRESS=0x61318A5e42612f1d0B67f443E457B8E9C2F001D6
STAKING_MANAGER_ADDRESS=0x382343dCCe23017e9b14DC68AD066250E07b2994
NODE_REGISTRY_ADDRESS=0x0C384F177b11FDf39360e6d1030608AfE670cF7c

# Telemetry
METRICS_PORT=8080
EOF

# Run validator
docker run -d \
  --name validator-test \
  --env-file validator.env \
  -p 4001:4001 \
  -p 4002:4002 \
  -p 8080:8080 \
  ghcr.io/noderrxyz/noderr-validator:latest
```

### 2.2 Verify Validator Operation

```bash
# Check container status
docker ps

# Check logs
docker logs validator-test -f

# Look for:
# ✅ "Validator node started successfully"
# ✅ "Connected to bootstrap nodes"
# ✅ "P2P network initialized"
# ✅ "Discovered X peers"

# Test health endpoint
curl http://localhost:8080/health

# Check metrics
curl http://localhost:8080/metrics

# Expected metrics:
# - node_type="validator"
# - peer_count > 0
# - uptime_seconds > 0
```

### 2.3 Test P2P Discovery

```bash
# Check peer connections
docker logs validator-test | grep "peer"

# Expected:
# "Discovered peer: 12D3KooW..."
# "Connected to bootstrap node"
# "Peer count: 3"

# Test from another validator
docker run --rm \
  --env-file validator2.env \
  ghcr.io/noderrxyz/noderr-validator:latest

# Should discover first validator through bootstrap nodes
```

## Phase 3: Guardian Node Testing

### 3.1 Deploy Test Guardian

```bash
# Create guardian.env
cat > guardian.env << 'EOF'
NODE_ENV=production
NODE_TYPE=guardian
NODE_ID=test-guardian-1

# Wallet Configuration
PRIVATE_KEY=<guardian-test-private-key>
WALLET_ADDRESS=<guardian-test-wallet-address>

# RPC Endpoints
BASE_SEPOLIA_RPC=https://sepolia.base.org
ETHEREUM_RPC=https://eth-sepolia.g.alchemy.com/v2/<your-key>

# P2P Configuration
P2P_LISTEN_PORT=4001
P2P_WS_PORT=4002
BOOTSTRAP_NODES=/ip4/1.2.3.4/tcp/4001/p2p/12D3KooW...,/ip4/5.6.7.8/tcp/4001/p2p/12D3KooW...

# Contract Addresses
NODR_TOKEN_ADDRESS=0x61318A5e42612f1d0B67f443E457B8E9C2F001D6
STAKING_MANAGER_ADDRESS=0x382343dCCe23017e9b14DC68AD066250E07b2994
NODE_REGISTRY_ADDRESS=0x0C384F177b11FDf39360e6d1030608AfE670cF7c

# Guardian-specific
GUARDIAN_CONSENSUS_THRESHOLD=0.66
GUARDIAN_VOTE_TIMEOUT=30000

# Telemetry
METRICS_PORT=8081
EOF

# Run guardian
docker run -d \
  --name guardian-test \
  --env-file guardian.env \
  -p 4003:4001 \
  -p 4004:4002 \
  -p 8081:8081 \
  ghcr.io/noderrxyz/noderr-guardian:latest
```

### 3.2 Test Guardian Consensus

```bash
# Deploy multiple guardians (minimum 3 for consensus)
for i in {1..3}; do
  docker run -d \
    --name guardian-test-$i \
    --env-file guardian$i.env \
    -p $((4000 + i*2)):4001 \
    -p $((4001 + i*2)):4002 \
    -p $((8080 + i)):8080 \
    ghcr.io/noderrxyz/noderr-guardian:latest
done

# Check logs for consensus messages
docker logs guardian-test-1 | grep "consensus"

# Expected:
# "Guardian consensus initialized"
# "Voting on proposal: ..."
# "Consensus reached: approve"
```

## Phase 4: Oracle Node Testing

### 4.1 Deploy Test Oracle

```bash
# Create oracle.env
cat > oracle.env << 'EOF'
NODE_ENV=production
NODE_TYPE=oracle
NODE_ID=test-oracle-1

# Wallet Configuration
PRIVATE_KEY=<oracle-test-private-key>
WALLET_ADDRESS=<oracle-test-wallet-address>

# RPC Endpoints
BASE_SEPOLIA_RPC=https://sepolia.base.org
ETHEREUM_RPC=https://eth-sepolia.g.alchemy.com/v2/<your-key>
ARBITRUM_RPC=https://arb-sepolia.g.alchemy.com/v2/<your-key>
OPTIMISM_RPC=https://opt-sepolia.g.alchemy.com/v2/<your-key>

# P2P Configuration
P2P_LISTEN_PORT=4001
P2P_WS_PORT=4002
BOOTSTRAP_NODES=/ip4/1.2.3.4/tcp/4001/p2p/12D3KooW...,/ip4/5.6.7.8/tcp/4001/p2p/12D3KooW...

# Contract Addresses
NODR_TOKEN_ADDRESS=0x61318A5e42612f1d0B67f443E457B8E9C2F001D6
STAKING_MANAGER_ADDRESS=0x382343dCCe23017e9b14DC68AD066250E07b2994
NODE_REGISTRY_ADDRESS=0x0C384F177b11FDf39360e6d1030608AfE670cF7c

# Oracle-specific
ENABLE_ALPHA_EDGE=true
ENABLE_STRATEGY_GENERATION=true

# Telemetry
METRICS_PORT=8082
EOF

# Run oracle
docker run -d \
  --name oracle-test \
  --env-file oracle.env \
  -p 4005:4001 \
  -p 4006:4002 \
  -p 8082:8082 \
  ghcr.io/noderrxyz/noderr-oracle:latest
```

### 4.2 Test Oracle Intelligence

```bash
# Check logs for intelligence gathering
docker logs oracle-test | grep "alpha-edge"

# Expected:
# "Alpha-edge service started"
# "Scanning for arbitrage opportunities"
# "Found opportunity: ..."

# Check strategy generation
docker logs oracle-test | grep "strategy"

# Expected:
# "Strategy generation enabled"
# "Analyzing market conditions"
```

## Phase 5: End-to-End Network Testing

### 5.1 Full Network Topology

Deploy a complete test network:

```
3 Bootstrap Nodes (us-east, eu-west, ap-south)
    ↓
3 Oracle Nodes (intelligence layer)
    ↓
5 Guardian Nodes (risk validation layer)
    ↓
10 Validator Nodes (execution layer)
```

### 5.2 Test Network Formation

```bash
# Check peer discovery across all nodes
for container in $(docker ps --format '{{.Names}}' | grep 'test'); do
  echo "=== $container ==="
  docker logs $container 2>&1 | grep "Discovered peer" | tail -5
done

# Expected: Each node should discover multiple peers
```

### 5.3 Test Consensus Flow

Simulate a trading opportunity:

```bash
# Oracle generates signal
docker exec oracle-test-1 node -e "
  const signal = {
    type: 'arbitrage',
    opportunity: 'USDC/USDT spread',
    expectedProfit: 0.05,
    risk: 0.02
  };
  console.log('Broadcasting signal:', signal);
"

# Check Guardian consensus
docker logs guardian-test-1 | grep "Received signal"
docker logs guardian-test-1 | grep "Voting"
docker logs guardian-test-1 | grep "Consensus"

# Check Validator execution
docker logs validator-test-1 | grep "Executing trade"
```

### 5.4 Test Reputation Updates

```bash
# Check on-chain reputation
cast call $TRUST_FINGERPRINT_ADDRESS \
  "getReputation(uint256)(uint256)" \
  <token-id> \
  --rpc-url https://sepolia.base.org

# Check reputation updates in logs
docker logs validator-test-1 | grep "reputation"
```

## Phase 6: Load Testing

### 6.1 Stress Test P2P Network

```bash
# Deploy 50 validator nodes
for i in {1..50}; do
  docker run -d \
    --name load-test-validator-$i \
    --env NODE_ID=load-validator-$i \
    --env-file validator.env \
    ghcr.io/noderrxyz/noderr-validator:latest
done

# Monitor bootstrap node load
ssh ubuntu@<bootstrap-ip>
htop
pm2 monit

# Check peer counts
curl http://localhost:8080/metrics | grep peer_count
```

### 6.2 Stress Test Consensus

```bash
# Generate 100 signals rapidly
for i in {1..100}; do
  docker exec oracle-test-1 node scripts/generate-signal.js &
done

# Monitor guardian consensus performance
docker logs guardian-test-1 | grep "consensus time"

# Check for consensus failures
docker logs guardian-test-1 | grep "timeout"
```

### 6.3 Monitor System Resources

```bash
# Check Docker resource usage
docker stats

# Check network bandwidth
sudo iftop -i eth0

# Check disk I/O
sudo iotop

# Check system load
uptime
```

## Phase 7: Failure Testing

### 7.1 Test Bootstrap Node Failure

```bash
# Stop one bootstrap node
ssh ubuntu@<bootstrap-ip>
pm2 stop all

# Verify network continues operating
docker logs validator-test-1 | grep "peer"

# Expected: Nodes should connect to remaining bootstrap nodes
```

### 7.2 Test Node Disconnection

```bash
# Disconnect a validator
docker stop validator-test-1

# Check if network detects disconnection
docker logs guardian-test-1 | grep "peer disconnected"

# Restart validator
docker start validator-test-1

# Verify reconnection
docker logs validator-test-1 | grep "Reconnected"
```

### 7.3 Test Network Partition

```bash
# Simulate network partition using iptables
sudo iptables -A INPUT -s <guardian-ip> -j DROP
sudo iptables -A OUTPUT -d <guardian-ip> -j DROP

# Monitor consensus behavior
docker logs guardian-test-1 | grep "consensus"

# Expected: Consensus should fail gracefully

# Restore network
sudo iptables -D INPUT -s <guardian-ip> -j DROP
sudo iptables -D OUTPUT -d <guardian-ip> -j DROP
```

## Phase 8: Performance Benchmarks

### 8.1 Measure Latency

```bash
# P2P message latency
docker exec validator-test-1 node scripts/measure-latency.js

# Expected: < 100ms for same region, < 300ms cross-region

# Consensus latency
docker logs guardian-test-1 | grep "consensus time"

# Expected: < 5 seconds for 66% consensus
```

### 8.2 Measure Throughput

```bash
# Signals per second
docker logs oracle-test-1 | grep "signals generated" | tail -100

# Trades per minute
docker logs validator-test-1 | grep "trade executed" | tail -100
```

### 8.3 Measure Resource Usage

```bash
# Average CPU per node type
docker stats --no-stream | grep validator | awk '{sum+=$3; count++} END {print sum/count "%"}'

# Average memory per node type
docker stats --no-stream | grep guardian | awk '{sum+=$4; count++} END {print sum/count "%"}'
```

## Success Criteria

### Bootstrap Network
- ✅ All bootstrap nodes online and healthy
- ✅ Bootstrap nodes discoverable from external networks
- ✅ Peer discovery working across regions

### Node Operation
- ✅ All node types start successfully
- ✅ Nodes connect to bootstrap network
- ✅ Nodes discover each other via DHT
- ✅ Telemetry reporting correctly

### Consensus
- ✅ Guardian consensus reaches 66% threshold
- ✅ Consensus completes within 5 seconds
- ✅ Failed consensus handled gracefully

### Performance
- ✅ P2P latency < 300ms cross-region
- ✅ Consensus latency < 5 seconds
- ✅ Network handles 50+ nodes
- ✅ CPU usage < 50% per node
- ✅ Memory usage < 2GB per node

### Reliability
- ✅ Network survives single bootstrap failure
- ✅ Nodes reconnect after disconnection
- ✅ No memory leaks after 24h operation
- ✅ No consensus deadlocks

## Troubleshooting

### Nodes can't discover each other

```bash
# Check bootstrap multiaddrs are correct
docker logs validator-test-1 | grep "BOOTSTRAP_NODES"

# Verify bootstrap nodes are reachable
telnet <bootstrap-ip> 4001

# Check firewall rules
sudo ufw status
```

### Consensus timeouts

```bash
# Check guardian count
docker ps | grep guardian | wc -l

# Minimum 3 guardians required

# Check network latency
docker exec guardian-test-1 ping <other-guardian-ip>

# Increase timeout if needed
GUARDIAN_VOTE_TIMEOUT=60000
```

### High memory usage

```bash
# Check for memory leaks
docker stats --no-stream

# Restart affected containers
docker restart <container-name>

# Check logs for errors
docker logs <container-name> | grep -i "error\|memory"
```

## Next Steps

After successful network testing:

1. Document all bootstrap multiaddrs
2. Update operator documentation
3. Create monitoring dashboards
4. Set up automated health checks
5. Plan mainnet deployment
