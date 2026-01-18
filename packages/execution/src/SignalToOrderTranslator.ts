import { TradingSignal } from '@noderr/core';
import { OrderRequest } from './SmartExecutionEngine';
import { v4 as uuidv4 } from 'uuid';

/**
 * @class SignalToOrderTranslator
 *
 * This component acts as the bridge between the high-level trading intent
 * from a strategy (TradingSignal) and the low-level, institutional-grade
 * execution requirements of the SmartExecutionEngine (OrderRequest).
 *
 * It enforces business logic and default execution parameters.
 */
export class SignalToOrderTranslator {

    /**
     * Translates a TradingSignal into a formal OrderRequest.
     * @param signal The high-level trading signal from a strategy.
     * @returns A fully formed OrderRequest ready for the SmartExecutionEngine.
     */
    public static translate(signal: TradingSignal): OrderRequest {
        // Institutional-grade execution requires a unique ID for every order
        const orderId = uuidv4();

        // Enforce default parameters for institutional execution
        const defaultTimeInForce = 'GTC'; // Good-Til-Cancelled is the safest default
        const defaultMetadata = {
            strategyId: signal.strategyId,
            // Add any other required audit/compliance metadata here
        };

        // Map order type - SmartExecutionEngine only supports market, limit, iceberg
        // Map stop and stop_limit to market for testnet simulation
        let mappedOrderType: 'market' | 'limit' | 'iceberg' = 'market';
        if (signal.orderType === 'market' || signal.orderType === 'stop' || signal.orderType === 'stop_limit') {
            mappedOrderType = 'market';
        } else if (signal.orderType === 'limit') {
            mappedOrderType = 'limit';
        }

        // Map the TradingSignal to the SmartExecutionEngine's OrderRequest
        const orderRequest: OrderRequest = {
            id: orderId,
            symbol: signal.symbol,
            side: signal.side,
            quantity: signal.quantity,
            orderType: mappedOrderType,
            limitPrice: signal.limitPrice,
            timeInForce: defaultTimeInForce,
            urgency: signal.urgency || 0.5, // Default urgency if not provided
            metadata: {
                ...defaultMetadata,
                ...signal.metadata, // Allow strategy metadata to override/extend
            },
        };

        // Sanity Check: Ensure quantity meets minimum requirements (placeholder logic)
        if (orderRequest.quantity <= 0) {
            throw new Error(`Invalid quantity in signal: ${orderRequest.quantity}`);
        }

        // Sanity Check: Limit order must have a limit price
        if (orderRequest.orderType === 'limit' && !orderRequest.limitPrice) {
            throw new Error(`Limit order signal missing required limitPrice.`);
        }

        return orderRequest;
    }
}
