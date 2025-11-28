/**
 * Multi-Signature Wallet Client
 * 
 * Client library for interacting with multi-sig wallets for governance
 */

import { ethers } from 'ethers';
import {
  MultiSigConfig,
  Transaction,
  Signer,
  MultiSigInfo,
  TransactionReceipt,
  Proposal
} from './types';

/**
 * Multi-sig wallet ABI (minimal interface)
 */
const MULTISIG_ABI = [
  'function submitTransaction(address destination, uint256 value, bytes data) returns (uint256)',
  'function confirmTransaction(uint256 transactionId)',
  'function executeTransaction(uint256 transactionId)',
  'function revokeConfirmation(uint256 transactionId)',
  'function getTransaction(uint256 transactionId) view returns (address destination, uint256 value, bytes data, bool executed)',
  'function getConfirmationCount(uint256 transactionId) view returns (uint256)',
  'function getTransactionCount(bool pending, bool executed) view returns (uint256)',
  'function getOwners() view returns (address[])',
  'function required() view returns (uint256)',
  'function isConfirmed(uint256 transactionId) view returns (bool)',
  'function confirmations(uint256, address) view returns (bool)',
  'event Submission(uint256 indexed transactionId)',
  'event Confirmation(address indexed sender, uint256 indexed transactionId)',
  'event Execution(uint256 indexed transactionId)',
  'event ExecutionFailure(uint256 indexed transactionId)',
  'event Revocation(address indexed sender, uint256 indexed transactionId)'
];

export class MultiSigClient {
  private provider: ethers.Provider;
  private wallet?: ethers.Wallet;
  private contract: ethers.Contract;
  private config: MultiSigConfig;

  constructor(config: MultiSigConfig) {
    this.config = config;
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    
    if (config.signerPrivateKey) {
      this.wallet = new ethers.Wallet(config.signerPrivateKey, this.provider);
      this.contract = new ethers.Contract(
        config.walletAddress,
        MULTISIG_ABI,
        this.wallet
      );
    } else {
      this.contract = new ethers.Contract(
        config.walletAddress,
        MULTISIG_ABI,
        this.provider
      );
    }
  }

  /**
   * Get multi-sig wallet information
   */
  async getWalletInfo(): Promise<MultiSigInfo> {
    const [owners, required, nonce] = await Promise.all([
      this.contract.getOwners(),
      this.contract.required(),
      this.provider.getTransactionCount(this.config.walletAddress)
    ]);

    const signers: Signer[] = owners.map((address: string) => ({
      address,
      active: true
    }));

    return {
      address: this.config.walletAddress,
      signers,
      required: Number(required),
      total: owners.length,
      nonce
    };
  }

  /**
   * Submit a new transaction to the multi-sig wallet
   */
  async submitTransaction(proposal: Proposal): Promise<{ transactionId: number; txHash: string }> {
    if (!this.wallet) {
      throw new Error('Signer private key required to submit transactions');
    }

    const tx = await this.contract.submitTransaction(
      proposal.target,
      proposal.value || 0,
      proposal.data
    );

    const receipt = await tx.wait();
    
    // Find Submission event to get transaction ID
    const submissionEvent = receipt.logs.find((log: any) => {
      try {
        const parsed = this.contract.interface.parseLog(log);
        return parsed?.name === 'Submission';
      } catch {
        return false;
      }
    });

    if (!submissionEvent) {
      throw new Error('Submission event not found in transaction receipt');
    }

    const parsed = this.contract.interface.parseLog(submissionEvent);
    const transactionId = Number(parsed?.args[0]);

    return {
      transactionId,
      txHash: receipt.hash
    };
  }

  /**
   * Confirm a pending transaction
   */
  async confirmTransaction(transactionId: number): Promise<TransactionReceipt> {
    if (!this.wallet) {
      throw new Error('Signer private key required to confirm transactions');
    }

    const tx = await this.contract.confirmTransaction(transactionId);
    const receipt = await tx.wait();

    return {
      hash: receipt.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      status: receipt.status,
      logs: receipt.logs
    };
  }

