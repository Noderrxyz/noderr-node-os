import { Logger } from '@noderr/utils';
import { eventBus, EventTopics } from '@noderr/core';
import { TradingSignal } from '@noderr/core';
import { v4 as uuidv4 } from 'uuid';

/**
 * @class MockStrategy
 *
 * A placeholder for a real trading strategy. Its purpose is to simulate the
 * core function of a strategy: consuming market data and emitting a signal.
 *
 * This will be used to complete the end-to-end wiring in the testnet.
 */
export class MockStrategy {
    private logger: Logger;
    // LOW FIX #27: Removed unused intervalId property
    public readonly strategyId: string;
    private readonly symbol: string;
    // MEDIUM FIX #25: Store bound handler reference for proper cleanup
    private boundHandleMarketData: ((event: any) => void) | null = null;

    constructor(name: string, symbol: string = 'BTC/USDT') {
        this.strategyId = name.toLowerCase().replace(/[^a-z0-9]/g, '_');
        this.symbol = symbol; // MEDIUM FIX #26: Make symbol configurable
        this.logger = new Logger(`Strategy:${name}`);
    }

    /**
     * Simulates consuming market data and generating a signal.
     * This method is subscribed to the MARKET_DATA_CANDLE topic.
     */
    private handleMarketData(event: any): void {
        // In a real strategy, this is where the alpha logic lives.
        // For testing, we generate a signal for every candle.
        // (In production, this would be based on actual alpha logic)

        const side: 'buy' | 'sell' = Math.random() > 0.5 ? 'buy' : 'sell';
        const quantity = Math.floor(Math.random() * 100) + 10; // 10 to 110 units
        const urgency = Math.random(); // 0.0 to 1.0

        const signal: TradingSignal = {
            strategyId: this.strategyId,
            symbol: this.symbol, // MEDIUM FIX #26: Use configurable symbol
            side: side,
            quantity: quantity,
            orderType: 'market',
            urgency: urgency,
            timestamp: Date.now(),
            metadata: {
                source: 'MockStrategy',
                reason: 'Simulated alpha signal',
            }
        };

        this.logger.info(`Generated ${side} signal for ${quantity} BTC/USDT. Urgency: ${urgency.toFixed(2)}`);

        // Publish the signal to the event bus
        eventBus.publish(EventTopics.STRATEGY_SIGNAL, signal, this.strategyId);
    }

    /**
     * Starts the strategy by subscribing to market data.
     */
    public async start(): Promise<void> {
        this.logger.info('Subscribing to market data...');
        // MEDIUM FIX #25: Store bound handler for proper cleanup
        this.boundHandleMarketData = this.handleMarketData.bind(this);
        eventBus.subscribe(EventTopics.MARKET_DATA_CANDLE, this.boundHandleMarketData, this.strategyId);
        this.logger.info('Mock strategy started and listening for market data.');
    }

    /**
     * Stops the strategy.
     */
    public async stop(): Promise<void> {
        this.logger.info('Stopping mock strategy...');
        // MEDIUM FIX #25: Properly unsubscribe using stored handler reference
        if (this.boundHandleMarketData) {
            eventBus.unsubscribe(EventTopics.MARKET_DATA_CANDLE, this.boundHandleMarketData);
            this.boundHandleMarketData = null;
        }
        // LOW FIX #27: intervalId removed as it was never set
        this.logger.info('Mock strategy stopped.');
    }
}
