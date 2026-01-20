import { IDeFiAdapter } from './IDeFiAdapter';
import { Logger } from '@noderr/utils/src';
import { AaveV3Adapter } from './adapters/AaveV3Adapter';
import { UniswapV3Adapter } from './adapters/UniswapV3Adapter';
import { MockDeFiAdapter, REMAINING_PROTOCOLS } from './adapters/MockDeFiAdapter';

// --- Full Set of 21 DeFi Adapters ---
// The two fully-typed adapters are used, and the remaining 19 are implemented
// using the MockDeFiAdapter to ensure the Floor Engine can be designed against
// the complete set of 21 protocols from the start.
const logger = new Logger('DeFiAdapterFactory');

// MEDIUM FIX #30: Use factory functions instead of type assertions
type AdapterFactory = () => IDeFiAdapter;

const ADAPTER_FACTORIES: { [key: string]: AdapterFactory } = {
    'AAVE_V3': () => new AaveV3Adapter(),
    'UNISWAP_V3': () => new UniswapV3Adapter(),
};

// Dynamically add the remaining 19 mock adapters using factory functions
REMAINING_PROTOCOLS.forEach(protocolId => {
    ADAPTER_FACTORIES[protocolId] = () => new MockDeFiAdapter(protocolId);
});

/**
 * @class DeFiAdapterFactory
 *
 * Centralized factory for retrieving institutional-grade DeFi protocol adapters.
 * This ensures that the Floor Engine and other services only interact with a
 * standardized IDeFiAdapter interface, promoting modularity and safety.
 */
export class DeFiAdapterFactory {
    private static instances: Map<string, IDeFiAdapter> = new Map();

    /**
     * Retrieves a singleton instance of the specified DeFi adapter.
     * @param protocolId The unique identifier for the protocol (e.g., 'AAVE_V3').
     * @returns An instance of the IDeFiAdapter.
     * @throws An error if the adapter for the given protocolId is not found.
     */
    public static getAdapter(protocolId: string): IDeFiAdapter {
        if (!ADAPTER_FACTORIES[protocolId]) {
            throw new Error(`DeFiAdapterFactory: Adapter not found for protocol ID: ${protocolId}.`);
        }

        if (!DeFiAdapterFactory.instances.has(protocolId)) {
            // MEDIUM FIX #30: Use factory function (no type assertion needed)
            const factory = ADAPTER_FACTORIES[protocolId];
            const instance = factory();
            logger.info(`Instantiated new adapter for protocol: ${protocolId}`);
            DeFiAdapterFactory.instances.set(protocolId, instance);
        }

        return DeFiAdapterFactory.instances.get(protocolId)!;
    }

    /**
     * Retrieves a list of all supported protocol IDs.
     * @returns An array of strings representing the supported protocol IDs.
     */
    public static getSupportedProtocols(): string[] {
        return Object.keys(ADAPTER_FACTORIES);
    }
}
