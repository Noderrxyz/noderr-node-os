/**
 * Feed Validator Package
 * 
 * Provides market data feed validation, quarantine management, and quality scoring
 * for VALIDATOR tier nodes in the Noderr Protocol.
 * 
 * @packageDocumentation
 */

export { ValidatorNode } from './ValidatorNode';
export { QuarantineManager } from './QuarantineManager';
export { FeedBus } from './FeedBus';

// Re-export types from @noderr/types
export type { MarketSnapshot, FeedStats } from '@noderr/types';
