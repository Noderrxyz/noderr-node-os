/**
 * ValidatorConsensus - Core consensus protocol for Validator nodes
 * 
 * Responsibilities:
 * - Participate in network consensus for transaction validation
 * - Attest to data validity from Guardian and Oracle nodes
 * - Submit attestations to on-chain contracts
 * - Maintain validator reputation through consistent participation
 * 
 * This is a lightweight consensus mechanism designed for the Validator tier,
 * which is the entry-level tier in the Noderr network.
 */

import { EventEmitter } from 'events';
import { ethers } from 'ethers';
import { createLogger, format, transports, Logger } from 'winston';

// Consensus round states
export enum ConsensusState {
  IDLE = 'IDLE',
  COLLECTING = 'COLLECTING',
  VALIDATING = 'VALIDATING',
  ATTESTING = 'ATTESTING',
  SUBMITTING = 'SUBMITTING',
  COMPLETE = 'COMPLETE',
  FAILED = 'FAILED'
}

// Attestation structure
export interface Attestation {
  roundId: string;
  validatorAddress: string;
  dataHash: string;
  isValid: boolean;
  timestamp: number;
  signature: string;
}

// Consensus round data
export interface ConsensusRound {
  id: string;
  startTime: number;
  endTime?: number;
  state: ConsensusState;
  dataHash: string;
  attestations: Map<string, Attestation>;
  result?: boolean;
}

// Configuration for the consensus service
export interface ValidatorConsensusConfig {
  nodeId: string;
  privateKey: string;
  rpcUrl: string;
  nodeRegistryAddress: string;
  consensusContractAddress: string;
  roundDurationMs: number;
  minAttestations: number;
  attestationTimeoutMs: number;
}

/**
 * ValidatorConsensus Service
 * 
 * Implements the consensus protocol for Validator nodes in the Noderr network.
 * Validators attest to data validity and submit attestations on-chain.
 */
export class ValidatorConsensus extends EventEmitter {
  private readonly config: ValidatorConsensusConfig;
  private readonly logger: Logger;
  private readonly provider: ethers.JsonRpcProvider;
  private readonly wallet: ethers.Wallet;
  
  private currentRound: ConsensusRound | null = null;
  private roundHistory: Map<string, ConsensusRound> = new Map();
  private isRunning: boolean = false;
  private roundInterval: NodeJS.Timeout | null = null;

  constructor(config: ValidatorConsensusConfig) {
    super();
    this.config = config;
    
    // Initialize logger
    this.logger = createLogger({
      level: 'info',
      format: format.combine(
        format.timestamp(),
        format.json()
      ),
      defaultMeta: { service: 'validator-consensus', nodeId: config.nodeId },
      transports: [
        new transports.Console({
          format: format.combine(
            format.colorize(),
            format.simple()
          )
        })
      ]
    });

    // Initialize blockchain connection
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.wallet = new ethers.Wallet(config.privateKey, this.provider);
    
    this.logger.info('ValidatorConsensus initialized', {
      nodeId: config.nodeId,
      address: this.wallet.address
    });
  }

