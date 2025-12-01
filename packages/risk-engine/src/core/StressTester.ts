import {
  Portfolio,
  Position,
  StressScenario,
  HistoricalEvent,
  StressTestResult,
  MonteCarloConfig,
  Asset,
  Scenario,
  MarketCondition,
  RiskEngineError,
  RiskErrorCode
} from '../types';
import * as math from 'mathjs';
import * as ss from 'simple-statistics';
import { Logger } from 'winston';

export class StressTester {
  private logger: Logger;
  private historicalEvents: Map<string, HistoricalEvent>;
  private customScenarios: Map<string, StressScenario>;
  private correlationStress: Map<string, number>;

  constructor(logger: Logger) {
    this.logger = logger;
    this.historicalEvents = this.loadHistoricalEvents();
    this.customScenarios = new Map();
    this.correlationStress = new Map();
  }

  /**
   * Run a historical stress test scenario
   */
  async runHistoricalScenario(
    portfolio: Portfolio,
    scenario: HistoricalEvent
  ): Promise<StressTestResult> {
    this.logger.info('Running historical stress test', { scenario: scenario.name });

    const startTime = Date.now();
    let portfolioLoss = 0;
    let worstPositionLoss = 0;
    let worstPosition = '';
    const recommendations: string[] = [];

    // Apply market moves to each position
    for (const position of portfolio.positions) {
      const shock = this.getAssetShock(position.symbol, scenario);
      const positionValue = position.size * position.currentPrice;
      const positionLoss = positionValue * shock;
      
      portfolioLoss += positionLoss;
      
      if (positionLoss < worstPositionLoss) {
        worstPositionLoss = positionLoss;
        worstPosition = position.symbol;
      }

      // Check liquidation risk
      const stressedPrice = position.currentPrice * (1 + shock);
      if (this.checkLiquidation(position, stressedPrice)) {
        recommendations.push(`${position.symbol} at risk of liquidation`);
      }
    }

    const percentageLoss = portfolioLoss / portfolio.totalValue;
    const marginCall = this.checkMarginCall(portfolio, percentageLoss);
    const liquidation = percentageLoss > 0.5; // 50% loss triggers liquidation

    // Generate recommendations
    if (percentageLoss > 0.2) {
      recommendations.push('Consider reducing leverage');
      recommendations.push('Implement stop-loss orders');
    }
    if (percentageLoss > 0.3) {
      recommendations.push('Diversify portfolio across uncorrelated assets');
      recommendations.push('Consider hedging strategies');
    }

    return {
      scenario: scenario.name,
      portfolioLoss: Math.abs(portfolioLoss),
      percentageLoss: Math.abs(percentageLoss),
      worstPosition,
      worstPositionLoss: Math.abs(worstPositionLoss),
      marginCall,
      liquidation,
      recoveryTime: this.estimateRecoveryTime(percentageLoss),
      recommendations
    };
  }

  /**
   * Run a custom stress test scenario
   */
  async runCustomScenario(
    portfolio: Portfolio,
    scenario: StressScenario
  ): Promise<StressTestResult> {
    this.logger.info('Running custom stress test', { scenario: scenario.name });

    let portfolioLoss = 0;
    let worstPositionLoss = 0;
    let worstPosition = '';
    const recommendations: string[] = [];

    // Apply shocks and correlation shifts
    for (const position of portfolio.positions) {
      const baseShock = scenario.assetShocks.get(position.symbol) || 0;
      let adjustedShock = baseShock;

      // Apply volatility multiplier
      if (scenario.volatilityMultiplier) {
        const assetVolatility = await this.getAssetVolatility(position.symbol);
        adjustedShock *= scenario.volatilityMultiplier * assetVolatility;
      }

      // Apply correlation shift
      if (scenario.correlationShift) {
        adjustedShock = this.applyCorrelationShift(
          adjustedShock,
          position.symbol,
          scenario.correlationShift
        );
      }

      // Apply liquidity reduction
      if (scenario.liquidityReduction) {
        adjustedShock *= (1 + scenario.liquidityReduction * 0.1); // 10% worse per liquidity point
      }

      const positionValue = position.size * position.currentPrice;
      const positionLoss = positionValue * adjustedShock;
      
      portfolioLoss += positionLoss;
      
      if (positionLoss < worstPositionLoss) {
        worstPositionLoss = positionLoss;
        worstPosition = position.symbol;
      }
    }

    const percentageLoss = portfolioLoss / portfolio.totalValue;
    const marginCall = this.checkMarginCall(portfolio, percentageLoss);
    const liquidation = percentageLoss > 0.5;

    // Scenario-specific recommendations
    if (scenario.volatilityMultiplier && scenario.volatilityMultiplier > 2) {
      recommendations.push('Implement volatility-based position sizing');
      recommendations.push('Consider volatility derivatives for hedging');
    }
    if (scenario.liquidityReduction && scenario.liquidityReduction > 0.5) {
      recommendations.push('Maintain higher cash reserves');
      recommendations.push('Focus on highly liquid assets');
    }

    return {
      scenario: scenario.name,
      portfolioLoss: Math.abs(portfolioLoss),
      percentageLoss: Math.abs(percentageLoss),
      worstPosition,
      worstPositionLoss: Math.abs(worstPositionLoss),
      marginCall,
      liquidation,
      recoveryTime: this.estimateRecoveryTime(percentageLoss),
      recommendations
    };
  }

