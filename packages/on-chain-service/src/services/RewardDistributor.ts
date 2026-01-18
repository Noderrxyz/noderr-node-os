import { ethers, Contract, Wallet, Provider } from 'ethers';
import { Logger } from 'winston';
import { MerkleTree } from 'merkletreejs';
import {
  OnChainServiceConfig,
  RewardEntry,
  MerkleProof,
  TransactionResult,
} from '@noderr/types';
import { RateLimiter } from '../utils/rateLimiter';
import { CircuitBreaker } from '../utils/circuitBreaker';
import {
  generateMerkleTree,
  generateMerkleProof,
  generateAllProofs,
  verifyMerkleProof,
} from '../utils/merkle';

// MerkleRewardDistributor ABI (minimal interface)
const MERKLE_REWARD_DISTRIBUTOR_ABI = [
  'function createMerkleEpoch(bytes32 merkleRoot, uint256 totalAmount, uint256 duration, string memory description) external returns (uint256)',
  'function claimMerkleRewards(uint256 epochId, uint256 amount, bytes32[] calldata merkleProof) external',
  'function claimMerkleRewardsFor(uint256 epochId, address recipient, uint256 amount, bytes32[] calldata merkleProof) external',
  'function batchClaimMerkleRewards(uint256 epochId, address[] calldata recipients, uint256[] calldata amounts, bytes32[][] calldata merkleProofs) external',
  'function verifyMerkleProof(uint256 epochId, address recipient, uint256 amount, bytes32[] calldata merkleProof) external view returns (bool)',
  'function getMerkleStatistics(uint256 epochId) external view returns (bytes32 merkleRoot, uint256 totalAmount, uint256 claimedAmount, uint256 claimCount, bool active)',
];

/**
 * Reward Distributor Service
 * 
 * Handles gas-efficient reward distribution using Merkle proofs:
 * - Generate Merkle trees from reward data
 * - Submit Merkle roots on-chain
 * - Generate proofs for recipients
 * - Batch claim rewards
 */
export class RewardDistributor {
  private contract: Contract;
  private wallet: Wallet;
  private provider: Provider;
  private logger: Logger;
  private rateLimiter: RateLimiter;
  private circuitBreaker: CircuitBreaker;
  private config: OnChainServiceConfig;

  // Cache for Merkle trees by epoch ID
  private merkleTreeCache: Map<number, MerkleTree> = new Map();
  private rewardDataCache: Map<number, RewardEntry[]> = new Map();

  constructor(
    config: OnChainServiceConfig,
    logger: Logger,
    rateLimiter: RateLimiter,
    circuitBreaker: CircuitBreaker
  ) {
    this.config = config;
    this.logger = logger;
    this.rateLimiter = rateLimiter;
    this.circuitBreaker = circuitBreaker;

    // Initialize provider and wallet
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.wallet = new Wallet(config.privateKey, this.provider);

    // Initialize contract
    this.contract = new Contract(
      config.merkleRewardDistributorAddress,
      MERKLE_REWARD_DISTRIBUTOR_ABI,
      this.wallet
    );

    this.logger.info('RewardDistributor initialized', {
      merkleRewardDistributor: config.merkleRewardDistributorAddress,
      wallet: this.wallet.address,
    });
  }

  /**
   * Generate Merkle tree from reward entries
   * 
   * @param rewards List of reward entries
   * @returns Merkle tree, root, and leaves
   */
  generateTree(rewards: RewardEntry[]): {
    tree: MerkleTree;
    root: string;
    leaves: string[];
  } {
    this.logger.info('Generating Merkle tree', {
      rewardCount: rewards.length,
    });

    const result = generateMerkleTree(rewards);

    this.logger.info('Merkle tree generated', {
      root: result.root,
      leafCount: result.leaves.length,
    });

    return result;
  }

