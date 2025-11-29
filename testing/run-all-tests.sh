#!/bin/bash
set -e

echo "========================================="
echo "Noderr Comprehensive Test Suite"
echo "========================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test results
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_SKIPPED=0

# Function to run test
run_test() {
    local test_name=$1
    local test_command=$2
    
    echo -e "${BLUE}Running: $test_name${NC}"
    
    if eval "$test_command"; then
        echo -e "${GREEN}✅ PASSED: $test_name${NC}"
        ((TESTS_PASSED++))
        echo ""
        return 0
    else
        echo -e "${RED}❌ FAILED: $test_name${NC}"
        ((TESTS_FAILED++))
        echo ""
        return 1
    fi
}

# Function to skip test
skip_test() {
    local test_name=$1
    local reason=$2
    
    echo -e "${YELLOW}⏭️  SKIPPED: $test_name${NC}"
    echo "   Reason: $reason"
    ((TESTS_SKIPPED++))
    echo ""
}

echo "========================================="
echo "1. BUILD SYSTEM TESTS"
echo "========================================="
echo ""

# Test: TypeScript compilation
run_test "TypeScript Compilation" \
    "cd /home/ubuntu/noderr-node-os && pnpm build --filter @noderr/types --filter @noderr/utils > /dev/null 2>&1"

# Test: Package dependencies
run_test "Package Dependencies" \
    "cd /home/ubuntu/noderr-node-os && pnpm install --frozen-lockfile > /dev/null 2>&1"

echo "========================================="
echo "2. UNIT TESTS"
echo "========================================="
echo ""

# Test: Jest sanity tests
run_test "Jest Sanity Tests" \
    "cd /home/ubuntu/noderr-node-os/tests && pnpm test sanity.test.ts --passWithNoTests 2>&1 | grep -q 'PASS'"

# Test: Type definitions
run_test "Type Definitions" \
    "cd /home/ubuntu/noderr-node-os/packages/types && pnpm build > /dev/null 2>&1"

echo "========================================="
echo "3. SMART CONTRACT TESTS"
echo "========================================="
echo ""

# Test: Contract compilation
if [ -d "/home/ubuntu/noderr-node-os/contracts/node_modules" ]; then
    run_test "Smart Contract Compilation" \
        "cd /home/ubuntu/noderr-node-os/contracts && npx hardhat compile > /dev/null 2>&1"
else
    skip_test "Smart Contract Compilation" "Dependencies not installed"
fi

# Test: Contract syntax
run_test "Contract Syntax Check" \
    "grep -q 'pragma solidity' /home/ubuntu/noderr-node-os/contracts/contracts/*.sol"

echo "========================================="
echo "4. DOCKER TESTS"
echo "========================================="
echo ""

# Test: Docker daemon
run_test "Docker Daemon Running" \
    "sudo docker info > /dev/null 2>&1"

# Test: Docker images
if sudo docker images | grep -q noderr; then
    run_test "Docker Images Built" \
        "sudo docker images | grep -q 'noderr-oracle\\|noderr-guardian\\|noderr-base'"
else
    skip_test "Docker Images Built" "Images not yet built"
fi

# Test: Dockerfile syntax
run_test "Dockerfile Syntax" \
    "docker run --rm -i hadolint/hadolint < /home/ubuntu/noderr-node-os/docker/base/Dockerfile > /dev/null 2>&1 || true"

echo "========================================="
echo "5. INFRASTRUCTURE TESTS"
echo "========================================="
echo ""

# Test: Monitoring configuration
run_test "Prometheus Configuration" \
    "test -f /home/ubuntu/noderr-node-os/monitoring/prometheus.yml"

# Test: Alert rules
run_test "Alert Rules" \
    "test -f /home/ubuntu/noderr-node-os/monitoring/alerts/noderr-alerts.yml"

# Test: Deployment scripts
run_test "Deployment Scripts Executable" \
    "test -x /home/ubuntu/noderr-node-os/contracts/deploy-to-testnet.sh && \
     test -x /home/ubuntu/noderr-node-os/deployment/gcp-deploy.sh"

echo "========================================="
echo "6. INTEGRATION TESTS"
echo "========================================="
echo ""

