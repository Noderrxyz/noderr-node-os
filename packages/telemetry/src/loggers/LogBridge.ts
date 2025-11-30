/**
 * LogBridge - Centralized structured logging system
 * 
 * Provides unified logging with correlation IDs, JSON formatting,
 * and streaming to multiple outputs including Loki and S3.
 */

import { EventEmitter } from 'events';
import winston, { Logger, format, transports } from 'winston';
import LokiTransport from 'winston-loki';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createGzip } from 'zlib';
import { Transform, Writable } from 'stream';
import * as path from 'path';
import * as fs from 'fs/promises';
import {
  LogEntry,
  LogLevel,
  LogConfig,
  LogOutput,
  TelemetryEvents,
  TraceContext
} from '../types/telemetry';

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

interface BufferedLog {
  entry: LogEntry;
  formatted: string;
  timestamp: number;
}

export class LogBridge extends EventEmitter {
  private config: Required<LogBridgeConfig>;
  private logger: Logger;
  private buffer: BufferedLog[] = [];
  private flushTimer: NodeJS.Timeout | undefined;
  private s3Client?: S3Client;
  private lokiTransport?: LokiTransport;
  private fileStream?: Writable;
  private currentLogFile?: string;
  private traceContext?: TraceContext;
  private correlationId?: string;
  
  constructor(config?: LogBridgeConfig) {
    super();
    
    this.config = {
      level: LogLevel.INFO,
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
  async start(): Promise<void> {
    this.logger.info('Starting LogBridge', {
      outputs: this.config.outputs.map(o => o.type),
      level: this.config.level
    });
  }
  
  /**
   * Stop the log bridge
   */
  async stop(): Promise<void> {
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
      await new Promise<void>((resolve, reject) => {
        this.fileStream!.end((err?: Error) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
    
    // Close logger
    this.logger.close();
  }
  
  /**
   * Log a message
   */
  log(level: LogLevel, module: string, message: string, metadata?: Record<string, any>): void {
    const entry: LogEntry = {
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
      delete entry.metadata!.error;
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
      this.flush().catch(err => 
        console.error('Failed to flush logs:', err)
      );
    }
  }
  
  /**
   * Set correlation ID
   */
  setCorrelationId(id: string): void {
    this.correlationId = id;
  }
  
  /**
   * Set trace context
   */
  setTraceContext(context: TraceContext): void {
    this.traceContext = context;
  }
  
  /**
   * Create logger methods
   */
  debug(module: string, message: string, metadata?: Record<string, any>): void {
    this.log(LogLevel.DEBUG, module, message, metadata);
  }
  
  info(module: string, message: string, metadata?: Record<string, any>): void {
    this.log(LogLevel.INFO, module, message, metadata);
  }
  
  warn(module: string, message: string, metadata?: Record<string, any>): void {
    this.log(LogLevel.WARN, module, message, metadata);
  }
  
  error(module: string, message: string, metadata?: Record<string, any>): void {
    this.log(LogLevel.ERROR, module, message, metadata);
  }
  
  fatal(module: string, message: string, metadata?: Record<string, any>): void {
    this.log(LogLevel.FATAL, module, message, metadata);
  }
  
  /**
   * Flush buffered logs
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    
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
    } catch (error) {
      // Re-add logs to buffer on failure
      this.buffer.unshift(...logsToFlush);
      throw error;
    }
  }
  
  /**
   * Private: Create Winston logger
   */
  private createLogger(): Logger {
    const logFormat = this.config.format === 'json'
      ? format.json()
      : format.combine(
          format.timestamp(),
          format.printf(({ timestamp, level, message }) => 
            `${timestamp} [${level}] ${message}`
          )
        );
    
    return winston.createLogger({
      level: this.config.level,
      format: logFormat,
      defaultMeta: this.config.fields,
      transports: []
    });
  }
  
  /**
   * Private: Setup output transports
   */
  private setupOutputs(): void {
    for (const output of this.config.outputs) {
      switch (output.type) {
        case 'console':
          this.logger.add(new transports.Console({
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
  private setupFileOutput(output: LogOutput): void {
    const filename = output.config.filename || 'noderr.log';
    const dirname = output.config.dirname || './logs';
    
    this.logger.add(new transports.File({
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
  private setupLokiOutput(output: LogOutput): void {
    this.lokiTransport = new LokiTransport({
      host: output.config.host || 'http://localhost:3100',
      labels: output.config.labels || { app: 'noderr' },
      json: true,
      interval: output.config.interval || 5,
      timeout: output.config.timeout || 10000,
      onConnectionError: (err: Error) => {
        console.error('Loki connection error:', err);
      }
    });
    
    this.logger.add(this.lokiTransport);
  }
  
  /**
   * Private: Setup S3 output
   */
  private setupS3Output(output: LogOutput): void {
    this.s3Client = new S3Client({
      region: output.config.region || 'us-east-1',
      credentials: output.config.credentials
    });
  }
  
  /**
   * Private: Format log entry
   */
  private formatEntry(entry: LogEntry): string {
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
  private async writeToS3(logs: BufferedLog[], output: LogOutput): Promise<void> {
    const bucket = output.config.bucket;
    const prefix = output.config.prefix || 'logs';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const key = `${prefix}/${timestamp}.log.gz`;
    
    // Create gzipped content
    const content = logs.map(l => l.formatted).join('\n');
    const gzip = createGzip();
    const chunks: Buffer[] = [];
    
    gzip.on('data', chunk => chunks.push(chunk));
    
    await new Promise<void>((resolve, reject) => {
      gzip.on('end', () => resolve());
      gzip.on('error', reject);
      gzip.end(content);
    });
    
    const compressed = Buffer.concat(chunks);
    
    // Upload to S3
    await this.s3Client!.send(new PutObjectCommand({
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
  private async writeToFile(logs: BufferedLog[]): Promise<void> {
    if (!this.fileStream) return;
    
    const content = logs.map(l => l.formatted).join('\n') + '\n';
    
    await new Promise<void>((resolve, reject) => {
      this.fileStream!.write(content, (err?: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
  
  /**
   * Private: Start flush timer
   */
  private startFlushTimer(): void {
    this.flushTimer = setInterval(
      () => this.flush().catch(err => 
        console.error('Failed to flush logs:', err)
      ),
      this.config.flushInterval
    );
  }
  
  /**
   * Private: Rotate log files
   */
  private async rotateLogFile(): Promise<void> {
    const fileOutput = this.config.outputs.find(o => o.type === 'file');
    if (!fileOutput) return;
    
    const dirname = fileOutput.config.dirname || './logs';
    const maxAge = this.config.retentionDays * 24 * 60 * 60 * 1000;
    const now = Date.now();
    
    try {
      const files = await fs.readdir(dirname);
      
      for (const file of files) {
        if (!file.endsWith('.log')) continue;
        
        const filePath = path.join(dirname, file);
        const stats = await fs.stat(filePath);
        
        if (now - stats.mtime.getTime() > maxAge) {
          await fs.unlink(filePath);
        }
      }
    } catch (error) {
      console.error('Failed to rotate logs:', error);
    }
  }
} 