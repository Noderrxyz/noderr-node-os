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

import { Logger } from '@noderr/utils/src';
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

const logger = new Logger('AutonomousExecutionOrchestrator');
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
          logger.error('[Orchestrator] Error processing prediction:', error);
        });
      }
    });
    
    // Risk Check Service events
    this.riskEngine.on('circuit-breaker-triggered', (event: any) => {
      logger.error('[Orchestrator] 🚨 CIRCUIT BREAKER TRIGGERED 🚨');
      logger.error('[Orchestrator] Reason:', event.reason);
      this.emit('circuit-breaker-triggered', event);
      
      // Optionally stop trading
      // this.stop();
    });
    
    this.riskEngine.on('prediction-rejected', (event: any) => {
      logger.warn('[Orchestrator] Prediction rejected:', event.reason);
      this.emit('prediction-rejected', event);
    });
    
    // Execution Service events
    this.executionEngine.on('execution-complete', (event: any) => {
      logger.info('[Orchestrator] Execution complete');
      this.updatePortfolioAfterExecution(event.result);
    });
  }
  
  /**
   * Initialize orchestrator
   */
  async initialize(options: {
    oracleCoordinator?: OracleCoordinator;
  } = {}): Promise<void> {
    logger.info('[Orchestrator] Initializing Autonomous Execution Orchestrator...');
    
    this.oracleCoordinator = options.oracleCoordinator || null;
    
    // Initialize services
    logger.info('[Orchestrator] Initializing ML Signal Service...');
    await this.mlService.initialize();
    
    logger.info('[Orchestrator] Initializing Risk Check Service...');
    await this.riskEngine.initialize();
    
    logger.info('[Orchestrator] Initializing Execution Service...');
    await this.executionEngine.initialize();
    
    if (this.oracleCoordinator) {
      logger.info('[Orchestrator] Initializing Oracle Coordinator...');
      await this.oracleCoordinator.initialize();
    }
    
    logger.info('[Orchestrator] ✅ Autonomous Execution Orchestrator initialized');
    logger.info(`[Orchestrator]   ML Predictions: ${this.config.enableMLPredictions ? 'ENABLED' : 'DISABLED'}`);
    logger.info(`[Orchestrator]   Risk Management: ${this.config.enableRiskManagement ? 'ENABLED' : 'DISABLED'}`);
    logger.info(`[Orchestrator]   Oracle Consensus: ${this.config.enableConsensus ? 'ENABLED' : 'DISABLED'}`);
    logger.info(`[Orchestrator]   Max Concurrent Trades: ${this.config.maxConcurrentTrades}`);
    logger.info(`[Orchestrator]   Portfolio Value: $${this.portfolioState.totalValue.toLocaleString()}`);
    
    this.emit('initialized');
  }
  
  /**
   * Start autonomous trading
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('[Orchestrator] Orchestrator already running');
      return;
    }
    
    logger.info('[Orchestrator] 🚀 Starting autonomous trading...');
    
    this.isRunning = true;
    
    this.emit('started');
    
    // Start ML prediction generation (if enabled)
    if (this.config.enableMLPredictions) {
      logger.info('[Orchestrator] Starting ML signal generation...');
      await this.mlService.startGenerating(60000); // Generate signals every 60 seconds
    }
    
    logger.info('[Orchestrator] ✅ Autonomous trading started');
  }
  
  /**
   * Stop autonomous trading
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }
    
    logger.info('[Orchestrator] Stopping autonomous trading...');
    
    this.isRunning = false;
    
    // Stop ML signal generation
    this.mlService.stopGenerating();
    
    // Wait for active trades to complete
    logger.info(`[Orchestrator] Waiting for ${this.activeTrades.size} active trades to complete...`);
    
    while (this.activeTrades.size > 0) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    logger.info('[Orchestrator] ✅ Autonomous trading stopped');
    
    this.emit('stopped');
  }
  
  /**
   * Process a new ML prediction
   */
  async processPrediction(prediction: MLPrediction): Promise<string> {
    // Check if we can accept more trades
    if (this.activeTrades.size >= this.config.maxConcurrentTrades) {
      logger.warn(`Max concurrent trades reached (${this.config.maxConcurrentTrades}), rejecting prediction`);
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
    
    logger.info(`\n${'='.repeat(60)}`);
    logger.info(`NEW TRADE FLOW: ${tradeId}`);
    logger.info(`${'='.repeat(60)}`);
    logger.info(`Symbol: ${prediction.symbol}`);
    logger.info(`Action: ${prediction.action}`);
    logger.info(`Confidence: ${(prediction.confidence * 100).toFixed(2)}%`);
    logger.info(`Price: $${prediction.price.toFixed(2)}`);
    logger.info(`Model: ${prediction.modelId}`);
    
    this.emit('tradeStarted', trade);
    
    // Execute trade flow asynchronously
    this.executeTradeFlow(tradeId).catch(error => {
      logger.error(`Trade flow ${tradeId} failed:`, error);
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
        logger.info(`\n[${tradeId}] Step 1: Risk Management`);
        trade.status = 'RISK_CHECK';
        
        const riskAssessment = await this.performRiskAssessment(trade.prediction);
        trade.riskAssessment = riskAssessment;
        
        if (!riskAssessment.approved) {
          logger.info(`[${tradeId}] ❌ REJECTED by risk management`);
          logger.info(`  Reasons: ${riskAssessment.reasons.join(', ')}`);
          trade.status = 'REJECTED';
          trade.endTime = Date.now();
          this.completeTrade(tradeId);
          return;
        }
        
        logger.info(`[${tradeId}] ✅ APPROVED by risk management`);
        logger.info(`  Adjusted Quantity: ${riskAssessment.adjustedQuantity}`);
        logger.info(`  Risk Score: ${riskAssessment.riskScore.toFixed(2)}`);
        logger.info(`  Max Loss: $${riskAssessment.maxLoss.toFixed(2)}`);
      }
      
      // Step 2: Oracle Consensus
      if (this.config.enableConsensus && this.oracleCoordinator) {
        logger.info(`\n[${tradeId}] Step 2: Oracle Consensus`);
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
          logger.info(`[${tradeId}] ❌ CONSENSUS NOT REACHED`);
          logger.info(`  Confidence: ${(consensusResponse.confidence * 100).toFixed(2)}%`);
          logger.info(`  Required: ${(this.config.minConsensusConfidence * 100).toFixed(2)}%`);
          trade.status = 'REJECTED';
          trade.endTime = Date.now();
          this.completeTrade(tradeId);
          return;
        }
        
        if (consensusResponse.confidence < this.config.minConsensusConfidence) {
          logger.info(`[${tradeId}] ❌ CONSENSUS CONFIDENCE TOO LOW`);
          logger.info(`  Confidence: ${(consensusResponse.confidence * 100).toFixed(2)}%`);
          trade.status = 'REJECTED';
          trade.endTime = Date.now();
          this.completeTrade(tradeId);
          return;
        }
        
        logger.info(`[${tradeId}] ✅ CONSENSUS REACHED`);
        logger.info(`  Confidence: ${(consensusResponse.confidence * 100).toFixed(2)}%`);
        logger.info(`  Participating Oracles: ${consensusResponse.participatingOracles}`);
      }
      
      // Step 3: Create Execution Plan
      logger.info(`\n[${tradeId}] Step 3: Execution Planning`);
      
      const executionPlan = this.createExecutionPlan(trade);
      trade.executionPlan = executionPlan;
      
      logger.info(`[${tradeId}] Execution Plan:`);
      logger.info(`  Algorithm: ${executionPlan.algorithm}`);
      logger.info(`  Quantity: ${executionPlan.quantity}`);
      logger.info(`  Urgency: ${executionPlan.urgency}`);
      logger.info(`  Max Slippage: ${(executionPlan.maxSlippage * 100).toFixed(2)}%`);
      
      // Step 4: Execute Trade
      logger.info(`\n[${tradeId}] Step 4: Trade Execution`);
      trade.status = 'EXECUTING';
      
      const executionResult = await this.executeTrade(executionPlan);
      trade.executionResult = executionResult;
      
      if (executionResult.success) {
        logger.info(`[${tradeId}] ✅ EXECUTION SUCCESSFUL`);
        logger.info(`  Executed Quantity: ${executionResult.executedQuantity}`);
        logger.info(`  Average Price: $${executionResult.averagePrice.toFixed(2)}`);
        logger.info(`  Total Cost: $${executionResult.totalCost.toFixed(2)}`);
        logger.info(`  Slippage: ${(executionResult.slippage * 100).toFixed(4)}%`);
        logger.info(`  Duration: ${(executionResult.duration / 1000).toFixed(2)}s`);
        trade.status = 'COMPLETED';
      } else {
        logger.info(`[${tradeId}] ❌ EXECUTION FAILED`);
        trade.status = 'FAILED';
      }
      
      trade.endTime = Date.now();
      
      logger.info(`\n${'='.repeat(60)}`);
      logger.info(`TRADE FLOW COMPLETE: ${tradeId}`);
      logger.info(`Status: ${trade.status}`);
      logger.info(`Duration: ${((trade.endTime - trade.startTime) / 1000).toFixed(2)}s`);
      logger.info(`${'='.repeat(60)}\n`);
      
      this.completeTrade(tradeId);
      
    } catch (error: any) {
      logger.error(`[${tradeId}] Trade flow failed:`, error);
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
    
    logger.info('[Orchestrator] Portfolio updated');
    logger.info(`  Cash: $${this.portfolioState.cash.toFixed(2)}`);
    logger.info(`  Total Value: $${this.portfolioState.totalValue.toFixed(2)}`);
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
    logger.info('[Orchestrator] Portfolio state updated');
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
    logger.info('Shutting down Autonomous Execution Orchestrator...');
    
    await this.stop();
    
    if (this.oracleCoordinator) {
      await this.oracleCoordinator.shutdown();
    }
    
    this.activeTrades.clear();
    
    this.emit('shutdown');
  }
}
