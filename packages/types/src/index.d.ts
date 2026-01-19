/**
 * @noderr/types - Shared TypeScript type definitions
 */
export interface Order {
    id: string;
    clientOrderId?: string;
    symbol: string;
    side: OrderSide | 'buy' | 'sell';
    type: OrderType | 'market' | 'limit' | 'stop';
    price?: number;
    amount: number;
    quantity?: number;
    status: OrderStatus;
    timestamp: number;
    timeInForce?: TimeInForce;
    exchange?: string;
    createdAt?: number;
    updatedAt?: number;
    metadata?: Record<string, any>;
}
export declare enum OrderStatus {
    PENDING = "pending",
    NEW = "new",
    OPEN = "open",
    PARTIALLY_FILLED = "partially_filled",
    FILLED = "filled",
    CANCELLED = "cancelled",
    REJECTED = "rejected",
    EXPIRED = "expired"
}
export declare enum OrderSide {
    BUY = "buy",
    SELL = "sell"
}
export declare enum OrderType {
    MARKET = "market",
    LIMIT = "limit",
    STOP = "stop",
    STOP_LIMIT = "stop_limit"
}
export declare enum TimeInForce {
    GTC = "gtc",// Good Till Cancel
    IOC = "ioc",// Immediate Or Cancel
    FOK = "fok",// Fill Or Kill
    DAY = "day",// Day Order
    POST_ONLY = "post_only"
}
export interface Trade {
    id: string;
    orderId: string;
    symbol: string;
    side: 'buy' | 'sell';
    price: number;
    amount: number;
    fee: number;
    timestamp: number;
    venue: string;
}
export interface Position {
    symbol: string;
    amount: number;
    averagePrice: number;
    unrealizedPnl: number;
    realizedPnl: number;
    lastUpdate: number;
    adapterId?: string;
    value?: number;
    protocol?: string;
    apy?: number;
}
export interface ExecutionResult {
    success?: boolean;
    orderId?: string;
    status?: OrderStatus;
    trades?: Trade[];
    fills?: Fill[];
    error?: string;
    metadata?: Record<string, any>;
    averagePrice?: number;
    totalQuantity?: number;
    totalFees?: number;
    slippage?: number;
    marketImpact?: number;
    executionTime?: number;
    routes?: ExecutedRoute[];
    performance?: any;
}
export declare enum ExecutionErrorCode {
    INVALID_ORDER = "INVALID_ORDER",
    INSUFFICIENT_BALANCE = "INSUFFICIENT_BALANCE",
    VENUE_ERROR = "VENUE_ERROR",
    TIMEOUT = "TIMEOUT",
    RATE_LIMIT = "RATE_LIMIT",
    NETWORK_ERROR = "NETWORK_ERROR",
    UNKNOWN = "UNKNOWN"
}
export declare class ExecutionError extends Error {
    code: ExecutionErrorCode;
    details?: any | undefined;
    constructor(message: string, code: ExecutionErrorCode, details?: any | undefined);
}
export declare enum ExecutionStatus {
    PENDING = "pending",
    PARTIAL = "partial",
    COMPLETED = "completed",
    FAILED = "failed",
    CANCELLED = "cancelled",
    EXPIRED = "expired"
}
export interface Fill {
    id: string;
    orderId: string;
    symbol: string;
    side: OrderSide | 'buy' | 'sell';
    price: number;
    quantity: number;
    fee: number;
    fees?: number;
    timestamp: number;
    venue?: string;
    exchange?: string;
    liquidity?: 'maker' | 'taker';
    tradeId?: string;
}
export interface AlgorithmParameters {
    [key: string]: any;
}
export interface ExecutionConstraints {
    maxSlippage?: number;
    maxLatency?: number;
    minFillRate?: number;
    venues?: string[];
}
export interface ExecutionRoute {
    venue: string;
    exchange?: string;
    quantity: number;
    priority: number;
    price?: number;
    fees?: number;
    slippage?: number;
    latency?: number;
    orderType?: OrderType | string;
}
export interface Exchange {
    id: string;
    name: string;
    enabled: boolean;
    fees: TradingFees;
}
export interface TradingFees {
    maker: number;
    taker: number;
    withdrawal?: number;
    rebate?: number;
}
export interface PriceLevel {
    price: number;
    quantity: number;
}
export interface ExecutionObjectives {
    primary?: 'cost' | 'speed' | 'stealth' | 'impact';
    minimizeCost?: boolean;
    minimizeSlippage?: boolean;
    minimizeLatency?: boolean;
    maximizeFillRate?: boolean;
}
export interface CostAnalysis {
    totalCost: number;
    fees: number;
    slippage: number;
    priceImpact: number;
}
export interface ExecutedRoute extends ExecutionRoute {
    fills: Fill[];
    avgPrice: number;
    averagePrice?: number;
    totalFee: number;
}
export interface ExecutionPerformance {
    avgPrice: number;
    totalFee: number;
    slippage: number;
    latency: number;
    fillRate: number;
}
export interface ExecutionStrategy {
    type: 'market' | 'limit' | 'twap' | 'vwap' | 'iceberg';
    params: Record<string, any>;
}
export interface VenueConfig {
    name: string;
    enabled: boolean;
    priority: number;
    rateLimit?: number;
    credentials?: Record<string, string>;
}
export interface RiskMetrics {
    var95: number;
    var99: number;
    sharpe: number;
    sortino: number;
    maxDrawdown: number;
    currentExposure: number;
    leverage: number;
    sharpeRatio?: number;
    totalExposure?: number;
}
export interface RiskLimits {
    maxPositionSize: number;
    maxLeverage: number;
    maxDrawdown: number;
    dailyLossLimit: number;
    maxDailyLoss?: number;
    maxOrderSize?: number;
    maxOpenOrders?: number;
    marginRequirement?: number;
    maxConcentration?: number;
    positionLimits: Record<string, number>;
}
export interface ModelConfig {
    name: string;
    type: 'transformer' | 'lstm' | 'rl' | 'ensemble';
    version: string;
    parameters: Record<string, any>;
}
export interface Prediction {
    symbol: string;
    timestamp: number;
    horizon: number;
    value: number;
    confidence: number;
    metadata?: Record<string, any>;
}
export interface AlgorithmConfig {
    type: string;
    params: Record<string, any>;
    parameters?: Record<string, any>;
}
export interface TWAPConfig extends AlgorithmConfig {
    type: 'twap';
    params: {
        duration: number;
        slices: number;
        randomize?: boolean;
    };
}
export interface VWAPConfig extends AlgorithmConfig {
    type: 'vwap';
    params: {
        lookbackPeriod: number;
        volumeProfile: 'historical' | 'realtime';
    };
}
export interface MEVConfig {
    useFlashbots: boolean;
    privateMempools: string[];
    bundleTimeout: number;
    maxPriorityFee?: number;
}
export interface SafetyConfig {
    maxSlippage: number;
    circuitBreaker: {
        enabled: boolean;
        lossThreshold: number;
        cooldownPeriod: number;
    };
    failover: {
        enabled: boolean;
        retryAttempts: number;
        backoffMultiplier: number;
    };
}
export interface SystemEvent {
    id: string;
    type: string;
    timestamp: number;
    data: any;
    source: string;
}
export interface TradingEvent extends SystemEvent {
    type: 'order' | 'trade' | 'position' | 'risk';
    symbol?: string;
    venue?: string;
}
export interface OnChainServiceConfig {
    rpcUrl: string;
    privateKey: string;
    treasuryManagerAddress: string;
    merkleRewardDistributorAddress: string;
    trustFingerprintAddress: string;
    chainId: number;
    networkName: string;
    nodeRegistryAddress?: string;
    governanceManagerAddress?: string;
    maxCapitalRequest: bigint;
    dailyCapitalLimit: bigint;
    rateLimitRequestsPerHour: number;
    logLevel: string;
    logFile?: string;
}
export interface CapitalRequest {
    amount: bigint;
    strategyId: string;
    token: string;
    reason?: string;
}
export interface PerformanceMetrics {
    pnl: bigint;
    sharpeRatio: number;
    strategyId: string;
    totalValue?: number;
}
export interface TransactionResult {
    success: boolean;
    transactionHash?: string;
    blockNumber?: number;
    gasUsed?: bigint;
    error?: string;
}
export interface RewardEntry {
    address: string;
    amount: bigint;
}
export interface MerkleProof {
    proof: string[];
    leaf: string;
}
export interface TrustScoreUpdate {
    operator: string;
    uptime: number;
    quality: number;
    governance: number;
    history: number;
    peer: number;
    stake: number;
}
export interface CircuitBreakerStatus {
    isOpen: boolean;
    failures: number;
    lastFailure?: number;
    reason?: string;
    isTripped: boolean;
    timestamp?: number;
}
export interface RateLimiterStatus {
    requestCount: number;
    windowStart: number;
    limit: number;
    requestsInLastHour: number;
    canMakeRequest: boolean;
}
export declare enum MarketCondition {
    NORMAL = "normal",
    VOLATILE = "volatile",
    TRENDING = "trending",
    RANGING = "ranging"
}
export declare enum AlgorithmType {
    TWAP = "twap",
    VWAP = "vwap",
    POV = "pov",
    ICEBERG = "iceberg",
    ADAPTIVE = "adaptive"
}
export interface RateLimit {
    maxRequests: number;
    windowMs: number;
    requests?: number;
    remaining?: number;
    reset?: number;
    period?: number;
}
export declare enum ExecutionUrgency {
    LOW = "low",
    MEDIUM = "medium",
    HIGH = "high",
    CRITICAL = "critical"
}
export type OrderId = string;
export type TradeId = string;
export type Symbol = string;
export type Venue = string;
export type Timestamp = number;
export interface FloorEngineConfig {
    riskParameters: RiskParameters;
    rebalanceThreshold: number;
    minRebalanceInterval: number;
    maxSlippage: number;
    rpcUrl?: string;
}
export interface RiskParameters {
    maxPositionSize: number;
    maxLeverage: number;
    maxDrawdown: number;
    maxDrawdownBps?: number;
    concentrationLimit: number;
    correlationThreshold: number;
    emergencyPauseEnabled?: boolean;
    allowedTokens?: string[];
    allowedProtocols?: string[];
    maxAllocationPerAdapter?: number;
    maxAllocationPerProtocol?: number;
    maxAllocationPerChain?: number;
    maxSlippageBps?: number;
    maxMLRiskScore?: number;
}
export declare enum AdapterCategory {
    LENDING = "lending",
    STAKING = "staking",
    YIELD = "yield",
    LIQUIDITY = "liquidity"
}
export interface AdapterMetadata {
    id: string;
    name: string;
    category: AdapterCategory;
    protocol: string;
    chainId: number;
    chain?: string;
    riskScore: number;
    riskLevel?: string;
    apy: number;
    historicalAPY?: number;
    tvl: number;
    lastUpdate: number;
    enabled?: boolean;
    version?: string;
    maxAllocation?: number;
}
export interface IYieldAdapter {
    deposit(amount: bigint, token: string): Promise<string>;
    withdraw(amount: bigint, token: string): Promise<string>;
    getBalance(token: string): Promise<bigint>;
    getApy(token: string): Promise<number>;
    getMetadata(): AdapterMetadata;
}
export interface ILendingAdapter extends IYieldAdapter {
    borrow(amount: bigint, token: string): Promise<string>;
    repay(amount: bigint, token: string): Promise<string>;
    getCollateralRatio(): Promise<number>;
}
export interface IStakingAdapter extends IYieldAdapter {
    stake(amount: bigint, token: string): Promise<string>;
    unstake(amount: bigint, token: string): Promise<string>;
    getRewards(token: string): Promise<bigint>;
    claimRewards(token: string): Promise<string>;
}
export interface AllocationStrategy {
    type: 'equal' | 'risk-weighted' | 'apy-weighted' | 'custom';
    weights?: Record<string, number>;
    constraints?: {
        minAllocation?: number;
        maxAllocation?: number;
        minApy?: number;
        maxRisk?: number;
    };
}
export interface RebalanceAction {
    type: 'deposit' | 'withdraw' | 'transfer';
    adapterId: string;
    token: string;
    amount: bigint;
    from?: string;
    to?: string;
}
export interface RebalanceResult {
    success: boolean;
    actions: RebalanceAction[];
    gasUsed: bigint;
    timestamp: number;
    error?: string;
}
export interface PerformanceSnapshot {
    timestamp: number;
    totalValue: bigint;
    pnl: bigint;
    apy: number;
    sharpeRatio: number;
    positions: Position[];
    riskMetrics: RiskMetrics;
}
export * from './ml-types';
export interface SystemConfig {
    modules: Record<string, ModuleConfig>;
    secrets?: SecretsConfig;
    environment: 'development' | 'staging' | 'production';
    version: string;
}
export interface ModuleConfig {
    enabled: boolean;
    config: Record<string, any>;
    dependencies?: string[];
    priority?: number;
}
export interface ConfigUpdate {
    path: string;
    value: any;
    timestamp: number;
    source: string;
}
export interface ConfigValidation {
    valid: boolean;
    errors?: ConfigError[];
    warnings?: string[];
}
export interface ConfigError {
    code?: string;
    message: string;
    path?: string;
    value?: any;
}
export interface ConfigSchema {
    type: string;
    properties?: Record<string, ConfigSchema>;
    required?: string[];
    default?: any;
    validation?: (value: any) => boolean;
}
export interface EnvMapping {
    type?: string;
    envVar: string;
    configPath: string;
    transform?: (value: string) => any;
    required?: boolean;
}
export interface Secret {
    key: string;
    value: string;
    encrypted?: boolean;
    expiresAt?: number;
}
export interface SecretsConfig {
    provider: 'env' | 'vault' | 'aws-secrets' | 'gcp-secrets';
    secrets: Record<string, Secret>;
}
export declare class ConfigUtils {
    static merge(base: any, override: any): any;
    static validate(config: any, schema: ConfigSchema): ConfigValidation;
    static setValueByPath(obj: any, path: string, value: any): void;
}
export declare enum HealthStatus {
    HEALTHY = "healthy",
    DEGRADED = "degraded",
    UNHEALTHY = "unhealthy",
    UNKNOWN = "unknown"
}
export interface SystemHealth {
    status: HealthStatus;
    modules: Record<string, ModuleStatusInfo>;
    metrics: HealthMetrics;
    alerts: HealthAlert[];
    timestamp: number;
}
export declare enum ModuleStatus {
    HEALTHY = "healthy",
    DEGRADED = "degraded",
    UNHEALTHY = "unhealthy",
    UNKNOWN = "unknown",
    STARTING = "starting",
    READY = "ready",
    ERROR = "error",
    STOPPING = "stopping",
    STOPPED = "stopped"
}
export interface ModuleStatusInfo {
    name: string;
    status: ModuleStatus | HealthStatus;
    uptime: number;
    lastCheck: number;
    metrics?: Record<string, number>;
    error?: string;
}
export interface HealthCheckConfig {
    interval: number;
    timeout: number;
    retries: number;
    enabled: boolean;
    modules?: string[];
}
export interface HealthCheckResult {
    module: string;
    status: HealthStatus;
    metrics?: HealthMetrics;
    latency: number;
    timestamp: number;
    error?: string;
    lastError?: string;
    uptime?: number;
    alerts?: HealthAlert[];
    details?: Record<string, any>;
}
export interface HealthMetrics {
    cpu?: number | {
        usage?: number;
        system?: number;
        user?: number;
        idle?: number;
    };
    memory?: number | {
        heapUsed?: number;
        heapTotal?: number;
        external?: number;
        rss?: number;
        available?: number;
        percentUsed?: number;
    };
    disk?: number;
    network?: number;
    uptime?: number;
    requestRate?: number;
    errorRate?: number;
}
export interface HealthAlert {
    id: string;
    severity: 'info' | 'warning' | 'error' | 'critical';
    module: string;
    message: string;
    timestamp: number;
    acknowledged: boolean;
    resolved?: boolean;
    resolvedAt?: number;
}
export interface HealthHistory {
    module: string;
    moduleId?: string;
    checks: HealthCheckResult[];
    entries?: HealthCheckResult[];
    summary?: {
        period?: number;
        uptime?: number;
        avgCpu?: number;
        avgMemory?: number;
        errorCount?: number;
        statusChanges?: number;
        mttr?: number;
        mtbf?: number;
    };
    startTime?: number;
    endTime?: number;
}
export declare enum ModuleHealthStatus {
    HEALTHY = "healthy",
    DEGRADED = "degraded",
    UNHEALTHY = "unhealthy",
    UNKNOWN = "unknown"
}
export interface ModuleHealthConfig {
    module: string;
    moduleId?: string;
    enabled?: boolean;
    interval?: number;
    checks?: string[];
    checkInterval: number;
    timeout: number;
    thresholds: {
        degraded?: number;
        unhealthy?: number;
        warning?: number;
        critical?: number;
        cpu?: number;
        memory?: number;
        latency?: number;
    };
}
export declare class HealthUtils {
    static calculateStatus(metrics: HealthMetrics): HealthStatus;
}
export declare enum MessageType {
    COMMAND = "command",
    EVENT = "event",
    QUERY = "query",
    RESPONSE = "response",
    MODULE_RESET = "module_reset",
    MODULE_FAILOVER = "module_failover",
    MODULE_ROLLBACK = "module_rollback",
    MODULE_SCALE = "module_scale",
    MODULE_ALERT = "module_alert",
    MODULE_ERROR = "module_error",
    SYSTEM_STARTUP = "system_startup",
    SYSTEM_SHUTDOWN = "system_shutdown",
    MODULE_REGISTER = "module_register",
    MODULE_READY = "module_ready",
    HEALTH_RESPONSE = "health_response",
    CONFIG_UPDATE = "config_update"
}
export declare enum MessagePriority {
    LOW = 0,
    NORMAL = 1,
    HIGH = 2,
    CRITICAL = 3
}
export interface Message<T = any> {
    id: string;
    type: MessageType;
    topic: string;
    payload: T;
    priority: MessagePriority;
    timestamp: number;
    source: string;
    destination?: string;
    correlationId?: string;
    replyTo?: string;
    ttl?: number;
    retries?: number;
    header?: Record<string, any>;
}
export declare class MessageFactory {
    static create(type: MessageType, topic: string, payload: any, source: string): Message;
    static createCommand(topic: string, payload: any, source: string): Message;
    static createEvent(topic: string, payload: any, source: string): Message;
    static createQuery(topic: string, payload: any, source: string): Message;
}
export declare enum RecoveryActionType {
    RESTART = "restart",
    SCALE = "scale",
    FAILOVER = "failover",
    ROLLBACK = "rollback",
    NOTIFY = "notify",
    RESET = "reset",
    ALERT_ONLY = "alert_only",
    RELOAD = "reload",
    CIRCUIT_BREAK = "circuit_break",
    SCALE_DOWN = "scale_down"
}
export interface RecoveryAction {
    id?: string;
    type: RecoveryActionType;
    module: string;
    action?: string;
    reason?: string;
    config: RecoveryActionConfig;
    timestamp: number;
    attempts?: number;
    status: 'pending' | 'executing' | 'completed' | 'failed';
    success?: boolean;
    result?: any;
    error?: string;
}
export interface RecoveryActionConfig {
    maxRetries?: number;
    retryDelay?: number;
    timeout?: number;
    rollbackOnFailure?: boolean;
    notifyOnCompletion?: boolean;
}
export interface RecoveryStrategy {
    name: string;
    module?: string;
    triggers: RecoveryTrigger[];
    actions: (RecoveryActionType | {
        type: RecoveryActionType;
        priority?: number;
        delay?: number;
        timeout?: number;
    })[];
    maxAttempts?: number;
    backoffMultiplier?: number;
    cooldownPeriod?: number;
    priority: number;
    enabled: boolean;
}
export interface RecoveryTrigger {
    type: 'health' | 'metric' | 'error' | 'manual' | 'error_rate' | 'latency' | 'memory' | 'cpu' | 'custom';
    condition?: string;
    threshold?: number;
    duration?: number;
    comparison?: '>' | '<' | '>=' | '<=' | '==' | '!=';
}
export interface ModuleRegistration {
    name: string;
    moduleId?: string;
    version: string;
    dependencies: string[];
    capabilities?: string[];
    endpoints?: {
        health?: string;
        metrics?: string;
        api?: string;
    };
    config: ModuleConfig;
    healthCheck?: () => Promise<HealthCheckResult>;
    initialize?: () => Promise<void>;
    shutdown?: () => Promise<void>;
}
export type MessageHandler = (message: Message) => Promise<void>;
export interface Route {
    pattern?: string | RegExp;
    handler?: MessageHandler;
    priority?: MessagePriority;
    source?: string | RegExp;
    destination?: string | string[];
    messageTypes?: MessageType[];
    filter?: (message: Message) => boolean;
    transform?: (message: Message) => Message;
}
export interface MessageStats {
    sent: number;
    received: number;
    failed?: number;
    avgLatency: number;
    maxLatency?: number;
    minLatency?: number;
    p99Latency?: number;
    lastActivity?: number;
    errors?: number;
    lastError?: string;
}
export interface RouteMetrics {
    route: string;
    messagesHandled: number;
    messageCount?: number;
    avgLatency: number;
    maxLatency?: number;
    p50Latency?: number;
    p95Latency?: number;
    p99Latency?: number;
    errors: number;
    lastUsed: number;
    lastUpdated?: number;
}
export interface MessageBusEvents {
    messageSent: (message: Message) => void;
    messageReceived: (message: Message) => void;
    messageFailed: (message: Message, error: Error) => void;
    routeAdded: (route: Route) => void;
    routeRemoved: (route: string) => void;
}
export interface ServiceHealthStatus {
    healthy: boolean;
    timestamp: number;
    services: Record<string, boolean>;
    errors?: string[];
}
export type { ServiceHealthStatus as HealthStatusLegacy };
/**
 * Node types in the Noderr network
 */
