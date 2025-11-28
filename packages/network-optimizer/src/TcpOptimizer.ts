import * as net from 'net';
import { EventEmitter } from 'events';

/**
 * TCP optimization settings for ultra-low latency
 */
export interface TcpOptimizationConfig {
  // Disable Nagle's algorithm for immediate packet sending
  noDelay: boolean;
  // Keep-alive settings
  keepAlive: boolean;
  keepAliveInitialDelay: number;
  // Socket buffer sizes
  sendBufferSize?: number;
  receiveBufferSize?: number;
  // Connection timeout
  timeout: number;
  // Enable TCP Fast Open (Linux)
  tcpFastOpen?: boolean;
  // Set socket priority (Linux)
  socketPriority?: number;
}

/**
 * Optimized TCP client for low-latency trading connections
 */
export class OptimizedTcpClient extends EventEmitter {
  private socket: net.Socket | null = null;
  private config: TcpOptimizationConfig;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private messageBuffer: Buffer = Buffer.alloc(0);
  
  constructor(config: Partial<TcpOptimizationConfig> = {}) {
    super();
    
    this.config = {
      noDelay: true,
      keepAlive: true,
      keepAliveInitialDelay: 1000,
      timeout: 5000,
      ...config
    };
  }
  
  /**
   * Connect to a TCP server with optimized settings
   */
  connect(host: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = new net.Socket();
      
      // Apply optimizations before connecting
      this.applySocketOptimizations(this.socket);
      
      // Set up event handlers
      this.socket.once('connect', () => {
        this.emit('connected');
        resolve();
      });
      
      this.socket.once('error', (error) => {
        this.emit('error', error);
        reject(error);
      });
      
      this.socket.on('data', (data) => {
        this.handleData(data);
      });
      
      this.socket.on('close', () => {
        this.emit('disconnected');
        this.scheduleReconnect(host, port);
      });
      
      // Connect
      this.socket.connect(port, host);
    });
  }
  
  /**
   * Apply socket optimizations
   */
  private applySocketOptimizations(socket: net.Socket): void {
    // Disable Nagle's algorithm
    socket.setNoDelay(this.config.noDelay);
    
    // Enable keep-alive
    socket.setKeepAlive(
      this.config.keepAlive,
      this.config.keepAliveInitialDelay
    );
    
    // Set timeout
    socket.setTimeout(this.config.timeout);
    
    // Set buffer sizes if specified
    if (this.config.sendBufferSize) {
      // Note: This requires platform-specific implementation
      // socket.setSendBufferSize(this.config.sendBufferSize);
    }
    
    if (this.config.receiveBufferSize) {
      // Note: This requires platform-specific implementation
      // socket.setRecvBufferSize(this.config.receiveBufferSize);
    }
  }
  
  /**
   * Send data with minimal latency
   */
  send(data: Buffer): boolean {
    if (!this.socket || this.socket.destroyed) {
      return false;
    }
    
    // Write directly to socket without buffering
    return this.socket.write(data);
  }
  
  /**
   * Send with callback for write confirmation
   */
  sendWithCallback(data: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.socket || this.socket.destroyed) {
        reject(new Error('Socket not connected'));
        return;
      }
      
      this.socket.write(data, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }
  
  /**
   * Handle incoming data
   */
  private handleData(data: Buffer): void {
    // Emit raw data for minimal processing latency
    this.emit('data', data);
    
    // Also handle message framing if needed
    this.messageBuffer = Buffer.concat([this.messageBuffer, data]);
    this.processMessageBuffer();
  }
  
  /**
   * Process buffered messages (implement your protocol here)
   */
  private processMessageBuffer(): void {
    // Example: Fixed-length header protocol
    const HEADER_SIZE = 4;
    
    while (this.messageBuffer.length >= HEADER_SIZE) {
      // Read message length from header
      const messageLength = this.messageBuffer.readUInt32LE(0);
      
      if (this.messageBuffer.length >= HEADER_SIZE + messageLength) {
        // Extract complete message
        const message = this.messageBuffer.slice(
          HEADER_SIZE,
          HEADER_SIZE + messageLength
        );
        
        // Emit the message
        this.emit('message', message);
        
        // Remove processed data from buffer
        this.messageBuffer = this.messageBuffer.slice(
          HEADER_SIZE + messageLength
        );
      } else {
        // Wait for more data
        break;
      }
    }
  }
  
  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(host: string, port: number): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    
    this.reconnectTimer = setTimeout(() => {
      this.emit('reconnecting');
      this.connect(host, port).catch(() => {
        // Reconnection failed, will retry
      });
    }, 1000);
  }
  
  /**
   * Disconnect and cleanup
   */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
  }
  
  /**
   * Get connection statistics
   */
  getStats(): ConnectionStats {
    if (!this.socket) {
      return {
        connected: false,
        bytesRead: 0,
        bytesWritten: 0,
        localAddress: '',
        remoteAddress: ''
      };
    }
    
    return {
      connected: !this.socket.destroyed,
      bytesRead: this.socket.bytesRead,
      bytesWritten: this.socket.bytesWritten,
      localAddress: this.socket.localAddress || '',
      remoteAddress: this.socket.remoteAddress || ''
    };
  }
}

/**
 * Connection statistics
 */
export interface ConnectionStats {
  connected: boolean;
  bytesRead: number;
  bytesWritten: number;
  localAddress: string;
  remoteAddress: string;
}

/**
 * Create an optimized TCP server
 */
export class OptimizedTcpServer extends EventEmitter {
  private server: net.Server | null = null;
  private config: TcpOptimizationConfig;
  private clients: Set<net.Socket> = new Set();
  
  constructor(config: Partial<TcpOptimizationConfig> = {}) {
    super();
    
    this.config = {
      noDelay: true,
      keepAlive: true,
      keepAliveInitialDelay: 1000,
      timeout: 5000,
      ...config
    };
  }
  
  /**
   * Start listening for connections
   */
  listen(port: number, host: string = '0.0.0.0'): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        this.handleClient(socket);
      });
      
      this.server.once('listening', () => {
        this.emit('listening', port, host);
        resolve();
      });
      
      this.server.once('error', (error) => {
        this.emit('error', error);
        reject(error);
      });
      
      this.server.listen(port, host);
    });
  }
  
  /**
   * Handle new client connection
   */
  private handleClient(socket: net.Socket): void {
    // Apply optimizations
    socket.setNoDelay(this.config.noDelay);
    socket.setKeepAlive(
      this.config.keepAlive,
      this.config.keepAliveInitialDelay
    );
    socket.setTimeout(this.config.timeout);
    
    // Track client
    this.clients.add(socket);
    
    // Emit new client event
    this.emit('client', socket);
    
    // Handle client disconnect
    socket.once('close', () => {
      this.clients.delete(socket);
      this.emit('clientDisconnected', socket);
    });
  }
  
  /**
   * Broadcast to all connected clients
   */
  broadcast(data: Buffer): void {
    for (const client of this.clients) {
      if (!client.destroyed) {
        client.write(data);
      }
    }
  }
  
  /**
   * Stop the server
   */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      
      // Disconnect all clients
      for (const client of this.clients) {
        client.destroy();
      }
      this.clients.clear();
      
      // Close server
      this.server.close(() => {
        this.server = null;
        resolve();
      });
    });
  }
} 