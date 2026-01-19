/**
 * Default configuration for on-chain service
 * Base Sepolia Testnet (Chain ID: 84532)
 */

export const DEFAULT_CONFIG = {
  // Network Configuration
  chainId: 84532,
  networkName: 'base-sepolia',
  rpcUrl: 'https://sepolia.base.org',
  
  // Deployed Contract Addresses (Base Sepolia)
  nodrTokenAddress: '0x61318A5e42612f1d0B67f443E457B8E9C2F001D6',
  utilityNFTAddress: '0xD67326eE24F3a5fcb8a12AaD294Dc610642F96cC',
  trustFingerprintAddress: '0xFf3BFD4eDC994d54B2adD3b315281590a50a9d95',
  stakingManagerAddress: '0x5B78820Af5c910Fe3413FF0eb6F356d77d94B1eC',
  rewardDistributorAddress: '0x33Ac6daE76D2f3008b1b6dDfbA34933746e34359',
  governanceManagerAddress: '0x72a065E5cf055F65d4c37CBc9d9DC5314115e5d7',
  nodeRegistryAddress: '0x175Cc86EF0c0C6f3CF865c5599863F6F61A60f58',
  guardianWorkloadManagerAddress: '0x8a55C0ab60FAD4ef913c6dfddB403a454B0818c0',
  
  // Legacy aliases (for backward compatibility)
  treasuryManagerAddress: '0x5B78820Af5c910Fe3413FF0eb6F356d77d94B1eC', // StakingManager
  merkleRewardDistributorAddress: '0x33Ac6daE76D2f3008b1b6dDfbA34933746e34359', // RewardDistributor
  
  // Block Explorer
  blockExplorerUrl: 'https://sepolia.basescan.org',
};

/**
 * Get configuration with environment variable overrides
 */
export function getDefaultConfig() {
  return {
    ...DEFAULT_CONFIG,
    // Allow environment variables to override defaults
    rpcUrl: process.env.RPC_URL || DEFAULT_CONFIG.rpcUrl,
    chainId: process.env.CHAIN_ID ? parseInt(process.env.CHAIN_ID) : DEFAULT_CONFIG.chainId,
    
    // Contract addresses can be overridden
    nodrTokenAddress: process.env.NODR_TOKEN_ADDRESS || DEFAULT_CONFIG.nodrTokenAddress,
    utilityNFTAddress: process.env.UTILITY_NFT_ADDRESS || DEFAULT_CONFIG.utilityNFTAddress,
    trustFingerprintAddress: process.env.TRUST_FINGERPRINT_ADDRESS || DEFAULT_CONFIG.trustFingerprintAddress,
    stakingManagerAddress: process.env.STAKING_MANAGER_ADDRESS || DEFAULT_CONFIG.stakingManagerAddress,
    rewardDistributorAddress: process.env.REWARD_DISTRIBUTOR_ADDRESS || DEFAULT_CONFIG.rewardDistributorAddress,
    governanceManagerAddress: process.env.GOVERNANCE_MANAGER_ADDRESS || DEFAULT_CONFIG.governanceManagerAddress,
    nodeRegistryAddress: process.env.NODE_REGISTRY_ADDRESS || DEFAULT_CONFIG.nodeRegistryAddress,
    guardianWorkloadManagerAddress: process.env.GUARDIAN_WORKLOAD_MANAGER_ADDRESS || DEFAULT_CONFIG.guardianWorkloadManagerAddress,
    
    // Legacy aliases
    treasuryManagerAddress: process.env.TREASURY_MANAGER_ADDRESS || DEFAULT_CONFIG.treasuryManagerAddress,
    merkleRewardDistributorAddress: process.env.MERKLE_REWARD_DISTRIBUTOR_ADDRESS || DEFAULT_CONFIG.merkleRewardDistributorAddress,
  };
}
