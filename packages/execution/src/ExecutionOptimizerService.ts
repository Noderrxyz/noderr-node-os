import {
  Order,
  Exchange,
  ExecutionOptimizerConfig,
  RoutingDecision,
  ExecutionResult,
  ExecutionAnalytics,
  AlgorithmConfig,
  AlgorithmType,
  OrderSide,
  OrderType,
  ExecutionStatus,
  ExecutionError,
  ExecutionErrorCode,
  MarketCondition,
  ExecutionUrgency,
  TelemetryConfig,
  ExecutionRoute,
  MEVProtectionResult
} from './types';
import { Logger } from 'winston';
import EventEmitter from 'events';
import { SmartOrderRouter } from './SmartOrderRouter';
import { LiquidityAggregator } from './LiquidityAggregator';
import { CostOptimizer } from './CostOptimizer';
import { LatencyManager } from './LatencyManager';
import { TWAPAlgorithm } from './algorithms/TWAPAlgorithm';
import { VWAPAlgorithm } from './algorithms/VWAPAlgorithm';
import { POVAlgorithm } from './algorithms/POVAlgorithm';
import { IcebergAlgorithm } from './algorithms/IcebergAlgorithm';
import { MEVProtectionManager } from './MEVProtectionManager';
import { PredictiveExecutionEngine } from '@noderr/ml/PredictiveExecutionEngine';
import { ethers } from 'ethers';
import { SafetyControllerWrapper } from '../safety/SafetyControllerWrapper';
import { ExecutionTelemetryIntegration } from '@noderr/telemetry/ExecutionTelemetryIntegration';

interface ServiceState {
  isRunning: boolean;
  exchanges: Map<string, Exchange>;
  activeOrders: Map<string, Order>;
  executionResults: Map<string, ExecutionResult>;
  marketCondition: MarketCondition;
  lastUpdate: number;
}

export class ExecutionOptimizerService extends EventEmitter {
  private logger: Logger;
  private config: ExecutionOptimizerConfig;
  private state: ServiceState;
  
  // Core components
  private router: SmartOrderRouter;
  private liquidityAggregator: LiquidityAggregator;
  private costOptimizer: CostOptimizer;
  private latencyManager: LatencyManager;
  private mevProtection: MEVProtectionManager;
  
  // Algorithms
  private algorithms: Map<AlgorithmType, any>;
  
  // Telemetry
  private analytics: ExecutionAnalytics;
  private telemetryInterval?: NodeJS.Timeout;
  private activeExecutions: Map<string, ExecutionStatus>;
  private executionHistory: ExecutionResult[];
  private marketCondition: MarketCondition;
  private predictiveEngine: PredictiveExecutionEngine;
  
  // Safety integration
  private safetyController: SafetyControllerWrapper;
  private telemetry: ExecutionTelemetryIntegration;

  constructor(
    config: ExecutionOptimizerConfig,
    logger: Logger,
    provider?: ethers.providers.Provider
  ) {
    super();
    this.config = config;
    this.logger = logger;
    
    // Initialize state
    this.state = {
      isRunning: false,
      exchanges: new Map(),
      activeOrders: new Map(),
      executionResults: new Map(),
      marketCondition: MarketCondition.NORMAL,
      lastUpdate: Date.now()
    };
    
    // Initialize exchanges
    this.initializeExchanges();
    
    // Initialize core components
    const exchanges = Array.from(this.state.exchanges.values());
    this.router = new SmartOrderRouter(config.routing, logger, exchanges);
    this.liquidityAggregator = new LiquidityAggregator(logger, exchanges);
    this.costOptimizer = new CostOptimizer(logger);
    this.latencyManager = new LatencyManager(logger);
    this.mevProtection = new MEVProtectionManager(config.mevProtection, logger, provider);
    this.algorithms = new Map();
    this.activeExecutions = new Map();
    this.executionHistory = [];
    this.marketCondition = MarketCondition.NORMAL;
    this.predictiveEngine = new PredictiveExecutionEngine(logger);
    
    // Initialize safety controller
    this.safetyController = SafetyControllerWrapper.getInstance();
    
    // Initialize telemetry
    this.telemetry = new ExecutionTelemetryIntegration();
    
    // Setup safety event listeners
    this.setupSafetyListeners();
    
    // Initialize algorithms
    this.initializeAlgorithms();
    
    // Initialize analytics
    this.analytics = this.initializeAnalytics();
    
    // Setup event listeners
    this.setupEventListeners();
  }

