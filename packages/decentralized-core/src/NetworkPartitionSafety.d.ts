import { EventEmitter } from 'events';
import * as winston from 'winston';
export interface NodeInfo {
    id: string;
    address: string;
    region: string;
    lastHeartbeat: Date;
    status: 'active' | 'suspected' | 'failed' | 'partitioned';
    role: 'leader' | 'follower' | 'candidate';
    term: number;
    votedFor?: string;
}
export interface PartitionDetection {
    timestamp: Date;
    partitions: Set<string>[];
    largestPartition: Set<string>;
    isInMajority: boolean;
    action: 'continue' | 'readonly' | 'shutdown';
}
export interface ConsensusState {
    term: number;
    leader?: string;
    votedFor?: string;
    commitIndex: number;
    lastApplied: number;
    state: 'follower' | 'candidate' | 'leader';
}
export interface HeartbeatMessage {
    nodeId: string;
    term: number;
    timestamp: Date;
    commitIndex: number;
    entries: LogEntry[];
}
export interface VoteRequest {
    term: number;
    candidateId: string;
    lastLogIndex: number;
    lastLogTerm: number;
}
export interface LogEntry {
    index: number;
    term: number;
    command: any;
    timestamp: Date;
}
export declare class NetworkPartitionSafety extends EventEmitter {
    private logger;
    private nodeId;
    private nodes;
    private consensusState;
    private log;
    private heartbeatInterval;
    private electionTimeout;
    private readonly HEARTBEAT_INTERVAL;
    private readonly ELECTION_TIMEOUT_MIN;
    private readonly ELECTION_TIMEOUT_MAX;
    private readonly FAILURE_THRESHOLD;
    private readonly PARTITION_THRESHOLD;
    constructor(logger: winston.Logger, nodeId: string, peers: NodeInfo[]);
    start(): void;
    stop(): void;
    private becomeFollower;
    private becomeCandidate;
    private becomeLeader;
    private startElection;
    private simulateVoteResponse;
    private startHeartbeats;
    private sendHeartbeats;
    private simulateHeartbeatResponse;
    private resetElectionTimeout;
    private checkNodeHealth;
    detectPartition(): PartitionDetection;
    private handlePartition;
    private enterReadOnlyMode;
    private shutdown;
    receiveHeartbeat(heartbeat: HeartbeatMessage): void;
    receiveVoteRequest(request: VoteRequest): boolean;
    appendEntry(command: any): boolean;
    private applyCommittedEntries;
    getNodeStatus(): Map<string, NodeInfo>;
    getConsensusState(): ConsensusState;
    isLeader(): boolean;
    getLeader(): string | undefined;
    isHealthy(): boolean;
}
//# sourceMappingURL=NetworkPartitionSafety.d.ts.map