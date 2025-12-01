import {
  Portfolio,
  RiskEngineConfig,
  RiskReport,
  RiskMetrics,
  VaRResult,
  CVaRResult,
  SizingResult,
  StressTestResult,
  MarginStatus,
  CircuitBreakerStatus,
  RiskAlert,
  RiskRecommendation,
  Position,
  PositionLimits,
  RiskEngineError,
  RiskErrorCode,
  RiskTelemetry
} from '../types';
import { VaRCalculator } from '../core/VaRCalculator';
import { PositionSizer } from '../core/PositionSizer';
import { StressTester } from '../core/StressTester';
import { LiquidationTrigger } from '../core/LiquidationTrigger';
import { CircuitBreakerService } from '../capital-protection/CircuitBreakerService';
import { Logger } from 'winston';
import EventEmitter from 'events';
import NodeCache from 'node-cache';

export class RiskEngineService extends EventEmitter {
  private logger: Logger;
  private config: RiskEngineConfig;
  private varCalculator: VaRCalculator;
  private positionSizer: PositionSizer;
  private stressTester: StressTester;
  private liquidationTrigger: LiquidationTrigger;
  private circuitBreaker: CircuitBreakerService;
  private cache: NodeCache;
  private telemetry: RiskTelemetry;
  private isRunning: boolean = false;
  private monitoringInterval?: NodeJS.Timeout;

  constructor(config: RiskEngineConfig, logger: Logger) {
    super();
    this.config = config;
    this.logger = logger;
    
    // Initialize components
    this.varCalculator = new VaRCalculator(logger);
    this.positionSizer = new PositionSizer(logger);
    this.stressTester = new StressTester(logger);
    this.liquidationTrigger = new LiquidationTrigger(logger);
    this.circuitBreaker = new CircuitBreakerService(logger);
    
    // Initialize cache with TTL
    this.cache = new NodeCache({ 
      stdTTL: 300, // 5 minutes default
      checkperiod: 60 
    });
    
    // Initialize telemetry
    this.telemetry = this.initializeTelemetry();
    
    // Setup event listeners
    this.setupEventListeners();
  }

  /**
   * Start the risk engine
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Risk engine already running');
      return;
    }
    
    this.logger.info('Starting risk engine');
    this.isRunning = true;
    
    // Start monitoring
    this.startMonitoring();
    
    // Emit start event
    this.emit('started', {
      timestamp: Date.now(),
      config: this.config
    });
  }

  /**
   * Stop the risk engine
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      this.logger.warn('Risk engine not running');
      return;
    }
    
    this.logger.info('Stopping risk engine');
    this.isRunning = false;
    
    // Stop monitoring
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }
    
    // Emit stop event
    this.emit('stopped', {
      timestamp: Date.now()
    });
  }

  /**
   * Generate comprehensive risk report
   */
  async generateRiskReport(portfolio: Portfolio): Promise<RiskReport> {
    const startTime = Date.now();
    
    try {
      // Check circuit breaker first
      const circuitBreakerStatus = await this.circuitBreaker.checkCircuitBreaker(
        portfolio,
        this.config.capitalProtection.circuitBreaker
      );
      
      if (circuitBreakerStatus.isActive) {
        this.logger.warn('Circuit breaker active - limited risk calculations');
      }
      
      // Calculate all risk metrics in parallel
      const [
        varResult,
        cvarResult,
        stressTestResults,
        marginStatus,
        alerts,
        recommendations
      ] = await Promise.all([
        this.calculateVaR(portfolio),
        this.calculateCVaR(portfolio),
        this.runStressTests(portfolio),
        this.checkMarginStatus(portfolio),
        this.generateAlerts(portfolio),
        this.generateRecommendations(portfolio)
      ]);
      
      // Calculate additional metrics
      const metrics = await this.calculateRiskMetrics(
        portfolio,
        varResult,
        cvarResult
      );
      
      const report: RiskReport = {
        timestamp: Date.now(),
        portfolio,
        metrics,
        stressTests: stressTestResults,
        marginStatus,
        circuitBreakerStatus,
        alerts,
        recommendations,
        nextReviewTime: Date.now() + this.config.reporting.frequency
      };
      
      // Update telemetry
      this.updateTelemetry('reportGeneration', Date.now() - startTime);
      
      // Cache report
      this.cache.set(`report-${portfolio.id}`, report);
      
      // Emit report generated event
      this.emit('reportGenerated', report);
      
      return report;
      
    } catch (error) {
      this.logger.error('Failed to generate risk report', error);
      this.telemetry.errors.push({
        code: 'REPORT_GENERATION_FAILED',
        message: error.message,
        severity: 'high',
        timestamp: Date.now(),
        context: { portfolioId: portfolio.id },
        stackTrace: error.stack
      });
      throw error;
    }
  }