  /**
   * Create a new Merkle epoch on-chain
   * 
   * @param rewards List of reward entries
   * @param description Human-readable description of the epoch
   * @param duration Duration in seconds (0 for no expiry)
   * @returns Transaction result with epoch ID
   */
  async createEpoch(
    rewards: RewardEntry[],
    description: string,
    duration: number = 0
  ): Promise<TransactionResult & { epochId?: number }> {
    try {
      // Check circuit breaker
      if (this.circuitBreaker.isOpen()) {
        throw new Error(`Circuit breaker is open: ${this.circuitBreaker.getStatus().reason}`);
      }

      // Check rate limiter
      if (!this.rateLimiter.canMakeRequest()) {
        throw new Error('Rate limit exceeded');
      }

      // Generate Merkle tree
      const { tree, root } = this.generateTree(rewards);

      // Calculate total amount
      const totalAmount = rewards.reduce(
        (sum, reward) => sum + BigInt(reward.amount),
        BigInt(0)
      );

      this.logger.info('Creating Merkle epoch', {
        root,
        totalAmount: totalAmount.toString(),
        rewardCount: rewards.length,
        description,
      });

      // Record rate limit
      this.rateLimiter.recordRequest();

      // Execute transaction
      const tx = await this.contract.createMerkleEpoch(root, totalAmount, duration, description);
      const receipt = await tx.wait();

      // Extract epoch ID from event logs
      const event = receipt.logs.find((log: any) => {
        try {
          const parsed = this.contract.interface.parseLog(log);
          return parsed?.name === 'MerkleEpochCreated';
        } catch {
          return false;
        }
      });

      let epochId: number | undefined;
      if (event) {
        const parsed = this.contract.interface.parseLog(event);
        epochId = Number(parsed?.args?.epochId);

        // Cache the tree and reward data
        if (epochId !== undefined) {
          this.merkleTreeCache.set(epochId, tree);
          this.rewardDataCache.set(epochId, rewards);
        }
      }

      // Record success
      this.circuitBreaker.recordSuccess();

      this.logger.info('Merkle epoch created', {
        epochId,
        transactionHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
      });

      return {
        success: true,
        epochId,
        transactionHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed,
      };
    } catch (error: unknown) {
      this.logger.error('Merkle epoch creation failed', {
        error: error.message,
        description,
      });

      // Record failure
      this.circuitBreaker.recordFailure(error.message);

      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Generate Merkle proof for a specific recipient
   * 
   * @param epochId Epoch ID
   * @param address Recipient address
   * @param amount Reward amount
   * @returns Merkle proof
   */
  getProof(epochId: number, address: string, amount: bigint): MerkleProof | null {
    const tree = this.merkleTreeCache.get(epochId);
    if (!tree) {
      this.logger.warn('Merkle tree not found in cache', { epochId });
      return null;
    }

    return generateMerkleProof(tree, address, amount);
  }

  /**
   * Generate proofs for all recipients in an epoch
   * 
   * @param epochId Epoch ID
   * @returns Map of address to Merkle proof
   */
  getAllProofs(epochId: number): Map<string, MerkleProof> | null {
    const tree = this.merkleTreeCache.get(epochId);
    const rewards = this.rewardDataCache.get(epochId);

    if (!tree || !rewards) {
      this.logger.warn('Merkle tree or reward data not found in cache', { epochId });
      return null;
    }

    return generateAllProofs(tree, rewards);
  }

  /**
   * Verify a Merkle proof on-chain
   * 
   * @param epochId Epoch ID
   * @param address Recipient address
   * @param amount Reward amount
   * @param proof Merkle proof
   * @returns Whether the proof is valid
   */
  async verifyProof(
    epochId: number,
    address: string,
    amount: bigint,
    proof: string[]
  ): Promise<boolean> {
    try {
      return await this.contract.verifyMerkleProof(epochId, address, amount, proof);
    } catch (error: unknown) {
      this.logger.error('Proof verification failed', {
        error: error.message,
        epochId,
        address,
      });
      return false;
    }
  }

  /**
   * Claim rewards for a recipient (third-party claiming / gas sponsorship)
   * 
   * @param epochId Epoch ID
   * @param recipient Recipient address
   * @param amount Reward amount
   * @param proof Merkle proof
   * @returns Transaction result
   */
  async claimFor(
    epochId: number,
    recipient: string,
    amount: bigint,
    proof: string[]
  ): Promise<TransactionResult> {
    try {
      // Check circuit breaker
      if (this.circuitBreaker.isOpen()) {
        throw new Error(`Circuit breaker is open: ${this.circuitBreaker.getStatus().reason}`);
      }

      // Check rate limiter
      if (!this.rateLimiter.canMakeRequest()) {
        throw new Error('Rate limit exceeded');
      }

      this.logger.info('Claiming rewards for recipient', {
        epochId,
        recipient,
        amount: amount.toString(),
      });

      // Record rate limit
      this.rateLimiter.recordRequest();

      // Execute transaction
      const tx = await this.contract.claimMerkleRewardsFor(epochId, recipient, amount, proof);
      const receipt = await tx.wait();

      // Record success
      this.circuitBreaker.recordSuccess();

      this.logger.info('Rewards claimed successfully', {
        transactionHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
      });

      return {
        success: true,
        transactionHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed,
      };
    } catch (error: unknown) {
      this.logger.error('Reward claim failed', {
        error: error.message,
        epochId,
        recipient,
      });

      // Record failure
      this.circuitBreaker.recordFailure(error.message);

      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Batch claim rewards for multiple recipients
   * 
   * @param epochId Epoch ID
   * @param claims Array of claim data
   * @returns Transaction result
   */
  async batchClaim(
    epochId: number,
    claims: Array<{ address: string; amount: bigint; proof: string[] }>
  ): Promise<TransactionResult> {
    try {
      // Check circuit breaker
      if (this.circuitBreaker.isOpen()) {
        throw new Error(`Circuit breaker is open: ${this.circuitBreaker.getStatus().reason}`);
      }

      // Check rate limiter
      if (!this.rateLimiter.canMakeRequest()) {
        throw new Error('Rate limit exceeded');
      }

      // Limit batch size
      if (claims.length > 50) {
        throw new Error(`Batch size too large: ${claims.length} > 50`);
      }

      this.logger.info('Batch claiming rewards', {
        epochId,
        claimCount: claims.length,
      });

      // Prepare arrays
      const addresses = claims.map(c => c.address);
      const amounts = claims.map(c => c.amount);
      const proofs = claims.map(c => c.proof);

      // Record rate limit
      this.rateLimiter.recordRequest();

      // Execute transaction
      const tx = await this.contract.batchClaimMerkleRewards(epochId, addresses, amounts, proofs);
      const receipt = await tx.wait();

      // Record success
      this.circuitBreaker.recordSuccess();

      this.logger.info('Batch claim successful', {
        transactionHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
      });

      return {
        success: true,
        transactionHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed,
      };
    } catch (error: unknown) {
      this.logger.error('Batch claim failed', {
        error: error.message,
        epochId,
        claimCount: claims.length,
      });

      // Record failure
      this.circuitBreaker.recordFailure(error.message);

      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get epoch statistics
   * 
   * @param epochId Epoch ID
   * @returns Epoch statistics
   */
  async getEpochStats(epochId: number): Promise<{
    merkleRoot: string;
    totalAmount: bigint;
    claimedAmount: bigint;
    claimCount: bigint;
    active: boolean;
  }> {
    const stats = await this.contract.getMerkleStatistics(epochId);
    return {
      merkleRoot: stats[0],
      totalAmount: stats[1],
      claimedAmount: stats[2],
      claimCount: stats[3],
      active: stats[4],
    };
  }
}