export declare enum NodeType {
    ORACLE = "ORACLE",
    GUARDIAN = "GUARDIAN",
    VALIDATOR = "VALIDATOR"
}
/**
 * Node configuration based on type
 */
export interface NodeTypeConfig {
    type: NodeType;
    capabilities: string[];
    requiredStake: number;
    rewardMultiplier: number;
    maxConcurrentOperations: number;
    priority: number;
}
/**
 * Node registration information
 */
export interface NodeRegistration {
    nodeId: string;
    type: NodeType;
    publicKey: string;
    walletAddress: string;
    nftTokenId?: string;
    stakeAmount: number;
    status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
    registeredAt: number;
    activatedAt?: number;
    metadata?: Record<string, any>;
}
/**
 * Oracle node specific configuration
 */
export interface OracleNodeConfig extends NodeTypeConfig {
    type: NodeType.ORACLE;
    dataFeeds: string[];
    updateInterval: number;
    aggregationMethod: 'MEDIAN' | 'MEAN' | 'VWAP';
}
/**
 * Guardian node specific configuration
 */
export interface GuardianNodeConfig extends NodeTypeConfig {
    type: NodeType.GUARDIAN;
    monitoringInterval: number;
    alertThresholds: {
        maxDrawdown: number;
        maxPositionSize: number;
        maxDailyLoss: number;
        minLiquidity: number;
    };
    emergencyActions: string[];
}
/**
 * Validator node specific configuration
 */
