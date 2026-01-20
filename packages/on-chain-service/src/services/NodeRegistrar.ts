/**
 * Node Registrar Service
 * 
 * Handles automatic node registration with the NodeRegistry contract on startup.
 * Verifies NFT ownership and registers the node with its public endpoint.
 */

import { ethers } from 'ethers';
import { Logger } from 'winston';
import { OnChainServiceConfig } from '@noderr/types/src';
import { RateLimiter } from '../utils/rateLimiter';
import { CircuitBreaker } from '../utils/circuitBreaker';

// NodeRegistry ABI - only the functions we need
const NODE_REGISTRY_ABI = [
  'function registerNode(string nodeUrl, uint256 tokenId) external',
  'function updateNodeUrl(string newNodeUrl) external',
  'function getNodeByOperator(address operator) view returns (tuple(string nodeUrl, uint256 tokenId, bool isActive, uint256 registeredAt, uint256 lastHeartbeat))',
  'function isNodeRegistered(address operator) view returns (bool)',
];

// UtilityNFT ABI - for NFT verification
const UTILITY_NFT_ABI = [
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function walletToTokenId(address wallet) view returns (uint256)',
];

export interface NodeInfo {
  nodeUrl: string;
  tokenId: bigint;
  isActive: boolean;
  registeredAt: bigint;
  lastHeartbeat: bigint;
}

export class NodeRegistrar {
  private config: OnChainServiceConfig;
  private logger: Logger;
  private rateLimiter: RateLimiter;
  private circuitBreaker: CircuitBreaker;
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet;
  private nodeRegistry: ethers.Contract;
  private utilityNFT: ethers.Contract;
  private isRegistered: boolean = false;

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
    
    if (!config.privateKey) {
      throw new Error('Private key not configured for node registration');
    }
    
    this.wallet = new ethers.Wallet(config.privateKey, this.provider);
    
    // Initialize contracts
    if (!config.nodeRegistryAddress) {
      throw new Error('NodeRegistry address not configured');
    }
    
    if (!config.utilityNFTAddress) {
      throw new Error('UtilityNFT address not configured');
    }
    
    this.nodeRegistry = new ethers.Contract(
      config.nodeRegistryAddress,
      NODE_REGISTRY_ABI,
      this.wallet
    );
    
    this.utilityNFT = new ethers.Contract(
      config.utilityNFTAddress,
      UTILITY_NFT_ABI,
      this.provider
    );

