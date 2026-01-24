"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReputationSystem = exports.ReputationTier = void 0;
const events_1 = require("events");
/**
 * Reputation tier
 */
var ReputationTier;
(function (ReputationTier) {
    ReputationTier["UNTRUSTED"] = "untrusted";
    ReputationTier["NOVICE"] = "novice";
    ReputationTier["CONTRIBUTOR"] = "contributor";
    ReputationTier["TRUSTED"] = "trusted";
    ReputationTier["EXPERT"] = "expert";
    ReputationTier["MASTER"] = "master";
})(ReputationTier || (exports.ReputationTier = ReputationTier = {}));
/**
 * Reputation system for node trust management
 */
class ReputationSystem extends events_1.EventEmitter {
    config;
    logger;
    nodeScores = new Map();
    nodePerformance = new Map();
    reputationHistory = new Map();
    decayTimer = null;
    constructor(config, logger) {
        super();
        this.config = config;
        this.logger = logger;
    }
    /**
     * Start reputation system
     */
    start() {
        // Start daily decay timer
        this.decayTimer = setInterval(() => {
            this.applyDecay();
        }, 24 * 60 * 60 * 1000); // Daily
        this.logger.info('Reputation system started', {
            initialScore: this.config.initialScore,
            decayRate: this.config.decayRate
        });
    }
    /**
     * Stop reputation system
     */
    stop() {
        if (this.decayTimer) {
            clearInterval(this.decayTimer);
            this.decayTimer = null;
        }
    }
    /**
     * Register a new node
     */
    registerNode(nodeId) {
        if (this.nodeScores.has(nodeId)) {
            return; // Already registered
        }
        this.nodeScores.set(nodeId, this.config.initialScore);
        this.nodePerformance.set(nodeId, {
            nodeId,
            totalSignals: 0,
            accurateSignals: 0,
            profitableSignals: 0,
            avgSignalQuality: 0,
            uptime: 1,
            responseTime: 0,
            dataContribution: 0,
            consensusParticipation: 0,
            consensusAgreement: 0,
            lastActive: new Date(),
            joinedAt: new Date()
        });
        this.logger.info('Node registered', { nodeId, initialScore: this.config.initialScore });
        this.emit('nodeRegistered', { nodeId, score: this.config.initialScore });
    }
    /**
     * Update node reputation based on signal performance
     */
    updateSignalPerformance(nodeId, accurate, profitable, quality) {
        const performance = this.nodePerformance.get(nodeId);
        if (!performance) {
            this.registerNode(nodeId);
            return;
        }
        // Update performance metrics
        performance.totalSignals++;
        if (accurate)
            performance.accurateSignals++;
        if (profitable)
            performance.profitableSignals++;
        // Update average quality
        performance.avgSignalQuality =
            (performance.avgSignalQuality * (performance.totalSignals - 1) + quality) /
                performance.totalSignals;
        performance.lastActive = new Date();
        // Calculate reputation change
        const factors = {
            accuracy: accurate ? 0.1 : -0.05,
            profitability: profitable ? 0.15 : -0.1,
            quality: (quality - 0.5) * 0.2
        };
        const totalChange = Object.values(factors).reduce((sum, f) => sum + f, 0);
        this.updateReputation(nodeId, totalChange, 'signal_performance', factors);
    }
    /**
     * Update node reputation based on consensus participation
     */
    updateConsensusParticipation(nodeId, participated, agreedWithConsensus) {
        const performance = this.nodePerformance.get(nodeId);
        if (!performance) {
            this.registerNode(nodeId);
            return;
        }
        if (participated) {
            performance.consensusParticipation++;
            if (agreedWithConsensus) {
                performance.consensusAgreement++;
            }
        }
        performance.lastActive = new Date();
        // Calculate reputation change
        const factors = {
            participation: participated ? 0.05 : -0.02,
            agreement: agreedWithConsensus ? 0.1 : 0
        };
        const totalChange = Object.values(factors).reduce((sum, f) => sum + f, 0);
        this.updateReputation(nodeId, totalChange, 'consensus_participation', factors);
    }
    /**
     * Update node reputation based on network contribution
     */
    updateNetworkContribution(nodeId, uptime, responseTime, dataShared) {
        const performance = this.nodePerformance.get(nodeId);
        if (!performance) {
            this.registerNode(nodeId);
            return;
        }
        // Update metrics
        performance.uptime = uptime;
        performance.responseTime = responseTime;
        performance.dataContribution += dataShared;
        performance.lastActive = new Date();
        // Calculate reputation change
        const factors = {
            uptime: (uptime - 0.95) * 2, // Reward high uptime
            responseTime: responseTime < 100 ? 0.05 : -0.05, // Reward low latency
            dataContribution: Math.min(0.1, dataShared / 1000) // Cap contribution reward
        };
        const totalChange = Object.values(factors).reduce((sum, f) => sum + f, 0);
        this.updateReputation(nodeId, totalChange, 'network_contribution', factors);
    }
    /**
     * Update reputation score
     */
    updateReputation(nodeId, change, reason, factors) {
        const currentScore = this.nodeScores.get(nodeId) || this.config.initialScore;
        const newScore = Math.max(this.config.minScore, Math.min(this.config.maxScore, currentScore + change));
        this.nodeScores.set(nodeId, newScore);
        // Record update
        const update = {
            nodeId,
            previousScore: currentScore,
            newScore,
            reason,
            factors,
            timestamp: new Date()
        };
        let history = this.reputationHistory.get(nodeId);
        if (!history) {
            history = [];
            this.reputationHistory.set(nodeId, history);
        }
        history.push(update);
        // Emit events
        this.emit('reputationUpdated', update);
        // Check for tier change
        const previousTier = this.getReputationTier(currentScore);
        const newTier = this.getReputationTier(newScore);
        if (previousTier !== newTier) {
            this.emit('tierChanged', {
                nodeId,
                previousTier,
                newTier,
                score: newScore
            });
            this.logger.info('Node tier changed', {
                nodeId,
                previousTier,
                newTier,
                score: newScore
            });
        }
    }
    /**
     * Apply reputation decay
     */
    applyDecay() {
        const now = Date.now();
        for (const [nodeId, performance] of Array.from(this.nodePerformance)) {
            const daysSinceActive = (now - performance.lastActive.getTime()) / (24 * 60 * 60 * 1000);
            // Apply decay for inactive nodes
            if (daysSinceActive > 1) {
                const decayFactor = Math.min(1, daysSinceActive * this.config.decayRate / 100);
                const currentScore = this.nodeScores.get(nodeId) || this.config.initialScore;
                const decay = currentScore * decayFactor;
                this.updateReputation(nodeId, -decay, 'inactivity_decay', {
                    daysSinceActive,
                    decayAmount: decay
                });
            }
            // Check minimum activity threshold
            const recentSignals = this.getRecentSignalCount(nodeId);
            if (recentSignals < this.config.minActivityThreshold) {
                this.updateReputation(nodeId, -0.1, 'low_activity', {
                    recentSignals,
                    threshold: this.config.minActivityThreshold
                });
            }
        }
    }
    /**
     * Get recent signal count
     */
    getRecentSignalCount(nodeId) {
        // This is a placeholder - in practice, track signals over time
        const performance = this.nodePerformance.get(nodeId);
        return performance ? performance.totalSignals : 0;
    }
    /**
     * Get reputation tier
     */
    getReputationTier(score) {
        const maxScore = this.config.maxScore;
        if (score < maxScore * 0.2)
            return ReputationTier.UNTRUSTED;
        if (score < maxScore * 0.4)
            return ReputationTier.NOVICE;
        if (score < maxScore * 0.6)
            return ReputationTier.CONTRIBUTOR;
        if (score < maxScore * 0.8)
            return ReputationTier.TRUSTED;
        if (score < maxScore * 0.95)
            return ReputationTier.EXPERT;
        return ReputationTier.MASTER;
    }
    /**
     * Get node reputation
     */
    getNodeReputation(nodeId) {
        const score = this.nodeScores.get(nodeId);
        const performance = this.nodePerformance.get(nodeId);
        if (!score || !performance) {
            return null;
        }
        return {
            nodeId,
            score,
            tier: this.getReputationTier(score),
            performance,
            history: this.reputationHistory.get(nodeId) || []
        };
    }
    /**
     * Get all node reputations
     */
    getAllReputations() {
        const reputations = [];
        for (const [nodeId, score] of Array.from(this.nodeScores)) {
            const reputation = this.getNodeReputation(nodeId);
            if (reputation) {
                reputations.push(reputation);
            }
        }
        return reputations.sort((a, b) => b.score - a.score);
    }
    /**
     * Get nodes by tier
     */
    getNodesByTier(tier) {
        const nodes = [];
        for (const [nodeId, score] of Array.from(this.nodeScores)) {
            if (this.getReputationTier(score) === tier) {
                nodes.push(nodeId);
            }
        }
        return nodes;
    }
    /**
     * Check if node is trusted
     */
    isNodeTrusted(nodeId, minTier = ReputationTier.CONTRIBUTOR) {
        const score = this.nodeScores.get(nodeId);
        if (!score)
            return false;
        const tier = this.getReputationTier(score);
        const tierOrder = Object.values(ReputationTier);
        return tierOrder.indexOf(tier) >= tierOrder.indexOf(minTier);
    }
    /**
     * Get reputation metrics
     */
    getMetrics() {
        const nodes = Array.from(this.nodeScores.entries());
        const scores = nodes.map(([_, score]) => score);
        const tierCounts = new Map();
        for (const tier of Object.values(ReputationTier)) {
            tierCounts.set(tier, this.getNodesByTier(tier).length);
        }
        return {
            totalNodes: nodes.length,
            averageScore: scores.reduce((sum, s) => sum + s, 0) / nodes.length,
            medianScore: this.calculateMedian(scores),
            tierDistribution: Object.fromEntries(tierCounts),
            activeNodes: Array.from(this.nodePerformance.values()).filter(p => Date.now() - p.lastActive.getTime() < 24 * 60 * 60 * 1000).length
        };
    }
    /**
     * Calculate median
     */
    calculateMedian(values) {
        if (values.length === 0)
            return 0;
        const sorted = [...values].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 0
            ? (sorted[mid - 1] + sorted[mid]) / 2
            : sorted[mid];
    }
}
exports.ReputationSystem = ReputationSystem;
//# sourceMappingURL=ReputationSystem.js.map