/**
 * Autonomous Execution Orchestrator
 * 
 * Orchestrates the full autonomous trading pipeline:
 * 1. ML Signal Generation → 2. Risk Management → 3. Oracle Consensus → 4. Execution
 * 
 * This is the core of the autonomous trading system, integrating all components
 * into a cohesive, institutional-grade trading engine.
 * 
 * @module AutonomousExecutionOrchestrator
 */

import { EventEmitter } from 'events';
import { OracleCoordinator, TradingSignal } from '@noderr/oracle-consensus';
import { MLSignalService, MLPrediction as MLPred } from './services/MLSignalService';
import { RiskCheckService, RiskAssessment as RiskAssess, PortfolioState } from './services/RiskCheckService';
import { ExecutionService, ExecutionPlan as ExecPlan, ExecutionResult as ExecResult } from './services/ExecutionService';

// Re-export types from services
export type MLPrediction = MLPred;
export type RiskAssessment = RiskAssess;
export type ExecutionPlan = ExecPlan;
export type ExecutionResult = ExecResult;

export interface AutonomousTradeFlow {
  id: string;
  prediction: MLPrediction;
  riskAssessment: RiskAssessment | null;
  consensusReached: boolean;
  executionPlan: ExecutionPlan | null;
  executionResult: ExecutionResult | null;
  status: 'PENDING' | 'RISK_CHECK' | 'CONSENSUS' | 'EXECUTING' | 'COMPLETED' | 'REJECTED' | 'FAILED';
  startTime: number;
  endTime: number | null;
  error: string | null;
}

export interface OrchestratorConfig {
  enableMLPredictions: boolean;
  enableRiskManagement: boolean;
  enableConsensus: boolean;
  minConsensusConfidence: number;
  maxConcurrentTrades: number;
  enableNotifications: boolean;
}

/**
 * Autonomous Execution Orchestrator
 * 
 * Coordinates the full autonomous trading pipeline from ML predictions to execution.
 */
export class AutonomousExecutionOrchestrator extends EventEmitter {
  private config: OrchestratorConfig;
  private oracleCoordinator: OracleCoordinator | null = null;
  private activeTrades: Map<string, AutonomousTradeFlow> = new Map();
  private completedTrades: AutonomousTradeFlow[] = [];
  private isRunning: boolean = false;
  
  // Real service implementations
  private mlService: MLSignalService;
  private riskEngine: RiskCheckService;
  private executionEngine: ExecutionService;
  
  // Portfolio state for risk assessment
  private portfolioState: PortfolioState;
  
  constructor(config: Partial<OrchestratorConfig> = {}) {
    super();
    
    this.config = {
      enableMLPredictions: config.enableMLPredictions ?? true,
      enableRiskManagement: config.enableRiskManagement ?? true,
      enableConsensus: config.enableConsensus ?? true,
      minConsensusConfidence: config.minConsensusConfidence ?? 0.67,
      maxConcurrentTrades: config.maxConcurrentTrades ?? 5,
      enableNotifications: config.enableNotifications ?? true,
    };
    
    // Initialize services
    this.mlService = new MLSignalService();
    this.riskEngine = new RiskCheckService();
    this.executionEngine = new ExecutionService();
    
    // Initialize portfolio state
    this.portfolioState = {
      totalValue: 100000, // $100k starting capital
      cash: 100000,
      positions: new Map(),
      openOrders: 0,
      dailyPnL: 0,
      weeklyPnL: 0,
      currentDrawdown: 0,
      maxDrawdown: 0
    };
    
    // Set up service event listeners
    this.setupServiceListeners();
  }
  
