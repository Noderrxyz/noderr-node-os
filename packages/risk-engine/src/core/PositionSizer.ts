import {
  Portfolio,
  Position,
  PositionSizerConfig,
  PositionLimits,
  SizingResult,
  Asset,
  RiskEngineError,
  RiskErrorCode,
  CorrelationMatrix
} from '../types';
import * as ss from 'simple-statistics';
import { Logger } from 'winston';

export class PositionSizer {
  private logger: Logger;
  private historicalReturns: Map<string, number[]> = new Map();
  private winRateCache: Map<string, WinRateStats> = new Map();

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Calculate optimal position size based on configured methodology
   */
  async calculatePositionSize(
    signal: TradingSignal,
    portfolio: Portfolio,
    config: PositionSizerConfig,
    limits: PositionLimits
  ): Promise<SizingResult> {
    this.logger.info('Calculating position size', {
      symbol: signal.symbol,
      methodology: config.methodology
    });

    try {
      let baseSize: number;
      let methodology: string = config.methodology;

      switch (config.methodology) {
        case 'kelly':
          baseSize = await this.calculateKellySize(
            signal,
            config.kellyFraction || 0.25
          );
          break;
        case 'volatilityTarget':
          baseSize = await this.calculateVolatilityTargetSize(
            signal.symbol,
            config.targetVolatility || 0.15,
            portfolio
          );
          break;
        case 'riskParity':
          baseSize = await this.calculateRiskParitySize(
            portfolio,
            signal.symbol,
            config
          );
          break;
        case 'maxDrawdown':
          baseSize = await this.calculateMaxDrawdownSize(
            signal.symbol,
            portfolio,
            config
          );
          break;
        case 'optimal':
          baseSize = await this.calculateOptimalSize(
            signal,
            portfolio,
            config
          );
          methodology = 'optimal-composite';
          break;
        default:
          throw new RiskEngineError(
            RiskErrorCode.CONFIGURATION_ERROR,
            `Unknown sizing methodology: ${config.methodology}`
          );
      }

      // Apply correlation adjustment if enabled
      if (config.correlationAdjustment) {
        baseSize = await this.adjustForCorrelation(baseSize, signal.symbol, portfolio);
      }

      // Enforce position limits
      const adjustedSize = this.enforcePositionLimits(baseSize, signal.symbol, portfolio, limits);

      // Calculate risk contribution
      const riskContribution = await this.calculateRiskContribution(
        adjustedSize,
        signal.symbol,
        portfolio
      );

      return {
        recommendedSize: baseSize,
        adjustedSize,
        methodology,
        confidence: signal.confidence || 0.5,
        riskContribution,
        constraints: this.getAppliedConstraints(baseSize, adjustedSize, limits)
      };
    } catch (error) {
      this.logger.error('Position sizing failed', error);
      throw error;
    }
  }

  /**
   * Kelly Criterion position sizing
   * f* = (p*b - q) / b
   * where f* = fraction of capital to wager
   * p = probability of winning
   * q = probability of losing (1-p)
   * b = ratio of win amount to loss amount
   */
  async calculateKellySize(
    signal: TradingSignal,
    kellyFraction: number = 0.25
  ): Promise<number> {
    const stats = await this.getWinRateStats(signal.symbol);
    
    if (!stats || stats.totalTrades < 30) {
      this.logger.warn('Insufficient trade history for Kelly sizing');
      return 0.02; // Default 2% position
    }

    const p = stats.winRate;
    const q = 1 - p;
    const b = stats.avgWin / Math.abs(stats.avgLoss);

    // Kelly formula
    let kellyPercentage = (p * b - q) / b;

    // Apply Kelly fraction (typically 1/4 Kelly for safety)
    kellyPercentage *= kellyFraction;

    // Constrain to reasonable bounds
    return Math.max(0.001, Math.min(kellyPercentage, 0.25));
  }

