import {
  Portfolio,
  Position,
  PriceData,
  TradingSignal,
  Asset,
  RiskAssessment,
  PositionSize,
  RiskReport,
  RiskAlert,
  RiskMetrics,
  VaRCalculatorConfig,
  PositionSizerConfig,
  LiquidationConfig,
  TelemetryClient,
  CorrelationMatrix
} from './types';
import { VaRCalculator } from './VaRCalculator';
import { PositionSizer } from './PositionSizer';
import { StressTester } from './StressTester';
import { LiquidationTrigger } from './LiquidationTrigger';
import { EventEmitter } from 'events';

/**
 * Main Risk Engine Service
 * Orchestrates all risk management components for institutional-grade risk control
 */
export class RiskEngineService extends EventEmitter {
  private varCalculator: VaRCalculator;
  private positionSizer: PositionSizer;
  private stressTester: StressTester;
  private liquidationTrigger: LiquidationTrigger;
  private telemetry?: TelemetryClient;
  
  // Risk monitoring state
  private activeAlerts: Map<string, RiskAlert> = new Map();
  private portfolioMetrics: Map<string, RiskMetrics> = new Map();
  private lastRiskReport?: RiskReport;
  
  // Configuration
  private config: {
    varConfig: VaRCalculatorConfig;
    positionSizerConfig: PositionSizerConfig;
    liquidationConfig: LiquidationConfig;
    alertThresholds: {
      varBreachThreshold: number;
      drawdownThreshold: number;
      correlationSpikeThreshold: number;
      liquidityThreshold: number;
    };
  };

  constructor(config: {
    varConfig: VaRCalculatorConfig;
    positionSizerConfig: PositionSizerConfig;
    liquidationConfig: LiquidationConfig;
    alertThresholds?: any;
  }, telemetry?: TelemetryClient) {
    super();
    
    this.config = {
      ...config,
      alertThresholds: config.alertThresholds || {
        varBreachThreshold: 0.95,
        drawdownThreshold: 0.20,
        correlationSpikeThreshold: 0.8,
        liquidityThreshold: 0.3
      }
    };
    
    this.telemetry = telemetry;
    
    // Initialize components
    this.varCalculator = new VaRCalculator(config.varConfig, telemetry);
    this.positionSizer = new PositionSizer(config.positionSizerConfig, telemetry);
    this.stressTester = new StressTester(telemetry);
    this.liquidationTrigger = new LiquidationTrigger(config.liquidationConfig, telemetry);
    
    // Set up event listeners
    this.setupEventListeners();
  }

