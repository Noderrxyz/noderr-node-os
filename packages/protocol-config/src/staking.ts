/**
 * Staking Configuration
 * 
 * These values MUST match the on-chain NodeRegistry.sol contract exactly.
 * Source of truth: contracts/contracts/core/NodeRegistry.sol
 * 
 * Oracle: 500,000 NODR (500000 ether)
 * Guardian: 100,000 NODR (100000 ether)
 * Validator: 50,000 NODR (50000 ether)
 */

import { ethers } from 'ethers';

/**
 * Node tier types matching the on-chain UtilityNFT.NodeTier enum
 */
export enum NodeTier {
  MICRO = 0,
  VALIDATOR = 1,
  GUARDIAN = 2,
  ORACLE = 3,
}

/**
 * Staking requirements in wei (18 decimals)
 * These values are synchronized with the on-chain smart contracts
 */
export const STAKING_REQUIREMENTS = {
  [NodeTier.MICRO]: ethers.parseUnits('0', 18), // No stake required for Micro nodes
  [NodeTier.VALIDATOR]: ethers.parseUnits('50000', 18), // 50,000 NODR
  [NodeTier.GUARDIAN]: ethers.parseUnits('100000', 18), // 100,000 NODR
  [NodeTier.ORACLE]: ethers.parseUnits('500000', 18), // 500,000 NODR
} as const;

/**
 * Staking requirements by tier name (for backward compatibility)
 */
export const STAKING_REQUIREMENTS_BY_NAME = {
  micro: STAKING_REQUIREMENTS[NodeTier.MICRO],
  validator: STAKING_REQUIREMENTS[NodeTier.VALIDATOR],
  guardian: STAKING_REQUIREMENTS[NodeTier.GUARDIAN],
  oracle: STAKING_REQUIREMENTS[NodeTier.ORACLE],
} as const;

/**
 * Get staking requirement for a specific tier
 * @param tier - Node tier enum value or string name
 * @returns Required stake in wei
 */
export function getStakingRequirement(tier: NodeTier | keyof typeof STAKING_REQUIREMENTS_BY_NAME): bigint {
  if (typeof tier === 'number') {
    return STAKING_REQUIREMENTS[tier as NodeTier];
  }
  return STAKING_REQUIREMENTS_BY_NAME[tier as keyof typeof STAKING_REQUIREMENTS_BY_NAME];
}

/**
 * Format staking requirement as human-readable NODR amount
 * @param tier - Node tier enum value or string name
 * @returns Formatted stake amount (e.g., "500000 NODR")
 */
export function formatStakingRequirement(tier: NodeTier | keyof typeof STAKING_REQUIREMENTS_BY_NAME): string {
  const requirement = getStakingRequirement(tier);
  return `${ethers.formatUnits(requirement, 18)} NODR`;
}

/**
 * Check if a balance meets the staking requirement for a tier
 * @param balance - Wallet balance in wei
 * @param tier - Node tier enum value or string name
 * @returns True if balance is sufficient
 */
export function hasSufficientStake(balance: bigint, tier: NodeTier | keyof typeof STAKING_REQUIREMENTS_BY_NAME): boolean {
  const requirement = getStakingRequirement(tier);
  return balance >= requirement;
}