export interface ValidatorNodeConfig extends NodeTypeConfig {
    type: NodeType.VALIDATOR;
    consensusAlgorithm: 'BFT' | 'PBFT' | 'RAFT';
    votingPower: number;
    blockProposalInterval: number;
    minValidatorStake: number;
}
/**
 * Node function definition
 */
export interface NodeFunction {
    id: string;
    name: string;
    description: string;
    nodeType: NodeType;
    category: string;
    priority: number;
    requiredPermissions: string[];
    estimatedExecutionTime: number;
    enabled: boolean;
}
/**
 * Node function execution result
 */
export interface NodeFunctionResult {
    functionId: string;
    nodeId: string;
    success: boolean;
    result?: any;
    error?: string;
    executionTime: number;
    timestamp: number;
}
/**
 * Inter-node coordination message
 */
export interface CoordinationMessage {
    id: string;
    from: string;
    to: string | string[];
    type: 'REQUEST' | 'RESPONSE' | 'BROADCAST' | 'ALERT';
    payload: any;
    timestamp: number;
    signature: string;
}
/**
 * Node health status
 */
export interface NodeHealthStatus {
    nodeId: string;
    nodeType: NodeType;
    status: HealthStatus;
    uptime: number;
    lastHeartbeat: number;
    activeFunctions: number;
    queuedTasks: number;
    metrics: {
        cpu: number;
        memory: number;
        network: number;
        disk: number;
    };
}
/**
 * User application from Typeform
 */
