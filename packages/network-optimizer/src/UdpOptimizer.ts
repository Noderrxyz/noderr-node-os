import * as dgram from 'dgram';
import { EventEmitter } from 'events';

/**
 * UDP optimization configuration
 */
export interface UdpOptimizationConfig {
  // Socket buffer sizes
  receiveBufferSize?: number;
  sendBufferSize?: number;
  // Multicast settings
  multicastTTL?: number;
  multicastLoopback?: boolean;
  // Performance settings
  reuseAddr?: boolean;
  ipv6Only?: boolean;
}

/**
 * Market data packet structure
 */
export interface MarketDataPacket {
  sequenceNumber: number;
  timestamp: bigint;
  symbol: string;
  bidPrice: number;
  askPrice: number;
  bidSize: number;
  askSize: number;
  lastPrice?: number;
  lastSize?: number;
}

/**
 * Optimized UDP client for market data
 */
export class OptimizedUdpClient extends EventEmitter {
  private socket: dgram.Socket | null = null;
  private config: UdpOptimizationConfig;
  private sequenceNumber: number = 0;
  private missedPackets: Set<number> = new Set();
  private packetStats = {
    received: 0,
    missed: 0,
    outOfOrder: 0,
    latencySum: 0n,
    latencyCount: 0
  };
  
  constructor(config: UdpOptimizationConfig = {}) {
    super();
    
    this.config = {
      receiveBufferSize: 8 * 1024 * 1024, // 8MB
      sendBufferSize: 1024 * 1024, // 1MB
      multicastTTL: 1,
      multicastLoopback: false,
      reuseAddr: true,
      ipv6Only: false,
      ...config
    };
  }
  
  /**
   * Start listening for market data
   */
  listen(port: number, multicastAddress?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = dgram.createSocket({
        type: 'udp4',
        reuseAddr: this.config.reuseAddr
      });
      
      // Apply socket optimizations
      this.applySocketOptimizations();
      
      // Handle messages
      this.socket.on('message', (msg, rinfo) => {
        this.handleMessage(msg, rinfo);
      });
      
      // Handle errors
      this.socket.on('error', (error) => {
        this.emit('error', error);
      });
      
      // Bind to port
      this.socket.bind(port, () => {
        if (!this.socket) return;
        
        // Join multicast group if specified
        if (multicastAddress) {
          this.socket.addMembership(multicastAddress);
          this.socket.setMulticastTTL(this.config.multicastTTL!);
          this.socket.setMulticastLoopback(this.config.multicastLoopback!);
        }
        
        this.emit('listening', port, multicastAddress);
        resolve();
      });
    });
  }
  
  /**
   * Apply socket optimizations
   */
  private applySocketOptimizations(): void {
    if (!this.socket) return;
    
    // Set buffer sizes
    if (this.config.receiveBufferSize) {
      try {
        this.socket.setRecvBufferSize(this.config.receiveBufferSize);
      } catch (error) {
        this.emit('warning', `Failed to set receive buffer size: ${error}`);
      }
    }
    
    if (this.config.sendBufferSize) {
      try {
        this.socket.setSendBufferSize(this.config.sendBufferSize);
      } catch (error) {
        this.emit('warning', `Failed to set send buffer size: ${error}`);
      }
    }
  }
  
  /**
   * Handle incoming message with minimal latency
   */
  private handleMessage(buffer: Buffer, rinfo: dgram.RemoteInfo): void {
    const receiveTime = process.hrtime.bigint();
    
    try {
      // Parse packet (optimize for your specific protocol)
      const packet = this.parsePacket(buffer);
      
      // Check sequence number
      if (packet.sequenceNumber > this.sequenceNumber + 1) {
        // Missed packets
        for (let i = this.sequenceNumber + 1; i < packet.sequenceNumber; i++) {
          this.missedPackets.add(i);
          this.packetStats.missed++;
        }
      } else if (packet.sequenceNumber <= this.sequenceNumber) {
        // Out of order or duplicate
        this.packetStats.outOfOrder++;
        
        // Remove from missed if it was there
        if (this.missedPackets.delete(packet.sequenceNumber)) {
          this.packetStats.missed--;
        }
      }
      
      this.sequenceNumber = Math.max(this.sequenceNumber, packet.sequenceNumber);
      this.packetStats.received++;
      
      // Calculate latency if timestamp is available
      if (packet.timestamp) {
        const latency = receiveTime - packet.timestamp;
        this.packetStats.latencySum += latency;
        this.packetStats.latencyCount++;
      }
      
      // Emit the packet
      this.emit('data', packet, rinfo);
      
    } catch (error) {
      this.emit('parseError', error, buffer);
    }
  }
  
  /**
   * Parse binary packet (example implementation)
   */
  private parsePacket(buffer: Buffer): MarketDataPacket {
    let offset = 0;
    
    // Read sequence number (4 bytes)
    const sequenceNumber = buffer.readUInt32LE(offset);
    offset += 4;
    
    // Read timestamp (8 bytes)
    const timestamp = buffer.readBigUInt64LE(offset);
    offset += 8;
    
    // Read symbol (8 bytes, null-padded)
    const symbolBytes = buffer.slice(offset, offset + 8);
    const symbol = symbolBytes.toString('utf8').replace(/\0/g, '');
    offset += 8;
    
    // Read prices and sizes (4 bytes each)
    const bidPrice = buffer.readFloatLE(offset);
    offset += 4;
    
    const askPrice = buffer.readFloatLE(offset);
    offset += 4;
    
    const bidSize = buffer.readFloatLE(offset);
    offset += 4;
    
    const askSize = buffer.readFloatLE(offset);
    offset += 4;
    
    // Optional last trade data
    let lastPrice: number | undefined;
    let lastSize: number | undefined;
    
    if (buffer.length > offset + 8) {
      lastPrice = buffer.readFloatLE(offset);
      offset += 4;
      
      lastSize = buffer.readFloatLE(offset);
      offset += 4;
    }
    
    return {
      sequenceNumber,
      timestamp,
      symbol,
      bidPrice,
      askPrice,
      bidSize,
      askSize,
      lastPrice,
      lastSize
    };
  }
  
  /**
   * Get packet statistics
   */
  getStats(): PacketStats {
    const avgLatency = this.packetStats.latencyCount > 0
      ? Number(this.packetStats.latencySum / BigInt(this.packetStats.latencyCount)) / 1000 // Convert to microseconds
      : 0;
    
    return {
      received: this.packetStats.received,
      missed: this.packetStats.missed,
      outOfOrder: this.packetStats.outOfOrder,
      lossRate: this.packetStats.received > 0
        ? this.packetStats.missed / (this.packetStats.received + this.packetStats.missed)
        : 0,
      avgLatencyUs: avgLatency,
      currentSequence: this.sequenceNumber
    };
  }
  
  /**
   * Close the socket
   */
  close(): void {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }
}

