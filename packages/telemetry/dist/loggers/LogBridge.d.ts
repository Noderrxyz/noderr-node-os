/**
 * LogBridge - Centralized structured logging system
 *
 * Provides unified logging with correlation IDs, JSON formatting,
 * and streaming to multiple outputs including Loki and S3.
 */
import { EventEmitter } from 'events';
import { LogLevel, LogOutput, TraceContext } from '../types/telemetry';
interface LogBridgeConfig {
    level?: LogLevel;
    format?: 'json' | 'text';
    outputs?: LogOutput[];
    correlationIdHeader?: string;
    bufferSize?: number;
    flushInterval?: number;
    fields?: Record<string, any>;
    retentionDays?: number;
}
export declare class LogBridge extends EventEmitter {
    private config;
    private logger;
    private buffer;
    private flushTimer;
    private s3Client?;
    private lokiTransport?;
    private fileStream?;
    private currentLogFile?;
    private traceContext?;
    private correlationId?;
    constructor(config?: LogBridgeConfig);
    /**
     * Start the log bridge
     */
    start(): Promise<void>;
    /**
     * Stop the log bridge
     */
    stop(): Promise<void>;
    /**
     * Log a message
     */
    log(level: LogLevel, module: string, message: string, metadata?: Record<string, any>): void;
    /**
     * Set correlation ID
     */
    setCorrelationId(id: string): void;
    /**
     * Set trace context
     */
    setTraceContext(context: TraceContext): void;
    /**
     * Create logger methods
     */
    debug(module: string, message: string, metadata?: Record<string, any>): void;
    info(module: string, message: string, metadata?: Record<string, any>): void;
    warn(module: string, message: string, metadata?: Record<string, any>): void;
    error(module: string, message: string, metadata?: Record<string, any>): void;
    fatal(module: string, message: string, metadata?: Record<string, any>): void;
    /**
     * Flush buffered logs
     */
    flush(): Promise<void>;
    /**
     * Private: Create Winston logger
     */
    private createLogger;
    /**
     * Private: Setup output transports
     */
    private setupOutputs;
    /**
     * Private: Setup file output
     */
    private setupFileOutput;
    /**
     * Private: Setup Loki output
     */
    private setupLokiOutput;
    /**
     * Private: Setup S3 output
     */
    private setupS3Output;
    /**
     * Private: Format log entry
     */
    private formatEntry;
    /**
     * Private: Write logs to S3
     */
    private writeToS3;
    /**
     * Private: Write logs to file
     */
    private writeToFile;
    /**
     * Private: Start flush timer
     */
    private startFlushTimer;
    /**
     * Private: Rotate log files
     */
    private rotateLogFile;
}
export {};
//# sourceMappingURL=LogBridge.d.ts.map