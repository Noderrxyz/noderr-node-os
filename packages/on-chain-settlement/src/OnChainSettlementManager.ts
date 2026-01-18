/**
 * On-Chain Settlement Manager
 * 
 * Manages on-chain settlement of trading signals with Oracle consensus validation.
 * Integrates with OracleVerifier.sol smart contract for Byzantine fault-tolerant consensus.
 * 
 * @module OnChainSettlementManager
 */

import { Logger } from '@noderr/utils/src';
import { EventEmitter } from 'events';
import { ethers } from 'ethers';
import { TradingSignal } from '@noderr/oracle-consensus';

const logger = new Logger('OnChainSettlementManager');
export interface SettlementConfig {
  rpcUrl: string;
  chainId: number;
  oracleVerifierAddress: string;
  privateKey: string;
  gasLimit: number;
  maxGasPrice: bigint;
  confirmations: number;
}

export interface TradeSettlement {
  id: string;
  signal: TradingSignal;
  consensusId: string;
  txHash: string | null;
  blockNumber: number | null;
  status: 'PENDING' | 'SUBMITTED' | 'CONFIRMED' | 'FAILED' | 'REVERTED';
  gasUsed: bigint | null;
  effectiveGasPrice: bigint | null;
  error: string | null;
  submittedAt: number;
  confirmedAt: number | null;
}

/**
 * On-Chain Settlement Manager
 * 
 * Handles settlement of trades on-chain after Oracle consensus is reached.
 */
export class OnChainSettlementManager extends EventEmitter {
  private config: SettlementConfig;
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet;
  private oracleVerifier: ethers.Contract;
  private settlements: Map<string, TradeSettlement> = new Map();
  private isInitialized: boolean = false;
  
  // OracleVerifier ABI (minimal interface)
  private static ORACLE_VERIFIER_ABI = [
    'function submitSignal(bytes32 signalId, address[] memory oracles, uint256[] memory votes, bytes[] memory signatures) external returns (bool)',
    'function getConsensusResult(bytes32 signalId) external view returns (bool reached, uint256 confidence, uint256 timestamp)',
    'function isOracleRegistered(address oracle) external view returns (bool)',
    'event ConsensusReached(bytes32 indexed signalId, uint256 confidence, uint256 timestamp)',
    'event SignalSubmitted(bytes32 indexed signalId, address indexed submitter)',
  ];
  
  constructor(config: SettlementConfig) {
    super();
    this.config = config;
    
    // Initialize provider
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    
    // Initialize wallet
    this.wallet = new ethers.Wallet(config.privateKey, this.provider);
    
    // Initialize contract
    this.oracleVerifier = new ethers.Contract(
      config.oracleVerifierAddress,
      OnChainSettlementManager.ORACLE_VERIFIER_ABI,
      this.wallet
    );
  }
  