  /**
   * Volatility targeting - size position to achieve target portfolio volatility
   */
  async calculateVolatilityTargetSize(
    symbol: string,
    targetVolatility: number,
    portfolio: Portfolio
  ): Promise<number> {
    const assetVolatility = await this.getAssetVolatility(symbol);
    const portfolioVolatility = await this.getPortfolioVolatility(portfolio);
    
    if (assetVolatility === 0) {
      throw new RiskEngineError(
        RiskErrorCode.CALCULATION_ERROR,
        'Asset volatility is zero'
      );
    }

    // Size = (Target Vol / Asset Vol) * (Portfolio Value / Asset Price)
    // Simplified: what percentage of portfolio achieves target vol
    const sizingRatio = targetVolatility / assetVolatility;
    
    // Adjust for current portfolio volatility
    const currentContribution = portfolioVolatility > 0 
      ? targetVolatility / portfolioVolatility 
      : 1;

    return Math.min(sizingRatio * currentContribution, 0.2); // Max 20% position
  }

  /**
   * Risk Parity - equal risk contribution from each position
   */
  async calculateRiskParitySize(
    portfolio: Portfolio,
    symbol: string,
    config: PositionSizerConfig
  ): Promise<number> {
    const positions = portfolio.positions.length + 1; // Including new position
    const targetRiskContribution = 1 / positions;
    
    const assetVolatility = await this.getAssetVolatility(symbol);
    const totalPortfolioRisk = await this.getTotalPortfolioRisk(portfolio);
    
    // Size to achieve equal risk contribution
    const targetRisk = totalPortfolioRisk * targetRiskContribution;
    const size = targetRisk / assetVolatility;
    
    return Math.min(size, 0.15); // Max 15% for risk parity
  }

  /**
   * Max Drawdown based sizing - size based on historical drawdowns
   */
  async calculateMaxDrawdownSize(
    symbol: string,
    portfolio: Portfolio,
    config: PositionSizerConfig
  ): Promise<number> {
    const historicalDrawdown = await this.getHistoricalMaxDrawdown(symbol);
    const acceptableDrawdown = 0.10; // 10% max acceptable drawdown
    
    if (historicalDrawdown === 0) {
      return 0.02; // Default 2%
    }
    
    // Size inversely proportional to historical drawdown
    const baseSize = acceptableDrawdown / historicalDrawdown;
    
    // Adjust for portfolio drawdown
    const portfolioDrawdown = await this.getPortfolioDrawdown(portfolio);
    const drawdownAdjustment = 1 - (portfolioDrawdown / 0.25); // Reduce size as portfolio drawdown increases
    
    return Math.max(0.01, Math.min(baseSize * drawdownAdjustment, 0.1));
  }

  /**
   * Optimal sizing - combines multiple methodologies
   */
  async calculateOptimalSize(
    signal: TradingSignal,
    portfolio: Portfolio,
    config: PositionSizerConfig
  ): Promise<number> {
    const weights = {
      kelly: 0.3,
      volatility: 0.3,
      riskParity: 0.2,
      maxDrawdown: 0.2
    };
    
    const kellySizing = await this.calculateKellySize(signal, config.kellyFraction);
    const volSizing = await this.calculateVolatilityTargetSize(
      signal.symbol,
      config.targetVolatility || 0.15,
      portfolio
    );
    const riskParitySizing = await this.calculateRiskParitySize(portfolio, signal.symbol, config);
    const drawdownSizing = await this.calculateMaxDrawdownSize(signal.symbol, portfolio, config);
    
    // Weighted average
    const optimalSize = 
      kellySizing * weights.kelly +
      volSizing * weights.volatility +
      riskParitySizing * weights.riskParity +
      drawdownSizing * weights.maxDrawdown;
    
    // Apply confidence adjustment
    const confidenceMultiplier = 0.5 + (signal.confidence || 0.5) * 0.5; // 0.5x to 1x based on confidence
    
    return optimalSize * confidenceMultiplier;
  }

