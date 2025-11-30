"use strict";
/**
 * LogBridge - Centralized structured logging system
 *
 * Provides unified logging with correlation IDs, JSON formatting,
 * and streaming to multiple outputs including Loki and S3.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LogBridge = void 0;
const events_1 = require("events");
const winston_1 = __importStar(require("winston"));
const winston_loki_1 = __importDefault(require("winston-loki"));
const client_s3_1 = require("@aws-sdk/client-s3");
const zlib_1 = require("zlib");
const path = __importStar(require("path"));
const fs = __importStar(require("fs/promises"));
const telemetry_1 = require("../types/telemetry");
class LogBridge extends events_1.EventEmitter {
    config;
    logger;
    buffer = [];
    flushTimer;
    s3Client;
    lokiTransport;
    fileStream;
    currentLogFile;
    traceContext;
    correlationId;
    constructor(config) {
        super();
        this.config = {
            level: telemetry_1.LogLevel.INFO,
            format: 'json',
            outputs: [{ type: 'console', config: {} }],
            correlationIdHeader: 'x-correlation-id',
            bufferSize: 1000,
            flushInterval: 5000,
            fields: {},
            retentionDays: 30,
            ...config
        };
        this.logger = this.createLogger();
        this.setupOutputs();
        this.startFlushTimer();
    }
    /**
     * Start the log bridge
     */
    async start() {
        this.logger.info('Starting LogBridge', {
            outputs: this.config.outputs.map(o => o.type),
            level: this.config.level
        });
    }
    /**
     * Stop the log bridge
     */
    async stop() {
        this.logger.info('Stopping LogBridge');
        // Stop flush timer
        if (this.flushTimer) {
            clearInterval(this.flushTimer);
            this.flushTimer = undefined;
        }
        // Flush remaining logs
        await this.flush();
        // Close file stream
        if (this.fileStream) {
            await new Promise((resolve, reject) => {
                this.fileStream.end((err) => {
                    if (err)
                        reject(err);
                    else
                        resolve();
                });
            });
        }
        // Close logger
        this.logger.close();
    }
    /**
     * Log a message
     */
    log(level, module, message, metadata) {
        const entry = {
            timestamp: new Date().toISOString(),
            level,
            module,
            message,
            correlationId: this.correlationId,
            traceId: this.traceContext?.traceId,
            spanId: this.traceContext?.spanId,
            metadata: {
                ...this.config.fields,
                ...metadata
            }
        };
        // Handle errors specially
        if (metadata?.error instanceof Error) {
            entry.error = {
                name: metadata.error.name,
                message: metadata.error.message,
                stack: metadata.error.stack
            };
            delete entry.metadata.error;
        }
        // Format entry
        const formatted = this.formatEntry(entry);
        // Add to buffer
        this.buffer.push({
            entry,
            formatted,
            timestamp: Date.now()
        });
        // Log through Winston
        this.logger.log(level, formatted, entry);
        // Emit event
        this.emit('log:written', entry);
        // Check buffer size
        if (this.buffer.length >= this.config.bufferSize) {
            this.flush().catch(err => console.error('Failed to flush logs:', err));
        }
    }
    /**
     * Set correlation ID
     */
    setCorrelationId(id) {
        this.correlationId = id;
    }
    /**
     * Set trace context
     */
    setTraceContext(context) {
        this.traceContext = context;
    }
    /**
     * Create logger methods
     */
    debug(module, message, metadata) {
        this.log(telemetry_1.LogLevel.DEBUG, module, message, metadata);
    }
    info(module, message, metadata) {
        this.log(telemetry_1.LogLevel.INFO, module, message, metadata);
    }
    warn(module, message, metadata) {
        this.log(telemetry_1.LogLevel.WARN, module, message, metadata);
    }
    error(module, message, metadata) {
        this.log(telemetry_1.LogLevel.ERROR, module, message, metadata);
    }
    fatal(module, message, metadata) {
        this.log(telemetry_1.LogLevel.FATAL, module, message, metadata);
    }
    /**
     * Flush buffered logs
     */
    async flush() {
        if (this.buffer.length === 0)
            return;
        const logsToFlush = [...this.buffer];
        this.buffer = [];
        try {
            // Write to S3 if configured
            const s3Output = this.config.outputs.find(o => o.type === 's3');
            if (s3Output && this.s3Client) {
                await this.writeToS3(logsToFlush, s3Output);
            }
            // Write to file if configured
            const fileOutput = this.config.outputs.find(o => o.type === 'file');
            if (fileOutput && this.fileStream) {
                await this.writeToFile(logsToFlush);
            }
            this.emit('log:flushed', logsToFlush.length);
        }
        catch (error) {
            // Re-add logs to buffer on failure
            this.buffer.unshift(...logsToFlush);
            throw error;
        }
    }
    /**
     * Private: Create Winston logger
     */
    createLogger() {
        const logFormat = this.config.format === 'json'
            ? winston_1.format.json()
            : winston_1.format.combine(winston_1.format.timestamp(), winston_1.format.printf(({ timestamp, level, message }) => `${timestamp} [${level}] ${message}`));
        return winston_1.default.createLogger({
            level: this.config.level,
            format: logFormat,
            defaultMeta: this.config.fields,
            transports: []
        });
    }
    /**
     * Private: Setup output transports
     */
    setupOutputs() {
        for (const output of this.config.outputs) {
            switch (output.type) {
                case 'console':
                    this.logger.add(new winston_1.transports.Console({
                        level: output.level || this.config.level
                    }));
                    break;
                case 'file':
                    this.setupFileOutput(output);
                    break;
                case 'loki':
                    this.setupLokiOutput(output);
                    break;
                case 's3':
                    this.setupS3Output(output);
                    break;
            }
        }
    }
    /**
     * Private: Setup file output
     */
    setupFileOutput(output) {
        const filename = output.config.filename || 'noderr.log';
        const dirname = output.config.dirname || './logs';
        this.logger.add(new winston_1.transports.File({
            filename: path.join(dirname, filename),
            level: output.level || this.config.level,
            maxsize: output.config.maxsize || 10 * 1024 * 1024, // 10MB
            maxFiles: output.config.maxFiles || 10,
            tailable: true
        }));
    }
    /**
     * Private: Setup Loki output
     */
    setupLokiOutput(output) {
        this.lokiTransport = new winston_loki_1.default({
            host: output.config.host || 'http://localhost:3100',
            labels: output.config.labels || { app: 'noderr' },
            json: true,
            interval: output.config.interval || 5,
            timeout: output.config.timeout || 10000,
            onConnectionError: (err) => {
                console.error('Loki connection error:', err);
            }
        });
        this.logger.add(this.lokiTransport);
    }
    /**
     * Private: Setup S3 output
     */
    setupS3Output(output) {
        this.s3Client = new client_s3_1.S3Client({
            region: output.config.region || 'us-east-1',
            credentials: output.config.credentials
        });
    }
    /**
     * Private: Format log entry
     */
    formatEntry(entry) {
        if (this.config.format === 'json') {
            return JSON.stringify(entry);
        }
        let message = `${entry.timestamp} [${entry.level}] [${entry.module}] ${entry.message}`;
        if (entry.correlationId) {
            message += ` [${entry.correlationId}]`;
        }
        if (entry.error) {
            message += `\n${entry.error.stack || entry.error.message}`;
        }
        return message;
    }
    /**
     * Private: Write logs to S3
     */
    async writeToS3(logs, output) {
        const bucket = output.config.bucket;
        const prefix = output.config.prefix || 'logs';
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const key = `${prefix}/${timestamp}.log.gz`;
        // Create gzipped content
        const content = logs.map(l => l.formatted).join('\n');
        const gzip = (0, zlib_1.createGzip)();
        const chunks = [];
        gzip.on('data', chunk => chunks.push(chunk));
        await new Promise((resolve, reject) => {
            gzip.on('end', () => resolve());
            gzip.on('error', reject);
            gzip.end(content);
        });
        const compressed = Buffer.concat(chunks);
        // Upload to S3
        await this.s3Client.send(new client_s3_1.PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: compressed,
            ContentType: 'application/gzip',
            ContentEncoding: 'gzip',
            Metadata: {
                'log-count': logs.length.toString(),
                'start-time': logs[0]?.entry.timestamp || '',
                'end-time': logs[logs.length - 1]?.entry.timestamp || ''
            }
        }));
    }
    /**
     * Private: Write logs to file
     */
    async writeToFile(logs) {
        if (!this.fileStream)
            return;
        const content = logs.map(l => l.formatted).join('\n') + '\n';
        await new Promise((resolve, reject) => {
            this.fileStream.write(content, (err) => {
                if (err)
                    reject(err);
                else
                    resolve();
            });
        });
    }
    /**
     * Private: Start flush timer
     */
    startFlushTimer() {
        this.flushTimer = setInterval(() => this.flush().catch(err => console.error('Failed to flush logs:', err)), this.config.flushInterval);
    }
    /**
     * Private: Rotate log files
     */
    async rotateLogFile() {
        const fileOutput = this.config.outputs.find(o => o.type === 'file');
        if (!fileOutput)
            return;
        const dirname = fileOutput.config.dirname || './logs';
        const maxAge = this.config.retentionDays * 24 * 60 * 60 * 1000;
        const now = Date.now();
        try {
            const files = await fs.readdir(dirname);
            for (const file of files) {
                if (!file.endsWith('.log'))
                    continue;
                const filePath = path.join(dirname, file);
                const stats = await fs.stat(filePath);
                if (now - stats.mtime.getTime() > maxAge) {
                    await fs.unlink(filePath);
                }
            }
        }
        catch (error) {
            console.error('Failed to rotate logs:', error);
        }
    }
}
exports.LogBridge = LogBridge;
//# sourceMappingURL=LogBridge.js.map