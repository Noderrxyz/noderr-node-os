"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SignalConsensus = void 0;
const events_1 = require("events");
const ethers_1 = require("ethers");
/**
 * Signal consensus mechanism
 */
class SignalConsensus extends events_1.EventEmitter {
    config;
    logger;
    activeSignals = new Map();
    consensusHistory = [];
    nodeReputations = new Map();
    consensusTimer = null;
    constructor(config, logger) {
        super();
        this.config = config;
        this.logger = logger;
    }
    /**
     * Start consensus mechanism
     */
    start() {
        // Start periodic consensus checks
        this.consensusTimer = setInterval(() => {
            this.checkConsensus();
        }, 1000); // Check every second
        this.logger.info('Signal consensus started', {
            minNodes: this.config.minNodes,
            threshold: this.config.consensusThreshold
        });
    }
    /**
     * Stop consensus mechanism
     */
    stop() {
        if (this.consensusTimer) {
            clearInterval(this.consensusTimer);
            this.consensusTimer = null;
        }
    }
    /**
     * Submit a trading signal
     */
    async submitSignal(signal) {
        // Verify signal signature if provided
        if (signal.signature) {
            const isValid = await this.verifySignature(signal);
            if (!isValid) {
                throw new Error('Invalid signal signature');
            }
        }
        // Check if signal is within validity window
        const age = Date.now() - signal.timestamp.getTime();
        if (age > this.config.signalValidityWindow) {
            throw new Error('Signal outside validity window');
        }
        // Group signals by symbol and timeframe
        const key = `${signal.symbol}_${signal.timeframe}`;
        let signals = this.activeSignals.get(key);
        if (!signals) {
            signals = [];
            this.activeSignals.set(key, signals);
        }
        // Add signal (prevent duplicates)
        const exists = signals.some(s => s.id === signal.id);
        if (!exists) {
            signals.push(signal);
            this.logger.debug('Signal submitted', {
                signalId: signal.id,
                nodeId: signal.nodeId,
                symbol: signal.symbol,
                action: signal.action
            });
            this.emit('signalSubmitted', signal);
            // Check if we can reach consensus immediately
            this.checkConsensusForSymbol(key);
        }
    }
    /**
     * Check consensus for all symbols
     */
    checkConsensus() {
        const now = Date.now();
        for (const [key, signals] of this.activeSignals) {
            // Remove expired signals
            const validSignals = signals.filter(s => now - s.timestamp.getTime() <= this.config.signalValidityWindow);
            if (validSignals.length !== signals.length) {
                this.activeSignals.set(key, validSignals);
            }
            // Check consensus if we have enough signals
            if (validSignals.length >= this.config.minNodes) {
                this.checkConsensusForSymbol(key);
            }
        }
    }
    /**
     * Check consensus for a specific symbol
     */
    checkConsensusForSymbol(key) {
        const signals = this.activeSignals.get(key);
        if (!signals || signals.length < this.config.minNodes) {
            return;
        }
        const [symbol, timeframe] = key.split('_');
        // Calculate weighted votes
        const votes = new Map();
        const weights = new Map();
        let totalWeight = 0;
        for (const signal of signals) {
            const weight = this.calculateSignalWeight(signal);
            weights.set(signal.nodeId, weight);
            totalWeight += weight;
            const currentVote = votes.get(signal.action) || 0;
            votes.set(signal.action, currentVote + weight);
        }
        // Find majority action
        let majorityAction = null;
        let majorityWeight = 0;
        for (const [action, weight] of votes) {
            if (weight > majorityWeight) {
                majorityAction = action;
                majorityWeight = weight;
            }
        }
        // Check if consensus is achieved
        const consensusRatio = majorityWeight / totalWeight;
        const consensusAchieved = consensusRatio >= this.config.consensusThreshold;
        if (consensusAchieved && majorityAction) {
            // Calculate average confidence
            const relevantSignals = signals.filter(s => s.action === majorityAction);
            const avgConfidence = relevantSignals.reduce((sum, s) => sum + s.confidence, 0) / relevantSignals.length;
            const result = {
                consensusId: `consensus_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                symbol,
                timestamp: new Date(),
                action: majorityAction,
                confidence: avgConfidence * consensusRatio,
                participatingNodes: signals.length,
                signals: [...signals],
                weights,
                achieved: true
            };
            this.consensusHistory.push(result);
            // Clear signals for this symbol
            this.activeSignals.delete(key);
            this.logger.info('Consensus achieved', {
                consensusId: result.consensusId,
                symbol: result.symbol,
                action: result.action,
                confidence: result.confidence,
                nodes: result.participatingNodes
            });
            this.emit('consensusAchieved', result);
            // Update node reputations based on consensus
            this.updateReputations(result);
        }
    }
    /**
     * Calculate signal weight based on node reputation
     */
    calculateSignalWeight(signal) {
        if (!this.config.useReputation) {
            return 1; // Equal weight for all signals
        }
        const reputation = this.nodeReputations.get(signal.nodeId);
        if (!reputation) {
            return 0.5; // Default weight for new nodes
        }
        // Weight based on reputation score and signal confidence
        return reputation.score * signal.confidence;
    }
    /**
     * Update node reputations based on consensus
     */
    updateReputations(consensus) {
        // This is a placeholder - in practice, you'd verify against actual market outcomes
        for (const signal of consensus.signals) {
            let reputation = this.nodeReputations.get(signal.nodeId);
            if (!reputation) {
                reputation = {
                    nodeId: signal.nodeId,
                    score: 0.5,
                    signalsSubmitted: 0,
                    accurateSignals: 0,
                    lastUpdate: new Date()
                };
                this.nodeReputations.set(signal.nodeId, reputation);
            }
            reputation.signalsSubmitted++;
            // Reward nodes that agreed with consensus
            if (signal.action === consensus.action) {
                reputation.accurateSignals++;
                reputation.score = Math.min(1, reputation.score * 1.1); // Increase by 10%
            }
            else {
                reputation.score = Math.max(0.1, reputation.score * 0.9); // Decrease by 10%
            }
            reputation.lastUpdate = new Date();
        }
    }
    /**
     * Verify signal signature
     */
    async verifySignature(signal) {
        if (!signal.signature) {
            return false;
        }
        try {
            // Create message hash
            const message = JSON.stringify({
                id: signal.id,
                nodeId: signal.nodeId,
                timestamp: signal.timestamp.toISOString(),
                symbol: signal.symbol,
                action: signal.action,
                confidence: signal.confidence,
                price: signal.price,
                quantity: signal.quantity,
                timeframe: signal.timeframe
            });
            const messageHash = ethers_1.ethers.keccak256(ethers_1.ethers.toUtf8Bytes(message));
            // Recover signer address
            const recoveredAddress = ethers_1.ethers.verifyMessage(messageHash, signal.signature);
            // In practice, you'd verify the address belongs to the nodeId
            return true;
        }
        catch (error) {
            this.logger.error('Signature verification failed', { error });
            return false;
        }
    }
    /**
     * Get consensus history
     */
    getConsensusHistory(symbol, limit) {
        let history = this.consensusHistory;
        if (symbol) {
            history = history.filter(c => c.symbol === symbol);
        }
        if (limit) {
            history = history.slice(-limit);
        }
        return history;
    }
    /**
     * Get node reputation
     */
    getNodeReputation(nodeId) {
        return this.nodeReputations.get(nodeId) || null;
    }
    /**
     * Get all node reputations
     */
    getAllReputations() {
        return Array.from(this.nodeReputations.values());
    }
    /**
     * Get active signals
     */
    getActiveSignals(symbol) {
        const signals = [];
        for (const [key, symbolSignals] of this.activeSignals) {
            if (!symbol || key.startsWith(symbol + '_')) {
                signals.push(...symbolSignals);
            }
        }
        return signals;
    }
    /**
     * Calculate Byzantine fault tolerance
     */
    isByzantineTolerant(nodeCount) {
        // Byzantine fault tolerance requires 3f + 1 nodes to tolerate f faulty nodes
        const maxFaultyNodes = Math.floor((nodeCount - 1) / 3);
        return maxFaultyNodes >= this.config.byzantineTolerance;
    }
    /**
     * Get consensus metrics
     */
    getMetrics() {
        const totalConsensus = this.consensusHistory.length;
        const successfulConsensus = this.consensusHistory.filter(c => c.achieved).length;
        return {
            totalSignals: Array.from(this.activeSignals.values()).reduce((sum, signals) => sum + signals.length, 0),
            activeSymbols: this.activeSignals.size,
            totalConsensus,
            successfulConsensus,
            successRate: totalConsensus > 0 ? successfulConsensus / totalConsensus : 0,
            averageNodes: totalConsensus > 0 ?
                this.consensusHistory.reduce((sum, c) => sum + c.participatingNodes, 0) / totalConsensus : 0,
            nodeCount: this.nodeReputations.size
        };
    }
}
exports.SignalConsensus = SignalConsensus;
//# sourceMappingURL=SignalConsensus.js.map