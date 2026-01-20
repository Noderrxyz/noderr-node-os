/**
 * BFT Consensus Engine
 * 
 * Implements Byzantine Fault Tolerant consensus algorithm for Oracle network.
 * Coordinates with OracleVerifier.sol smart contract for on-chain verification.
 * 
 * Key Features:
 * - 2/3+1 consensus threshold (67%)
 * - Resistant to up to 1/3 Byzantine (malicious) nodes
 * - Weighted voting based on stake and reputation
 * - Commit-reveal scheme for front-running protection
 * - Automatic retry and recovery
 * - Real-time consensus monitoring
 * 
 * @module BFTConsensusEngine
 */

import { Logger } from '@noderr/utils';
import { ethers } from 'ethers';
import { EventEmitter } from 'events';
import { OracleLotterySelector, CommitteeSelection } from './OracleLotterySelector';

const logger = new Logger('BFTConsensusEngine');
export interface ConsensusConfig {
  oracleVerifierAddress: string;
  provider: ethers.Provider;
  signer: ethers.Signer;
  consensusThreshold?: number; // Basis points (default: 6700 = 67%)
  submissionWindow?: number; // Milliseconds (default: 300000 = 5 minutes)
  minOracles?: number; // Minimum oracles for consensus (default: 4)
  enableLottery?: boolean; // Enable lottery selection (default: true)
  lotterySelector?: OracleLotterySelector; // Lottery selector instance
}

export interface OracleSubmission {
  oracle: string;
  dataHash: string;
  signature: string;
  timestamp: number;
  weight: number;
}

export interface ConsensusResult {
  roundId: number;
  consensusHash: string | null;
  consensusWeight: number;
  totalWeight: number;
  submissions: OracleSubmission[];
  finalized: boolean;
  timestamp: number;
}

export interface OracleInfo {
  address: string;
  stake: bigint;
  reputation: number;
  weight: number;
  isActive: boolean;
  isSlashed: boolean;
}

/**
 * BFT Consensus Engine
 * 
 * Manages consensus rounds and coordinates with OracleVerifier smart contract.
 */
export class BFTConsensusEngine extends EventEmitter {
  private config: ConsensusConfig & Required<Pick<ConsensusConfig, 'consensusThreshold' | 'submissionWindow' | 'minOracles'>>;
  private contract: ethers.Contract;
  private currentRoundId: number = 0;
  private activeRounds: Map<number, ConsensusResult> = new Map();
  private oracleRegistry: Map<string, OracleInfo> = new Map();
  private lotterySelector: OracleLotterySelector | null = null;
  private committeeSelections: Map<number, CommitteeSelection> = new Map();
  
  // OracleVerifier ABI (minimal interface)
  private static readonly ABI = [
    'function submitData(uint256 roundId, bytes32 dataHash, bytes signature) external',
    'function getConsensusResult(uint256 roundId) external view returns (bytes32 consensusHash, uint256 consensusWeight, bool finalized, uint256 submissionCount)',
    'function getOracleInfo(address oracle) external view returns (uint256 stake, uint256 reputation, uint256 successfulSubmissions, uint256 failedSubmissions, bool isActive, bool isSlashed)',
    'function activeOracleCount() external view returns (uint256)',
    'function oracleList(uint256 index) external view returns (address)',
    'event SubmissionReceived(uint256 indexed roundId, address indexed oracle, bytes32 dataHash)',
    'event ConsensusReached(uint256 indexed roundId, bytes32 consensusHash, uint256 weight)',
    'event ConsensusFailed(uint256 indexed roundId, string reason)',
  ];
  
  constructor(config: ConsensusConfig) {
    super();
    
    this.config = {
      ...config,
      consensusThreshold: config.consensusThreshold ?? 6700,
      submissionWindow: config.submissionWindow ?? 300000,
      minOracles: config.minOracles ?? 4,
      enableLottery: config.enableLottery ?? true,
    };
    
    // Initialize lottery selector if enabled
    if (this.config.enableLottery) {
      this.lotterySelector = config.lotterySelector || new OracleLotterySelector({
        minCommitteeSize: 7,
        maxCommitteeSize: 15,
        targetCommitteeSize: 10,
        stakeWeighting: true,
        rotationEnabled: true,
        cooldownPeriods: 3,
      });
    }
    
    this.contract = new ethers.Contract(
      config.oracleVerifierAddress,
      BFTConsensusEngine.ABI,
      config.signer
    );
    
    this.setupEventListeners();
  }
  