  /**
   * Set up event listeners for services
   */
  private setupServiceListeners(): void {
    // ML Signal Service events
    this.mlService.on('new-signal', (prediction: MLPrediction) => {
      if (this.isRunning) {
        this.processPrediction(prediction).catch(error => {
          console.error('[Orchestrator] Error processing prediction:', error);
        });
      }
    });
    
    // Risk Check Service events
    this.riskEngine.on('circuit-breaker-triggered', (event: any) => {
      console.error('[Orchestrator] 🚨 CIRCUIT BREAKER TRIGGERED 🚨');
      console.error('[Orchestrator] Reason:', event.reason);
      this.emit('circuit-breaker-triggered', event);
      
      // Optionally stop trading
      // this.stop();
    });
    
    this.riskEngine.on('prediction-rejected', (event: any) => {
      console.warn('[Orchestrator] Prediction rejected:', event.reason);
      this.emit('prediction-rejected', event);
    });
    
    // Execution Service events
    this.executionEngine.on('execution-complete', (event: any) => {
      console.log('[Orchestrator] Execution complete');
      this.updatePortfolioAfterExecution(event.result);
    });
  }
  
  /**
   * Initialize orchestrator
   */
  async initialize(options: {
    oracleCoordinator?: OracleCoordinator;
  } = {}): Promise<void> {
    console.log('[Orchestrator] Initializing Autonomous Execution Orchestrator...');
    
    this.oracleCoordinator = options.oracleCoordinator || null;
    
    // Initialize services
    console.log('[Orchestrator] Initializing ML Signal Service...');
    await this.mlService.initialize();
    
    console.log('[Orchestrator] Initializing Risk Check Service...');
    await this.riskEngine.initialize();
    
    console.log('[Orchestrator] Initializing Execution Service...');
    await this.executionEngine.initialize();
    
    if (this.oracleCoordinator) {
      console.log('[Orchestrator] Initializing Oracle Coordinator...');
      await this.oracleCoordinator.initialize();
    }
    
    console.log('[Orchestrator] ✅ Autonomous Execution Orchestrator initialized');
    console.log(`[Orchestrator]   ML Predictions: ${this.config.enableMLPredictions ? 'ENABLED' : 'DISABLED'}`);
    console.log(`[Orchestrator]   Risk Management: ${this.config.enableRiskManagement ? 'ENABLED' : 'DISABLED'}`);
    console.log(`[Orchestrator]   Oracle Consensus: ${this.config.enableConsensus ? 'ENABLED' : 'DISABLED'}`);
    console.log(`[Orchestrator]   Max Concurrent Trades: ${this.config.maxConcurrentTrades}`);
    console.log(`[Orchestrator]   Portfolio Value: $${this.portfolioState.totalValue.toLocaleString()}`);
    
    this.emit('initialized');
  }
  
  /**
   * Start autonomous trading
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.warn('[Orchestrator] Orchestrator already running');
      return;
    }
    
    console.log('[Orchestrator] 🚀 Starting autonomous trading...');
    
    this.isRunning = true;
    
    this.emit('started');
    
    // Start ML prediction generation (if enabled)
    if (this.config.enableMLPredictions) {
      console.log('[Orchestrator] Starting ML signal generation...');
      await this.mlService.startGenerating(60000); // Generate signals every 60 seconds
    }
    
    console.log('[Orchestrator] ✅ Autonomous trading started');
  }
  
  /**
   * Stop autonomous trading
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }
    
    console.log('[Orchestrator] Stopping autonomous trading...');
    
    this.isRunning = false;
    
    // Stop ML signal generation
    this.mlService.stopGenerating();
    
    // Wait for active trades to complete
    console.log(`[Orchestrator] Waiting for ${this.activeTrades.size} active trades to complete...`);
    
    while (this.activeTrades.size > 0) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log('[Orchestrator] ✅ Autonomous trading stopped');
    
    this.emit('stopped');
  }
  
  /**
   * Process a new ML prediction
   */
  async processPrediction(prediction: MLPrediction): Promise<string> {
    // Check if we can accept more trades
    if (this.activeTrades.size >= this.config.maxConcurrentTrades) {
      console.warn(`Max concurrent trades reached (${this.config.maxConcurrentTrades}), rejecting prediction`);
      throw new Error('Max concurrent trades reached');
    }
    
    // Create trade flow
    const tradeId = this.generateTradeId();
    
    const trade: AutonomousTradeFlow = {
      id: tradeId,
      prediction,
      riskAssessment: null,
      consensusReached: false,
      executionPlan: null,
      executionResult: null,
      status: 'PENDING',
      startTime: Date.now(),
      endTime: null,
      error: null,
    };
    
    this.activeTrades.set(tradeId, trade);
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`NEW TRADE FLOW: ${tradeId}`);
    console.log(`${'='.repeat(60)}`);
    console.log(`Symbol: ${prediction.symbol}`);
    console.log(`Action: ${prediction.action}`);
    console.log(`Confidence: ${(prediction.confidence * 100).toFixed(2)}%`);
    console.log(`Price: $${prediction.price.toFixed(2)}`);
    console.log(`Model: ${prediction.modelId}`);
    
