import { createLibp2p, Libp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { webSockets } from '@libp2p/websockets';
import { noise } from '@libp2p/noise';
import { mplex } from '@libp2p/mplex';
import { kadDHT } from '@libp2p/kad-dht';
import { gossipsub } from '@chainsafe/libp2p-gossipsub';
import { identify } from '@libp2p/identify';
import { EventEmitter } from 'events';
import * as winston from 'winston';
import { ethers } from 'ethers';

/**
 * Node identity and metadata
 */
export interface NodeIdentity {
  peerId: string;
  address: string; // Ethereum address
  reputation: number;
  capabilities: string[];
  region: string;
  version: string;
}

/**
 * Trading signal to broadcast
 */
export interface TradingSignal {
  id: string;
  timestamp: number;
  symbol: string;
  action: 'buy' | 'sell' | 'hold';
  confidence: number;
  price: number;
  size: number;
  strategy: string;
  nodeId: string;
  signature: string;
}

/**
 * Execution result to share
 */
export interface ExecutionResult {
  signalId: string;
  nodeId: string;
  timestamp: number;
  executedPrice: number;
  executedSize: number;
  slippage: number;
  fees: number;
  venue: string;
  success: boolean;
  signature: string;
}

/**
 * Node performance metrics
 */
export interface NodeMetrics {
  nodeId: string;
  timestamp: number;
  signalsGenerated: number;
  signalsExecuted: number;
  successRate: number;
  avgSlippage: number;
  totalPnL: number;
  uptime: number;
}

/**
 * Message types for P2P communication
 */
export enum MessageType {
  SIGNAL = 'signal',
  EXECUTION = 'execution',
  METRICS = 'metrics',
  HEARTBEAT = 'heartbeat',
  CONSENSUS = 'consensus',
  CHALLENGE = 'challenge'
}

/**
 * P2P message structure
 */
export interface P2PMessage {
  type: MessageType;
  payload: any;
  timestamp: number;
  sender: string;
  signature: string;
}

/**
 * Decentralized node communication layer
 */
export class NodeCommunicationLayer extends EventEmitter {
  private node: Libp2p | null = null;
  private logger: winston.Logger;
  private identity: NodeIdentity;
  private wallet: ethers.Wallet;
  private peers: Map<string, NodeIdentity> = new Map();
  private signalHistory: Map<string, TradingSignal> = new Map();
  private executionHistory: Map<string, ExecutionResult[]> = new Map();
  
  // Topics for pub/sub
  private readonly SIGNAL_TOPIC = '/noderr/signals/1.0.0';
  private readonly EXECUTION_TOPIC = '/noderr/executions/1.0.0';
  private readonly METRICS_TOPIC = '/noderr/metrics/1.0.0';
  private readonly CONSENSUS_TOPIC = '/noderr/consensus/1.0.0';
  
  constructor(
    identity: NodeIdentity,
    privateKey: string,
    logger: winston.Logger
  ) {
    super();
    
    this.identity = identity;
    this.wallet = new ethers.Wallet(privateKey);
    this.logger = logger;
  }
  
  /**
   * Initialize P2P node
   */
  async initialize(listenAddresses: string[] = []): Promise<void> {
    try {
      // Create libp2p node
      this.node = await createLibp2p({
        addresses: {
          listen: listenAddresses.length > 0 ? listenAddresses : [
            '/ip4/0.0.0.0/tcp/0',
            '/ip4/0.0.0.0/tcp/0/ws'
          ]
        },
        transports: [
          tcp(),
          webSockets()
        ],
        connectionEncrypters: [noise() as any],
        streamMuxers: [mplex()],
        services: {
          dht: kadDHT({
            clientMode: false
          }) as any,
          pubsub: gossipsub({
            emitSelf: false,
            fallbackToFloodsub: true,
            floodPublish: true,
            doPX: true
          }),
          identify: identify()
        }
      });
      
      // Set up event handlers
      this.setupEventHandlers();
      
      // Start the node
      await this.node.start();
      
      this.logger.info('P2P node initialized', {
        peerId: this.node.peerId.toString(),
        addresses: this.node.getMultiaddrs().map((ma: any) => ma.toString())
      });
      
      // Subscribe to topics
      await this.subscribeToTopics();
      
      // Start heartbeat
      this.startHeartbeat();
      
    } catch (error) {
      this.logger.error('Failed to initialize P2P node', error);
      throw error;
    }
  }
  
  /**
   * Set up event handlers
   */
  private setupEventHandlers(): void {
    if (!this.node) return;
    
    // Peer discovery
    this.node.addEventListener('peer:discovery', (evt) => {
      const peerId = evt.detail.id.toString();
      this.logger.info('Discovered peer', { peerId });
      this.emit('peerDiscovered', peerId);
    });
    
    // Peer connection
    this.node.addEventListener('peer:connect', (evt) => {
      const peerId = evt.detail.toString();
      this.logger.info('Connected to peer', { peerId });
      this.emit('peerConnected', peerId);
    });
    
    // Peer disconnection
    this.node.addEventListener('peer:disconnect', (evt) => {
      const peerId = evt.detail.toString();
      this.logger.info('Disconnected from peer', { peerId });
      this.peers.delete(peerId);
      this.emit('peerDisconnected', peerId);
    });
  }
  
  /**
   * Subscribe to pub/sub topics
   */
  private async subscribeToTopics(): Promise<void> {
    if (!this.node?.services.pubsub) return;
    
    const pubsub = this.node.services.pubsub as any;
    
    // Subscribe to signal topic
    pubsub.subscribe(this.SIGNAL_TOPIC);
    pubsub.addEventListener('message', (evt: any) => {
      if (evt.detail.topic === this.SIGNAL_TOPIC) {
        this.handleSignalMessage(evt.detail.data);
      }
    });
    
    // Subscribe to execution topic
    pubsub.subscribe(this.EXECUTION_TOPIC);
    pubsub.addEventListener('message', (evt: any) => {
      if (evt.detail.topic === this.EXECUTION_TOPIC) {
        this.handleExecutionMessage(evt.detail.data);
      }
    });
    
    // Subscribe to metrics topic
    pubsub.subscribe(this.METRICS_TOPIC);
    pubsub.addEventListener('message', (evt: any) => {
      if (evt.detail.topic === this.METRICS_TOPIC) {
        this.handleMetricsMessage(evt.detail.data);
      }
    });
    
    // Subscribe to consensus topic
    pubsub.subscribe(this.CONSENSUS_TOPIC);
    pubsub.addEventListener('message', (evt: any) => {
      if (evt.detail.topic === this.CONSENSUS_TOPIC) {
        this.handleConsensusMessage(evt.detail.data);
      }
    });
    
    this.logger.info('Subscribed to P2P topics');
  }
  
  /**
   * Broadcast trading signal
   */
  async broadcastSignal(signal: Omit<TradingSignal, 'nodeId' | 'signature'>): Promise<void> {
    if (!this.node?.services.pubsub) {
      throw new Error('P2P node not initialized');
    }
    
    // Add node ID and sign
    const fullSignal: TradingSignal = {
      ...signal,
      nodeId: this.identity.peerId,
      signature: ''
    };
    
    // Sign the signal
    const message = JSON.stringify({
      ...fullSignal,
      signature: undefined
    });
    fullSignal.signature = await this.wallet.signMessage(message);
    
    // Store in history
    this.signalHistory.set(fullSignal.id, fullSignal);
    
    // Create P2P message
    const p2pMessage: P2PMessage = {
      type: MessageType.SIGNAL,
      payload: fullSignal,
      timestamp: Date.now(),
      sender: this.identity.peerId,
      signature: fullSignal.signature
    };
    
    // Broadcast
    const data = new TextEncoder().encode(JSON.stringify(p2pMessage));
    const pubsub = this.node.services.pubsub as any;
    await pubsub.publish(this.SIGNAL_TOPIC, data);
    
    this.logger.debug('Broadcasted trading signal', { signalId: signal.id });
  }
  
  /**
   * Broadcast execution result
   */
  async broadcastExecution(execution: Omit<ExecutionResult, 'nodeId' | 'signature'>): Promise<void> {
    if (!this.node?.services.pubsub) {
      throw new Error('P2P node not initialized');
    }
    
    // Add node ID and sign
    const fullExecution: ExecutionResult = {
      ...execution,
      nodeId: this.identity.peerId,
      signature: ''
    };
    
    // Sign the execution
    const message = JSON.stringify({
      ...fullExecution,
      signature: undefined
    });
    fullExecution.signature = await this.wallet.signMessage(message);
    
    // Store in history
    const history = this.executionHistory.get(execution.signalId) || [];
    history.push(fullExecution);
    this.executionHistory.set(execution.signalId, history);
    
    // Create P2P message
    const p2pMessage: P2PMessage = {
      type: MessageType.EXECUTION,
      payload: fullExecution,
      timestamp: Date.now(),
      sender: this.identity.peerId,
      signature: fullExecution.signature
    };
    
    // Broadcast
    const data = new TextEncoder().encode(JSON.stringify(p2pMessage));
    const pubsub = this.node.services.pubsub as any;
    await pubsub.publish(this.EXECUTION_TOPIC, data);
    
    this.logger.debug('Broadcasted execution result', { signalId: execution.signalId });
  }

  /**
   * Generic broadcast message method
   */
  async broadcastMessage(message: Omit<P2PMessage, "signature">): Promise<void> {
    if (!this.node?.services.pubsub) {
      throw new Error("P2P node not initialized");
    }

    // Sign the message
    const messageToSign = JSON.stringify({
      ...message,
      signature: undefined
    });
    const signature = await this.wallet.signMessage(messageToSign);

    // Create full P2P message
    const p2pMessage: P2PMessage = {
      ...message,
      signature
    };

    // Determine topic based on message type
    let topic = this.SIGNAL_TOPIC; // default
    if (message.type === MessageType.EXECUTION) {
      topic = this.EXECUTION_TOPIC;
    } else if (message.type === MessageType.CONSENSUS) {
      topic = "consensus"; // Add consensus topic
    }

    // Broadcast
    const data = new TextEncoder().encode(JSON.stringify(p2pMessage));
    const pubsub = this.node.services.pubsub as any;
    await pubsub.publish(topic, data);

    this.logger.debug("Broadcasted message", { type: message.type });
  }
  
  /**
   * Handle incoming signal message
   */
  private async handleSignalMessage(data: Uint8Array): Promise<void> {
    try {
      const message: P2PMessage = JSON.parse(new TextDecoder().decode(data));
      const signal = message.payload as TradingSignal;
      
      // Verify signature
      const isValid = await this.verifySignature(signal, signal.signature, signal.nodeId);
      if (!isValid) {
        this.logger.warn('Invalid signal signature', { signalId: signal.id });
        return;
      }
      
      // Store signal
      this.signalHistory.set(signal.id, signal);
      
      // Emit event
      this.emit('signalReceived', signal);
      
    } catch (error) {
      this.logger.error('Failed to handle signal message', error);
    }
  }
  
  /**
   * Handle incoming execution message
   */
  private async handleExecutionMessage(data: Uint8Array): Promise<void> {
    try {
      const message: P2PMessage = JSON.parse(new TextDecoder().decode(data));
      const execution = message.payload as ExecutionResult;
      
      // Verify signature
      const isValid = await this.verifySignature(execution, execution.signature, execution.nodeId);
      if (!isValid) {
        this.logger.warn('Invalid execution signature', { signalId: execution.signalId });
        return;
      }
      
      // Store execution
      const history = this.executionHistory.get(execution.signalId) || [];
      history.push(execution);
      this.executionHistory.set(execution.signalId, history);
      
      // Emit event
      this.emit('executionReceived', execution);
      
    } catch (error) {
      this.logger.error('Failed to handle execution message', error);
    }
  }
  
  /**
   * Handle incoming metrics message
   */
  private async handleMetricsMessage(data: Uint8Array): Promise<void> {
    try {
      const message: P2PMessage = JSON.parse(new TextDecoder().decode(data));
      const metrics = message.payload as NodeMetrics;
      
      // Update peer metrics
      const peer = this.peers.get(metrics.nodeId);
      if (peer) {
        // Update reputation based on metrics
        const performanceScore = metrics.successRate * 0.4 + 
                               (1 - Math.abs(metrics.avgSlippage)) * 0.3 +
                               Math.min(1, metrics.totalPnL / 10000) * 0.3;
        
        peer.reputation = peer.reputation * 0.9 + performanceScore * 0.1;
        this.peers.set(metrics.nodeId, peer);
      }
      
      // Emit event
      this.emit('metricsReceived', metrics);
      
    } catch (error) {
      this.logger.error('Failed to handle metrics message', error);
    }
  }
  
  /**
   * Handle consensus message
   */
  private async handleConsensusMessage(data: Uint8Array): Promise<void> {
    try {
      const message: P2PMessage = JSON.parse(new TextDecoder().decode(data));
      
      // Emit event for consensus handling
      this.emit('consensusMessage', message);
      
    } catch (error) {
      this.logger.error('Failed to handle consensus message', error);
    }
  }
  
  /**
   * Verify message signature
   */
  private async verifySignature(
    data: any,
    signature: string,
    expectedSigner: string
  ): Promise<boolean> {
    try {
      const message = JSON.stringify({
        ...data,
        signature: undefined
      });
      
      const recoveredAddress = ethers.verifyMessage(message, signature);
      
      // In a real implementation, you would look up the address for the peer ID
      // For now, we'll just return true if signature is valid
      return true;
      
    } catch (error) {
      return false;
    }
  }
  
  /**
   * Validate DHT record
   */
  private async validateRecord(key: Uint8Array, value: Uint8Array): Promise<void> {
    // Implement record validation logic
    return;
  }
  
  /**
   * Start heartbeat
   */
  private startHeartbeat(): void {
    setInterval(async () => {
      if (!this.node?.services.pubsub) return;
      
      const heartbeat: P2PMessage = {
        type: MessageType.HEARTBEAT,
        payload: {
          nodeId: this.identity.peerId,
          timestamp: Date.now(),
          status: 'active'
        },
        timestamp: Date.now(),
        sender: this.identity.peerId,
        signature: ''
      };
      
      const data = new TextEncoder().encode(JSON.stringify(heartbeat));
      
      const pubsub = this.node.services.pubsub as any;
      // Broadcast to all topics
      await Promise.all([
        pubsub.publish(this.SIGNAL_TOPIC, data),
        pubsub.publish(this.EXECUTION_TOPIC, data),
        pubsub.publish(this.METRICS_TOPIC, data)
      ]);
      
    }, 30000); // Every 30 seconds
  }
  
  /**
   * Get connected peers
   */
  getConnectedPeers(): string[] {
    if (!this.node) return [];
    
    return Array.from(this.node.getPeers()).map((peer: any) => peer.toString());
  }
  
  /**
   * Get peer info
   */
  getPeerInfo(peerId: string): NodeIdentity | undefined {
    return this.peers.get(peerId);
  }
  
  /**
   * Get signal history
   */
  getSignalHistory(limit: number = 100): TradingSignal[] {
    const signals = Array.from(this.signalHistory.values());
    return signals
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }
  
  /**
   * Get execution history for a signal
   */
  getExecutionHistory(signalId: string): ExecutionResult[] {
    return this.executionHistory.get(signalId) || [];
  }
  
  /**
   * Calculate consensus for a signal
   */
  calculateSignalConsensus(signalId: string): {
    executed: number;
    successful: number;
    avgSlippage: number;
    consensus: number;
  } {
    const executions = this.executionHistory.get(signalId) || [];
    
    if (executions.length === 0) {
      return {
        executed: 0,
        successful: 0,
        avgSlippage: 0,
        consensus: 0
      };
    }
    
    const successful = executions.filter(e => e.success).length;
    const avgSlippage = executions.reduce((sum, e) => sum + Math.abs(e.slippage), 0) / executions.length;
    const consensus = successful / executions.length;
    
    return {
      executed: executions.length,
      successful,
      avgSlippage,
      consensus
    };
  }
  
  /**
   * Shutdown the node
   */
  async shutdown(): Promise<void> {
    if (this.node) {
      await this.node.stop();
      this.node = null;
      this.logger.info('P2P node shut down');
    }
  }
} 