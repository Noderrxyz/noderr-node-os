import { IDeFiAdapter } from '../IDeFiAdapter';
import { BigNumberish, ethers } from 'ethers';
import { simulateTransaction, toBigInt, getMockSigner } from '../DeFiAdapterUtils';
import { Logger } from '@noderr/utils';

// MEDIUM FIX #38: Use Logger instead of console
const logger = new Logger('UniswapV3Adapter');

// Mock Uniswap V3 Router ABI (simplified for swap)
const MOCK_UNISWAP_ROUTER_ABI = [
    "function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut)",
];

// Mock Uniswap V3 Router Address
const MOCK_ROUTER_ADDRESS = "0xE592427A0AEce92De3Edee1F18F015785Cc55d65";

/**
 * @class UniswapV3Adapter
 * @implements IDeFiAdapter
 *
 * Institutional-grade adapter for interacting with the Uniswap V3 DEX protocol.
 * This adapter focuses on the `swap` functionality.
 * All interactions are simulated for the testnet environment.
 */
export class UniswapV3Adapter implements IDeFiAdapter {
    public readonly protocolId = 'UNISWAP_V3';
    public readonly contractAddress = MOCK_ROUTER_ADDRESS;
    private routerContract: ethers.Contract;

    constructor() {
        const signer = getMockSigner();
        this.routerContract = new ethers.Contract(this.contractAddress, MOCK_UNISWAP_ROUTER_ABI, signer);
    }

    // Deposit and Withdraw are not applicable for a DEX in the same way as a lending protocol.
    // We implement them as stubs to satisfy the IDeFiAdapter interface, which is designed
    // to be a superset of all required DeFi actions (Lending, Swapping, Staking).

    public async deposit(tokenAddress: string, amount: BigNumberish, userAddress: string): Promise<string> {
        // MEDIUM FIX #39: Throw error for unsupported operations instead of misleading no-op
        logger.error('Deposit operation not supported on Uniswap V3 (DEX)', { tokenAddress, amount, userAddress });
        throw new Error('Deposit operation not supported on Uniswap V3. Use swap() instead.');
    }

    public async withdraw(tokenAddress: string, amount: BigNumberish, userAddress: string): Promise<string> {
        // MEDIUM FIX #39: Throw error for unsupported operations instead of misleading no-op
        logger.error('Withdraw operation not supported on Uniswap V3 (DEX)', { tokenAddress, amount, userAddress });
        throw new Error('Withdraw operation not supported on Uniswap V3. Use swap() instead.');
    }

    public async getApy(tokenAddress: string): Promise<number> {
        // APY for a DEX is complex (LP fees). We return a mock value.
        // MEDIUM FIX #35 (similar): Make deterministic
        const addressHash = parseInt(tokenAddress.slice(-8), 16);
        const deterministicVariation = (addressHash % 500) / 100000; // 0 to 0.005
        const mockApy = 0.005 + deterministicVariation;
        return mockApy;
    }

    public async getReserves(tokenAddress: string): Promise<BigNumberish> {
        // Reserves are pool-specific. Return a large mock value.
        return BigInt('500000000000000000000000'); // 500k units
    }

    /**
     * Simulates an exact input swap on Uniswap V3.
     */
    public async swap(fromToken: string, toToken: string, amountIn: BigNumberish, minAmountOut: BigNumberish, userAddress: string): Promise<string> {
        const amountInBigInt = toBigInt(amountIn);
        const minAmountOutBigInt = toBigInt(minAmountOut);
        // MEDIUM FIX #38: Use Logger instead of console
        logger.info('Simulating swap', { amountIn: amountInBigInt.toString(), fromToken, toToken, userAddress });

        // The actual Ethers.js call would involve constructing the complex `params` tuple
        // and calling the router contract.

        return simulateTransaction(this.protocolId, 'swap');
    }
}