  /**
   * Start the execution optimizer service
   */
  async start(): Promise<void> {
    if (this.state.isRunning) {
      this.logger.warn('Execution optimizer already running');
      return;
    }
    
    this.logger.info('Starting execution optimizer service');
    
    // Start liquidity aggregation
    const symbols = this.getActiveSymbols();
    this.liquidityAggregator.subscribe(symbols);
    
    // Start telemetry collection
    if (this.config.telemetry.enabled) {
      this.startTelemetryCollection();
    }
    
    this.state.isRunning = true;
    this.emit('started', { timestamp: Date.now() });
  }

  /**
   * Stop the execution optimizer service
   */
  async stop(): Promise<void> {
    if (!this.state.isRunning) {
      return;
    }
    
    this.logger.info('Stopping execution optimizer service');
    
    // Stop telemetry
    if (this.telemetryInterval) {
      clearInterval(this.telemetryInterval);
      this.telemetryInterval = undefined;
    }
    
    // Clean up components
    this.liquidityAggregator.destroy();
    this.latencyManager.destroy();
    this.mevProtection.destroy();
    
    // Clean up algorithms
    for (const algo of this.algorithms.values()) {
      if (algo.destroy) {
        algo.destroy();
      }
    }
    
    this.state.isRunning = false;
    this.emit('stopped', { timestamp: Date.now() });
  }

