import { config as dotenvConfig } from 'dotenv';
import { OnChainServiceConfig } from '@noderr/types';
import { ethers } from 'ethers';
import { getDefaultConfig } from './default';

// Load environment variables
dotenvConfig();

/**
 * Load configuration from environment variables
 */
export function loadConfig(): OnChainServiceConfig {
  // Get default config
  const defaults = getDefaultConfig();
  
  // Validate required environment variables
  const requiredVars = [
    'PRIVATE_KEY', // Only private key is truly required
  ];

  for (const varName of requiredVars) {
    if (!process.env[varName]) {
      throw new Error(`Missing required environment variable: ${varName}`);
    }
  }

  return {
    // Blockchain Configuration
    rpcUrl: process.env.RPC_URL || defaults.rpcUrl,
    chainId: process.env.CHAIN_ID ? parseInt(process.env.CHAIN_ID) : defaults.chainId,
    networkName: process.env.NETWORK_NAME || defaults.networkName,

    // Wallet Configuration
    privateKey: process.env.PRIVATE_KEY!,

    // Contract Addresses (use defaults from deployed contracts)
    treasuryManagerAddress: process.env.TREASURY_MANAGER_ADDRESS || defaults.treasuryManagerAddress,
    merkleRewardDistributorAddress: process.env.MERKLE_REWARD_DISTRIBUTOR_ADDRESS || defaults.merkleRewardDistributorAddress,
    trustFingerprintAddress: process.env.TRUST_FINGERPRINT_ADDRESS || defaults.trustFingerprintAddress,
    nodeRegistryAddress: process.env.NODE_REGISTRY_ADDRESS || defaults.nodeRegistryAddress,
    governanceManagerAddress: process.env.GOVERNANCE_MANAGER_ADDRESS || defaults.governanceManagerAddress,

    // Security Configuration
    maxCapitalRequest: process.env.MAX_CAPITAL_REQUEST
      ? BigInt(process.env.MAX_CAPITAL_REQUEST)
      : ethers.parseEther('1000'), // Default: 1000 ETH

    dailyCapitalLimit: process.env.DAILY_CAPITAL_LIMIT
      ? BigInt(process.env.DAILY_CAPITAL_LIMIT)
      : ethers.parseEther('5000'), // Default: 5000 ETH

    rateLimitRequestsPerHour: process.env.RATE_LIMIT_REQUESTS_PER_HOUR
      ? parseInt(process.env.RATE_LIMIT_REQUESTS_PER_HOUR)
      : 10, // Default: 10 requests per hour

    // Logging Configuration
    logLevel: (process.env.LOG_LEVEL as any) || 'info',
    logFile: process.env.LOG_FILE,
  };
}

/**
 * Validate configuration
 */
export function validateConfig(config: OnChainServiceConfig): void {
  // Validate RPC URL
  if (!config.rpcUrl.startsWith('http://') && !config.rpcUrl.startsWith('https://') && !config.rpcUrl.startsWith('ws://') && !config.rpcUrl.startsWith('wss://')) {
    throw new Error('Invalid RPC URL format');
  }

  // Validate chain ID
  if (config.chainId <= 0) {
    throw new Error('Invalid chain ID');
  }

  // Validate private key format
  if (!config.privateKey.startsWith('0x') || config.privateKey.length !== 66) {
    throw new Error('Invalid private key format (must be 0x-prefixed 32-byte hex string)');
  }

  // Validate contract addresses
  const addresses = [
    config.treasuryManagerAddress,
    config.merkleRewardDistributorAddress,
    config.trustFingerprintAddress,
  ];

  for (const address of addresses) {
    if (!ethers.isAddress(address)) {
      throw new Error(`Invalid contract address: ${address}`);
    }
  }

  // Validate security limits
  if (BigInt(config.maxCapitalRequest) <= 0) {
    throw new Error('Max capital request must be greater than 0');
  }

  if (BigInt(config.dailyCapitalLimit) <= 0) {
    throw new Error('Daily capital limit must be greater than 0');
  }

  if (BigInt(config.dailyCapitalLimit) < BigInt(config.maxCapitalRequest)) {
    throw new Error('Daily capital limit must be greater than or equal to max capital request');
  }

  if (config.rateLimitRequestsPerHour <= 0) {
    throw new Error('Rate limit must be greater than 0');
  }
}
