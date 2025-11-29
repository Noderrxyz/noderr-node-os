#!/bin/bash

echo "=== Noderr Test Suite Runner ==="
echo "Total test files: $(find migrated -name "*.test.ts" -o -name "*.spec.ts" | wc -l)"
echo "Total test cases: $(grep -rE "(it\(|test\()" migrated | wc -l)"
echo ""

# Run tests with Jest
echo "Running tests..."
pnpm test --passWithNoTests 2>&1 | tee test-results.log

echo ""
echo "Test run complete. Results saved to test-results.log"