  /**
   * Execute an order with smart routing and optimization
   */
  async executeOrder(order: Order): Promise<ExecutionResult> {
    if (!this.state.isRunning) {
      throw new ExecutionError(
        ExecutionErrorCode.CONFIGURATION_ERROR,
        'Service not running'
      );
    }
    
    // Safety check: Apply trading mode restrictions
    if (!this.safetyController.canExecuteLiveTrade()) {
      const mode = this.safetyController.getTradingMode();
      
      // In PAUSED mode, reject all orders unless explicitly allowed
      if (mode === 'PAUSED' && !order.metadata?.allowInPausedMode) {
        throw new ExecutionError(
          ExecutionErrorCode.CONFIGURATION_ERROR,
          `Trading is paused. Cannot execute order ${order.id}`
        );
      }
      
      // In SIMULATION mode, convert orders to simulation
      if (mode === 'SIMULATION' && !order.metadata?.isSimulation) {
        this.logger.warn(
          `Converting order ${order.id} to simulation (mode: ${mode})`,
          {
            orderId: order.id,
            symbol: order.symbol,
            quantity: order.quantity,
            originalType: order.type
          }
        );
        
        // Mark order as simulation
        order.metadata = {
          ...order.metadata,
          isSimulation: true,
          originalMode: mode,
          convertedAt: Date.now()
        };
      }
    }
    
    // Log safety status
    this.logger.info('Order safety check', {
      orderId: order.id,
      tradingMode: this.safetyController.getTradingMode(),
      isSimulation: order.metadata?.isSimulation || false,
      canExecuteLive: this.safetyController.canExecuteLiveTrade()
    });
    
    // Record telemetry for order received
    this.telemetry.recordOrderReceived(order);
    
    // Record safety enforcement if order was converted
    if (order.metadata?.convertedAt) {
      this.telemetry.recordOrderConverted(
        order,
        order.metadata.originalMode || 'unknown',
        'SIMULATION'
      );
    }
    
    this.logger.info('Executing order', {
      orderId: order.id,
      symbol: order.symbol,
      quantity: order.quantity,
      side: order.side
    });
    
    try {
      // Use predictive engine for algorithm selection if not specified
      let selectedAlgorithm = order.metadata?.algorithm;
      let executionParameters = {};
      
      if (!selectedAlgorithm || this.config.enableMLPrediction) {
        // Get ML predictions
        const prediction = await this.predictiveEngine.predictExecution(
          order,
          this.marketCondition
        );
        
        this.logger.info('ML prediction received', {
          orderId: order.id,
          recommendedAlgorithm: prediction.recommendedAlgorithm,
          confidence: prediction.algorithmConfidence,
          predictedSlippage: (prediction.predictedSlippage * 10000).toFixed(1) + ' bps',
          executionRisk: (prediction.executionRisk * 100).toFixed(1) + '%'
        });
        
        // Use ML recommendation if confidence is high enough
        if (!selectedAlgorithm || prediction.algorithmConfidence > 0.8) {
          selectedAlgorithm = prediction.recommendedAlgorithm;
          executionParameters = prediction.optimalParameters;
          
          // Record algorithm selection telemetry
          this.telemetry.recordAlgorithmSelection(
            order.id,
            prediction.recommendedAlgorithm,
            prediction.algorithmConfidence
          );
          
          // Wait for optimal start time if recommended
          const delayMs = prediction.optimalStartTime - Date.now();
          if (delayMs > 0 && delayMs < 3600000) { // Max 1 hour delay
            this.logger.info(`Delaying execution for optimal timing: ${delayMs}ms`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
          }
        }
      }

      // Add to active orders
      this.state.activeOrders.set(order.id, order);
      
      // Determine execution strategy
      const algorithm = this.selectAlgorithm(order);
      
      if (algorithm) {
        // Execute using algorithm
        return await this.executeWithAlgorithm(order, algorithm);
      } else {
        // Direct execution with smart routing
        return await this.executeDirectOrder(order);
      }
      
    } catch (error) {
      this.logger.error('Order execution failed', { orderId: order.id, error });
      
      // Record failure telemetry
      this.telemetry.recordOrderFailed(order.id, error, order);
      
      // Create failed result
      const result: ExecutionResult = {
        orderId: order.id,
        status: ExecutionStatus.FAILED,
        fills: [],
        averagePrice: 0,
        totalQuantity: 0,
        totalFees: 0,
        slippage: 0,
        marketImpact: 0,
        executionTime: 0,
        routes: [],
        performance: {
          slippageBps: 0,
          implementationShortfall: 0,
          fillRate: 0,
          reversion: 0,
          benchmarkDeviation: 0,
          opportunityCost: 0,
          totalCost: 0
        }
      };
      
      this.state.executionResults.set(order.id, result);
      throw error;
      
    } finally {
      this.state.activeOrders.delete(order.id);
    }
  }

  /**
   * Get execution analytics
   */
  getAnalytics(): ExecutionAnalytics {
    return { ...this.analytics };
  }

  /**
   * Get execution result
   */
  getExecutionResult(orderId: string): ExecutionResult | null {
    return this.state.executionResults.get(orderId) || null;
  }

  /**
   * Update market condition
   */
  updateMarketCondition(condition: MarketCondition): void {
    const oldCondition = this.state.marketCondition;
    this.state.marketCondition = condition;
    this.router.updateMarketCondition(condition);
    this.logger.info('Market condition updated', { condition });
    
    // Record market condition change
    this.telemetry.recordMarketConditionChange(oldCondition, condition);
  }

  // Private methods

  private initializeExchanges(): void {
    for (const exchangeConfig of this.config.exchanges) {
      if (!exchangeConfig.enabled) continue;
      
      const exchange: Exchange = {
        id: exchangeConfig.id,
        name: exchangeConfig.id,
        type: 'cex', // Would determine from config
        tradingFees: exchangeConfig.preferences.feeOverride || {
          maker: 0.001,
          taker: 0.001,
          withdrawal: {},
          deposit: {}
        },
        capabilities: [], // Would populate from exchange
        status: {
          operational: true,
          tradingEnabled: true,
          depositsEnabled: true,
          withdrawalsEnabled: true,
          maintenanceMode: false,
          uptime: 99.9
        },
        latency: 50,
        reliability: 0.99,
        liquidityScore: 80,
        mevProtection: false,
        apiRateLimit: exchangeConfig.rateLimit || {
          requests: 1200,
          period: 60
        },
        supportedPairs: exchangeConfig.preferences.allowedPairs,
        lastUpdate: Date.now()
      };
      
      this.state.exchanges.set(exchange.id, exchange);
    }
  }

  private initializeAlgorithms(): void {
    // TWAP
    this.algorithms.set(
      AlgorithmType.TWAP,
      new TWAPAlgorithm(this.logger)
    );
    
    // VWAP
    this.algorithms.set(
      AlgorithmType.VWAP,
      new VWAPAlgorithm(this.logger)
    );
    
    // POV (Percentage of Volume)
    this.algorithms.set(
      AlgorithmType.POV,
      new POVAlgorithm(this.logger)
    );
    
    // Iceberg
    this.algorithms.set(
      AlgorithmType.ICEBERG,
      new IcebergAlgorithm(this.logger)
    );
    
    // Add other algorithms as implemented
    // TODO: Implementation Shortfall, Sniper, Adaptive, etc.
  }

  private initializeAnalytics(): ExecutionAnalytics {
    return {
      period: {
        start: Date.now(),
        end: Date.now(),
        granularity: 'hour'
      },
      totalOrders: 0,
      totalVolume: 0,
      averageSlippage: 0,
      averageExecutionTime: 0,
      fillRate: 0,
      failureRate: 0,
      costAnalysis: {
        totalFees: 0,
        totalSlippage: 0,
        totalMarketImpact: 0,
        totalOpportunityCost: 0,
        averageCostBps: 0,
        savedFromOptimization: 0
      },
      exchangePerformance: {},
      algorithmPerformance: {},
      mevStats: {
        attacksDetected: 0,
        attacksPrevented: 0,
        estimatedSavings: 0,
        bundlesSubmitted: 0,
        bundlesIncluded: 0,
        averageGasPrice: 0,
        averagePriorityFee: 0
      }
    };
  }

  private setupEventListeners(): void {
    // Router events
    this.router.on('orderRouted', (data) => {
      this.updateAnalytics('routing', data);
    });
    
    // Algorithm events
    for (const [type, algorithm] of this.algorithms) {
      algorithm.on('executionCompleted', (result: ExecutionResult) => {
        this.handleExecutionComplete(result);
      });
      
      algorithm.on('metricsUpdate', (metrics: any) => {
        this.updateAlgorithmMetrics(type, metrics);
      });
    }
    
    // MEV events
    this.mevProtection.on('mevProtectionApplied', (data) => {
      this.analytics.mevStats.attacksPrevented++;
      this.analytics.mevStats.estimatedSavings += data.savedAmount || 0;
    });
  }

  private selectAlgorithm(order: Order): AlgorithmConfig | null {
    // Check if order specifies algorithm
    if (order.metadata?.algorithm) {
      const algorithmType = order.metadata.algorithm as AlgorithmType;
      const config = this.config.algorithms.find(a => a.type === algorithmType);
      return config || null;
    }
    
    // Auto-select based on order characteristics
    if (order.quantity > 10000 && order.type === OrderType.MARKET) {
      // Large market orders benefit from TWAP
      return this.config.algorithms.find(a => a.type === AlgorithmType.TWAP) || null;
    }
    
    return null;
  }

  private async executeWithAlgorithm(
    order: Order,
    algorithmConfig: AlgorithmConfig
  ): Promise<ExecutionResult> {
    const algorithm = this.algorithms.get(algorithmConfig.type);
    
    if (!algorithm) {
      throw new ExecutionError(
        ExecutionErrorCode.CONFIGURATION_ERROR,
        `Algorithm not available: ${algorithmConfig.type}`
      );
    }
    
    // Execute using algorithm
    await algorithm.execute(order, algorithmConfig, this.router);
    
    // Wait for completion
    return new Promise((resolve, reject) => {
      const checkComplete = setInterval(() => {
        const status = algorithm.getExecutionStatus(order.id);
        
        if (!status) {
          clearInterval(checkComplete);
          reject(new Error('Execution status not found'));
          return;
        }
        
        if (status.status === ExecutionStatus.COMPLETED ||
            status.status === ExecutionStatus.FAILED ||
            status.status === ExecutionStatus.CANCELLED) {
          clearInterval(checkComplete);
          
          // Get final result
          const result = this.state.executionResults.get(order.id);
          if (result) {
            resolve(result);
          } else {
            reject(new Error('Execution result not found'));
          }
        }
      }, 1000);
      
      // Timeout after configured time
      setTimeout(() => {
        clearInterval(checkComplete);
        reject(new ExecutionError(
          ExecutionErrorCode.TIMEOUT,
          'Algorithm execution timeout'
        ));
      }, algorithmConfig.constraints.maxExecutionTime);
    });
  }

  private async executeDirectOrder(order: Order): Promise<ExecutionResult> {
    const startTime = Date.now();
    
    // Get routing decision
    const routing = await this.router.routeOrder(order);
    
    // Record routing telemetry
    this.telemetry.recordOrderRouted(order, routing);
    
    // Check MEV protection
    if (order.metadata?.mevProtection !== false) {
      const tx = this.createTransaction(order);
      const mevResult = await this.mevProtection.protectTransaction(tx, order);
      
      if (mevResult.protected) {
        this.logger.info('MEV protection applied', {
          orderId: order.id,
          strategy: mevResult.strategy
        });
        
        // Record MEV protection telemetry
        this.telemetry.recordMEVProtectionApplied(order.id, mevResult.strategy);
        if (mevResult.savedAmount) {
          this.telemetry.recordMEVSavings(order.id, mevResult.savedAmount);
        }
      }
    }
    
    // Execute routes asynchronously with racing and aggregation
    const fills = await this.executeRoutesAsync(routing, order);
    
    // Calculate execution metrics
    const totalQuantity = fills.reduce((sum, f) => sum + f.quantity, 0);
    const totalValue = fills.reduce((sum, f) => sum + f.quantity * f.price, 0);
    const totalFees = fills.reduce((sum, f) => sum + f.fee, 0);
    const averagePrice = totalQuantity > 0 ? totalValue / totalQuantity : 0;
    
    // Create result
    const result: ExecutionResult = {
      orderId: order.id,
      status: totalQuantity >= order.quantity * 0.99 
        ? ExecutionStatus.COMPLETED 
        : ExecutionStatus.PARTIAL,
      fills,
      averagePrice,
      totalQuantity,
      totalFees,
      slippage: routing.expectedSlippage,
      marketImpact: 0, // Would calculate
      executionTime: Date.now() - startTime,
      routes: routing.routes.map(r => ({
        exchange: r.exchange,
        orderId: order.id,
        quantity: r.quantity,
        fills: 1,
        averagePrice: r.price,
        fees: r.fees,
        latency: r.latency,
        success: true
      })),
      performance: {
        slippageBps: routing.expectedSlippage * 10000,
        implementationShortfall: 0,
        fillRate: totalQuantity / order.quantity,
        reversion: 0,
        benchmarkDeviation: 0,
        opportunityCost: 0,
        totalCost: totalFees + (routing.expectedSlippage * totalValue)
      }
    };
    
    this.state.executionResults.set(order.id, result);
    this.handleExecutionComplete(result);
    
    // Record execution telemetry
    this.telemetry.recordOrderExecuted(result);
    
    return result;
  }

  private createTransaction(order: Order): ethers.Transaction {
    // Mock transaction creation
    return {
      to: '0x0000000000000000000000000000000000000000',
      data: '0x',
      value: ethers.BigNumber.from(0),
      gasLimit: ethers.BigNumber.from(300000),
      nonce: 0,
      chainId: 1,
      from: '0x0000000000000000000000000000000000000000'
    };
  }

  private async executeRoutesAsync(routing: RoutingDecision, order: Order): Promise<any[]> {
    const allFills: any[] = [];
    let remainingQuantity = order.quantity;
    
    // Group routes by priority for racing
    const routeGroups = this.groupRoutesByPriority(routing.routes);
    
    for (const routeGroup of routeGroups) {
      if (remainingQuantity <= 0) break;
      
      // Use Promise.allSettled for simultaneous execution
      const routePromises = routeGroup.map(route => 
        this.executeRouteWithRetry(route, order, Math.min(route.quantity, remainingQuantity))
      );
      
      // Race orders and return first successful fills
      const raceResults = await this.raceOrderExecution(routePromises, remainingQuantity);
      
      // Aggregate partial fills
      const groupFills = this.aggregateExecutionResults(raceResults, order);
      allFills.push(...groupFills);
      
      // Update remaining quantity
      const groupQuantity = groupFills.reduce((sum, fill) => sum + fill.quantity, 0);
      remainingQuantity -= groupQuantity;
      
      this.logger.info(`Route group executed`, {
        orderId: order.id,
        groupSize: routeGroup.length,
        fillsReceived: groupFills.length,
        quantityFilled: groupQuantity,
        remainingQuantity
      });
    }
    
    return allFills;
  }

  private groupRoutesByPriority(routes: ExecutionRoute[]): ExecutionRoute[][] {
    const groups: Map<number, ExecutionRoute[]> = new Map();
    
    for (const route of routes) {
      const priority = route.priority || 50;
      const priorityBucket = Math.floor(priority / 10) * 10; // Group by 10s
      
      if (!groups.has(priorityBucket)) {
        groups.set(priorityBucket, []);
      }
      groups.get(priorityBucket)!.push(route);
    }
    
    // Sort groups by priority (highest first)
    return Array.from(groups.entries())
      .sort(([a], [b]) => b - a)
      .map(([_, routes]) => routes);
  }

  private async raceOrderExecution(
    routePromises: Promise<any>[],
    targetQuantity: number
  ): Promise<PromiseSettledResult<any>[]> {
    // Set timeout for the entire group
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Route group execution timeout')), 30000); // 30s timeout
    });
    
