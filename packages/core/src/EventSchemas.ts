import { z } from 'zod';

/**
 * Central Event Schema Registry
 * 
 * This file defines all event schemas used across the Noderr system.
 * Benefits:
 * 1. Single source of truth for event structures
 * 2. Runtime validation to catch type mismatches
 * 3. Prevents circular dependencies (all packages import from @noderr/core)
 * 4. Type safety with TypeScript inference from Zod schemas
 */

// ============================================================================
// Market Data Event Schemas
// ============================================================================

export const MarketDataCandleSchema = z.object({
    symbol: z.string(),
    open: z.number(),
    high: z.number(),
    low: z.number(),
    close: z.number(),
    volume: z.number(),
    timestamp: z.number(),
    interval: z.string().optional(),
});

export type MarketDataCandle = z.infer<typeof MarketDataCandleSchema>;

// ============================================================================
// Strategy Signal Event Schemas
// ============================================================================

export const TradingSignalSchema = z.object({
    strategyId: z.string(),
    symbol: z.string(),
    side: z.enum(['buy', 'sell']),
    quantity: z.number().positive(),
    orderType: z.enum(['market', 'limit', 'stop', 'stop_limit']),
    limitPrice: z.number().positive().optional(),
    stopPrice: z.number().positive().optional(),
    urgency: z.number().min(0).max(1).optional(),
    // LOW FIX #47: Use unknown instead of any for better type safety
    metadata: z.record(z.string(), z.unknown()).optional(),
    timestamp: z.number(),
});

export type TradingSignal = z.infer<typeof TradingSignalSchema>;

// ============================================================================
// Execution Event Schemas
// ============================================================================

export const FillSchema = z.object({
    price: z.number(),
    quantity: z.number(),
    venue: z.string(),
    timestamp: z.number(),
    fee: z.number().optional(),
});

export type Fill = z.infer<typeof FillSchema>;

export const ExecutionResultSchema = z.object({
    orderId: z.string(),
    symbol: z.string(),
    side: z.enum(['buy', 'sell']),
    status: z.enum(['completed', 'partial', 'failed', 'cancelled']),
    fills: z.array(FillSchema),
    totalCost: z.number(),
    avgPrice: z.number(),
    totalQuantity: z.number(),
    // LOW FIX #47: Use unknown instead of any for better type safety
    metadata: z.record(z.string(), z.unknown()).optional(),
    timestamp: z.number(),
});

export type ExecutionResult = z.infer<typeof ExecutionResultSchema>;

// ============================================================================
// Performance Event Schemas
// ============================================================================

export const StrategyPerformanceSchema = z.object({
    strategyId: z.string(),
    totalTrades: z.number().int().nonnegative(),
    winningTrades: z.number().int().nonnegative(),
    losingTrades: z.number().int().nonnegative(),
    neutralTrades: z.number().int().nonnegative().optional(),
    totalPnl: z.number(),
    winRate: z.number().min(0).max(1),
    lastUpdated: z.number(),
});

export type StrategyPerformance = z.infer<typeof StrategyPerformanceSchema>;

// ============================================================================
// Reputation Event Schemas
// ============================================================================

export const TrustFingerprintSchema = z.object({
    strategyId: z.string(),
    performanceScore: z.number().min(0).max(100),
    reliabilityScore: z.number().min(0).max(100),
    complianceScore: z.number().min(0).max(100),
    compositeScore: z.number().min(0).max(100),
    timestamp: z.number(),
});

export type TrustFingerprint = z.infer<typeof TrustFingerprintSchema>;

// ============================================================================
// Event Schema Registry
// ============================================================================

export const EventSchemaRegistry = {
    'market.data.candle': MarketDataCandleSchema,
    'strategy.signal': TradingSignalSchema,
    'order.executed': ExecutionResultSchema,
    'pnl.update': StrategyPerformanceSchema,
    'reputation.trust_fingerprint.update': TrustFingerprintSchema,
} as const;

export type EventSchemaRegistry = typeof EventSchemaRegistry;
export type EventTopic = keyof EventSchemaRegistry;

/**
 * Validate an event payload against its schema
 * 
 * @param topic The event topic
 * @param payload The event payload to validate
 * @returns The validated payload (with proper typing)
 * @throws ZodError if validation fails
 */
export function validateEventPayload<T extends EventTopic>(
    topic: T,
    payload: unknown
): any {
    const schema = EventSchemaRegistry[topic];
    if (!schema) {
        throw new Error(`No schema defined for event topic: ${topic}`);
    }
    return schema.parse(payload) as any;
}

/**
 * Safely validate an event payload, returning a result object instead of throwing
 * 
 * @param topic The event topic
 * @param payload The event payload to validate
 * @returns Success or error result
 */
export function safeValidateEventPayload<T extends EventTopic>(
    topic: T,
    payload: unknown
): { success: true; data: any } | { success: false; error: z.ZodError } {
    const schema = EventSchemaRegistry[topic];
    if (!schema) {
        return {
            success: false,
            error: new z.ZodError([{
                code: 'custom',
                message: `No schema defined for event topic: ${topic}`,
                path: [],
            }]),
        };
    }
    return schema.safeParse(payload) as any;
}

// ============================================================================
// Type-safe Event Interfaces
// ============================================================================

export interface TypedSimulationEvent<T extends EventTopic> {
    topic: T;
    payload: z.infer<EventSchemaRegistry[T]>;
    source: string;
    timestamp: number;
}

// Specific event types for convenience
export type MarketDataEvent = TypedSimulationEvent<'market.data.candle'>;
export type StrategySignalEvent = TypedSimulationEvent<'strategy.signal'>;
export type OrderExecutedEvent = TypedSimulationEvent<'order.executed'>;
export type PnLUpdateEvent = TypedSimulationEvent<'pnl.update'>;
export type TrustFingerprintUpdateEvent = TypedSimulationEvent<'reputation.trust_fingerprint.update'>;
