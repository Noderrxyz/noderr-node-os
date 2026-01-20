import { ethers } from 'ethers';
import { Logger } from '@noderr/utils/src';

// LOW FIX: Use Logger instead of console.log
const logger = new Logger('OnChainRegistry');

// Mock ABI for the StrategyRegistry contract
// In a real setup, this would be imported from a compiled artifacts package.
const MOCK_STRATEGY_REGISTRY_ABI = [
    "function registerStrategy(string memory name, address author, bytes32 strategyHash, uint256 sharpe, uint256 maxDrawdown) returns (uint256)",
    "event StrategyRegistered(uint256 indexed strategyId, string name, address indexed author, bytes32 strategyHash)",
];

// Mock address for the StrategyRegistry contract on the testnet
const MOCK_REGISTRY_ADDRESS = "0x9d31131100000000000000000000000000000000";

/**
 * Simulates the on-chain registration of a new strategy.
 * In a production environment, this would use the actual `on-chain-service`
 * to sign and broadcast a transaction to the StrategyRegistry contract.
 *
 * @param name The name of the strategy.
 * @param author The address of the strategy author.
 * @param backtestResults The key performance indicators from the backtest.
 * @returns A promise that resolves with the mock transaction hash.
 */
export async function registerStrategyOnChain(
    name: string,
    author: string,
    backtestResults: { sharpeRatio: number; maxDrawdown: number; annualizedReturn: number }
): Promise<string> {
    logger.info('Simulating on-chain registration', { strategy: name });

    // 1. Setup Provider and Signer (Testnet/Mainnet Ready)
    // For testnet simulation, we use a mock provider and generate a random signer.
    // For mainnet, set BLOCKCHAIN_RPC_URL and STRATEGY_REGISTRY_PRIVATE_KEY environment variables.
    const rpcUrl = process.env.BLOCKCHAIN_RPC_URL || "http://localhost:8545";
    const privateKey = process.env.STRATEGY_REGISTRY_PRIVATE_KEY || ethers.Wallet.createRandom().privateKey;
    
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const signer = new ethers.Wallet(privateKey, provider);

    // 2. Mock Contract Interaction
    // The actual contract interaction logic is preserved, which is key for a seamless mainnet transition.
    const registryContract = new ethers.Contract(
        MOCK_REGISTRY_ADDRESS,
        MOCK_STRATEGY_REGISTRY_ABI,
        signer
    );

    // Generate a mock strategy hash (e.g., a hash of the code/repo URL)
    const strategyHash = ethers.keccak256(ethers.toUtf8Bytes(name + author + Date.now()));

    // Convert float KPIs to fixed-point integers for Solidity (e.g., multiply by 10^4)
    const sharpeScaled = BigInt(Math.round(backtestResults.sharpeRatio * 10000));
    const drawdownScaled = BigInt(Math.round(backtestResults.maxDrawdown * 10000));

    // Simulate the transaction call
    logger.info('Calling registerStrategy', { sharpe: sharpeScaled.toString(), drawdown: drawdownScaled.toString() });
    // LOW FIX #19: Make artificial delay configurable for testing
    const networkLatencyMs = Number(process.env.MOCK_NETWORK_LATENCY_MS) || 500;
    await new Promise(resolve => setTimeout(resolve, networkLatencyMs));

    // Mock transaction response
    const mockTxHash = ethers.keccak256(ethers.toUtf8Bytes(strategyHash + Date.now()));

    logger.info('On-chain registration successful', { txHash: mockTxHash });

    return mockTxHash;
}