    this.emit('tradeStarted', trade);
    
    // Execute trade flow asynchronously
    this.executeTradeFlow(tradeId).catch(error => {
      console.error(`Trade flow ${tradeId} failed:`, error);
      trade.status = 'FAILED';
      trade.error = error.message;
      trade.endTime = Date.now();
      this.completeTrade(tradeId);
    });
    
    return tradeId;
  }
  
  /**
   * Execute full trade flow
   */
  private async executeTradeFlow(tradeId: string): Promise<void> {
    const trade = this.activeTrades.get(tradeId);
    
    if (!trade) {
      throw new Error(`Trade ${tradeId} not found`);
    }
    
    try {
      // Step 1: Risk Management
      if (this.config.enableRiskManagement) {
        console.log(`\n[${tradeId}] Step 1: Risk Management`);
        trade.status = 'RISK_CHECK';
        
        const riskAssessment = await this.performRiskAssessment(trade.prediction);
        trade.riskAssessment = riskAssessment;
        
        if (!riskAssessment.approved) {
          console.log(`[${tradeId}] ❌ REJECTED by risk management`);
          console.log(`  Reasons: ${riskAssessment.reasons.join(', ')}`);
          trade.status = 'REJECTED';
          trade.endTime = Date.now();
          this.completeTrade(tradeId);
          return;
        }
        
        console.log(`[${tradeId}] ✅ APPROVED by risk management`);
        console.log(`  Adjusted Quantity: ${riskAssessment.adjustedQuantity}`);
        console.log(`  Risk Score: ${riskAssessment.riskScore.toFixed(2)}`);
        console.log(`  Max Loss: $${riskAssessment.maxLoss.toFixed(2)}`);
      }
      
      // Step 2: Oracle Consensus
      if (this.config.enableConsensus && this.oracleCoordinator) {
        console.log(`\n[${tradeId}] Step 2: Oracle Consensus`);
        trade.status = 'CONSENSUS';
        
        const signal: TradingSignal = {
          symbol: trade.prediction.symbol,
          action: trade.prediction.action,
          confidence: trade.prediction.confidence,
          price: trade.prediction.price,
          quantity: trade.riskAssessment?.adjustedQuantity || 0,
          timestamp: Date.now(),
          modelId: trade.prediction.modelId,
          features: trade.prediction.features,
        };
        
        const consensusResponse = await this.oracleCoordinator.requestConsensus(signal);
        trade.consensusReached = consensusResponse.consensusReached;
        
        if (!consensusResponse.consensusReached) {
          console.log(`[${tradeId}] ❌ CONSENSUS NOT REACHED`);
          console.log(`  Confidence: ${(consensusResponse.confidence * 100).toFixed(2)}%`);
          console.log(`  Required: ${(this.config.minConsensusConfidence * 100).toFixed(2)}%`);
          trade.status = 'REJECTED';
          trade.endTime = Date.now();
          this.completeTrade(tradeId);
          return;
        }
        
        if (consensusResponse.confidence < this.config.minConsensusConfidence) {
          console.log(`[${tradeId}] ❌ CONSENSUS CONFIDENCE TOO LOW`);
          console.log(`  Confidence: ${(consensusResponse.confidence * 100).toFixed(2)}%`);
          trade.status = 'REJECTED';
          trade.endTime = Date.now();
          this.completeTrade(tradeId);
          return;
        }
        
        console.log(`[${tradeId}] ✅ CONSENSUS REACHED`);
        console.log(`  Confidence: ${(consensusResponse.confidence * 100).toFixed(2)}%`);
        console.log(`  Participating Oracles: ${consensusResponse.participatingOracles}`);
      }
      
      // Step 3: Create Execution Plan
      console.log(`\n[${tradeId}] Step 3: Execution Planning`);
      
      const executionPlan = this.createExecutionPlan(trade);
      trade.executionPlan = executionPlan;
      
      console.log(`[${tradeId}] Execution Plan:`);
      console.log(`  Algorithm: ${executionPlan.algorithm}`);
      console.log(`  Quantity: ${executionPlan.quantity}`);
      console.log(`  Urgency: ${executionPlan.urgency}`);
      console.log(`  Max Slippage: ${(executionPlan.maxSlippage * 100).toFixed(2)}%`);
      
      // Step 4: Execute Trade
      console.log(`\n[${tradeId}] Step 4: Trade Execution`);
      trade.status = 'EXECUTING';
      
      const executionResult = await this.executeTrade(executionPlan);
      trade.executionResult = executionResult;
      
      if (executionResult.success) {
        console.log(`[${tradeId}] ✅ EXECUTION SUCCESSFUL`);
        console.log(`  Executed Quantity: ${executionResult.executedQuantity}`);
        console.log(`  Average Price: $${executionResult.averagePrice.toFixed(2)}`);
        console.log(`  Total Cost: $${executionResult.totalCost.toFixed(2)}`);
        console.log(`  Slippage: ${(executionResult.slippage * 100).toFixed(4)}%`);
        console.log(`  Duration: ${(executionResult.duration / 1000).toFixed(2)}s`);
        trade.status = 'COMPLETED';
      } else {
        console.log(`[${tradeId}] ❌ EXECUTION FAILED`);
        trade.status = 'FAILED';
      }
      
      trade.endTime = Date.now();
      
      console.log(`\n${'='.repeat(60)}`);
      console.log(`TRADE FLOW COMPLETE: ${tradeId}`);
      console.log(`Status: ${trade.status}`);
      console.log(`Duration: ${((trade.endTime - trade.startTime) / 1000).toFixed(2)}s`);
      console.log(`${'='.repeat(60)}\n`);
      
      this.completeTrade(tradeId);
      
    } catch (error: any) {
      console.error(`[${tradeId}] Trade flow failed:`, error);
      trade.status = 'FAILED';
      trade.error = error.message;
      trade.endTime = Date.now();
      this.completeTrade(tradeId);
      throw error;
    }
  }
  
  /**
   * Perform risk assessment using RiskCheckService
   */
  private async performRiskAssessment(prediction: MLPrediction): Promise<RiskAssessment> {
    return await this.riskEngine.validatePrediction(prediction, this.portfolioState);
  }
  
  /**
   * Create execution plan based on prediction and risk assessment
   */
  private createExecutionPlan(trade: AutonomousTradeFlow): ExecutionPlan {
    const prediction = trade.prediction;
    const riskAssessment = trade.riskAssessment!;
    
    // Determine algorithm based on confidence, size, and urgency
    let algorithm: 'TWAP' | 'VWAP' | 'POV' | 'ICEBERG' | 'SMART' = 'SMART';
    let urgency: 'LOW' | 'MEDIUM' | 'HIGH' = 'MEDIUM';
    
    // High confidence = aggressive execution (VWAP)
    if (prediction.confidence > 0.85) {
      algorithm = 'VWAP';
      urgency = 'HIGH';
    }
    // Large position = stealth execution (ICEBERG)
    else if (riskAssessment.positionSize > this.portfolioState.totalValue * 0.05) {
      algorithm = 'ICEBERG';
      urgency = 'LOW';
    }
    // Medium confidence = time-weighted (TWAP)
    else if (prediction.confidence > 0.70) {
      algorithm = 'TWAP';
      urgency = 'MEDIUM';
    }
    // Default = smart routing
    else {
      algorithm = 'SMART';
      urgency = 'MEDIUM';
    }
    
    return {
      symbol: prediction.symbol,
      side: prediction.action === 'BUY' ? 'BUY' : 'SELL',
      quantity: riskAssessment.adjustedQuantity,
      algorithm,
      urgency,
      maxSlippage: 0.01, // 1% max slippage
      timeLimit: prediction.timeHorizon || 300000, // 5 minutes default
    };
  }
  
  /**
   * Execute trade using ExecutionService
   */
  private async executeTrade(plan: ExecutionPlan): Promise<ExecutionResult> {
    return await this.executionEngine.execute(plan);
  }
  
  /**
   * Update portfolio state after execution
   */
  private updatePortfolioAfterExecution(result: ExecutionResult): void {
    if (!result.success) {
      return;
    }
    
    // Update cash
    this.portfolioState.cash -= result.totalCost;
    
    // Update positions
    // In production, would update actual positions
    
    // Update PnL tracking
    // In production, would calculate actual PnL
    
    console.log('[Orchestrator] Portfolio updated');
    console.log(`  Cash: $${this.portfolioState.cash.toFixed(2)}`);
    console.log(`  Total Value: $${this.portfolioState.totalValue.toFixed(2)}`);
  }
  
  /**
   * Complete trade and move to history
   */
  private completeTrade(tradeId: string): void {
    const trade = this.activeTrades.get(tradeId);
    
    if (!trade) {
      return;
    }
    
    this.activeTrades.delete(tradeId);
    this.completedTrades.push(trade);
    
    this.emit('tradeCompleted', trade);
  }
  
  /**
   * Get portfolio state
   */
  getPortfolioState(): PortfolioState {
    return { ...this.portfolioState };
  }
  
  /**
   * Update portfolio state
   */
  updatePortfolioState(updates: Partial<PortfolioState>): void {
    this.portfolioState = {
      ...this.portfolioState,
      ...updates
    };
    console.log('[Orchestrator] Portfolio state updated');
  }
  
  /**
   * Get ML service
   */
  getMLService(): MLSignalService {
    return this.mlService;
  }
  
  /**
   * Get risk engine
   */
  getRiskEngine(): RiskCheckService {
    return this.riskEngine;
  }
  
  /**
   * Get execution engine
   */
  getExecutionEngine(): ExecutionService {
    return this.executionEngine;
  }
  
  /**
   * Generate unique trade ID
   */
  private generateTradeId(): string {
    return `trade_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }
  
  /**
   * Get active trades
   */
  getActiveTrades(): AutonomousTradeFlow[] {
    return Array.from(this.activeTrades.values());
  }
  
  /**
   * Get completed trades
   */
  getCompletedTrades(): AutonomousTradeFlow[] {
    return this.completedTrades;
  }
  
  /**
   * Get trade by ID
   */
  getTrade(tradeId: string): AutonomousTradeFlow | null {
    return this.activeTrades.get(tradeId) || 
           this.completedTrades.find(t => t.id === tradeId) || 
           null;
  }
  
  /**
   * Get statistics
   */
  getStatistics(): {
    active: number;
    completed: number;
    successful: number;
    failed: number;
    rejected: number;
    successRate: number;
  } {
    const completed = this.completedTrades;
    const successful = completed.filter(t => t.status === 'COMPLETED').length;
    const failed = completed.filter(t => t.status === 'FAILED').length;
    const rejected = completed.filter(t => t.status === 'REJECTED').length;
    
    return {
      active: this.activeTrades.size,
      completed: completed.length,
      successful,
      failed,
      rejected,
      successRate: completed.length > 0 ? successful / completed.length : 0,
    };
  }
  
  /**
   * Shutdown orchestrator
   */
  async shutdown(): Promise<void> {
    console.log('Shutting down Autonomous Execution Orchestrator...');
    
    await this.stop();
    
    if (this.oracleCoordinator) {
      await this.oracleCoordinator.shutdown();
    }
    
    this.activeTrades.clear();
    
    this.emit('shutdown');
  }
}
