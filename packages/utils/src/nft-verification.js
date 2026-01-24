"use strict";
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
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyNFTOwnership = verifyNFTOwnership;
exports.verifyNFTOwnershipWithRetry = verifyNFTOwnershipWithRetry;
exports.isNodeRegistered = isNodeRegistered;
exports.getNodeInfo = getNodeInfo;
exports.verifyNodeAuthorization = verifyNodeAuthorization;
exports.startPeriodicNFTVerification = startPeriodicNFTVerification;
const src_1 = require("@noderr/utils/src");
const ethers_1 = require("ethers");
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
// NOTE: NodeRegistry functions are not yet implemented in the current contract version
// Node authorization is based solely on NFT ownership for now
// // import { NODE_REGISTRY_ABI } from "./NodeRegistry";
// Initialize provider
let provider;
let utilityNFT;
let nodeRegistry;
const logger = new src_1.Logger('nft-verification');
function initializeContracts() {
    if (!provider) {
        provider = new ethers_1.ethers.JsonRpcProvider(RPC_URL);
        utilityNFT = new ethers_1.ethers.Contract(UTILITY_NFT_ADDRESS, UTILITY_NFT_ABI, provider);
        // // nodeRegistry = new ethers.Contract(NODE_REGISTRY_ADDRESS, [], provider);
    }
}
/**
 * Verify NFT ownership for node operator
 *
 * @param walletAddress - Operator's wallet address
 * @param expectedTokenId - Optional expected token ID
 * @returns Verification result
 */
async function verifyNFTOwnership(walletAddress, expectedTokenId) {
    try {
        initializeContracts();
        // Validate wallet address format
        if (!ethers_1.ethers.isAddress(walletAddress)) {
            return {
                isValid: false,
                hasNFT: false,
                error: 'Invalid wallet address format',
                details: `Address ${walletAddress} is not a valid Ethereum address`,
            };
        }
        logger.info(`🔍 Verifying NFT ownership for wallet: ${walletAddress}`);
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
        logger.info(`✅ Wallet has ${balanceNumber} NFT(s)`);
        // Get token ID
        let tokenId;
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
            }
            catch (error) {
                return {
                    isValid: false,
                    hasNFT: true,
                    walletAddress,
                    error: 'Token ID not found',
                    details: `Token ID ${expectedTokenId} does not exist or query failed`,
                };
            }
        }
        else {
            // Get first token ID owned by wallet
            try {
                const firstTokenId = await utilityNFT.tokenOfOwnerByIndex(walletAddress, 0);
                tokenId = firstTokenId.toString();
            }
            catch (error) {
                return {
                    isValid: false,
                    hasNFT: true,
                    walletAddress,
                    error: 'Failed to retrieve token ID',
                    details: 'Could not query token ID from contract',
                };
            }
        }
        logger.info(`✅ Token ID verified: ${tokenId}`);
        // Verification successful
        return {
            isValid: true,
            hasNFT: true,
            tokenId,
            walletAddress,
        };
    }
    catch (error) {
        logger.error('❌ NFT verification failed:', error);
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
async function verifyNFTOwnershipWithRetry(walletAddress, expectedTokenId, maxRetries = 3, retryDelay = 2000) {
    let lastError = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        logger.info(`🔄 NFT verification attempt ${attempt}/${maxRetries}...`);
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
            logger.info(`⏳ Retrying in ${retryDelay}ms...`);
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
 * NOTE: Node registration is not yet implemented in the current contract version.
 * This function always returns false for now.
 *
 * @param tokenId - NFT token ID
 * @returns True if node is registered and active
 */
async function isNodeRegistered(tokenId) {
    // Node registration feature is not yet implemented
    // For now, NFT ownership is sufficient for node authorization
    logger.info(`ℹ️ Node registration check skipped (not yet implemented)`);
    return false;
}
/**
 * Get node information from registry
 *
 * NOTE: Node registration is not yet implemented in the current contract version.
 * This function always returns null for now.
 *
 * @param tokenId - NFT token ID
 * @returns Node information or null if not found
 */
async function getNodeInfo(tokenId) {
    // Node registration feature is not yet implemented
    logger.info(`ℹ️ Node info query skipped (not yet implemented)`);
    return null;
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
async function verifyNodeAuthorization(walletAddress, tokenId) {
    // Verify NFT ownership
    const nftVerification = await verifyNFTOwnershipWithRetry(walletAddress, tokenId);
    if (!nftVerification.isValid) {
        return {
            isAuthorized: false,
            nftVerification,
        };
    }
    // Check node registration (optional - may not be registered yet)
    const isRegistered = await isNodeRegistered(nftVerification.tokenId);
    const nodeInfo = isRegistered ? await getNodeInfo(nftVerification.tokenId) : null;
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
function startPeriodicNFTVerification(walletAddress, tokenId, intervalMs = 60 * 60 * 1000, // 1 hour
onVerificationFailed) {
    let isRunning = true;
    const check = async () => {
        if (!isRunning)
            return;
        const result = await verifyNFTOwnershipWithRetry(walletAddress, tokenId);
        if (!result.isValid) {
            logger.error('❌ Periodic NFT verification failed:', result.error);
            if (onVerificationFailed) {
                onVerificationFailed(result);
            }
        }
        else {
            logger.info('✅ Periodic NFT verification passed');
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
exports.default = {
    verifyNFTOwnership,
    verifyNFTOwnershipWithRetry,
    isNodeRegistered,
    getNodeInfo,
    verifyNodeAuthorization,
    startPeriodicNFTVerification,
};
//# sourceMappingURL=nft-verification.js.map