/**
 * Packet statistics
 */
export interface PacketStats {
  received: number;
  missed: number;
  outOfOrder: number;
  lossRate: number;
  avgLatencyUs: number;
  currentSequence: number;
}

/**
 * Optimized UDP server for broadcasting market data
 */
export class OptimizedUdpServer extends EventEmitter {
  private socket: dgram.Socket | null = null;
  private config: UdpOptimizationConfig;
  private sequenceNumber: number = 0;
  private clients: Map<string, dgram.RemoteInfo> = new Map();
  
  constructor(config: UdpOptimizationConfig = {}) {
    super();
    
    this.config = {
      sendBufferSize: 8 * 1024 * 1024, // 8MB
      multicastTTL: 1,
      multicastLoopback: false,
      reuseAddr: true,
      ...config
    };
  }
  
  /**
   * Start the UDP server
   */
  start(port: number, multicastAddress?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = dgram.createSocket({
        type: 'udp4',
        reuseAddr: this.config.reuseAddr
      });
      
      // Apply optimizations
      if (this.config.sendBufferSize && this.socket) {
        try {
          this.socket.setSendBufferSize(this.config.sendBufferSize);
        } catch (error) {
          this.emit('warning', `Failed to set send buffer size: ${error}`);
        }
      }
      
      // Handle errors
      this.socket.on('error', (error) => {
        this.emit('error', error);
        reject(error);
      });
      
      // Bind to port
      this.socket.bind(port, () => {
        if (!this.socket) return;
        
        // Configure multicast if specified
        if (multicastAddress) {
          this.socket.setMulticastTTL(this.config.multicastTTL!);
          this.socket.setMulticastLoopback(this.config.multicastLoopback!);
        }
        
        this.emit('listening', port);
        resolve();
      });
    });
  }
  
  /**
   * Broadcast market data packet
   */
  broadcast(data: MarketDataPacket, multicastAddress?: string, port?: number): void {
    if (!this.socket) return;
    
    // Increment sequence number
    data.sequenceNumber = ++this.sequenceNumber;
    
    // Set timestamp
    data.timestamp = process.hrtime.bigint();
    
    // Serialize packet
    const buffer = this.serializePacket(data);
    
    if (multicastAddress && port) {
      // Multicast
      this.socket.send(buffer, port, multicastAddress, (error) => {
        if (error) {
          this.emit('sendError', error);
        }
      });
    } else {
      // Unicast to all known clients
      for (const [clientId, rinfo] of this.clients) {
        this.socket.send(buffer, rinfo.port, rinfo.address, (error) => {
          if (error) {
            this.emit('sendError', error, clientId);
          }
        });
      }
    }
  }
  
  /**
   * Serialize packet to binary format
   */
  private serializePacket(data: MarketDataPacket): Buffer {
    const hasLastTrade = data.lastPrice !== undefined && data.lastSize !== undefined;
    const bufferSize = 36 + (hasLastTrade ? 8 : 0);
    const buffer = Buffer.allocUnsafe(bufferSize);
    let offset = 0;
    
    // Write sequence number
    buffer.writeUInt32LE(data.sequenceNumber, offset);
    offset += 4;
    
    // Write timestamp
    buffer.writeBigUInt64LE(data.timestamp, offset);
    offset += 8;
    
    // Write symbol (8 bytes, null-padded)
    const symbolBuffer = Buffer.alloc(8);
    symbolBuffer.write(data.symbol, 0, 8, 'utf8');
    symbolBuffer.copy(buffer, offset);
    offset += 8;
    
    // Write prices and sizes
    buffer.writeFloatLE(data.bidPrice, offset);
    offset += 4;
    
    buffer.writeFloatLE(data.askPrice, offset);
    offset += 4;
    
    buffer.writeFloatLE(data.bidSize, offset);
    offset += 4;
    
    buffer.writeFloatLE(data.askSize, offset);
    offset += 4;
    
    // Write optional last trade
    if (hasLastTrade) {
      buffer.writeFloatLE(data.lastPrice!, offset);
      offset += 4;
      
      buffer.writeFloatLE(data.lastSize!, offset);
      offset += 4;
    }
    
    return buffer;
  }
  
  /**
   * Register a client for unicast
   */
  registerClient(clientId: string, address: string, port: number): void {
    this.clients.set(clientId, { address, port, family: 'IPv4', size: 0 });
  }
  
  /**
   * Unregister a client
   */
  unregisterClient(clientId: string): void {
    this.clients.delete(clientId);
  }
  
  /**
   * Stop the server
   */
  stop(): void {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }
} 