    this.logger.info('NodeRegistrar initialized', {
      wallet: this.wallet.address,
      nodeRegistry: config.nodeRegistryAddress,
      utilityNFT: config.utilityNFTAddress,
    });
  }

  /**
   * Verify NFT ownership
   */
  private async verifyNFTOwnership(): Promise<bigint> {
    this.logger.info('Verifying NFT ownership...');

    try {
      // Get token ID for this wallet
      const tokenId = await this.utilityNFT.walletToTokenId(this.wallet.address);
      
      if (tokenId === 0n) {
        throw new Error('No NFT found for this wallet');
      }

      // Verify ownership
      const owner = await this.utilityNFT.ownerOf(tokenId);
      
      if (owner.toLowerCase() !== this.wallet.address.toLowerCase()) {
        throw new Error(`NFT ${tokenId} is not owned by this wallet`);
      }

      this.logger.info('✅ NFT ownership verified', {
        tokenId: tokenId.toString(),
        owner: this.wallet.address,
      });

      return tokenId;

    } catch (error: any) {
      this.logger.error('❌ NFT verification failed:', error);
      throw new Error(`NFT verification failed: ${error.message}`);
    }
  }

  /**
   * Check if node is already registered
   */
  private async checkExistingRegistration(): Promise<NodeInfo | null> {
    this.logger.info('Checking for existing registration...');

    try {
      const isRegistered = await this.nodeRegistry.isNodeRegistered(this.wallet.address);
      
      if (!isRegistered) {
        this.logger.info('Node is not registered');
        return null;
      }

      const nodeData = await this.nodeRegistry.getNodeByOperator(this.wallet.address);
      
      const nodeInfo: NodeInfo = {
        nodeUrl: nodeData.nodeUrl,
        tokenId: nodeData.tokenId,
        isActive: nodeData.isActive,
        registeredAt: nodeData.registeredAt,
        lastHeartbeat: nodeData.lastHeartbeat,
      };

      this.logger.info('✅ Existing registration found', {
        nodeUrl: nodeInfo.nodeUrl,
        tokenId: nodeInfo.tokenId.toString(),
        isActive: nodeInfo.isActive,
      });

      return nodeInfo;

    } catch (error: any) {
      this.logger.error('Error checking registration:', error);
      throw error;
    }
  }

  /**
   * Register node with NodeRegistry
   */
  private async registerNode(nodeUrl: string, tokenId: bigint): Promise<void> {
    this.logger.info('📝 Registering node with NodeRegistry...', {
      nodeUrl,
      tokenId: tokenId.toString(),
    });

    try {
      // Estimate gas
      const gasEstimate = await this.nodeRegistry.registerNode.estimateGas(nodeUrl, tokenId);
      this.logger.info('Gas estimate:', { gas: gasEstimate.toString() });

      // Send transaction
      const tx = await this.nodeRegistry.registerNode(nodeUrl, tokenId, {
        gasLimit: gasEstimate * 120n / 100n, // 20% buffer
      });

      this.logger.info('⏳ Transaction sent, waiting for confirmation...', {
        txHash: tx.hash,
      });

      // Wait for confirmation
      const receipt = await tx.wait();

      this.logger.info('✅ Node registered successfully!', {
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
      });

      this.isRegistered = true;

    } catch (error: any) {
      this.logger.error('❌ Registration failed:', error);
      throw new Error(`Node registration failed: ${error.message}`);
    }
  }

  /**
   * Update node URL if already registered
   */
  private async updateNodeUrl(newNodeUrl: string): Promise<void> {
    this.logger.info('🔄 Updating node URL...', {
      newNodeUrl,
    });

    try {
      const tx = await this.nodeRegistry.updateNodeUrl(newNodeUrl);
      
      this.logger.info('⏳ Transaction sent, waiting for confirmation...', {
        txHash: tx.hash,
      });

      const receipt = await tx.wait();

      this.logger.info('✅ Node URL updated successfully!', {
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
      });

    } catch (error: any) {
      this.logger.error('❌ URL update failed:', error);
      throw new Error(`Node URL update failed: ${error.message}`);
    }
  }

  /**
   * Get node URL from config or environment
   */
  private getNodeUrl(): string {
    // Priority: config > env > default
    if (this.config.nodeUrl) {
      return this.config.nodeUrl;
    }

    if (process.env.NODE_URL) {
      return process.env.NODE_URL;
    }

    // Default: use public IP if available, otherwise localhost
    const publicIP = process.env.PUBLIC_IP;
    if (publicIP) {
      return `http://${publicIP}:${this.config.nodePort || 3000}`;
    }

    this.logger.warn('No NODE_URL or PUBLIC_IP configured, using localhost');
    return `http://localhost:${this.config.nodePort || 3000}`;
  }

  /**
   * Initialize and register node on startup
   */
  public async initialize(): Promise<void> {
    this.logger.info('🚀 Initializing node registration...');

    try {
      // Step 1: Verify NFT ownership
      const tokenId = await this.verifyNFTOwnership();

      // Step 2: Get node URL
      const nodeUrl = this.getNodeUrl();
      this.logger.info('Node URL:', { nodeUrl });

      // Step 3: Check if already registered
      const existingRegistration = await this.checkExistingRegistration();

      if (existingRegistration) {
        // Node is already registered
        this.isRegistered = true;

        // Check if URL needs updating
        if (existingRegistration.nodeUrl !== nodeUrl) {
          this.logger.info('Node URL has changed, updating...');
          await this.updateNodeUrl(nodeUrl);
        } else {
          this.logger.info('✅ Node is already registered with correct URL');
        }

        // Verify token ID matches
        if (existingRegistration.tokenId !== tokenId) {
          this.logger.warn('⚠️  Registered token ID does not match current NFT!', {
            registered: existingRegistration.tokenId.toString(),
            current: tokenId.toString(),
          });
        }

      } else {
        // Register new node
        await this.registerNode(nodeUrl, tokenId);
      }

      this.logger.info('✅ Node registration complete!');

    } catch (error: any) {
      this.logger.error('❌ Node registration initialization failed:', error);
      throw error;
    }
  }

  /**
   * Get registration status
   */
  public getRegistrationStatus(): {
    isRegistered: boolean;
    wallet: string;
    nodeUrl: string;
  } {
    return {
      isRegistered: this.isRegistered,
      wallet: this.wallet.address,
      nodeUrl: this.getNodeUrl(),
    };
  }

  /**
   * Health check
   */
  public async healthCheck(): Promise<boolean> {
    try {
      const isRegistered = await this.nodeRegistry.isNodeRegistered(this.wallet.address);
      return isRegistered;
    } catch (error) {
      this.logger.error('Health check failed:', error);
      return false;
    }
  }
}
