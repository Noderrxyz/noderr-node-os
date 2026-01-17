/**
 * Oracle Coordinator
 * 
 * Coordinates multiple Oracle nodes to reach consensus on trading signals.
 * Manages the full consensus lifecycle from data collection to on-chain settlement.
 * 
 * Workflow:
 * 1. Collect trading signals from ML models
 * 2. Initiate consensus round
 * 3. Broadcast to all Oracle nodes
 * 4. Aggregate submissions
 * 5. Verify consensus on-chain
 * 6. Execute trades if consensus reached
 * 
 * @module OracleCoordinator
 */

import { EventEmitter } from 'events';
import { BFTConsensusEngine, ConsensusResult } from './BFTConsensusEngine';

export interface TradingSignal {
  symbol: string;
  action: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  price: number;
  quantity: number;
  timestamp: number;
  modelId: string;
  features: Record<string, number>;
}

export interface ConsensusRequest {
  requestId: string;
  signals: TradingSignal[];
  timestamp: number;
  requester: string;
}

export interface ConsensusResponse {
  requestId: string;
  roundId: number;
  consensusReached: boolean;
  consensusSignal: TradingSignal | null;
  confidence: number;
  participatingOracles: number;
  timestamp: number;
}

/**
 * Oracle Coordinator
 * 
 * High-level coordinator for Oracle consensus on trading signals.
 */
export class OracleCoordinator extends EventEmitter {
  private consensusEngine: BFTConsensusEngine;
  private pendingRequests: Map<string, ConsensusRequest> = new Map();
  private completedRequests: Map<string, ConsensusResponse> = new Map();
  
  constructor(consensusEngine: BFTConsensusEngine) {
    super();
    this.consensusEngine = consensusEngine;
    this.setupEventListeners();
  }
  
  /**
   * Initialize coordinator
   */
  async initialize(): Promise<void> {
    console.log('Initializing Oracle Coordinator...');
    
    await this.consensusEngine.initialize();
    
    console.log('Oracle Coordinator initialized');
    
    this.emit('initialized');
  }
  
  /**
   * Setup event listeners for consensus engine
   */
  private setupEventListeners(): void {
    this.consensusEngine.on('consensusReached', (event) => {
      this.handleConsensusReached(event);
    });
    
    this.consensusEngine.on('consensusFailed', (event) => {
      this.handleConsensusFailed(event);
    });
  }
  
  /**
   * Request consensus on a trading signal
   */
  async requestConsensus(signal: TradingSignal): Promise<ConsensusResponse> {
    const requestId = this.generateRequestId();
    
    const request: ConsensusRequest = {
      requestId,
      signals: [signal],
      timestamp: Date.now(),
      requester: 'oracle-coordinator',
    };
    
    this.pendingRequests.set(requestId, request);
    
    console.log(`Requesting consensus for ${signal.symbol} ${signal.action}`);
    
    try {
      // Start consensus round
      const roundId = await this.consensusEngine.startRound(signal);
      
      // Submit our data
      await this.consensusEngine.submitData(roundId, signal);
      
      // Wait for consensus (with timeout)
      const result = await this.waitForConsensus(roundId, 60000); // 60 second timeout
      
      const response: ConsensusResponse = {
        requestId,
        roundId,
        consensusReached: result.finalized && result.consensusHash !== null,
        consensusSignal: result.finalized && result.consensusHash ? signal : null,
        confidence: result.consensusWeight / result.totalWeight,
        participatingOracles: result.submissions.length,
        timestamp: Date.now(),
      };
      
      this.completedRequests.set(requestId, response);
      this.pendingRequests.delete(requestId);
      
      this.emit('consensusResponse', response);
      
      return response;
      
    } catch (error) {
      console.error(`Consensus request failed:`, error);
      
      const response: ConsensusResponse = {
        requestId,
        roundId: -1,
        consensusReached: false,
        consensusSignal: null,
        confidence: 0,
        participatingOracles: 0,
        timestamp: Date.now(),
      };
      
      this.completedRequests.set(requestId, response);
      this.pendingRequests.delete(requestId);
      
      throw error;
    }
  }
  
  /**
   * Wait for consensus to be reached
   */
  private async waitForConsensus(roundId: number, timeout: number): Promise<ConsensusResult> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Consensus timeout for round ${roundId}`));
      }, timeout);
      
      const checkConsensus = async () => {
        const result = await this.consensusEngine.getConsensusResult(roundId);
        
        if (result && result.finalized) {
          clearTimeout(timeoutId);
          resolve(result);
        } else {
          // Check again in 1 second
          setTimeout(checkConsensus, 1000);
        }
      };
      
      checkConsensus();
    });
  }
  
  /**
   * Handle consensus reached event
   */
  private handleConsensusReached(event: any): void {
    console.log(`Consensus reached for round ${event.roundId}`);
    
    this.emit('consensusReached', event);
  }
  
  /**
   * Handle consensus failed event
   */
  private handleConsensusFailed(event: any): void {
    console.error(`Consensus failed for round ${event.roundId}: ${event.reason}`);
    
    this.emit('consensusFailed', event);
  }
  
  /**
   * Generate unique request ID
   */
  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }
  
  /**
   * Get pending requests
   */
  getPendingRequests(): ConsensusRequest[] {
    return Array.from(this.pendingRequests.values());
  }
  
  /**
   * Get completed requests
   */
  getCompletedRequests(): ConsensusResponse[] {
    return Array.from(this.completedRequests.values());
  }
  
  /**
   * Get consensus statistics
   */
  getStatistics(): {
    pending: number;
    completed: number;
    successRate: number;
  } {
    const completed = Array.from(this.completedRequests.values());
    const successful = completed.filter(r => r.consensusReached).length;
    
    return {
      pending: this.pendingRequests.size,
      completed: completed.length,
      successRate: completed.length > 0 ? successful / completed.length : 0,
    };
  }
  
  /**
   * Cleanup old requests
   */
  cleanup(olderThan: number = 24 * 60 * 60 * 1000): void {
    const cutoff = Date.now() - olderThan;
    
    for (const [requestId, request] of this.pendingRequests.entries()) {
      if (request.timestamp < cutoff) {
        this.pendingRequests.delete(requestId);
      }
    }
    
    for (const [requestId, response] of this.completedRequests.entries()) {
      if (response.timestamp < cutoff) {
        this.completedRequests.delete(requestId);
      }
    }
    
    // Also cleanup consensus engine
    this.consensusEngine.cleanup(olderThan);
  }
  
  /**
   * Shutdown coordinator
   */
  async shutdown(): Promise<void> {
    console.log('Shutting down Oracle Coordinator...');
    
    await this.consensusEngine.shutdown();
    
    this.pendingRequests.clear();
    
    this.emit('shutdown');
  }

  /**
   * Start (alias for initialize)
   */
  async start(): Promise<void> {
    return this.initialize();
  }

  /**
   * Stop (alias for shutdown)
   */
  async stop(): Promise<void> {
    return this.shutdown();
  }
}