  /**
   * Initialize settlement manager
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.warn('Settlement manager already initialized');
      return;
    }
    
    logger.info('Initializing On-Chain Settlement Manager...');
    
    // Verify network connection
    const network = await this.provider.getNetwork();
    logger.info(`Connected to network: ${network.name} (Chain ID: ${network.chainId})`);
    
    if (Number(network.chainId) !== this.config.chainId) {
      throw new Error(
        `Chain ID mismatch: expected ${this.config.chainId}, got ${network.chainId}`
      );
    }
    
    // Verify wallet balance
    const balance = await this.provider.getBalance(this.wallet.address);
    logger.info(`Wallet address: ${this.wallet.address}`);
    logger.info(`Wallet balance: ${ethers.formatEther(balance)} ETH`);
    
    if (balance === 0n) {
      logger.warn('⚠️  WARNING: Wallet has zero balance!');
    }
    
    // Verify OracleVerifier contract
    const code = await this.provider.getCode(this.config.oracleVerifierAddress);
    if (code === '0x') {
      throw new Error(
        `OracleVerifier contract not found at ${this.config.oracleVerifierAddress}`
      );
    }
    
    logger.info(`OracleVerifier contract: ${this.config.oracleVerifierAddress}`);
    
    // Check if wallet is registered as oracle
    try {
      const isRegistered = await this.oracleVerifier.isOracleRegistered(this.wallet.address);
      logger.info(`Oracle registration status: ${isRegistered ? 'REGISTERED' : 'NOT REGISTERED'}`);
      
      if (!isRegistered) {
        logger.warn('⚠️  WARNING: Wallet is not registered as an Oracle!');
      }
    } catch (error: unknown) {
      logger.warn(`Could not check oracle registration: ${error.message}`);
    }
    
    // Subscribe to contract events
    this.subscribeToEvents();
    
    this.isInitialized = true;
    
    logger.info('On-Chain Settlement Manager initialized');
    
    this.emit('initialized');
  }
  
  /**
   * Submit trading signal for on-chain consensus
   */
  async submitSignal(
    signal: TradingSignal,
    consensusId: string,
    oracles: string[],
    votes: number[],
    signatures: string[]
  ): Promise<string> {
    if (!this.isInitialized) {
      throw new Error('Settlement manager not initialized');
    }
    
    // Generate signal ID
    const signalId = this.generateSignalId(signal);
    
    // Create settlement record
    const settlement: TradeSettlement = {
      id: this.generateSettlementId(),
      signal,
      consensusId,
      txHash: null,
      blockNumber: null,
      status: 'PENDING',
      gasUsed: null,
      effectiveGasPrice: null,
      error: null,
      submittedAt: Date.now(),
      confirmedAt: null,
    };
    
    this.settlements.set(settlement.id, settlement);
    
    logger.info(`\n${'='.repeat(60)}`);
    logger.info(`SUBMITTING SIGNAL ON-CHAIN: ${settlement.id}`);
    logger.info(`${'='.repeat(60)}`);
    logger.info(`Signal ID: ${signalId}`);
    logger.info(`Symbol: ${signal.symbol}`);
    logger.info(`Action: ${signal.action}`);
    logger.info(`Confidence: ${(signal.confidence * 100).toFixed(2)}%`);
    logger.info(`Oracles: ${oracles.length}`);
    
    try {
      // Estimate gas
      const gasEstimate = await this.oracleVerifier.submitSignal.estimateGas(
        signalId,
        oracles,
        votes,
        signatures
      );
      
      logger.info(`Estimated gas: ${gasEstimate.toString()}`);
      
      // Get current gas price
      const feeData = await this.provider.getFeeData();
      const gasPrice = feeData.gasPrice || 0n;
      
      logger.info(`Gas price: ${ethers.formatUnits(gasPrice, 'gwei')} gwei`);
      
      // Check max gas price
      if (gasPrice > this.config.maxGasPrice) {
        throw new Error(
          `Gas price too high: ${ethers.formatUnits(gasPrice, 'gwei')} gwei > ` +
          `${ethers.formatUnits(this.config.maxGasPrice, 'gwei')} gwei`
        );
      }
      
      // Submit transaction
      logger.info('Submitting transaction...');
      
      const tx = await this.oracleVerifier.submitSignal(
        signalId,
        oracles,
        votes,
        signatures,
        {
          gasLimit: this.config.gasLimit,
          gasPrice: gasPrice,
        }
      );
      
      settlement.txHash = tx.hash;
      settlement.status = 'SUBMITTED';
      
      logger.info(`Transaction submitted: ${tx.hash}`);
      logger.info(`Waiting for ${this.config.confirmations} confirmations...`);
      
      this.emit('signalSubmitted', { settlement, txHash: tx.hash });
      
      // Wait for confirmation
      const receipt = await tx.wait(this.config.confirmations);
      
      if (receipt.status === 1) {
        settlement.status = 'CONFIRMED';
        settlement.blockNumber = receipt.blockNumber;
        settlement.gasUsed = receipt.gasUsed;
        settlement.effectiveGasPrice = receipt.gasPrice;
        settlement.confirmedAt = Date.now();
        
        logger.info(`✅ Transaction confirmed in block ${receipt.blockNumber}`);
        logger.info(`Gas used: ${receipt.gasUsed.toString()}`);
        logger.info(`Effective gas price: ${ethers.formatUnits(receipt.gasPrice, 'gwei')} gwei`);
        logger.info(`Total cost: ${ethers.formatEther(receipt.gasUsed * receipt.gasPrice)} ETH`);
        
        this.emit('signalConfirmed', { settlement, receipt });
      } else {
        settlement.status = 'REVERTED';
        settlement.error = 'Transaction reverted';
        
        logger.info(`❌ Transaction reverted`);
        
        this.emit('signalReverted', { settlement });
      }
      
      logger.info(`${'='.repeat(60)}\n`);
      
      return settlement.id;
      
    } catch (error: unknown) {
      settlement.status = 'FAILED';
      settlement.error = error.message;
      
      logger.error(`❌ Transaction failed: ${error.message}`);
      logger.info(`${'='.repeat(60)}\n`);
      
      this.emit('signalFailed', { settlement, error });
      
      throw error;
    }
  }
  
  /**
   * Get consensus result from contract
   */
  async getConsensusResult(signalId: string): Promise<{
    reached: boolean;
    confidence: number;
    timestamp: number;
  }> {
    if (!this.isInitialized) {
      throw new Error('Settlement manager not initialized');
    }
    
    const result = await this.oracleVerifier.getConsensusResult(signalId);
    
    return {
      reached: result.reached,
      confidence: Number(result.confidence) / 10000, // Convert from basis points
      timestamp: Number(result.timestamp),
    };
  }
  
