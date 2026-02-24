import { ethers, BigNumberish } from 'ethers';
import { Logger } from '@noderr/utils';

// MEDIUM FIX #33: Use Logger instead of console.log
const logger = new Logger('DeFiAdapterUtils');

// --- Mock Blockchain Setup for Testnet Simulation ---

// In a real scenario, this would be a configured testnet provider.
// For simulation, we use a mock provider to ensure all Ethers.js logic is correctly implemented.
const MOCK_PROVIDER_URL = process.env.TESTNET_RPC_URL || "http://localhost:8545";
const MOCK_PROVIDER = new ethers.JsonRpcProvider(MOCK_PROVIDER_URL);

// A mock signer is needed to simulate transactions.
// This private key is a random, non-funded key for local simulation.
const MOCK_SIGNER_PRIVATE_KEY = "0x1111111111111111111111111111111111111111111111111111111111111111";
const MOCK_SIGNER = new ethers.Wallet(MOCK_SIGNER_PRIVATE_KEY, MOCK_PROVIDER);

/**
 * Utility function to get the mock signer for transaction simulation.
 * @returns The Ethers.js Wallet object configured for the mock testnet.
 */
export function getMockSigner(): ethers.Wallet {
    return MOCK_SIGNER;
}

/**
 * Utility function to simulate an on-chain transaction.
 * This is crucial for the testnet to correctly track gas usage and transaction flow.
 * @param adapterName The name of the adapter performing the transaction.
 * @param functionName The name of the contract function being called.
 * @returns A mock transaction hash.
 */
export async function simulateTransaction(adapterName: string, functionName: string): Promise<string> {
    // Simulate network latency
    await new Promise(resolve => setTimeout(resolve, 100));

    // Generate a mock transaction hash based on the input
    const mockTxData = `${adapterName}:${functionName}:${Date.now()}`;
    const mockTxHash = ethers.keccak256(ethers.toUtf8Bytes(mockTxData));

    // MEDIUM FIX #33: Use Logger instead of console.log
    logger.debug(`Simulated transaction for ${functionName}`, { adapterName, txHash: mockTxHash });
    return mockTxHash;
}

/**
 * Utility function to handle BigNumber conversion for consistent institutional-grade math.
 * @param value The value to convert.
 * @returns The value as a BigInt.
 */
export function toBigInt(value: BigNumberish): bigint {
    return BigInt(value.toString());
}