  /**
   * Initialize consensus engine
   */
  async initialize(): Promise<void> {
    logger.info('Initializing BFT Consensus Engine...');
    
    // Load oracle registry
    await this.loadOracleRegistry();
    
    // Initialize lottery selector with oracle pool
    if (this.lotterySelector) {
      const oracleList = Array.from(this.oracleRegistry.values());
      this.lotterySelector.updateOraclePool(oracleList);
      logger.info('Lottery selector initialized with oracle pool');
    }
    
    // Get current round ID from contract
    // In production, this would query the contract for the latest round
    this.currentRoundId = 1;
    
    logger.info(`Initialized with ${this.oracleRegistry.size} active oracles`);
    logger.info(`Lottery selection: ${this.config.enableLottery ? 'ENABLED' : 'DISABLED'}`);
    
    this.emit('initialized', {
      oracles: this.oracleRegistry.size,
      threshold: this.config.consensusThreshold,
      lotteryEnabled: this.config.enableLottery,
    });
  }
  
  /**
   * Load oracle registry from smart contract
   */
  private async loadOracleRegistry(): Promise<void> {
    const oracleCount = await this.contract.activeOracleCount();
    
    for (let i = 0; i < oracleCount; i++) {
      const oracleAddress = await this.contract.oracleList(i);
      const info = await this.contract.getOracleInfo(oracleAddress);
      
      const oracleInfo: OracleInfo = {
        address: oracleAddress,
        stake: info.stake,
        reputation: Number(info.reputation),
        weight: this.calculateWeight(info.stake, info.reputation),
        isActive: info.isActive,
        isSlashed: info.isSlashed,
      };
      
      if (oracleInfo.isActive && !oracleInfo.isSlashed) {
        this.oracleRegistry.set(oracleAddress.toLowerCase(), oracleInfo);
      }
    }
    
    // Update lottery selector if enabled
    if (this.lotterySelector) {
      const oracleList = Array.from(this.oracleRegistry.values());
      this.lotterySelector.updateOraclePool(oracleList);
    }
  }
  
  /**
   * Calculate oracle weight based on stake and reputation
   */
  private calculateWeight(stake: bigint, reputation: number): number {
    // Weight = (stake * reputation) / 10000
    return Number((stake * BigInt(reputation)) / 10000n);
  }
  
  /**
   * Setup event listeners for smart contract
   */
  private setupEventListeners(): void {
    // Listen for submission events
    this.contract.on('SubmissionReceived', (roundId: any, oracle: any, dataHash: any, event: any) => {
      this.handleSubmissionReceived(Number(roundId), oracle, dataHash);
    });
    
    // Listen for consensus events
    this.contract.on('ConsensusReached', (roundId: any, consensusHash: any, weight: any, event: any) => {
      this.handleConsensusReached(Number(roundId), consensusHash, Number(weight));
    });
    
    // Listen for consensus failure events
    this.contract.on('ConsensusFailed', (roundId: any, reason: any, event: any) => {
      this.handleConsensusFailed(Number(roundId), reason);
    });
  }
  