  /**
   * Subscribe to contract events
   */
  private subscribeToEvents(): void {
    // Listen for ConsensusReached events
    this.oracleVerifier.on('ConsensusReached', (signalId, confidence, timestamp, event) => {
      logger.info(`\n📡 ConsensusReached event received`);
      logger.info(`Signal ID: ${signalId}`);
      logger.info(`Confidence: ${Number(confidence) / 100}%`);
      logger.info(`Timestamp: ${new Date(Number(timestamp) * 1000).toISOString()}`);
      logger.info(`Block: ${event.log.blockNumber}`);
      logger.info(`Transaction: ${event.log.transactionHash}\n`);
      
      this.emit('consensusReached', {
        signalId,
        confidence: Number(confidence) / 10000,
        timestamp: Number(timestamp),
        blockNumber: event.log.blockNumber,
        txHash: event.log.transactionHash,
      });
    });
    
    // Listen for SignalSubmitted events
    this.oracleVerifier.on('SignalSubmitted', (signalId, submitter, event) => {
      logger.info(`\n📡 SignalSubmitted event received`);
      logger.info(`Signal ID: ${signalId}`);
      logger.info(`Submitter: ${submitter}`);
      logger.info(`Block: ${event.log.blockNumber}`);
      logger.info(`Transaction: ${event.log.transactionHash}\n`);
    });
    
    logger.info('Subscribed to OracleVerifier contract events');
  }
  
  /**
   * Generate signal ID from trading signal
   */
  private generateSignalId(signal: TradingSignal): string {
    const data = ethers.AbiCoder.defaultAbiCoder().encode(
      ['string', 'string', 'uint256', 'uint256', 'uint256'],
      [
        signal.symbol,
        signal.action,
        Math.floor(signal.confidence * 10000),
        Math.floor(signal.price * 100),
        signal.timestamp,
      ]
    );
    
    return ethers.keccak256(data);
  }
  
  /**
   * Generate settlement ID
   */
  private generateSettlementId(): string {
    return `settlement_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }
  
  /**
   * Get settlement by ID
   */
  getSettlement(settlementId: string): TradeSettlement | null {
    return this.settlements.get(settlementId) || null;
  }
  
  /**
   * Get all settlements
   */
  getAllSettlements(): TradeSettlement[] {
    return Array.from(this.settlements.values())
      .sort((a, b) => b.submittedAt - a.submittedAt);
  }
  
  /**
   * Get pending settlements
   */
  getPendingSettlements(): TradeSettlement[] {
    return this.getAllSettlements()
      .filter(s => s.status === 'PENDING' || s.status === 'SUBMITTED');
  }
  
  /**
   * Get confirmed settlements
   */
  getConfirmedSettlements(): TradeSettlement[] {
    return this.getAllSettlements()
      .filter(s => s.status === 'CONFIRMED');
  }
  
  /**
   * Get statistics
   */
  getStatistics(): {
    total: number;
    pending: number;
    submitted: number;
    confirmed: number;
    failed: number;
    reverted: number;
    successRate: number;
    totalGasUsed: bigint;
  } {
    const all = this.getAllSettlements();
    const pending = all.filter(s => s.status === 'PENDING').length;
    const submitted = all.filter(s => s.status === 'SUBMITTED').length;
    const confirmed = all.filter(s => s.status === 'CONFIRMED').length;
    const failed = all.filter(s => s.status === 'FAILED').length;
    const reverted = all.filter(s => s.status === 'REVERTED').length;
    
    const totalGasUsed = all
      .filter(s => s.gasUsed !== null)
      .reduce((sum, s) => sum + s.gasUsed!, 0n);
    
    const completed = confirmed + failed + reverted;
    const successRate = completed > 0 ? confirmed / completed : 0;
    
    return {
      total: all.length,
      pending,
      submitted,
      confirmed,
      failed,
      reverted,
      successRate,
      totalGasUsed,
    };
  }
  
  /**
   * Shutdown settlement manager
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down On-Chain Settlement Manager...');
    
    // Unsubscribe from events
    this.oracleVerifier.removeAllListeners();
    
    // Wait for pending settlements
    const pending = this.getPendingSettlements();
    if (pending.length > 0) {
      logger.info(`Waiting for ${pending.length} pending settlements...`);
      
      // Wait up to 5 minutes
      const timeout = Date.now() + 5 * 60 * 1000;
      
      while (this.getPendingSettlements().length > 0 && Date.now() < timeout) {
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
    
    this.settlements.clear();
    this.isInitialized = false;
    
    logger.info('On-Chain Settlement Manager shut down');
    
    this.emit('shutdown');
  }
}
