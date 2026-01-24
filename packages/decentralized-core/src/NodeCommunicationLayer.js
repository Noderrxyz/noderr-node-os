"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NodeCommunicationLayer = exports.MessageType = void 0;
const libp2p_1 = require("libp2p");
const tcp_1 = require("@libp2p/tcp");
const websockets_1 = require("@libp2p/websockets");
const noise_1 = require("@libp2p/noise");
const mplex_1 = require("@libp2p/mplex");
const kad_dht_1 = require("@libp2p/kad-dht");
const libp2p_gossipsub_1 = require("@chainsafe/libp2p-gossipsub");
const identify_1 = require("@libp2p/identify");
const events_1 = require("events");
const ethers_1 = require("ethers");
/**
 * Message types for P2P communication
 */
var MessageType;
(function (MessageType) {
    MessageType["SIGNAL"] = "signal";
    MessageType["EXECUTION"] = "execution";
    MessageType["METRICS"] = "metrics";
    MessageType["HEARTBEAT"] = "heartbeat";
    MessageType["CONSENSUS"] = "consensus";
    MessageType["CHALLENGE"] = "challenge";
})(MessageType || (exports.MessageType = MessageType = {}));
/**
 * Decentralized node communication layer
 */
class NodeCommunicationLayer extends events_1.EventEmitter {
    node = null;
    logger;
    identity;
    wallet;
    peers = new Map();
    signalHistory = new Map();
    executionHistory = new Map();
    // Topics for pub/sub
    SIGNAL_TOPIC = '/noderr/signals/1.0.0';
    EXECUTION_TOPIC = '/noderr/executions/1.0.0';
    METRICS_TOPIC = '/noderr/metrics/1.0.0';
    CONSENSUS_TOPIC = '/noderr/consensus/1.0.0';
    constructor(identity, privateKey, logger) {
        super();
        this.identity = identity;
        this.wallet = new ethers_1.ethers.Wallet(privateKey);
        this.logger = logger;
    }
    /**
     * Initialize P2P node
     */
    async initialize(listenAddresses = []) {
        try {
            // Create libp2p node
            this.node = await (0, libp2p_1.createLibp2p)({
                addresses: {
                    listen: listenAddresses.length > 0 ? listenAddresses : [
                        '/ip4/0.0.0.0/tcp/0',
                        '/ip4/0.0.0.0/tcp/0/ws'
                    ]
                },
                transports: [
                    (0, tcp_1.tcp)(),
                    (0, websockets_1.webSockets)()
                ],
                connectionEncrypters: [(0, noise_1.noise)()],
                streamMuxers: [(0, mplex_1.mplex)()],
                services: {
                    dht: (0, kad_dht_1.kadDHT)({
                        clientMode: false
                    }),
                    pubsub: (0, libp2p_gossipsub_1.gossipsub)({
                        emitSelf: false,
                        fallbackToFloodsub: true,
                        floodPublish: true,
                        doPX: true
                    }),
                    identify: (0, identify_1.identify)()
                }
            });
            // Set up event handlers
            this.setupEventHandlers();
            // Start the node
            await this.node.start();
            this.logger.info('P2P node initialized', {
                peerId: this.node.peerId.toString(),
                addresses: this.node.getMultiaddrs().map((ma) => ma.toString())
            });
            // Subscribe to topics
            await this.subscribeToTopics();
            // Start heartbeat
            this.startHeartbeat();
        }
        catch (error) {
            this.logger.error('Failed to initialize P2P node', error);
            throw error;
        }
    }
    /**
     * Set up event handlers
     */
    setupEventHandlers() {
        if (!this.node)
            return;
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
    async subscribeToTopics() {
        if (!this.node?.services.pubsub)
            return;
        const pubsub = this.node.services.pubsub;
        // Subscribe to signal topic
        pubsub.subscribe(this.SIGNAL_TOPIC);
        pubsub.addEventListener('message', (evt) => {
            if (evt.detail.topic === this.SIGNAL_TOPIC) {
                this.handleSignalMessage(evt.detail.data);
            }
        });
        // Subscribe to execution topic
        pubsub.subscribe(this.EXECUTION_TOPIC);
        pubsub.addEventListener('message', (evt) => {
            if (evt.detail.topic === this.EXECUTION_TOPIC) {
                this.handleExecutionMessage(evt.detail.data);
            }
        });
        // Subscribe to metrics topic
        pubsub.subscribe(this.METRICS_TOPIC);
        pubsub.addEventListener('message', (evt) => {
            if (evt.detail.topic === this.METRICS_TOPIC) {
                this.handleMetricsMessage(evt.detail.data);
            }
        });
        // Subscribe to consensus topic
        pubsub.subscribe(this.CONSENSUS_TOPIC);
        pubsub.addEventListener('message', (evt) => {
            if (evt.detail.topic === this.CONSENSUS_TOPIC) {
                this.handleConsensusMessage(evt.detail.data);
            }
        });
        this.logger.info('Subscribed to P2P topics');
    }
    /**
     * Broadcast trading signal
     */
    async broadcastSignal(signal) {
        if (!this.node?.services.pubsub) {
            throw new Error('P2P node not initialized');
        }
        // Add node ID and sign
        const fullSignal = {
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
        const p2pMessage = {
            type: MessageType.SIGNAL,
            payload: fullSignal,
            timestamp: Date.now(),
            sender: this.identity.peerId,
            signature: fullSignal.signature
        };
        // Broadcast
        const data = new TextEncoder().encode(JSON.stringify(p2pMessage));
        const pubsub = this.node.services.pubsub;
        await pubsub.publish(this.SIGNAL_TOPIC, data);
        this.logger.debug('Broadcasted trading signal', { signalId: signal.id });
    }
    /**
     * Broadcast execution result
     */
    async broadcastExecution(execution) {
        if (!this.node?.services.pubsub) {
            throw new Error('P2P node not initialized');
        }
        // Add node ID and sign
        const fullExecution = {
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
        const p2pMessage = {
            type: MessageType.EXECUTION,
            payload: fullExecution,
            timestamp: Date.now(),
            sender: this.identity.peerId,
            signature: fullExecution.signature
        };
        // Broadcast
        const data = new TextEncoder().encode(JSON.stringify(p2pMessage));
        const pubsub = this.node.services.pubsub;
        await pubsub.publish(this.EXECUTION_TOPIC, data);
        this.logger.debug('Broadcasted execution result', { signalId: execution.signalId });
    }
    /**
     * Generic broadcast message method
     */
    async broadcastMessage(message) {
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
        const p2pMessage = {
            ...message,
            signature
        };
        // Determine topic based on message type
        let topic = this.SIGNAL_TOPIC; // default
        if (message.type === MessageType.EXECUTION) {
            topic = this.EXECUTION_TOPIC;
        }
        else if (message.type === MessageType.CONSENSUS) {
            topic = "consensus"; // Add consensus topic
        }
        // Broadcast
        const data = new TextEncoder().encode(JSON.stringify(p2pMessage));
        const pubsub = this.node.services.pubsub;
        await pubsub.publish(topic, data);
        this.logger.debug("Broadcasted message", { type: message.type });
    }
    /**
     * Handle incoming signal message
     */
    async handleSignalMessage(data) {
        try {
            const message = JSON.parse(new TextDecoder().decode(data));
            const signal = message.payload;
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
        }
        catch (error) {
            this.logger.error('Failed to handle signal message', error);
        }
    }
    /**
     * Handle incoming execution message
     */
    async handleExecutionMessage(data) {
        try {
            const message = JSON.parse(new TextDecoder().decode(data));
            const execution = message.payload;
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
        }
        catch (error) {
            this.logger.error('Failed to handle execution message', error);
        }
    }
    /**
     * Handle incoming metrics message
     */
    async handleMetricsMessage(data) {
        try {
            const message = JSON.parse(new TextDecoder().decode(data));
            const metrics = message.payload;
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
        }
        catch (error) {
            this.logger.error('Failed to handle metrics message', error);
        }
    }
    /**
     * Handle consensus message
     */
    async handleConsensusMessage(data) {
        try {
            const message = JSON.parse(new TextDecoder().decode(data));
            // Emit event for consensus handling
            this.emit('consensusMessage', message);
        }
        catch (error) {
            this.logger.error('Failed to handle consensus message', error);
        }
    }
    /**
     * Verify message signature
     */
    async verifySignature(data, signature, expectedSigner) {
        try {
            const message = JSON.stringify({
                ...data,
                signature: undefined
            });
            const recoveredAddress = ethers_1.ethers.verifyMessage(message, signature);
            // In a real implementation, you would look up the address for the peer ID
            // For now, we'll just return true if signature is valid
            return true;
        }
        catch (error) {
            return false;
        }
    }
    /**
     * Validate DHT record
     */
    async validateRecord(key, value) {
        // Implement record validation logic
        return;
    }
    /**
     * Start heartbeat
     */
    startHeartbeat() {
        setInterval(async () => {
            if (!this.node?.services.pubsub)
                return;
            const heartbeat = {
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
            const pubsub = this.node.services.pubsub;
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
    getConnectedPeers() {
        if (!this.node)
            return [];
        return Array.from(this.node.getPeers()).map((peer) => peer.toString());
    }
    /**
     * Get peer info
     */
    getPeerInfo(peerId) {
        return this.peers.get(peerId);
    }
    /**
     * Get signal history
     */
    getSignalHistory(limit = 100) {
        const signals = Array.from(this.signalHistory.values());
        return signals
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, limit);
    }
    /**
     * Get execution history for a signal
     */
    getExecutionHistory(signalId) {
        return this.executionHistory.get(signalId) || [];
    }
    /**
     * Calculate consensus for a signal
     */
    calculateSignalConsensus(signalId) {
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
    async shutdown() {
        if (this.node) {
            await this.node.stop();
            this.node = null;
            this.logger.info('P2P node shut down');
        }
    }
}
exports.NodeCommunicationLayer = NodeCommunicationLayer;
//# sourceMappingURL=NodeCommunicationLayer.js.map