  /**
   * Run Monte Carlo stress testing
   */
  async runMonteCarloStress(
    portfolio: Portfolio,
    config: MonteCarloConfig,
    iterations: number = 10000
  ): Promise<StressTestResult[]> {
    this.logger.info('Running Monte Carlo stress test', { iterations });

    const results: StressTestResult[] = [];
    const losses: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const scenario = this.generateRandomScenario(portfolio, config);
      const result = await this.runCustomScenario(portfolio, scenario);
      
      results.push(result);
      losses.push(result.percentageLoss);
    }

    // Sort results by severity
    results.sort((a, b) => b.percentageLoss - a.percentageLoss);

    // Add summary statistics
    const summaryResult: StressTestResult = {
      scenario: 'Monte Carlo Summary',
      portfolioLoss: ss.mean(losses) * portfolio.totalValue,
      percentageLoss: ss.mean(losses),
      worstPosition: this.getMostFrequentWorstPosition(results),
      worstPositionLoss: Math.max(...results.map(r => r.worstPositionLoss)),
      marginCall: results.filter(r => r.marginCall).length / iterations > 0.05,
      liquidation: results.filter(r => r.liquidation).length / iterations > 0.01,
      recoveryTime: ss.mean(results.map(r => r.recoveryTime || 0)),
      recommendations: this.generateMonteCarloRecommendations(results, losses)
    };