  /**
   * Calculate position size for a new trade
   */
  async calculatePositionSize(
    signal: any, // TradingSignal interface from PositionSizer
    portfolio: Portfolio
  ): Promise<SizingResult> {
    // Check if trading is allowed
    if (!this.circuitBreaker.isTradingAllowed()) {
      throw new RiskEngineError(
        RiskErrorCode.CIRCUIT_BREAKER_TRIGGERED,
        'Trading halted by circuit breaker'
      );
    }
    
    // Check margin availability
    const marginStatus = await this.checkMarginStatus(portfolio);
    if (marginStatus.status === 'liquidation' || marginStatus.status === 'marginCall') {
      throw new RiskEngineError(
        RiskErrorCode.MARGIN_INSUFFICIENT,
        'Insufficient margin for new positions'
      );
    }
    
    // Define position limits based on current portfolio state
    const limits: PositionLimits = {
      maxPositionSize: this.calculateMaxPositionSize(portfolio),
      maxPortfolioExposure: 0.95, // 95% max exposure
      maxSectorExposure: 0.40, // 40% max per sector
      maxCorrelatedExposure: 0.60, // 60% max correlated exposure
      minDiversification: 3 // Minimum 3 positions for diversification
    };
    
    // Calculate position size
    const sizingResult = await this.positionSizer.calculatePositionSize(
      signal,
      portfolio,
      this.config.positionSizing,
      limits
    );
    
    // Validate against risk limits
    await this.validatePositionSize(sizingResult, portfolio);
    
    return sizingResult;
  }

  /**
   * Execute emergency exit
   */
  async executeEmergencyExit(
    portfolio: Portfolio,
    reason: string
  ): Promise<void> {
    this.logger.error('Executing emergency exit', { reason });
    
    // Activate circuit breaker
    await this.circuitBreaker.activate(reason);
    
    // Trigger liquidation of all positions
    const liquidationResult = await this.liquidationTrigger.executeLiquidation(
      portfolio,
      {
        ...this.config.liquidation,
        deleveragingStrategy: 'optimal',
        gracePeriod: 0 // No grace period for emergency
      }
    );
    
    // Emit emergency exit event
    this.emit('emergencyExit', {
      reason,
      portfolio,
      liquidationResult,
      timestamp: Date.now()
    });
  }

  // Private methods

  private async calculateVaR(portfolio: Portfolio): Promise<VaRResult> {
    const cacheKey = `var-${portfolio.id}`;
    const cached = this.cache.get<VaRResult>(cacheKey);
    
    if (cached) {
      return cached;
    }
    
    const result = await this.varCalculator.calculateVaR(
      portfolio,
      this.config.var
    );
    
    this.cache.set(cacheKey, result, 60); // Cache for 1 minute
    return result;
  }

  private async calculateCVaR(portfolio: Portfolio): Promise<CVaRResult> {
    return await this.varCalculator.calculateCVaR(
      portfolio,
      this.config.var
    );
  }

  private async runStressTests(portfolio: Portfolio): Promise<StressTestResult[]> {
    const results: StressTestResult[] = [];
    
    // Run historical scenarios
    for (const event of this.config.stressTesting.historicalEvents) {
      const result = await this.stressTester.runHistoricalScenario(
        portfolio,
        event
      );
      results.push(result);
    }
    
    // Run custom scenarios
    for (const scenario of this.config.stressTesting.scenarios) {
      const result = await this.stressTester.runCustomScenario(
        portfolio,
        scenario
      );
      results.push(result);
    }
    
    // Run Monte Carlo if configured
    if (this.config.stressTesting.monteCarloConfig.iterations > 0) {
      const monteCarloResults = await this.stressTester.runMonteCarloStress(
        portfolio,
        this.config.stressTesting.monteCarloConfig
      );
      results.push(...monteCarloResults);
    }
    
    return results;
  }

  private async checkMarginStatus(portfolio: Portfolio): Promise<MarginStatus> {
    return await this.liquidationTrigger.monitorMarginLevels(
      portfolio,
      this.config.liquidation
    );
  }

