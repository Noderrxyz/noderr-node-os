/**
 * Message Types - Core messaging contracts for inter-module communication
 * 
 * Defines all message types, payloads, and routing information for the
 * ultra-low latency message bus connecting all Noderr Protocol modules.
 */

export enum MessageType {
  // System Messages
  SYSTEM_STARTUP = 'SYSTEM_STARTUP',
  SYSTEM_SHUTDOWN = 'SYSTEM_SHUTDOWN',
  MODULE_REGISTER = 'MODULE_REGISTER',
  MODULE_READY = 'MODULE_READY',
  MODULE_ERROR = 'MODULE_ERROR',
  HEALTH_CHECK = 'HEALTH_CHECK',
  HEALTH_RESPONSE = 'HEALTH_RESPONSE',
  CONFIG_UPDATE = 'CONFIG_UPDATE',
  
  // Trading Messages
  MARKET_DATA = 'MARKET_DATA',
  TRADE_SIGNAL = 'TRADE_SIGNAL',
  ORDER_REQUEST = 'ORDER_REQUEST',
  ORDER_RESPONSE = 'ORDER_RESPONSE',
  EXECUTION_REPORT = 'EXECUTION_REPORT',
  POSITION_UPDATE = 'POSITION_UPDATE',
  RISK_ALERT = 'RISK_ALERT',
  
  // AI/ML Messages
  PREDICTION_REQUEST = 'PREDICTION_REQUEST',
  PREDICTION_RESPONSE = 'PREDICTION_RESPONSE',
  MODEL_UPDATE = 'MODEL_UPDATE',
  PATTERN_DETECTED = 'PATTERN_DETECTED',
  
  // Market Intelligence
  SENTIMENT_UPDATE = 'SENTIMENT_UPDATE',
  WHALE_ALERT = 'WHALE_ALERT',
  ORDERFLOW_UPDATE = 'ORDERFLOW_UPDATE',
  MACRO_EVENT = 'MACRO_EVENT',
  
  // Research Messages
  BACKTEST_REQUEST = 'BACKTEST_REQUEST',
  BACKTEST_RESULT = 'BACKTEST_RESULT',
  OPTIMIZATION_REQUEST = 'OPTIMIZATION_REQUEST',
  OPTIMIZATION_RESULT = 'OPTIMIZATION_RESULT'
}

export enum MessagePriority {
  CRITICAL = 0,    // System failures, emergency stops
  HIGH = 1,        // Trade execution, risk alerts
  NORMAL = 2,      // Market data, predictions
  LOW = 3          // Metrics, non-critical updates
}

export interface MessageHeader {
  id: string;
  type: MessageType;
  source: string;
  destination: string | string[];
  timestamp: number;
  priority: MessagePriority;
  correlationId?: string;
  replyTo?: string;
  ttl?: number; // Time to live in ms
}

export interface Message<T = any> {
  header: MessageHeader;
  payload: T;
  metadata?: {
    version?: string;
    compressed?: boolean;
    encrypted?: boolean;
    retryCount?: number;
    originalTimestamp?: number;
  };
}

// System Message Payloads
export interface ModuleRegistration {
  moduleId: string;
  moduleName: string;
  version: string;
  capabilities: string[];
  dependencies: string[];
  endpoints?: {
    health?: string;
    metrics?: string;
    api?: string;
  };
}

export interface HealthCheckRequest {
  requester: string;
  targetModules?: string[];
  includeMetrics?: boolean;
  timeout?: number;
}

export interface HealthCheckResponse {
  moduleId: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  latency: number;
  uptime: number;
  metrics?: {
    cpu: number;
    memory: number;
    eventLoopLag?: number;
    activeConnections?: number;
  };
  errors?: string[];
}

export interface ConfigUpdatePayload {
  module: string;
  config: Record<string, any>;
  version: string;
  rollbackOnError?: boolean;
  validateOnly?: boolean;
}

// Trading Message Payloads
export interface MarketDataPayload {
  symbol: string;
  exchange: string;
  price: number;
  volume: number;
  bid: number;
  ask: number;
  timestamp: number;
  orderBook?: {
    bids: [number, number][];
    asks: [number, number][];
  };
}

export interface TradeSignalPayload {
  signalId: string;
  strategy: string;
  symbol: string;
  action: 'BUY' | 'SELL' | 'HOLD';
  strength: number; // 0-1
  confidence: number; // 0-1
  timeframe: string;
  metadata?: Record<string, any>;
}

export interface OrderRequestPayload {
  orderId: string;
  signalId?: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  orderType: 'MARKET' | 'LIMIT' | 'STOP' | 'TWAP' | 'VWAP' | 'ICEBERG';
  price?: number;
  timeInForce?: 'IOC' | 'FOK' | 'GTC' | 'GTD';
  params?: Record<string, any>;
}

export interface ExecutionReportPayload {
  orderId: string;
  executionId: string;
  status: 'NEW' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED' | 'REJECTED';
  filledQuantity: number;
  remainingQuantity: number;
  avgPrice: number;
  fees: number;
  slippage: number;
  timestamp: number;
}

// Message Router Types
export interface Route {
  source: string | RegExp;
  destination: string | string[];
  messageTypes?: MessageType[];
  filter?: (message: Message) => boolean;
  transform?: (message: Message) => Message;
  priority?: MessagePriority;
}

export interface MessageStats {
  sent: number;
  received: number;
  avgLatency: number;
  p99Latency: number;
  errors: number;
  lastError?: string;
  lastActivity: number;
}

// Dead Letter Queue
export interface DeadLetterEntry {
  message: Message;
  reason: string;
  retries: number;
  firstFailure: number;
  lastFailure: number;
  error?: Error;
}

// Message Bus Events
export interface MessageBusEvents {
  'message:sent': (message: Message) => void;
  'message:received': (message: Message) => void;
  'message:error': (error: Error, message: Message) => void;
  'message:timeout': (message: Message) => void;
  'message:dead': (entry: DeadLetterEntry) => void;
  'route:added': (route: Route) => void;
  'route:removed': (route: Route) => void;
}

// Utility Types
export type MessageHandler<T = any> = (message: Message<T>) => void | Promise<void>;
export type MessageFilter = (message: Message) => boolean;
export type MessageTransformer = (message: Message) => Message;

// Message Factory
export class MessageFactory {
  static create<T>(
    type: MessageType,
    source: string,
    destination: string | string[],
    payload: T,
    options?: Partial<MessageHeader>
  ): Message<T> {
    return {
      header: {
        id: this.generateId(),
        type,
        source,
        destination,
        timestamp: Date.now(),
        priority: options?.priority || MessagePriority.NORMAL,
        ...options
      },
      payload
    };
  }
  
  static createReply<T>(
    original: Message,
    payload: T,
    type?: MessageType
  ): Message<T> {
    return {
      header: {
        id: this.generateId(),
        type: type || original.header.type,
        source: Array.isArray(original.header.destination) 
          ? original.header.destination[0] 
          : original.header.destination,
        destination: original.header.source,
        timestamp: Date.now(),
        priority: original.header.priority,
        correlationId: original.header.id,
        replyTo: original.header.replyTo
      },
      payload
    };
  }
  
  private static generateId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Performance Monitoring
export interface MessageLatency {
  messageId: string;
  route: string;
  sendTime: number;
  receiveTime: number;
  processTime?: number;
  latency: number;
}

export interface RouteMetrics {
  route: string;
  messageCount: number;
  avgLatency: number;
  p50Latency: number;
  p95Latency: number;
  p99Latency: number;
  maxLatency: number;
  errors: number;
  lastUpdated: number;
} 