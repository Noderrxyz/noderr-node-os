#!/usr/bin/env node
/**
 * Node Onboarding CLI Executable
 * 
 * Usage: npx @noderr/node-onboarding
 */

import { runOnboarding } from './NodeOnboardingCLI';

// Load config from environment or defaults
const config = {
  rpcUrl: process.env.RPC_URL || 'http://localhost:8545',
  authApiUrl: process.env.AUTH_API_URL || 'http://localhost:3000',
  nodrTokenAddress: process.env.NODR_TOKEN_ADDRESS || '',
  utilityNFTAddress: process.env.UTILITY_NFT_ADDRESS || '',
  nodeRegistryAddress: process.env.NODE_REGISTRY_ADDRESS || ''
};

// Run onboarding
runOnboarding(config)
  .then((result) => {
    if (result.success) {
      process.exit(0);
    } else {
      process.exit(1);
    }
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
