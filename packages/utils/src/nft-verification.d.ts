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
export declare function verifyNFTOwnership(walletAddress: string, expectedTokenId?: string): Promise<NFTVerificationResult>;
/**
 * Verify NFT ownership with retry logic
 *
 * @param walletAddress - Operator's wallet address
 * @param expectedTokenId - Optional expected token ID
 * @param maxRetries - Maximum number of retry attempts (default: 3)
 * @param retryDelay - Delay between retries in milliseconds (default: 2000)
 * @returns Verification result
 */
export declare function verifyNFTOwnershipWithRetry(walletAddress: string, expectedTokenId?: string, maxRetries?: number, retryDelay?: number): Promise<NFTVerificationResult>;
/**
 * Check if node is registered on-chain
 *
 * NOTE: Node registration is not yet implemented in the current contract version.
 * This function always returns false for now.
 *
 * @param tokenId - NFT token ID
 * @returns True if node is registered and active
 */
export declare function isNodeRegistered(tokenId: string): Promise<boolean>;
/**
 * Get node information from registry
 *
 * NOTE: Node registration is not yet implemented in the current contract version.
 * This function always returns null for now.
 *
 * @param tokenId - NFT token ID
 * @returns Node information or null if not found
 */
export declare function getNodeInfo(tokenId: string): Promise<{
    operator: string;
    tier: number;
    isActive: boolean;
    registeredAt: bigint;
    lastHeartbeat: bigint;
} | null>;
/**
 * Verify complete node authorization
 *
 * Checks both NFT ownership and node registration status.
 *
 * @param walletAddress - Operator's wallet address
 * @param tokenId - Optional expected token ID
 * @returns True if node is fully authorized
 */
export declare function verifyNodeAuthorization(walletAddress: string, tokenId?: string): Promise<{
    isAuthorized: boolean;
    nftVerification: NFTVerificationResult;
    isRegistered?: boolean;
    nodeInfo?: any;
}>;
/**
 * Continuous NFT verification with periodic checks
 *
 * @param walletAddress - Operator's wallet address
 * @param tokenId - Optional expected token ID
 * @param intervalMs - Check interval in milliseconds (default: 1 hour)
 * @param onVerificationFailed - Callback when verification fails
 * @returns Stop function to cancel periodic checks
 */
export declare function startPeriodicNFTVerification(walletAddress: string, tokenId?: string, intervalMs?: number, // 1 hour
onVerificationFailed?: (result: NFTVerificationResult) => void): () => void;
declare const _default: {
    verifyNFTOwnership: typeof verifyNFTOwnership;
    verifyNFTOwnershipWithRetry: typeof verifyNFTOwnershipWithRetry;
    isNodeRegistered: typeof isNodeRegistered;
    getNodeInfo: typeof getNodeInfo;
    verifyNodeAuthorization: typeof verifyNodeAuthorization;
    startPeriodicNFTVerification: typeof startPeriodicNFTVerification;
};
export default _default;
//# sourceMappingURL=nft-verification.d.ts.map