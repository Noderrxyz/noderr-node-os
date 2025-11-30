/**
 * Project Phoenix: Execution Types
 */
export interface Exchange {
    id: string;
    name: string;
    type: 'cex' | 'dex' | 'hybrid';
    chain?: string;
    tradingFees: TradingFees;
    capabilities: ExchangeCapability[];
    status: ExchangeStatus;
    latency: number;
    reliability: number;
    liquidityScore: number;
    mevProtection: boolean;
    apiRateLimit: RateLimit;
    supportedPairs: string[];
    lastUpdate: number;
}
export interface TradingFees {
    maker: number;
    taker: number;
    withdrawal: Record<string, number>;
    deposit: Record<string, number>;
    rebate?: number;
}
export interface ExchangeStatus {
    operational: boolean;
    tradingEnabled: boolean;
    depositsEnabled: boolean;
    withdrawalsEnabled: boolean;
    maintenanceMode: boolean;
    lastIncident?: string;
    uptime: number;
}
export interface RateLimit {
    requests: number;
    period: number;
    weight?: number;
    remaining?: number;
    reset?: number;
}
export declare enum ExchangeCapability {
    SPOT_TRADING = "spot_trading",
    MARGIN_TRADING = "margin_trading",
    FUTURES_TRADING = "futures_trading",
    OPTIONS_TRADING = "options_trading",
    STAKING = "staking",
    LENDING = "lending",
    API_TRADING = "api_trading",
    WEBSOCKET_FEED = "websocket_feed",
    OCO_ORDERS = "oco_orders",
    STOP_ORDERS = "stop_orders",
    TRAILING_STOP = "trailing_stop",
    ICEBERG_ORDERS = "iceberg_orders",
    POST_ONLY = "post_only",
    TIME_IN_FORCE = "time_in_force",
    REDUCE_ONLY = "reduce_only"
}
export interface Order {
    id: string;
    clientOrderId?: string;
    symbol: string;
    side: OrderSide;
    type: OrderType;
    quantity: number;
    price?: number;
    stopPrice?: number;
    timeInForce?: TimeInForce;
    status?: OrderStatus;
    exchange?: string;
    timestamp: number;
    expiresAt?: number;
    metadata?: OrderMetadata;
}
export declare enum OrderSide {
    BUY = "buy",
    SELL = "sell"
}
export declare enum OrderType {
    MARKET = "market",
    LIMIT = "limit",
    STOP_LOSS = "stop_loss",
    STOP_LOSS_LIMIT = "stop_loss_limit",
    TAKE_PROFIT = "take_profit",
    TAKE_PROFIT_LIMIT = "take_profit_limit",
    TRAILING_STOP = "trailing_stop",
    OCO = "oco",
    ICEBERG = "iceberg"
}
export declare enum TimeInForce {
    GTC = "gtc",// Good Till Cancelled
    IOC = "ioc",// Immediate or Cancel
    FOK = "fok",// Fill or Kill
    GTD = "gtd",// Good Till Date
    POST_ONLY = "post_only"
}
export declare enum OrderStatus {
    NEW = "new",
    PARTIALLY_FILLED = "partially_filled",
    FILLED = "filled",
    CANCELLED = "cancelled",
    REJECTED = "rejected",
    EXPIRED = "expired",
    PENDING = "pending"
}
export interface OrderMetadata {
    strategy?: string;
    algorithm?: string;
    urgency?: 'low' | 'medium' | 'high' | 'critical';
    slippageTolerance?: number;
    minExecutionSize?: number;
    maxExecutionSize?: number;
    preferredExchanges?: string[];
    avoidExchanges?: string[];
    mevProtection?: boolean;
    darkPool?: boolean;
    parentOrder?: string;
    preferMaker?: boolean;
    isIcebergClip?: boolean;
    hiddenQuantity?: number;
    isSimulation?: boolean;
    allowInPausedMode?: boolean;
    originalMode?: string;
    convertedAt?: number;
}
export interface RoutingDecision {
    orderId: string;
    routes: ExecutionRoute[];
    totalCost: number;
    expectedSlippage: number;
    executionTime: number;
    confidence: number;
    alternativeRoutes?: ExecutionRoute[];
    reasoning: string[];
    timestamp?: number;
}
export interface ExecutionRoute {
    exchange: string;
    orderType: OrderType;
    quantity: number;
    percentage: number;
    price: number;
    fees: number;
    slippage: number;
    latency: number;
    priority: number;
    backup?: boolean;
}
export interface LiquiditySnapshot {
    symbol: string;
    timestamp: number;
    exchanges: ExchangeLiquidity[];
    aggregatedDepth: OrderBookDepth;
    bestBid: PriceLevel;
    bestAsk: PriceLevel;
    spread: number;
    spreadPercentage: number;
    imbalance: number;
}
export interface ExchangeLiquidity {
    exchange: string;
    bid: PriceLevel[];
    ask: PriceLevel[];
    lastTrade: Trade;
    volume24h: number;
    trades24h: number;
    volatility: number;
}
export interface PriceLevel {
    price: number;
    quantity: number;
    orders?: number;
    exchange?: string;
}
export interface OrderBookDepth {
    bids: AggregatedLevel[];
    asks: AggregatedLevel[];
    midPrice: number;
    weightedMidPrice: number;
    totalBidVolume: number;
    totalAskVolume: number;
    depthImbalance: number;
}
export interface AggregatedLevel {
    price: number;
    quantity: number;
    exchanges: string[];
    orders: number;
}
export interface Trade {
    id: string;
    symbol: string;
    price: number;
    quantity: number;
    timestamp: number;
    side: string;
    exchange: string;
    isBlockTrade?: boolean;
}
export interface MarketData {
    symbol: string;
    exchanges: Record<string, ExchangeMarketData>;
    aggregated: AggregatedMarketData;
    timestamp: number;
}
export interface ExchangeMarketData {
    bid: number;
    ask: number;
    last: number;
    volume24h: number;
    high24h: number;
    low24h: number;
    vwap24h: number;
    trades24h: number;
    openInterest?: number;
}
export interface AggregatedMarketData {
    bestBid: PriceSource;
    bestAsk: PriceSource;
    midPrice: number;
    weightedMidPrice: number;
    spread: number;
    volume24h: number;
    vwap24h: number;
    volatility: number;
    liquidityScore: number;
}
export interface PriceSource {
    price: number;
    quantity: number;
    exchange: string;
    timestamp: number;
}
export interface WebSocketConfig {
    url: string;
    options: {
        reconnect: boolean;
        reconnectInterval: number;
        maxReconnectAttempts: number;
        pingInterval: number;
        pongTimeout: number;
        compression: boolean;
    };
    subscriptions: Subscription[];
}
export interface Subscription {
    channel: ChannelType;
    symbols: string[];
    depth?: number;
    interval?: number;
    params?: any;
}
export declare enum ChannelType {
    TICKER = "ticker",
    TRADES = "trades",
    ORDERBOOK = "orderbook",
    CANDLES = "candles",
    ORDERS = "orders",
    BALANCES = "balances",
    POSITIONS = "positions"
}
export interface RoutingConfig {
    mode: 'smart' | 'manual' | 'hybrid';
    splitThreshold: number;
    maxSplits: number;
    routingObjective: 'cost' | 'speed' | 'size' | 'balanced';
    venueAnalysis: boolean;
    darkPoolAccess: boolean;
    crossVenueArbitrage: boolean;
    latencyOptimization: boolean;
    mevProtection: boolean;
}
export declare enum MarketCondition {
    CALM = "calm",
    NORMAL = "normal",
    VOLATILE = "volatile",
    EXTREME = "extreme"
}
export declare enum LiquidityCondition {
    DEEP = "deep",
    NORMAL = "normal",
    THIN = "thin",
    ILLIQUID = "illiquid"
}
export declare enum ExecutionErrorCode {
    INSUFFICIENT_LIQUIDITY = "INSUFFICIENT_LIQUIDITY",
    EXCHANGE_ERROR = "EXCHANGE_ERROR",
    RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED",
    INVALID_ORDER = "INVALID_ORDER",
    MEV_ATTACK_DETECTED = "MEV_ATTACK_DETECTED",
    SLIPPAGE_EXCEEDED = "SLIPPAGE_EXCEEDED",
    TIMEOUT = "TIMEOUT",
    CONFIGURATION_ERROR = "CONFIGURATION_ERROR",
    ALL_VENUES_FAILED = "ALL_VENUES_FAILED"
}
export declare class ExecutionError extends Error {
    code: ExecutionErrorCode;
    details?: any | undefined;
    constructor(code: ExecutionErrorCode, message: string, details?: any | undefined);
}
export type OrderId = string;
export type ExchangeId = string;
export type Symbol = string;
export type Timestamp = number;
export type Price = number;
export type Quantity = number;
export interface MEVProtectionConfig {
    enabled: boolean;
    strategies: MEVProtectionStrategy[];
    flashbotsEnabled: boolean;
    privateRelays: string[];
    bundleTimeout: number;
    maxBundleSize: number;
    priorityFeeStrategy: 'fixed' | 'dynamic' | 'aggressive';
    backrunProtection: boolean;
    sandwichProtection: boolean;
}
export declare enum MEVProtectionStrategy {
    FLASHBOTS = "flashbots",
    PRIVATE_MEMPOOL = "private_mempool",
    COMMIT_REVEAL = "commit_reveal",
    TIME_BASED_EXECUTION = "time_based_execution",
    STEALTH_TRANSACTIONS = "stealth_transactions",
    BUNDLE_TRANSACTIONS = "bundle_transactions",
    MEV_BLOCKER = "mev_blocker"
}
export interface TransactionBundle {
    id: string;
    transactions: BundleTransaction[];
    targetBlock: number;
    maxBlockNumber: number;
    minTimestamp?: number;
    maxTimestamp?: number;
    revertingTxHashes?: string[];
    totalGasUsed: number;
    bundleHash: string;
    status: BundleStatus;
}
export interface BundleTransaction {
    hash: string;
    transaction: any;
    signer: string;
    nonce: number;
    gasPrice?: any;
    maxFeePerGas?: any;
    maxPriorityFeePerGas?: any;
    canRevert: boolean;
}
export declare enum BundleStatus {
    PENDING = "pending",
    INCLUDED = "included",
    FAILED = "failed",
    TIMEOUT = "timeout",
    UNCLED = "uncled"
}
export interface MEVProtectionResult {
    protected: boolean;
    strategy: MEVProtectionStrategy;
    bundleHash?: string;
    blockNumber?: number;
    gasUsed?: number;
    priorityFee?: any;
    backrunDetected: boolean;
    sandwichDetected: boolean;
    savedAmount?: number;
}
export interface ExecutionResult {
    orderId: string;
    status: ExecutionStatus;
    fills: Fill[];
    averagePrice: number;
    totalQuantity: number;
    totalFees: number;
    slippage: number;
    marketImpact: number;
    executionTime: number;
    routes: ExecutedRoute[];
    performance: ExecutionPerformance;
    mevProtection?: MEVProtectionResult;
}
export declare enum ExecutionStatus {
    COMPLETED = "completed",
    PARTIAL = "partial",
    FAILED = "failed",
    CANCELLED = "cancelled",
    EXPIRED = "expired"
}
export interface Fill {
    id: string;
    orderId: string;
    exchange: string;
    price: number;
    quantity: number;
    fee: number;
    timestamp: number;
    side: OrderSide;
    liquidity: 'maker' | 'taker';
    tradeId?: string;
    symbol?: string;
}
export interface ExecutedRoute {
    exchange: string;
    orderId: string;
    quantity: number;
    fills: number;
    averagePrice: number;
    fees: number;
    latency: number;
    success: boolean;
}
export interface ExecutionPerformance {
    slippageBps: number;
    implementationShortfall: number;
    fillRate: number;
    reversion: number;
    benchmarkDeviation: number;
    vwapDeviation?: number;
    arrivalPriceDeviation?: number;
    opportunityCost: number;
    totalCost: number;
}
export declare enum AlgorithmType {
    TWAP = "twap",
    VWAP = "vwap",
    POV = "pov",// Percentage of Volume
    IS = "implementation_shortfall",
    ICEBERG = "iceberg",
    SNIPER = "sniper",
    LIQUIDITY_SEEKING = "liquidity_seeking",
    DARK_POOL = "dark_pool",
    ADAPTIVE = "adaptive",
    ARRIVAL_PRICE = "arrival_price"
}
export interface AlgorithmConfig {
    type: AlgorithmType;
    parameters: AlgorithmParameters;
    constraints: ExecutionConstraints;
    objectives: ExecutionObjectives;
    monitoring: AlgorithmMonitoring;
}
export interface AlgorithmParameters {
    duration?: number;
    participationRate?: number;
    clipSize?: number;
    limitPrice?: number;
    urgency?: number;
    discretion?: number;
}
export interface ExecutionConstraints {
    maxSlippage: number;
    maxParticipation: number;
    minClipSize: number;
    maxClipSize: number;
    maxMarketImpact: number;
    minFillRate: number;
    maxDuration: number;
}
export interface ExecutionObjectives {
    minimize: 'cost' | 'impact' | 'time';
    priority: 'speed' | 'price' | 'size';
    riskAversion: number;
}
export interface AlgorithmMonitoring {
    enabled: boolean;
    checkInterval: number;
    recalibrationThreshold: number;
    fallbackStrategy: AlgorithmType;
}
//# sourceMappingURL=execution.d.ts.map