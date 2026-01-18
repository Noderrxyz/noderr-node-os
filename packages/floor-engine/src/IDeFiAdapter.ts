import { BigNumberish } from 'ethers';

/**
 * @interface IDeFiAdapter
 *
 * Standard interface for all DeFi protocol adapters.
 * This ensures consistent interaction patterns across all 21+ protocols
 * integrated into the Floor Engine.
 */
export interface IDeFiAdapter {
    /**
     * Unique identifier for the protocol (e.g., 'AAVE_V3', 'UNISWAP_V3')
     */
    readonly protocolId: string;

    /**
     * Primary contract address for the protocol
     */
    readonly contractAddress: string;

    /**
     * Deposit tokens into the protocol
     * @param tokenAddress Address of the token to deposit
     * @param amount Amount to deposit
     * @param userAddress Address of the user making the deposit
     * @returns Transaction hash
     */
    deposit(tokenAddress: string, amount: BigNumberish, userAddress: string): Promise<string>;

    /**
     * Withdraw tokens from the protocol
     * @param tokenAddress Address of the token to withdraw
     * @param amount Amount to withdraw
     * @param userAddress Address of the user making the withdrawal
     * @returns Transaction hash
     */
    withdraw(tokenAddress: string, amount: BigNumberish, userAddress: string): Promise<string>;

    /**
     * Get the current Annual Percentage Yield for a token
     * @param tokenAddress Address of the token
     * @returns APY as a decimal (e.g., 0.05 for 5%)
     */
    getApy(tokenAddress: string): Promise<number>;

    /**
     * Get the total reserves/liquidity for a token in the protocol
     * @param tokenAddress Address of the token
     * @returns Total reserves
     */
    getReserves(tokenAddress: string): Promise<BigNumberish>;

    /**
     * Swap tokens (for DEX protocols only)
     * Optional - only implemented by DEX adapters
     * @param fromToken Address of the input token
     * @param toToken Address of the output token
     * @param amountIn Amount of input token
     * @param minAmountOut Minimum acceptable output amount
     * @param userAddress Address of the user making the swap
     * @returns Transaction hash
     */
    swap?(fromToken: string, toToken: string, amountIn: BigNumberish, minAmountOut: BigNumberish, userAddress: string): Promise<string>;
}