  private async generateAlerts(portfolio: Portfolio): Promise<RiskAlert[]> {
    const alerts: RiskAlert[] = [];
    
    // VaR breach alert
    const var95 = await this.calculateVaR(portfolio);
    if (var95.percentage > 0.05) { // 5% daily VaR threshold
      alerts.push({
        id: `var-breach-${Date.now()}`,
        severity: 'warning',
        type: 'var',
        message: `95% VaR exceeds threshold: ${(var95.percentage * 100).toFixed(2)}%`,
        metric: 'var-95',
        currentValue: var95.percentage,
        threshold: 0.05,
        timestamp: Date.now(),
        acknowledged: false
      });
    }
    
    // Circuit breaker alert
    const cbAlert = this.circuitBreaker.generateAlert();
    if (cbAlert) {
      alerts.push(cbAlert);
    }
    
    // Margin alerts
    const marginStatus = await this.checkMarginStatus(portfolio);
    if (marginStatus.status !== 'safe') {
      alerts.push({
        id: `margin-${marginStatus.status}-${Date.now()}`,
        severity: marginStatus.status === 'liquidation' ? 'critical' : 'warning',
        type: 'margin',
        message: `Margin ${marginStatus.status}: ${marginStatus.marginLevel.toFixed(2)}%`,
        metric: 'margin-level',
        currentValue: marginStatus.marginLevel,
        threshold: this.config.liquidation.marginCallThreshold * 100,
        timestamp: Date.now(),
        acknowledged: false
      });
    }
    
    return alerts;
  }

  private async generateRecommendations(
    portfolio: Portfolio
  ): Promise<RiskRecommendation[]> {
    const recommendations: RiskRecommendation[] = [];
    
    // Analyze portfolio composition
    const concentrationRisk = this.analyzeConcentrationRisk(portfolio);
    if (concentrationRisk.isConcentrated) {
      recommendations.push({
        action: 'Diversify portfolio',
        reason: `${concentrationRisk.dominantAsset} represents ${(concentrationRisk.concentration * 100).toFixed(1)}% of portfolio`,
        impact: 'Reduce concentration risk and potential drawdowns',
        urgency: 'medium',
        positions: [concentrationRisk.dominantAsset]
      });
    }
    
    // Analyze leverage
    if (portfolio.leverage > 2) {
      recommendations.push({
        action: 'Reduce leverage',
        reason: `Current leverage ${portfolio.leverage.toFixed(1)}x exceeds safe levels`,
        impact: 'Lower liquidation risk and improve margin safety',
        urgency: portfolio.leverage > 3 ? 'high' : 'medium'
      });
    }
    
    // Analyze recent performance
    const recentDrawdown = await this.calculateRecentDrawdown(portfolio);
    if (recentDrawdown > 0.15) { // 15% drawdown
      recommendations.push({
        action: 'Review strategy and reduce position sizes',
        reason: `Portfolio experiencing ${(recentDrawdown * 100).toFixed(1)}% drawdown`,
        impact: 'Preserve capital and allow recovery',
        urgency: 'high'
      });
    }
    
    return recommendations;
  }

  private async calculateRiskMetrics(
    portfolio: Portfolio,
    varResult: VaRResult,
    cvarResult: CVaRResult
  ): Promise<RiskMetrics> {
    // Calculate various risk ratios
    const returns = await this.getPortfolioReturns(portfolio, 252);
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const stdDev = this.calculateStandardDeviation(returns);
    
    const riskFreeRate = 0.02 / 252; // 2% annual risk-free rate
    const excessReturns = returns.map(r => r - riskFreeRate);
    const downsideReturns = returns.filter(r => r < 0);
    const downsideDeviation = this.calculateStandardDeviation(downsideReturns);
    
    return {
      portfolio,
      var: varResult,
      cvar: cvarResult,
      sharpeRatio: (avgReturn - riskFreeRate) / stdDev * Math.sqrt(252),
      sortinoRatio: (avgReturn - riskFreeRate) / downsideDeviation * Math.sqrt(252),
      calmarRatio: avgReturn * 252 / await this.calculateMaxDrawdown(portfolio),
      maxDrawdown: await this.calculateMaxDrawdown(portfolio),
      currentDrawdown: await this.calculateCurrentDrawdown(portfolio),
      beta: 1.0, // Mock - would calculate vs market
      alpha: 0.02, // Mock - would calculate vs market
      correlation: 0.7, // Mock - correlation with market
      informationRatio: 0.5, // Mock
      treynorRatio: (avgReturn - riskFreeRate) / 1.0 * 252, // Using beta = 1.0
      downsideDeviation,
      uptime: Date.now() - this.telemetry.performance.uptime,
      lastUpdate: Date.now()
    };
  }

  private setupEventListeners(): void {
    // Circuit breaker events
    this.circuitBreaker.on('circuitBreakerActivated', (data) => {
      this.emit('alert', {
        type: 'circuitBreaker',
        severity: 'critical',
        data
      });
      this.telemetry.circuitBreakerActivations++;
    });
    
    // Liquidation events
    this.liquidationTrigger.on('marginCall', (data) => {
      this.emit('alert', {
        type: 'marginCall',
        severity: 'warning',
        data
      });
      this.telemetry.marginCallsIssued++;
    });
    
    this.liquidationTrigger.on('liquidationComplete', (data) => {
      this.emit('alert', {
        type: 'liquidation',
        severity: 'critical',
        data
      });
      this.telemetry.liquidationsExecuted++;
    });
  }