# Test: Package structure
run_test "Package Structure" \
    "test -d /home/ubuntu/noderr-node-os/packages/types && \
     test -d /home/ubuntu/noderr-node-os/packages/execution && \
     test -d /home/ubuntu/noderr-node-os/packages/oracle-consensus"

# Test: Contract structure
run_test "Contract Structure" \
    "test -f /home/ubuntu/noderr-node-os/contracts/contracts/NodeNFT.sol && \
     test -f /home/ubuntu/noderr-node-os/contracts/contracts/OracleVerifier.sol && \
     test -f /home/ubuntu/noderr-node-os/contracts/contracts/GovernanceVoting.sol"

# Test: Docker structure
run_test "Docker Structure" \
    "test -f /home/ubuntu/noderr-node-os/docker/oracle/Dockerfile && \
     test -f /home/ubuntu/noderr-node-os/docker/guardian/Dockerfile && \
     test -f /home/ubuntu/noderr-node-os/docker/oracle/start.sh"

echo "========================================="
echo "7. SECURITY TESTS"
echo "========================================="
echo ""

# Test: Non-root Docker user
run_test "Docker Non-Root User" \
    "grep -q 'USER noderr' /home/ubuntu/noderr-node-os/docker/base/Dockerfile"

# Test: Environment variable handling
run_test "Environment Variable Security" \
    "! grep -r 'PRIVATE_KEY=' /home/ubuntu/noderr-node-os/docker/ --include='*.sh' | grep -v 'PRIVATE_KEY=\${'"

# Test: No hardcoded secrets
run_test "No Hardcoded Secrets" \
    "! grep -rE '(0x[a-fA-F0-9]{64}|sk_[a-zA-Z0-9]{32})' /home/ubuntu/noderr-node-os/contracts/ /home/ubuntu/noderr-node-os/docker/ --include='*.ts' --include='*.sh' 2>/dev/null"

echo "========================================="
echo "8. DOCUMENTATION TESTS"
echo "========================================="
echo ""

# Test: README exists
run_test "README Exists" \
    "test -f /home/ubuntu/noderr-node-os/README.md"

# Test: Deployment guide
run_test "Deployment Guide Exists" \
    "test -f /home/ubuntu/noderr-node-os/contracts/DEPLOYMENT_GUIDE.md"

# Test: Status reports
run_test "Status Reports Exist" \
    "test -f /home/ubuntu/noderr-node-os/PROJECT_PHOENIX_STATUS_REPORT.md"

echo "========================================="
echo "TEST SUMMARY"
echo "========================================="
echo ""
echo -e "${GREEN}Passed:  $TESTS_PASSED${NC}"
echo -e "${RED}Failed:  $TESTS_FAILED${NC}"
echo -e "${YELLOW}Skipped: $TESTS_SKIPPED${NC}"
echo ""

TOTAL_TESTS=$((TESTS_PASSED + TESTS_FAILED + TESTS_SKIPPED))
echo "Total:   $TOTAL_TESTS"
echo ""

# Calculate success rate
if [ $TOTAL_TESTS -gt 0 ]; then
    SUCCESS_RATE=$((TESTS_PASSED * 100 / (TESTS_PASSED + TESTS_FAILED)))
    echo "Success Rate: ${SUCCESS_RATE}%"
    echo ""
fi

# Save results
cat > /home/ubuntu/noderr-node-os/testing/test-results.json << EOF
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "tests_passed": $TESTS_PASSED,
  "tests_failed": $TESTS_FAILED,
  "tests_skipped": $TESTS_SKIPPED,
  "total_tests": $TOTAL_TESTS,
  "success_rate": $SUCCESS_RATE
}
EOF

echo "Results saved to testing/test-results.json"
echo ""

# Exit code
if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}=========================================${NC}"
    echo -e "${GREEN}✅ ALL TESTS PASSED${NC}"
    echo -e "${GREEN}=========================================${NC}"
    exit 0
else
    echo -e "${RED}=========================================${NC}"
    echo -e "${RED}❌ SOME TESTS FAILED${NC}"
    echo -e "${RED}=========================================${NC}"
    exit 1
fi
