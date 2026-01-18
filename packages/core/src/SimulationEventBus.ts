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
import { Logger } from '@noderr/utils';

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

  private constructor() {
    super();
    this.logger = new Logger('SimulationEventBus');
    this.setMaxListeners(100); // Allow many subscribers
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
   * Publish an event
   */
  publish(topic: string, payload: any, source: string = 'unknown'): void {
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
   */
  subscribe(topic: string, handler: (event: SimulationEvent) => void, subscriber: string = 'unknown'): void {
    this.on(topic, handler);
    
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
  
  // Positions
  POSITION_OPENED: 'position.opened',
  POSITION_CLOSED: 'position.closed',
  POSITION_UPDATED: 'position.updated',
  
  // Risk
  RISK_ALERT: 'risk.alert',
  RISK_LIMIT_EXCEEDED: 'risk.limit.exceeded',
  
  // System
  SYSTEM_READY: 'system.ready',
  SYSTEM_ERROR: 'system.error',
  SYSTEM_SHUTDOWN: 'system.shutdown'
};