  private startMonitoring(): void {
    this.monitoringInterval = setInterval(async () => {
      try {
        // Reset daily counters
        await this.circuitBreaker.resetDailyCounters();
        
        // Clean up cache
        this.cache.flushAll();
        
        // Update telemetry
        this.telemetry.performance.uptime = Date.now();
        
      } catch (error) {
        this.logger.error('Monitoring error', error);
      }
    }, this.config.reporting.frequency);
  }

  private initializeTelemetry(): RiskTelemetry {
    return {
      calculationTime: {},
      alertsTriggered: 0,
      marginCallsIssued: 0,
      liquidationsExecuted: 0,
      circuitBreakerActivations: 0,
      stressTestsRun: 0,
      errors: [],
      performance: {
        avgCalculationTime: 0,
        peakMemoryUsage: 0,
        cpuUsage: 0,
        apiCalls: 0,
        cacheHitRate: 0,
        uptime: Date.now()
      }
    };
  }

  private updateTelemetry(operation: string, duration: number): void {
    this.telemetry.calculationTime[operation] = duration;
    
    // Update average calculation time
    const times = Object.values(this.telemetry.calculationTime);
    this.telemetry.performance.avgCalculationTime = 
      times.reduce((a, b) => a + b, 0) / times.length;
  }

  private calculateMaxPositionSize(portfolio: Portfolio): number {
    // Base on available margin and risk tolerance
    const availableCapital = portfolio.marginAvailable;
    const riskTolerance = 0.02; // 2% max risk per position
    
    return Math.min(
      availableCapital * 0.3, // Max 30% of available margin
      portfolio.totalValue * riskTolerance
    ) / portfolio.totalValue; // Return as percentage
  }

  private async validatePositionSize(
    sizingResult: SizingResult,
    portfolio: Portfolio
  ): Promise<void> {
    // Check against absolute limits
    if (sizingResult.adjustedSize > 0.25) {
      throw new RiskEngineError(
        RiskErrorCode.LIMIT_EXCEEDED,
        'Position size exceeds maximum allowed (25%)'
      );
    }
    
    // Check portfolio VaR impact
    const currentVaR = await this.calculateVaR(portfolio);
    const projectedVaR = currentVaR.percentage * (1 + sizingResult.adjustedSize);
    
    if (projectedVaR > 0.10) { // 10% VaR limit
      throw new RiskEngineError(
        RiskErrorCode.LIMIT_EXCEEDED,
        'Position would exceed portfolio VaR limit'
      );
    }
  }

  private analyzeConcentrationRisk(portfolio: Portfolio): {
    isConcentrated: boolean;
    dominantAsset: string;
    concentration: number;
  } {
    const positions = portfolio.positions;
    if (positions.length === 0) {
      return { isConcentrated: false, dominantAsset: '', concentration: 0 };
    }
    
    const weights = positions.map(p => 
      (p.size * p.currentPrice) / portfolio.totalValue
    );
    
    const maxWeight = Math.max(...weights);
    const dominantIndex = weights.indexOf(maxWeight);
    
    return {
      isConcentrated: maxWeight > 0.30, // 30% concentration threshold
      dominantAsset: positions[dominantIndex].symbol,
      concentration: maxWeight
    };
  }

  private async getPortfolioReturns(
    portfolio: Portfolio,
    days: number
  ): Promise<number[]> {
    // In production, fetch from historical data
    // Mock implementation
    const returns: number[] = [];
    for (let i = 0; i < days; i++) {
      returns.push((Math.random() - 0.5) * 0.04); // ±2% daily returns
    }
    return returns;
  }

  private calculateStandardDeviation(values: number[]): number {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
    return Math.sqrt(variance);
  }

  private async calculateMaxDrawdown(portfolio: Portfolio): Promise<number> {
    // In production, calculate from historical peak
    // Mock implementation
    return 0.15; // 15% max drawdown
  }

  private async calculateCurrentDrawdown(portfolio: Portfolio): Promise<number> {
    // In production, calculate from recent peak
    // Mock implementation
    return 0.08; // 8% current drawdown
  }

  private async calculateRecentDrawdown(portfolio: Portfolio): Promise<number> {
    return await this.calculateCurrentDrawdown(portfolio);
  }

  /**
   * Get telemetry data
   */
  getTelemetry(): RiskTelemetry {
    return { ...this.telemetry };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<RiskEngineConfig>): void {
    this.config = { ...this.config, ...config };
    this.logger.info('Risk engine configuration updated');
  }
} 