  /**
   * Adjust position size based on correlation with existing positions
   */
  async adjustForCorrelation(
    baseSize: number,
    symbol: string,
    portfolio: Portfolio
  ): Promise<number> {
    if (portfolio.positions.length === 0) {
      return baseSize;
    }
    
    const correlations = await this.getAssetCorrelations(symbol, portfolio);
    const avgCorrelation = ss.mean(Object.values(correlations));
    
    // Reduce size for highly correlated positions
    const correlationPenalty = Math.max(0, avgCorrelation);
    const adjustmentFactor = 1 - (correlationPenalty * 0.5); // Max 50% reduction for perfect correlation
    
    return baseSize * adjustmentFactor;
  }

  /**
   * Enforce position limits and constraints
   */
  enforcePositionLimits(
    size: number,
    symbol: string,
    portfolio: Portfolio,
    limits: PositionLimits
  ): number {
    let adjustedSize = size;
    
    // Maximum single position size
    adjustedSize = Math.min(adjustedSize, limits.maxPositionSize);
    
    // Maximum portfolio exposure
    const currentExposure = this.calculatePortfolioExposure(portfolio);
    const newExposure = currentExposure + adjustedSize;
    
    if (newExposure > limits.maxPortfolioExposure) {
      adjustedSize = Math.max(0, limits.maxPortfolioExposure - currentExposure);
    }
    
    // Sector exposure limits
    if (limits.maxSectorExposure) {
      const sectorExposure = this.calculateSectorExposure(symbol, portfolio);
      if (sectorExposure + adjustedSize > limits.maxSectorExposure) {
        adjustedSize = Math.max(0, limits.maxSectorExposure - sectorExposure);
      }
    }
    
    // Minimum diversification requirement
    if (limits.minDiversification && portfolio.positions.length > 0) {
      const maxAllowedConcentration = 1 / limits.minDiversification;
      adjustedSize = Math.min(adjustedSize, maxAllowedConcentration);
    }
    
    return Math.max(0, adjustedSize);
  }

  // Helper methods

  private async getWinRateStats(symbol: string): Promise<WinRateStats | null> {
    // Check cache
    if (this.winRateCache.has(symbol)) {
      return this.winRateCache.get(symbol)!;
    }
    
    // In production, fetch from trade history
    // Mock implementation
    const stats: WinRateStats = {
      winRate: 0.55,
      avgWin: 0.025,
      avgLoss: 0.015,
      totalTrades: 100,
      sharpeRatio: 1.5
    };
    
    this.winRateCache.set(symbol, stats);
    return stats;
  }

  private async getAssetVolatility(symbol: string): Promise<number> {
    const returns = await this.getHistoricalReturns(symbol);
    if (returns.length < 20) {
      return 0.02; // Default 2% daily volatility
    }
    
    return ss.standardDeviation(returns);
  }

  private async getPortfolioVolatility(portfolio: Portfolio): Promise<number> {
    if (portfolio.positions.length === 0) {
      return 0;
    }
    
    // Simplified - in production would use full covariance matrix
    const volatilities = await Promise.all(
      portfolio.positions.map(p => this.getAssetVolatility(p.symbol))
    );
    
    const weights = portfolio.positions.map(
      p => (p.size * p.currentPrice) / portfolio.totalValue
    );
    
    // Weighted average volatility (simplified - ignores correlations)
    return ss.sum(weights.map((w, i) => w * volatilities[i]));
  }

  private async getHistoricalReturns(symbol: string): Promise<number[]> {
    if (this.historicalReturns.has(symbol)) {
      return this.historicalReturns.get(symbol)!;
    }
    
    // Mock historical returns
    const returns: number[] = [];
    for (let i = 0; i < 252; i++) {
      returns.push((Math.random() - 0.5) * 0.04); // ±2% daily returns
    }
    
    this.historicalReturns.set(symbol, returns);
    return returns;
  }

  private async getTotalPortfolioRisk(portfolio: Portfolio): Promise<number> {
    const portfolioVolatility = await this.getPortfolioVolatility(portfolio);
    return portfolioVolatility * portfolio.totalValue;
  }