  /**
   * Execute a confirmed transaction
   */
  async executeTransaction(transactionId: number): Promise<TransactionReceipt> {
    if (!this.wallet) {
      throw new Error('Signer private key required to execute transactions');
    }

    // Check if transaction is confirmed
    const isConfirmed = await this.contract.isConfirmed(transactionId);
    if (!isConfirmed) {
      throw new Error(`Transaction ${transactionId} is not confirmed yet`);
    }

    const tx = await this.contract.executeTransaction(transactionId);
    const receipt = await tx.wait();

    return {
      hash: receipt.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      status: receipt.status,
      logs: receipt.logs
    };
  }

  /**
   * Revoke confirmation for a transaction
   */
  async revokeConfirmation(transactionId: number): Promise<TransactionReceipt> {
    if (!this.wallet) {
      throw new Error('Signer private key required to revoke confirmations');
    }

    const tx = await this.contract.revokeConfirmation(transactionId);
    const receipt = await tx.wait();

    return {
      hash: receipt.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      status: receipt.status,
      logs: receipt.logs
    };
  }

  /**
   * Get transaction details
   */
  async getTransaction(transactionId: number): Promise<Transaction> {
    const [txData, confirmationCount, required, owners] = await Promise.all([
      this.contract.getTransaction(transactionId),
      this.contract.getConfirmationCount(transactionId),
      this.contract.required(),
      this.contract.getOwners()
    ]);

    // Get list of signers who confirmed
    const confirmations = await Promise.all(
      owners.map(async (owner: string) => {
        const confirmed = await this.contract.confirmations(transactionId, owner);
        return confirmed ? owner : null;
      })
    );

    const signers = confirmations.filter((addr): addr is string => addr !== null);

    return {
      id: transactionId,
      to: txData[0],
      value: txData[1].toString(),
      data: txData[2],
      executed: txData[3],
      confirmations: Number(confirmationCount),
      required: Number(required),
      signers
    };
  }

  /**
   * Get list of pending transactions
   */
  async getPendingTransactions(): Promise<Transaction[]> {
    const count = await this.contract.getTransactionCount(true, false);
    const totalCount = Number(count);

    const transactions: Transaction[] = [];
    for (let i = 0; i < totalCount; i++) {
      try {
        const tx = await this.getTransaction(i);
        if (!tx.executed) {
          transactions.push(tx);
        }
      } catch (error) {
        // Transaction might not exist, skip
        continue;
      }
    }

    return transactions;
  }

  /**
   * Get list of executed transactions
   */
  async getExecutedTransactions(limit: number = 10): Promise<Transaction[]> {
    const count = await this.contract.getTransactionCount(false, true);
    const totalCount = Number(count);

    const transactions: Transaction[] = [];
    const start = Math.max(0, totalCount - limit);
    
    for (let i = totalCount - 1; i >= start; i--) {
      try {
        const tx = await this.getTransaction(i);
        if (tx.executed) {
          transactions.push(tx);
        }
      } catch (error) {
        // Transaction might not exist, skip
        continue;
      }
    }

    return transactions;
  }

  /**
   * Check if current signer has confirmed a transaction
   */
  async hasConfirmed(transactionId: number): Promise<boolean> {
    if (!this.wallet) {
      throw new Error('Signer private key required to check confirmations');
    }

    return await this.contract.confirmations(transactionId, this.wallet.address);
  }

  /**
   * Check if transaction is ready to execute
   */
  async canExecute(transactionId: number): Promise<boolean> {
    const tx = await this.getTransaction(transactionId);
    return !tx.executed && tx.confirmations >= tx.required;
  }

  /**
   * Get current signer address
   */
  getSignerAddress(): string | null {
    return this.wallet?.address || null;
  }

  /**
   * Check if current signer is an owner
   */
  async isOwner(): Promise<boolean> {
    if (!this.wallet) {
      return false;
    }

    const owners = await this.contract.getOwners();
    return owners.includes(this.wallet.address);
  }
}
