#!/bin/bash

echo "Fixing import paths in migrated tests..."

cd /home/ubuntu/noderr-node-os/tests/migrated

# Find all test files and fix imports
for file in *.test.ts *.spec.ts; do
  if [ -f "$file" ]; then
    # Replace relative imports with @noderr/* package imports
    sed -i "s|from '../../execution/|from '@noderr/execution/src/|g" "$file"
    sed -i "s|from '../../governance/|from '@noderr/governance/src/|g" "$file"
    sed -i "s|from '../../risk-engine/|from '@noderr/risk-engine/src/|g" "$file"
    sed -i "s|from '../../ml/|from '@noderr/ml/src/|g" "$file"
    sed -i "s|from '../../market-intel/|from '@noderr/market-intel/src/|g" "$file"
    sed -i "s|from '../../alpha-exploitation/|from '@noderr/alpha-exploitation/src/|g" "$file"
    sed -i "s|from '../../../|from '@noderr/|g" "$file"
    sed -i "s|from '../../|from '@noderr/|g" "$file"
    
    # Remove .js extensions
    sed -i "s|\.js'|'|g" "$file"
    
    echo "Fixed: $file"
  fi
done

echo "Import path fixing complete!"