  private async getHistoricalMaxDrawdown(symbol: string): Promise<number> {
    const returns = await this.getHistoricalReturns(symbol);
    
    let peak = 1;
    let maxDrawdown = 0;
    let cumulative = 1;
    
    for (const ret of returns) {
      cumulative *= (1 + ret);
      if (cumulative > peak) {
        peak = cumulative;
      }
      const drawdown = (peak - cumulative) / peak;
      maxDrawdown = Math.max(maxDrawdown, drawdown);
    }
    
    return maxDrawdown;
  }

  private async getPortfolioDrawdown(portfolio: Portfolio): Promise<number> {
    // In production, track actual portfolio drawdown
    // Mock implementation
    const currentValue = portfolio.totalValue;
    const peakValue = currentValue * 1.1; // Assume 10% below peak
    
    return (peakValue - currentValue) / peakValue;
  }

  private async getAssetCorrelations(
    symbol: string,
    portfolio: Portfolio
  ): Promise<Record<string, number>> {
    const correlations: Record<string, number> = {};
    
    const newAssetReturns = await this.getHistoricalReturns(symbol);
    
    for (const position of portfolio.positions) {
      const positionReturns = await this.getHistoricalReturns(position.symbol);
      const correlation = ss.sampleCorrelation(newAssetReturns, positionReturns);
      correlations[position.symbol] = correlation;
    }
    
    return correlations;
  }

  private calculatePortfolioExposure(portfolio: Portfolio): number {
    return portfolio.positions.reduce(
      (total, position) => total + (position.size * position.currentPrice) / portfolio.totalValue,
      0
    );
  }

  private calculateSectorExposure(symbol: string, portfolio: Portfolio): number {
    // In production, would map symbols to sectors
    const sector = this.getAssetSector(symbol);
    
    return portfolio.positions
      .filter(p => this.getAssetSector(p.symbol) === sector)
      .reduce((total, p) => total + (p.size * p.currentPrice) / portfolio.totalValue, 0);
  }

  private getAssetSector(symbol: string): string {
    // Mock sector mapping
    const sectorMap: Record<string, string> = {
      'BTC': 'crypto-currency',
      'ETH': 'crypto-smart-contract',
      'SOL': 'crypto-smart-contract',
      'LINK': 'crypto-oracle',
      'UNI': 'crypto-defi',
      'AAVE': 'crypto-defi'
    };
    
    return sectorMap[symbol] || 'crypto-other';
  }

  private async calculateRiskContribution(
    size: number,
    symbol: string,
    portfolio: Portfolio
  ): Promise<number> {
    const assetVolatility = await this.getAssetVolatility(symbol);
    const positionRisk = size * assetVolatility;
    const portfolioRisk = await this.getTotalPortfolioRisk(portfolio);
    
    return portfolioRisk > 0 ? positionRisk / (portfolioRisk + positionRisk) : 1;
  }

  private getAppliedConstraints(
    recommendedSize: number,
    adjustedSize: number,
    limits: PositionLimits
  ): string[] {
    const constraints: string[] = [];
    
    if (adjustedSize < recommendedSize) {
      if (adjustedSize === limits.maxPositionSize) {
        constraints.push('Maximum position size limit applied');
      }
      if (adjustedSize < recommendedSize * 0.9) {
        constraints.push('Portfolio exposure limit applied');
      }
      if (adjustedSize < recommendedSize * 0.8) {
        constraints.push('Correlation adjustment applied');
      }
    }
    
    return constraints;
  }
}

// Supporting interfaces
interface TradingSignal {
  symbol: string;
  direction: 'long' | 'short';
  confidence?: number;
  expectedReturn?: number;
  stopLoss?: number;
  takeProfit?: number;
  timeHorizon?: number;
}

interface WinRateStats {
  winRate: number;
  avgWin: number;
  avgLoss: number;
  totalTrades: number;
  sharpeRatio: number;
} 