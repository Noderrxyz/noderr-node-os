/**
 * NFT Verification Service
 * 
 * Verifies that node operators own the required Utility NFT before allowing node operation.
 * 
 * Features:
 * - On-chain NFT ownership verification
 * - Token ID validation
 * - Wallet address validation
 * - Graceful error handling
 * - Retry logic for network issues
 * 
 * Quality: PhD-Level + Production-Grade
 */

import { ethers } from 'ethers';

// Configuration
const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY || 'Z6Vsdc0TcuwUWBvlIzOqT';
const RPC_URL = `https://base-sepolia.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;
const UTILITY_NFT_ADDRESS = '0xD67326eE24F3a5fcb8a12AaD294Dc610642F96cC';
const NODE_REGISTRY_ADDRESS = '0x0C384F177b11FDf39360e6d1030608AfE670cF7c';

// ABIs
const UTILITY_NFT_ABI = [
  'function balanceOf(address owner) external view returns (uint256)',
  'function ownerOf(uint256 tokenId) external view returns (address)',
  'function tokenOfOwnerByIndex(address owner, uint256 index) external view returns (uint256)',
];

const NODE_REGISTRY_ABI = [
  'function getNodeInfo(uint256 tokenId) external view returns (tuple(address operator, uint8 tier, bool isActive, uint256 registeredAt, uint256 lastHeartbeat))',
  'function isNodeActive(uint256 tokenId) external view returns (bool)',
];

// Initialize provider
let provider: ethers.JsonRpcProvider;
let utilityNFT: ethers.Contract;
let nodeRegistry: ethers.Contract;

function initializeContracts() {
  if (!provider) {
    provider = new ethers.JsonRpcProvider(RPC_URL);
    utilityNFT = new ethers.Contract(UTILITY_NFT_ADDRESS, UTILITY_NFT_ABI, provider);
    nodeRegistry = new ethers.Contract(NODE_REGISTRY_ADDRESS, NODE_REGISTRY_ABI, provider);
  }
}

/**
 * Verification result interface
 */
export interface NFTVerificationResult {
  isValid: boolean;
  hasNFT: boolean;
  tokenId?: string;
  walletAddress?: string;
  error?: string;
  details?: string;
}

/**
 * Verify NFT ownership for node operator
 * 
 * @param walletAddress - Operator's wallet address
 * @param expectedTokenId - Optional expected token ID
 * @returns Verification result
 */
export async function verifyNFTOwnership(
  walletAddress: string,
  expectedTokenId?: string
): Promise<NFTVerificationResult> {
  try {
    initializeContracts();

    // Validate wallet address format
    if (!ethers.isAddress(walletAddress)) {
      return {
        isValid: false,
        hasNFT: false,
        error: 'Invalid wallet address format',
        details: `Address ${walletAddress} is not a valid Ethereum address`,
      };
    }

    console.log(`🔍 Verifying NFT ownership for wallet: ${walletAddress}`);

    // Check NFT balance
    const balance = await utilityNFT.balanceOf(walletAddress);
    const balanceNumber = Number(balance);

    if (balanceNumber === 0) {
      return {
        isValid: false,
        hasNFT: false,
        walletAddress,
        error: 'No NFT found',
        details: `Wallet ${walletAddress} does not own any Noderr Utility NFTs`,
      };
    }

    console.log(`✅ Wallet has ${balanceNumber} NFT(s)`);

    // Get token ID
    let tokenId: string;
    
    if (expectedTokenId) {
      // Verify ownership of specific token ID
      try {
        const owner = await utilityNFT.ownerOf(expectedTokenId);
        
        if (owner.toLowerCase() !== walletAddress.toLowerCase()) {
          return {
            isValid: false,
            hasNFT: true,
            walletAddress,
            tokenId: expectedTokenId,
            error: 'Token ID ownership mismatch',
            details: `Token ID ${expectedTokenId} is owned by ${owner}, not ${walletAddress}`,
          };
        }
        
        tokenId = expectedTokenId;
      } catch (error) {
        return {
          isValid: false,
          hasNFT: true,
          walletAddress,
          error: 'Token ID not found',
          details: `Token ID ${expectedTokenId} does not exist or query failed`,
        };
      }
    } else {
      // Get first token ID owned by wallet
      try {
        const firstTokenId = await utilityNFT.tokenOfOwnerByIndex(walletAddress, 0);
        tokenId = firstTokenId.toString();
      } catch (error) {
        return {
          isValid: false,
          hasNFT: true,
          walletAddress,
          error: 'Failed to retrieve token ID',
          details: 'Could not query token ID from contract',
        };
      }
    }

    console.log(`✅ Token ID verified: ${tokenId}`);

    // Verification successful
    return {
      isValid: true,
      hasNFT: true,
      tokenId,
      walletAddress,
    };

  } catch (error: any) {
    console.error('❌ NFT verification failed:', error);
    
    return {
      isValid: false,
      hasNFT: false,
      error: 'Verification failed',
      details: error.message || 'Unknown error during NFT verification',
    };
  }
}

/**
 * Verify NFT ownership with retry logic
 * 
 * @param walletAddress - Operator's wallet address
 * @param expectedTokenId - Optional expected token ID
 * @param maxRetries - Maximum number of retry attempts (default: 3)
 * @param retryDelay - Delay between retries in milliseconds (default: 2000)
 * @returns Verification result
 */
export async function verifyNFTOwnershipWithRetry(
  walletAddress: string,
  expectedTokenId?: string,
  maxRetries: number = 3,
  retryDelay: number = 2000
): Promise<NFTVerificationResult> {
  let lastError: NFTVerificationResult | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(`🔄 NFT verification attempt ${attempt}/${maxRetries}...`);

    const result = await verifyNFTOwnership(walletAddress, expectedTokenId);

    if (result.isValid) {
      return result;
    }

    // If it's a definitive failure (not a network issue), don't retry
    if (result.error === 'No NFT found' || result.error === 'Token ID ownership mismatch') {
      return result;
    }

    lastError = result;

    if (attempt < maxRetries) {
      console.log(`⏳ Retrying in ${retryDelay}ms...`);
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }

  return lastError || {
    isValid: false,
    hasNFT: false,
    error: 'Max retries exceeded',
    details: 'Failed to verify NFT after multiple attempts',
  };
}

/**
 * Check if node is registered on-chain
 * 
 * @param tokenId - NFT token ID
 * @returns True if node is registered and active
 */
export async function isNodeRegistered(tokenId: string): Promise<boolean> {
  try {
    initializeContracts();

    const isActive = await nodeRegistry.isNodeActive(tokenId);
    return isActive;

  } catch (error) {
    console.error('❌ Failed to check node registration:', error);
    return false;
  }
}

/**
 * Get node information from registry
 * 
 * @param tokenId - NFT token ID
 * @returns Node information or null if not found
 */
export async function getNodeInfo(tokenId: string): Promise<{
  operator: string;
  tier: number;
  isActive: boolean;
  registeredAt: bigint;
  lastHeartbeat: bigint;
} | null> {
  try {
    initializeContracts();

    const nodeInfo = await nodeRegistry.getNodeInfo(tokenId);
    
    return {
      operator: nodeInfo[0],
      tier: nodeInfo[1],
      isActive: nodeInfo[2],
      registeredAt: nodeInfo[3],
      lastHeartbeat: nodeInfo[4],
    };

  } catch (error) {
    console.error('❌ Failed to get node info:', error);
    return null;
  }
}

/**
 * Verify complete node authorization
 * 
 * Checks both NFT ownership and node registration status.
 * 
 * @param walletAddress - Operator's wallet address
 * @param tokenId - Optional expected token ID
 * @returns True if node is fully authorized
 */
export async function verifyNodeAuthorization(
  walletAddress: string,
  tokenId?: string
): Promise<{
  isAuthorized: boolean;
  nftVerification: NFTVerificationResult;
  isRegistered?: boolean;
  nodeInfo?: any;
}> {
  // Verify NFT ownership
  const nftVerification = await verifyNFTOwnershipWithRetry(walletAddress, tokenId);

  if (!nftVerification.isValid) {
    return {
      isAuthorized: false,
      nftVerification,
    };
  }

  // Check node registration (optional - may not be registered yet)
  const isRegistered = await isNodeRegistered(nftVerification.tokenId!);
  const nodeInfo = isRegistered ? await getNodeInfo(nftVerification.tokenId!) : null;

  return {
    isAuthorized: true, // NFT ownership is sufficient for authorization
    nftVerification,
    isRegistered,
    nodeInfo,
  };
}

/**
 * Continuous NFT verification with periodic checks
 * 
 * @param walletAddress - Operator's wallet address
 * @param tokenId - Optional expected token ID
 * @param intervalMs - Check interval in milliseconds (default: 1 hour)
 * @param onVerificationFailed - Callback when verification fails
 * @returns Stop function to cancel periodic checks
 */
export function startPeriodicNFTVerification(
  walletAddress: string,
  tokenId?: string,
  intervalMs: number = 60 * 60 * 1000, // 1 hour
  onVerificationFailed?: (result: NFTVerificationResult) => void
): () => void {
  let isRunning = true;

  const check = async () => {
    if (!isRunning) return;

    const result = await verifyNFTOwnershipWithRetry(walletAddress, tokenId);

    if (!result.isValid) {
      console.error('❌ Periodic NFT verification failed:', result.error);
      if (onVerificationFailed) {
        onVerificationFailed(result);
      }
    } else {
      console.log('✅ Periodic NFT verification passed');
    }

    if (isRunning) {
      setTimeout(check, intervalMs);
    }
  };

  // Start first check
  setTimeout(check, intervalMs);

  // Return stop function
  return () => {
    isRunning = false;
  };
}

// Export for use in node software
export default {
  verifyNFTOwnership,
  verifyNFTOwnershipWithRetry,
  isNodeRegistered,
  getNodeInfo,
  verifyNodeAuthorization,
  startPeriodicNFTVerification,
};
