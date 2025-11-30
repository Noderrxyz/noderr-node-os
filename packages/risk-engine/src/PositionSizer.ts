import {
  Portfolio,
  Position,
  Asset,
  PositionSizerConfig,
  PositionSize,
  PositionLimits,
  TradingSignal,
  CorrelationMatrix,
  RiskTelemetryEvent,
  TelemetryClient
} from './types';
import { EventEmitter } from 'events';

/**
 * Institutional-grade Position Sizer
 * Implements Kelly Criterion, Volatility Targeting, Risk Parity, and Maximum Drawdown sizing
 */
export class PositionSizer extends EventEmitter {
  private config: PositionSizerConfig;
  private telemetry?: TelemetryClient;
  private historicalPerformance: Map<string, PerformanceStats> = new Map();
  
  constructor(config: PositionSizerConfig, telemetry?: TelemetryClient) {
    super();
    this.config = config;
    this.telemetry = telemetry;
  }

  /**
   * Calculate optimal position size based on configured methodology
   */
  async calculatePositionSize(
    signal: TradingSignal,
    portfolio: Portfolio,
    asset: Asset,
    marketData?: MarketData
  ): Promise<PositionSize> {
    const startTime = Date.now();

    try {
      let baseSize: number;
      let sizingMethod: string;

      // Calculate base position size based on methodology
      switch (this.config.methodology) {
        case 'kelly':
          baseSize = await this.calculateKellySize(signal.symbol, signal.confidence);
          sizingMethod = 'Kelly Criterion';
          break;
          
        case 'volatilityTarget':
          baseSize = await this.calculateVolatilityTargetSize(
            portfolio, 
            asset, 
            this.config.targetVolatility || 0.15
          );
          sizingMethod = 'Volatility Targeting';
          break;
          
        case 'riskParity':
          baseSize = await this.calculateRiskParitySize(portfolio, asset);
          sizingMethod = 'Risk Parity';
          break;
          
        case 'maxDrawdown':
          baseSize = await this.calculateMaxDrawdownSize(
            portfolio, 
            asset, 
            marketData?.maxAcceptableDrawdown || 0.20
          );
          sizingMethod = 'Maximum Drawdown';
          break;
          
        default:
          throw new Error(`Unknown position sizing methodology: ${this.config.methodology}`);
      }

      // Adjust for signal strength
      baseSize *= signal.strength;

      // Adjust for correlation if enabled
      if (this.config.correlationAdjustment && marketData?.correlationMatrix) {
        baseSize = this.adjustForCorrelation(
          baseSize, 
          portfolio, 
          asset, 
          marketData.correlationMatrix
        );
      }

      // Apply position limits
      const limits: PositionLimits = {
        maxPositionSize: this.config.maxPositionSize,
        maxLeverage: marketData?.maxLeverage || 1,
        maxConcentration: marketData?.maxConcentration || 0.25,
        maxSectorExposure: marketData?.maxSectorExposure
      };

      const finalSize = this.enforcePositionLimits(baseSize, portfolio, asset, limits);

      // Calculate risk contribution
      const riskContribution = this.calculateRiskContribution(finalSize, asset, portfolio);

      const result: PositionSize = {
        symbol: signal.symbol,
        recommendedSize: finalSize,
        maxSize: limits.maxPositionSize * portfolio.totalValue,
        minSize: marketData?.minPositionSize || 0,
        sizingMethod,
        riskContribution
      };

      // Emit telemetry
      if (this.telemetry) {
        this.telemetry.track({
          eventType: 'position_sizing',
          data: {
            symbol: signal.symbol,
            methodology: this.config.methodology,
            baseSize,
            finalSize,
            sizingMethod,
            riskContribution
          },
          duration: Date.now() - startTime,
          timestamp: new Date()
        });
      }

      this.emit('positionSized', result);
      return result;

    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Kelly Criterion Position Sizing
   * f* = (p * b - q) / b
   * where f* = fraction of capital to wager
   * p = probability of winning
   * q = probability of losing (1 - p)
   * b = ratio of win to loss
   */
  async calculateKellySize(symbol: string, confidence: number): Promise<number> {
    const stats = this.historicalPerformance.get(symbol) || await this.fetchPerformanceStats(symbol);
    
    if (!stats || stats.totalTrades < 30) {
      // Not enough data for Kelly, use default small size
      return 0.02; // 2% of capital
    }

    const winRate = stats.winRate;
    const avgWinLossRatio = stats.avgWin / Math.abs(stats.avgLoss);
    
    // Kelly formula
    const kelly = (winRate * avgWinLossRatio - (1 - winRate)) / avgWinLossRatio;
    
    // Apply Kelly fraction (typically 0.25 to be conservative)
    const kellyFraction = this.config.confidenceLevel || 0.25;
    const adjustedKelly = kelly * kellyFraction;
    
    // Ensure positive and reasonable size
    return Math.max(0, Math.min(adjustedKelly, 0.25)); // Cap at 25%
  }

  /**
   * Volatility Target Position Sizing
   * Position Size = (Target Vol / Asset Vol) * Capital
   */
  async calculateVolatilityTargetSize(
    portfolio: Portfolio,
    asset: Asset,
    targetVolatility: number
  ): Promise<number> {
    const assetVolatility = asset.volatility || await this.calculateAssetVolatility(asset.symbol);
    
    if (assetVolatility === 0) {
      return 0;
    }
    
    // Basic volatility targeting
    const baseSize = targetVolatility / assetVolatility;
    
    // Adjust for portfolio volatility
    const portfolioVol = await this.calculatePortfolioVolatility(portfolio);
    const volAdjustment = portfolioVol > targetVolatility ? 
      targetVolatility / portfolioVol : 1;
    
    return baseSize * volAdjustment;
  }

  /**
   * Risk Parity Position Sizing
   * Each position contributes equally to portfolio risk
   */
  async calculateRiskParitySize(portfolio: Portfolio, asset: Asset): Promise<number> {
    const totalPositions = portfolio.positions.length + 1; // Including new position
    const targetRiskContribution = 1 / totalPositions;
    
    // Calculate current risk contributions
    const currentRiskContributions = await this.calculatePortfolioRiskContributions(portfolio);
    const totalRisk = Array.from(currentRiskContributions.values())
      .reduce((sum, risk) => sum + risk, 0);
    
    // Target risk for new position
    const targetRisk = totalRisk * targetRiskContribution;
    
    // Size to achieve target risk
    const assetVolatility = asset.volatility || await this.calculateAssetVolatility(asset.symbol);
    const size = targetRisk / assetVolatility;
    
    return Math.min(size, this.config.maxPositionSize);
  }

  /**
   * Maximum Drawdown Position Sizing
   * Size positions to limit maximum portfolio drawdown
   */
  async calculateMaxDrawdownSize(
    portfolio: Portfolio,
    asset: Asset,
    maxAcceptableDrawdown: number
  ): Promise<number> {
    // Estimate worst-case loss for the asset
    const historicalMaxDrawdown = await this.getHistoricalMaxDrawdown(asset.symbol);
    
    if (historicalMaxDrawdown === 0) {
      return 0;
    }
    
    // Size to limit contribution to portfolio drawdown
    const maxContribution = maxAcceptableDrawdown / portfolio.positions.length;
    const size = maxContribution / historicalMaxDrawdown;
    
    return Math.min(size, this.config.maxPositionSize);
  }

  /**
   * Adjust position size for correlation with existing positions
   */
  adjustForCorrelation(
    baseSize: number,
    portfolio: Portfolio,
    asset: Asset,
    correlationMatrix: CorrelationMatrix
  ): number {
    const assetIndex = correlationMatrix.assets.indexOf(asset.symbol);
    if (assetIndex === -1) {
      return baseSize; // No correlation data
    }
    
    let correlationAdjustment = 1;
    let totalCorrelation = 0;
    
    // Calculate average correlation with existing positions
    for (const position of portfolio.positions) {
      const posIndex = correlationMatrix.assets.indexOf(position.symbol);
      if (posIndex !== -1) {
        const correlation = correlationMatrix.matrix[assetIndex][posIndex];
        const positionWeight = (position.quantity * position.currentPrice) / portfolio.totalValue;
        totalCorrelation += Math.abs(correlation) * positionWeight;
      }
    }
    
    // Reduce size for highly correlated positions
    if (totalCorrelation > 0.5) {
      correlationAdjustment = 1 - (totalCorrelation - 0.5);
    }
    
    return baseSize * correlationAdjustment;
  }

  /**
   * Enforce position limits
   */
  enforcePositionLimits(
    size: number,
    portfolio: Portfolio,
    asset: Asset,
    limits: PositionLimits
  ): number {
    let finalSize = size;
    
    // Maximum position size
    finalSize = Math.min(finalSize, limits.maxPositionSize);
    
    // Maximum concentration
    const positionValue = finalSize * portfolio.totalValue;
    const maxConcentrationValue = portfolio.totalValue * limits.maxConcentration;
    if (positionValue > maxConcentrationValue) {
      finalSize = maxConcentrationValue / portfolio.totalValue;
    }
    
    // Leverage limit
    const currentLeverage = this.calculatePortfolioLeverage(portfolio);
    if (currentLeverage + finalSize > limits.maxLeverage) {
      finalSize = Math.max(0, limits.maxLeverage - currentLeverage);
    }
    
    // Sector exposure limits
    if (limits.maxSectorExposure && asset.type) {
      const currentSectorExposure = this.calculateSectorExposure(portfolio, asset.type);
      const maxSectorSize = limits.maxSectorExposure.get(asset.type) || 1;
      if (currentSectorExposure + finalSize > maxSectorSize) {
        finalSize = Math.max(0, maxSectorSize - currentSectorExposure);
      }
    }
    
    return Math.max(0, finalSize);
  }

  /**
   * Calculate risk contribution of a position
   */
  private calculateRiskContribution(
    size: number,
    asset: Asset,
    portfolio: Portfolio
  ): number {
    const positionRisk = size * (asset.volatility || 0.20);
    const totalPortfolioRisk = this.calculateTotalPortfolioRisk(portfolio);
    
    return totalPortfolioRisk > 0 ? positionRisk / totalPortfolioRisk : 0;
  }

  /**
   * Helper methods
   */
  
  private async fetchPerformanceStats(symbol: string): Promise<PerformanceStats> {
    // In production, this would fetch from a database or API
    // For now, return mock data
    return {
      symbol,
      totalTrades: 100,
      winRate: 0.55,
      avgWin: 0.02,
      avgLoss: 0.015,
      sharpeRatio: 1.5,
      maxDrawdown: 0.15
    };
  }

  private async calculateAssetVolatility(symbol: string): Promise<number> {
    // In production, calculate from historical price data
    // For now, return a default value
    return 0.20; // 20% annual volatility
  }

  private async calculatePortfolioVolatility(portfolio: Portfolio): Promise<number> {
    let portfolioVariance = 0;
    
    for (const position of portfolio.positions) {
      const weight = (position.quantity * position.currentPrice) / portfolio.totalValue;
      const assetVol = await this.calculateAssetVolatility(position.symbol);
      portfolioVariance += Math.pow(weight * assetVol, 2);
    }
    
    return Math.sqrt(portfolioVariance);
  }

  private async calculatePortfolioRiskContributions(
    portfolio: Portfolio
  ): Promise<Map<string, number>> {
    const contributions = new Map<string, number>();
    
    for (const position of portfolio.positions) {
      const weight = (position.quantity * position.currentPrice) / portfolio.totalValue;
      const assetVol = await this.calculateAssetVolatility(position.symbol);
      contributions.set(position.symbol, weight * assetVol);
    }
    
    return contributions;
  }

  private async getHistoricalMaxDrawdown(symbol: string): Promise<number> {
    const stats = this.historicalPerformance.get(symbol) || await this.fetchPerformanceStats(symbol);
    return stats.maxDrawdown;
  }

  private calculatePortfolioLeverage(portfolio: Portfolio): number {
    const totalExposure = portfolio.positions.reduce((sum, pos) => {
      return sum + Math.abs(pos.quantity * pos.currentPrice);
    }, 0);
    
    return totalExposure / portfolio.totalValue;
  }

  private calculateSectorExposure(portfolio: Portfolio, sector: string): number {
    const sectorExposure = portfolio.positions
      .filter(pos => pos.symbol.includes(sector)) // Simplified sector detection
      .reduce((sum, pos) => sum + (pos.quantity * pos.currentPrice) / portfolio.totalValue, 0);
    
    return sectorExposure;
  }

  private calculateTotalPortfolioRisk(portfolio: Portfolio): number {
    // Simplified calculation - in production would use full covariance matrix
    return portfolio.positions.reduce((sum, pos) => {
      const weight = (pos.quantity * pos.currentPrice) / portfolio.totalValue;
      return sum + weight * 0.20; // Assuming 20% volatility
    }, 0);
  }

  /**
   * Update historical performance data
   */
  updatePerformanceStats(symbol: string, stats: PerformanceStats): void {
    this.historicalPerformance.set(symbol, stats);
  }

  /**
   * Clear performance cache
   */
  clearPerformanceCache(): void {
    this.historicalPerformance.clear();
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<PositionSizerConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

/**
 * Supporting interfaces
 */
interface PerformanceStats {
  symbol: string;
  totalTrades: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  sharpeRatio: number;
  maxDrawdown: number;
}

interface MarketData {
  correlationMatrix?: CorrelationMatrix;
  maxLeverage?: number;
  maxConcentration?: number;
  maxSectorExposure?: Map<string, number>;
  minPositionSize?: number;
  maxAcceptableDrawdown?: number;
} 