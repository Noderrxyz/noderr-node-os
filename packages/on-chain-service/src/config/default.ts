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
  stakingManagerAddress: '0x382343dCCe23017e9b14DC68AD066250E07b2994',
  rewardDistributorAddress: '0x6A143A66652140C04079716EceF8d5A353aeC49B',
  governanceManagerAddress: '0x83f8254C25aEa57217CD1A6Aa03DFa06d6816156',
  nodeRegistryAddress: '0x0C384F177b11FDf39360e6d1030608AfE670cF7c',
  guardianWorkloadManagerAddress: '0x8a55C0ab60FAD4ef913c6dfddB403a454B0818c0',
  rewardCalculatorAddress: '0xD815fe075539e6f97861E6aF1CE2706d640A8fCe', // ✅ Deployed Jan 20, 2026
  penaltyManagerAddress: '0x64E91FBDFE38Fe2e0865FFBBEB2d2Ad88eEB7Dd8', // ✅ Deployed Jan 20, 2026
  
  // Legacy aliases (for backward compatibility)
  treasuryManagerAddress: '0x257db11bf3EEDB4E832D821742eBF09338C4CD42', // TreasuryManager
  merkleRewardDistributorAddress: '0xCcDB471823C4F14Ffa4814641eafDa63fb526834', // MerkleRewardDistributor
  
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
    rewardCalculatorAddress: process.env.REWARD_CALCULATOR_ADDRESS || DEFAULT_CONFIG.rewardCalculatorAddress,
    penaltyManagerAddress: process.env.PENALTY_MANAGER_ADDRESS || DEFAULT_CONFIG.penaltyManagerAddress,
    
    // Legacy aliases
    treasuryManagerAddress: process.env.TREASURY_MANAGER_ADDRESS || DEFAULT_CONFIG.treasuryManagerAddress,
    merkleRewardDistributorAddress: process.env.MERKLE_REWARD_DISTRIBUTOR_ADDRESS || DEFAULT_CONFIG.merkleRewardDistributorAddress,
  };
}