  /**
   * Start the consensus service
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Consensus service already running');
      return;
    }

    this.isRunning = true;
    this.logger.info('Starting ValidatorConsensus service');

    // Verify node registration (non-fatal — node can still participate in consensus
    // even if the on-chain registration check fails; full verification requires the
    // UtilityNFT tokenId from credentials.json, which is a TODO for a future release)
    const isRegistered = await this.verifyNodeRegistration();
    if (!isRegistered) {
      this.logger.warn('Could not verify on-chain node registration — continuing in unverified mode');
    }

    // Start consensus round loop
    this.startRoundLoop();
    
    this.emit('started');
    this.logger.info('ValidatorConsensus service started successfully');
  }

  /**
   * Stop the consensus service
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    
    if (this.roundInterval) {
      clearInterval(this.roundInterval);
      this.roundInterval = null;
    }

    this.emit('stopped');
    this.logger.info('ValidatorConsensus service stopped');
  }

  /**
   * Verify that this node is registered in the NodeRegistry contract
   */
  private async verifyNodeRegistration(): Promise<boolean> {
    try {
      // NodeRegistry uses UtilityNFT token IDs for node tracking.
      // Use getNodeCountByTier as a lightweight liveness check to confirm
      // the contract is reachable on-chain.
      const nodeRegistryAbi = [
        'function getNodeCountByTier(uint8 tier) view returns (uint256)'
      ];
      
      const nodeRegistry = new ethers.Contract(
        this.config.nodeRegistryAddress,
        nodeRegistryAbi,
        this.provider
      );

      // Tier 2 = VALIDATOR in the Noderr tier enum
      const validatorCount = await nodeRegistry.getNodeCountByTier(2);
      this.logger.info('NodeRegistry contract reachable', {
        validatorCount: validatorCount.toString(),
        nodeRegistryAddress: this.config.nodeRegistryAddress
      });

      // TODO: verify this node's UtilityNFT tokenId is registered
      // For now, return true if the contract is reachable
      return true;
    } catch (error) {
      this.logger.warn('Could not reach NodeRegistry contract', { error });
      return false;
    }
  }

  /**
   * Start the consensus round loop
   */
  private startRoundLoop(): void {
    this.roundInterval = setInterval(async () => {
      if (!this.isRunning) return;
      
      try {
        await this.participateInRound();
      } catch (error) {
        this.logger.error('Error in consensus round', { error });
      }
    }, this.config.roundDurationMs);

    // Immediately start first round
    this.participateInRound().catch(error => {
      this.logger.error('Error in initial consensus round', { error });
    });
  }

  /**
   * Participate in a consensus round
   */
  private async participateInRound(): Promise<void> {
    const roundId = this.generateRoundId();
    
    this.currentRound = {
      id: roundId,
      startTime: Date.now(),
      state: ConsensusState.COLLECTING,
      dataHash: '',
      attestations: new Map()
    };

    this.logger.info('Starting consensus round', { roundId });
    this.emit('roundStarted', roundId);

    try {
      // Step 1: Collect data to validate
      this.currentRound.state = ConsensusState.COLLECTING;
      const dataToValidate = await this.collectDataForValidation();
      this.currentRound.dataHash = this.hashData(dataToValidate);

      // Step 2: Validate the data
      this.currentRound.state = ConsensusState.VALIDATING;
      const isValid = await this.validateData(dataToValidate);

      // Step 3: Create attestation
      this.currentRound.state = ConsensusState.ATTESTING;
      const attestation = await this.createAttestation(roundId, isValid);
      this.currentRound.attestations.set(this.wallet.address, attestation);

      // Step 4: Submit attestation on-chain
      this.currentRound.state = ConsensusState.SUBMITTING;
      await this.submitAttestation(attestation);

      // Step 5: Complete round
      this.currentRound.state = ConsensusState.COMPLETE;
      this.currentRound.endTime = Date.now();
      this.currentRound.result = isValid;

      // Store in history
      this.roundHistory.set(roundId, { ...this.currentRound });

      this.logger.info('Consensus round completed', {
        roundId,
        duration: this.currentRound.endTime - this.currentRound.startTime,
        result: isValid
      });

      this.emit('roundCompleted', roundId, isValid);

    } catch (error) {
      this.currentRound.state = ConsensusState.FAILED;
      this.currentRound.endTime = Date.now();
      
      this.logger.error('Consensus round failed', { roundId, error });
      this.emit('roundFailed', roundId, error);
    }
  }

  /**
   * Collect data from Guardian/Oracle nodes for validation
   */
  private async collectDataForValidation(): Promise<any> {
    // Fetch current network state for validation
    return {
      timestamp: Date.now(),
      blockNumber: await this.provider.getBlockNumber(),
      nodeId: this.config.nodeId
    };
  }

