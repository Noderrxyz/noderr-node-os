/**
 * Simulation Event Bus
 * 
 * Simplified event bus for testnet simulation mode.
 * Provides inter-service communication without the complexity of the full MessageBus.
 * 
 * This is a pragmatic solution to get testnet working quickly.
 * For production mainnet, we'll use the full integration-layer MessageBus.
 */

import { EventEmitter } from 'events';
import { Logger } from '@noderr/utils/src';
import { safeValidateEventPayload, EventTopic } from './EventSchemas';

export interface SimulationEvent {
  type: string;
  topic: string;
  payload: any;
  timestamp: number;
  source: string;
}

export class SimulationEventBus extends EventEmitter {
  private static instance: SimulationEventBus | null = null;
  private logger: Logger;
  private eventCount: number = 0;
  private validationEnabled: boolean = true; // Enable validation by default

  private constructor() {
    super();
    this.logger = new Logger('SimulationEventBus');
    // LOW FIX #4: Make max listeners configurable via environment variable
    const maxListeners = process.env.EVENT_BUS_MAX_LISTENERS 
      ? parseInt(process.env.EVENT_BUS_MAX_LISTENERS, 10) 
      : 100;
    this.setMaxListeners(maxListeners);
    this.logger.info(`Event bus initialized with max ${maxListeners} listeners`);
  }

  /**
   * Get singleton instance
   */
  static getInstance(): SimulationEventBus {
    if (!SimulationEventBus.instance) {
      SimulationEventBus.instance = new SimulationEventBus();
    }
    return SimulationEventBus.instance;
  }

  /**
   * Publish an event with runtime schema validation
   */
  publish(topic: string, payload: any, source: string = 'unknown'): void {
    // CRITICAL FIX #118: Add runtime schema validation
    if (this.validationEnabled) {
      const result = safeValidateEventPayload(topic as EventTopic, payload);
      if (!result.success) {
        // Validation failed - log and throw error
        this.logger.error('Event payload validation failed', {
          topic,
          source,
          errors: (result as any).error.issues,
        });
        // Throw error to prevent invalid data from propagating
        throw new Error(`Invalid event payload for topic ${topic}: ${(result as any).error.message}`);
      }
      // Use the validated payload (with proper typing)
      payload = result.data;
    }

    const event: SimulationEvent = {
      type: 'event',
      topic,
      payload,
      timestamp: Date.now(),
      source
    };

    this.eventCount++;
    this.emit(topic, event);

    this.logger.debug(`Event published: ${topic}`, {
      source,
      eventCount: this.eventCount
    });
  }

  /**
   * Subscribe to a topic
   * MEDIUM FIX #3: Wrap handler in try-catch to prevent subscriber errors from crashing the system
   */
  subscribe(topic: string, handler: (event: SimulationEvent) => void, subscriber: string = 'unknown'): void {
    // Wrap the handler in a try-catch to isolate errors
    const safeHandler = (event: SimulationEvent) => {
      try {
        handler(event);
      } catch (error) {
        this.logger.error(`Error in subscriber handler for topic ${topic}`, {
          subscriber,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        // Don't rethrow - isolate the error to this subscriber
      }
    };
    
    this.on(topic, safeHandler);
    
    this.logger.debug(`Subscribed to topic: ${topic}`, {
      subscriber,
      listenerCount: this.listenerCount(topic)
    });
  }

  /**
   * Unsubscribe from a topic
   */
  unsubscribe(topic: string, handler: (event: SimulationEvent) => void): void {
    this.off(topic, handler);
    
    this.logger.debug(`Unsubscribed from topic: ${topic}`, {
      listenerCount: this.listenerCount(topic)
    });
  }

  /**
   * Get event count
   */
  getEventCount(): number {
    return this.eventCount;
  }

  /**
   * Enable or disable schema validation
   */
  setValidationEnabled(enabled: boolean): void {
    this.validationEnabled = enabled;
    this.logger.info(`Schema validation ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Reset event bus (for testing)
   */
  reset(): void {
    this.removeAllListeners();
    this.eventCount = 0;
    this.logger.info('Event bus reset');
  }
}

// Export singleton instance
export const eventBus = SimulationEventBus.getInstance();

/**
 * Standard event topics for testnet simulation
 */
export const EventTopics = {
  // Market Data
  MARKET_DATA_TICK: 'market.data.tick',
  MARKET_DATA_CANDLE: 'market.data.candle',
  MARKET_DATA_ORDERBOOK: 'market.data.orderbook',
  
  // Trading Signals
  TRADING_SIGNAL: 'trading.signal',
  STRATEGY_SIGNAL: 'strategy.signal',
  
  // Orders
  ORDER_PLACED: 'order.placed',
  ORDER_FILLED: 'order.filled',
  ORDER_CANCELLED: 'order.cancelled',
  ORDER_REJECTED: 'order.rejected',
  ORDER_EXECUTED: 'order.executed',
  
  // Positions
  POSITION_OPENED: 'position.opened',
  POSITION_CLOSED: 'position.closed',
  POSITION_UPDATED: 'position.updated',
  
  // Risk
  RISK_ALERT: 'risk.alert',
  RISK_LIMIT_EXCEEDED: 'risk.limit.exceeded',

  // Performance & Reputation
  PNL_UPDATE: 'pnl.update',
  TRUST_FINGERPRINT_UPDATE: 'reputation.trust_fingerprint.update',
  
  // System
  SYSTEM_READY: 'system.ready',
  SYSTEM_ERROR: 'system.error',
  SYSTEM_SHUTDOWN: 'system.shutdown'
};
