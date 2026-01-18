import { IDeFiAdapter } from '../IDeFiAdapter';
import { BigNumberish } from 'ethers';
import { simulateTransaction } from '../DeFiAdapterUtils';
import { Logger } from '@noderr/utils/src';

// MEDIUM FIX #41: Use Logger instead of console.log
const logger = new Logger('MockDeFiAdapter');

/**
 * @class MockDeFiAdapter
 * @implements IDeFiAdapter
 *
 * A generic mock adapter to represent the remaining 19 DeFi protocols.
 * This ensures the `DeFiAdapterFactory` can be fully populated to reflect the
 * 21 identified adapters, allowing the Floor Engine to be designed against the
 * complete set from the start.
 */
export class MockDeFiAdapter implements IDeFiAdapter {
    public readonly protocolId: string;
    public readonly contractAddress: string;

    constructor(protocolId: string) {
        this.protocolId = protocolId;
        // Generate a mock address based on the protocol ID
        this.contractAddress = `0x${protocolId.padEnd(40, '0').slice(0, 40)}`;
    }

    public async deposit(tokenAddress: string, amount: BigNumberish, userAddress: string): Promise<string> {
        // MEDIUM FIX #41: Use Logger instead of console.log
        logger.debug('Simulating deposit', { protocolId: this.protocolId, tokenAddress, amount: amount.toString(), userAddress });
        return simulateTransaction(this.protocolId, 'deposit');
    }

    public async withdraw(tokenAddress: string, amount: BigNumberish, userAddress: string): Promise<string> {
        // MEDIUM FIX #41: Use Logger instead of console.log
        logger.debug('Simulating withdraw', { protocolId: this.protocolId, tokenAddress, amount: amount.toString(), userAddress });
        return simulateTransaction(this.protocolId, 'withdraw');
    }

    public async getApy(tokenAddress: string): Promise<number> {
        // LOW FIX #42: Use deterministic APY based on token address hash
        const hash = tokenAddress.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        const normalized = (hash % 900) / 10000; // 0-0.09 range
        return 0.01 + normalized;
    }

    public async getReserves(tokenAddress: string): Promise<BigNumberish> {
        // LOW FIX #42: Use deterministic reserves based on token address hash
        const hash = tokenAddress.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        const amount = BigInt(hash) * BigInt(1000000000000000000000); // Scale by 10^21
        return amount;
    }

    public async swap(fromToken: string, toToken: string, amountIn: BigNumberish, minAmountOut: BigNumberish, userAddress: string): Promise<string> {
        // MEDIUM FIX #41: Use Logger instead of console.log
        logger.debug('Simulating swap', { protocolId: this.protocolId, fromToken, toToken, amountIn: amountIn.toString(), minAmountOut: minAmountOut.toString(), userAddress });
        return simulateTransaction(this.protocolId, 'swap');
    }
}

// List of the remaining 19 protocols based on the initial analysis
export const REMAINING_PROTOCOLS = [
    'COMPOUND_V3', 'CURVE_V2', 'LIDO_STETH', 'MAKER_DAO', 'SUSHISWAP',
    'BALANCER_V2', 'YEARN_FINANCE', 'ALCHEMIX', 'CONVEX_FINANCE', 'FRAX_FINANCE',
    'SYNTHETIX', 'DYDX', 'GMX', 'VELODROME', 'AURA_FINANCE',
    'ROCKET_POOL', 'MORPHO', 'PENDLE', 'PRISMA_FINANCE'
];
