"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NetworkPartitionSafety = void 0;
const events_1 = require("events");
class NetworkPartitionSafety extends events_1.EventEmitter {
    logger;
    nodeId;
    nodes = new Map();
    consensusState;
    log = [];
    heartbeatInterval = null;
    electionTimeout = null;
    // Configuration
    HEARTBEAT_INTERVAL = 1000; // 1 second
    ELECTION_TIMEOUT_MIN = 3000; // 3 seconds
    ELECTION_TIMEOUT_MAX = 6000; // 6 seconds
    FAILURE_THRESHOLD = 3; // missed heartbeats before suspected
    PARTITION_THRESHOLD = 5; // missed heartbeats before partitioned
    constructor(logger, nodeId, peers) {
        super();
        this.logger = logger;
        this.nodeId = nodeId;
        // Initialize consensus state
        this.consensusState = {
            term: 0,
            state: 'follower',
            commitIndex: 0,
            lastApplied: 0
        };
        // Add self to nodes
        this.nodes.set(nodeId, {
            id: nodeId,
            address: 'localhost',
            region: 'local',
            lastHeartbeat: new Date(),
            status: 'active',
            role: 'follower',
            term: 0
        });
        // Add peers
        for (const peer of peers) {
            this.nodes.set(peer.id, peer);
        }
    }
    start() {
        this.logger.info('Starting network partition safety service', {
            nodeId: this.nodeId,
            peers: Array.from(this.nodes.keys()).filter(id => id !== this.nodeId)
        });
        // Start as follower
        this.becomeFollower();
    }
    stop() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
        if (this.electionTimeout) {
            clearTimeout(this.electionTimeout);
            this.electionTimeout = null;
        }
        this.logger.info('Stopped network partition safety service');
    }
    // Raft consensus implementation
    becomeFollower() {
        this.consensusState.state = 'follower';
        this.consensusState.votedFor = undefined;
        const self = this.nodes.get(this.nodeId);
        self.role = 'follower';
        // Stop sending heartbeats
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
        // Start election timeout
        this.resetElectionTimeout();
        this.logger.info('Became follower', { term: this.consensusState.term });
        this.emit('role-change', { role: 'follower' });
    }
    becomeCandidate() {
        this.consensusState.state = 'candidate';
        this.consensusState.term++;
        this.consensusState.votedFor = this.nodeId;
        const self = this.nodes.get(this.nodeId);
        self.role = 'candidate';
        self.term = this.consensusState.term;
        this.logger.info('Became candidate', { term: this.consensusState.term });
        this.emit('role-change', { role: 'candidate' });
        // Start election
        this.startElection();
    }
    becomeLeader() {
        this.consensusState.state = 'leader';
        this.consensusState.leader = this.nodeId;
        const self = this.nodes.get(this.nodeId);
        self.role = 'leader';
        // Stop election timeout
        if (this.electionTimeout) {
            clearTimeout(this.electionTimeout);
            this.electionTimeout = null;
        }
        // Start sending heartbeats
        this.startHeartbeats();
        this.logger.info('Became leader', { term: this.consensusState.term });
        this.emit('role-change', { role: 'leader' });
        this.emit('leader-elected', { leaderId: this.nodeId });
    }
    startElection() {
        const votes = new Set([this.nodeId]); // Vote for self
        const majority = Math.floor(this.nodes.size / 2) + 1;
        // Check partition before election
        const partition = this.detectPartition();
        if (!partition.isInMajority) {
            this.logger.warn('Cannot start election - not in majority partition');
            this.becomeFollower();
            return;
        }
        // Request votes from all peers
        const voteRequest = {
            term: this.consensusState.term,
            candidateId: this.nodeId,
            lastLogIndex: this.log.length - 1,
            lastLogTerm: this.log.length > 0 ? this.log[this.log.length - 1].term : 0
        };
        for (const [nodeId, node] of this.nodes) {
            if (nodeId === this.nodeId)
                continue;
            // Simulate vote response
            this.simulateVoteResponse(nodeId, voteRequest, votes, majority);
        }
        // Reset election timeout
        this.resetElectionTimeout();
    }
    simulateVoteResponse(nodeId, request, votes, majority) {
        const node = this.nodes.get(nodeId);
        // Only active nodes can vote
        if (node.status !== 'active') {
            return;
        }
        // Simulate network delay
        setTimeout(() => {
            // Check if still candidate
            if (this.consensusState.state !== 'candidate') {
                return;
            }
            // Grant vote if term is current and haven't voted for another
            const voteGranted = request.term >= node.term && Math.random() > 0.3;
            if (voteGranted) {
                votes.add(nodeId);
                if (votes.size >= majority) {
                    this.becomeLeader();
                }
            }
        }, Math.random() * 500);
    }
    startHeartbeats() {
        this.heartbeatInterval = setInterval(() => {
            this.sendHeartbeats();
        }, this.HEARTBEAT_INTERVAL);
        // Send immediate heartbeat
        this.sendHeartbeats();
    }
    sendHeartbeats() {
        const heartbeat = {
            nodeId: this.nodeId,
            term: this.consensusState.term,
            timestamp: new Date(),
            commitIndex: this.consensusState.commitIndex,
            entries: []
        };
        for (const [nodeId, node] of this.nodes) {
            if (nodeId === this.nodeId)
                continue;
            // Simulate sending heartbeat
            this.simulateHeartbeatResponse(nodeId, heartbeat);
        }
        // Check for partition
        this.checkNodeHealth();
    }
    simulateHeartbeatResponse(nodeId, heartbeat) {
        const node = this.nodes.get(nodeId);
        // Simulate network conditions
        const isReachable = Math.random() > 0.1; // 90% success rate
        if (isReachable) {
            node.lastHeartbeat = new Date();
            node.status = 'active';
        }
    }
    resetElectionTimeout() {
        if (this.electionTimeout) {
            clearTimeout(this.electionTimeout);
        }
        const timeout = this.ELECTION_TIMEOUT_MIN +
            Math.random() * (this.ELECTION_TIMEOUT_MAX - this.ELECTION_TIMEOUT_MIN);
        this.electionTimeout = setTimeout(() => {
            if (this.consensusState.state === 'follower') {
                this.becomeCandidate();
            }
        }, timeout);
    }
    checkNodeHealth() {
        const now = Date.now();
        const activeNodes = new Set();
        const suspectedNodes = new Set();
        const failedNodes = new Set();
        for (const [nodeId, node] of this.nodes) {
            if (nodeId === this.nodeId) {
                activeNodes.add(nodeId);
                continue;
            }
            const timeSinceLastHeartbeat = now - node.lastHeartbeat.getTime();
            const missedHeartbeats = Math.floor(timeSinceLastHeartbeat / this.HEARTBEAT_INTERVAL);
            if (missedHeartbeats < this.FAILURE_THRESHOLD) {
                node.status = 'active';
                activeNodes.add(nodeId);
            }
            else if (missedHeartbeats < this.PARTITION_THRESHOLD) {
                node.status = 'suspected';
                suspectedNodes.add(nodeId);
            }
            else {
                node.status = 'failed';
                failedNodes.add(nodeId);
            }
        }
        // Detect partition
        if (failedNodes.size > 0 || suspectedNodes.size > 0) {
            const partition = this.detectPartition();
            if (partition.action !== 'continue') {
                this.handlePartition(partition);
            }
        }
    }
    detectPartition() {
        const activeNodes = new Set();
        for (const [nodeId, node] of this.nodes) {
            if (node.status === 'active' || nodeId === this.nodeId) {
                activeNodes.add(nodeId);
            }
        }
        // Simple partition detection - in production, use more sophisticated algorithms
        const totalNodes = this.nodes.size;
        const activeCount = activeNodes.size;
        const majority = Math.floor(totalNodes / 2) + 1;
        const isInMajority = activeCount >= majority;
        let action = 'continue';
        if (!isInMajority) {
            // We're in minority partition
            if (this.consensusState.state === 'leader') {
                action = 'readonly'; // Step down and go read-only
            }
            else {
                action = 'readonly';
            }
        }
        else if (activeCount < totalNodes * 0.6) {
            // Lost significant portion of cluster
            action = 'readonly';
        }
        const detection = {
            timestamp: new Date(),
            partitions: [activeNodes],
            largestPartition: activeNodes,
            isInMajority,
            action
        };
        if (action !== 'continue') {
            this.logger.warn('Network partition detected', {
                activeNodes: activeCount,
                totalNodes,
                isInMajority,
                action
            });
            this.emit('partition-detected', detection);
        }
        return detection;
    }
    handlePartition(partition) {
        switch (partition.action) {
            case 'readonly':
                this.enterReadOnlyMode();
                break;
            case 'shutdown':
                this.shutdown();
                break;
        }
    }
    enterReadOnlyMode() {
        this.logger.warn('Entering read-only mode due to partition');
        // Step down if leader
        if (this.consensusState.state === 'leader') {
            this.becomeFollower();
        }
        this.emit('readonly-mode', {
            reason: 'network-partition',
            timestamp: new Date()
        });
    }
    shutdown() {
        this.logger.error('Shutting down due to severe network partition');
        this.stop();
        this.emit('shutdown', {
            reason: 'network-partition',
            timestamp: new Date()
        });
    }
    // Public methods for external interaction
    receiveHeartbeat(heartbeat) {
        const node = this.nodes.get(heartbeat.nodeId);
        if (!node) {
            this.logger.warn('Received heartbeat from unknown node', { nodeId: heartbeat.nodeId });
            return;
        }
        // Update node info
        node.lastHeartbeat = new Date();
        node.status = 'active';
        node.term = heartbeat.term;
        // Handle term updates
        if (heartbeat.term > this.consensusState.term) {
            this.consensusState.term = heartbeat.term;
            this.becomeFollower();
        }
        // Reset election timeout if follower
        if (this.consensusState.state === 'follower') {
            this.resetElectionTimeout();
        }
        // Update commit index
        if (heartbeat.commitIndex > this.consensusState.commitIndex) {
            this.consensusState.commitIndex = Math.min(heartbeat.commitIndex, this.log.length - 1);
            this.applyCommittedEntries();
        }
    }
    receiveVoteRequest(request) {
        // Update term if necessary
        if (request.term > this.consensusState.term) {
            this.consensusState.term = request.term;
            this.consensusState.votedFor = undefined;
            this.becomeFollower();
        }
        // Grant vote if haven't voted and candidate's log is up to date
        const canVote = request.term === this.consensusState.term &&
            (this.consensusState.votedFor === undefined ||
                this.consensusState.votedFor === request.candidateId);
        if (canVote) {
            this.consensusState.votedFor = request.candidateId;
            this.resetElectionTimeout();
            return true;
        }
        return false;
    }
    appendEntry(command) {
        if (this.consensusState.state !== 'leader') {
            return false;
        }
        const entry = {
            index: this.log.length,
            term: this.consensusState.term,
            command,
            timestamp: new Date()
        };
        this.log.push(entry);
        // In production, replicate to followers
        this.emit('entry-appended', entry);
        return true;
    }
    applyCommittedEntries() {
        while (this.consensusState.lastApplied < this.consensusState.commitIndex) {
            this.consensusState.lastApplied++;
            const entry = this.log[this.consensusState.lastApplied];
            if (entry) {
                this.emit('entry-committed', entry);
            }
        }
    }
    // Query methods
    getNodeStatus() {
        return new Map(this.nodes);
    }
    getConsensusState() {
        return { ...this.consensusState };
    }
    isLeader() {
        return this.consensusState.state === 'leader';
    }
    getLeader() {
        return this.consensusState.leader;
    }
    isHealthy() {
        const partition = this.detectPartition();
        return partition.isInMajority && partition.action === 'continue';
    }
}
exports.NetworkPartitionSafety = NetworkPartitionSafety;
//# sourceMappingURL=NetworkPartitionSafety.js.map