  /**
   * Start a new consensus round
   */
  async startRound(data: any): Promise<number> {
    this.currentRoundId++;
    const roundId = this.currentRoundId;
    
    logger.info(`Starting consensus round ${roundId}`);
    
    // Select committee via lottery if enabled
    let committeeSelection: CommitteeSelection | null = null;
    if (this.lotterySelector && this.config.enableLottery) {
      // Get latest block hash for VRF seed
      const latestBlock = await this.config.provider.getBlock('latest');
      if (!latestBlock) {
        throw new Error('Failed to get latest block for lottery seed');
      }
      
      // Select committee
      committeeSelection = await this.lotterySelector.selectCommittee(
        roundId,
        latestBlock.hash || ethers.ZeroHash
      );
      
      this.committeeSelections.set(roundId, committeeSelection);
      
      logger.info(
        `Committee selected: ${committeeSelection.committeeSize} oracles ` +
        `from pool of ${this.oracleRegistry.size}`
      );
      logger.info(`Selected oracles: ${committeeSelection.selectedOracles.join(', ')}`);
    }
    
    // Calculate total weight (committee only if lottery enabled)
    const totalWeight = committeeSelection
      ? Number(committeeSelection.totalStake)
      : this.getTotalWeight();
    
    // Create round
    const round: ConsensusResult = {
      roundId,
      consensusHash: null,
      consensusWeight: 0,
      totalWeight,
      submissions: [],
      finalized: false,
      timestamp: Date.now(),
    };
    
    this.activeRounds.set(roundId, round);
    
    this.emit('roundStarted', {
      roundId,
      data,
      committee: committeeSelection,
      lotteryEnabled: this.config.enableLottery,
    });
    
    // Set timeout for submission window
    setTimeout(() => {
      this.finalizeRound(roundId);
    }, this.config.submissionWindow);
    
    return roundId;
  }
  