    // Return top 10 worst scenarios plus summary
    return [summaryResult, ...results.slice(0, 10)];
  }

  /**
   * Generate worst-case scenarios based on portfolio composition
   */
  async generateWorstCaseScenarios(
    portfolio: Portfolio,
    count: number = 5
  ): Promise<StressScenario[]> {
    this.logger.info('Generating worst-case scenarios', { count });

    const scenarios: StressScenario[] = [];

    // Scenario 1: Correlated crash
    scenarios.push({
      name: 'Correlated Market Crash',
      description: 'All assets crash simultaneously with high correlation',
      assetShocks: this.generateCorrelatedShocks(portfolio, -0.4),
      correlationShift: 0.9,
      volatilityMultiplier: 3,
      liquidityReduction: 0.8,
      duration: 24,
      probability: 0.02
    });

    // Scenario 2: Flash crash
    scenarios.push({
      name: 'Flash Crash',
      description: 'Rapid market decline with liquidity evaporation',
      assetShocks: this.generateUniformShocks(portfolio, -0.25),
      correlationShift: 0.5,
      volatilityMultiplier: 5,
      liquidityReduction: 0.95,
      duration: 1,
      probability: 0.05
    });

    // Scenario 3: Sector-specific crash
    const dominantSector = this.identifyDominantSector(portfolio);
    scenarios.push({
      name: `${dominantSector} Sector Collapse`,
      description: `Major decline in ${dominantSector} sector`,
      assetShocks: this.generateSectorShocks(portfolio, dominantSector, -0.5),
      correlationShift: 0.7,
      volatilityMultiplier: 2,
      liquidityReduction: 0.6,
      duration: 48,
      probability: 0.03
    });

    // Scenario 4: Regulatory shock
    scenarios.push({
      name: 'Regulatory Crackdown',
      description: 'Major regulatory action against crypto assets',
      assetShocks: this.generateRegulatoryShocks(portfolio),
      correlationShift: 0.8,
      volatilityMultiplier: 2.5,
      liquidityReduction: 0.7,
      duration: 168, // 1 week
      probability: 0.04
    });

    // Scenario 5: Technical failure
    scenarios.push({
      name: 'Infrastructure Failure',
      description: 'Major exchange or blockchain technical failure',
      assetShocks: this.generateTechnicalFailureShocks(portfolio),
      correlationShift: 0.3,
      volatilityMultiplier: 4,
      liquidityReduction: 0.9,
      duration: 12,
      probability: 0.02
    });

    return scenarios.slice(0, count);
  }

  /**
   * Calculate the maximum possible loss for the portfolio
   */
  async calculateMaximumLoss(
    portfolio: Portfolio,
    timeHorizon: number = 24
  ): Promise<number> {
    this.logger.info('Calculating maximum loss', { timeHorizon });

    // Generate extreme scenarios
    const scenarios = await this.generateWorstCaseScenarios(portfolio, 10);
    let maxLoss = 0;

    for (const scenario of scenarios) {
      const result = await this.runCustomScenario(portfolio, scenario);
      maxLoss = Math.max(maxLoss, result.portfolioLoss);
    }

    // Adjust for time horizon (square root of time rule)
    const adjustmentFactor = Math.sqrt(timeHorizon / 24);
    return maxLoss * adjustmentFactor;
  }

  // Helper methods

  private loadHistoricalEvents(): Map<string, HistoricalEvent> {
    const events = new Map<string, HistoricalEvent>();

    // 2008 Financial Crisis
    events.set('2008Crisis', {
      name: '2008 Financial Crisis',
      date: new Date('2008-09-15'),
      description: 'Global financial system collapse',
      marketMoves: {
        'BTC': -0.50, // Hypothetical
        'ETH': -0.60,
        'stocks': -0.45,
        'bonds': 0.10,
        'gold': 0.15
      },
      volatilityRegime: 4,
      correlationBreakdown: false
    });

    // COVID-19 Crash
    events.set('COVID19', {
      name: 'COVID-19 Market Crash',
      date: new Date('2020-03-12'),
      description: 'Pandemic-induced market crash',
      marketMoves: {
        'BTC': -0.50,
        'ETH': -0.55,
        'stocks': -0.35,
        'bonds': 0.05,
        'gold': -0.05
      },
      volatilityRegime: 3.5,
      correlationBreakdown: true
    });

    // Terra/Luna Collapse
    events.set('TerraCollapse', {
      name: 'Terra/Luna Collapse',
      date: new Date('2022-05-09'),
      description: 'Algorithmic stablecoin collapse',
      marketMoves: {
        'BTC': -0.25,
        'ETH': -0.30,
        'LUNA': -0.99,
        'UST': -0.95,
        'stablecoins': -0.05
      },
      volatilityRegime: 3,
      correlationBreakdown: false
    });

    // FTX Collapse
    events.set('FTXCollapse', {
      name: 'FTX Exchange Collapse',
      date: new Date('2022-11-08'),
      description: 'Major exchange bankruptcy',
      marketMoves: {
        'BTC': -0.20,
        'ETH': -0.25,
        'SOL': -0.60,
        'FTT': -0.95,
        'exchange-tokens': -0.40
      },
      volatilityRegime: 2.5,
      correlationBreakdown: false
    });

    return events;
  }

  private getAssetShock(symbol: string, scenario: HistoricalEvent): number {
    // Direct match
    if (scenario.marketMoves[symbol]) {
      return scenario.marketMoves[symbol];
    }

    // Category match
    if (symbol.includes('USD') && scenario.marketMoves['stablecoins']) {
      return scenario.marketMoves['stablecoins'];
    }

    // Default crypto shock
    return scenario.marketMoves['BTC'] || -0.20;
  }

  private checkLiquidation(position: Position, stressedPrice: number): boolean {
    if (position.side === 'long') {
      return stressedPrice <= position.liquidationPrice;
    } else {
      return stressedPrice >= position.liquidationPrice;
    }
  }

  private checkMarginCall(portfolio: Portfolio, loss: number): boolean {
    const stressedMargin = portfolio.marginUsed / (1 - loss);
    const marginLevel = portfolio.marginAvailable / stressedMargin;
    return marginLevel < 1.5; // 150% margin requirement
  }

  private estimateRecoveryTime(loss: number): number {
    // Empirical recovery time estimates (in hours)
    if (loss < 0.1) return 24;      // 10% loss: 1 day
    if (loss < 0.2) return 168;     // 20% loss: 1 week
    if (loss < 0.3) return 720;     // 30% loss: 1 month
    if (loss < 0.5) return 2160;    // 50% loss: 3 months
    return 8760;                    // >50% loss: 1 year
  }

  private async getAssetVolatility(symbol: string): Promise<number> {
    // In production, fetch from market data
    // Mock implementation
    const volatilities: Record<string, number> = {
      'BTC': 0.6,
      'ETH': 0.8,
      'SOL': 1.2,
      'MATIC': 1.0,
      'LINK': 0.9
    };
    
    return volatilities[symbol] || 1.0;
  }

  private applyCorrelationShift(
    shock: number,
    symbol: string,
    correlationShift: number
  ): number {
    // Increase shock magnitude based on correlation
    const correlationMultiplier = 1 + (correlationShift - 0.5) * 0.5;
    return shock * correlationMultiplier;
  }

  private generateRandomScenario(
    portfolio: Portfolio,
    config: MonteCarloConfig
  ): StressScenario {
    const shocks = new Map<string, number>();
    
    // Generate correlated shocks
    const correlation = Math.random() * 0.8 + 0.1; // 0.1 to 0.9
    const baseShock = this.generateRandomShock(config);
    
    for (const position of portfolio.positions) {
      const assetSpecificShock = this.generateRandomShock(config);
      const correlatedShock = baseShock * correlation + assetSpecificShock * (1 - correlation);
      shocks.set(position.symbol, correlatedShock);
    }

    return {
      name: `Random Scenario ${Date.now()}`,
      description: 'Monte Carlo generated scenario',
      assetShocks: shocks,
      correlationShift: correlation,
      volatilityMultiplier: 1 + Math.random() * 3,
      liquidityReduction: Math.random() * 0.8,
      duration: Math.floor(Math.random() * 168) + 1,
      probability: 1 / config.iterations
    };
  }

  private generateRandomShock(config: MonteCarloConfig): number {
    switch (config.returnModel) {
      case 'normal':
        return this.generateNormalShock();
      case 'studentT':
        return this.generateStudentTShock();
      case 'empirical':
        return this.generateEmpiricalShock();
      default:
        return this.generateNormalShock();
    }
  }

  private generateNormalShock(): number {
    // Box-Muller transform for normal distribution
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return z * 0.1; // 10% standard deviation
  }

  private generateStudentTShock(): number {
    // Simplified Student-t with 3 degrees of freedom (fat tails)
    const normal = this.generateNormalShock();
    const chi2 = Math.random() + Math.random() + Math.random(); // Sum of 3 uniform ~ chi-squared(3)
    return normal * Math.sqrt(3 / chi2) * 0.15; // Heavier tails
  }

  private generateEmpiricalShock(): number {
    // Sample from historical distribution
    const historicalShocks = [-0.5, -0.3, -0.2, -0.1, -0.05, 0, 0.05, 0.1, 0.15];
    return historicalShocks[Math.floor(Math.random() * historicalShocks.length)];
  }

  private getMostFrequentWorstPosition(results: StressTestResult[]): string {
    const counts = new Map<string, number>();
    
    for (const result of results) {
      counts.set(result.worstPosition, (counts.get(result.worstPosition) || 0) + 1);
    }
    
    let maxCount = 0;
    let mostFrequent = '';
    
    for (const [position, count] of counts) {
      if (count > maxCount) {
        maxCount = count;
        mostFrequent = position;
      }
    }
    
    return mostFrequent;
  }

  private generateMonteCarloRecommendations(
    results: StressTestResult[],
    losses: number[]
  ): string[] {
    const recommendations: string[] = [];
    
    // Value at Risk
    const var95 = ss.quantile(losses, 0.95);
    const var99 = ss.quantile(losses, 0.99);
    
    recommendations.push(`95% VaR: ${(var95 * 100).toFixed(1)}% loss`);
    recommendations.push(`99% VaR: ${(var99 * 100).toFixed(1)}% loss`);
    
    // Conditional VaR
    const tailLosses = losses.filter(l => l > var95);
    const cvar = ss.mean(tailLosses);
    recommendations.push(`Expected loss beyond VaR: ${(cvar * 100).toFixed(1)}%`);
    
    // Risk mitigation
    if (var95 > 0.2) {
      recommendations.push('Portfolio at high risk - consider reducing leverage');
    }
    if (cvar > 0.4) {
      recommendations.push('Extreme tail risk - implement tail hedging strategies');
    }
    
    // Liquidation risk
    const liquidationProb = results.filter(r => r.liquidation).length / results.length;
    if (liquidationProb > 0.01) {
      recommendations.push(`${(liquidationProb * 100).toFixed(1)}% chance of liquidation - increase margin buffer`);
    }
    
    return recommendations;
  }

  private generateCorrelatedShocks(
    portfolio: Portfolio,
    magnitude: number
  ): Map<string, number> {
    const shocks = new Map<string, number>();
    
    for (const position of portfolio.positions) {
      // All assets move together
      shocks.set(position.symbol, magnitude * (0.9 + Math.random() * 0.2));
    }
    
    return shocks;
  }

  private generateUniformShocks(
    portfolio: Portfolio,
    magnitude: number
  ): Map<string, number> {
    const shocks = new Map<string, number>();
    
    for (const position of portfolio.positions) {
      shocks.set(position.symbol, magnitude);
    }
    
    return shocks;
  }

  private identifyDominantSector(portfolio: Portfolio): string {
    const sectorWeights = new Map<string, number>();
    
    for (const position of portfolio.positions) {
      const sector = this.getAssetSector(position.symbol);
      const weight = (position.size * position.currentPrice) / portfolio.totalValue;
      sectorWeights.set(sector, (sectorWeights.get(sector) || 0) + weight);
    }
    
    let maxWeight = 0;
    let dominantSector = 'crypto';
    
    for (const [sector, weight] of sectorWeights) {
      if (weight > maxWeight) {
        maxWeight = weight;
        dominantSector = sector;
      }
    }
    
    return dominantSector;
  }

  private getAssetSector(symbol: string): string {
    const sectorMap: Record<string, string> = {
      'BTC': 'store-of-value',
      'ETH': 'smart-contract',
      'SOL': 'smart-contract',
      'MATIC': 'layer-2',
      'LINK': 'oracle',
      'UNI': 'defi',
      'AAVE': 'defi',
      'USDT': 'stablecoin',
      'USDC': 'stablecoin'
    };
    
    return sectorMap[symbol] || 'other';
  }

  private generateSectorShocks(
    portfolio: Portfolio,
    sector: string,
    magnitude: number
  ): Map<string, number> {
    const shocks = new Map<string, number>();
    
    for (const position of portfolio.positions) {
      const assetSector = this.getAssetSector(position.symbol);
      if (assetSector === sector) {
        shocks.set(position.symbol, magnitude);
      } else {
        // Contagion effect - other sectors affected but less
        shocks.set(position.symbol, magnitude * 0.3);
      }
    }
    
    return shocks;
  }

  private generateRegulatoryShocks(portfolio: Portfolio): Map<string, number> {
    const shocks = new Map<string, number>();
    
    for (const position of portfolio.positions) {
      // Stablecoins most affected by regulation
      if (position.symbol.includes('USD')) {
        shocks.set(position.symbol, -0.15);
      }
      // Privacy coins heavily affected
      else if (['XMR', 'ZEC', 'DASH'].includes(position.symbol)) {
        shocks.set(position.symbol, -0.7);
      }
      // DeFi tokens moderately affected
      else if (['UNI', 'AAVE', 'COMP'].includes(position.symbol)) {
        shocks.set(position.symbol, -0.4);
      }
      // Major cryptos less affected
      else if (['BTC', 'ETH'].includes(position.symbol)) {
        shocks.set(position.symbol, -0.2);
      }
      // Others
      else {
        shocks.set(position.symbol, -0.3);
      }
    }
    
    return shocks;
  }

  private generateTechnicalFailureShocks(portfolio: Portfolio): Map<string, number> {
    const shocks = new Map<string, number>();
    
    // Simulate random exchange/blockchain failure
    const failedAsset = portfolio.positions[
      Math.floor(Math.random() * portfolio.positions.length)
    ].symbol;
    
    for (const position of portfolio.positions) {
      if (position.symbol === failedAsset) {
        // Direct impact
        shocks.set(position.symbol, -0.4);
      } else {
        // Contagion based on correlation
        const correlation = 0.3 + Math.random() * 0.4;
        shocks.set(position.symbol, -0.4 * correlation);
      }
    }
    
    return shocks;
  }
} 