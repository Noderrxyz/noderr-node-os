/**
 * Staking Verification Service
 * 
 * Verifies that a wallet address meets the minimum staking requirements
 * for a specific node tier by checking on-chain NODR token balance.
 * 
 * Uses @noderr/protocol-config for unified staking requirements that match
 * the on-chain NodeRegistry.sol contract exactly.
 */

import { ethers } from 'ethers';
import { getStakingRequirement, formatStakingRequirement, hasSufficientStake } from '@noderr/protocol-config';

const logger = {
  warn: (msg: string, data?: any) => console.warn('⚠️ ', msg, data),
  info: (msg: string, data?: any) => console.log('ℹ️ ', msg, data),
  error: (msg: string, data?: any) => console.error('❌', msg, data)
};

/**
 * Node tier type (string-based for API compatibility)
 */
export type NodeTier = 'micro' | 'validator' | 'guardian' | 'oracle';

/**
 * Staking verification result
 */
export interface StakingVerificationResult {
  isValid: boolean;
  walletAddress: string;
  nodeId: string;
  nodeTier: NodeTier;
  requiredStake: string;
  currentStake: string;
  stakingStatus: 'sufficient' | 'insufficient' | 'error';
  message: string;
  timestamp: Date;
}

/**
 * Verify that wallet has sufficient stake for node tier
 * 
 * @param walletAddress - Ethereum address of node operator
 * @param nodeId - Node ID
 * @param nodeTier - Node tier (micro, validator, guardian, oracle)
 * @param rpcUrl - RPC endpoint URL
 * @param tokenAddress - NODR token contract address
 * @returns Staking verification result
 */
export async function verifyStaking(
  walletAddress: string,
  nodeId: string,
  nodeTier: NodeTier,
  rpcUrl: string,
  tokenAddress: string
): Promise<StakingVerificationResult> {
  const timestamp = new Date();

  logger.info('🔍 Verifying staking requirements...', {
    walletAddress,
    nodeId,
    nodeTier,
  });

  try {
    // Validate inputs
    if (!ethers.isAddress(walletAddress)) {
      logger.error('❌ Invalid wallet address:', walletAddress);
      return {
        isValid: false,
        walletAddress,
        nodeId,
        nodeTier,
        requiredStake: getStakingRequirement(nodeTier).toString(),
        currentStake: '0',
        stakingStatus: 'error',
        message: `Invalid wallet address: ${walletAddress}`,
        timestamp,
      };
    }

    if (!['micro', 'validator', 'guardian', 'oracle'].includes(nodeTier)) {
      logger.error('❌ Invalid node tier:', nodeTier);
      return {
        isValid: false,
        walletAddress,
        nodeId,
        nodeTier,
        requiredStake: '0',
        currentStake: '0',
        stakingStatus: 'error',
        message: `Invalid node tier: ${nodeTier}`,
        timestamp,
      };
    }

    // Get required stake for tier (from unified protocol config)
    const requiredStake = getStakingRequirement(nodeTier);
    logger.info(`📊 Required stake for ${nodeTier}: ${formatStakingRequirement(nodeTier)}`);

    // Initialize provider
    const provider = new ethers.JsonRpcProvider(rpcUrl);

    // Initialize token contract
    const tokenABI = [
      'function balanceOf(address account) external view returns (uint256)',
      'function decimals() external view returns (uint8)',
    ];

    const tokenContract = new ethers.Contract(tokenAddress, tokenABI, provider);

    // Get wallet balance
    const balance: bigint = await tokenContract.balanceOf(walletAddress);
    logger.info(`💰 Wallet balance: ${ethers.formatUnits(balance, 18)} NODR`);

    // Verify sufficient stake using protocol config
    const hasStake = hasSufficientStake(balance, nodeTier);

    if (hasStake) {
      logger.info(`✅ Wallet has sufficient stake for ${nodeTier} node`);
      return {
        isValid: true,
        walletAddress,
        nodeId,
        nodeTier,
        requiredStake: ethers.formatUnits(requiredStake, 18),
        currentStake: ethers.formatUnits(balance, 18),
        stakingStatus: 'sufficient',
        message: `Wallet has sufficient stake (${ethers.formatUnits(balance, 18)} NODR >= ${formatStakingRequirement(nodeTier)})`,
        timestamp,
      };
    } else {
      const shortfall = requiredStake - balance;
      logger.warn(`⚠️ Insufficient stake for ${nodeTier} node`, {
        required: formatStakingRequirement(nodeTier),
        current: ethers.formatUnits(balance, 18),
        shortfall: ethers.formatUnits(shortfall, 18),
      });

      return {
        isValid: false,
        walletAddress,
        nodeId,
        nodeTier,
        requiredStake: ethers.formatUnits(requiredStake, 18),
        currentStake: ethers.formatUnits(balance, 18),
        stakingStatus: 'insufficient',
        message: `Insufficient stake. Required: ${formatStakingRequirement(nodeTier)}, Current: ${ethers.formatUnits(balance, 18)} NODR, Shortfall: ${ethers.formatUnits(shortfall, 18)} NODR.`,
        timestamp,
      };
    }
  } catch (error) {
    logger.error('❌ Staking verification error:', error);
    return {
      isValid: false,
      walletAddress,
      nodeId,
      nodeTier,
      requiredStake: getStakingRequirement(nodeTier).toString(),
      currentStake: '0',
      stakingStatus: 'error',
      message: `Staking verification error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      timestamp,
    };
  }
}

/**
 * Get all staking requirements (formatted for display)
 * 
 * @returns Object with staking requirements for all tiers
 */
export function getAllStakingRequirements(): Record<NodeTier, string> {
  return {
    micro: formatStakingRequirement('micro'),
    validator: formatStakingRequirement('validator'),
    guardian: formatStakingRequirement('guardian'),
    oracle: formatStakingRequirement('oracle'),
  };
}