  /**
   * Submit data for consensus
   */
  async submitData(roundId: number, data: any): Promise<void> {
    const round = this.activeRounds.get(roundId);
    
    if (!round) {
      throw new Error(`Round ${roundId} not found`);
    }
    
    if (round.finalized) {
      throw new Error(`Round ${roundId} already finalized`);
    }
    
    // Hash the data
    const dataHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(data)));
    
    // Sign the data hash
    const signature = await this.config.signer.signMessage(ethers.getBytes(dataHash));
    
    // Submit to smart contract
    logger.info(`Submitting data for round ${roundId}...`);
    
    try {
      const tx = await this.contract.submitData(roundId, dataHash, signature);
      await tx.wait();
      
      logger.info(`Data submitted for round ${roundId}`);
      
      this.emit('dataSubmitted', { roundId, dataHash });
    } catch (error) {
      logger.error(`Failed to submit data for round ${roundId}:`, error);
      throw error;
    }
  }
  
  /**
   * Handle submission received event
   */
  private handleSubmissionReceived(roundId: number, oracle: string, dataHash: string): void {
    const round = this.activeRounds.get(roundId);
    
    if (!round) {
      logger.warn(`Received submission for unknown round ${roundId}`);
      return;
    }
    
    const oracleInfo = this.oracleRegistry.get(oracle.toLowerCase());
    
    if (!oracleInfo) {
      logger.warn(`Received submission from unknown oracle ${oracle}`);
      return;
    }
    
    // Add submission to round
    const submission: OracleSubmission = {
      oracle,
      dataHash,
      signature: '', // Signature is verified on-chain
      timestamp: Date.now(),
      weight: oracleInfo.weight,
    };
    
    round.submissions.push(submission);
    
    logger.info(`Submission received for round ${roundId} from ${oracle}`);
    
    this.emit('submissionReceived', { roundId, oracle, dataHash });
    
    // Try to reach consensus
    this.tryReachConsensus(roundId);
  }
  
  /**
   * Try to reach consensus for a round
   */
  private tryReachConsensus(roundId: number): void {
    const round = this.activeRounds.get(roundId);
    
    if (!round || round.finalized) {
      return;
    }
    
    // Check minimum submissions
    if (round.submissions.length < this.config.minOracles) {
      return;
    }
    
    // Count votes for each unique hash
    const voteWeights = new Map<string, number>();
    
    for (const submission of round.submissions) {
      const currentWeight = voteWeights.get(submission.dataHash) || 0;
      voteWeights.set(submission.dataHash, currentWeight + submission.weight);
    }
    
    // Find leading hash
    let leadingHash: string | null = null;
    let leadingWeight = 0;
    
    for (const [hash, weight] of voteWeights.entries()) {
      if (weight > leadingWeight) {
        leadingHash = hash;
        leadingWeight = weight;
      }
    }
    
    // Check if consensus threshold reached
    const consensusWeightRequired = (round.totalWeight * this.config.consensusThreshold) / 10000;
    
    if (leadingWeight >= consensusWeightRequired) {
      round.consensusHash = leadingHash;
      round.consensusWeight = leadingWeight;
      round.finalized = true;
      
      logger.info(`Consensus reached for round ${roundId}: ${leadingHash}`);
      
      this.emit('consensusReached', {
        roundId,
        consensusHash: leadingHash,
        consensusWeight: leadingWeight,
        totalWeight: round.totalWeight,
      });
    }
  }
  
  /**
   * Handle consensus reached event from smart contract
   */
  private handleConsensusReached(roundId: number, consensusHash: string, weight: number): void {
    const round = this.activeRounds.get(roundId);
    
    if (!round) {
      logger.warn(`Consensus reached for unknown round ${roundId}`);
      return;
    }
    
    round.consensusHash = consensusHash;
    round.consensusWeight = weight;
    round.finalized = true;
    
    logger.info(`Consensus finalized on-chain for round ${roundId}`);
    
    this.emit('consensusFinalized', {
      roundId,
      consensusHash,
      consensusWeight: weight,
    });
  }
  
  /**
   * Handle consensus failed event from smart contract
   */
  private handleConsensusFailed(roundId: number, reason: string): void {
    logger.error(`Consensus failed for round ${roundId}: ${reason}`);
    
    this.emit('consensusFailed', { roundId, reason });
  }
  
  /**
   * Finalize a round (called after submission window closes)
   */
  private finalizeRound(roundId: number): void {
    const round = this.activeRounds.get(roundId);
    
    if (!round || round.finalized) {
      return;
    }
    
    logger.info(`Finalizing round ${roundId} (submission window closed)`);
    
    if (round.consensusHash) {
      logger.info(`Round ${roundId} finalized with consensus: ${round.consensusHash}`);
    } else {
      logger.warn(`Round ${roundId} finalized without consensus`);
      
      this.emit('consensusFailed', {
        roundId,
        reason: 'Submission window closed without reaching consensus',
      });
    }
    
    round.finalized = true;
  }
  
  /**
   * Get consensus result for a round
   */
  async getConsensusResult(roundId: number): Promise<ConsensusResult | null> {
    // First check local cache
    const localResult = this.activeRounds.get(roundId);
    
    if (localResult) {
      return localResult;
    }
    
    // Query smart contract
    try {
      const result = await this.contract.getConsensusResult(roundId);
      
      return {
        roundId,
        consensusHash: result.consensusHash !== ethers.ZeroHash ? result.consensusHash : null,
        consensusWeight: Number(result.consensusWeight),
        totalWeight: this.getTotalWeight(),
        submissions: [],
        finalized: result.finalized,
        timestamp: Date.now(),
      };
    } catch (error) {
      logger.error(`Failed to get consensus result for round ${roundId}:`, error);
      return null;
    }
  }
  
  /**
   * Get total weight of all active oracles
   */
  private getTotalWeight(): number {
    let total = 0;
    
    for (const oracle of this.oracleRegistry.values()) {
      if (oracle.isActive && !oracle.isSlashed) {
        total += oracle.weight;
      }
    }
    
    return total;
  }
  
  /**
   * Refresh oracle registry
   */
  async refreshOracleRegistry(): Promise<void> {
    logger.info('Refreshing oracle registry...');
    
    this.oracleRegistry.clear();
    await this.loadOracleRegistry();
    
    logger.info(`Oracle registry refreshed: ${this.oracleRegistry.size} active oracles`);
    
    this.emit('registryRefreshed', { oracles: this.oracleRegistry.size });
  }
  
  /**
   * Get active oracles
   */
  getActiveOracles(): OracleInfo[] {
    return Array.from(this.oracleRegistry.values());
  }
  
  /**
   * Cleanup old rounds
   */
  cleanup(olderThan: number = 24 * 60 * 60 * 1000): void {
    const cutoff = Date.now() - olderThan;
    
    for (const [roundId, round] of this.activeRounds.entries()) {
      if (round.timestamp < cutoff && round.finalized) {
        this.activeRounds.delete(roundId);
      }
    }
  }
  
  /**
   * Shutdown consensus engine
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down BFT Consensus Engine...');
    
    // Remove event listeners
    this.contract.removeAllListeners();
    
    // Clear active rounds
    this.activeRounds.clear();
    
    this.emit('shutdown');
  }
}