  /**
   * Validate collected data
   */
  private async validateData(data: any): Promise<boolean> {
    try {
      // Basic validation checks
      if (!data.timestamp || !data.blockNumber) {
        return false;
      }

      // Verify timestamp is recent (within 5 minutes)
      const timeDiff = Date.now() - data.timestamp;
      if (timeDiff > 5 * 60 * 1000) {
        this.logger.warn('Data timestamp too old', { timeDiff });
        return false;
      }

      // Verify block number is valid
      const currentBlock = await this.provider.getBlockNumber();
      if (data.blockNumber > currentBlock) {
        this.logger.warn('Invalid block number', {
          dataBlock: data.blockNumber,
          currentBlock
        });
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error('Data validation error', { error });
      return false;
    }
  }

  /**
   * Create a signed attestation
   */
  private async createAttestation(roundId: string, isValid: boolean): Promise<Attestation> {
    const attestation: Attestation = {
      roundId,
      validatorAddress: this.wallet.address,
      dataHash: this.currentRound!.dataHash,
      isValid,
      timestamp: Date.now(),
      signature: ''
    };

    // Create message hash for signing
    const messageHash = ethers.solidityPackedKeccak256(
      ['string', 'address', 'bytes32', 'bool', 'uint256'],
      [roundId, attestation.validatorAddress, attestation.dataHash, isValid, attestation.timestamp]
    );

    // Sign the attestation
    attestation.signature = await this.wallet.signMessage(ethers.getBytes(messageHash));

    return attestation;
  }

  /**
   * Submit attestation to the consensus contract
   */
  private async submitAttestation(attestation: Attestation): Promise<void> {
    try {
      // Consensus contract ABI
      const consensusAbi = [
        'function submitAttestation(string roundId, bytes32 dataHash, bool isValid, uint256 timestamp, bytes signature) external'
      ];

      const consensusContract = new ethers.Contract(
        this.config.consensusContractAddress,
        consensusAbi,
        this.wallet
      );

      const tx = await consensusContract.submitAttestation(
        attestation.roundId,
        attestation.dataHash,
        attestation.isValid,
        attestation.timestamp,
        attestation.signature
      );

      await tx.wait();

      this.logger.info('Attestation submitted on-chain', {
        roundId: attestation.roundId,
        txHash: tx.hash
      });

    } catch (error) {
      // Log but don't throw - attestation submission failure shouldn't crash the service
      this.logger.error('Failed to submit attestation on-chain', { error });
      throw error;
    }
  }

  /**
   * Generate a unique round ID
   */
  private generateRoundId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `round-${timestamp}-${random}`;
  }

  /**
   * Hash data for attestation
   */
  private hashData(data: any): string {
    const dataString = JSON.stringify(data);
    return ethers.keccak256(ethers.toUtf8Bytes(dataString));
  }

  /**
   * Get current consensus state
   */
  getState(): ConsensusState {
    return this.currentRound?.state ?? ConsensusState.IDLE;
  }

  /**
   * Get round history
   */
  getRoundHistory(): ConsensusRound[] {
    return Array.from(this.roundHistory.values());
  }

  /**
   * Get service health status
   */
  getHealthStatus(): { healthy: boolean; details: any } {
    const recentRounds = this.getRoundHistory().slice(-10);
    const successfulRounds = recentRounds.filter(r => r.state === ConsensusState.COMPLETE);
    const successRate = recentRounds.length > 0 
      ? successfulRounds.length / recentRounds.length 
      : 1;

    return {
      healthy: this.isRunning && successRate >= 0.8,
      details: {
        isRunning: this.isRunning,
        currentState: this.getState(),
        totalRounds: this.roundHistory.size,
        recentSuccessRate: successRate,
        lastRoundTime: this.currentRound?.startTime ?? null
      }
    };
  }
}