  /**
   * Evaluate comprehensive portfolio risk
   */
  async evaluatePortfolioRisk(
    portfolio: Portfolio,
    priceData: Map<string, PriceData[]>
  ): Promise<RiskAssessment> {
    const startTime = Date.now();

    try {
      // Calculate VaR
      const varResult = await this.varCalculator.calculate(portfolio, priceData);
      
      // Run stress tests
      const stressTests = await this.runStandardStressTests(portfolio);
      
      // Check margin status
      const marginStatus = await this.liquidationTrigger.monitorMarginLevels(portfolio);
      
      // Calculate risk metrics
      const metrics = await this.calculateRiskMetrics(portfolio, priceData);
      this.portfolioMetrics.set(portfolio.id, metrics);
      
      // Generate warnings and recommendations
      const warnings = this.generateRiskWarnings(portfolio, varResult, metrics, marginStatus);
      const recommendations = this.generateRiskRecommendations(portfolio, varResult, metrics);
      
      // Calculate overall risk score (0-100)
      const riskScore = this.calculateRiskScore(varResult, stressTests, marginStatus, metrics);
      
      const assessment: RiskAssessment = {
        portfolio,
        var: varResult,
        stressTests,
        marginStatus,
        riskScore,
        warnings,
        recommendations,
        timestamp: new Date()
      };
      
      // Check for alerts
      await this.checkRiskAlerts(assessment);
      
      // Emit telemetry
      if (this.telemetry) {
        this.telemetry.track({
          eventType: 'risk_assessment',
          data: {
            portfolioId: portfolio.id,
            riskScore,
            varValue: varResult.value,
            marginLevel: marginStatus.marginLevel,
            warningCount: warnings.length
          },
          duration: Date.now() - startTime,
          timestamp: new Date()
        });
      }

      this.emit('riskAssessmentCompleted', assessment);
      return assessment;

    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Calculate optimal position size for a trading signal
   */
  async calculateOptimalPosition(
    signal: TradingSignal,
    portfolio: Portfolio,
    asset: Asset,
    priceData?: Map<string, PriceData[]>
  ): Promise<PositionSize> {
    try {
      // Get current risk metrics
      const metrics = this.portfolioMetrics.get(portfolio.id);
      
      // Calculate correlation matrix if price data provided
      let correlationMatrix: CorrelationMatrix | undefined;
      if (priceData) {
        correlationMatrix = await this.calculateCorrelationMatrix(portfolio, priceData);
      }
      
      // Prepare market data
      const marketData = {
        correlationMatrix,
        maxLeverage: 3, // Default max leverage
        maxConcentration: 0.25,
        minPositionSize: 100,
        maxAcceptableDrawdown: 0.20
      };
      
      // Calculate position size
      const positionSize = await this.positionSizer.calculatePositionSize(
        signal,
        portfolio,
        asset,
        marketData
      );
      
      // Validate against risk limits
      const validatedSize = await this.validatePositionSize(positionSize, portfolio, metrics);
      
      return validatedSize;

    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Generate daily risk report
   */
  async runDailyRiskReport(
    portfolio: Portfolio,
    priceData: Map<string, PriceData[]>
  ): Promise<RiskReport> {
    const startTime = Date.now();

    try {
      // Run comprehensive risk assessment
      const assessment = await this.evaluatePortfolioRisk(portfolio, priceData);
      
      // Calculate detailed metrics
      const metrics = await this.calculateDetailedRiskMetrics(portfolio, priceData);
      
      // Run all stress test scenarios
      const allStressTests = await this.runAllStressTests(portfolio);
      
      // Analyze positions
      const positionAnalysis = await this.analyzePositions(portfolio, priceData);
      
      // Calculate correlation matrix
      const correlationAnalysis = await this.calculateCorrelationMatrix(portfolio, priceData);
      
      // Analyze liquidity
      const liquidityAnalysis = await this.analyzeLiquidity(portfolio);
      
      const report: RiskReport = {
        date: new Date(),
        portfolio,
        metrics,
        varAnalysis: assessment.var,
        stressTestResults: allStressTests,
        positionAnalysis,
        correlationAnalysis,
        liquidityAnalysis
      };
      
      this.lastRiskReport = report;
      
      // Export to monitoring systems
      await this.exportToGrafana(metrics);
      
      // Emit telemetry
      if (this.telemetry) {
        this.telemetry.track({
          eventType: 'risk_report',
          data: {
            portfolioId: portfolio.id,
            metricsCount: Object.keys(metrics).length,
            stressTestCount: allStressTests.length,
            positionCount: positionAnalysis.length
          },
          duration: Date.now() - startTime,
          timestamp: new Date()
        });
      }

      this.emit('dailyRiskReportGenerated', report);
      return report;

    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Monitor real-time risk and generate alerts
   */
  async *monitorRealTimeRisk(
    portfolio: Portfolio,
    priceDataStream: AsyncIterator<Map<string, PriceData[]>>
  ): AsyncIterator<RiskAlert> {
    try {
      for await (const priceData of priceDataStream) {
        // Quick risk check
        const quickAssessment = await this.performQuickRiskCheck(portfolio, priceData);
        
        // Check for alerts
        const alerts = await this.detectRiskAlerts(portfolio, quickAssessment, priceData);
        
        // Yield alerts
        for (const alert of alerts) {
          this.activeAlerts.set(alert.id, alert);
          yield alert;
        }
        
        // Clean up old alerts
        this.cleanupOldAlerts();
      }
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Export metrics to Grafana
   */
  async exportToGrafana(metrics: RiskMetrics): Promise<void> {
    // In production, this would send metrics to Grafana/Prometheus
    // For now, we'll emit an event
    this.emit('metricsExported', {
      metrics,
      timestamp: new Date()
    });
  }

  /**
   * Private helper methods
   */
  
  private setupEventListeners(): void {
    // Listen to component events
    this.varCalculator.on('error', (error) => this.emit('error', error));
    this.positionSizer.on('error', (error) => this.emit('error', error));
    this.stressTester.on('error', (error) => this.emit('error', error));
    this.liquidationTrigger.on('error', (error) => this.emit('error', error));
    
    // Forward important events
    this.liquidationTrigger.on('marginCallTriggered', (data) => 
      this.emit('marginCallTriggered', data)
    );
    this.liquidationTrigger.on('liquidationTriggered', (data) => 
      this.emit('liquidationTriggered', data)
    );
  }

  private async runStandardStressTests(portfolio: Portfolio) {
    const scenarios = ['2008Crisis', 'CovidCrash', 'CryptoWinter'];
    const results = [];
    
    for (const scenario of scenarios) {
      const historicalEvent = this.stressTester['historicalScenarios'].get(scenario);
      if (historicalEvent) {
        const result = await this.stressTester.runHistoricalScenario(portfolio, historicalEvent);
        results.push(result);
      }
    }
    
    return results;
  }

  private async runAllStressTests(portfolio: Portfolio) {
    // Run historical scenarios
    const historicalResults = await this.runStandardStressTests(portfolio);
    
    // Run worst-case scenarios
    const worstCaseScenarios = await this.stressTester.generateWorstCaseScenarios(portfolio, 3);
    const worstCaseResults = [];
    
    for (const scenario of worstCaseScenarios) {
      const result = await this.stressTester.runCustomScenario(portfolio, scenario);
      worstCaseResults.push(result);
    }
    
    return [...historicalResults, ...worstCaseResults];
  }

  private async calculateRiskMetrics(
    portfolio: Portfolio,
    priceData: Map<string, PriceData[]>
  ): Promise<RiskMetrics> {
    // Calculate returns
    const returns = this.calculatePortfolioReturns(portfolio, priceData);
    
    // Calculate metrics
    const sharpeRatio = this.calculateSharpeRatio(returns);
    const sortinoRatio = this.calculateSortinoRatio(returns);
    const maxDrawdown = this.calculateMaxDrawdown(returns);
    const currentDrawdown = this.calculateCurrentDrawdown(portfolio);
    const beta = await this.calculateBeta(portfolio, priceData);
    const alpha = await this.calculateAlpha(portfolio, priceData, beta);
    
    // Get VaR from calculator
    const varResult = await this.varCalculator.calculate(portfolio, priceData);
    
    return {
      portfolioVar: varResult.value,
      sharpeRatio,
      sortinoRatio,
      maxDrawdown,
      currentDrawdown,
      beta,
      alpha
    };
  }

  private async calculateDetailedRiskMetrics(
    portfolio: Portfolio,
    priceData: Map<string, PriceData[]>
  ): Promise<RiskMetrics> {
    const basicMetrics = await this.calculateRiskMetrics(portfolio, priceData);
    
    // Add additional metrics
    const trackingError = await this.calculateTrackingError(portfolio, priceData);
    const informationRatio = await this.calculateInformationRatio(portfolio, priceData);
    
    return {
      ...basicMetrics,
      trackingError,
      informationRatio
    };
  }

  private calculatePortfolioReturns(
    portfolio: Portfolio,
    priceData: Map<string, PriceData[]>
  ): number[] {
    const returns: number[] = [];
    const minLength = Math.min(...Array.from(priceData.values()).map(p => p.length));
    
    for (let i = 1; i < minLength; i++) {
      let portfolioReturn = 0;
      
      for (const position of portfolio.positions) {
        const prices = priceData.get(position.symbol);
        if (prices && prices[i] && prices[i-1]) {
          const weight = (position.quantity * position.currentPrice) / portfolio.totalValue;
          const dailyReturn = (prices[i].close - prices[i-1].close) / prices[i-1].close;
          portfolioReturn += weight * dailyReturn;
        }
      }
      
      returns.push(portfolioReturn);
    }
    
    return returns;
  }

  private calculateSharpeRatio(returns: number[], riskFreeRate: number = 0.02): number {
    if (returns.length === 0) return 0;
    
    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const annualizedReturn = avgReturn * 252; // Assuming daily returns
    
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const annualizedVol = Math.sqrt(variance * 252);
    
    return annualizedVol > 0 ? (annualizedReturn - riskFreeRate) / annualizedVol : 0;
  }

  private calculateSortinoRatio(returns: number[], riskFreeRate: number = 0.02): number {
    if (returns.length === 0) return 0;
    
    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const annualizedReturn = avgReturn * 252;
    
    // Calculate downside deviation
    const negativeReturns = returns.filter(r => r < 0);
    if (negativeReturns.length === 0) return annualizedReturn - riskFreeRate;
    
    const downsideVariance = negativeReturns.reduce((sum, r) => sum + r * r, 0) / negativeReturns.length;
    const downsideDeviation = Math.sqrt(downsideVariance * 252);
    
    return downsideDeviation > 0 ? (annualizedReturn - riskFreeRate) / downsideDeviation : 0;
  }

  private calculateMaxDrawdown(returns: number[]): number {
    if (returns.length === 0) return 0;
    
    let peak = 1;
    let maxDrawdown = 0;
    let value = 1;
    
    for (const ret of returns) {
      value *= (1 + ret);
      if (value > peak) {
        peak = value;
      }
      const drawdown = (peak - value) / peak;
      maxDrawdown = Math.max(maxDrawdown, drawdown);
    }
    
    return maxDrawdown;
  }

  private calculateCurrentDrawdown(portfolio: Portfolio): number {
    // Simplified calculation - in production would track historical peak
    const totalPnL = portfolio.positions.reduce((sum, pos) => sum + pos.unrealizedPnL, 0);
    const drawdown = totalPnL < 0 ? Math.abs(totalPnL) / portfolio.totalValue : 0;
    return drawdown;
  }

  private async calculateBeta(portfolio: Portfolio, priceData: Map<string, PriceData[]>): Promise<number> {
    // Simplified beta calculation against SPY
    const marketReturns = this.getMarketReturns(priceData);
    const portfolioReturns = this.calculatePortfolioReturns(portfolio, priceData);
    
    if (marketReturns.length === 0 || portfolioReturns.length === 0) return 1;
    
    // Calculate covariance and market variance
    const covariance = this.calculateCovariance(portfolioReturns, marketReturns);
    const marketVariance = this.calculateVariance(marketReturns);
    
    return marketVariance > 0 ? covariance / marketVariance : 1;
  }

  private async calculateAlpha(
    portfolio: Portfolio,
    priceData: Map<string, PriceData[]>,
    beta: number
  ): Promise<number> {
    const portfolioReturns = this.calculatePortfolioReturns(portfolio, priceData);
    const marketReturns = this.getMarketReturns(priceData);
    
    if (portfolioReturns.length === 0 || marketReturns.length === 0) return 0;
    
    const avgPortfolioReturn = portfolioReturns.reduce((sum, r) => sum + r, 0) / portfolioReturns.length;
    const avgMarketReturn = marketReturns.reduce((sum, r) => sum + r, 0) / marketReturns.length;
    
    // CAPM alpha
    const riskFreeRate = 0.02 / 252; // Daily risk-free rate
    const alpha = avgPortfolioReturn - (riskFreeRate + beta * (avgMarketReturn - riskFreeRate));
    
    return alpha * 252; // Annualized
  }

  private getMarketReturns(priceData: Map<string, PriceData[]>): number[] {
    // Use SPY as market proxy
    const spyData = priceData.get('SPY');
    if (!spyData) return [];
    
    const returns: number[] = [];
    for (let i = 1; i < spyData.length; i++) {
      const dailyReturn = (spyData[i].close - spyData[i-1].close) / spyData[i-1].close;
      returns.push(dailyReturn);
    }
    
    return returns;
  }

  private calculateCovariance(returns1: number[], returns2: number[]): number {
    const n = Math.min(returns1.length, returns2.length);
    if (n === 0) return 0;
    
    const mean1 = returns1.reduce((sum, r) => sum + r, 0) / n;
    const mean2 = returns2.reduce((sum, r) => sum + r, 0) / n;
    
    let covariance = 0;
    for (let i = 0; i < n; i++) {
      covariance += (returns1[i] - mean1) * (returns2[i] - mean2);
    }
    
    return covariance / n;
  }

  private calculateVariance(returns: number[]): number {
    if (returns.length === 0) return 0;
    
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    
    return variance;
  }

  private async calculateTrackingError(
    portfolio: Portfolio,
    priceData: Map<string, PriceData[]>
  ): Promise<number> {
    const portfolioReturns = this.calculatePortfolioReturns(portfolio, priceData);
    const benchmarkReturns = this.getMarketReturns(priceData);
    
    if (portfolioReturns.length === 0 || benchmarkReturns.length === 0) return 0;
    
    const trackingDifferences: number[] = [];
    const n = Math.min(portfolioReturns.length, benchmarkReturns.length);
    
    for (let i = 0; i < n; i++) {
      trackingDifferences.push(portfolioReturns[i] - benchmarkReturns[i]);
    }
    
    const variance = this.calculateVariance(trackingDifferences);
    return Math.sqrt(variance * 252); // Annualized
  }

  private async calculateInformationRatio(
    portfolio: Portfolio,
    priceData: Map<string, PriceData[]>
  ): Promise<number> {
    const alpha = await this.calculateAlpha(portfolio, priceData, 1);
    const trackingError = await this.calculateTrackingError(portfolio, priceData);
    
    return trackingError > 0 ? alpha / trackingError : 0;
  }

  private async calculateCorrelationMatrix(
    portfolio: Portfolio,
    priceData: Map<string, PriceData[]>
  ): Promise<CorrelationMatrix> {
    const assets = portfolio.positions.map(p => p.symbol);
    const matrix: number[][] = [];
    
    for (let i = 0; i < assets.length; i++) {
      matrix[i] = [];
      for (let j = 0; j < assets.length; j++) {
        if (i === j) {
          matrix[i][j] = 1;
        } else {
          const returns1 = this.getAssetReturns(assets[i], priceData);
          const returns2 = this.getAssetReturns(assets[j], priceData);
          const correlation = this.calculateCorrelation(returns1, returns2);
          matrix[i][j] = correlation;
        }
      }
    }
    
    return {
      assets,
      matrix,
      period: 252,
      timestamp: new Date()
    };
  }

  private getAssetReturns(symbol: string, priceData: Map<string, PriceData[]>): number[] {
    const prices = priceData.get(symbol);
    if (!prices) return [];
    
    const returns: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      const dailyReturn = (prices[i].close - prices[i-1].close) / prices[i-1].close;
      returns.push(dailyReturn);
    }
    
    return returns;
  }

  private calculateCorrelation(returns1: number[], returns2: number[]): number {
    const covariance = this.calculateCovariance(returns1, returns2);
    const std1 = Math.sqrt(this.calculateVariance(returns1));
    const std2 = Math.sqrt(this.calculateVariance(returns2));
    
    return (std1 > 0 && std2 > 0) ? covariance / (std1 * std2) : 0;
  }

  private async analyzePositions(
    portfolio: Portfolio,
    priceData: Map<string, PriceData[]>
  ) {
    const analysis = [];
    const varResult = await this.varCalculator.calculate(portfolio, priceData);
    
    for (const position of portfolio.positions) {
      const weight = (position.quantity * position.currentPrice) / portfolio.totalValue;
      const varContribution = varResult.componentVaR?.get(position.symbol) || 0;
      const returns = this.getAssetReturns(position.symbol, priceData);
      const sharpe = this.calculateSharpeRatio(returns);
      
      analysis.push({
        position,
        riskContribution: weight * 0.2, // Simplified
        varContribution,
        sharpeContribution: weight * sharpe,
        concentrationRisk: weight
      });
    }
    
    return analysis;
  }

  private async analyzeLiquidity(portfolio: Portfolio) {
    // Simplified liquidity analysis
    const liquidityByAsset = new Map<string, number>();
    const timeToLiquidate = new Map<string, number>();
    
    let totalLiquidity = 0;
    
    for (const position of portfolio.positions) {
      const positionValue = position.quantity * position.currentPrice;
      const liquidity = positionValue * 0.9; // Assume 10% liquidity cost
      
      liquidityByAsset.set(position.symbol, liquidity);
      timeToLiquidate.set(position.symbol, positionValue > 1000000 ? 60 : 5); // minutes
      totalLiquidity += liquidity;
    }
    
    return {
      totalLiquidity,
      liquidityByAsset,
      timeToLiquidate,
      liquidityCost: portfolio.totalValue - totalLiquidity
    };
  }

  private generateRiskWarnings(
    portfolio: Portfolio,
    varResult: any,
    metrics: RiskMetrics,
    marginStatus: any
  ) {
    const warnings = [];
    
    // VaR warning
    if (varResult.value > portfolio.totalValue * 0.05) {
      warnings.push({
        severity: 'high' as const,
        type: 'var_breach',
        message: `VaR (${varResult.value.toFixed(2)}) exceeds 5% of portfolio value`,
        affectedPositions: []
      });
    }
    
    // Drawdown warning
    if (metrics.currentDrawdown > 0.15) {
      warnings.push({
        severity: 'medium' as const,
        type: 'drawdown',
        message: `Current drawdown (${(metrics.currentDrawdown * 100).toFixed(1)}%) is significant`,
        affectedPositions: []
      });
    }
    
    // Margin warning
    if (marginStatus.status === 'warning' || marginStatus.status === 'marginCall') {
      warnings.push({
        severity: marginStatus.status === 'marginCall' ? 'critical' as const : 'high' as const,
        type: 'margin',
        message: `Margin level at ${(marginStatus.marginLevel * 100).toFixed(1)}%`,
        affectedPositions: []
      });
    }
    
    return warnings;
  }

  private generateRiskRecommendations(
    portfolio: Portfolio,
    varResult: any,
    metrics: RiskMetrics
  ) {
    const recommendations = [];
    
    // Diversification recommendation
    if (varResult.componentVaR) {
      const maxContribution = Math.max(...Array.from(varResult.componentVaR.values()));
      if (maxContribution > varResult.value * 0.3) {
        recommendations.push({
          action: 'Diversify portfolio',
          rationale: 'Single position contributes over 30% to portfolio VaR',
          expectedImpact: 'Reduce concentration risk by 20-30%',
          priority: 1
        });
      }
    }
    
    // Risk reduction recommendation
    if (metrics.sharpeRatio < 0.5) {
      recommendations.push({
        action: 'Review strategy performance',
        rationale: 'Sharpe ratio below 0.5 indicates poor risk-adjusted returns',
        expectedImpact: 'Improve risk-adjusted returns',
        priority: 2
      });
    }
    
    return recommendations;
  }

  private calculateRiskScore(
    varResult: any,
    stressTests: any[],
    marginStatus: any,
    metrics: RiskMetrics
  ): number {
    let score = 100;
    
    // VaR impact (0-30 points)
    const varRatio = varResult.value / (varResult.value + 1000000);
    score -= varRatio * 30;
    
    // Stress test impact (0-30 points)
    const worstStressLoss = Math.max(...stressTests.map(t => t.portfolioLoss));
    const stressRatio = worstStressLoss / (worstStressLoss + 1000000);
    score -= stressRatio * 30;
    
    // Margin impact (0-20 points)
    if (marginStatus.status === 'liquidation') score -= 20;
    else if (marginStatus.status === 'marginCall') score -= 15;
    else if (marginStatus.status === 'warning') score -= 10;
    
    // Metrics impact (0-20 points)
    if (metrics.sharpeRatio < 0) score -= 10;
    if (metrics.currentDrawdown > 0.2) score -= 10;
    
    return Math.max(0, Math.min(100, score));
  }

  private async checkRiskAlerts(assessment: RiskAssessment) {
    const alerts: RiskAlert[] = [];
    
    // Check VaR breach
    if (assessment.var.value > assessment.portfolio.totalValue * this.config.alertThresholds.varBreachThreshold) {
      alerts.push({
        id: `var_breach_${Date.now()}`,
        type: 'var_breach',
        severity: 'critical',
        message: 'VaR exceeds acceptable threshold',
        data: { var: assessment.var.value, threshold: this.config.alertThresholds.varBreachThreshold },
        timestamp: new Date()
      });
    }
    
    // Process alerts
    for (const alert of alerts) {
      this.activeAlerts.set(alert.id, alert);
      this.emit('riskAlert', alert);
    }
  }

  private async performQuickRiskCheck(portfolio: Portfolio, priceData: Map<string, PriceData[]>) {
    // Simplified quick check for real-time monitoring
    const marginStatus = await this.liquidationTrigger.monitorMarginLevels(portfolio);
    const metrics = await this.calculateRiskMetrics(portfolio, priceData);
    
    return { marginStatus, metrics };
  }

  private async detectRiskAlerts(
    portfolio: Portfolio,
    quickAssessment: any,
    priceData: Map<string, PriceData[]>
  ): Promise<RiskAlert[]> {
    const alerts: RiskAlert[] = [];
    
    // Margin warning
    if (quickAssessment.marginStatus.status === 'marginCall') {
      alerts.push({
        id: `margin_call_${Date.now()}`,
        type: 'margin_warning',
        severity: 'critical',
        message: 'Margin call triggered',
        data: quickAssessment.marginStatus,
        timestamp: new Date()
      });
    }
    
    return alerts;
  }

  private cleanupOldAlerts() {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    
    for (const [id, alert] of this.activeAlerts) {
      if (now - alert.timestamp.getTime() > maxAge) {
        this.activeAlerts.delete(id);
      }
    }
  }

  private async validatePositionSize(
    positionSize: PositionSize,
    portfolio: Portfolio,
    metrics?: RiskMetrics
  ): Promise<PositionSize> {
    // Additional validation based on current risk metrics
    let adjustedSize = positionSize.recommendedSize;
    
    // Reduce size if portfolio is already risky
    if (metrics && metrics.currentDrawdown > 0.15) {
      adjustedSize *= 0.5; // Halve position size during drawdown
    }
    
    return {
      ...positionSize,
      recommendedSize: adjustedSize
    };
  }

  /**
   * Get current risk status
   */
  getRiskStatus(): {
    activeAlerts: RiskAlert[],
    portfolioMetrics: Map<string, RiskMetrics>,
    lastReport?: RiskReport
  } {
    return {
      activeAlerts: Array.from(this.activeAlerts.values()),
      portfolioMetrics: this.portfolioMetrics,
      lastReport: this.lastRiskReport
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: {
    varConfig?: Partial<VaRCalculatorConfig>,
    positionSizerConfig?: Partial<PositionSizerConfig>,
    liquidationConfig?: Partial<LiquidationConfig>,
    alertThresholds?: any
  }): void {
    if (config.varConfig) {
      this.varCalculator.updateConfig(config.varConfig);
    }
    if (config.positionSizerConfig) {
      this.positionSizer.updateConfig(config.positionSizerConfig);
    }
    if (config.liquidationConfig) {
      this.liquidationTrigger.updateConfig(config.liquidationConfig);
    }
    if (config.alertThresholds) {
      this.config.alertThresholds = { ...this.config.alertThresholds, ...config.alertThresholds };
    }
  }
} 