export interface UserApplication {
    id: string;
    typeformResponseId: string;
    email: string;
    walletAddress: string;
    requestedNodeType: NodeType;
    stakeAmount: number;
    experience: string;
    motivation: string;
    rpcEndpoint?: string;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    submittedAt: number;
    reviewedAt?: number;
    reviewedBy?: string;
    rejectionReason?: string;
    metadata?: Record<string, any>;
}
/**
 * Utility NFT information
 */
export interface UtilityNFT {
    tokenId: string;
    contractAddress: string;
    owner: string;
    nodeType: NodeType;
    nodeId?: string;
    stakeAmount: number;
    mintedAt: number;
    activatedAt?: number;
    expiresAt?: number;
    metadata: {
        name: string;
        description: string;
        image: string;
        attributes: Array<{
            trait_type: string;
            value: string | number;
        }>;
    };
}
/**
 * Node credentials (encrypted)
 */
export interface NodeCredentials {
    nodeId: string;
    nftTokenId: string;
    privateKey: string;
    publicKey: string;
    apiKeys: Record<string, string>;
    exchangeCredentials: Record<string, ExchangeCredentials>;
    createdAt: number;
    lastRotated?: number;
}
/**
 * Exchange credentials
 */
export interface ExchangeCredentials {
    apiKey: string;
    apiSecret: string;
    passphrase?: string;
    testnet?: boolean;
}
/**
 * Authorization record
 */
export interface Authorization {
    id: string;
    applicationId: string;
    authorizedBy: string;
    nftTokenId?: string;
    nodeId?: string;
    authorizedAt: number;
    expiresAt?: number;
    revoked: boolean;
    revokedAt?: number;
    revokedBy?: string;
    revokedReason?: string;
}
//# sourceMappingURL=index.d.ts.map