    try {
      // Race all routes with timeout
      const racePromise = Promise.allSettled(routePromises);
      const results = await Promise.race([racePromise, timeoutPromise]);
      
      return results;
    } catch (error) {
      this.logger.warn('Route group execution timed out', { error });
      // Return partial results if available
      return await Promise.allSettled(routePromises);
    }
  }

  private async executeRouteWithRetry(
    route: ExecutionRoute, 
    order: Order, 
    quantity: number,
    maxRetries: number = 3
  ): Promise<any> {
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Create route-specific order
        const routeOrder = {
          ...order,
          quantity,
          exchange: route.exchange
        };
        
        const fill = await this.executeRoute(route, routeOrder);
        
        this.logger.debug(`Route executed successfully`, {
          orderId: order.id,
          exchange: route.exchange,
          quantity,
          attempt,
          fillId: fill.id
        });
        
        return fill;
      } catch (error) {
        lastError = error as Error;
        
        this.logger.warn(`Route execution failed (attempt ${attempt}/${maxRetries})`, {
          orderId: order.id,
          exchange: route.exchange,
          quantity,
          attempt,
          error: error.message
        });
        
        // Exponential backoff for retries
        if (attempt < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Max 5s delay
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    // All retries failed
    throw new Error(`Route execution failed after ${maxRetries} attempts: ${lastError?.message}`);
  }

  private aggregateExecutionResults(
    results: PromiseSettledResult<any>[], 
    order: Order
  ): any[] {
    const successfulFills: any[] = [];
    const failedRoutes: string[] = [];
    
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        successfulFills.push(result.value);
      } else if (result.status === 'rejected') {
        failedRoutes.push(result.reason?.message || 'Unknown error');
      }
    }
    
    // Log aggregation summary
    this.logger.info(`Execution results aggregated`, {
      orderId: order.id,
      successfulFills: successfulFills.length,
      failedRoutes: failedRoutes.length,
      totalQuantityFilled: successfulFills.reduce((sum, fill) => sum + fill.quantity, 0)
    });
    
    // Record failed routes for telemetry
    if (failedRoutes.length > 0) {
      this.telemetry.recordRouteFailed(order.id, failedRoutes);
    }
    
    return successfulFills;
  }

  private handleExecutionComplete(result: ExecutionResult): void {
    // Update analytics
    this.analytics.totalOrders++;
    this.analytics.totalVolume += result.totalQuantity * result.averagePrice;
    
    // Update running averages
    const alpha = 0.1;
    this.analytics.averageSlippage = 
      alpha * result.slippage + (1 - alpha) * this.analytics.averageSlippage;
    this.analytics.averageExecutionTime = 
      alpha * result.executionTime + (1 - alpha) * this.analytics.averageExecutionTime;
    
    if (result.status === ExecutionStatus.COMPLETED) {
      this.analytics.fillRate = 
        alpha * 1 + (1 - alpha) * this.analytics.fillRate;
    } else if (result.status === ExecutionStatus.FAILED) {
      this.analytics.failureRate = 
        alpha * 1 + (1 - alpha) * this.analytics.failureRate;
    }
    
    // Update cost analysis
    this.analytics.costAnalysis.totalFees += result.totalFees;
    this.analytics.costAnalysis.totalSlippage += result.slippage * result.totalQuantity * result.averagePrice;
    
    // Emit event
    this.emit('executionComplete', result);
  }

  private updateAnalytics(type: string, data: any): void {
    // Update relevant analytics based on event type
    switch (type) {
      case 'routing':
        if (data.decision) {
          const saved = data.decision.totalCost * 0.1; // Mock savings
          this.analytics.costAnalysis.savedFromOptimization += saved;
        }
        break;
    }
  }

  private updateAlgorithmMetrics(type: AlgorithmType, metrics: any): void {
    if (!this.analytics.algorithmPerformance[type]) {
      this.analytics.algorithmPerformance[type] = {
        ordersExecuted: 0,
        volumeExecuted: 0,
        averagePerformance: 0,
        benchmarkTracking: 0,
        successRate: 0
      };
    }
    
    const perf = this.analytics.algorithmPerformance[type];
    perf.ordersExecuted++;
    
    // Update other metrics as needed
  }

  private startTelemetryCollection(): void {
    this.telemetryInterval = setInterval(() => {
      this.collectAndSendTelemetry();
    }, 60000); // Every minute
  }

  private collectAndSendTelemetry(): void {
    const telemetry = {
      timestamp: Date.now(),
      analytics: this.analytics,
      mevMetrics: this.mevProtection.getMetrics(),
      activeOrders: this.state.activeOrders.size,
      exchanges: Array.from(this.state.exchanges.keys()),
      marketCondition: this.state.marketCondition
    };
    
    // Send to telemetry endpoint
    if (this.config.telemetry.endpoint !== 'console') {
      // Would send to actual endpoint
      this.logger.debug('Telemetry collected', telemetry);
    } else {
      console.log('Telemetry:', JSON.stringify(telemetry, null, 2));
    }
  }

  private getActiveSymbols(): string[] {
    // Get unique symbols from all configured pairs
    const symbols = new Set<string>();
    
    for (const exchange of this.config.exchanges) {
      if (exchange.enabled) {
        exchange.preferences.allowedPairs.forEach(pair => symbols.add(pair));
      }
    }
    
    return Array.from(symbols);
  }

  /**
   * Get active orders
   */
  getActiveOrders(): Map<string, Order> {
    return new Map(this.state.activeOrders);
  }

  /**
   * Cancel an active order
   */
  async cancelOrder(orderId: string): Promise<boolean> {
    const order = this.state.activeOrders.get(orderId);
    if (!order) {
      return false;
    }
    
    // Check if using algorithm
    if (order.metadata?.algorithm) {
      const algorithmType = order.metadata.algorithm as AlgorithmType;
      const algorithm = this.algorithms.get(algorithmType);
      
      if (algorithm && algorithm.cancelExecution) {
        return algorithm.cancelExecution(orderId);
      }
    }
    
    // Direct cancellation
    this.state.activeOrders.delete(orderId);
    
    this.emit('orderCancelled', { orderId, timestamp: Date.now() });
    return true;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ExecutionOptimizerConfig>): void {
    this.config = { ...this.config, ...config };
    
    // Update component configs
    if (config.routing) {
      // Would update router config
    }
    
    if (config.mevProtection) {
      // Would update MEV config
    }
    
    this.logger.info('Configuration updated');
  }

  // Safety integration methods

  private setupSafetyListeners(): void {
    // Listen for trading mode changes
    this.safetyController.on('mode-changed', (event: any) => {
      this.logger.warn('Trading mode changed', event);
      
      // Record trading mode change
      this.telemetry.recordTradingModeChange(event.oldMode, event.newMode, event.operator);
      this.telemetry.updateTradingMode(event.newMode);
      
      // If changed to PAUSED, cancel all active orders
      if (event.newMode === 'PAUSED') {
        this.cancelAllActiveOrders('Trading mode paused');
      }
      
      // Emit event for other components
      this.emit('tradingModeChanged', event);
    });
    
    // Listen for emergency stops
    this.safetyController.on('emergency-stop', async (event: any) => {
      this.logger.error('Emergency stop triggered', event);
      
      try {
        const activeOrderCount = this.state.activeOrders.size;
        await this.emergencyStopAllOrders(event.reason);
        
        // Record emergency stop telemetry
        this.telemetry.recordEmergencyStop(activeOrderCount, event.reason);
        
        this.emit('emergencyStop', event);
      } catch (error) {
        this.logger.error('Failed to process emergency stop', error);
      }
    });
  }
  
  private async cancelAllActiveOrders(reason: string): Promise<void> {
    const activeOrders = Array.from(this.state.activeOrders.values());
    this.logger.warn(`Cancelling ${activeOrders.length} active orders: ${reason}`);
    
    for (const order of activeOrders) {
      try {
        await this.cancelOrder(order.id);
        // Record cancellation telemetry
        this.telemetry.recordOrderCancelled(order.id, reason, order);
      } catch (error) {
        this.logger.error(`Failed to cancel order ${order.id}`, error);
      }
    }
  }
  
  private async emergencyStopAllOrders(reason: string): Promise<void> {
    this.logger.error(`Emergency stop: ${reason}`);
    
    // Cancel all active orders immediately
    await this.cancelAllActiveOrders(`Emergency stop: ${reason}`);
    
    // Notify all algorithms to stop
    for (const [type, algorithm] of this.algorithms) {
      if (algorithm.emergencyStop) {
        try {
          await algorithm.emergencyStop();
        } catch (error) {
          this.logger.error(`Failed to emergency stop algorithm ${type}`, error);
        }
      }
    }
    
    // Update state
    this.state.marketCondition = MarketCondition.EXTREME;
  }
} 