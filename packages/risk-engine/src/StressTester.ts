import {
  Portfolio,
  Position,
  StressScenario,
  HistoricalEvent,
  StressTestResult,
  MarketConditions,
  RiskTelemetryEvent,
  TelemetryClient
} from './types';
import { EventEmitter } from 'events';

/**
 * Institutional-grade Stress Tester
 * Implements historical scenario analysis, custom stress scenarios, and Monte Carlo stress testing
 */
export class StressTester extends EventEmitter {
  private telemetry?: TelemetryClient;
  private historicalScenarios: Map<string, HistoricalEvent>;
  private customScenarios: Map<string, StressScenario>;
  
  constructor(telemetry?: TelemetryClient) {
    super();
    this.telemetry = telemetry;
    this.historicalScenarios = this.initializeHistoricalScenarios();
    this.customScenarios = new Map();
  }

  /**
   * Run a historical stress test scenario
   */
  async runHistoricalScenario(
    portfolio: Portfolio,
    scenario: HistoricalEvent
  ): Promise<StressTestResult> {
    const startTime = Date.now();

    try {
      // Convert historical event to stress scenario
      const stressScenario = this.convertHistoricalToStressScenario(scenario);
      
      // Run the stress test
      const result = await this.runScenario(portfolio, stressScenario);
      
      // Emit telemetry
      if (this.telemetry) {
        this.telemetry.track({
          eventType: 'stress_test',
          data: {
            scenarioType: 'historical',
            scenarioName: scenario.name,
            portfolioLoss: result.portfolioLoss,
            varBreach: result.varBreach,
            marginCall: result.marginCall,
            liquidation: result.liquidation
          },
          duration: Date.now() - startTime,
          timestamp: new Date()
        });
      }

      this.emit('stressTestCompleted', result);
      return result;

    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Run a custom stress test scenario
   */
  async runCustomScenario(
    portfolio: Portfolio,
    scenario: StressScenario
  ): Promise<StressTestResult> {
    const startTime = Date.now();

    try {
      const result = await this.runScenario(portfolio, scenario);
      
      // Emit telemetry
      if (this.telemetry) {
        this.telemetry.track({
          eventType: 'stress_test',
          data: {
            scenarioType: 'custom',
            scenarioName: scenario.name,
            portfolioLoss: result.portfolioLoss,
            varBreach: result.varBreach,
            marginCall: result.marginCall,
            liquidation: result.liquidation
          },
          duration: Date.now() - startTime,
          timestamp: new Date()
        });
      }

      this.emit('stressTestCompleted', result);
      return result;

    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Run Monte Carlo stress testing
   */
  async runMonteCarloStress(
    portfolio: Portfolio,
    iterations: number = 1000
  ): Promise<StressTestResult[]> {
    const startTime = Date.now();
    const results: StressTestResult[] = [];

    try {
      for (let i = 0; i < iterations; i++) {
        // Generate random stress scenario
        const scenario = this.generateRandomScenario(i);
        
        // Run the scenario
        const result = await this.runScenario(portfolio, scenario);
        results.push(result);
        
        // Emit progress
        if (i % 100 === 0) {
          this.emit('monteCarloProgress', {
            current: i,
            total: iterations,
            percentComplete: (i / iterations) * 100
          });
        }
      }

      // Analyze results
      const analysis = this.analyzeMonteCarloResults(results);
      
      // Emit telemetry
      if (this.telemetry) {
        this.telemetry.track({
          eventType: 'stress_test',
          data: {
            scenarioType: 'monteCarlo',
            iterations,
            avgLoss: analysis.averageLoss,
            maxLoss: analysis.maxLoss,
            varBreachRate: analysis.varBreachRate,
            liquidationRate: analysis.liquidationRate
          },
          duration: Date.now() - startTime,
          timestamp: new Date()
        });
      }

      this.emit('monteCarloCompleted', { results, analysis });
      return results;

    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Generate worst-case scenarios based on portfolio composition
   */
  async generateWorstCaseScenarios(
    portfolio: Portfolio,
    count: number = 5
  ): Promise<StressScenario[]> {
    const scenarios: StressScenario[] = [];
    
    // Analyze portfolio composition
    const composition = this.analyzePortfolioComposition(portfolio);
    
    // Generate scenarios targeting portfolio weaknesses
    for (let i = 0; i < count; i++) {
      const scenario = this.createWorstCaseScenario(composition, i);
      scenarios.push(scenario);
    }
    
    return scenarios;
  }

  /**
   * Calculate maximum potential loss over a time horizon
   */
  async calculateMaximumLoss(
    portfolio: Portfolio,
    timeHorizon: number
  ): Promise<number> {
    // Generate extreme scenarios
    const extremeScenarios = await this.generateExtremeScenarios(portfolio, timeHorizon);
    
    let maxLoss = 0;
    
    for (const scenario of extremeScenarios) {
      const result = await this.runScenario(portfolio, scenario);
      maxLoss = Math.max(maxLoss, result.portfolioLoss);
    }
    
    return maxLoss;
  }

  /**
   * Core stress testing logic
   */
  private async runScenario(
    portfolio: Portfolio,
    scenario: StressScenario
  ): Promise<StressTestResult> {
    let totalLoss = 0;
    const stressedPositions: Position[] = [];
    const worstPositions: Position[] = [];
    
    // Apply shocks to each position
    for (const position of portfolio.positions) {
      const shock = scenario.assetShocks.get(position.symbol) || 0;
      const positionLoss = this.calculatePositionLoss(position, shock, scenario);
      
      if (positionLoss > 0) {
        totalLoss += positionLoss;
        
        // Create stressed position
        const stressedPosition: Position = {
          ...position,
          currentPrice: position.currentPrice * (1 - shock),
          unrealizedPnL: position.unrealizedPnL - positionLoss
        };
        
        stressedPositions.push(stressedPosition);
        
        // Track worst positions
        if (positionLoss / (position.quantity * position.currentPrice) > 0.1) {
          worstPositions.push(stressedPosition);
        }
      }
    }
    
    // Calculate portfolio metrics after stress
    const stressedPortfolio: Portfolio = {
      ...portfolio,
      positions: stressedPositions,
      totalValue: portfolio.totalValue - totalLoss
    };
    
    // Check risk limits
    const varBreach = await this.checkVaRBreach(stressedPortfolio);
    const marginStatus = this.calculateMarginStatus(stressedPortfolio);
    const marginCall = marginStatus.status === 'marginCall';
    const liquidation = marginStatus.status === 'liquidation';
    
    // Estimate recovery time
    const recoveryTime = this.estimateRecoveryTime(totalLoss, portfolio.totalValue);
    
    return {
      scenario: scenario.name,
      portfolioLoss: totalLoss,
      worstPositions: worstPositions.slice(0, 5), // Top 5 worst
      varBreach,
      marginCall,
      liquidation,
      recoveryTime
    };
  }

  /**
   * Calculate position loss under stress scenario
   */
  private calculatePositionLoss(
    position: Position,
    shock: number,
    scenario: StressScenario
  ): number {
    let loss = position.quantity * position.currentPrice * shock;
    
    // Apply volatility multiplier if specified
    if (scenario.volatilityMultiplier) {
      loss *= scenario.volatilityMultiplier;
    }
    
    // Apply liquidity reduction if specified
    if (scenario.liquidityReduction) {
      // Increase loss due to wider spreads and market impact
      loss *= (1 + scenario.liquidityReduction);
    }
    
    return Math.max(0, loss);
  }

  /**
   * Initialize historical scenarios
   */
  private initializeHistoricalScenarios(): Map<string, HistoricalEvent> {
    const scenarios = new Map<string, HistoricalEvent>();
    
    // 2008 Financial Crisis
    scenarios.set('2008Crisis', {
      name: '2008 Financial Crisis',
      startDate: new Date('2008-09-15'),
      endDate: new Date('2009-03-09'),
      affectedAssets: ['SPY', 'QQQ', 'IWM', 'EFA', 'BTC'],
      marketConditions: {
        volatilityRegime: 'extreme',
        correlationRegime: 'crisis',
        liquidityConditions: 'frozen'
      }
    });
    
    // COVID-19 Crash
    scenarios.set('CovidCrash', {
      name: 'COVID-19 Market Crash',
      startDate: new Date('2020-02-20'),
      endDate: new Date('2020-03-23'),
      affectedAssets: ['SPY', 'QQQ', 'IWM', 'EFA', 'BTC', 'ETH'],
      marketConditions: {
        volatilityRegime: 'extreme',
        correlationRegime: 'crisis',
        liquidityConditions: 'stressed'
      }
    });
    
    // Crypto Winter 2022
    scenarios.set('CryptoWinter', {
      name: 'Crypto Winter 2022',
      startDate: new Date('2022-05-01'),
      endDate: new Date('2022-12-31'),
      affectedAssets: ['BTC', 'ETH', 'SOL', 'AVAX', 'MATIC'],
      marketConditions: {
        volatilityRegime: 'high',
        correlationRegime: 'crisis',
        liquidityConditions: 'stressed'
      }
    });
    
    return scenarios;
  }

  /**
   * Convert historical event to stress scenario
   */
  private convertHistoricalToStressScenario(event: HistoricalEvent): StressScenario {
    const shocks = new Map<string, number>();
    
    // Define shocks based on historical event
    switch (event.name) {
      case '2008 Financial Crisis':
        shocks.set('SPY', 0.57); // S&P 500 fell 57%
        shocks.set('QQQ', 0.55);
        shocks.set('IWM', 0.60);
        shocks.set('EFA', 0.62);
        shocks.set('BTC', 0.80); // Hypothetical
        break;
        
      case 'COVID-19 Market Crash':
        shocks.set('SPY', 0.34);
        shocks.set('QQQ', 0.28);
        shocks.set('IWM', 0.41);
        shocks.set('EFA', 0.36);
        shocks.set('BTC', 0.50);
        shocks.set('ETH', 0.60);
        break;
        
      case 'Crypto Winter 2022':
        shocks.set('BTC', 0.77);
        shocks.set('ETH', 0.82);
        shocks.set('SOL', 0.95);
        shocks.set('AVAX', 0.90);
        shocks.set('MATIC', 0.85);
        break;
        
      default:
        // Default 30% shock for unknown events
        event.affectedAssets.forEach(asset => shocks.set(asset, 0.30));
    }
    
    return {
      name: event.name,
      description: `Historical stress test based on ${event.name}`,
      assetShocks: shocks,
      correlationShift: event.marketConditions.correlationRegime === 'crisis' ? 0.3 : 0,
      volatilityMultiplier: event.marketConditions.volatilityRegime === 'extreme' ? 2.5 : 1.5,
      liquidityReduction: event.marketConditions.liquidityConditions === 'frozen' ? 0.5 : 0.2
    };
  }

  /**
   * Generate random stress scenario for Monte Carlo
   */
  private generateRandomScenario(iteration: number): StressScenario {
    const shocks = new Map<string, number>();
    
    // Common assets to stress
    const assets = ['BTC', 'ETH', 'SPY', 'QQQ', 'GLD', 'TLT'];
    
    // Generate random shocks
    assets.forEach(asset => {
      // Random shock between 0% and 50%
      const shock = Math.random() * 0.5;
      shocks.set(asset, shock);
    });
    
    // Random market conditions
    const volatilityMultiplier = 1 + Math.random() * 2; // 1x to 3x
    const correlationShift = Math.random() * 0.5; // 0 to 0.5
    const liquidityReduction = Math.random() * 0.3; // 0 to 30%
    
    return {
      name: `Monte Carlo Scenario ${iteration}`,
      description: `Randomly generated stress scenario #${iteration}`,
      assetShocks: shocks,
      volatilityMultiplier,
      correlationShift,
      liquidityReduction
    };
  }

  /**
   * Analyze Monte Carlo results
   */
  private analyzeMonteCarloResults(results: StressTestResult[]) {
    const losses = results.map(r => r.portfolioLoss);
    const varBreaches = results.filter(r => r.varBreach).length;
    const marginCalls = results.filter(r => r.marginCall).length;
    const liquidations = results.filter(r => r.liquidation).length;
    
    return {
      averageLoss: losses.reduce((sum, loss) => sum + loss, 0) / losses.length,
      maxLoss: Math.max(...losses),
      minLoss: Math.min(...losses),
      varBreachRate: varBreaches / results.length,
      marginCallRate: marginCalls / results.length,
      liquidationRate: liquidations / results.length,
      percentile95Loss: this.calculatePercentile(losses, 0.95),
      percentile99Loss: this.calculatePercentile(losses, 0.99)
    };
  }

  /**
   * Analyze portfolio composition
   */
  private analyzePortfolioComposition(portfolio: Portfolio) {
    const composition = {
      assetTypes: new Map<string, number>(),
      largestPositions: [] as Position[],
      totalLeverage: 0,
      concentrationRisk: 0
    };
    
    // Sort positions by value
    const sortedPositions = [...portfolio.positions].sort((a, b) => 
      (b.quantity * b.currentPrice) - (a.quantity * a.currentPrice)
    );
    
    composition.largestPositions = sortedPositions.slice(0, 5);
    
    // Calculate concentration
    const top5Value = composition.largestPositions.reduce((sum, pos) => 
      sum + (pos.quantity * pos.currentPrice), 0
    );
    composition.concentrationRisk = top5Value / portfolio.totalValue;
    
    // Calculate leverage
    composition.totalLeverage = portfolio.positions.reduce((sum, pos) => 
      sum + (pos.leverage || 1), 0
    ) / portfolio.positions.length;
    
    return composition;
  }

  /**
   * Create worst-case scenario targeting portfolio weaknesses
   */
  private createWorstCaseScenario(composition: any, index: number): StressScenario {
    const shocks = new Map<string, number>();
    
    // Target largest positions with severe shocks
    composition.largestPositions.forEach((pos: Position) => {
      shocks.set(pos.symbol, 0.5 + (index * 0.1)); // 50% to 90% shock
    });
    
    // Add correlation stress if concentrated
    const correlationShift = composition.concentrationRisk > 0.5 ? 0.5 : 0.3;
    
    // Add leverage stress
    const volatilityMultiplier = composition.totalLeverage > 2 ? 3 : 2;
    
    return {
      name: `Worst Case Scenario ${index + 1}`,
      description: `Scenario targeting portfolio vulnerabilities`,
      assetShocks: shocks,
      correlationShift,
      volatilityMultiplier,
      liquidityReduction: 0.4
    };
  }

  /**
   * Generate extreme scenarios for maximum loss calculation
   */
  private async generateExtremeScenarios(
    portfolio: Portfolio,
    timeHorizon: number
  ): Promise<StressScenario[]> {
    const scenarios: StressScenario[] = [];
    
    // Total market collapse
    const totalCollapse: StressScenario = {
      name: 'Total Market Collapse',
      description: 'Extreme market-wide collapse',
      assetShocks: new Map(),
      volatilityMultiplier: 5,
      correlationShift: 1,
      liquidityReduction: 0.8
    };
    
    // Apply 90% shock to all assets
    portfolio.positions.forEach(pos => {
      totalCollapse.assetShocks.set(pos.symbol, 0.9);
    });
    
    scenarios.push(totalCollapse);
    
    // Sector-specific collapses
    const sectorCollapse: StressScenario = {
      name: 'Sector Collapse',
      description: 'Major sector experiencing severe stress',
      assetShocks: new Map(),
      volatilityMultiplier: 3,
      correlationShift: 0.5,
      liquidityReduction: 0.5
    };
    
    // Apply varying shocks based on assumed sectors
    portfolio.positions.forEach(pos => {
      const shock = pos.symbol.includes('BTC') || pos.symbol.includes('ETH') ? 0.95 : 0.4;
      sectorCollapse.assetShocks.set(pos.symbol, shock);
    });
    
    scenarios.push(sectorCollapse);
    
    return scenarios;
  }

  /**
   * Check if VaR limit is breached
   */
  private async checkVaRBreach(portfolio: Portfolio): Promise<boolean> {
    // Simplified check - in production would use actual VaR calculation
    const lossPercentage = (portfolio.totalValue - portfolio.totalValue) / portfolio.totalValue;
    return lossPercentage > 0.05; // 5% VaR threshold
  }

  /**
   * Calculate margin status
   */
  private calculateMarginStatus(portfolio: Portfolio) {
    const marginLevel = portfolio.marginAvailable / (portfolio.marginUsed + portfolio.marginAvailable);
    
    let status: 'safe' | 'warning' | 'marginCall' | 'liquidation' = 'safe';
    
    if (marginLevel < 0.05) {
      status = 'liquidation';
    } else if (marginLevel < 0.2) {
      status = 'marginCall';
    } else if (marginLevel < 0.4) {
      status = 'warning';
    }
    
    return {
      marginUsed: portfolio.marginUsed,
      marginAvailable: portfolio.marginAvailable,
      marginLevel,
      status
    };
  }

  /**
   * Estimate recovery time based on historical patterns
   */
  private estimateRecoveryTime(loss: number, portfolioValue: number): number {
    const lossPercentage = loss / portfolioValue;
    
    // Rough estimates based on historical recovery patterns
    if (lossPercentage > 0.5) {
      return 365 * 3; // 3 years
    } else if (lossPercentage > 0.3) {
      return 365 * 1.5; // 1.5 years
    } else if (lossPercentage > 0.2) {
      return 365; // 1 year
    } else if (lossPercentage > 0.1) {
      return 180; // 6 months
    } else {
      return 90; // 3 months
    }
  }

  /**
   * Calculate percentile from array of values
   */
  private calculatePercentile(values: number[], percentile: number): number {
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.floor(sorted.length * percentile);
    return sorted[index];
  }

  /**
   * Add custom scenario
   */
  addCustomScenario(scenario: StressScenario): void {
    this.customScenarios.set(scenario.name, scenario);
  }

  /**
   * Get all available scenarios
   */
  getAvailableScenarios(): { historical: string[], custom: string[] } {
    return {
      historical: Array.from(this.historicalScenarios.keys()),
      custom: Array.from(this.customScenarios.keys())
    };
  }
} 