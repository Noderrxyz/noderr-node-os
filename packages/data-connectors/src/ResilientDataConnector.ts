/**
 * ResilientDataConnector - Enterprise-grade base class for data connectors
 * 
 * Features:
 * - Exponential backoff with jitter
 * - Infinite retry with circuit breaker protection
 * - Connection pooling support
 * - Comprehensive telemetry
 * - Graceful degradation
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';

export interface ConnectionMetrics {
  connected: boolean;
  uptime: number;
  reconnects: number;
  consecutiveFailures: number;
  totalFailures: number;
  messagesReceived: number;
  lastMessage: number;
  latency: number;
  errors: number;
  bytesReceived: number;
  bytesSent: number;
  avgReconnectTime: number;
  maxReconnectTime: number;
  connectionQuality: number; // 0-100 score
}

export interface ReconnectionConfig {
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  jitterFactor: number;
  maxConsecutiveFailures: number;
  circuitBreakerThreshold: number;
  circuitBreakerResetTime: number;
  connectionTimeout: number;
  heartbeatInterval: number;
  staleConnectionThreshold: number;
}

export interface ConnectorConfig {
  url: string;
  name: string;
  reconnection?: Partial<ReconnectionConfig>;
  poolSize?: number;
  enableCompression?: boolean;
  enableTelemetry?: boolean;
}

interface ConnectionAttempt {
  attemptNumber: number;
  timestamp: number;
  duration: number;
  success: boolean;
  error?: string;
}

export abstract class ResilientDataConnector extends EventEmitter {
  protected ws: WebSocket | null = null;
  protected connectionPool: WebSocket[] = [];
  protected config: ConnectorConfig;
  protected reconnectionConfig: ReconnectionConfig;
  protected metrics: ConnectionMetrics;
  
  private isConnected: boolean = false;
  private reconnectAttempts: number = 0;
  private consecutiveFailures: number = 0;
  private heartbeatTimer?: NodeJS.Timeout;
  private reconnectTimer?: NodeJS.Timeout;
  private circuitBreakerTimer?: NodeJS.Timeout;
  private circuitBreakerOpen: boolean = false;
  private connectionAttempts: ConnectionAttempt[] = [];
  private reconnectStartTime: number = 0;
  
  constructor(config: ConnectorConfig) {
    super();
    this.config = config;
    
    // Set default reconnection config with provided overrides
    this.reconnectionConfig = {
      initialDelay: 1000,
      maxDelay: 300000, // 5 minutes
      backoffMultiplier: 1.5,
      jitterFactor: 0.3,
      maxConsecutiveFailures: 10,
      circuitBreakerThreshold: 50,
      circuitBreakerResetTime: 300000, // 5 minutes
      connectionTimeout: 30000,
      heartbeatInterval: 30000,
      staleConnectionThreshold: 60000,
      ...config.reconnection
    };
    
    this.metrics = this.initializeMetrics();
  }
  
  private initializeMetrics(): ConnectionMetrics {
    return {
      connected: false,
      uptime: 0,
      reconnects: 0,
      consecutiveFailures: 0,
      totalFailures: 0,
      messagesReceived: 0,
      lastMessage: Date.now(),
      latency: 0,
      errors: 0,
      bytesReceived: 0,
      bytesSent: 0,
      avgReconnectTime: 0,
      maxReconnectTime: 0,
      connectionQuality: 100
    };
  }
  
  /**
   * Connect with resilient retry logic
   */
  public async connect(): Promise<void> {
    if (this.circuitBreakerOpen) {
      throw new Error('Circuit breaker is open - connection attempts blocked');
    }
    
    this.log('info', 'Initiating connection', {
      url: this.config.url,
      poolSize: this.config.poolSize || 1
    });
    
    try {
      await this.establishConnection();
      await this.onConnected();
      this.startHeartbeat();
      
      // Reset failure counters on successful connection
      this.consecutiveFailures = 0;
      this.metrics.consecutiveFailures = 0;
      this.updateConnectionQuality();
      
      this.emit('connected', {
        timestamp: Date.now(),
        reconnectAttempts: this.reconnectAttempts,
        metrics: this.getMetrics()
      });
      
    } catch (error) {
      this.handleConnectionFailure(error);
      throw error;
    }
  }
  
  /**
   * Establish WebSocket connection with timeout
   */
  private async establishConnection(): Promise<void> {
    const attemptStart = Date.now();
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, this.reconnectionConfig.connectionTimeout);
      
      try {
        const ws = new WebSocket(this.config.url, {
          perMessageDeflate: this.config.enableCompression
        });
        
        ws.on('open', () => {
          clearTimeout(timeout);
          this.isConnected = true;
          this.metrics.connected = true;
          this.ws = ws;
          
          // Record successful attempt
          this.recordConnectionAttempt(attemptStart, true);
          
          // Set up message handlers
          this.setupWebSocketHandlers(ws);
          
          resolve();
        });
        
        ws.on('error', (error) => {
          clearTimeout(timeout);
          this.recordConnectionAttempt(attemptStart, false, error.message);
          reject(error);
        });
        
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    });
  }
  
  /**
   * Set up WebSocket event handlers
   */
  private setupWebSocketHandlers(ws: WebSocket): void {
    ws.on('message', (data: WebSocket.Data) => {
      this.metrics.messagesReceived++;
      this.metrics.lastMessage = Date.now();
      this.metrics.bytesReceived += data.toString().length;
      
      try {
        this.handleMessage(data);
      } catch (error) {
        this.log('error', 'Failed to handle message', error);
        this.metrics.errors++;
      }
    });
    
    ws.on('error', (error: Error) => {
      this.log('error', 'WebSocket error', error);
      this.metrics.errors++;
      this.emit('error', error);
    });
    
    ws.on('close', (code: number, reason: string) => {
      this.log('warn', 'WebSocket closed', { code, reason });
      this.handleDisconnection();
    });
    
    ws.on('ping', () => {
      ws.pong();
      this.updateLatency();
    });
    
    ws.on('pong', () => {
      this.updateLatency();
    });
  }
  
  /**
   * Handle connection failure with telemetry
   */
  private handleConnectionFailure(error: any): void {
    this.consecutiveFailures++;
    this.metrics.consecutiveFailures = this.consecutiveFailures;
    this.metrics.totalFailures++;
    this.metrics.errors++;
    
    this.emit('connection-failure', {
      error: error.message,
      consecutiveFailures: this.consecutiveFailures,
      totalFailures: this.metrics.totalFailures,
      timestamp: Date.now()
    });
    
    // Check circuit breaker
    if (this.consecutiveFailures >= this.reconnectionConfig.circuitBreakerThreshold) {
      this.openCircuitBreaker();
    }
  }
  
  /**
   * Handle disconnection and schedule reconnect
   */
  private handleDisconnection(): void {
    this.isConnected = false;
    this.metrics.connected = false;
    const downtime = Date.now();
    
    // Clean up
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws = null;
    }
    
    this.emit('disconnected', {
      timestamp: downtime,
      uptime: this.metrics.uptime,
      metrics: this.getMetrics()
    });
    
    // Schedule reconnection with backoff
    this.scheduleReconnection();
  }
  
  /**
   * Schedule reconnection with exponential backoff and jitter
   */
  private scheduleReconnection(): void {
    if (this.circuitBreakerOpen) {
      this.log('warn', 'Circuit breaker open - skipping reconnection');
      return;
    }
    
    this.reconnectAttempts++;
    this.metrics.reconnects++;
    
    // Calculate delay with exponential backoff
    const baseDelay = Math.min(
      this.reconnectionConfig.initialDelay * Math.pow(
        this.reconnectionConfig.backoffMultiplier,
        Math.min(this.reconnectAttempts - 1, 10) // Cap exponential growth
      ),
      this.reconnectionConfig.maxDelay
    );
    
    // Add jitter to prevent thundering herd
    const jitter = baseDelay * this.reconnectionConfig.jitterFactor * (Math.random() - 0.5);
    const delay = Math.max(0, baseDelay + jitter);
    
    this.log('info', 'Scheduling reconnection', {
      attempt: this.reconnectAttempts,
      delay: Math.round(delay),
      consecutiveFailures: this.consecutiveFailures
    });
    
    this.emit('reconnection-scheduled', {
      attempt: this.reconnectAttempts,
      delay,
      timestamp: Date.now()
    });
    
    this.reconnectStartTime = Date.now();
    this.reconnectTimer = setTimeout(() => {
      this.reconnect();
    }, delay);
  }
  
  /**
   * Attempt to reconnect
   */
  private async reconnect(): Promise<void> {
    this.log('info', 'Attempting reconnection', {
      attempt: this.reconnectAttempts,
      consecutiveFailures: this.consecutiveFailures
    });
    
    try {
      await this.connect();
      
      // Update reconnection metrics
      const reconnectTime = Date.now() - this.reconnectStartTime;
      this.updateReconnectionMetrics(reconnectTime);
      
      this.emit('reconnected', {
        attempt: this.reconnectAttempts,
        duration: reconnectTime,
        timestamp: Date.now()
      });
      
      // Reset reconnect attempts on success
      this.reconnectAttempts = 0;
      
    } catch (error) {
      this.log('error', 'Reconnection failed', error);
      this.handleDisconnection();
    }
  }
  
  /**
   * Start heartbeat monitoring
   */
  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (!this.ws || !this.isConnected) return;
      
      // Send ping
      this.ws.ping();
      
      // Check for stale connection
      const timeSinceLastMessage = Date.now() - this.metrics.lastMessage;
      if (timeSinceLastMessage > this.reconnectionConfig.staleConnectionThreshold) {
        this.log('warn', 'Connection appears stale - forcing reconnection', {
          lastMessage: timeSinceLastMessage
        });
        
        this.emit('stale-connection', {
          timeSinceLastMessage,
          timestamp: Date.now()
        });
        
        // Force reconnection
        this.ws.terminate();
      }
    }, this.reconnectionConfig.heartbeatInterval);
  }
  
  /**
   * Stop heartbeat monitoring
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }
  
  /**
   * Open circuit breaker to prevent excessive reconnection attempts
   */
  private openCircuitBreaker(): void {
    this.circuitBreakerOpen = true;
    
    this.log('error', 'Circuit breaker opened - blocking connections', {
      failures: this.consecutiveFailures,
      resetTime: this.reconnectionConfig.circuitBreakerResetTime
    });
    
    this.emit('circuit-breaker-open', {
      failures: this.consecutiveFailures,
      resetTime: this.reconnectionConfig.circuitBreakerResetTime,
      timestamp: Date.now()
    });
    
    // Schedule circuit breaker reset
    this.circuitBreakerTimer = setTimeout(() => {
      this.resetCircuitBreaker();
    }, this.reconnectionConfig.circuitBreakerResetTime);
  }
  
  /**
   * Reset circuit breaker
   */
  private resetCircuitBreaker(): void {
    this.circuitBreakerOpen = false;
    this.consecutiveFailures = 0;
    this.metrics.consecutiveFailures = 0;
    
    this.log('info', 'Circuit breaker reset - connections allowed');
    
    this.emit('circuit-breaker-reset', {
      timestamp: Date.now()
    });
    
    // Attempt to reconnect
    this.scheduleReconnection();
  }
  
  /**
   * Update latency metrics
   */
  private updateLatency(): void {
    const latency = Date.now() - this.metrics.lastMessage;
    this.metrics.latency = latency;
    
    this.emit('latency-update', {
      latency,
      timestamp: Date.now()
    });
  }
  
  /**
   * Update connection quality score
   */
  private updateConnectionQuality(): void {
    // Calculate quality based on various factors
    let quality = 100;
    
    // Deduct for errors
    quality -= Math.min(this.metrics.errors * 2, 30);
    
    // Deduct for high latency
    if (this.metrics.latency > 1000) quality -= 10;
    if (this.metrics.latency > 5000) quality -= 20;
    
    // Deduct for reconnections
    quality -= Math.min(this.metrics.reconnects * 5, 30);
    
    // Deduct for consecutive failures
    quality -= this.metrics.consecutiveFailures * 10;
    
    this.metrics.connectionQuality = Math.max(0, quality);
  }
  
  /**
   * Record connection attempt for metrics
   */
  private recordConnectionAttempt(startTime: number, success: boolean, error?: string): void {
    const attempt: ConnectionAttempt = {
      attemptNumber: this.reconnectAttempts + 1,
      timestamp: startTime,
      duration: Date.now() - startTime,
      success,
      error
    };
    
    this.connectionAttempts.push(attempt);
    
    // Keep only last 100 attempts
    if (this.connectionAttempts.length > 100) {
      this.connectionAttempts.shift();
    }
  }
  
  /**
   * Update reconnection metrics
   */
  private updateReconnectionMetrics(duration: number): void {
    // Update max reconnection time
    if (duration > this.metrics.maxReconnectTime) {
      this.metrics.maxReconnectTime = duration;
    }
    
    // Update average reconnection time
    const successfulAttempts = this.connectionAttempts.filter(a => a.success);
    if (successfulAttempts.length > 0) {
      const totalTime = successfulAttempts.reduce((sum, a) => sum + a.duration, 0);
      this.metrics.avgReconnectTime = totalTime / successfulAttempts.length;
    }
  }
  
  /**
   * Get current metrics
   */
  public getMetrics(): ConnectionMetrics {
    return {
      ...this.metrics,
      uptime: this.isConnected ? Date.now() - this.metrics.lastMessage : 0
    };
  }
  
  /**
   * Check if connection is healthy
   */
  public isHealthy(): boolean {
    return this.isConnected && 
           !this.circuitBreakerOpen &&
           this.metrics.connectionQuality > 50 &&
           (Date.now() - this.metrics.lastMessage) < this.reconnectionConfig.staleConnectionThreshold;
  }
  
  /**
   * Graceful disconnect
   */
  public async disconnect(): Promise<void> {
    this.log('info', 'Disconnecting gracefully');
    
    // Stop reconnection attempts
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    
    // Stop circuit breaker timer
    if (this.circuitBreakerTimer) {
      clearTimeout(this.circuitBreakerTimer);
      this.circuitBreakerTimer = undefined;
    }
    
    // Stop heartbeat
    this.stopHeartbeat();
    
    // Close WebSocket
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close(1000, 'Normal closure');
      this.ws = null;
    }
    
    // Close connection pool
    for (const ws of this.connectionPool) {
      ws.removeAllListeners();
      ws.close(1000, 'Normal closure');
    }
    this.connectionPool = [];
    
    this.isConnected = false;
    this.metrics.connected = false;
    
    this.emit('shutdown', {
      timestamp: Date.now(),
      metrics: this.getMetrics()
    });
  }
  
  /**
   * Send data with telemetry
   */
  protected send(data: any): void {
    if (!this.ws || !this.isConnected) {
      throw new Error('Not connected');
    }
    
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    this.ws.send(payload);
    this.metrics.bytesSent += payload.length;
  }
  
  /**
   * Logging with telemetry
   */
  protected log(level: 'info' | 'warn' | 'error' | 'debug', message: string, meta?: any): void {
    const logEntry = {
      timestamp: new Date().toISOString(),
      connector: this.config.name,
      level,
      message,
      ...meta
    };
    
    // Emit telemetry event
    if (this.config.enableTelemetry) {
      this.emit('telemetry:log', logEntry);
    }
    
    // Console logging
    console[level](`[${this.config.name}] ${message}`, meta || '');
  }
  
  // Abstract methods to be implemented by subclasses
  protected abstract handleMessage(data: WebSocket.Data): void;
  protected abstract onConnected(): Promise<void>;
} 